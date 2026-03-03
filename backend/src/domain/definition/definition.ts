export type ContentType = 'graph_json';

/**
 * Definition：定义的稳定标识（不变）。
 *
 * 注意：
 * - 真正可执行的内容在 DefinitionRelease 中（发布后不可变）
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

export type DefinitionReleaseStatus = 'published' | 'deprecated';

/**
 * DefinitionRelease：发布物（冻结、append-only）。
 *
 * 约束：
 * - `definitionHash` 全局唯一
 * - 发布后禁止覆盖更新；改动只能再次 publish 生成新 definitionHash
 */
export interface DefinitionRelease {
  definitionId: string;
  definitionHash: string;
  status: DefinitionReleaseStatus;
  content: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  runnerConfig: Record<string, unknown> | null;
  changelog: string | null;
  publishedAt: Date;
  publishedBy: string | null;
  deprecatedAt: Date | null;
  deprecatedReason: string | null;
}
