export type ContentType = 'graph_json';

/**
 * Definition：定义的稳定标识（不变）。
 *
 * 注意：
 * - 真正可执行的内容在 DefinitionVersion 中（发布后不可变）
 * - Draft 允许更新，用于编辑器流程
 */
export interface Definition {
  definitionId: string;
  createdAt: Date;
}

/** DefinitionDraft：当前草稿（可变）。 */
export interface DefinitionDraft {
  definitionId: string;
  draftRevisionId: string;
  contentType: ContentType;
  content: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  runnerConfig: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DefinitionVersionStatus = 'published' | 'deprecated';

/**
 * DefinitionVersion：发布版本（冻结、append-only）。
 *
 * 约束：
 * - `(definitionId, version)` 唯一
 * - 发布后禁止覆盖更新；改动只能发布新版本
 */
export interface DefinitionVersion {
  definitionId: string;
  version: number;
  status: DefinitionVersionStatus;
  definitionHash: string;
  content: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  runnerConfig: Record<string, unknown> | null;
  changelog: string | null;
  publishedAt: Date;
  publishedBy: string | null;
  deprecatedAt: Date | null;
  deprecatedReason: string | null;
}
