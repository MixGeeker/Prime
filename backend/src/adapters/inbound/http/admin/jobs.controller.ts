/**
 * Admin Jobs 查询接口（入站适配器）。
 *
 * 职责：
 * - 按 jobId 查询一次 job 的执行状态/结果（用于对账/排障）
 */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetJobUseCase } from '../../../../application/use-cases/get-job.use-case';
import { ListJobsUseCase } from '../../../../application/use-cases/list-jobs.use-case';
import { UseCaseError } from '../../../../application/use-cases/use-case.error';
import type { JobListCursor } from '../../../../application/ports/job-repository.port';
import { ListJobsQueryDto } from './dto/jobs.dto';

@Controller('/admin/jobs')
@ApiTags('admin')
export class AdminJobsController {
  constructor(
    private readonly getJobUseCase: GetJobUseCase,
    private readonly listJobsUseCase: ListJobsUseCase,
  ) {}

  @Get()
  async listJobs(@Query() query: ListJobsQueryDto) {
    const cursor = query.cursor ? decodeJobCursor(query.cursor) : null;
    const since = query.since ? parseIsoDate(query.since, 'since') : null;
    const until = query.until ? parseIsoDate(query.until, 'until') : null;

    const result = await this.listJobsUseCase.execute({
      limit: query.limit ?? 50,
      cursor,
      status: query.status ?? null,
      definitionId: query.definitionId ?? null,
      definitionHashUsed: query.definitionHashUsed ?? null,
      since,
      until,
    });

    return {
      items: result.items,
      nextCursor: result.nextCursor ? encodeJobCursor(result.nextCursor) : null,
    };
  }

  @Get(':jobId')
  async getJob(@Param('jobId') jobId: string) {
    try {
      return await this.getJobUseCase.execute(jobId);
    } catch (error) {
      if (error instanceof UseCaseError) {
        if (error.code === 'JOB_NOT_FOUND') {
          throw new NotFoundException({
            code: error.code,
            message: error.message,
          });
        }
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }
  }
}

function encodeJobCursor(cursor: JobListCursor): string {
  const payload = {
    requestedAt: cursor.requestedAt.toISOString(),
    jobId: cursor.jobId,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeJobCursor(value: string): JobListCursor {
  try {
    const raw = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error('cursor is not an object');
    }

    const requestedAt =
      typeof parsed['requestedAt'] === 'string'
        ? new Date(parsed['requestedAt'])
        : null;
    const jobId = typeof parsed['jobId'] === 'string' ? parsed['jobId'] : null;

    if (!requestedAt || Number.isNaN(requestedAt.getTime()) || !jobId) {
      throw new Error('cursor fields invalid');
    }

    return { requestedAt, jobId };
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'invalid cursor',
    });
  }
}

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: `invalid ${field}`,
    });
  }
  return date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
