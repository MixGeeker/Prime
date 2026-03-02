import 'reflect-metadata';

/**
 * Compute Engine 后端（Worker）入口。
 *
 * M0/M1 里程碑阶段：这里仅启动一个 Nest ApplicationContext，
 * 后续将接入 RabbitMQ consumer（M6）与 outbox dispatcher（M7）。
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { LogLevel } from './config/env.validation';
import { WorkerModule } from './worker.module';

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
  // Worker 采用 ApplicationContext（无 HTTP server），适合纯消费/调度类进程。
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: toNestLoggerLevels(
      (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
    ),
  });
  app.enableShutdownHooks();

  const logger = new Logger('WorkerBootstrap');
  logger.log('MQ worker started (placeholder)');

  // 目前尚未真正接入 MQ 消费，为避免进程立即退出，用定时器保持 event loop。
  const keepAlive = setInterval(() => {
    // Keep the event loop alive until a real MQ consumer is wired in.
  }, 60_000);

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      void (async () => {
        logger.log(`Received ${signal}, shutting down...`);
        clearInterval(keepAlive);
        await app.close();
        resolve();
      })();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
}

void bootstrap();
