import 'reflect-metadata';

/**
 * Compute Engine 后端（HTTP）入口。
 *
 * M0 目标：
 * - 服务可启动
 * - 提供健康检查
 * - 暴露 Swagger（先对齐 Admin API 契约，业务实现后续里程碑补齐）
 */
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { LogLevel } from './config/env.validation';

function toNestLoggerLevels(
  level: LogLevel,
): Array<'error' | 'warn' | 'log' | 'debug' | 'verbose'> {
  switch (level) {
    case 'error':
      return ['error'];
    case 'warn':
      return ['error', 'warn'];
    case 'info':
      return ['error', 'warn', 'log'];
    case 'debug':
      return ['error', 'warn', 'log', 'debug'];
    case 'verbose':
      return ['error', 'warn', 'log', 'debug', 'verbose'];
  }
}

async function bootstrap() {
  // logger level 由环境变量控制；默认 info（生产建议由部署侧注入）。
  const app = await NestFactory.create(AppModule, {
    logger: toNestLoggerLevels(
      (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
    ),
  });

  app.enableCors();
  app.enableShutdownHooks();
  // DTO 校验/转换：用于后续 Admin API 的输入参数校验（M0 先把基础设施搭好）。
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    }),
  );

  const configService = app.get(ConfigService);
  const httpPort = configService.get<number>('HTTP_PORT') ?? 4010;

  const swaggerPathRaw = configService.get<string>('SWAGGER_PATH') ?? '/docs';
  const swaggerPath = swaggerPathRaw.replace(/^\//, '');

  // Swagger 仅用于对齐契约；真实业务逻辑将按 M2/M4 等里程碑逐步实现。
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Compute Engine Admin API')
    .setDescription('Compute Engine Admin API')
    .setVersion('0.1.0')
    .addTag('admin')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Nest Swagger 默认会同时暴露 `${path}-json` 文档端点（例如 `/docs-json`）。
  SwaggerModule.setup(swaggerPath, app, document);

  await app.listen(httpPort);
  Logger.log(`HTTP listening on http://localhost:${httpPort}`, 'Bootstrap');
  Logger.log(
    `Swagger UI on http://localhost:${httpPort}/${swaggerPath}`,
    'Bootstrap',
  );
  Logger.log(
    `Swagger JSON on http://localhost:${httpPort}/${swaggerPath}-json`,
    'Bootstrap',
  );
}

void bootstrap();
