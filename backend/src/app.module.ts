import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { HttpInboundModule } from './adapters/inbound/http/http.module';
import { DbModule } from './adapters/outbound/db/db.module';
import { ApplicationModule } from './application/application.module';
import { MetricsModule } from './observability/metrics/metrics.module';

/**
 * HTTP 应用的根模块。
 *
 * 依赖方向（六边形）：
 * - inbound adapters（HTTP controller）只调用 application use-case
 * - application 通过 ports 依赖 outbound adapters（DB/MQ 等）
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
    MetricsModule,
    HttpInboundModule,
  ],
})
export class AppModule {}
