import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../ports/definition-draft-repository.port';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../ports/definition-version-repository.port';
import { GraphValidatorService } from '../validation/graph-validator.service';
import { HashingService } from '../hashing/hashing.service';
import { UseCaseError } from './use-case.error';

export interface PublishDefinitionCommand {
  definitionId: string;
  draftRevisionId: string;
  changelog?: string;
}

@Injectable()
export class PublishDefinitionUseCase {
  constructor(
    @Inject(DEFINITION_DRAFT_REPOSITORY)
    private readonly draftRepository: DefinitionDraftRepositoryPort,
    @Inject(DEFINITION_VERSION_REPOSITORY)
    private readonly versionRepository: DefinitionVersionRepositoryPort,
    private readonly graphValidatorService: GraphValidatorService,
    private readonly hashingService: HashingService,
  ) {}

  async execute(command: PublishDefinitionCommand) {
    const draft = await this.draftRepository.getDraft(command.definitionId);
    if (!draft) {
      throw new UseCaseError(
        'DEFINITION_DRAFT_NOT_FOUND',
        `draft not found: ${command.definitionId}`,
      );
    }

    if (draft.draftRevisionId !== command.draftRevisionId) {
      throw new UseCaseError(
        'DRAFT_REVISION_CONFLICT',
        `draft revision mismatch: ${command.definitionId}`,
      );
    }

    const validateErrors = this.graphValidatorService.validateGraph(
      draft.content,
    );
    const blockingErrors = validateErrors.filter(
      (error) => error.severity === 'error',
    );
    if (blockingErrors.length > 0) {
      throw new UseCaseError(
        'DEFINITION_INVALID',
        'definition validation failed',
        blockingErrors,
      );
    }

    const definitionHash = this.hashingService.computeDefinitionHash({
      contentType: draft.contentType,
      content: draft.content,
      outputSchema: draft.outputSchema,
      runnerConfig: draft.runnerConfig,
    });

    const existing = await this.versionRepository.listVersions(
      command.definitionId,
    );
    const nextVersion =
      existing.reduce((maxVersion, current) => {
        return current.version > maxVersion ? current.version : maxVersion;
      }, 0) + 1;

    const publishedAt = new Date();
    await this.versionRepository.insertVersion({
      definitionId: draft.definitionId,
      version: nextVersion,
      status: 'published',
      definitionHash,
      content: draft.content,
      outputSchema: draft.outputSchema,
      runnerConfig: draft.runnerConfig,
      changelog: command.changelog ?? null,
      publishedAt,
      publishedBy: null,
    });

    return {
      definitionId: draft.definitionId,
      version: nextVersion,
      definitionHash,
      publishedAt: publishedAt.toISOString(),
    };
  }
}
