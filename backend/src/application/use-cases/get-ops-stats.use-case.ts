import { Inject, Injectable } from '@nestjs/common';
import type { JobStatus } from '../../domain/job/job';
import {
  JOB_REPOSITORY,
  type JobRepositoryPort,
} from '../ports/job-repository.port';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepositoryPort,
} from '../ports/outbox-repository.port';

export interface OpsStatsQuery {
  outboxMaxAttempts: number;
  /** 可选：仅统计最近窗口内的 jobs（requestedAt >= since）。 */
  jobsSince?: Date | null;
}

@Injectable()
export class GetOpsStatsUseCase {
  constructor(
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepositoryPort,
    @Inject(JOB_REPOSITORY) private readonly jobRepository: JobRepositoryPort,
  ) {}

  async execute(query: OpsStatsQuery) {
    const maxAttempts = Math.max(1, Math.min(query.outboxMaxAttempts, 10_000));

    const [outboxPending, outboxFailed, jobCounts] = await Promise.all([
      this.outboxRepository.countPending(),
      this.outboxRepository.countFailed({ maxAttempts }),
      this.jobRepository.countByStatus({ since: query.jobsSince ?? null }),
    ]);

    const jobs: Record<JobStatus, number> = {
      requested: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const row of jobCounts) {
      if (row.status in jobs) {
        jobs[row.status] = row.count;
      }
    }

    return {
      now: new Date(),
      outbox: {
        pending: outboxPending,
        failed: outboxFailed,
      },
      jobs,
    };
  }
}
