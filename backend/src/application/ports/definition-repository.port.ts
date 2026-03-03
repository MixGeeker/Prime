import type {
  ContentType,
  DefinitionReleaseStatus,
} from '../../domain/definition/definition';

export const DEFINITION_REPOSITORY = Symbol('DefinitionRepositoryPort');

/**
 * Definitions 查询仓储端口（outbound）。
 *
 * 用途（面向 Admin UI / 运维查询）：
 * - 列出 definition 的基本信息（是否有 draft、最新发布物指针等）
 *
 * 说明：
 * - 这类“列表/聚合查询”不适合塞进 DraftRepo/ReleaseRepo（职责会混乱）
 * - 引擎核心执行链路不依赖此端口；仅用于管理面与可观测性
 */

export interface DefinitionSummary {
  definitionId: string;
  createdAt: Date;
  /** “有效更新时间”：取 definition.updatedAt 与 draft.updatedAt 的较大值，便于 UI 排序。 */
  updatedAt: Date;

  latestDefinitionHash: string | null;
  latestStatus: DefinitionReleaseStatus | null;
  latestPublishedAt: Date | null;

  draftRevisionId: string | null;
  draftContentType: ContentType | null;
  draftUpdatedAt: Date | null;
}

export interface DefinitionListCursor {
  updatedAt: Date;
  definitionId: string;
}

export interface ListDefinitionsParams {
  q?: string | null;
  limit: number;
  cursor?: DefinitionListCursor | null;
}

export interface DefinitionRepositoryPort {
  listDefinitions(params: ListDefinitionsParams): Promise<DefinitionSummary[]>;
}
