import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Admin API DTO（与 `doc/API_DESIGN.md` 对齐）。
 *
 * 说明：
 * - 这里只做“输入结构 + class-validator 校验”
 * - 业务校验（graph validate / 类型系统等）将在 M2/M4 实现
 */
class DefinitionRefDto {
  @ApiProperty()
  @IsString()
  definitionId!: string;

  @ApiProperty()
  @IsString()
  definitionHash!: string;
}

class DefinitionDto {
  @ApiProperty({ enum: ['graph_json'] })
  @IsIn(['graph_json'])
  contentType!: 'graph_json';

  @ApiProperty()
  @IsObject()
  content!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  outputSchema?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  runnerConfig?: Record<string, unknown>;
}

export class CreateDefinitionDraftDto extends DefinitionDto {
  @ApiProperty()
  @IsString()
  definitionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changelog?: string;
}

export class UpdateDefinitionDraftDto extends DefinitionDto {
  @ApiProperty()
  @IsString()
  draftRevisionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changelog?: string;
}

export class ValidateDefinitionDto {
  @ApiPropertyOptional({ type: DefinitionRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefinitionRefDto)
  definitionRef?: DefinitionRefDto;

  @ApiPropertyOptional({ type: DefinitionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefinitionDto)
  definition?: DefinitionDto;
}

export class DryRunDto {
  @ApiPropertyOptional({ type: DefinitionRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefinitionRefDto)
  definitionRef?: DefinitionRefDto;

  @ApiPropertyOptional({ type: DefinitionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefinitionDto)
  definition?: DefinitionDto;

  @ApiProperty()
  @IsObject()
  inputs!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entrypointKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}

export class PublishDefinitionDto {
  @ApiProperty()
  @IsString()
  draftRevisionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changelog?: string;
}

export class DeprecateReleaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListDefinitionsQueryDto {
  @ApiPropertyOptional({ description: '按 definitionId 模糊搜索（ILIKE）' })
  @IsOptional()
  @IsString()
  q?: string;

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
