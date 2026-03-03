import { Inject, Injectable } from '@nestjs/common';
import {
  JOB_REPOSITORY,
  type JobListCursor,
  type JobRepositoryPort,
} from '../ports/job-repository.port';
import type { JobStatus } from '../../domain/job/job';

export interface ListJobsQuery {
  limit: number;
  cursor?: JobListCursor | null;
  status?: JobStatus | null;
  definitionId?: string | null;
  definitionHashUsed?: string | null;
  since?: Date | null;
  until?: Date | null;
}

@Injectable()
export class ListJobsUseCase {
  constructor(
    @Inject(JOB_REPOSITORY) private readonly jobRepository: JobRepositoryPort,
  ) {}

  async execute(query: ListJobsQuery) {
    const limit = Math.max(1, Math.min(query.limit, 200));

    const itemsPlusOne = await this.jobRepository.listJobs({
      limit: limit + 1,
      cursor: query.cursor ?? null,
      status: query.status ?? null,
      definitionId: query.definitionId ?? null,
      definitionHashUsed: query.definitionHashUsed ?? null,
      since: query.since ?? null,
      until: query.until ?? null,
    });

    if (itemsPlusOne.length <= limit) {
      return { items: itemsPlusOne, nextCursor: null as JobListCursor | null };
    }

    const items = itemsPlusOne.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: {
        requestedAt: last.requestedAt,
        jobId: last.jobId,
      } satisfies JobListCursor,
    };
  }
}
