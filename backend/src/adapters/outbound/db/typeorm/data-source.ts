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
import { DefinitionVersionEntity } from './entities/definition-version.entity';
import { JobEntity } from './entities/job.entity';
import { OutboxEntity } from './entities/outbox.entity';
import { InitComputeEngineM11772323541439 } from './migrations/1772323541439-InitComputeEngineM1';

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
    DefinitionVersionEntity,
    JobEntity,
    OutboxEntity,
  ],
  // 显式注册 migrations，避免运行时扫描导致顺序不一致。
  migrations: [InitComputeEngineM11772323541439],
  synchronize: false,
  migrationsRun: false,
});

export default ComputeEngineDataSource;
