import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M1 初始化 schema：
 * - definitions / definition_drafts / definition_versions
 * - jobs（幂等存根）/ outbox（可靠发布）
 */
export class InitComputeEngineM11772323541439 implements MigrationInterface {
  name = 'InitComputeEngineM11772323541439';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "definitions" (
        "definition_id" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
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
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_definition_drafts_definition_id" PRIMARY KEY ("definition_id"),
        CONSTRAINT "FK_definition_drafts_definition_id" FOREIGN KEY ("definition_id") REFERENCES "definitions"("definition_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "definition_versions" (
        "definition_id" text NOT NULL,
        "version" int NOT NULL,
        "status" text NOT NULL,
        "definition_hash" text NOT NULL,
        "content_json" jsonb NOT NULL,
        "output_schema_json" jsonb,
        "runner_config_json" jsonb,
        "changelog" text,
        "published_at" timestamptz NOT NULL,
        "published_by" text,
        CONSTRAINT "PK_definition_versions" PRIMARY KEY ("definition_id", "version"),
        CONSTRAINT "FK_definition_versions_definition_id" FOREIGN KEY ("definition_id") REFERENCES "definitions"("definition_id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "jobs" (
        "job_id" text NOT NULL,
        "request_hash" text NOT NULL,
        "message_id" text,
        "correlation_id" text,
        "definition_id" text NOT NULL,
        "version_used" int NOT NULL,
        "definition_hash" text,
        "inputs_hash" text,
        "outputs_hash" text,
        "status" text NOT NULL,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "computed_at" timestamptz,
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

    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_status_next_retry" ON "outbox" ("status", "next_retry_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_outbox_status_next_retry"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`DROP TABLE "definition_versions"`);
    await queryRunner.query(`DROP TABLE "definition_drafts"`);
    await queryRunner.query(`DROP TABLE "definitions"`);
  }
}
