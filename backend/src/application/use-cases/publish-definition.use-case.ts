/**
 * PublishDefinition 用例：将当前 draft 发布为不可变 release（definitionHash 标识）。
 *
 * 关键约束：
 * - 发布前必须通过 graph validate（阻断 error）
 * - 若包含 `flow.call_definition`：需校验依赖存在/已发布/无循环/exposeOutputs 类型对齐
 * - release append-only：同 definitionHash 已存在则幂等返回
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../ports/definition-draft-repository.port';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';
import { GraphValidatorService } from '../validation/graph-validator.service';
import { HashingService } from '../hashing/hashing.service';
import { UseCaseError } from './use-case.error';
import { DefinitionDependenciesService } from '../definition/definition-dependencies.service';

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
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
    private readonly graphValidatorService: GraphValidatorService,
    private readonly hashingService: HashingService,
    private readonly definitionDependenciesService: DefinitionDependenciesService,
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

    const existing = await this.releaseRepository.getRelease(
      draft.definitionId,
      definitionHash,
    );

    const publishedAt = existing?.publishedAt ?? new Date();
    if (!existing) {
      // 发布前校验依赖闭包：存在性/发布状态/循环引用/exposeOutputs 类型对齐。
      await this.definitionDependenciesService.buildRunnerBundle({
        rootContent: draft.content,
        rootRef: { definitionId: draft.definitionId, definitionHash },
      });

      await this.releaseRepository.insertRelease({
        definitionId: draft.definitionId,
        definitionHash,
        status: 'published',
        content: draft.content,
        outputSchema: draft.outputSchema,
        runnerConfig: draft.runnerConfig,
        changelog: command.changelog ?? null,
        publishedAt,
        publishedBy: null,
      });
    }

    return {
      definitionId: draft.definitionId,
      definitionHash,
      publishedAt: publishedAt.toISOString(),
    };
  }
}
