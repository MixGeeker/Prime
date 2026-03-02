import type {
  ContentType,
  DefinitionDraft,
} from '../../domain/definition/definition';

export const DEFINITION_DRAFT_REPOSITORY = Symbol(
  'DefinitionDraftRepositoryPort',
);

/**
 * Draft 仓储端口（outbound）。
 *
 * 约束：
 * - application 层依赖此接口，不依赖 TypeORM/Nest 等具体实现
 * - 草稿支持更新；乐观并发（draftRevisionId）在 M4 的 controller/use-case 层实现
 */
export interface UpsertDefinitionDraftParams {
  definitionId: string;
  draftRevisionId: string;
  contentType: ContentType;
  content: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  runnerConfig: Record<string, unknown> | null;
}

export interface DefinitionDraftRepositoryPort {
  getDraft(definitionId: string): Promise<DefinitionDraft | null>;
  upsertDraft(params: UpsertDefinitionDraftParams): Promise<DefinitionDraft>;
  deleteDraft(definitionId: string): Promise<void>;

  /** 清理过期草稿（按 updatedAt）。返回实际删除条数。 */
  deleteOlderThan(params: { cutoff: Date; limit: number }): Promise<number>;
}
