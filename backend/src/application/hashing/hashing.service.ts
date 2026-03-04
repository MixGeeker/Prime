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
  GraphEdge,
  GraphJsonV2,
  GraphLocalDef,
  GraphNode,
  PinDef,
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
    graph: GraphJsonV2,
    rawInputs: unknown,
    options: unknown,
  ):
    | {
        ok: true;
        inputs: Record<string, unknown>;
        options: Record<string, unknown>;
        inputsHash: string;
      }
    | InputsSnapshotResult {
    const startNodes = graph.nodes.filter((n) => n.nodeType === 'flow.start');
    if (startNodes.length !== 1) {
      return {
        ok: false,
        message: `graph must contain exactly 1 flow.start node, got ${startNodes.length}`,
        path: 'content.nodes',
      };
    }

    if (!isPlainObject(rawInputs)) {
      return {
        ok: false,
        message: 'inputs must be an object',
        path: 'inputs',
      };
    }

    const pins = readPinDefs((startNodes[0]!.params as any)?.dynamicOutputs);
    const inputsSnapshot = this.buildPinValuesSnapshot(pins, rawInputs, 'inputs');
    if (!inputsSnapshot.ok) {
      return inputsSnapshot;
    }

    const canonicalizedOptions = canonicalizeJobOptions(options);
    if (!canonicalizedOptions.ok) {
      return {
        ok: false,
        message: canonicalizedOptions.message,
      };
    }

    const hashInput = {
      inputs: inputsSnapshot.values,
      options: canonicalizedOptions.value,
    };

    return {
      ok: true,
      inputs: inputsSnapshot.values,
      options: canonicalizedOptions.value as Record<string, unknown>,
      inputsHash: this.sha256Hex(jcsCanonicalize(hashInput)),
    };
  }

  buildOutputsSnapshot(
    graph: GraphJsonV2,
    outputs: Record<string, unknown>,
  ):
    | {
        ok: true;
        outputs: Record<string, unknown>;
        outputsHash: string;
      }
    | OutputsHashResult {
    const endNodes = graph.nodes.filter((n) => n.nodeType === 'flow.end');
    if (endNodes.length !== 1) {
      return {
        ok: false,
        message: `graph must contain exactly 1 flow.end node, got ${endNodes.length}`,
        path: 'content.nodes',
      };
    }

    const pins = readPinDefs((endNodes[0]!.params as any)?.dynamicInputs);
    const sortedSpecs = [...pins].sort((a, b) => a.name.localeCompare(b.name));
    const canonicalizedOutputs: Record<string, unknown> = {};

    for (const outputSpec of sortedSpecs) {
      if (!Object.hasOwn(outputs, outputSpec.name)) {
        return {
          ok: false,
          message: `missing output: ${outputSpec.name}`,
          path: outputSpec.name,
        };
      }

      const rawValue = outputs[outputSpec.name];
      if (rawValue === null && outputSpec.valueType !== 'Json') {
        return {
          ok: false,
          message: `output cannot be null: ${outputSpec.name}`,
          path: outputSpec.name,
        };
      }

      if (rawValue === null) {
        canonicalizedOutputs[outputSpec.name] = null;
        continue;
      }

      const canonicalized = canonicalizeValueByType(
        outputSpec.valueType,
        rawValue,
      );
      if (!canonicalized.ok) {
        return {
          ok: false,
          message: `invalid output for ${outputSpec.name}: ${canonicalized.message}`,
          path: outputSpec.name,
        };
      }

      canonicalizedOutputs[outputSpec.name] = canonicalized.value;
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
  ): GraphJsonV2 {
    const graph = structuredClone(content) as unknown as GraphJsonV2;

    return {
      schemaVersion: 2,
      locals: normalizeLocals(graph.locals),
      nodes: normalizeNodesV2(graph.nodes),
      edges: normalizeEdges(graph.edges),
      execEdges: normalizeEdges(graph.execEdges),
    };
  }

  private sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private buildPinValuesSnapshot(
    pins: PinDef[],
    container: Record<string, unknown>,
    scopeLabel: string,
  ):
    | { ok: true; values: Record<string, unknown> }
    | { ok: false; message: string; path?: string } {
    const sorted = [...pins].sort((a, b) => a.name.localeCompare(b.name));
    const values: Record<string, unknown> = {};

    const seen = new Set<string>();
    for (const pin of sorted) {
      if (seen.has(pin.name)) {
        return {
          ok: false,
          message: `duplicate pin name: ${pin.name}`,
          path: `${scopeLabel}.${pin.name}`,
        };
      }
      seen.add(pin.name);

      const rawValue = Object.hasOwn(container, pin.name)
        ? container[pin.name]
        : undefined;

      let effectiveValue: unknown = rawValue;
      if (effectiveValue === undefined) {
        if (Object.hasOwn(pin, 'defaultValue')) {
          effectiveValue = pin.defaultValue;
        } else {
          effectiveValue = null;
        }
      }

      const logicalPath = `${scopeLabel}.${pin.name}`;

      if (effectiveValue === null) {
        const required = pin.required ?? true;
        if (required) {
          return {
            ok: false,
            message: `required input is missing: ${logicalPath}`,
            path: logicalPath,
          };
        }
        values[pin.name] = null;
        continue;
      }

      const canonicalized = canonicalizeValueByType(pin.valueType, effectiveValue);
      if (!canonicalized.ok) {
        return {
          ok: false,
          message: `invalid value for ${logicalPath}: ${canonicalized.message}`,
          path: logicalPath,
        };
      }

      values[pin.name] = canonicalized.value;
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

function readPinDefs(value: unknown): PinDef[] {
  if (!Array.isArray(value)) return [];
  const pins: PinDef[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = item['name'];
    const valueType = item['valueType'];
    if (typeof name !== 'string' || name.length === 0) continue;
    if (
      valueType !== 'Decimal' &&
      valueType !== 'Ratio' &&
      valueType !== 'String' &&
      valueType !== 'Boolean' &&
      valueType !== 'DateTime' &&
      valueType !== 'Json'
    ) {
      continue;
    }
    pins.push(item as unknown as PinDef);
  }
  return pins;
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

function normalizeNodesV2(nodes: GraphNode[]): GraphNode[] {
  return [...(nodes ?? [])]
    .map((node) => {
      if (!node.params || !isPlainObject(node.params)) {
        return node;
      }

      if (node.nodeType === 'flow.start') {
        return {
          ...node,
          params: {
            ...node.params,
            dynamicOutputs: normalizePins(node.params['dynamicOutputs']),
          },
        };
      }

      if (node.nodeType === 'flow.end') {
        return {
          ...node,
          params: {
            ...node.params,
            dynamicInputs: normalizePins(node.params['dynamicInputs']),
          },
        };
      }

      return node;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...(edges ?? [])].sort((left, right) => {
    const leftKey = `${left.from.nodeId}\u0000${left.from.port}\u0000${left.to.nodeId}\u0000${left.to.port}`;
    const rightKey = `${right.from.nodeId}\u0000${right.from.port}\u0000${right.to.nodeId}\u0000${right.to.port}`;
    return leftKey.localeCompare(rightKey);
  });
}

function normalizePins(value: unknown): unknown {
  const pins = readPinDefs(value);
  if (pins.length === 0) return value;

  return [...pins]
    .map((pin) => {
      if (
        Object.hasOwn(pin, 'defaultValue') &&
        pin.defaultValue !== null &&
        pin.defaultValue !== undefined
      ) {
        const canonicalized = canonicalizeValueByType(pin.valueType, pin.defaultValue);
        if (canonicalized.ok) {
          return { ...pin, defaultValue: canonicalized.value };
        }
      }
      return pin;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
