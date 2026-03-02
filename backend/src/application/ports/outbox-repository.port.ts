import type { NewOutboxEvent, OutboxRecord } from '../../domain/outbox/outbox';

export const OUTBOX_REPOSITORY = Symbol('OutboxRepositoryPort');

/**
 * Outbox 仓储端口（outbound）。
 *
 * 关键约束：
 * - 必须与 job 状态写入同一事务（避免“DB 成功但消息丢失”）
 * - dispatcher（M7）会负责重试、confirm、标记 SENT
 */
export interface OutboxRepositoryPort {
  enqueue(event: NewOutboxEvent): Promise<OutboxRecord>;
}
