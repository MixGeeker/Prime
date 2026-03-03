import type { EntityManager } from 'typeorm';
import type {
  JobListItem,
  JobStatusCount,
  JobRepositoryPort,
  ListJobsParams,
  TryInsertJobResult,
} from '../../../../../application/ports/job-repository.port';
import type { JobRecord, NewJobRequested } from '../../../../../domain/job/job';
import { JobEntity } from '../entities/job.entity';

/**
 * JobRepo 的 TypeORM 实现（PostgreSQL）。
 *
 * 重点：
 * - `job_id` 是幂等键：`INSERT ... ON CONFLICT DO NOTHING`
 * - 若已存在记录但 `request_hash` 不同，则判定为幂等冲突（同 jobId 不同 payload）
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function mapJob(row: JobEntity): JobRecord {
  return {
    jobId: row.jobId,
    requestHash: row.requestHash,
    messageId: row.messageId ?? null,
    correlationId: row.correlationId ?? null,
    definitionId: row.definitionId,
    definitionHashUsed: row.definitionHashUsed,
    inputsHash: row.inputsHash ?? null,
    outputsHash: row.outputsHash ?? null,
    status: row.status as JobRecord['status'],
    requestedAt: row.requestedAt,
    computedAt: row.computedAt ?? null,
    failedAt: row.failedAt ?? null,
    inputsSnapshot: row.inputsSnapshotJson ?? null,
    outputs: row.outputsJson ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
  };
}

export class TypeOrmJobRepository implements JobRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async getJob(jobId: string): Promise<JobRecord | null> {
    const row = await this.manager
      .getRepository(JobEntity)
      .findOne({ where: { jobId } });
    return row ? mapJob(row) : null;
  }

  async listJobs(params: ListJobsParams): Promise<JobListItem[]> {
    const limit = Math.max(1, Math.min(params.limit, 500));

    const status = params.status ?? null;
    const definitionId = params.definitionId ?? null;
    const definitionHashUsed = params.definitionHashUsed ?? null;
    const since = params.since ?? null;
    const until = params.until ?? null;

    const cursorRequestedAt = params.cursor?.requestedAt ?? null;
    const cursorJobId = params.cursor?.jobId ?? null;

    type Row = {
      job_id: string;
      message_id: string | null;
      correlation_id: string | null;
      definition_id: string;
      definition_hash_used: string;
      inputs_hash: string | null;
      outputs_hash: string | null;
      status: string;
      requested_at: Date;
      computed_at: Date | null;
      failed_at: Date | null;
      error_code: string | null;
      error_message: string | null;
    };

    const rows: unknown = await this.manager.query(
      `
        WITH rows AS (
          SELECT
            job_id,
            message_id,
            correlation_id,
            definition_id,
            definition_hash_used,
            inputs_hash,
            outputs_hash,
            status,
            requested_at,
            computed_at,
            failed_at,
            error_code,
            error_message
          FROM jobs
          WHERE ($1::text IS NULL OR status = $1)
            AND ($2::text IS NULL OR definition_id = $2)
            AND ($3::text IS NULL OR definition_hash_used = $3)
            AND ($4::timestamptz IS NULL OR requested_at >= $4)
            AND ($5::timestamptz IS NULL OR requested_at < $5)
        )
        SELECT *
        FROM rows
        WHERE (
          $6::timestamptz IS NULL
          OR requested_at < $6
          OR (requested_at = $6 AND job_id < $7)
        )
        ORDER BY requested_at DESC, job_id DESC
        LIMIT $8
      `,
      [
        status,
        definitionId,
        definitionHashUsed,
        since,
        until,
        cursorRequestedAt,
        cursorJobId,
        limit,
      ],
    );

    if (!Array.isArray(rows)) {
      return [];
    }

    return (rows as Row[]).map((r) => ({
      jobId: r.job_id,
      messageId: r.message_id ?? null,
      correlationId: r.correlation_id ?? null,
      definitionId: r.definition_id,
      definitionHashUsed: r.definition_hash_used,
      inputsHash: r.inputs_hash ?? null,
      outputsHash: r.outputs_hash ?? null,
      status: r.status as JobListItem['status'],
      requestedAt: r.requested_at,
      computedAt: r.computed_at ?? null,
      failedAt: r.failed_at ?? null,
      errorCode: r.error_code ?? null,
      errorMessage: r.error_message ?? null,
    }));
  }

  async countByStatus(params?: {
    since?: Date | null;
  }): Promise<JobStatusCount[]> {
    const since = params?.since ?? null;
    type Row = { status: string; count: string | number };
    const rows: unknown = await this.manager.query(
      `
        SELECT status, COUNT(*)::text AS count
        FROM jobs
        WHERE ($1::timestamptz IS NULL OR requested_at >= $1)
        GROUP BY status
      `,
      [since],
    );

    if (!Array.isArray(rows)) {
      return [];
    }

    return (rows as Row[]).map((r) => ({
      status: r.status as JobStatusCount['status'],
      count: typeof r.count === 'string' ? Number(r.count) : Number(r.count),
    }));
  }

  async tryInsertRequested(
    params: NewJobRequested,
  ): Promise<TryInsertJobResult> {
    // 尝试插入幂等存根；若已存在则不会插入（由 request_hash 决定 duplicate/conflict）。
    const insertedRows: unknown = await this.manager.query(
      `
        INSERT INTO jobs (
          job_id,
          request_hash,
          message_id,
          correlation_id,
          definition_id,
          definition_hash_used,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'requested')
        ON CONFLICT (job_id) DO NOTHING
        RETURNING job_id
      `,
      [
        params.jobId,
        params.requestHash,
        params.messageId,
        params.correlationId,
        params.definitionId,
        params.definitionHashUsed,
      ],
    );

    const existing = await this.getJob(params.jobId);
    if (!existing) {
      throw new Error('Job insert failed');
    }

    // 同 jobId 不同 payload：视为生产端 bug（后续 MQ 消费链路会走 DLQ + 指标）。
    if (existing.requestHash !== params.requestHash) {
      return { kind: 'conflict', job: existing };
    }

    // insertedRows 非空表示本次确实插入成功；为空表示重复投递（duplicate）。
    const inserted = isUnknownArray(insertedRows) && insertedRows.length > 0;
    return { kind: inserted ? 'inserted' : 'duplicate', job: existing };
  }

  async markRunning(jobId: string): Promise<void> {
    await this.manager.query(
      `
        UPDATE jobs
        SET status = 'running'
        WHERE job_id = $1
      `,
      [jobId],
    );
  }

  async markSucceeded(params: {
    jobId: string;
    inputsHash: string;
    outputsHash: string;
    outputs: Record<string, unknown>;
    computedAt: Date;
    inputsSnapshot?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.manager.query(
      `
        UPDATE jobs
        SET
          status = 'succeeded',
          inputs_hash = $2,
          outputs_hash = $3,
          computed_at = $4,
          failed_at = NULL,
          inputs_snapshot_json = $5,
          outputs_json = $6,
          error_code = NULL,
          error_message = NULL
        WHERE job_id = $1
      `,
      [
        params.jobId,
        params.inputsHash,
        params.outputsHash,
        params.computedAt,
        params.inputsSnapshot ?? null,
        params.outputs,
      ],
    );
  }

  async markFailed(params: {
    jobId: string;
    inputsHash: string | null;
    errorCode: string;
    errorMessage: string;
    failedAt: Date;
  }): Promise<void> {
    await this.manager.query(
      `
        UPDATE jobs
        SET
          status = 'failed',
          inputs_hash = $2,
          outputs_hash = NULL,
          outputs_json = NULL,
          computed_at = NULL,
          failed_at = $5,
          error_code = $3,
          error_message = $4
        WHERE job_id = $1
      `,
      [
        params.jobId,
        params.inputsHash,
        params.errorCode,
        params.errorMessage,
        params.failedAt,
      ],
    );
  }

  async clearSnapshotsOlderThan(params: {
    cutoff: Date;
    limit: number;
  }): Promise<number> {
    const rows: unknown = await this.manager.query(
      `
        WITH candidates AS (
          SELECT job_id
          FROM jobs
          WHERE (
              (computed_at IS NOT NULL AND computed_at < $1)
              OR (failed_at IS NOT NULL AND failed_at < $1)
            )
            AND (
              inputs_snapshot_json IS NOT NULL
              OR outputs_json IS NOT NULL
            )
          ORDER BY COALESCE(computed_at, failed_at) ASC
          LIMIT $2
        )
        UPDATE jobs j
        SET
          inputs_snapshot_json = NULL,
          outputs_json = NULL
        FROM candidates c
        WHERE j.job_id = c.job_id
        RETURNING j.job_id
      `,
      [params.cutoff, params.limit],
    );
    return Array.isArray(rows) ? rows.length : 0;
  }
}
