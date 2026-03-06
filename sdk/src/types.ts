import type { ConsumeMessage, Options } from 'amqplib';

export interface DefinitionRef {
  definitionId: string;
  definitionHash: string;
}

export interface JobRequestedV1 {
  schemaVersion: 1;
  jobId: string;
  definitionRef: DefinitionRef;
  entrypointKey?: string;
  inputs: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface JobSucceededV1 {
  schemaVersion: 1;
  jobId: string;
  definitionRefUsed: DefinitionRef;
  inputsHash: string;
  outputs: Record<string, unknown>;
  outputsHash: string;
  computedAt: string;
}

export interface JobFailedV1 {
  schemaVersion: 1;
  jobId: string;
  definitionRefUsed: DefinitionRef;
  inputsHash?: string;
  error: { code: string; message: string; details?: unknown };
  retryable: boolean;
  failedAt: string;
}

export interface ComputeSdkConfig {
  rabbitUrl: string;
  commandsExchange?: string;
  eventsExchange?: string;
  jobRequestedRoutingKey?: string;
  succeededRoutingKey?: string;
  failedRoutingKey?: string;
  resultsQueue?: string;
  prefetch?: number;
  jobIdFactory?: () => string;
}

export interface SendJobParams {
  definitionRef: DefinitionRef;
  inputs: Record<string, unknown>;
  options?: Record<string, unknown>;
  jobId?: string;
  correlationId?: string;
  entrypointKey?: string;
  messageId?: string;
  headers?: Record<string, unknown>;
  persistent?: boolean;
  publishOptions?: Omit<Options.Publish, 'messageId' | 'correlationId' | 'headers' | 'persistent' | 'contentType' | 'type'>;
}

export interface SendJobResult {
  jobId: string;
  messageId: string;
  correlationId: string;
  payload: JobRequestedV1;
}

export interface ResultsEnvelope<TPayload> {
  payload: TPayload;
  routingKey: string;
  messageId: string | null;
  correlationId: string | null;
  receivedAt: string;
  rawMessage: ConsumeMessage;
}

export interface ResultsConsumerOptions {
  resultsQueue?: string;
  prefetch?: number;
  requeueOnHandlerError?: boolean;
  dedupeStore?: DedupeStore;
  onMessage?: (message: ResultsEnvelope<JobSucceededV1 | JobFailedV1>) => Promise<void> | void;
  onSucceeded?: (message: ResultsEnvelope<JobSucceededV1>) => Promise<void> | void;
  onFailed?: (message: ResultsEnvelope<JobFailedV1>) => Promise<void> | void;
}

export interface DedupeStore {
  has(messageId: string): Promise<boolean>;
  mark(messageId: string): Promise<void>;
  close?(): Promise<void>;
}

export type ModuleResolver<TContext> =
  | ((context: TContext) => Record<string, unknown> | null | undefined)
  | ((context: TContext) => Promise<Record<string, unknown> | null | undefined>);

export interface InputsBuilderOptions {
  conflictStrategy?: 'throw' | 'overwrite';
}
