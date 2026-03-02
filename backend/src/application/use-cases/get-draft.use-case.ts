import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../ports/definition-draft-repository.port';
import { UseCaseError } from './use-case.error';

@Injectable()
export class GetDraftUseCase {
  constructor(
    @Inject(DEFINITION_DRAFT_REPOSITORY)
    private readonly draftRepository: DefinitionDraftRepositoryPort,
  ) {}

  async execute(definitionId: string) {
    const draft = await this.draftRepository.getDraft(definitionId);
    if (!draft) {
      throw new UseCaseError(
        'DEFINITION_DRAFT_NOT_FOUND',
        `draft not found: ${definitionId}`,
      );
    }

    return {
      definitionId: draft.definitionId,
      draftRevisionId: draft.draftRevisionId,
      contentType: draft.contentType,
      content: draft.content,
      outputSchema: draft.outputSchema,
      runnerConfig: draft.runnerConfig,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }
}
