export type JobStatus = 'requested' | 'running' | 'succeeded' | 'failed';

/**
 * JobRecord：jobs 表的领域视图（用于 application/query）。
 *
 * 说明：
 * - `jobId` 是幂等键（必须写死）
 * - `requestHash` 用于检测“同 jobId 不同 payload”
 * - inputs/outputs 快照在 MVP 阶段可不落（字段保留为 null）
 */
export interface JobRecord {
  jobId: string;
  requestHash: string;
  messageId: string | null;
  correlationId: string | null;
  definitionId: string;
  versionUsed: number;
  definitionHash: string | null;
  inputsHash: string | null;
  outputsHash: string | null;
  status: JobStatus;
  requestedAt: Date;
  computedAt: Date | null;
  failedAt: Date | null;
  inputsSnapshot: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface NewJobRequested {
  jobId: string;
  requestHash: string;
  messageId: string | null;
  correlationId: string | null;
  definitionId: string;
  versionUsed: number;
}
