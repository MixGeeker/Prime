import type { JobRecord, NewJobRequested } from '../../domain/job/job';

export const JOB_REPOSITORY = Symbol('JobRepositoryPort');

/**
 * Job 仓储端口（outbound）。
 *
 * 用途：
 * - 以 `jobs.job_id` 作为幂等键（Compute Engine 必须写死）
 * - `requestHash` 用于检测“同 jobId 不同 payload”的冲突
 */
export type TryInsertJobResult =
  | { kind: 'inserted'; job: JobRecord }
  | { kind: 'duplicate'; job: JobRecord }
  | { kind: 'conflict'; job: JobRecord };

export interface JobRepositoryPort {
  getJob(jobId: string): Promise<JobRecord | null>;
  tryInsertRequested(params: NewJobRequested): Promise<TryInsertJobResult>;
  markRunning(jobId: string): Promise<void>;
  markSucceeded(params: {
    jobId: string;
    definitionHash: string;
    inputsHash: string;
    outputsHash: string;
    outputs: Record<string, unknown>;
    computedAt: Date;
    inputsSnapshot?: Record<string, unknown> | null;
  }): Promise<void>;
  markFailed(params: {
    jobId: string;
    definitionHash: string | null;
    inputsHash: string | null;
    errorCode: string;
    errorMessage: string;
    failedAt: Date;
  }): Promise<void>;

  /**
   * 清空旧 job 的大字段快照（inputs_snapshot_json / outputs_json），用于 retention。
   * - 不删除 jobs 记录（避免破坏幂等与追溯）
   * - 返回实际更新条数
   */
  clearSnapshotsOlderThan(params: {
    cutoff: Date;
    limit: number;
  }): Promise<number>;
}
