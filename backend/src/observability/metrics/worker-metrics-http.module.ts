/**
 * Worker metrics HTTP 模块。
 *
 * 说明：Worker 进程是 ApplicationContext（无主 HTTP server），
 * 该模块单独启动一个轻量 HTTP server 暴露 /metrics。
 */
import { Module } from '@nestjs/common';
import { MetricsModule } from './metrics.module';
import { WorkerMetricsHttpServerService } from './worker-metrics-http.service';

@Module({
  imports: [MetricsModule],
  providers: [WorkerMetricsHttpServerService],
})
export class WorkerMetricsHttpModule {}
