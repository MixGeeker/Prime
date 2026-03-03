import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { GetOpsStatsUseCase } from '../../../../application/use-cases/get-ops-stats.use-case';
import { OpsStatsQueryDto } from './dto/ops.dto';

@Controller('/admin/ops')
@ApiTags('admin')
export class AdminOpsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly getOpsStatsUseCase: GetOpsStatsUseCase,
  ) {}

  @Get('stats')
  async stats(@Query() query: OpsStatsQueryDto) {
    const hours =
      typeof query.jobsSinceHours === 'number' ? query.jobsSinceHours : 24;
    const jobsSince =
      hours > 0 ? new Date(Date.now() - hours * 60 * 60 * 1000) : null;

    const maxAttempts =
      this.configService.get<number>('OUTBOX_DISPATCH_MAX_ATTEMPTS') ?? 25;

    const result = await this.getOpsStatsUseCase.execute({
      outboxMaxAttempts: maxAttempts,
      jobsSince,
    });

    return {
      ...result,
      window: { jobsSinceHours: hours },
    };
  }
}
