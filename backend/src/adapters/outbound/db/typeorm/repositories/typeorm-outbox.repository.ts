import type { EntityManager } from 'typeorm';
import type { OutboxRepositoryPort } from '../../../../../application/ports/outbox-repository.port';
import type {
  NewOutboxEvent,
  OutboxRecord,
} from '../../../../../domain/outbox/outbox';
import { OutboxEntity } from '../entities/outbox.entity';

/**
 * OutboxRepo 的 TypeORM 实现（PostgreSQL）。
 *
 * 说明：
 * - 这里只负责“写入 outbox 记录”
 * - 真正的发布、confirm、重试、标记 SENT 会在 M7 的 dispatcher 完成
 */
function mapOutbox(row: OutboxEntity): OutboxRecord {
  return {
    id: row.id,
    eventType: row.eventType,
    routingKey: row.routingKey,
    payload: row.payloadJson,
    headers: row.headersJson,
    status: row.status as OutboxRecord['status'],
    lockedAt: row.lockedAt ?? null,
    lockedBy: row.lockedBy ?? null,
    nextRetryAt: row.nextRetryAt ?? null,
    lastError: row.lastError ?? null,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TypeOrmOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async enqueue(event: NewOutboxEvent): Promise<OutboxRecord> {
    const row = this.manager.getRepository(OutboxEntity).create({
      id: event.id,
      eventType: event.eventType,
      routingKey: event.routingKey,
      payloadJson: event.payload,
      headersJson: event.headers,
      status: 'pending',
      lockedAt: null,
      lockedBy: null,
      nextRetryAt: null,
      lastError: null,
      attempts: 0,
    });

    const saved = await this.manager.getRepository(OutboxEntity).save(row);
    return mapOutbox(saved);
  }

  async countPending(): Promise<number> {
    const rows: unknown = await this.manager.query(
      `
        SELECT COUNT(*)::int AS count
        FROM outbox
        WHERE status = 'pending'
      `,
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return 0;
    }
    const value = (rows[0] as { count?: unknown }).count;
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  async countFailed(params: { maxAttempts: number }): Promise<number> {
    const rows: unknown = await this.manager.query(
      `
        SELECT COUNT(*)::int AS count
        FROM outbox
        WHERE status = 'failed'
          AND attempts < $1
      `,
      [params.maxAttempts],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return 0;
    }
    const value = (rows[0] as { count?: unknown }).count;
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  async deleteSentOlderThan(params: {
    cutoff: Date;
    limit: number;
  }): Promise<number> {
    const rows: unknown = await this.manager.query(
      `
        WITH candidates AS (
          SELECT id
          FROM outbox
          WHERE status = 'sent'
            AND updated_at < $1
          ORDER BY updated_at ASC
          LIMIT $2
        )
        DELETE FROM outbox o
        USING candidates c
        WHERE o.id = c.id
        RETURNING o.id
      `,
      [params.cutoff, params.limit],
    );
    return Array.isArray(rows) ? rows.length : 0;
  }

  async leaseNextBatch(params: {
    batchSize: number;
    lockedBy: string;
    now: Date;
    staleLockedBefore: Date;
    maxAttempts: number;
  }): Promise<OutboxRecord[]> {
    const rows: unknown = await this.manager.query(
      `
        WITH candidates AS (
          SELECT id
          FROM outbox
          WHERE status IN ('pending', 'failed')
            AND (next_retry_at IS NULL OR next_retry_at <= $1)
            AND (locked_at IS NULL OR locked_at <= $2)
            AND attempts < $5
          ORDER BY created_at ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox o
        SET
          locked_at = $1,
          locked_by = $4,
          updated_at = $1
        FROM candidates c
        WHERE o.id = c.id
        RETURNING
          o.id AS "id",
          o.event_type AS "eventType",
          o.routing_key AS "routingKey",
          o.payload_json AS "payloadJson",
          o.headers_json AS "headersJson",
          o.status AS "status",
          o.locked_at AS "lockedAt",
          o.locked_by AS "lockedBy",
          o.next_retry_at AS "nextRetryAt",
          o.last_error AS "lastError",
          o.attempts AS "attempts",
          o.created_at AS "createdAt",
          o.updated_at AS "updatedAt"
      `,
      [
        params.now,
        params.staleLockedBefore,
        params.batchSize,
        params.lockedBy,
        params.maxAttempts,
      ],
    );

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows.map((row) => {
      const mapped = row as unknown as OutboxEntity;
      return mapOutbox(mapped);
    });
  }

  async markSent(params: { id: string; lockedBy: string; now: Date }) {
    await this.manager.query(
      `
        UPDATE outbox
        SET
          status = 'sent',
          locked_at = NULL,
          locked_by = NULL,
          next_retry_at = NULL,
          last_error = NULL,
          updated_at = $3
        WHERE id = $1
          AND locked_by = $2
      `,
      [params.id, params.lockedBy, params.now],
    );
  }

  async markFailedAndScheduleRetry(params: {
    id: string;
    lockedBy: string;
    now: Date;
    error: string;
    nextRetryAt: Date;
  }) {
    await this.manager.query(
      `
        UPDATE outbox
        SET
          status = 'failed',
          locked_at = NULL,
          locked_by = NULL,
          last_error = $3,
          attempts = attempts + 1,
          next_retry_at = $4,
          updated_at = $5
        WHERE id = $1
          AND locked_by = $2
      `,
      [
        params.id,
        params.lockedBy,
        params.error,
        params.nextRetryAt,
        params.now,
      ],
    );
  }
}
