import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MqWorkerModule } from './adapters/inbound/mq/mq-worker.module';
import { DbModule } from './adapters/outbound/db/db.module';
import { ApplicationModule } from './application/application.module';
import { validateEnv } from './config/env.validation';

/**
 * Worker 进程的根模块。
 *
 * 说明：
 * - 这里同样会加载 DB + application 层，用于实现“消费消息 → 写 jobs/outbox”这类链路（M6/M7）。
 * - M0/M1 阶段 MQ 只是占位模块。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DbModule,
    ApplicationModule,
    MqWorkerModule,
  ],
})
export class WorkerModule {}
