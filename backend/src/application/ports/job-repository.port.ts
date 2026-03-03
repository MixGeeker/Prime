import type {
  JobRecord,
  JobStatus,
  NewJobRequested,
} from '../../domain/job/job';

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

  /**
   * 列表查询（用于 Admin UI / 运维面板）。
   *
   * 约束：
   * - 默认只返回摘要字段（不返回 inputsSnapshot/outputs 大字段）
   * - 按 requestedAt DESC, jobId DESC 排序，用 cursor 做翻页
   */
  listJobs(params: ListJobsParams): Promise<JobListItem[]>;

  /** 按 status 聚合统计（用于 Ops/仪表盘）。 */
  countByStatus(params?: { since?: Date | null }): Promise<JobStatusCount[]>;

  tryInsertRequested(params: NewJobRequested): Promise<TryInsertJobResult>;
  markRunning(jobId: string): Promise<void>;
  markSucceeded(params: {
    jobId: string;
    inputsHash: string;
    outputsHash: string;
    outputs: Record<string, unknown>;
    computedAt: Date;
    inputsSnapshot?: Record<string, unknown> | null;
  }): Promise<void>;
  markFailed(params: {
    jobId: string;
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

export interface JobListItem {
  jobId: string;
  messageId: string | null;
  correlationId: string | null;
  definitionId: string;
  definitionHashUsed: string;
  inputsHash: string | null;
  outputsHash: string | null;
  status: JobStatus;
  requestedAt: Date;
  computedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface JobListCursor {
  requestedAt: Date;
  jobId: string;
}

export interface ListJobsParams {
  limit: number;
  cursor?: JobListCursor | null;
  status?: JobStatus | null;
  definitionId?: string | null;
  definitionHashUsed?: string | null;
  since?: Date | null;
  until?: Date | null;
}

export interface JobStatusCount {
  status: JobStatus;
  count: number;
}
