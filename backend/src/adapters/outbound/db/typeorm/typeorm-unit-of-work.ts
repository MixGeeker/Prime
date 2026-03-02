import type {
  UnitOfWorkPort,
  UnitOfWorkRepos,
} from '../../../../application/ports/unit-of-work.port';
import type { DataSource } from 'typeorm';
import { TypeOrmDraftRepository } from './repositories/typeorm-draft.repository';
import { TypeOrmJobRepository } from './repositories/typeorm-job.repository';
import { TypeOrmOutboxRepository } from './repositories/typeorm-outbox.repository';
import { TypeOrmReleaseRepository } from './repositories/typeorm-release.repository';

/**
 * UnitOfWork 的 TypeORM 实现：
 * - 通过 `DataSource.transaction` 提供事务边界
 * - 在同一事务的 EntityManager 下构造各 repository
 */
export class TypeOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly dataSource: DataSource) {}

  async runInTransaction<T>(
    work: (repos: UnitOfWorkRepos) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const repos: UnitOfWorkRepos = {
        draftRepo: new TypeOrmDraftRepository(manager),
        releaseRepo: new TypeOrmReleaseRepository(manager),
        jobRepo: new TypeOrmJobRepository(manager),
        outboxRepo: new TypeOrmOutboxRepository(manager),
      };

      return work(repos);
    });
  }
}
