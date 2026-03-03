export type JobStatus = 'requested' | 'succeeded' | 'failed';

export type JobRequestedV1 = {
  schemaVersion: 1;
  jobId: string;
  definitionRef: { definitionId: string; definitionHash: string };
  entrypointKey?: string;
  inputs: Record<string, unknown>;
  options?: Record<string, unknown>;
};

export type JobSucceededV1 = {
  schemaVersion: 1;
  jobId: string;
  definitionRefUsed: { definitionId: string; definitionHash: string };
  inputsHash: string;
  outputs: Record<string, unknown>;
  outputsHash: string;
  computedAt: string;
};

export type JobFailedV1 = {
  schemaVersion: 1;
  jobId: string;
  definitionRefUsed: { definitionId: string; definitionHash: string };
  inputsHash?: string;
  error: { code: string; message: string; details?: unknown };
  retryable: boolean;
  failedAt: string;
};

export type StoredJob = {
  jobId: string;
  requestedAt: string;
  definitionRef: { definitionId: string; definitionHash: string };
  entrypointKey?: string;
  status: JobStatus;
  correlationId?: string | null;
  messageId?: string | null;
  payload: JobRequestedV1;
  result?: JobSucceededV1 | JobFailedV1;
  lastEvent?: {
    routingKey: string;
    receivedAt: string;
    eventMessageId?: string | null;
  };
};

export type StorageData = {
  schemaVersion: 1;
  updatedAt: string;
  globalFacts: Record<string, unknown>;
  jobs: Record<string, StoredJob>;
  processedEventMessageIds: Record<string, true>;
};

