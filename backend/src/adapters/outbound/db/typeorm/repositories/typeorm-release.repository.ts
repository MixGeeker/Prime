import type { EntityManager } from 'typeorm';
import type {
  DefinitionReleaseRepositoryPort,
  InsertDefinitionReleaseParams,
} from '../../../../../application/ports/definition-release-repository.port';
import type { DefinitionRelease } from '../../../../../domain/definition/definition';
import { DefinitionReleaseEntity } from '../entities/definition-release.entity';
import { unwrapReturningRows } from './typeorm-query-result';

/**
 * ReleaseRepo 的 TypeORM 实现（PostgreSQL）。
 *
 * 说明：
 * - 发布物是 append-only：这里只提供 insert，不提供覆盖更新
 * - 使用原生 SQL 写入，避免 TypeORM 对 jsonb 的类型推断问题
 */
export class TypeOrmReleaseRepository implements DefinitionReleaseRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async getRelease(
    definitionId: string,
    definitionHash: string,
  ): Promise<DefinitionRelease | null> {
    const row = await this.manager
      .getRepository(DefinitionReleaseEntity)
      .findOne({
        where: { definitionId, definitionHash },
      });
    if (!row) {
      return null;
    }
    return {
      definitionId: row.definitionId,
      definitionHash: row.definitionHash,
      status: row.status as DefinitionRelease['status'],
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

  async listReleases(definitionId: string): Promise<DefinitionRelease[]> {
    const rows = await this.manager
      .getRepository(DefinitionReleaseEntity)
      .find({
        where: { definitionId },
        order: { publishedAt: 'DESC' },
      });
    return rows.map((row) => ({
      definitionId: row.definitionId,
      definitionHash: row.definitionHash,
      status: row.status as DefinitionRelease['status'],
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

  async insertRelease(params: InsertDefinitionReleaseParams): Promise<void> {
    // 确保 definitions 行存在（避免 release 外键失败）。
    await this.manager.query(
      `INSERT INTO definitions (definition_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [params.definitionId],
    );

    // append-only：不使用 ON CONFLICT UPDATE；冲突应视为发布流程错误。
    await this.manager.query(
      `
        INSERT INTO definition_releases (
          definition_hash,
          definition_id,
          status,
          content_json,
          output_schema_json,
          runner_config_json,
          changelog,
          published_at,
          published_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        params.definitionHash,
        params.definitionId,
        params.status,
        params.content,
        params.outputSchema,
        params.runnerConfig,
        params.changelog,
        params.publishedAt,
        params.publishedBy,
      ],
    );

    // 维护 latest 指针（用于 UI/运维与 publish 冻结子蓝图引用）。
    await this.manager.query(
      `
        UPDATE definitions
        SET latest_definition_hash = $2, updated_at = now()
        WHERE definition_id = $1
      `,
      [params.definitionId, params.definitionHash],
    );
  }

  async deprecateRelease(params: {
    definitionId: string;
    definitionHash: string;
    reason: string | null;
    deprecatedAt: Date;
  }): Promise<DefinitionRelease | null> {
    const updateResult: unknown = await this.manager.query(
      `
        UPDATE definition_releases
        SET
          status = 'deprecated',
          deprecated_at = $3,
          deprecated_reason = $4
        WHERE definition_id = $1
          AND definition_hash = $2
        RETURNING definition_hash
      `,
      [
        params.definitionId,
        params.definitionHash,
        params.deprecatedAt,
        params.reason,
      ],
    );

    const rows = unwrapReturningRows<{ definition_hash: string }>(updateResult);
    if (rows.length === 0) {
      return null;
    }

    return this.getRelease(params.definitionId, params.definitionHash);
  }
}
