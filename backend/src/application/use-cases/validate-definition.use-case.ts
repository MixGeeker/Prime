/**
 * ValidateDefinition 用例：对 definition（或 ref）做静态校验并返回结构化 issues。
 *
 * 说明：
 * - Editor 可用该接口做实时校验提示
 * - 当校验通过且可计算时，会返回 definitionHash（便于预览/对账）
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ContentType } from '../../domain/definition/definition';
import { GraphValidatorService } from '../validation/graph-validator.service';
import type { ValidationIssue } from '../validation/validation-issue';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';
import { HashingService } from '../hashing/hashing.service';

export interface ValidateDefinitionInput {
  definitionRef?: {
    definitionId: string;
    definitionHash: string;
  };
  definition?: {
    contentType: ContentType;
    content: Record<string, unknown>;
    outputSchema?: Record<string, unknown> | null;
    runnerConfig?: Record<string, unknown> | null;
  };
}

export interface ValidateDefinitionResult {
  ok: boolean;
  errors: ValidationIssue[];
  definitionHash?: string;
}

@Injectable()
export class ValidateDefinitionUseCase {
  constructor(
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
    private readonly graphValidatorService: GraphValidatorService,
    private readonly hashingService: HashingService,
  ) {}

  async execute(
    input: ValidateDefinitionInput,
  ): Promise<ValidateDefinitionResult> {
    const resolved = await this.resolveDefinition(input);
    if (!resolved) {
      return {
        ok: false,
        errors: [
          {
            code: 'INVALID_MESSAGE',
            severity: 'error',
            message: 'either definitionRef or definition must be provided',
          },
        ],
      };
    }

    if ('error' in resolved) {
      return {
        ok: false,
        errors: [
          {
            code: resolved.error.code,
            severity: 'error',
            message: resolved.error.message,
          },
        ],
      };
    }

    const errors = this.graphValidatorService.validateGraph(resolved.content);
    const ok = errors.every((e) => e.severity !== 'error');
    if (!ok) {
      return { ok, errors };
    }

    const definitionHash = this.hashingService.computeDefinitionHash({
      contentType: resolved.contentType,
      content: resolved.content,
      outputSchema: resolved.outputSchema,
      runnerConfig: resolved.runnerConfig,
    });

    return { ok, errors, definitionHash };
  }

  private async resolveDefinition(input: ValidateDefinitionInput): Promise<
    | {
        contentType: ContentType;
        content: Record<string, unknown>;
        outputSchema: Record<string, unknown> | null;
        runnerConfig: Record<string, unknown> | null;
      }
    | {
        error: {
          code: string;
          message: string;
        };
      }
    | null
  > {
    if (input.definitionRef && input.definition) {
      return null;
    }
    if (!input.definitionRef && !input.definition) {
      return null;
    }

    if (input.definitionRef) {
      const release = await this.releaseRepository.getRelease(
        input.definitionRef.definitionId,
        input.definitionRef.definitionHash,
      );
      if (!release) {
        return {
          error: {
            code: 'DEFINITION_NOT_FOUND',
            message: `definition not found: ${input.definitionRef.definitionId}@${input.definitionRef.definitionHash}`,
          },
        };
      }
      return {
        contentType: 'graph_json',
        content: release.content,
        outputSchema: release.outputSchema,
        runnerConfig: release.runnerConfig,
      };
    }

    if (!input.definition) {
      return null;
    }

    return {
      contentType: input.definition.contentType,
      content: input.definition.content,
      outputSchema: input.definition.outputSchema ?? null,
      runnerConfig: input.definition.runnerConfig ?? null,
    };
  }
}
