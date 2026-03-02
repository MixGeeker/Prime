import 'reflect-metadata';

/**
 * TypeORM DataSource（仅供 migration CLI 使用）。
 *
 * 说明：
 * - Nest 应用运行时使用 `DbModule` 动态配置（TypeOrmModule.forRootAsync）
 * - 迁移命令需要一个独立的 DataSource 文件
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { DefinitionDraftEntity } from './entities/definition-draft.entity';
import { DefinitionEntity } from './entities/definition.entity';
import { DefinitionReleaseEntity } from './entities/definition-release.entity';
import { JobEntity } from './entities/job.entity';
import { OutboxEntity } from './entities/outbox.entity';
import { InitBlueprintEngine0000000000000 } from './migrations/0000000000000-InitBlueprintEngine';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export const ComputeEngineDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [
    DefinitionEntity,
    DefinitionDraftEntity,
    DefinitionReleaseEntity,
    JobEntity,
    OutboxEntity,
  ],
  // 显式注册 migrations，避免运行时扫描导致顺序不一致。
  migrations: [InitBlueprintEngine0000000000000],
  synchronize: false,
  migrationsRun: false,
});

export default ComputeEngineDataSource;
