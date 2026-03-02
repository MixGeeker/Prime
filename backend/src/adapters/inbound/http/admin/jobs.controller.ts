import {
  Controller,
  Get,
  NotImplementedException,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Jobs Admin API（占位）。
 *
 * M4 会实现 `GET /admin/jobs/:jobId`，用于运维对账/排障查询。
 */
@Controller('/admin/jobs')
@ApiTags('admin')
export class AdminJobsController {
  @Get(':jobId')
  getJob(@Param('jobId') _jobId: string) {
    throw new NotImplementedException('M0 scaffold: implemented in M4');
  }
}
