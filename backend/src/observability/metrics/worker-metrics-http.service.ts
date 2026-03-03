/**
 * WorkerMetricsHttpServerService：在 worker 进程内启动 metrics HTTP server。
 *
 * 说明：
 * - 监听端口由 WORKER_METRICS_PORT 控制
 * - 路径由 METRICS_PATH 控制
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import { MetricsService } from './metrics.service';

@Injectable()
export class WorkerMetricsHttpServerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerMetricsHttpServerService.name);

  private server: Server | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get<boolean>('METRICS_ENABLED') ?? true;
    if (!enabled) {
      return;
    }

    const port = this.configService.get<number>('WORKER_METRICS_PORT') ?? 4020;
    const path = normalizePath(
      this.configService.get<string>('METRICS_PATH') ?? '/metrics',
    );

    this.server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== path) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
      } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
        return;
      }

      void this.metricsService
        .getMetricsText()
        .then((body) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', this.metricsService.contentType);
          res.end(body);
        })
        .catch((error) => {
          res.statusCode = 500;
          res.end(String(error));
        });
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.once('error', reject);
      this.server.listen(port, resolve);
    });

    this.logger.log(
      `Worker metrics listening on http://localhost:${port}${path}`,
    );
  }

  async onModuleDestroy() {
    if (!this.server) {
      return;
    }
    const serverToClose = this.server;
    this.server = null;
    await new Promise<void>((resolve) => serverToClose.close(() => resolve()));
  }
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '/metrics';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
