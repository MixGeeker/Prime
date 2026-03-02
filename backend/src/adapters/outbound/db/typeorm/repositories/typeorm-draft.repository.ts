import type { DefinitionDraftRepositoryPort } from '../../../../../application/ports/definition-draft-repository.port';
import type { UpsertDefinitionDraftParams } from '../../../../../application/ports/definition-draft-repository.port';
import type { DefinitionDraft } from '../../../../../domain/definition/definition';
import { EntityManager } from 'typeorm';
import { DefinitionDraftEntity } from '../entities/definition-draft.entity';

/**
 * DraftRepo 的 TypeORM 实现（PostgreSQL）。
 *
 * 说明：
 * - `upsert` 采用原生 SQL 的 `ON CONFLICT`，保证语义清晰且避免 TypeORM 对 jsonb 的类型推断问题
 * - 写 draft 前先确保 definitions 存在（FK 约束）
 */
export class TypeOrmDraftRepository implements DefinitionDraftRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async getDraft(definitionId: string): Promise<DefinitionDraft | null> {
    const row = await this.manager
      .getRepository(DefinitionDraftEntity)
      .findOne({
        where: { definitionId },
      });
    if (!row) {
      return null;
    }
    return {
      definitionId: row.definitionId,
      draftRevisionId: row.draftRevisionId,
      contentType: row.contentType as DefinitionDraft['contentType'],
      content: row.contentJson,
      outputSchema: row.outputSchemaJson ?? null,
      runnerConfig: row.runnerConfigJson ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsertDraft(
    params: UpsertDefinitionDraftParams,
  ): Promise<DefinitionDraft> {
    // 确保 definitions 行存在（避免 draft 外键失败）。
    await this.manager.query(
      `INSERT INTO definitions (definition_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [params.definitionId],
    );

    // upsert draft（M4 会在这里补充 draftRevisionId 的并发控制逻辑）。
    await this.manager.query(
      `
        INSERT INTO definition_drafts (
          definition_id,
          draft_revision_id,
          content_type,
          content_json,
          output_schema_json,
          runner_config_json,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (definition_id) DO UPDATE SET
          draft_revision_id = EXCLUDED.draft_revision_id,
          content_type = EXCLUDED.content_type,
          content_json = EXCLUDED.content_json,
          output_schema_json = EXCLUDED.output_schema_json,
          runner_config_json = EXCLUDED.runner_config_json,
          updated_at = now()
      `,
      [
        params.definitionId,
        params.draftRevisionId,
        params.contentType,
        params.content,
        params.outputSchema,
        params.runnerConfig,
      ],
    );

    const saved = await this.getDraft(params.definitionId);
    if (!saved) {
      throw new Error('Draft upsert failed');
    }
    return saved;
  }

  async deleteDraft(definitionId: string): Promise<void> {
    await this.manager
      .getRepository(DefinitionDraftEntity)
      .delete({ definitionId });
  }
}
