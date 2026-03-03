/**
 * Hashing 服务：
 * - `definitionHash`：发布物不可变标识（内容寻址）
 * - `inputsHash`：输入快照哈希（只读取声明过的 globals/params/options）
 * - `outputsHash`：输出快照哈希（按 outputs 声明排序 + typed canonicalize）
 *
 * 关键约束：
 * - 通过 JCS（JSON Canonicalization Scheme）保证对象键顺序不影响结果
 * - 通过 typed canonicalize 保证 Decimal/Ratio/DateTime 等稳定表示
 */
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
  GraphEdge,
  GraphEntrypoint,
  GraphInputDef,
  GraphLocalDef,
  GraphNode,
} from '../validation/graph-json.types';

export interface DefinitionHashParams {
  contentType: ContentType;
  content: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  runnerConfig?: Record<string, unknown> | null;
}

export interface InputsSnapshotResult {
  ok: false;
  message: string;
  path?: string;
}

export interface OutputsHashResult {
  ok: false;
  message: string;
  path?: string;
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
    graph: GraphJsonV1,
    rawInputs: unknown,
    entrypointKey: unknown,
    options: unknown,
  ):
    | {
        ok: true;
        entrypointKeyUsed: string;
        globals: Record<string, unknown>;
        params: Record<string, unknown>;
        options: Record<string, unknown>;
        inputsHash: string;
      }
    | InputsSnapshotResult {
    const effectiveEntrypointKey =
      typeof entrypointKey === 'string' && entrypointKey.length > 0
        ? entrypointKey
        : 'main';

    const entrypoint = graph.entrypoints.find(
      (ep) => ep.key === effectiveEntrypointKey,
    );
    if (!entrypoint) {
      return {
        ok: false,
        message: `entrypoint not found: ${effectiveEntrypointKey}`,
        path: 'entrypointKey',
      };
    }

    if (!isPlainObject(rawInputs)) {
      return {
        ok: false,
        message: 'inputs must be an object',
        path: 'inputs',
      };
    }

    const rawGlobals = rawInputs['globals'];
    const rawParams = rawInputs['params'];

    if (rawGlobals !== undefined && !isPlainObject(rawGlobals)) {
      return {
        ok: false,
        message: 'inputs.globals must be an object',
        path: 'inputs.globals',
      };
    }
    if (rawParams !== undefined && !isPlainObject(rawParams)) {
      return {
        ok: false,
        message: 'inputs.params must be an object',
        path: 'inputs.params',
      };
    }

    const globalsContainer: Record<string, unknown> = rawGlobals ?? {};
    const paramsContainer: Record<string, unknown> = rawParams ?? {};

    const globalsSnapshot = this.buildInputValuesSnapshot(
      graph.globals,
      globalsContainer,
      'globals',
    );
    if (!globalsSnapshot.ok) {
      return globalsSnapshot;
    }

    const paramsSnapshot = this.buildInputValuesSnapshot(
      entrypoint.params,
      paramsContainer,
      `params(${effectiveEntrypointKey})`,
    );
    if (!paramsSnapshot.ok) {
      return paramsSnapshot;
    }

    const canonicalizedOptions = canonicalizeJobOptions(options);
    if (!canonicalizedOptions.ok) {
      return {
        ok: false,
        message: canonicalizedOptions.message,
      };
    }

    const hashInput = {
      entrypointKey: effectiveEntrypointKey,
      globals: globalsSnapshot.values,
      params: paramsSnapshot.values,
      options: canonicalizedOptions.value,
    };

    return {
      ok: true,
      entrypointKeyUsed: effectiveEntrypointKey,
      globals: globalsSnapshot.values,
      params: paramsSnapshot.values,
      options: canonicalizedOptions.value as Record<string, unknown>,
      inputsHash: this.sha256Hex(jcsCanonicalize(hashInput)),
    };
  }

  buildOutputsSnapshot(
    outputsSpec: GraphOutput[],
    outputs: Record<string, unknown>,
  ):
    | {
        ok: true;
        outputs: Record<string, unknown>;
        outputsHash: string;
      }
    | OutputsHashResult {
    const sortedSpecs = [...outputsSpec].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const canonicalizedOutputs: Record<string, unknown> = {};

    for (const outputSpec of sortedSpecs) {
      if (!Object.hasOwn(outputs, outputSpec.key)) {
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

    return {
      globals: normalizeInputDefs(graph.globals),
      entrypoints: normalizeEntrypoints(graph.entrypoints),
      locals: normalizeLocals(graph.locals),
      nodes: normalizeNodes(graph.nodes),
      edges: normalizeEdges(graph.edges),
      execEdges: normalizeEdges(graph.execEdges),
      outputs: normalizeOutputs(graph.outputs),
    };
  }

  private sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private buildInputValuesSnapshot(
    defs: GraphInputDef[],
    container: Record<string, unknown>,
    scopeLabel: string,
  ):
    | { ok: true; values: Record<string, unknown> }
    | { ok: false; message: string; path?: string } {
    const sorted = [...defs].sort((a, b) => a.name.localeCompare(b.name));
    const values: Record<string, unknown> = {};

    for (const def of sorted) {
      const rawValue = Object.hasOwn(container, def.name)
        ? container[def.name]
        : undefined;
      const hasDefault = Object.hasOwn(def, 'default');

      let effectiveValue: unknown;
      if (rawValue === undefined) {
        if (!def.required && hasDefault) {
          effectiveValue = def.default;
        } else {
          effectiveValue = null;
        }
      } else {
        effectiveValue = rawValue;
      }

      const logicalPath = `${scopeLabel}.${def.name}`;

      if (effectiveValue === null) {
        if (def.required) {
          return {
            ok: false,
            message: `required input is missing: ${logicalPath}`,
            path: logicalPath,
          };
        }
        values[def.name] = null;
        continue;
      }

      const canonicalized = canonicalizeValueByType(
        def.valueType,
        effectiveValue,
      );
      if (!canonicalized.ok) {
        return {
          ok: false,
          message: `invalid value for ${logicalPath}: ${canonicalized.message}`,
          path: logicalPath,
        };
      }

      values[def.name] = canonicalized.value;
    }

    return { ok: true, values };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function normalizeInputDefs(defs: GraphInputDef[]): GraphInputDef[] {
  return [...(defs ?? [])]
    .map((def) => {
      if (Object.hasOwn(def, 'default')) {
        const defaultValue = (def as { default?: unknown }).default;
        if (defaultValue !== null && defaultValue !== undefined) {
          const canonicalized = canonicalizeValueByType(
            def.valueType,
            defaultValue,
          );
          if (canonicalized.ok) {
            return { ...def, default: canonicalized.value };
          }
        }
      }
      return def;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeEntrypoints(
  entrypoints: GraphEntrypoint[],
): GraphEntrypoint[] {
  return [...(entrypoints ?? [])]
    .map((ep) => ({
      ...ep,
      params: normalizeInputDefs(ep.params),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeLocals(locals: GraphLocalDef[]): GraphLocalDef[] {
  return [...(locals ?? [])]
    .map((local) => {
      if (Object.hasOwn(local, 'default')) {
        const defaultValue = (local as { default?: unknown }).default;
        if (defaultValue !== null && defaultValue !== undefined) {
          const canonicalized = canonicalizeValueByType(
            local.valueType,
            defaultValue,
          );
          if (canonicalized.ok) {
            return { ...local, default: canonicalized.value };
          }
        }
      }
      return local;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeNodes(nodes: GraphNode[]): GraphNode[] {
  return [...(nodes ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...(edges ?? [])].sort((left, right) => {
    const leftKey = `${left.from.nodeId}\u0000${left.from.port}\u0000${left.to.nodeId}\u0000${left.to.port}`;
    const rightKey = `${right.from.nodeId}\u0000${right.from.port}\u0000${right.to.nodeId}\u0000${right.to.port}`;
    return leftKey.localeCompare(rightKey);
  });
}

function normalizeOutputs(outputs: GraphOutput[]): GraphOutput[] {
  return [...(outputs ?? [])].sort((a, b) => a.key.localeCompare(b.key));
}
