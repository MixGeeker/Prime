export type OutboxStatus = 'pending' | 'sent' | 'failed';

/**
 * OutboxRecord：outbox 表的领域视图。
 *
 * 用途：
 * - 与 jobs 同事务写入，确保结果事件不丢（Outbox 模式）
 * - dispatcher（M7）负责抢锁、发布、confirm、重试与标记 SENT
 */
export interface OutboxRecord {
  id: string;
  eventType: string;
  routingKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  status: OutboxStatus;
  lockedAt: Date | null;
  lockedBy: string | null;
  nextRetryAt: Date | null;
  lastError: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOutboxEvent {
  id: string;
  eventType: string;
  routingKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
}
