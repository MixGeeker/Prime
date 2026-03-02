import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { ContentType } from '../../domain/definition/definition';
import {
  canonicalizeJobOptions,
  canonicalizeValueByType,
} from './canonicalize';
import { jcsCanonicalize } from './jcs';
import type {
  GraphJsonV1,
  GraphOutput,
  GraphVariable,
} from '../validation/graph-json.types';

export interface DefinitionHashParams {
  contentType: ContentType;
  content: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  runnerConfig?: Record<string, unknown> | null;
}

export interface InputsSnapshotResult {
  ok: boolean;
  message?: string;
  path?: string;
  variables?: Record<string, unknown>;
  options?: Record<string, unknown>;
  inputsHash?: string;
}

export interface OutputsHashResult {
  ok: boolean;
  message?: string;
  path?: string;
  outputs?: Record<string, unknown>;
  outputsHash?: string;
}

@Injectable()
export class HashingService {
  computeDefinitionHash(params: DefinitionHashParams): string {
    if (params.contentType !== 'graph_json') {
      throw new Error('Unsupported contentType');
    }

    const content = this.normalizeGraphForDefinitionHash(params.content);

    const payload = {
      contentType: params.contentType,
      content,
      outputSchema: params.outputSchema ?? null,
      runnerConfig: params.runnerConfig ?? null,
    };

    return this.sha256Hex(jcsCanonicalize(payload));
  }

  buildInputsSnapshot(
    variables: GraphVariable[],
    inputs: Record<string, unknown>,
    options: unknown,
  ): InputsSnapshotResult {
    const sortedVariables = [...variables].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const canonicalizedVariables: Record<string, unknown> = {};

    for (const variable of sortedVariables) {
      const rawValue = readPath(inputs, variable.path);
      const hasDefault = 'default' in variable;

      let effectiveValue: unknown;
      if (rawValue === undefined) {
        if (!variable.required && hasDefault) {
          effectiveValue = variable.default;
        } else {
          effectiveValue = null;
        }
      } else {
        effectiveValue = rawValue;
      }

      if (effectiveValue === null) {
        if (variable.required) {
          return {
            ok: false,
            message: `required input is missing: ${variable.path}`,
            path: variable.path,
          };
        }
        canonicalizedVariables[variable.path] = null;
        continue;
      }

      const canonicalized = canonicalizeValueByType(
        variable.valueType,
        effectiveValue,
      );
      if (!canonicalized.ok) {
        return {
          ok: false,
          message: `invalid value for ${variable.path}: ${canonicalized.message}`,
          path: variable.path,
        };
      }

      canonicalizedVariables[variable.path] = canonicalized.value;
    }

    const canonicalizedOptions = canonicalizeJobOptions(options);
    if (!canonicalizedOptions.ok) {
      return {
        ok: false,
        message: canonicalizedOptions.message,
      };
    }

    const hashInput = {
      variables: canonicalizedVariables,
      options: canonicalizedOptions.value,
    };

    return {
      ok: true,
      variables: canonicalizedVariables,
      options: canonicalizedOptions.value as Record<string, unknown>,
      inputsHash: this.sha256Hex(jcsCanonicalize(hashInput)),
    };
  }

  buildOutputsSnapshot(
    outputsSpec: GraphOutput[],
    outputs: Record<string, unknown>,
  ): OutputsHashResult {
    const sortedSpecs = [...outputsSpec].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const canonicalizedOutputs: Record<string, unknown> = {};

    for (const outputSpec of sortedSpecs) {
      if (!Object.prototype.hasOwnProperty.call(outputs, outputSpec.key)) {
        return {
          ok: false,
          message: `missing output: ${outputSpec.key}`,
          path: outputSpec.key,
        };
      }

      const rawValue = outputs[outputSpec.key];
      if (rawValue === null && outputSpec.valueType !== 'Json') {
        return {
          ok: false,
          message: `output cannot be null: ${outputSpec.key}`,
          path: outputSpec.key,
        };
      }

      if (rawValue === null) {
        canonicalizedOutputs[outputSpec.key] = null;
        continue;
      }

      const canonicalized = canonicalizeValueByType(
        outputSpec.valueType,
        rawValue,
      );
      if (!canonicalized.ok) {
        return {
          ok: false,
          message: `invalid output for ${outputSpec.key}: ${canonicalized.message}`,
          path: outputSpec.key,
        };
      }

      canonicalizedOutputs[outputSpec.key] = canonicalized.value;
    }

    return {
      ok: true,
      outputs: canonicalizedOutputs,
      outputsHash: this.sha256Hex(
        jcsCanonicalize({
          outputs: canonicalizedOutputs,
        }),
      ),
    };
  }

  private normalizeGraphForDefinitionHash(
    content: Record<string, unknown>,
  ): GraphJsonV1 {
    const graph = structuredClone(content) as unknown as GraphJsonV1;
    const graphRecord = graph as unknown as Record<string, unknown>;

    delete graphRecord.metadata;
    delete graphRecord.resolvers;

    graph.variables = [...graph.variables]
      .map((variable) => {
        if (Object.prototype.hasOwnProperty.call(variable, 'default')) {
          const defaultValue = (variable as { default?: unknown }).default;
          if (defaultValue !== null && defaultValue !== undefined) {
            const canonicalized = canonicalizeValueByType(
              variable.valueType,
              defaultValue,
            );
            if (canonicalized.ok) {
              return {
                ...variable,
                default: canonicalized.value,
              };
            }
          }
        }
        return variable;
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    graph.nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));

    graph.edges = [...graph.edges].sort((left, right) => {
      const leftKey = `${left.from.nodeId}\u0000${left.from.port}\u0000${left.to.nodeId}\u0000${left.to.port}`;
      const rightKey = `${right.from.nodeId}\u0000${right.from.port}\u0000${right.to.nodeId}\u0000${right.to.port}`;
      return leftKey.localeCompare(rightKey);
    });

    graph.outputs = [...graph.outputs].sort((a, b) =>
      a.key.localeCompare(b.key),
    );

    return graph;
  }

  private sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}

function readPath(
  inputs: Record<string, unknown>,
  variablePath: string,
): unknown {
  const segments = variablePath.split('.');
  if (segments.length < 2 || segments[0] !== 'inputs') {
    return undefined;
  }

  let current: unknown = inputs;
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) {
      return undefined;
    }
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    const container = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(container, segment)) {
      return undefined;
    }
    current = container[segment];
  }

  return current;
}
