/**
 * CreateDraft 用例：创建一个 Definition draft（可反复编辑）。
 *
 * 说明：draft 是可变的；真正可执行的是 publish 后生成的 Release（definitionHash 标识）。
 */
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../ports/definition-draft-repository.port';

export interface CreateDraftCommand {
  definitionId: string;
  contentType: 'graph_json';
  content: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  runnerConfig?: Record<string, unknown> | null;
}

@Injectable()
export class CreateDraftUseCase {
  constructor(
    @Inject(DEFINITION_DRAFT_REPOSITORY)
    private readonly draftRepository: DefinitionDraftRepositoryPort,
  ) {}

  async execute(command: CreateDraftCommand) {
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
