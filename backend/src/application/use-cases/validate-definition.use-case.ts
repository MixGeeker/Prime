import { Inject, Injectable } from '@nestjs/common';
import type { ContentType } from '../../domain/definition/definition';
import { GraphValidatorService } from '../validation/graph-validator.service';
import type { ValidationIssue } from '../validation/validation-issue';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../ports/definition-version-repository.port';
import { HashingService } from '../hashing/hashing.service';

export interface ValidateDefinitionInput {
  definitionRef?: {
    definitionId: string;
    version: number;
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
    @Inject(DEFINITION_VERSION_REPOSITORY)
    private readonly versionRepository: DefinitionVersionRepositoryPort,
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
      const version = await this.versionRepository.getVersion(
        input.definitionRef.definitionId,
        input.definitionRef.version,
      );
      if (!version) {
        return {
          error: {
            code: 'DEFINITION_NOT_FOUND',
            message: `definition not found: ${input.definitionRef.definitionId}@${input.definitionRef.version}`,
          },
        };
      }
      return {
        contentType: 'graph_json',
        content: version.content,
        outputSchema: version.outputSchema,
        runnerConfig: version.runnerConfig,
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
