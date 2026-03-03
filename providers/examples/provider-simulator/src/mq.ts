import * as amqplib from 'amqplib';
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { JobFailedV1, JobRequestedV1, JobSucceededV1 } from './types';
import { Storage } from './storage';

const SUCCEEDED_KEY = 'compute.job.succeeded.v1';
const FAILED_KEY = 'compute.job.failed.v1';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toErrorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export class MqClient {
  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private consumeChannel: Channel | null = null;
  private stopping = false;

  constructor(
    private readonly params: {
      rabbitUrl: string;
      commandsExchange: string;
      eventsExchange: string;
      jobRequestedRoutingKey: string;
      resultsQueue: string;
      prefetch: number;
    },
    private readonly storage: Storage,
  ) {}

  async start() {
    this.stopping = false;
    void this.runMainLoop();
  }

  async stop() {
    this.stopping = true;
    await this.teardown('stop');
  }

  isConnected() {
    return Boolean(this.connection && this.publishChannel && this.consumeChannel);
  }

  async publishJob(job: JobRequestedV1, props?: { messageId?: string; correlationId?: string }) {
    const ch = this.publishChannel;
    if (!ch) {
      throw new Error('MQ not connected');
    }

    const payload = Buffer.from(JSON.stringify(job), 'utf8');
    const ok = ch.publish(
      this.params.commandsExchange,
      this.params.jobRequestedRoutingKey,
      payload,
      {
        persistent: true,
        contentType: 'application/json',
        type: this.params.jobRequestedRoutingKey,
        messageId: props?.messageId,
        correlationId: props?.correlationId,
        headers: { schemaVersion: 1 },
        timestamp: Math.floor(Date.now() / 1000),
      },
      // callback for confirm channel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_err: any) => {},
    );

    if (!ok) {
      // backpressure：等待 drain
      await new Promise<void>((resolve) => ch.once('drain', () => resolve()));
    }

    await ch.waitForConfirms();
  }

  private async runMainLoop() {
    let attempt = 0;
    while (!this.stopping) {
      attempt++;
      try {
        await this.connectAndRun();
        attempt = 0;
      } catch (error) {
        const backoff = Math.min(30_000, 500 * 2 ** Math.min(8, attempt));
        // eslint-disable-next-line no-console
        console.warn(`[provider-simulator] MQ loop error: ${toErrorText(error)}; retry in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }

  private async connectAndRun() {
    const conn = await amqplib.connect(this.params.rabbitUrl);
    this.connection = conn;

    conn.on('error', (err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[provider-simulator] MQ connection error: ${toErrorText(err)}`);
    });

    const closed = new Promise<void>((resolve) => conn.once('close', () => resolve()));

    // 1) publish channel
    const pub = await conn.createConfirmChannel();
    this.publishChannel = pub;
    await pub.assertExchange(this.params.commandsExchange, 'topic', { durable: true });

    // 2) consume channel
    const ch = await conn.createChannel();
    this.consumeChannel = ch;
    await ch.assertExchange(this.params.eventsExchange, 'topic', { durable: true });
    await ch.assertQueue(this.params.resultsQueue, { durable: true });
    await ch.bindQueue(this.params.resultsQueue, this.params.eventsExchange, SUCCEEDED_KEY);
    await ch.bindQueue(this.params.resultsQueue, this.params.eventsExchange, FAILED_KEY);
    await ch.prefetch(this.params.prefetch);

    await ch.consume(
      this.params.resultsQueue,
      (msg: ConsumeMessage | null) => void this.onMessage(msg),
      { noAck: false },
    );

    // eslint-disable-next-line no-console
    console.log('[provider-simulator] MQ connected');

    await closed;
    await this.teardown('connection_closed');
    throw new Error('mq connection closed');
  }

  private async teardown(reason: string) {
    const conn = this.connection;
    const pub = this.publishChannel;
    const ch = this.consumeChannel;

    this.connection = null;
    this.publishChannel = null;
    this.consumeChannel = null;

    try {
      await ch?.close();
    } catch {}
    try {
      await pub?.close();
    } catch {}
    try {
      await conn?.close();
    } catch {}

    // eslint-disable-next-line no-console
    console.log(`[provider-simulator] MQ teardown: ${reason}`);
  }

  private async onMessage(msg: ConsumeMessage | null) {
    if (!msg || !this.consumeChannel) return;

    const eventMessageId =
      typeof msg.properties.messageId === 'string' ? msg.properties.messageId : null;
    if (eventMessageId && this.storage.hasProcessedEvent(eventMessageId)) {
      this.consumeChannel.ack(msg);
      return;
    }

    const routingKey = msg.fields.routingKey;
    const text = msg.content.toString('utf8');

    try {
      const parsed = JSON.parse(text) as unknown;
      const receivedAt = new Date().toISOString();

      if (routingKey === SUCCEEDED_KEY) {
        const payload = parsed as JobSucceededV1;
        const existing = this.storage.getJob(payload.jobId);
        if (existing) {
          existing.status = 'succeeded';
          existing.result = payload;
          existing.lastEvent = { routingKey, receivedAt, eventMessageId };
          await this.storage.upsertJob(existing);
        }
      } else if (routingKey === FAILED_KEY) {
        const payload = parsed as JobFailedV1;
        const existing = this.storage.getJob(payload.jobId);
        if (existing) {
          existing.status = 'failed';
          existing.result = payload;
          existing.lastEvent = { routingKey, receivedAt, eventMessageId };
          await this.storage.upsertJob(existing);
        }
      }

      if (eventMessageId) {
        await this.storage.markEventProcessed(eventMessageId);
      }

      this.consumeChannel.ack(msg);
    } catch (error) {
      // 解析失败：丢回队列，避免吞消息
      // eslint-disable-next-line no-console
      console.warn(`[provider-simulator] event parse failed: ${toErrorText(error)}`);
      this.consumeChannel.nack(msg, false, true);
    }
  }
}
