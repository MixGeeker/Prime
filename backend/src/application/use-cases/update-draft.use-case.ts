/**
 * UpdateDraft 用例：更新某个 Definition 的 draft（乐观并发）。
 *
 * 说明：通过 draftRevisionId 做并发控制，避免编辑器覆盖他人修改。
 */
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../ports/definition-draft-repository.port';
import { UseCaseError } from './use-case.error';

export interface UpdateDraftCommand {
  definitionId: string;
  draftRevisionId: string;
  contentType: 'graph_json';
  content: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  runnerConfig?: Record<string, unknown> | null;
}

@Injectable()
export class UpdateDraftUseCase {
  constructor(
    @Inject(DEFINITION_DRAFT_REPOSITORY)
    private readonly draftRepository: DefinitionDraftRepositoryPort,
  ) {}

  async execute(command: UpdateDraftCommand) {
    const current = await this.draftRepository.getDraft(command.definitionId);
    if (!current) {
      throw new UseCaseError(
        'DEFINITION_DRAFT_NOT_FOUND',
        `draft not found: ${command.definitionId}`,
      );
    }

    if (current.draftRevisionId !== command.draftRevisionId) {
      throw new UseCaseError(
        'DRAFT_REVISION_CONFLICT',
        `draft revision mismatch: ${command.definitionId}`,
      );
    }

    const saved = await this.draftRepository.upsertDraft({
      definitionId: command.definitionId,
      draftRevisionId: randomUUID(),
      contentType: command.contentType,
      content: command.content,
      outputSchema: command.outputSchema ?? null,
      runnerConfig: command.runnerConfig ?? null,
    });

    return {
      definitionId: saved.definitionId,
      draftRevisionId: saved.draftRevisionId,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
