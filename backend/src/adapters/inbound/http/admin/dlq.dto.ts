/**
 * DLQ replay 请求 DTO。
 *
 * 说明：这里的字段只描述“回放策略”（条数/间隔/是否 dry-run），
 * 实际回放上限仍会被 `DLQ_REPLAY_MAX_LIMIT` 约束。
 */
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class DlqReplayRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60_000)
  minIntervalMs?: number;
}
