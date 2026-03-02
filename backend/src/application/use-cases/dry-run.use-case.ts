import { Inject, Injectable } from '@nestjs/common';
import {
  DEFINITION_VERSION_REPOSITORY,
  type DefinitionVersionRepositoryPort,
} from '../ports/definition-version-repository.port';
import { GraphValidatorService } from '../validation/graph-validator.service';
import type { ContentType } from '../../domain/definition/definition';
import type { GraphJsonV1 } from '../validation/graph-json.types';
import { HashingService } from '../hashing/hashing.service';
import { RunnerExecutionError } from '../runner/runner.error';
import { UseCaseError } from './use-case.error';
import { RUNNER_PORT, type RunnerPort } from '../ports/runner.port';

export interface DryRunCommand {
  definitionRef?: {
    definitionId: string;
    version: number;
  };
  definition?: {
    contentType: ContentType;
    content: Record<string, unknown>;
    outputSchema?: Record<string, unknown> | null;
    runnerConfig?: Record<string, unknown> | null;
  };
  inputs: Record<string, unknown>;
  options?: Record<string, unknown>;
}

@Injectable()
export class DryRunUseCase {
  constructor(
    @Inject(DEFINITION_VERSION_REPOSITORY)
    private readonly versionRepository: DefinitionVersionRepositoryPort,
    private readonly graphValidatorService: GraphValidatorService,
    private readonly hashingService: HashingService,
    @Inject(RUNNER_PORT) private readonly runnerPort: RunnerPort,
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
      graph.variables,
      command.inputs,
      command.options,
    );
    if (!inputsSnapshot.ok) {
      throw new UseCaseError(
        'INPUT_VALIDATION_ERROR',
        inputsSnapshot.message ?? 'inputs validation failed',
        inputsSnapshot.path ? { path: inputsSnapshot.path } : undefined,
      );
    }

    let runnerOutputs: Record<string, unknown>;
    try {
      runnerOutputs = this.runnerPort.run({
        content: resolved.content,
        variableValues: inputsSnapshot.variables ?? {},
        runnerConfig: resolved.runnerConfig,
        options: inputsSnapshot.options ?? {},
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
      version: number;
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
      const version = await this.versionRepository.getVersion(
        command.definitionRef.definitionId,
        command.definitionRef.version,
      );
      if (!version) {
        throw new UseCaseError(
          'DEFINITION_NOT_FOUND',
          `definition not found: ${command.definitionRef.definitionId}@${command.definitionRef.version}`,
        );
      }
      if (version.status !== 'published') {
        throw new UseCaseError(
          'DEFINITION_NOT_PUBLISHED',
          `definition is not published: ${command.definitionRef.definitionId}@${command.definitionRef.version}`,
        );
      }

      return {
        definitionRefUsed: {
          definitionId: version.definitionId,
          version: version.version,
        },
        contentType: 'graph_json',
        content: version.content,
        outputSchema: version.outputSchema,
        runnerConfig: version.runnerConfig,
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
        version: 0,
      },
      contentType: definition.contentType,
      content: definition.content,
      outputSchema: definition.outputSchema ?? null,
      runnerConfig: definition.runnerConfig ?? null,
    };
  }
}
