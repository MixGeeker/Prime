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
