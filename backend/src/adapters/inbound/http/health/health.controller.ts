import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

@Controller()
@ApiTags('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  /** 基础健康检查：不探测外部依赖，仅用于“进程活着”。 */
  @Get('/health')
  getHealth() {
    return {
      ok: true,
      service: 'compute-engine',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 就绪检查：M0 阶段不强制连通 DB/MQ，只返回是否配置。
   * 后续可以扩展为真正的依赖探测（例如 DB ping / MQ ping）。
   */
  @Get('/ready')
  @ApiExcludeEndpoint()
  getReady() {
    const hasDbConfig = Boolean(this.configService.get<string>('DATABASE_URL'));
    const hasMqConfig = Boolean(this.configService.get<string>('RABBITMQ_URL'));

    return {
      ok: true,
      dependencies: {
        db: hasDbConfig ? 'configured' : 'skipped',
        mq: hasMqConfig ? 'configured' : 'skipped',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
