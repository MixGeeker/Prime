import type { EntityManager } from 'typeorm';
import type {
  JobRepositoryPort,
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
    versionUsed: row.versionUsed,
    definitionHash: row.definitionHash ?? null,
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
          version_used,
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
        params.versionUsed,
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
}
