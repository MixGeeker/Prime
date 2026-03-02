import { Inject, Injectable } from '@nestjs/common';
import {
  JOB_REPOSITORY,
  type JobRepositoryPort,
} from '../ports/job-repository.port';
import { UseCaseError } from './use-case.error';

@Injectable()
export class GetJobUseCase {
  constructor(
    @Inject(JOB_REPOSITORY)
    private readonly jobRepository: JobRepositoryPort,
  ) {}

  async execute(jobId: string) {
    const job = await this.jobRepository.getJob(jobId);
    if (!job) {
      throw new UseCaseError('JOB_NOT_FOUND', `job not found: ${jobId}`);
    }

    return {
      jobId: job.jobId,
      status: job.status,
      definitionRefUsed: {
        definitionId: job.definitionId,
        version: job.versionUsed,
      },
      definitionHash: job.definitionHash,
      inputsHash: job.inputsHash,
      outputs: job.outputs,
      outputsHash: job.outputsHash,
      error:
        job.errorCode || job.errorMessage
          ? {
              code: job.errorCode ?? 'UNKNOWN',
              message: job.errorMessage ?? 'job failed',
            }
          : null,
      requestedAt: job.requestedAt.toISOString(),
      computedAt: job.computedAt?.toISOString() ?? null,
      failedAt: job.failedAt?.toISOString() ?? null,
    };
  }
}
