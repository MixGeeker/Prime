import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 初始化 schema（无生产数据，按“蓝图控制流 + definitionHash 发布物”重建）。
 *
 * Tables:
 * - definitions / definition_drafts / definition_releases
 * - jobs（幂等存根 + 结果存档）/ outbox（可靠发布）
 */
export class InitBlueprintEngine1772496000000 implements MigrationInterface {
  name = 'InitBlueprintEngine1772496000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "definitions" (
        "definition_id" text NOT NULL,
        "latest_definition_hash" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_definitions_definition_id" PRIMARY KEY ("definition_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "definition_drafts" (
        "definition_id" text NOT NULL,
        "draft_revision_id" text NOT NULL,
        "content_type" text NOT NULL,
        "content_json" jsonb NOT NULL,
        "output_schema_json" jsonb,
        "runner_config_json" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_definition_drafts_definition_id" PRIMARY KEY ("definition_id"),
        CONSTRAINT "FK_definition_drafts_definition_id" FOREIGN KEY ("definition_id") REFERENCES "definitions"("definition_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "definition_releases" (
        "definition_hash" text NOT NULL,
        "definition_id" text NOT NULL,
        "status" text NOT NULL,
        "content_json" jsonb NOT NULL,
        "output_schema_json" jsonb,
        "runner_config_json" jsonb,
        "changelog" text,
        "published_at" timestamptz NOT NULL,
        "published_by" text,
        "deprecated_at" timestamptz,
        "deprecated_reason" text,
        CONSTRAINT "PK_definition_releases_definition_hash" PRIMARY KEY ("definition_hash"),
        CONSTRAINT "FK_definition_releases_definition_id" FOREIGN KEY ("definition_id") REFERENCES "definitions"("definition_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "jobs" (
        "job_id" text NOT NULL,
        "request_hash" text NOT NULL,
        "message_id" text,
        "correlation_id" text,
        "definition_id" text NOT NULL,
        "definition_hash_used" text NOT NULL,
        "inputs_hash" text,
        "outputs_hash" text,
        "status" text NOT NULL,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "computed_at" timestamptz,
        "failed_at" timestamptz,
        "inputs_snapshot_json" jsonb,
        "outputs_json" jsonb,
        "error_code" text,
        "error_message" text,
        CONSTRAINT "PK_jobs_job_id" PRIMARY KEY ("job_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "outbox" (
        "id" text NOT NULL,
        "event_type" text NOT NULL,
        "routing_key" text NOT NULL,
        "payload_json" jsonb NOT NULL,
        "headers_json" jsonb NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "locked_at" timestamptz,
        "locked_by" text,
        "next_retry_at" timestamptz,
        "last_error" text,
        "attempts" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_outbox_id" PRIMARY KEY ("id")
      )
    `);

    // 常用索引（dispatcher/运维/retention）
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_status_next_retry" ON "outbox" ("status", "next_retry_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_status_updated_at" ON "outbox" ("status", "updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_status_requested_at" ON "jobs" ("status", "requested_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_computed_at" ON "jobs" ("computed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_failed_at" ON "jobs" ("failed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_definition_drafts_updated_at" ON "definition_drafts" ("updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_definition_releases_definition_id_published_at" ON "definition_releases" ("definition_id", "published_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_definition_releases_definition_id_status_published_at" ON "definition_releases" ("definition_id", "status", "published_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_definition_releases_definition_id_status_published_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_definition_releases_definition_id_published_at"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_definition_drafts_updated_at"`);
    await queryRunner.query(`DROP INDEX "IDX_jobs_failed_at"`);
    await queryRunner.query(`DROP INDEX "IDX_jobs_computed_at"`);
    await queryRunner.query(`DROP INDEX "IDX_jobs_status_requested_at"`);
    await queryRunner.query(`DROP INDEX "IDX_outbox_status_updated_at"`);
    await queryRunner.query(`DROP INDEX "IDX_outbox_status_next_retry"`);

    await queryRunner.query(`DROP TABLE "outbox"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`DROP TABLE "definition_releases"`);
    await queryRunner.query(`DROP TABLE "definition_drafts"`);
    await queryRunner.query(`DROP TABLE "definitions"`);
  }
}
