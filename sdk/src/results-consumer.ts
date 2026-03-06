import * as amqplib from 'amqplib';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { MemoryDedupeStore } from './dedupe-stores.js';
import type {
  ComputeSdkConfig,
  DedupeStore,
  JobFailedV1,
  JobSucceededV1,
  ResultsConsumerOptions,
  ResultsEnvelope,
} from './types.js';

export class ComputeResultsConsumer {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private readonly dedupeStore: DedupeStore;

  constructor(
    private readonly sdkConfig: Required<Pick<ComputeSdkConfig, 'rabbitUrl' | 'eventsExchange' | 'succeededRoutingKey' | 'failedRoutingKey' | 'prefetch'>> & {
      resultsQueue?: string;
    },
    private readonly options: ResultsConsumerOptions,
  ) {
    this.dedupeStore = options.dedupeStore ?? new MemoryDedupeStore();
  }

  async start(): Promise<void> {
    if (this.channel) return;

    const queueName = this.options.resultsQueue ?? this.sdkConfig.resultsQueue;
    if (!queueName) {
      throw new Error('resultsQueue is required to consume compute results');
    }

    const conn = await amqplib.connect(this.sdkConfig.rabbitUrl);
    const ch = await conn.createChannel();
    await ch.assertExchange(this.sdkConfig.eventsExchange, 'topic', { durable: true });
    await ch.assertQueue(queueName, { durable: true });
    await ch.bindQueue(queueName, this.sdkConfig.eventsExchange, this.sdkConfig.succeededRoutingKey);
    await ch.bindQueue(queueName, this.sdkConfig.eventsExchange, this.sdkConfig.failedRoutingKey);
    await ch.prefetch(this.options.prefetch ?? this.sdkConfig.prefetch);

    const consumeResult = await ch.consume(queueName, (msg) => void this.onMessage(msg), { noAck: false });

    this.connection = conn;
    this.channel = ch;
    this.consumerTag = consumeResult.consumerTag;
  }

  async stop(): Promise<void> {
    if (this.channel && this.consumerTag) {
      try {
        await this.channel.cancel(this.consumerTag);
      } catch {}
    }

    try {
      await this.channel?.close();
    } catch {}
    try {
      await this.connection?.close();
    } catch {}
    try {
      await this.dedupeStore.close?.();
    } catch {}

    this.consumerTag = null;
    this.channel = null;
    this.connection = null;
  }

  private async onMessage(message: ConsumeMessage | null) {
    if (!message || !this.channel) return;

    const messageId =
      typeof message.properties.messageId === 'string' ? message.properties.messageId : null;
    if (messageId && (await this.dedupeStore.has(messageId))) {
      this.channel.ack(message);
      return;
    }

    try {
      const routingKey = message.fields.routingKey;
      const parsed = JSON.parse(message.content.toString('utf8')) as JobSucceededV1 | JobFailedV1;
      const envelope: ResultsEnvelope<JobSucceededV1 | JobFailedV1> = {
        payload: parsed,
        routingKey,
        messageId,
        correlationId:
          typeof message.properties.correlationId === 'string'
            ? message.properties.correlationId
            : null,
        receivedAt: new Date().toISOString(),
        rawMessage: message,
      };

      await this.options.onMessage?.(envelope);
      if (routingKey === this.sdkConfig.succeededRoutingKey) {
        await this.options.onSucceeded?.(envelope as ResultsEnvelope<JobSucceededV1>);
      }
      if (routingKey === this.sdkConfig.failedRoutingKey) {
        await this.options.onFailed?.(envelope as ResultsEnvelope<JobFailedV1>);
      }

      if (messageId) {
        await this.dedupeStore.mark(messageId);
      }
      this.channel.ack(message);
    } catch {
      const requeue = this.options.requeueOnHandlerError ?? true;
      this.channel.nack(message, false, requeue);
    }
  }
}
