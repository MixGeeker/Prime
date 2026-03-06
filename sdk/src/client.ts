import * as amqplib from 'amqplib';
import type { ChannelModel, ConfirmChannel, Options } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { InputsBuilder } from './inputs-builder.js';
import { ComputeResultsConsumer } from './results-consumer.js';
import type {
  ComputeSdkConfig,
  JobRequestedV1,
  ResultsConsumerOptions,
  SendJobParams,
  SendJobResult,
} from './types.js';

export class ComputeSdk {
  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;

  private readonly commandsExchange: string;
  private readonly eventsExchange: string;
  private readonly jobRequestedRoutingKey: string;
  private readonly succeededRoutingKey: string;
  private readonly failedRoutingKey: string;
  private readonly prefetch: number;

  constructor(private readonly config: ComputeSdkConfig) {
    this.commandsExchange = config.commandsExchange ?? 'compute.commands';
    this.eventsExchange = config.eventsExchange ?? 'compute.events';
    this.jobRequestedRoutingKey = config.jobRequestedRoutingKey ?? 'compute.job.requested.v1';
    this.succeededRoutingKey = config.succeededRoutingKey ?? 'compute.job.succeeded.v1';
    this.failedRoutingKey = config.failedRoutingKey ?? 'compute.job.failed.v1';
    this.prefetch = config.prefetch ?? 10;
  }

  createInputsBuilder<TContext>(options?: { conflictStrategy?: 'throw' | 'overwrite' }) {
    return new InputsBuilder<TContext>(options);
  }

  createResultsConsumer(options: ResultsConsumerOptions) {
    return new ComputeResultsConsumer(
      {
        rabbitUrl: this.config.rabbitUrl,
        eventsExchange: this.eventsExchange,
        succeededRoutingKey: this.succeededRoutingKey,
        failedRoutingKey: this.failedRoutingKey,
        prefetch: this.prefetch,
        resultsQueue: this.config.resultsQueue,
      },
      options,
    );
  }

  async sendJob(params: SendJobParams): Promise<SendJobResult> {
    if (!isPlainObject(params.inputs)) {
      throw new Error('inputs must be an object');
    }

    const jobId = params.jobId ?? this.config.jobIdFactory?.() ?? randomUUID();
    const messageId = params.messageId ?? jobId;
    const correlationId = params.correlationId ?? jobId;

    const payload: JobRequestedV1 = {
      schemaVersion: 1,
      jobId,
      definitionRef: params.definitionRef,
      entrypointKey: params.entrypointKey,
      inputs: params.inputs,
      options: params.options,
    };

    const content = Buffer.from(JSON.stringify(payload), 'utf8');
    const channel = await this.ensurePublishChannel();
    const publishOptions: Options.Publish = {
      persistent: params.persistent ?? true,
      contentType: 'application/json',
      type: this.jobRequestedRoutingKey,
      messageId,
      correlationId,
      headers: {
        schemaVersion: 1,
        ...(params.headers ?? {}),
      },
      timestamp: Math.floor(Date.now() / 1000),
      ...(params.publishOptions ?? {}),
    };

    const ok = channel.publish(this.commandsExchange, this.jobRequestedRoutingKey, content, publishOptions);
    if (!ok) {
      await new Promise<void>((resolve) => channel.once('drain', () => resolve()));
    }
    await channel.waitForConfirms();

    return {
      jobId,
      messageId,
      correlationId,
      payload,
    };
  }

  async close(): Promise<void> {
    try {
      await this.publishChannel?.close();
    } catch {}
    try {
      await this.connection?.close();
    } catch {}

    this.publishChannel = null;
    this.connection = null;
  }

  private async ensurePublishChannel(): Promise<ConfirmChannel> {
    if (this.publishChannel) {
      return this.publishChannel;
    }

    if (!this.connection) {
      this.connection = await amqplib.connect(this.config.rabbitUrl);
      this.connection.on('close', () => {
        this.connection = null;
        this.publishChannel = null;
      });
      this.connection.on('error', () => {
        this.connection = null;
        this.publishChannel = null;
      });
    }

    const channel = await this.connection.createConfirmChannel();
    await channel.assertExchange(this.commandsExchange, 'topic', { durable: true });
    this.publishChannel = channel;
    return channel;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

export function createComputeSdk(config: ComputeSdkConfig) {
  return new ComputeSdk(config);
}
