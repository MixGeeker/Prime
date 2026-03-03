/**
 * Admin DLQ 运维接口（危险端点）。
 *
 * 职责：
 * - 查看 `compute.job.requested.v1` 对应 DLQ 队列的统计信息
 * - 将 DLQ 消息按限速/限量回放（replay）或仅演练（dry-run）
 *
 * 安全：受 `ADMIN_DANGEROUS_ENDPOINTS_ENABLED` + `ADMIN_API_TOKEN` 控制。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import * as amqplib from 'amqplib';
import type { GetMessage } from 'amqplib';
import { DlqReplayRequestDto } from './dlq.dto';

const JOB_REQUESTED_ROUTING_KEY = 'compute.job.requested.v1';

@Controller('/admin/dlq/job-requested')
@ApiTags('admin')
export class AdminDlqJobRequestedController {
  constructor(private readonly configService: ConfigService) {}

  @Get('stats')
  async stats(@Headers('authorization') authorization?: string) {
    this.assertDangerousAuthorized(authorization);

    const rabbitUrl = this.configService.get<string>('RABBITMQ_URL');
    if (!rabbitUrl) {
      throw new ServiceUnavailableException({
        code: 'RABBITMQ_NOT_CONFIGURED',
        message: 'RABBITMQ_URL is required for DLQ operations',
      });
    }

    const queueName =
      this.configService.get<string>('MQ_JOB_REQUESTED_QUEUE') ??
      'compute.job.requested.v1';
    const dlqQueue = `${queueName}.dlq`;

    const connection = await amqplib.connect(rabbitUrl);
    try {
      const channel = await connection.createChannel();
      try {
        const ok = await channel.checkQueue(dlqQueue);
        return {
          dlqQueue: ok.queue,
          messageCount: ok.messageCount,
          consumerCount: ok.consumerCount,
        };
      } finally {
        await channel.close();
      }
    } finally {
      await connection.close();
    }
  }

  @Post('replay')
  async replay(
    @Body() body: DlqReplayRequestDto,
    @Headers('authorization') authorization?: string,
  ) {
    this.assertDangerousAuthorized(authorization);

    const rabbitUrl = this.configService.get<string>('RABBITMQ_URL');
    if (!rabbitUrl) {
      throw new ServiceUnavailableException({
        code: 'RABBITMQ_NOT_CONFIGURED',
        message: 'RABBITMQ_URL is required for DLQ operations',
      });
    }

    const requestedLimit = body.limit ?? 50;
    const maxLimit =
      this.configService.get<number>('DLQ_REPLAY_MAX_LIMIT') ?? 200;
    const limit = Math.min(requestedLimit, maxLimit);

    const dryRun = body.dryRun ?? false;
    const minIntervalMs = body.minIntervalMs ?? 0;

    const maxBytes =
      this.configService.get<number>('MQ_MAX_MESSAGE_BYTES') ?? 1_000_000;

    const commandsExchange =
      this.configService.get<string>('MQ_COMMANDS_EXCHANGE') ??
      'compute.commands';
    const queueName =
      this.configService.get<string>('MQ_JOB_REQUESTED_QUEUE') ??
      'compute.job.requested.v1';
    const dlqQueue = `${queueName}.dlq`;

    const connection = await amqplib.connect(rabbitUrl);
    const channel = await connection.createConfirmChannel();

    const heldMessages: GetMessage[] = [];
    const items: Array<{
      messageId?: string;
      correlationId?: string;
      jobId?: string;
      bytes: number;
    }> = [];

    let processed = 0;

    try {
      await channel.assertExchange(commandsExchange, 'topic', {
        durable: true,
      });

      for (let i = 0; i < limit; i++) {
        const msg = await channel.get(dlqQueue, { noAck: false });
        if (!msg) {
          break;
        }

        if (msg.content.length > maxBytes) {
          channel.nack(msg, false, true);
          throw new BadRequestException({
            code: 'MQ_MESSAGE_TOO_LARGE',
            message: `DLQ message too large: size=${msg.content.length} max=${maxBytes}`,
          });
        }

        const jobId = tryReadJobId(msg);
        items.push({
          messageId:
            typeof msg.properties.messageId === 'string'
              ? msg.properties.messageId
              : undefined,
          correlationId:
            typeof msg.properties.correlationId === 'string'
              ? msg.properties.correlationId
              : undefined,
          jobId,
          bytes: msg.content.length,
        });

        if (dryRun) {
          heldMessages.push(msg);
          processed++;
          continue;
        }

        const ok = await publishWithConfirm(
          channel,
          commandsExchange,
          JOB_REQUESTED_ROUTING_KEY,
          msg,
        );
        if (!ok) {
          channel.nack(msg, false, true);
          throw new Error('publish confirm failed');
        }

        channel.ack(msg);
        processed++;

        if (minIntervalMs > 0) {
          await sleep(minIntervalMs);
        }
      }

      if (dryRun) {
        for (const msg of heldMessages) {
          channel.nack(msg, false, true);
        }
      }

      return {
        mode: dryRun ? 'dry_run' : 'replay',
        requestedLimit,
        limit,
        processed,
        items,
      };
    } finally {
      await channel.close();
      await connection.close();
    }
  }

  private assertDangerousAuthorized(authorization?: string) {
    const enabled =
      this.configService.get<boolean>('ADMIN_DANGEROUS_ENDPOINTS_ENABLED') ??
      false;
    if (!enabled) {
      throw new ForbiddenException({
        code: 'ADMIN_DANGEROUS_ENDPOINTS_DISABLED',
        message: 'dangerous admin endpoints are disabled',
      });
    }

    const token = this.configService.get<string>('ADMIN_API_TOKEN') ?? '';
    if (!token) {
      throw new ForbiddenException({
        code: 'ADMIN_TOKEN_NOT_CONFIGURED',
        message: 'ADMIN_API_TOKEN is required for dangerous endpoints',
      });
    }

    const expected = `Bearer ${token}`;
    if (authorization !== expected) {
      throw new ForbiddenException({
        code: 'ADMIN_UNAUTHORIZED',
        message: 'invalid admin token',
      });
    }
  }
}

function tryReadJobId(msg: GetMessage): string | undefined {
  try {
    const text = msg.content.toString('utf8');
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      return undefined;
    }
    return typeof parsed['jobId'] === 'string' ? parsed['jobId'] : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function publishWithConfirm(
  channel: amqplib.ConfirmChannel,
  exchange: string,
  routingKey: string,
  msg: GetMessage,
): Promise<boolean> {
  const publishOptions: amqplib.Options.Publish = {
    persistent: true,
    contentType:
      typeof msg.properties.contentType === 'string'
        ? msg.properties.contentType
        : 'application/json',
    type:
      typeof msg.properties.type === 'string' ? msg.properties.type : undefined,
    messageId:
      typeof msg.properties.messageId === 'string'
        ? msg.properties.messageId
        : undefined,
    correlationId:
      typeof msg.properties.correlationId === 'string'
        ? msg.properties.correlationId
        : undefined,
    headers: msg.properties.headers ?? {},
    timestamp: Math.floor(Date.now() / 1000),
  };

  return new Promise((resolve) => {
    channel.publish(
      exchange,
      routingKey,
      msg.content,
      publishOptions,
      (err) => {
        if (err) {
          resolve(false);
          return;
        }
        resolve(true);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
