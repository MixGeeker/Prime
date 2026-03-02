import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CloseoutM1M4AuditFields1772400000000 implements MigrationInterface {
  name = 'CloseoutM1M4AuditFields1772400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "definition_drafts"
      ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      ALTER TABLE "definition_versions"
      ADD COLUMN "deprecated_at" timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE "definition_versions"
      ADD COLUMN "deprecated_reason" text
    `);

    await queryRunner.query(`
      ALTER TABLE "jobs"
      ADD COLUMN "failed_at" timestamptz
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_status_requested_at" ON "jobs" ("status", "requested_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_definition_versions_definition_status_version" ON "definition_versions" ("definition_id", "status", "version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_definition_versions_definition_status_version"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_jobs_status_requested_at"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "failed_at"`);
    await queryRunner.query(
      `ALTER TABLE "definition_versions" DROP COLUMN "deprecated_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "definition_versions" DROP COLUMN "deprecated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "definition_drafts" DROP COLUMN "created_at"`,
    );
  }
}
