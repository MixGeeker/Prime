import { Module } from '@nestjs/common';
import { DbModule } from '../adapters/outbound/db/db.module';
import { ExecuteJobUseCase } from './use-cases/execute-job.use-case';
import { FailInvalidJobMessageUseCase } from './use-cases/fail-invalid-job-message.use-case';
import { NodeCatalogService } from './catalog/node-catalog.service';
import { GraphValidatorService } from './validation/graph-validator.service';
import { ValidateDefinitionUseCase } from './use-cases/validate-definition.use-case';
import { CreateDraftUseCase } from './use-cases/create-draft.use-case';
import { DeleteDraftUseCase } from './use-cases/delete-draft.use-case';
import { DeprecateVersionUseCase } from './use-cases/deprecate-version.use-case';
import { DryRunUseCase } from './use-cases/dry-run.use-case';
import { GetDraftUseCase } from './use-cases/get-draft.use-case';
import { GetJobUseCase } from './use-cases/get-job.use-case';
import { GetVersionUseCase } from './use-cases/get-version.use-case';
import { ListVersionsUseCase } from './use-cases/list-versions.use-case';
import { PublishDefinitionUseCase } from './use-cases/publish-definition.use-case';
import { UpdateDraftUseCase } from './use-cases/update-draft.use-case';
import { HashingService } from './hashing/hashing.service';
import { GraphRunnerService } from './runner/graph-runner.service';
import { RUNNER_PORT } from './ports/runner.port';

/**
 * Application 层模块：
 * - 只包含用例编排（use-cases）
 * - 通过 ports 依赖外部系统（DB/MQ/Runner/Hasher 等）
 */
@Module({
  imports: [DbModule],
  providers: [
    ExecuteJobUseCase,
    FailInvalidJobMessageUseCase,
    ValidateDefinitionUseCase,
    CreateDraftUseCase,
    GetDraftUseCase,
    UpdateDraftUseCase,
    DeleteDraftUseCase,
    PublishDefinitionUseCase,
    DeprecateVersionUseCase,
    ListVersionsUseCase,
    GetVersionUseCase,
    GetJobUseCase,
    DryRunUseCase,
    HashingService,
    GraphRunnerService,
    {
      provide: RUNNER_PORT,
      useExisting: GraphRunnerService,
    },
    NodeCatalogService,
    GraphValidatorService,
  ],
  exports: [
    ExecuteJobUseCase,
    FailInvalidJobMessageUseCase,
    ValidateDefinitionUseCase,
    CreateDraftUseCase,
    GetDraftUseCase,
    UpdateDraftUseCase,
    DeleteDraftUseCase,
    PublishDefinitionUseCase,
    DeprecateVersionUseCase,
    ListVersionsUseCase,
    GetVersionUseCase,
    GetJobUseCase,
    DryRunUseCase,
    HashingService,
    GraphRunnerService,
    NodeCatalogService,
    GraphValidatorService,
  ],
})
export class ApplicationModule {}
