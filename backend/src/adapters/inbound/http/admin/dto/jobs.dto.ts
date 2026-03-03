import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Jobs 列表查询 DTO（Admin UI / 运维面板）。
 *
 * 注意：日期窗口以 ISO 字符串输入；controller 负责解析为 Date。
 */
export class ListJobsQueryDto {
  @ApiPropertyOptional({
    description: '状态过滤',
    enum: ['requested', 'running', 'succeeded', 'failed'],
  })
  @IsOptional()
  @IsIn(['requested', 'running', 'succeeded', 'failed'])
  status?: 'requested' | 'running' | 'succeeded' | 'failed';

  @ApiPropertyOptional({ description: '按 definitionId 过滤' })
  @IsOptional()
  @IsString()
  definitionId?: string;

  @ApiPropertyOptional({ description: '按 definitionHashUsed 过滤' })
  @IsOptional()
  @IsString()
  definitionHashUsed?: string;

  @ApiPropertyOptional({ description: 'requestedAt >= since（ISO）' })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ description: 'requestedAt < until（ISO）' })
  @IsOptional()
  @IsString()
  until?: string;

  @ApiPropertyOptional({ description: '分页大小（1..200）', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '游标（base64url）' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
