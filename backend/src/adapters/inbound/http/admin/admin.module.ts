import { Module } from '@nestjs/common';
import { ApplicationModule } from '../../../../application/application.module';
import { AdminDefinitionsController } from './definitions.controller';
import { AdminJobsController } from './jobs.controller';
import { AdminDlqJobRequestedController } from './dlq.controller';
import { AdminOpsController } from './ops.controller';

/**
 * Admin API 模块（HTTP inbound）。
 *
 * 说明：controller 目前仅占位并在 Swagger 中对齐契约；
 * 真正的用例实现会在 M4（Draft/Publish/Validate/Dry-run/Job 查询）补齐。
 */
@Module({
  imports: [ApplicationModule],
  controllers: [
    AdminDefinitionsController,
    AdminJobsController,
    AdminDlqJobRequestedController,
    AdminOpsController,
  ],
})
export class AdminModule {}
