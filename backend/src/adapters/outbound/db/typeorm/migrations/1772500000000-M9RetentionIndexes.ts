import type { MigrationInterface, QueryRunner } from 'typeorm';

export class M9RetentionIndexes1772500000000 implements MigrationInterface {
  name = 'M9RetentionIndexes1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_status_updated_at" ON "outbox" ("status", "updated_at")`,
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_definition_drafts_updated_at"`);
    await queryRunner.query(`DROP INDEX "IDX_jobs_failed_at"`);
    await queryRunner.query(`DROP INDEX "IDX_jobs_computed_at"`);
    await queryRunner.query(`DROP INDEX "IDX_outbox_status_updated_at"`);
  }
}
