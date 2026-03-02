import type {
  DefinitionVersion,
  DefinitionVersionStatus,
} from '../../domain/definition/definition';

export const DEFINITION_VERSION_REPOSITORY = Symbol(
  'DefinitionVersionRepositoryPort',
);

/**
 * Published DefinitionVersion 仓储端口（outbound）。
 *
 * 约束：
 * - 版本是 append-only：发布后不可覆盖更新
 * - `(definitionId, version)` 唯一
 */
export interface InsertDefinitionVersionParams {
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
}

export interface DefinitionVersionRepositoryPort {
  getVersion(
    definitionId: string,
    version: number,
  ): Promise<DefinitionVersion | null>;
  listVersions(definitionId: string): Promise<DefinitionVersion[]>;
  insertVersion(params: InsertDefinitionVersionParams): Promise<void>;
  deprecateVersion(params: {
    definitionId: string;
    version: number;
    reason: string | null;
    deprecatedAt: Date;
  }): Promise<DefinitionVersion | null>;
}
