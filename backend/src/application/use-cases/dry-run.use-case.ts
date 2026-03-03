/**
 * DryRun 用例：对给定 definition（或 ref）+ inputs 做一次“预览执行”。
 *
 * 约束：
 * - 不落库、不发 MQ
 * - 仍会做：graph 校验 / inputs 校验与规范化 / hashing / runner 执行
 * - 若图包含 `flow.call_definition`，会构建依赖 bundle 并注入 Runner
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';
import { GraphValidatorService } from '../validation/graph-validator.service';
import type { ContentType } from '../../domain/definition/definition';
import type { GraphJsonV1 } from '../validation/graph-json.types';
import { HashingService } from '../hashing/hashing.service';
import { RunnerExecutionError } from '../runner/runner.error';
import { UseCaseError } from './use-case.error';
import { RUNNER_PORT, type RunnerPort } from '../ports/runner.port';
import { DefinitionDependenciesService } from '../definition/definition-dependencies.service';

export interface DryRunCommand {
  definitionRef?: {
    definitionId: string;
    definitionHash: string;
  };
  definition?: {
    contentType: ContentType;
    content: Record<string, unknown>;
    outputSchema?: Record<string, unknown> | null;
    runnerConfig?: Record<string, unknown> | null;
  };
  inputs: Record<string, unknown>;
  entrypointKey?: string;
  options?: Record<string, unknown>;
}

@Injectable()
export class DryRunUseCase {
  constructor(
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
    private readonly graphValidatorService: GraphValidatorService,
    private readonly hashingService: HashingService,
    @Inject(RUNNER_PORT) private readonly runnerPort: RunnerPort,
    private readonly definitionDependenciesService: DefinitionDependenciesService,
  ) {}

  async execute(command: DryRunCommand) {
    const resolved = await this.resolveDefinition(command);

    const graphIssues = this.graphValidatorService.validateGraph(
      resolved.content,
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

    const graph = resolved.content as unknown as GraphJsonV1;
    const definitionHash = this.hashingService.computeDefinitionHash({
      contentType: resolved.contentType,
      content: resolved.content,
      outputSchema: resolved.outputSchema,
      runnerConfig: resolved.runnerConfig,
    });

    const inputsSnapshot = this.hashingService.buildInputsSnapshot(
      graph,
      command.inputs,
      command.entrypointKey,
      command.options,
    );
    if (!inputsSnapshot.ok) {
      throw new UseCaseError(
        'INPUT_VALIDATION_ERROR',
        inputsSnapshot.message ?? 'inputs validation failed',
        inputsSnapshot.path ? { path: inputsSnapshot.path } : undefined,
      );
    }

    const rootRef =
      resolved.definitionRefUsed.definitionId !== '__inline__'
        ? resolved.definitionRefUsed
        : undefined;
    const dependencyBundle =
      await this.definitionDependenciesService.buildRunnerBundle({
        rootContent: resolved.content,
        rootRef,
      });

    let runnerOutputs: Record<string, unknown>;
    try {
      runnerOutputs = this.runnerPort.run({
        content: resolved.content,
        entrypointKey: command.entrypointKey,
        inputs: {
          globals: inputsSnapshot.globals ?? {},
          params: inputsSnapshot.params ?? {},
        },
        runnerConfig: resolved.runnerConfig,
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
      graph.outputs,
      runnerOutputs,
    );
    if (!outputsSnapshot.ok) {
      throw new UseCaseError(
        'RUNNER_DETERMINISTIC_ERROR',
        outputsSnapshot.message ?? 'outputs validation failed',
        outputsSnapshot.path ? { path: outputsSnapshot.path } : undefined,
      );
    }

    return {
      definitionRefUsed: resolved.definitionRefUsed,
      definitionHash,
      inputsHash: inputsSnapshot.inputsHash,
      outputs: outputsSnapshot.outputs,
      outputsHash: outputsSnapshot.outputsHash,
    };
  }

  private async resolveDefinition(command: DryRunCommand): Promise<{
    definitionRefUsed: {
      definitionId: string;
      definitionHash: string;
    };
    contentType: ContentType;
    content: Record<string, unknown>;
    outputSchema: Record<string, unknown> | null;
    runnerConfig: Record<string, unknown> | null;
  }> {
    const hasRef = Boolean(command.definitionRef);
    const hasInline = Boolean(command.definition);

    if ((hasRef && hasInline) || (!hasRef && !hasInline)) {
      throw new UseCaseError(
        'INVALID_MESSAGE',
        'either definitionRef or definition must be provided',
      );
    }

    if (command.definitionRef) {
      const release = await this.releaseRepository.getRelease(
        command.definitionRef.definitionId,
        command.definitionRef.definitionHash,
      );
      if (!release) {
        throw new UseCaseError(
          'DEFINITION_NOT_FOUND',
          `definition not found: ${command.definitionRef.definitionId}@${command.definitionRef.definitionHash}`,
        );
      }
      if (release.status !== 'published') {
        throw new UseCaseError(
          'DEFINITION_NOT_PUBLISHED',
          `definition is not published: ${command.definitionRef.definitionId}@${command.definitionRef.definitionHash}`,
        );
      }

      return {
        definitionRefUsed: {
          definitionId: release.definitionId,
          definitionHash: release.definitionHash,
        },
        contentType: 'graph_json',
        content: release.content,
        outputSchema: release.outputSchema,
        runnerConfig: release.runnerConfig,
      };
    }

    const definition = command.definition;
    if (!definition) {
      throw new UseCaseError(
        'INVALID_MESSAGE',
        'definition payload is required',
      );
    }

    return {
      definitionRefUsed: {
        definitionId: '__inline__',
        definitionHash: '__inline__',
      },
      contentType: definition.contentType,
      content: definition.content,
      outputSchema: definition.outputSchema ?? null,
      runnerConfig: definition.runnerConfig ?? null,
    };
  }
}
