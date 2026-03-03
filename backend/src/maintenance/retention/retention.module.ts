/**
 * Retention 模块（maintenance worker）。
 *
 * 职责：注册 retention cleaner 定时任务。
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../../adapters/outbound/db/db.module';
import { MetricsModule } from '../../observability/metrics/metrics.module';
import { RetentionCleanerService } from './retention-cleaner.service';

@Module({
  imports: [ScheduleModule.forRoot(), DbModule, MetricsModule],
  providers: [RetentionCleanerService],
})
export class RetentionModule {}
