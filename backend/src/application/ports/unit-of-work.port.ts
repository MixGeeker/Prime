import type { DefinitionDraftRepositoryPort } from './definition-draft-repository.port';
import type { DefinitionReleaseRepositoryPort } from './definition-release-repository.port';
import type { JobRepositoryPort } from './job-repository.port';
import type { OutboxRepositoryPort } from './outbox-repository.port';

export const UNIT_OF_WORK = Symbol('UnitOfWorkPort');

/**
 * 事务工作单元（Unit of Work）端口。
 *
 * 用于把 “jobs + outbox（以及其他写入）” 放到同一个 DB 事务中。
 * MQ ack 时机必须发生在事务提交之后（M6 会严格实现）。
 */
export interface UnitOfWorkRepos {
  draftRepo: DefinitionDraftRepositoryPort;
  releaseRepo: DefinitionReleaseRepositoryPort;
  jobRepo: JobRepositoryPort;
  outboxRepo: OutboxRepositoryPort;
}

export interface UnitOfWorkPort {
  runInTransaction<T>(work: (repos: UnitOfWorkRepos) => Promise<T>): Promise<T>;
}
