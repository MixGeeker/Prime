import type { EntityManager } from 'typeorm';
import type {
  DefinitionListCursor,
  DefinitionRepositoryPort,
  DefinitionSummary,
  ListDefinitionsParams,
} from '../../../../../application/ports/definition-repository.port';

type Row = {
  definition_id: string;
  created_at: Date;
  updated_at: Date;
  latest_definition_hash: string | null;
  latest_status: string | null;
  latest_published_at: Date | null;
  draft_revision_id: string | null;
  draft_content_type: string | null;
  draft_updated_at: Date | null;
};

function toCursor(params: ListDefinitionsParams): DefinitionListCursor | null {
  return params.cursor ?? null;
}

export class TypeOrmDefinitionRepository implements DefinitionRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async listDefinitions(
    params: ListDefinitionsParams,
  ): Promise<DefinitionSummary[]> {
    const q = (params.q ?? '').trim();
    const qOrNull = q.length > 0 ? q : null;

    const limit = Math.max(1, Math.min(params.limit, 500));
    const cursor = toCursor(params);
    const cursorUpdatedAt = cursor?.updatedAt ?? null;
    const cursorDefinitionId = cursor?.definitionId ?? null;

    const rows: unknown = await this.manager.query(
      `
        WITH rows AS (
          SELECT
            d.definition_id,
            d.created_at,
            GREATEST(d.updated_at, COALESCE(dr.updated_at, d.updated_at)) AS updated_at,
            d.latest_definition_hash,
            rr.status AS latest_status,
            rr.published_at AS latest_published_at,
            dr.draft_revision_id,
            dr.content_type AS draft_content_type,
            dr.updated_at AS draft_updated_at
          FROM definitions d
          LEFT JOIN definition_drafts dr
            ON dr.definition_id = d.definition_id
          LEFT JOIN definition_releases rr
            ON rr.definition_hash = d.latest_definition_hash
          WHERE ($1::text IS NULL OR d.definition_id ILIKE ('%' || $1 || '%'))
        )
        SELECT *
        FROM rows
        WHERE (
          $2::timestamptz IS NULL
          OR updated_at < $2
          OR (updated_at = $2 AND definition_id < $3)
        )
        ORDER BY updated_at DESC, definition_id DESC
        LIMIT $4
      `,
      [qOrNull, cursorUpdatedAt, cursorDefinitionId, limit],
    );

    if (!Array.isArray(rows)) {
      return [];
    }

    return (rows as Row[]).map((r) => ({
      definitionId: r.definition_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      latestDefinitionHash: r.latest_definition_hash,
      latestStatus:
        (r.latest_status as DefinitionSummary['latestStatus']) ?? null,
      latestPublishedAt: r.latest_published_at ?? null,
      draftRevisionId: r.draft_revision_id,
      draftContentType:
        (r.draft_content_type as DefinitionSummary['draftContentType']) ?? null,
      draftUpdatedAt: r.draft_updated_at ?? null,
    }));
  }
}
