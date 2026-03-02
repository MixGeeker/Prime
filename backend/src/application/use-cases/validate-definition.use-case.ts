import { Injectable } from '@nestjs/common';
import type { ContentType } from '../../domain/definition/definition';
import { GraphValidatorService } from '../validation/graph-validator.service';
import type { ValidationIssue } from '../validation/validation-issue';

export interface ValidateDefinitionInput {
  contentType: ContentType;
  content: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  runnerConfig?: Record<string, unknown> | null;
}

export interface ValidateDefinitionResult {
  ok: boolean;
  errors: ValidationIssue[];
  /**
   * definitionHash 需要 M3 hashing/canonicalize 才能稳定计算。
   * M2 先不返回（保持字段兼容）。
   */
  definitionHash?: string;
}

/**
 * ValidateDefinition 用例（M2 先支持一次性 definition 校验）。
 *
 * M4 会把它接入 draft/ref 流程（definitionRef 校验、publish gate 等）。
 */
@Injectable()
export class ValidateDefinitionUseCase {
  constructor(private readonly graphValidatorService: GraphValidatorService) {}

  execute(input: ValidateDefinitionInput): ValidateDefinitionResult {
    const errors = this.graphValidatorService.validateGraph(input.content);
    const ok = errors.every((e) => e.severity !== 'error');
    return { ok, errors };
  }
}
