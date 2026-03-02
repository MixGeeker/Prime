import type { EntityManager } from 'typeorm';
import type {
  DefinitionVersionRepositoryPort,
  InsertDefinitionVersionParams,
} from '../../../../../application/ports/definition-version-repository.port';
import type { DefinitionVersion } from '../../../../../domain/definition/definition';
import { DefinitionVersionEntity } from '../entities/definition-version.entity';

/**
 * VersionRepo 的 TypeORM 实现（PostgreSQL）。
 *
 * 说明：
 * - 发布版本是 append-only：这里只提供 insert，不提供 update
 * - 使用原生 SQL 写入，避免 TypeORM 对 jsonb 的类型推断问题
 */
export class TypeOrmVersionRepository implements DefinitionVersionRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async getVersion(
    definitionId: string,
    version: number,
  ): Promise<DefinitionVersion | null> {
    const row = await this.manager
      .getRepository(DefinitionVersionEntity)
      .findOne({
        where: { definitionId, version },
      });
    if (!row) {
      return null;
    }
    return {
      definitionId: row.definitionId,
      version: row.version,
      status: row.status as DefinitionVersion['status'],
      definitionHash: row.definitionHash,
      content: row.contentJson,
      outputSchema: row.outputSchemaJson ?? null,
      runnerConfig: row.runnerConfigJson ?? null,
      changelog: row.changelog ?? null,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy ?? null,
      deprecatedAt: row.deprecatedAt ?? null,
      deprecatedReason: row.deprecatedReason ?? null,
    };
  }

  async listVersions(definitionId: string): Promise<DefinitionVersion[]> {
    const rows = await this.manager
      .getRepository(DefinitionVersionEntity)
      .find({
        where: { definitionId },
        order: { version: 'ASC' },
      });
    return rows.map((row) => ({
      definitionId: row.definitionId,
      version: row.version,
      status: row.status as DefinitionVersion['status'],
      definitionHash: row.definitionHash,
      content: row.contentJson,
      outputSchema: row.outputSchemaJson ?? null,
      runnerConfig: row.runnerConfigJson ?? null,
      changelog: row.changelog ?? null,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy ?? null,
      deprecatedAt: row.deprecatedAt ?? null,
      deprecatedReason: row.deprecatedReason ?? null,
    }));
  }

  async insertVersion(params: InsertDefinitionVersionParams): Promise<void> {
    // 确保 definitions 行存在（避免版本外键失败）。
    await this.manager.query(
      `INSERT INTO definitions (definition_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [params.definitionId],
    );

    // append-only：不使用 ON CONFLICT UPDATE；冲突应视为发布流程错误。
    await this.manager.query(
      `
        INSERT INTO definition_versions (
          definition_id,
          version,
          status,
          definition_hash,
          content_json,
          output_schema_json,
          runner_config_json,
          changelog,
          published_at,
          published_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        params.definitionId,
        params.version,
        params.status,
        params.definitionHash,
        params.content,
        params.outputSchema,
        params.runnerConfig,
        params.changelog,
        params.publishedAt,
        params.publishedBy,
      ],
    );
  }

  async deprecateVersion(params: {
    definitionId: string;
    version: number;
    reason: string | null;
    deprecatedAt: Date;
  }): Promise<DefinitionVersion | null> {
    const updateResult: unknown = await this.manager.query(
      `
        UPDATE definition_versions
        SET
          status = 'deprecated',
          deprecated_at = $3,
          deprecated_reason = $4
        WHERE definition_id = $1
          AND version = $2
        RETURNING definition_id, version
      `,
      [params.definitionId, params.version, params.deprecatedAt, params.reason],
    );

    if (!Array.isArray(updateResult) || updateResult.length === 0) {
      return null;
    }

    return this.getVersion(params.definitionId, params.version);
  }
}
