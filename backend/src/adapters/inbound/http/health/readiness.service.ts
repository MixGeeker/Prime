import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { DataSource } from 'typeorm';

type ProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; latencyMs: number; error: string };

export interface ReadyCheckResult {
  ok: boolean;
  dependencies: {
    db: ProbeResult;
    mq: ProbeResult;
  };
  timestamp: string;
}

/**
 * ReadinessService：用于 `/ready` 的真实依赖探测（DB + MQ）。
 *
 * 说明：
 * - 为避免 readiness 高频探测压垮依赖，这里做了短 TTL 缓存。
 * - 失败返回会带上 error 文本（便于排障），但不应包含敏感信息。
 */
@Injectable()
export class ReadinessService {
  private lastCheckedAtMs = 0;
  private lastResult: ReadyCheckResult | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async check(): Promise<ReadyCheckResult> {
    const cacheMs =
      this.configService.get<number>('READY_CHECK_CACHE_MS') ?? 1000;
    const now = Date.now();
    if (
      this.lastResult &&
      this.lastCheckedAtMs > 0 &&
      now - this.lastCheckedAtMs < cacheMs
    ) {
      return this.lastResult;
    }

    const [db, mq] = await Promise.all([this.checkDb(), this.checkMq()]);
    const result: ReadyCheckResult = {
      ok: db.ok && mq.ok,
      dependencies: { db, mq },
      timestamp: new Date().toISOString(),
    };

    this.lastCheckedAtMs = now;
    this.lastResult = result;
    return result;
  }

  private async checkDb(): Promise<ProbeResult> {
    const timeoutMs =
      this.configService.get<number>('READY_CHECK_DB_TIMEOUT_MS') ?? 500;
    const startedAt = Date.now();

    try {
      await withTimeout(this.dataSource.query('SELECT 1'), timeoutMs);
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: stringifyError(error),
      };
    }
  }

  private async checkMq(): Promise<ProbeResult> {
    const timeoutMs =
      this.configService.get<number>('READY_CHECK_MQ_TIMEOUT_MS') ?? 800;
    const rabbitUrl = this.configService.get<string>('RABBITMQ_URL');
    const startedAt = Date.now();

    if (!rabbitUrl) {
      return {
        ok: false,
        latencyMs: 0,
        error: 'RABBITMQ_URL not configured',
      };
    }

    let connection: amqplib.ChannelModel | null = null;
    try {
      // 注意：amqplib.connect 本身不支持 AbortSignal；这里用超时包装做“软超时”。
      connection = await withTimeout(amqplib.connect(rabbitUrl), timeoutMs);
      await connection.close();
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      try {
        await connection?.close();
      } catch {
        // ignore
      }
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: stringifyError(error),
      };
    }
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      )
      .finally(() => clearTimeout(timer));
  });
}
