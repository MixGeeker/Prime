import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ComputeJobRequestedV1 } from '../../domain/job/job-request';
import { computeJobRequestHash } from '../../domain/job/request-hash';
import { HashingService } from '../hashing/hashing.service';
import { RUNNER_PORT, type RunnerPort } from '../ports/runner.port';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '../ports/unit-of-work.port';
import { RunnerExecutionError } from '../runner/runner.error';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { GraphValidatorService } from '../validation/graph-validator.service';
import type { GraphJsonV2 } from '../validation/graph-json.types';
import { UseCaseError } from './use-case.error';
import { DefinitionDependenciesService } from '../definition/definition-dependencies.service';

/**
 * ExecuteJob 用例（M6）：
 * - MQ consumer 侧调用（按 jobId 幂等）
 * - 事务内写 jobs + outbox（结果事件），事务提交后再 ack
 */
export interface ExecuteJobCommand {
  messageId?: string;
  correlationId?: string;
  payload: ComputeJobRequestedV1;
}

export type ExecuteJobResult =
  | {
      kind: 'duplicate' | 'conflict';
      jobId: string;
      requestHash: string;
      outboxEventId: null;
    }
  | {
      kind: 'processed';
      status: 'succeeded' | 'failed';
      jobId: string;
      requestHash: string;
      outboxEventId: string;
    };

type TransactionResult =
  | { kind: 'duplicate' }
  | { kind: 'conflict' }
  | { kind: 'processed'; status: 'succeeded' | 'failed'; errorCode?: string };

@Injectable()
export class ExecuteJobUseCase {
  private readonly logger = new Logger(ExecuteJobUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly graphValidatorService: GraphValidatorService,
    private readonly hashingService: HashingService,
    @Inject(RUNNER_PORT) private readonly runnerPort: RunnerPort,
    private readonly metricsService: MetricsService,
    private readonly definitionDependenciesService: DefinitionDependenciesService,
  ) {}

  async execute(command: ExecuteJobCommand): Promise<ExecuteJobResult> {
    const startedAt = process.hrtime.bigint();
    const requestHash = computeJobRequestHash(command.payload);
    const outboxEventId = randomUUID();

    const result: TransactionResult = await this.unitOfWork.runInTransaction(
      async ({ jobRepo, releaseRepo, outboxRepo }) => {
        const insertResult = await jobRepo.tryInsertRequested({
          jobId: command.payload.jobId,
          requestHash,
          messageId: command.messageId ?? null,
          correlationId: command.correlationId ?? null,
          definitionId: command.payload.definitionRef.definitionId,
          definitionHashUsed: command.payload.definitionRef.definitionHash,
        });

        if (insertResult.kind === 'duplicate') {
          return { kind: 'duplicate' } satisfies TransactionResult;
        }
        if (insertResult.kind === 'conflict') {
          return { kind: 'conflict' } satisfies TransactionResult;
        }

        await jobRepo.markRunning(command.payload.jobId);

        const definitionRefUsed = {
          definitionId: command.payload.definitionRef.definitionId,
          definitionHash: command.payload.definitionRef.definitionHash,
        };

        let inputsHash: string | null = null;

        try {
          const release = await releaseRepo.getRelease(
            definitionRefUsed.definitionId,
            definitionRefUsed.definitionHash,
          );
          if (!release) {
            throw new UseCaseError(
              'DEFINITION_NOT_FOUND',
              `definition not found: ${definitionRefUsed.definitionId}@${definitionRefUsed.definitionHash}`,
            );
          }
          if (release.status !== 'published') {
            throw new UseCaseError(
              'DEFINITION_NOT_PUBLISHED',
              `definition is not published: ${definitionRefUsed.definitionId}@${definitionRefUsed.definitionHash}`,
            );
          }

          const graphIssues = this.graphValidatorService.validateGraph(
            release.content,
          );
          const graphErrors = graphIssues.filter(
            (issue) => issue.severity === 'error',
          );
          if (graphErrors.length > 0) {
            throw new UseCaseError(
              'INPUT_VALIDATION_ERROR',
              'definition validation failed',
              graphErrors,
            );
          }

          const graph = release.content as unknown as GraphJsonV2;
          const computedDefinitionHash =
            this.hashingService.computeDefinitionHash({
              contentType: 'graph_json',
              content: release.content,
              outputSchema: release.outputSchema,
              runnerConfig: release.runnerConfig,
            });
          if (computedDefinitionHash !== release.definitionHash) {
            throw new UseCaseError(
              'INTERNAL_ERROR',
              `definitionHash mismatch: ${release.definitionId}@${release.definitionHash}`,
            );
          }

          const inputsSnapshot = this.hashingService.buildInputsSnapshot(
            graph,
            command.payload.inputs,
            command.payload.options,
          );
          if (!inputsSnapshot.ok) {
            throw new UseCaseError(
              'INPUT_VALIDATION_ERROR',
              inputsSnapshot.message ?? 'inputs validation failed',
              inputsSnapshot.path ? { path: inputsSnapshot.path } : undefined,
            );
          }
          const computedInputsHash = inputsSnapshot.inputsHash ?? '';
          inputsHash = computedInputsHash;

          const dependencyBundle =
            await this.definitionDependenciesService.buildRunnerBundle({
              rootContent: release.content,
              rootRef: definitionRefUsed,
            });

          let runnerOutputs: Record<string, unknown>;
          try {
            runnerOutputs = this.runnerPort.run({
              content: release.content,
              entrypointKey: command.payload.entrypointKey,
              inputs: inputsSnapshot.inputs ?? {},
              runnerConfig: release.runnerConfig,
              options: inputsSnapshot.options ?? {},
              definitionBundle: dependencyBundle.bundle,
            }).outputs;
          } catch (error) {
            if (error instanceof RunnerExecutionError) {
              throw new UseCaseError(error.code, error.message, error.details);
            }
            throw new UseCaseError('INTERNAL_ERROR', 'runner execution failed');
          }

          const outputsSnapshot = this.hashingService.buildOutputsSnapshot(
            graph,
            runnerOutputs,
          );
          if (!outputsSnapshot.ok) {
            throw new UseCaseError(
              'RUNNER_DETERMINISTIC_ERROR',
              outputsSnapshot.message ?? 'outputs validation failed',
              outputsSnapshot.path ? { path: outputsSnapshot.path } : undefined,
            );
          }
          const computedOutputs = outputsSnapshot.outputs ?? {};
          const computedOutputsHash = outputsSnapshot.outputsHash ?? '';

          const computedAt = new Date();
          await jobRepo.markSucceeded({
            jobId: command.payload.jobId,
            inputsHash: computedInputsHash,
            outputsHash: computedOutputsHash,
            outputs: computedOutputs,
            computedAt,
          });

          await outboxRepo.enqueue({
            id: outboxEventId,
            eventType: 'compute.job.succeeded.v1',
            routingKey: 'compute.job.succeeded.v1',
            payload: {
              schemaVersion: 1,
              jobId: command.payload.jobId,
              definitionRefUsed,
              inputsHash: computedInputsHash,
              outputs: computedOutputs,
              outputsHash: computedOutputsHash,
              computedAt: computedAt.toISOString(),
            },
            headers: {
              messageId: command.messageId ?? null,
              correlationId: command.correlationId ?? null,
            },
          });

          return {
            kind: 'processed',
            status: 'succeeded',
          } satisfies TransactionResult;
        } catch (error) {
          const failure = mapFailure(error);
          const failedAt = new Date();

          await jobRepo.markFailed({
            jobId: command.payload.jobId,
            inputsHash,
            errorCode: failure.code,
            errorMessage: failure.message,
            failedAt,
          });

          await outboxRepo.enqueue({
            id: outboxEventId,
            eventType: 'compute.job.failed.v1',
            routingKey: 'compute.job.failed.v1',
            payload: {
              schemaVersion: 1,
              jobId: command.payload.jobId,
              definitionRefUsed,
              inputsHash: inputsHash ?? undefined,
              error: {
                code: failure.code,
                message: failure.message,
                details: failure.details,
              },
              retryable: failure.retryable,
              failedAt: failedAt.toISOString(),
            },
            headers: {
              messageId: command.messageId ?? null,
              correlationId: command.correlationId ?? null,
            },
          });

          return {
            kind: 'processed',
            status: 'failed',
            errorCode: failure.code,
          } satisfies TransactionResult;
        }
      },
    );

    const durationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

    if (result.kind === 'duplicate' || result.kind === 'conflict') {
      this.metricsService.incJobProcessed(result.kind);
      this.logger.debug(
        `Job ${result.kind}`,
        JSON.stringify({
          jobId: command.payload.jobId,
          messageId: command.messageId,
          correlationId: command.correlationId,
          definitionRef: command.payload.definitionRef,
          requestHash,
        }),
      );
      return {
        kind: result.kind,
        jobId: command.payload.jobId,
        requestHash,
        outboxEventId: null,
      };
    }

    this.metricsService.incJobProcessed(result.status);
    this.metricsService.observeJobExecutionDuration(
      result.status,
      durationSeconds,
    );
    if (result.status === 'failed' && result.errorCode) {
      this.metricsService.incJobFailed(result.errorCode);
      this.logger.warn(
        'Job failed',
        JSON.stringify({
          jobId: command.payload.jobId,
          messageId: command.messageId,
          correlationId: command.correlationId,
          definitionRef: command.payload.definitionRef,
          requestHash,
          outboxEventId,
          errorCode: result.errorCode,
        }),
      );
    } else {
      this.logger.debug(
        'Job succeeded',
        JSON.stringify({
          jobId: command.payload.jobId,
          messageId: command.messageId,
          correlationId: command.correlationId,
          definitionRef: command.payload.definitionRef,
          requestHash,
          outboxEventId,
        }),
      );
    }

    return {
      kind: 'processed',
      status: result.status,
      jobId: command.payload.jobId,
      requestHash,
      outboxEventId,
    };
  }
}

function mapFailure(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
} {
  if (error instanceof UseCaseError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: isRetryableErrorCode(error.code),
    };
  }

  if (error instanceof RunnerExecutionError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: isRetryableErrorCode(error.code),
    };
  }

  const message =
    error instanceof Error && error.message ? error.message : 'internal error';
  return {
    code: 'INTERNAL_ERROR',
    message,
    details:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : undefined,
    retryable: true,
  };
}

function isRetryableErrorCode(code: string): boolean {
  switch (code) {
    case 'RUNNER_TIMEOUT':
    case 'ENGINE_TEMPORARY_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return true;
    default:
      return false;
  }
}
