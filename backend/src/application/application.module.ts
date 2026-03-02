import { Module } from '@nestjs/common';
import { ExecuteJobUseCase } from './use-cases/execute-job.use-case';
import { NodeCatalogService } from './catalog/node-catalog.service';
import { GraphValidatorService } from './validation/graph-validator.service';
import { ValidateDefinitionUseCase } from './use-cases/validate-definition.use-case';

/**
 * Application 层模块：
 * - 只包含用例编排（use-cases）
 * - 通过 ports 依赖外部系统（DB/MQ/Runner/Hasher 等）
 */
@Module({
  providers: [
    ExecuteJobUseCase,
    ValidateDefinitionUseCase,
    NodeCatalogService,
    GraphValidatorService,
  ],
  exports: [
    ExecuteJobUseCase,
    ValidateDefinitionUseCase,
    NodeCatalogService,
    GraphValidatorService,
  ],
})
export class ApplicationModule {}
