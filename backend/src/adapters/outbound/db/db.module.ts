import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  DEFINITION_DRAFT_REPOSITORY,
  type DefinitionDraftRepositoryPort,
} from '../../../application/ports/definition-draft-repository.port';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../../../application/ports/definition-version-repository.port';
import {
  JOB_REPOSITORY,
  type JobRepositoryPort,
} from '../../../application/ports/job-repository.port';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepositoryPort,
} from '../../../application/ports/outbox-repository.port';
import { UNIT_OF_WORK } from '../../../application/ports/unit-of-work.port';
import { DefinitionDraftEntity } from './typeorm/entities/definition-draft.entity';
import { DefinitionEntity } from './typeorm/entities/definition.entity';
import { DefinitionVersionEntity } from './typeorm/entities/definition-version.entity';
import { JobEntity } from './typeorm/entities/job.entity';
import { OutboxEntity } from './typeorm/entities/outbox.entity';
import { TypeOrmDraftRepository } from './typeorm/repositories/typeorm-draft.repository';
import { TypeOrmJobRepository } from './typeorm/repositories/typeorm-job.repository';
import { TypeOrmOutboxRepository } from './typeorm/repositories/typeorm-outbox.repository';
import { TypeOrmVersionRepository } from './typeorm/repositories/typeorm-version.repository';
import { TypeOrmUnitOfWork } from './typeorm/typeorm-unit-of-work';

/**
 * DB outbound 适配器模块（PostgreSQL + TypeORM）。
 *
 * 说明：
 * - `synchronize=false`：严格用 migrations 管理 schema，避免生产事故
 * - repository 实现通过 ports 暴露给 application/use-cases
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is required');
        }

        return {
          type: 'postgres' as const,
          url: databaseUrl,
          // 显式列出 entities，避免 glob 误匹配与构建路径差异。
          entities: [
            DefinitionEntity,
            DefinitionDraftEntity,
            DefinitionVersionEntity,
            JobEntity,
            OutboxEntity,
          ],
          synchronize: false,
          migrationsRun: false,
        };
      },
    }),
  ],
  providers: [
    // 将具体实现绑定到 ports（application 层只依赖端口，不依赖 TypeORM/Nest）。
    {
      provide: DEFINITION_DRAFT_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource): DefinitionDraftRepositoryPort =>
        new TypeOrmDraftRepository(dataSource.manager),
    },
    {
      provide: DEFINITION_VERSION_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource): DefinitionVersionRepositoryPort =>
        new TypeOrmVersionRepository(dataSource.manager),
    },
    {
      provide: JOB_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource): JobRepositoryPort =>
        new TypeOrmJobRepository(dataSource.manager),
    },
    {
      provide: OUTBOX_REPOSITORY,
      inject: [DataSource],
      useFactory: (dataSource: DataSource): OutboxRepositoryPort =>
        new TypeOrmOutboxRepository(dataSource.manager),
    },
    {
      provide: UNIT_OF_WORK,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new TypeOrmUnitOfWork(dataSource),
    },
  ],
  exports: [
    DEFINITION_DRAFT_REPOSITORY,
    DEFINITION_VERSION_REPOSITORY,
    JOB_REPOSITORY,
    OUTBOX_REPOSITORY,
    UNIT_OF_WORK,
  ],
})
export class DbModule {}
