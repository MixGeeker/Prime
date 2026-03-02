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

  private connection: amqplib.ChannelModel | null = null;
  private consumerChannel: amqplib.Channel | null = null;
  private consumerTag: string | null = null;
  private dispatcherChannel: amqplib.ConfirmChannel | null = null;
  private dispatcherStop = false;
  private dispatcherPromise: Promise<void> | null = null;

  private readonly instanceId = `${hostname()}:${process.pid}`;

  constructor(
    private readonly configService: ConfigService,
    private readonly executeJobUseCase: ExecuteJobUseCase,
    private readonly failInvalidJobMessageUseCase: FailInvalidJobMessageUseCase,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepositoryPort,
  ) {}

  async onModuleInit() {
    const roles = parseWorkerRoles(
      this.configService.get<string>('WORKER_ROLES') ?? 'consumer,dispatcher',
    );

    const enableConsumer = roles.has('consumer');
    const enableDispatcher = roles.has('dispatcher');

    if (!enableConsumer && !enableDispatcher) {
      this.logger.log('Worker has no roles enabled; exiting.');
      return;
    }

    const rabbitUrl = this.configService.get<string>('RABBITMQ_URL');
    if (!rabbitUrl) {
      throw new Error('RABBITMQ_URL is required for worker');
    }

    this.connection = await amqplib.connect(rabbitUrl);

    const commandsExchange =
      this.configService.get<string>('MQ_COMMANDS_EXCHANGE') ??
      'compute.commands';
    const eventsExchange =
      this.configService.get<string>('MQ_EVENTS_EXCHANGE') ?? 'compute.events';
    const dlxExchange =
      this.configService.get<string>('MQ_DLX_EXCHANGE') ?? 'compute.dlx';
    const queueName =
      this.configService.get<string>('MQ_JOB_REQUESTED_QUEUE') ??
      'compute.job.requested.v1';

    if (enableConsumer) {
      this.consumerChannel = await this.connection.createChannel();
      await setupTopology(this.consumerChannel, {
        commandsExchange,
        eventsExchange,
        dlxExchange,
        queueName,
        routingKey: JOB_REQUESTED_ROUTING_KEY,
      });

      const prefetch = this.configService.get<number>('MQ_PREFETCH') ?? 10;
      await this.consumerChannel.prefetch(prefetch);

      const consumeOk = await this.consumerChannel.consume(
        queueName,
        (msg) => void this.handleMessage(msg),
        { noAck: false },
      );
      this.consumerTag = consumeOk.consumerTag;

      this.logger.log(
        `RabbitMQ consumer started: queue=${queueName}, routingKey=${JOB_REQUESTED_ROUTING_KEY}, prefetch=${prefetch}`,
      );
    } else {
      this.logger.log('Worker role consumer disabled.');
    }

    if (enableDispatcher) {
      this.dispatcherChannel = await this.connection.createConfirmChannel();
      await this.dispatcherChannel.assertExchange(eventsExchange, 'topic', {
        durable: true,
      });
      this.startDispatcher(eventsExchange);
    } else {
      this.logger.log('Worker role dispatcher disabled.');
    }
  }

  async onModuleDestroy() {
    this.dispatcherStop = true;
    try {
      await this.dispatcherPromise;
    } catch (error) {
      this.logger.warn(`Dispatcher stopped with error: ${String(error)}`);
    }

    try {
      if (this.consumerChannel && this.consumerTag) {
        await this.consumerChannel.cancel(this.consumerTag);
      }
    } catch (error) {
      this.logger.warn(`Failed to cancel consumer: ${String(error)}`);
    }

    try {
      await this.consumerChannel?.close();
    } catch (error) {
      this.logger.warn(`Failed to close channel: ${String(error)}`);
    }

    try {
      await this.dispatcherChannel?.close();
    } catch (error) {
      this.logger.warn(`Failed to close dispatcher channel: ${String(error)}`);
    }

    try {
      await this.connection?.close();
    } catch (error) {
      this.logger.warn(`Failed to close connection: ${String(error)}`);
    }
  }

  private async handleMessage(msg: ConsumeMessage | null) {
    if (!msg || !this.consumerChannel) {
      return;
    }

    try {
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
        this.logger.warn(`Invalid JSON message, send to DLQ: ${parsed.reason}`);
        this.consumerChannel.reject(msg, false);
        return;
      }

      const root = parsed.value;
      const jobId = readNonEmptyString(root['jobId']);
      if (!jobId) {
        this.logger.warn('Missing jobId, send to DLQ');
        this.consumerChannel.reject(msg, false);
        return;
      }

      const definitionRef = parseDefinitionRef(root['definitionRef']);
      if (!definitionRef) {
        this.logger.warn(`Invalid definitionRef, send to DLQ: jobId=${jobId}`);
        this.consumerChannel.reject(msg, false);
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
          );
          this.consumerChannel.reject(msg, false);
          return;
        }

        this.consumerChannel.ack(msg);
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
        );
        this.consumerChannel.reject(msg, false);
        return;
      }

      this.consumerChannel.ack(msg);
    } catch (error) {
      this.logger.error(
        `Unhandled error while handling message, nack(requeue=true): ${String(error)}`,
      );
      this.consumerChannel.nack(msg, false, true);
    }
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

      await this.outboxRepository.markSent({
        id: record.id,
        lockedBy: this.instanceId,
        now,
      });
    } catch (error) {
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
}

function parseWorkerRoles(value: string): Set<'consumer' | 'dispatcher'> {
  const roles = new Set<'consumer' | 'dispatcher'>();
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part === 'consumer' || part === 'dispatcher') {
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
): { definitionId: string; version: number } | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const definitionId = readNonEmptyString(value['definitionId']);
  const version = value['version'];
  if (!definitionId) {
    return null;
  }
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version <= 0
  ) {
    return null;
  }
  return { definitionId, version };
}

function validateJobRequestedPayload(
  root: Record<string, unknown>,
  jobId: string,
  definitionRef: { definitionId: string; version: number },
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

  return {
    ok: true,
    payload: {
      schemaVersion: 1,
      jobId,
      definitionRef,
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
