import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  Max,
  Min,
  validateSync,
} from 'class-validator';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * 环境变量声明 + 校验。
 *
 * 约定：
 * - M0 阶段允许 MQ 不配置（仅占位）
 * - M1 起 DB 是必须（否则无法跑迁移/落 jobs/outbox）
 */
export class EnvVars {
  /** HTTP 监听端口 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  HTTP_PORT: number = 4010;

  /** Swagger UI 路径（例如 `/docs`） */
  @IsOptional()
  @IsString()
  SWAGGER_PATH: string = '/docs';

  /** `/ready` 探测结果缓存时长（ms），用于降低 DB/MQ 探测压力 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60_000)
  READY_CHECK_CACHE_MS: number = 1000;

  /** `/ready` DB 探测超时（ms） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60_000)
  READY_CHECK_DB_TIMEOUT_MS: number = 500;

  /** `/ready` MQ 探测超时（ms） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60_000)
  READY_CHECK_MQ_TIMEOUT_MS: number = 800;

  /** PostgreSQL 连接串 */
  @IsString()
  DATABASE_URL!: string;

  /** RabbitMQ 连接串（M0/M1 可不配置；M6 起必配） */
  @IsOptional()
  @IsString()
  RABBITMQ_URL?: string;

  /**
   * Worker 角色：
   * - `consumer`：消费 `compute.job.requested.v1`（M6）
   * - `dispatcher`：Outbox 发布（M7）
   * - `maintenance`：运维/清理类任务（M9）
   * - `consumer,dispatcher`：同进程同时启用（默认）
   */
  @IsOptional()
  @IsString()
  WORKER_ROLES: string = 'consumer,dispatcher';

  /** RabbitMQ 命令 exchange（topic, durable） */
  @IsOptional()
  @IsString()
  MQ_COMMANDS_EXCHANGE: string = 'compute.commands';

  /** RabbitMQ 事件 exchange（topic, durable） */
  @IsOptional()
  @IsString()
  MQ_EVENTS_EXCHANGE: string = 'compute.events';

  /** RabbitMQ 死信 exchange（topic, durable） */
  @IsOptional()
  @IsString()
  MQ_DLX_EXCHANGE: string = 'compute.dlx';

  /** `compute.job.requested.v1` consumer queue 名称（durable） */
  @IsOptional()
  @IsString()
  MQ_JOB_REQUESTED_QUEUE: string = 'compute.job.requested.v1';

  /** consumer prefetch（每个 channel 的最大未确认消息数） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  MQ_PREFETCH: number = 10;

  /** MQ 最大消息体字节数（过大直接拒绝并进入 DLQ） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  MQ_MAX_MESSAGE_BYTES: number = 1_000_000;

  /** Outbox dispatcher：每次抓取/租约的最大记录数 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  OUTBOX_DISPATCH_BATCH_SIZE: number = 50;

  /** Outbox dispatcher：轮询间隔（ms） */
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(60_000)
  OUTBOX_DISPATCH_POLL_INTERVAL_MS: number = 500;

  /** Outbox dispatcher：租约时长（ms），超过视为锁过期可被其他实例抢占 */
  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(10 * 60_000)
  OUTBOX_DISPATCH_LEASE_MS: number = 30_000;

  /** Outbox dispatcher：最大重试次数（超过后不再自动重试） */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  OUTBOX_DISPATCH_MAX_ATTEMPTS: number = 25;

  /** Prometheus metrics 是否启用 */
  @IsOptional()
  @IsBoolean()
  METRICS_ENABLED: boolean = true;

  /** Prometheus metrics 路径（HTTP 进程与 Worker metrics 端口都复用） */
  @IsOptional()
  @IsString()
  METRICS_PATH: string = '/metrics';

  /** 是否启用 prom-client 默认进程指标（CPU/内存/事件循环等） */
  @IsOptional()
  @IsBoolean()
  METRICS_COLLECT_DEFAULT: boolean = true;

  /** Worker 进程暴露 metrics 的 HTTP 端口（Worker 采用 ApplicationContext，不占用 HTTP_PORT） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  WORKER_METRICS_PORT: number = 4020;

  /** 是否允许启用危险运维端点（例如 DLQ replay） */
  @IsOptional()
  @IsBoolean()
  ADMIN_DANGEROUS_ENDPOINTS_ENABLED: boolean = false;

  /** Admin API token（危险端点必须携带 Authorization: Bearer <token>） */
  @IsOptional()
  @IsString()
  ADMIN_API_TOKEN: string = '';

  /** DLQ replay 单次最大回放条数（硬上限） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  DLQ_REPLAY_MAX_LIMIT: number = 200;

  /** 应用日志级别（映射到 Nest logger levels） */
  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  /** outbox 已发送记录保留天数（M7 才会真正用到清理任务） */
  @IsOptional()
  @IsInt()
  @Min(1)
  OUTBOX_SENT_TTL_DAYS: number = 30;

  /** jobs 快照（inputs/outputs）保留天数（MVP 可先不落快照） */
  @IsOptional()
  @IsInt()
  @Min(1)
  JOBS_SNAPSHOT_TTL_DAYS: number = 180;

  /** definition drafts 保留天数（超过后可自动清理） */
  @IsOptional()
  @IsInt()
  @Min(1)
  DRAFT_TTL_DAYS: number = 30;

  /** retention cleaner 是否启用（仅当 WORKER_ROLES 含 maintenance 时生效） */
  @IsOptional()
  @IsBoolean()
  RETENTION_CLEANER_ENABLED: boolean = true;

  /** retention cleaner cron（带秒字段，默认每 10 分钟） */
  @IsOptional()
  @IsString()
  RETENTION_CLEANER_CRON: string = '0 */10 * * * *';

  /** retention 每批处理条数（避免长事务） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  RETENTION_BATCH_SIZE: number = 500;
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  // class-validator 默认不会自动把字符串转 number；这里开启隐式转换，便于写 `.env`。
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  // Nest ConfigModule 要求返回 plain object；这里返回校验后的对象以供后续读取。
  return validated as unknown as Record<string, unknown>;
}
