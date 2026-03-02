import { Module } from '@nestjs/common';
import { MetricsModule } from './metrics.module';
import { WorkerMetricsHttpServerService } from './worker-metrics-http.service';

@Module({
  imports: [MetricsModule],
  providers: [WorkerMetricsHttpServerService],
})
export class WorkerMetricsHttpModule {}
