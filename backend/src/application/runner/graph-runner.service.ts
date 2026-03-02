import { Injectable } from '@nestjs/common';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type { ValueType } from '../catalog/node-catalog.types';
import type {
  RunnerPort,
  RunnerRunParams,
  RunnerRunResult,
} from '../ports/runner.port';
import type {
  GraphEdge,
  GraphJsonV1,
  GraphNode,
  RoundingMode,
} from '../validation/graph-json.types';
import {
  canonicalizeValueByType,
  isPlainObject,
} from '../hashing/canonicalize';
import { RunnerExecutionError } from './runner.error';

@Injectable()
export class GraphRunnerService implements RunnerPort {
  constructor(private readonly nodeCatalogService: NodeCatalogService) {}

  run(params: RunnerRunParams): RunnerRunResult {
    const graph = params.content as unknown as GraphJsonV1;

    const effectiveRunnerConfig = deepMerge(
      params.runnerConfig ?? {},
      params.options ?? {},
    );
    const limits = readRunnerLimits(effectiveRunnerConfig);

    if (graph.nodes.length > limits.maxNodes) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `node count exceeds maxNodes: ${graph.nodes.length} > ${limits.maxNodes}`,
      );
    }

    const { sortedNodeIds, maxDepth } = topologicalSortWithDepth(graph);
    if (maxDepth > limits.maxDepth) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `graph depth exceeds maxDepth: ${maxDepth} > ${limits.maxDepth}`,
      );
    }

    const startedAt = Date.now();
    const incomingEdgeByPort = new Map<string, GraphEdge>();
    const outgoingByNode = new Map<string, GraphEdge[]>();
    for (const node of graph.nodes) {
      outgoingByNode.set(node.id, []);
    }
    for (const edge of graph.edges) {
      incomingEdgeByPort.set(`${edge.to.nodeId}::${edge.to.port}`, edge);
      const outgoing = outgoingByNode.get(edge.from.nodeId);
      if (outgoing) {
        outgoing.push(edge);
      }
    }

    const nodeById = new Map<string, GraphNode>();
    for (const node of graph.nodes) {
      nodeById.set(node.id, node);
    }

    const nodeOutputs = new Map<string, Record<string, unknown>>();
    for (const nodeId of sortedNodeIds) {
      ensureTimeout(startedAt, limits.timeoutMs);

      const node = nodeById.get(nodeId);
      if (!node) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `node not found: ${nodeId}`,
        );
      }

      const nodeDef = this.nodeCatalogService.getNode(
        node.nodeType,
        node.nodeVersion,
      );
      if (!nodeDef) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `node is not in catalog: ${node.nodeType}@${node.nodeVersion}`,
        );
      }

      const inputValues: Record<string, unknown> = {};
      for (const inputPort of nodeDef.inputs) {
        const incomingEdge = incomingEdgeByPort.get(
          `${node.id}::${inputPort.name}`,
        );
        if (!incomingEdge) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `missing edge for ${node.id}.${inputPort.name}`,
          );
        }
        const sourceOutputs = nodeOutputs.get(incomingEdge.from.nodeId);
        if (!sourceOutputs) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `source node is not computed: ${incomingEdge.from.nodeId}`,
          );
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            sourceOutputs,
            incomingEdge.from.port,
          )
        ) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `source port not found: ${incomingEdge.from.nodeId}.${incomingEdge.from.port}`,
          );
        }
        inputValues[inputPort.name] = sourceOutputs[incomingEdge.from.port];
      }

      const currentOutputs = evaluateNode(
        node,
        inputValues,
        params.variableValues,
      );
      nodeOutputs.set(node.id, currentOutputs);

      const outgoingEdges = outgoingByNode.get(node.id) ?? [];
      for (const edge of outgoingEdges) {
        if (!nodeById.has(edge.to.nodeId)) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `target node not found: ${edge.to.nodeId}`,
          );
        }
      }
    }

    const outputs: Record<string, unknown> = {};
    for (const output of graph.outputs) {
      ensureTimeout(startedAt, limits.timeoutMs);

      const sourceNodeOutputs = nodeOutputs.get(output.from.nodeId);
      if (!sourceNodeOutputs) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `output source node not computed: ${output.from.nodeId}`,
        );
      }
      if (
        !Object.prototype.hasOwnProperty.call(
          sourceNodeOutputs,
          output.from.port,
        )
      ) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `output source port not found: ${output.from.nodeId}.${output.from.port}`,
        );
      }

      let outputValue = sourceNodeOutputs[output.from.port];
      if (output.rounding) {
        outputValue = applyOutputRounding(
          outputValue,
          output.valueType,
          output.rounding.scale,
          output.rounding.mode,
        );
      }

      outputs[output.key] = outputValue;
    }

    return { outputs };
  }
}

function evaluateNode(
  node: GraphNode,
  inputs: Record<string, unknown>,
  variableValues: Record<string, unknown>,
): Record<string, unknown> {
  if (node.nodeType.startsWith('core.var.')) {
    const path = getString(node.params?.['path']);
    if (!path) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `core.var node requires params.path: ${node.id}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(variableValues, path)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `variable path is not available at runtime: ${path}`,
      );
    }
    return {
      value: variableValues[path],
    };
  }

  if (node.nodeType.startsWith('core.const.')) {
    const valueType = valueTypeFromCoreNodeType(node.nodeType);
    if (!valueType) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported constant node type: ${node.nodeType}`,
      );
    }
    const rawValue = node.params?.['value'];
    const canonicalized = canonicalizeValueByType(valueType, rawValue);
    if (!canonicalized.ok) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid constant value for ${node.id}: ${canonicalized.message}`,
      );
    }
    return { value: canonicalized.value };
  }

  switch (node.nodeType) {
    case 'math.add': {
      const result =
        toDecimalNumber(inputs['a'], `${node.id}.a`) +
        toDecimalNumber(inputs['b'], `${node.id}.b`);
      return { value: canonicalizeDecimalOutput(result, node.id) };
    }
    case 'math.sub': {
      const result =
        toDecimalNumber(inputs['a'], `${node.id}.a`) -
        toDecimalNumber(inputs['b'], `${node.id}.b`);
      return { value: canonicalizeDecimalOutput(result, node.id) };
    }
    case 'math.mul': {
      const result =
        toDecimalNumber(inputs['a'], `${node.id}.a`) *
        toDecimalNumber(inputs['b'], `${node.id}.b`);
      return { value: canonicalizeDecimalOutput(result, node.id) };
    }
    case 'math.div': {
      const left = toDecimalNumber(inputs['a'], `${node.id}.a`);
      const right = toDecimalNumber(inputs['b'], `${node.id}.b`);
      if (right === 0) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `division by zero at ${node.id}`,
        );
      }
      const result = left / right;
      return { value: canonicalizeDecimalOutput(result, node.id) };
    }
    default:
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported node type: ${node.nodeType}`,
      );
  }
}

function canonicalizeDecimalOutput(value: number, nodeId: string): string {
  if (!Number.isFinite(value)) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `non-finite decimal result at ${nodeId}`,
    );
  }
  const canonicalized = canonicalizeValueByType('Decimal', value);
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal canonicalization failed at ${nodeId}: ${canonicalized.message}`,
    );
  }
  return canonicalized.value as string;
}

function toDecimalNumber(value: unknown, label: string): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal input must be string/number: ${label}`,
    );
  }
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal input is not finite: ${label}`,
    );
  }
  return converted;
}

function valueTypeFromCoreNodeType(nodeType: string): ValueType | null {
  const suffix = nodeType.split('.').at(-1);
  switch (suffix) {
    case 'decimal':
      return 'Decimal';
    case 'ratio':
      return 'Ratio';
    case 'string':
      return 'String';
    case 'boolean':
      return 'Boolean';
    case 'datetime':
      return 'DateTime';
    case 'json':
      return 'Json';
    default:
      return null;
  }
}

function applyOutputRounding(
  value: unknown,
  valueType: ValueType,
  scale: number,
  mode: RoundingMode,
): unknown {
  if (valueType !== 'Decimal' && valueType !== 'Ratio') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `rounding only applies to Decimal/Ratio outputs`,
    );
  }

  const numericValue = toDecimalNumber(value, 'output.rounding');
  const rounded = roundWithMode(numericValue, scale, mode);
  const canonicalized = canonicalizeValueByType(valueType, rounded);
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `rounded output is invalid: ${canonicalized.message}`,
    );
  }
  return canonicalized.value;
}

function roundWithMode(
  value: number,
  scale: number,
  mode: RoundingMode,
): number {
  const factor = Math.pow(10, scale);
  const scaled = value * factor;

  switch (mode) {
    case 'UP':
      return (scaled >= 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
    case 'DOWN':
      return (scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
    case 'CEIL':
      return Math.ceil(scaled) / factor;
    case 'FLOOR':
      return Math.floor(scaled) / factor;
    case 'HALF_UP':
      return roundHalfUp(scaled) / factor;
    case 'HALF_DOWN':
      return roundHalfDown(scaled) / factor;
    case 'HALF_EVEN':
      return roundHalfEven(scaled) / factor;
    case 'HALF_CEIL':
      return roundHalfCeil(scaled) / factor;
    case 'HALF_FLOOR':
      return roundHalfFloor(scaled) / factor;
    default:
      return roundHalfEven(scaled) / factor;
  }
}

function roundHalfUp(value: number): number {
  const sign = value >= 0 ? 1 : -1;
  const abs = Math.abs(value);
  return sign * Math.floor(abs + 0.5);
}

function roundHalfDown(value: number): number {
  const sign = value >= 0 ? 1 : -1;
  const abs = Math.abs(value);
  const floorValue = Math.floor(abs);
  const fraction = abs - floorValue;
  const isTie = Math.abs(fraction - 0.5) < 1e-12;
  if (isTie) {
    return sign * floorValue;
  }
  return sign * Math.floor(abs + 0.5);
}

function roundHalfEven(value: number): number {
  const sign = value >= 0 ? 1 : -1;
  const abs = Math.abs(value);
  const floorValue = Math.floor(abs);
  const fraction = abs - floorValue;
  const isTie = Math.abs(fraction - 0.5) < 1e-12;
  if (!isTie) {
    return sign * Math.floor(abs + 0.5);
  }
  if (floorValue % 2 === 0) {
    return sign * floorValue;
  }
  return sign * (floorValue + 1);
}

function roundHalfCeil(value: number): number {
  const rounded = roundHalfDown(value);
  const abs = Math.abs(value);
  const floorValue = Math.floor(abs);
  const fraction = abs - floorValue;
  const isTie = Math.abs(fraction - 0.5) < 1e-12;
  if (!isTie) {
    return rounded;
  }
  return Math.ceil(value);
}

function roundHalfFloor(value: number): number {
  const rounded = roundHalfDown(value);
  const abs = Math.abs(value);
  const floorValue = Math.floor(abs);
  const fraction = abs - floorValue;
  const isTie = Math.abs(fraction - 0.5) < 1e-12;
  if (!isTie) {
    return rounded;
  }
  return Math.floor(value);
}

function ensureTimeout(startedAt: number, timeoutMs: number) {
  if (Date.now() - startedAt > timeoutMs) {
    throw new RunnerExecutionError('RUNNER_TIMEOUT', 'runner timeout exceeded');
  }
}

function topologicalSortWithDepth(graph: GraphJsonV1): {
  sortedNodeIds: string[];
  maxDepth: number;
} {
  const indegree = new Map<string, number>();
  const depth = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    depth.set(node.id, 1);
    adjacency.set(node.id, []);
  }

  for (const edge of graph.edges) {
    indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
    const list = adjacency.get(edge.from.nodeId);
    if (list) {
      list.push(edge.to.nodeId);
    }
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sortedNodeIds: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    sortedNodeIds.push(current);

    const currentDepth = depth.get(current) ?? 1;
    for (const next of adjacency.get(current) ?? []) {
      const nextDepth = depth.get(next) ?? 1;
      if (currentDepth + 1 > nextDepth) {
        depth.set(next, currentDepth + 1);
      }

      const updated = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, updated);
      if (updated === 0) {
        queue.push(next);
      }
    }
  }

  if (sortedNodeIds.length !== graph.nodes.length) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      'cycle detected while executing graph',
    );
  }

  let maxDepth = 0;
  for (const value of depth.values()) {
    if (value > maxDepth) {
      maxDepth = value;
    }
  }

  return { sortedNodeIds, maxDepth };
}

function readRunnerLimits(config: unknown): {
  maxNodes: number;
  maxDepth: number;
  timeoutMs: number;
} {
  const defaults = {
    maxNodes: 500,
    maxDepth: 200,
    timeoutMs: 3000,
  };

  if (!isPlainObject(config)) {
    return defaults;
  }

  const limitsValue = config['limits'];
  if (!isPlainObject(limitsValue)) {
    return defaults;
  }

  return {
    maxNodes: readPositiveInt(limitsValue['maxNodes'], defaults.maxNodes),
    maxDepth: readPositiveInt(limitsValue['maxDepth'], defaults.maxDepth),
    timeoutMs: readPositiveInt(limitsValue['timeoutMs'], defaults.timeoutMs),
  };
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(base);

  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    const currentValue = result[key];

    if (isPlainObject(currentValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(currentValue, overrideValue);
      continue;
    }

    result[key] = structuredClone(overrideValue);
  }

  return result;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
