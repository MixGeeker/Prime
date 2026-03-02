import { Module } from '@nestjs/common';
import { MqWorkerService } from './mq-worker.service';

/**
 * MQ inbound 模块（占位）。
 *
 * M6 会在此处接入 RabbitMQ consumer：
 * - 消费 `compute.job.requested.v1`
 * - 事务内写 `jobs + outbox` 后再 ack（Outbox 模式）
 */
@Module({
  providers: [MqWorkerService],
})
export class MqWorkerModule {}
