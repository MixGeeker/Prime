/**
 * DeleteDraft 用例：删除某个 Definition 的当前 draft。
 *
 * 说明：只影响 draft，不影响已发布 releases。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../ports/definition-draft-repository.port';

@Injectable()
export class DeleteDraftUseCase {
  constructor(
    @Inject(DEFINITION_DRAFT_REPOSITORY)
    private readonly draftRepository: DefinitionDraftRepositoryPort,
  ) {}

  async execute(definitionId: string): Promise<void> {
    await this.draftRepository.deleteDraft(definitionId);
  }
}
