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

  /** 统计 pending 记录数（用于 metrics/backlog 观测）。 */
  countPending(): Promise<number>;

  /** 统计 failed 记录数（attempts < maxAttempts，用于 metrics/backlog 观测）。 */
  countFailed(params: { maxAttempts: number }): Promise<number>;

  /** 删除已发送（sent）的旧 outbox 记录。返回实际删除条数。 */
  deleteSentOlderThan(params: { cutoff: Date; limit: number }): Promise<number>;

  /**
   * 抢占一批待发布 outbox 记录（带 lease + SKIP LOCKED），供 dispatcher（M7）使用。
   *
   * 约定：
   * - 返回的记录应已写入 lockedAt/lockedBy
   * - 需要考虑锁过期（staleLockedBefore）与 nextRetryAt
   */
  leaseNextBatch(params: {
    batchSize: number;
    lockedBy: string;
    now: Date;
    staleLockedBefore: Date;
    maxAttempts: number;
  }): Promise<OutboxRecord[]>;

  /** 标记为已发送（confirm 成功后调用）。 */
  markSent(params: { id: string; lockedBy: string; now: Date }): Promise<void>;

  /** 记录失败并安排下一次重试时间。 */
  markFailedAndScheduleRetry(params: {
    id: string;
    lockedBy: string;
    now: Date;
    error: string;
    nextRetryAt: Date;
  }): Promise<void>;
}
