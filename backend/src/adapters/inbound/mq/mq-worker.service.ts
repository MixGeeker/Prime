import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * MQ worker（占位）。
 *
 * 后续会演进为：
 * - 消费消息 → 解析/校验 → ExecuteJob 用例（事务）→ 写 outbox → ack
 */
@Injectable()
export class MqWorkerService implements OnModuleInit {
  private readonly logger = new Logger(MqWorkerService.name);

  onModuleInit() {
    this.logger.log('MQ worker init (placeholder).');
  }
}
