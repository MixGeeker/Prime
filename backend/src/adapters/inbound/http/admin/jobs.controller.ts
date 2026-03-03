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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetJobUseCase } from '../../../../application/use-cases/get-job.use-case';
import { UseCaseError } from '../../../../application/use-cases/use-case.error';

@Controller('/admin/jobs')
@ApiTags('admin')
export class AdminJobsController {
  constructor(private readonly getJobUseCase: GetJobUseCase) {}

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
