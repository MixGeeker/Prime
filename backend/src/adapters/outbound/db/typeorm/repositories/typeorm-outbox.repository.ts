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
}
