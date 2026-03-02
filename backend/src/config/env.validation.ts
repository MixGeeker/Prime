import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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

  /** PostgreSQL 连接串 */
  @IsString()
  DATABASE_URL!: string;

  /** RabbitMQ 连接串（M0/M1 可不配置；M6 起必配） */
  @IsOptional()
  @IsString()
  RABBITMQ_URL?: string;

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
