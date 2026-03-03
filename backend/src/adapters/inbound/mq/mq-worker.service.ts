import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import type { ConsumeMessage } from 'amqplib';
import type { ComputeJobRequestedV1 } from '../../../domain/job/job-request';
import type { OutboxRecord } from '../../../domain/outbox/outbox';
import { MetricsService } from '../../../observability/metrics/metrics.service';
import { ExecuteJobUseCase } from '../../../application/use-cases/execute-job.use-case';
import { FailInvalidJobMessageUseCase } from '../../../application/use-cases/fail-invalid-job-message.use-case';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepositoryPort,
} from '../../../application/ports/outbox-repository.port';
import { hostname } from 'node:os';

const JOB_REQUESTED_ROUTING_KEY = 'compute.job.requested.v1';

/**
 * MQ worker（M6+）：
 * - RabbitMQ consumer：消费 `compute.job.requested.v1`
 * - 事务内写 jobs + outbox，事务提交后 ack
 * - 幂等冲突 / 无法解析关键信息：reject(requeue=false) → DLQ
 */
@Injectable()
export class MqWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqWorkerService.name);

  private stopRequested = false;
  private stopPromise: Promise<void> | null = null;
  private stopResolve: (() => void) | null = null;
  private mainLoopPromise: Promise<void> | null = null;

  private connection: amqplib.ChannelModel | null = null;
  private consumerChannel: amqplib.Channel | null = null;
  private consumerTag: string | null = null;
  private dispatcherChannel: amqplib.ConfirmChannel | null = null;
  private dispatcherStop = false;
  private dispatcherPromise: Promise<void> | null = null;
  private outboxMetricsInterval: NodeJS.Timeout | null = null;

  private enableConsumer = false;
  private enableDispatcher = false;
  private rabbitUrl: string | null = null;
  private commandsExchange: string = 'compute.commands';
  private eventsExchange: string = 'compute.events';
  private dlxExchange: string = 'compute.dlx';
  private queueName: string = 'compute.job.requested.v1';
  private prefetch: number = 10;

  private disconnectRequested = false;
  private disconnectPromise: Promise<string> | null = null;
  private disconnectResolve: ((reason: string) => void) | null = null;

  private readonly instanceId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly configService: ConfigService,
    private readonly executeJobUseCase: ExecuteJobUseCase,
    private readonly failInvalidJobMessageUseCase: FailInvalidJobMessageUseCase,
    private readonly metricsService: MetricsService,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepositoryPort,
  ) {}

  onModuleInit() {
    const roles = parseWorkerRoles(
      this.configService.get<string>('WORKER_ROLES') ?? 'consumer,dispatcher',
    );

    this.enableConsumer = roles.has('consumer');
    this.enableDispatcher = roles.has('dispatcher');

    if (!this.enableConsumer && !this.enableDispatcher) {
      this.logger.log(
        'Worker role consumer/dispatcher disabled; MQ worker not started.',
      );
      return;
    }

    this.rabbitUrl = this.configService.get<string>('RABBITMQ_URL') ?? null;
    if (!this.rabbitUrl) {
      throw new Error('RABBITMQ_URL is required for worker');
    }

    this.commandsExchange =
      this.configService.get<string>('MQ_COMMANDS_EXCHANGE') ??
      'compute.commands';
    this.eventsExchange =
      this.configService.get<string>('MQ_EVENTS_EXCHANGE') ?? 'compute.events';
    this.dlxExchange =
      this.configService.get<string>('MQ_DLX_EXCHANGE') ?? 'compute.dlx';
    this.queueName =
      this.configService.get<string>('MQ_JOB_REQUESTED_QUEUE') ??
      'compute.job.requested.v1';
    this.prefetch = this.configService.get<number>('MQ_PREFETCH') ?? 10;

    // 指标：初始状态标记为 disconnected（等真正连上后再置为 1）。
    this.metricsService.setMqConnectionState(
      'consumer',
      this.enableConsumer ? 0 : 0,
    );
    this.metricsService.setMqConnectionState(
      'dispatcher',
      this.enableDispatcher ? 0 : 0,
    );

    const metricsEnabled =
      this.configService.get<boolean>('METRICS_ENABLED') ?? true;
    if (metricsEnabled) {
      const maxAttempts =
        this.configService.get<number>('OUTBOX_DISPATCH_MAX_ATTEMPTS') ?? 25;
      this.startOutboxMetricsPolling(maxAttempts);
    }

    this.stopRequested = false;
    this.stopPromise = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });

    this.mainLoopPromise = this.runMqMainLoop();
  }

  async onModuleDestroy() {
    this.stopRequested = true;
    this.stopResolve?.();

    if (this.outboxMetricsInterval) {
      clearInterval(this.outboxMetricsInterval);
      this.outboxMetricsInterval = null;
    }

    // 主动 teardown（避免 main loop 卡在等待 close 事件）。
    await this.teardownMq('module_destroy');

    try {
      await this.mainLoopPromise;
    } catch (error) {
      this.logger.warn(`MQ main loop stopped with error: ${String(error)}`);
    }
  }

  private async handleMessageOnChannel(
    channel: amqplib.Channel,
    msg: ConsumeMessage | null,
  ) {
    if (!msg) {
      return;
    }

    try {
      const maxBytes =
        this.configService.get<number>('MQ_MAX_MESSAGE_BYTES') ?? 1_000_000;
      if (msg.content.length > maxBytes) {
        this.logger.warn(
          `Message too large, send to DLQ: size=${msg.content.length} max=${maxBytes}`,
          JSON.stringify({
            messageId:
              typeof msg.properties.messageId === 'string'
                ? msg.properties.messageId
                : undefined,
            correlationId:
              typeof msg.properties.correlationId === 'string'
                ? msg.properties.correlationId
                : undefined,
          }),
        );
        this.metricsService.incJobRequested('reject_dlq');
        safeReject(channel, msg, false);
        return;
      }

      const messageId =
        typeof msg.properties.messageId === 'string'
          ? msg.properties.messageId
          : undefined;
      const correlationId =
        typeof msg.properties.correlationId === 'string'
          ? msg.properties.correlationId
          : undefined;

      const parsed = parseJson(msg.content);
      if (!parsed.ok) {
        this.logger.warn(
          `Invalid JSON message, send to DLQ: ${parsed.reason}`,
          JSON.stringify({ messageId, correlationId }),
        );
        this.metricsService.incJobRequested('reject_dlq');
        safeReject(channel, msg, false);
        return;
      }

      const root = parsed.value;
      const jobId = readNonEmptyString(root['jobId']);
      if (!jobId) {
        this.logger.warn(
          'Missing jobId, send to DLQ',
          JSON.stringify({ messageId, correlationId }),
        );
        this.metricsService.incJobRequested('reject_dlq');
        safeReject(channel, msg, false);
        return;
      }

      const definitionRef = parseDefinitionRef(root['definitionRef']);
      if (!definitionRef) {
        this.logger.warn(
          `Invalid definitionRef, send to DLQ: jobId=${jobId}`,
          JSON.stringify({ messageId, correlationId, jobId }),
        );
        this.metricsService.incJobRequested('reject_dlq');
        safeReject(channel, msg, false);
        return;
      }

      const validated = validateJobRequestedPayload(root, jobId, definitionRef);
      if (!validated.ok) {
        const failResult = await this.failInvalidJobMessageUseCase.execute({
          messageId,
          correlationId,
          jobId,
          definitionRef,
          rawPayload: root,
          reason: validated.reason,
          details: validated.details,
        });

        if (failResult.kind === 'conflict') {
          this.logger.warn(
            `Idempotency conflict (invalid message), send to DLQ: jobId=${jobId}`,
            JSON.stringify({
              messageId,
              correlationId,
              jobId,
              definitionId: definitionRef.definitionId,
              definitionHashUsed: definitionRef.definitionHash,
            }),
          );
          this.metricsService.incJobRequested('reject_dlq');
          safeReject(channel, msg, false);
          return;
        }

        this.logger.debug(
          'Message acked (invalid payload stored as job.failed)',
          JSON.stringify({
            messageId,
            correlationId,
            jobId,
            definitionId: definitionRef.definitionId,
            definitionHashUsed: definitionRef.definitionHash,
            result: failResult.kind,
          }),
        );
        this.metricsService.incJobRequested('ack');
        safeAck(channel, msg);
        return;
      }

      const payload: ComputeJobRequestedV1 = validated.payload;

      const execResult = await this.executeJobUseCase.execute({
        messageId,
        correlationId,
        payload,
      });

      if (execResult.kind === 'conflict') {
        this.logger.warn(
          `Idempotency conflict, send to DLQ: jobId=${payload.jobId}`,
          JSON.stringify({
            messageId,
            correlationId,
            jobId: payload.jobId,
            definitionId: payload.definitionRef.definitionId,
            definitionHashUsed: payload.definitionRef.definitionHash,
          }),
        );
        this.metricsService.incJobRequested('reject_dlq');
        safeReject(channel, msg, false);
        return;
      }

      this.logger.debug(
        'Message acked',
        JSON.stringify({
          messageId,
          correlationId,
          jobId: payload.jobId,
          definitionId: payload.definitionRef.definitionId,
          definitionHashUsed: payload.definitionRef.definitionHash,
          result: execResult.kind,
        }),
      );
      this.metricsService.incJobRequested('ack');
      safeAck(channel, msg);
    } catch (error) {
      this.logger.error(
        `Unhandled error while handling message, nack(requeue=true): ${String(error)}`,
        JSON.stringify({
          messageId:
            typeof msg.properties.messageId === 'string'
              ? msg.properties.messageId
              : undefined,
          correlationId:
            typeof msg.properties.correlationId === 'string'
              ? msg.properties.correlationId
              : undefined,
        }),
      );
      this.metricsService.incJobRequested('nack_requeue');
      safeNack(channel, msg, false, true);
    }
  }

  private async runMqMainLoop() {
    if (!this.rabbitUrl) {
      return;
    }

    let hasConnectedOnce = false;
    let consecutiveFailures = 0;

    while (!this.stopRequested) {
      // 只有在非首次连接时才计为“重连”。
      if (hasConnectedOnce) {
        if (this.enableConsumer) {
          this.metricsService.incMqReconnect('consumer');
        }
        if (this.enableDispatcher) {
          this.metricsService.incMqReconnect('dispatcher');
        }
      }

      try {
        await this.connectAndStartMq();
        hasConnectedOnce = true;
        consecutiveFailures = 0;

        // 成功连上后，backoff 置 0。
        this.metricsService.setMqReconnectBackoffMs(
          'consumer',
          this.enableConsumer ? 0 : 0,
        );
        this.metricsService.setMqReconnectBackoffMs(
          'dispatcher',
          this.enableDispatcher ? 0 : 0,
        );

        const stopPromise = this.stopPromise ?? Promise.resolve();
        const disconnectPromise = this.disconnectPromise ?? Promise.resolve('');
        await Promise.race([stopPromise, disconnectPromise]);
      } catch (error) {
        const errorText = stringifyError(error);
        this.logger.warn(`MQ connect/start failed: ${errorText}`);
        consecutiveFailures = Math.max(1, consecutiveFailures + 1);
      } finally {
        await this.teardownMq('loop_teardown');
      }

      if (this.stopRequested) {
        break;
      }

      consecutiveFailures = Math.max(1, consecutiveFailures);
      const backoffMs = computeBackoffMs(consecutiveFailures);
      if (this.enableConsumer) {
        this.metricsService.setMqReconnectBackoffMs('consumer', backoffMs);
      }
      if (this.enableDispatcher) {
        this.metricsService.setMqReconnectBackoffMs('dispatcher', backoffMs);
      }
      await sleep(backoffMs);
    }
  }

  private async connectAndStartMq() {
    if (!this.rabbitUrl) {
      throw new Error('rabbitUrl not configured');
    }

    this.disconnectRequested = false;
    this.disconnectPromise = new Promise<string>((resolve) => {
      this.disconnectResolve = resolve;
    });

    this.connection = await amqplib.connect(this.rabbitUrl);
    this.connection.on('error', (err) => {
      // amqplib 约定：error 不一定意味着 close；close 事件才表示连接终止。
      this.logger.warn(`RabbitMQ connection error: ${stringifyError(err)}`);
    });
    this.connection.on('close', () => {
      this.requestReconnect('connection_close');
    });

    if (this.enableConsumer) {
      this.consumerChannel = await this.connection.createChannel();
      this.consumerChannel.on('error', (err) => {
        this.logger.warn(`Consumer channel error: ${stringifyError(err)}`);
      });
      this.consumerChannel.on('close', () => {
        this.requestReconnect('consumer_channel_close');
      });

      await setupTopology(this.consumerChannel, {
        commandsExchange: this.commandsExchange,
        eventsExchange: this.eventsExchange,
        dlxExchange: this.dlxExchange,
        queueName: this.queueName,
        routingKey: JOB_REQUESTED_ROUTING_KEY,
      });

      await this.consumerChannel.prefetch(this.prefetch);

      const channel = this.consumerChannel;
      const consumeOk = await channel.consume(
        this.queueName,
        (msg) => void this.handleMessageOnChannel(channel, msg),
        { noAck: false },
      );
      this.consumerTag = consumeOk.consumerTag;

      this.logger.log(
        `RabbitMQ consumer started: queue=${this.queueName}, routingKey=${JOB_REQUESTED_ROUTING_KEY}, prefetch=${this.prefetch}`,
      );
      this.metricsService.setMqConnectionState('consumer', 1);
    } else {
      this.metricsService.setMqConnectionState('consumer', 0);
      this.logger.log('Worker role consumer disabled.');
    }

    if (this.enableDispatcher) {
      this.dispatcherChannel = await this.connection.createConfirmChannel();
      this.dispatcherChannel.on('error', (err) => {
        this.logger.warn(`Dispatcher channel error: ${stringifyError(err)}`);
      });
      this.dispatcherChannel.on('close', () => {
        this.requestReconnect('dispatcher_channel_close');
      });

      await this.dispatcherChannel.assertExchange(
        this.eventsExchange,
        'topic',
        {
          durable: true,
        },
      );
      this.startDispatcher(this.eventsExchange);
      this.metricsService.setMqConnectionState('dispatcher', 1);
    } else {
      this.metricsService.setMqConnectionState('dispatcher', 0);
      this.logger.log('Worker role dispatcher disabled.');
    }
  }

  private requestReconnect(reason: string) {
    if (this.disconnectRequested) {
      return;
    }
    this.disconnectRequested = true;
    this.logger.warn(`RabbitMQ disconnected: reason=${reason}`);
    this.disconnectResolve?.(reason);
  }

  private async teardownMq(caller: string) {
    // stop dispatcher loop first (it may be waiting on DB or trying to publish)
    this.dispatcherStop = true;
    try {
      await this.dispatcherPromise;
    } catch (error) {
      this.logger.warn(
        `Dispatcher stopped with error (${caller}): ${String(error)}`,
      );
    }

    try {
      if (this.consumerChannel && this.consumerTag) {
        await this.consumerChannel.cancel(this.consumerTag);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cancel consumer (${caller}): ${String(error)}`,
      );
    }

    try {
      await this.consumerChannel?.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close consumer channel (${caller}): ${String(error)}`,
      );
    }
    this.consumerChannel = null;
    this.consumerTag = null;

    try {
      await this.dispatcherChannel?.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close dispatcher channel (${caller}): ${String(error)}`,
      );
    }
    this.dispatcherChannel = null;

    try {
      await this.connection?.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close connection (${caller}): ${String(error)}`,
      );
    }
    this.connection = null;

    // 标记 disconnected
    this.metricsService.setMqConnectionState('consumer', 0);
    this.metricsService.setMqConnectionState('dispatcher', 0);
  }

  private startDispatcher(eventsExchange: string) {
    if (!this.dispatcherChannel) {
      return;
    }

    const batchSize =
      this.configService.get<number>('OUTBOX_DISPATCH_BATCH_SIZE') ?? 50;
    const pollIntervalMs =
      this.configService.get<number>('OUTBOX_DISPATCH_POLL_INTERVAL_MS') ?? 500;
    const leaseMs =
      this.configService.get<number>('OUTBOX_DISPATCH_LEASE_MS') ?? 30_000;
    const maxAttempts =
      this.configService.get<number>('OUTBOX_DISPATCH_MAX_ATTEMPTS') ?? 25;

    this.logger.log(
      `Outbox dispatcher started: instanceId=${this.instanceId}, batchSize=${batchSize}, poll=${pollIntervalMs}ms, lease=${leaseMs}ms, maxAttempts=${maxAttempts}`,
    );

    this.dispatcherStop = false;
    this.dispatcherPromise = this.dispatchLoop({
      eventsExchange,
      batchSize,
      pollIntervalMs,
      leaseMs,
      maxAttempts,
    });
  }

  private async dispatchLoop(params: {
    eventsExchange: string;
    batchSize: number;
    pollIntervalMs: number;
    leaseMs: number;
    maxAttempts: number;
  }) {
    if (!this.dispatcherChannel) {
      return;
    }

    while (!this.dispatcherStop) {
      try {
        const now = new Date();
        const staleLockedBefore = new Date(now.getTime() - params.leaseMs);

        const batch = await this.outboxRepository.leaseNextBatch({
          batchSize: params.batchSize,
          lockedBy: this.instanceId,
          now,
          staleLockedBefore,
          maxAttempts: params.maxAttempts,
        });

        this.metricsService.addOutboxLeased(batch.length);
        if (batch.length === 0) {
          await sleep(params.pollIntervalMs);
          continue;
        }

        for (const record of batch) {
          if (this.dispatcherStop) {
            break;
          }
          await this.dispatchOne(
            record,
            params.eventsExchange,
            params.maxAttempts,
          );
        }
      } catch (error) {
        this.logger.error(`Outbox dispatcher loop error: ${String(error)}`);
        await sleep(params.pollIntervalMs);
      }
    }
  }

  private async dispatchOne(
    record: OutboxRecord,
    eventsExchange: string,
    maxAttempts: number,
  ) {
    if (!this.dispatcherChannel) {
      return;
    }

    const now = new Date();
    const startedAt = process.hrtime.bigint();
    try {
      const content = Buffer.from(JSON.stringify(record.payload), 'utf8');
      const correlationId =
        typeof record.headers['correlationId'] === 'string'
          ? record.headers['correlationId']
          : undefined;
      const publishOptions: amqplib.Options.Publish = {
        persistent: true,
        contentType: 'application/json',
        type: record.eventType,
        messageId: record.id,
        correlationId,
        headers: record.headers ?? {},
        timestamp: Math.floor(now.getTime() / 1000),
      };

      await publishWithConfirm(
        this.dispatcherChannel,
        eventsExchange,
        record.routingKey,
        content,
        publishOptions,
      );

      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metricsService.incOutboxPublish('sent');
      this.metricsService.observeOutboxPublishDuration(durationSeconds);
      await this.outboxRepository.markSent({
        id: record.id,
        lockedBy: this.instanceId,
        now,
      });
    } catch (error) {
      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metricsService.incOutboxPublish('failed');
      this.metricsService.observeOutboxPublishDuration(durationSeconds);

      const errorText = stringifyError(error);
      const nextAttempt = record.attempts + 1;

      const nextRetryAt =
        nextAttempt >= maxAttempts
          ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
          : new Date(now.getTime() + computeBackoffMs(nextAttempt));

      this.logger.warn(
        `Outbox publish failed: id=${record.id} attempt=${nextAttempt}/${maxAttempts} nextRetryAt=${nextRetryAt.toISOString()} error=${errorText}`,
      );

      await this.outboxRepository.markFailedAndScheduleRetry({
        id: record.id,
        lockedBy: this.instanceId,
        now,
        error: errorText,
        nextRetryAt,
      });
    }
  }

  private startOutboxMetricsPolling(maxAttempts: number) {
    const intervalMs = 10_000;
    const tick = async () => {
      try {
        const pending = await this.outboxRepository.countPending();
        const failed = await this.outboxRepository.countFailed({
          maxAttempts,
        });
        this.metricsService.setOutboxPending(pending);
        this.metricsService.setOutboxFailed(failed);
      } catch (error) {
        this.logger.warn(`Outbox metrics polling failed: ${String(error)}`);
      }
    };

    void tick();
    this.outboxMetricsInterval = setInterval(() => void tick(), intervalMs);
  }
}

function parseWorkerRoles(
  value: string,
): Set<'consumer' | 'dispatcher' | 'maintenance'> {
  const roles = new Set<'consumer' | 'dispatcher' | 'maintenance'>();
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (
      part === 'consumer' ||
      part === 'dispatcher' ||
      part === 'maintenance'
    ) {
      roles.add(part);
      continue;
    }
  }

  // 默认启用 consumer（避免空字符串导致进程什么都不做）
  if (roles.size === 0) {
    roles.add('consumer');
  }

  return roles;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function parseJson(
  content: Buffer,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string } {
  const text = content.toString('utf8');
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      return { ok: false, reason: 'payload is not an object' };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: 'json parse failed' };
  }
}

function publishWithConfirm(
  channel: amqplib.ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: amqplib.Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, content, options, (err) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve();
    });
  });
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function computeBackoffMs(attempt: number): number {
  const safeAttempt = attempt <= 0 ? 1 : attempt;
  const base = 500;
  const cap = 60_000;
  const exp = Math.min(safeAttempt, 16);
  const delay = Math.min(cap, base * 2 ** (exp - 1));
  const jitter = Math.floor(Math.random() * Math.min(1_000, delay * 0.1));
  return delay + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseDefinitionRef(
  value: unknown,
): { definitionId: string; definitionHash: string } | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const definitionId = readNonEmptyString(value['definitionId']);
  const definitionHash = readNonEmptyString(value['definitionHash']);
  if (!definitionId) {
    return null;
  }
  if (!definitionHash) {
    return null;
  }
  return { definitionId, definitionHash };
}

function validateJobRequestedPayload(
  root: Record<string, unknown>,
  jobId: string,
  definitionRef: { definitionId: string; definitionHash: string },
):
  | { ok: true; payload: ComputeJobRequestedV1 }
  | { ok: false; reason: string; details?: unknown } {
  if (root['schemaVersion'] !== 1) {
    return {
      ok: false,
      reason: 'schemaVersion must be 1',
      details: { schemaVersion: root['schemaVersion'] },
    };
  }

  const inputs = root['inputs'];
  if (!isPlainObject(inputs)) {
    return {
      ok: false,
      reason: 'inputs must be an object',
    };
  }

  const options = root['options'];
  if (options !== undefined && !isPlainObject(options)) {
    return {
      ok: false,
      reason: 'options must be an object when provided',
    };
  }
  const optionsValue = isPlainObject(options) ? options : undefined;

  const entrypointKey = root['entrypointKey'];
  if (entrypointKey !== undefined && typeof entrypointKey !== 'string') {
    return {
      ok: false,
      reason: 'entrypointKey must be a string when provided',
    };
  }

  return {
    ok: true,
    payload: {
      schemaVersion: 1,
      jobId,
      definitionRef,
      entrypointKey:
        typeof entrypointKey === 'string' && entrypointKey.length > 0
          ? entrypointKey
          : undefined,
      inputs,
      options: optionsValue,
    },
  };
}

async function setupTopology(
  channel: amqplib.Channel,
  params: {
    commandsExchange: string;
    eventsExchange: string;
    dlxExchange: string;
    queueName: string;
    routingKey: string;
  },
) {
  const dlqRoutingKey = `${params.routingKey}.dlq`;
  const dlqQueue = `${params.queueName}.dlq`;

  await channel.assertExchange(params.commandsExchange, 'topic', {
    durable: true,
  });
  await channel.assertExchange(params.eventsExchange, 'topic', {
    durable: true,
  });
  await channel.assertExchange(params.dlxExchange, 'topic', {
    durable: true,
  });

  await channel.assertQueue(params.queueName, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': params.dlxExchange,
      'x-dead-letter-routing-key': dlqRoutingKey,
    },
  });
  await channel.bindQueue(
    params.queueName,
    params.commandsExchange,
    params.routingKey,
  );

  await channel.assertQueue(dlqQueue, { durable: true });
  await channel.bindQueue(dlqQueue, params.dlxExchange, dlqRoutingKey);
}

function safeAck(channel: amqplib.Channel, msg: ConsumeMessage) {
  try {
    channel.ack(msg);
  } catch {
    // ignore: channel may be closed during shutdown/reconnect
  }
}

function safeReject(
  channel: amqplib.Channel,
  msg: ConsumeMessage,
  requeue: boolean,
) {
  try {
    channel.reject(msg, requeue);
  } catch {
    // ignore: channel may be closed during shutdown/reconnect
  }
}

function safeNack(
  channel: amqplib.Channel,
  msg: ConsumeMessage,
  allUpTo: boolean,
  requeue: boolean,
) {
  try {
    channel.nack(msg, allUpTo, requeue);
  } catch {
    // ignore: channel may be closed during shutdown/reconnect
  }
}
