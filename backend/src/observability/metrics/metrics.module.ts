/**
 * Metrics 模块（Prometheus）。
 *
 * 说明：本模块只负责注册 MetricsService（采集与导出指标）。
 * HTTP/Worker 进程的 metrics 暴露端点由各自入口模块挂载。
 */
import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
