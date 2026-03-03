import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class OpsStatsQueryDto {
  @ApiPropertyOptional({
    description: '仅统计最近 N 小时内的 jobs（requestedAt >= now - N小时）',
    default: 24,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  jobsSinceHours?: number;
}
