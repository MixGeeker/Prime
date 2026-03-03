import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { ReadinessService } from './readiness.service';

type PassthroughResponse = {
  status: (code: number) => unknown;
};

@Controller()
@ApiTags('health')
export class HealthController {
  constructor(private readonly readinessService: ReadinessService) {}

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
   * 就绪检查：探测 DB + MQ 连通性（用于 K8s/LB readiness）。
   *
   * 约定：
   * - 成功：HTTP 200 + { ok: true, ... }
   * - 失败：HTTP 503 + { ok: false, dependencies: { ... }, ... }
   */
  @Get('/ready')
  @ApiExcludeEndpoint()
  async getReady(@Res({ passthrough: true }) res: PassthroughResponse) {
    const result = await this.readinessService.check();
    if (!result.ok) {
      res.status(503);
    }
    return result;
  }
}
