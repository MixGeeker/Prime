import type {
  DefinitionRelease,
  DefinitionReleaseStatus,
} from '../../domain/definition/definition';

export const DEFINITION_RELEASE_REPOSITORY = Symbol(
  'DefinitionReleaseRepositoryPort',
);

/**
 * Published DefinitionRelease（Release）仓储端口（outbound）。
 *
 * 约束：
 * - Release 是 append-only：发布后不可覆盖更新
 * - `definitionHash` 全局唯一（同一个 definitionId 也允许多次发布）
 */
export interface InsertDefinitionReleaseParams {
  definitionId: string;
  definitionHash: string;
  status: DefinitionReleaseStatus;
  content: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  runnerConfig: Record<string, unknown> | null;
  changelog: string | null;
  publishedAt: Date;
  publishedBy: string | null;
}

export interface DefinitionReleaseRepositoryPort {
  getRelease(
    definitionId: string,
    definitionHash: string,
  ): Promise<DefinitionRelease | null>;
  listReleases(definitionId: string): Promise<DefinitionRelease[]>;
  insertRelease(params: InsertDefinitionReleaseParams): Promise<void>;
  deprecateRelease(params: {
    definitionId: string;
    definitionHash: string;
    reason: string | null;
    deprecatedAt: Date;
  }): Promise<DefinitionRelease | null>;
}

