import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { AdminModule } from './admin/admin.module';
import { CatalogModule } from './catalog/catalog.module';
import { ReadinessService } from './health/readiness.service';
import { DbModule } from '../../outbound/db/db.module';

/**
 * HTTP Inbound 适配器模块：
 * - health/ready：用于 K8s/LB 探活
 * - admin：Editor/运维对接的 Admin API（M4 才会实现具体业务）
 * - catalog：节点目录（M2）
 */
@Module({
  imports: [DbModule, AdminModule, CatalogModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class HttpInboundModule {}
