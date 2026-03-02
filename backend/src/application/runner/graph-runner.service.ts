import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
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
    const DecimalCtor = buildDecimalCtor(effectiveRunnerConfig);

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
        DecimalCtor,
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
          DecimalCtor,
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
  DecimalCtor: typeof Decimal,
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
      const result = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor).plus(
        toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor),
      );
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    }
    case 'math.sub': {
      const result = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor).minus(
        toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor),
      );
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    }
    case 'math.mul': {
      const result = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor).mul(
        toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor),
      );
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    }
    case 'math.div': {
      const left = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const right = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      if (right.isZero()) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `division by zero at ${node.id}`,
        );
      }
      const result = left.div(right);
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    }
    case 'math.round': {
      const scale = getNonNegativeInt(node.params?.['scale']);
      const mode = getRoundingMode(node.params?.['mode']);
      const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
      const rounded = value.toDecimalPlaces(scale, toDecimalRounding(mode));
      return {
        value: canonicalizeDecimalOutput('Decimal', rounded, node.id),
      };
    }
    case 'logic.and': {
      const a = toBoolean(inputs['a'], `${node.id}.a`);
      const b = toBoolean(inputs['b'], `${node.id}.b`);
      return { value: a && b };
    }
    case 'logic.or': {
      const a = toBoolean(inputs['a'], `${node.id}.a`);
      const b = toBoolean(inputs['b'], `${node.id}.b`);
      return { value: a || b };
    }
    case 'logic.not': {
      const value = toBoolean(inputs['value'], `${node.id}.value`);
      return { value: !value };
    }
    case 'core.if.decimal': {
      const cond = toBoolean(inputs['cond'], `${node.id}.cond`);
      const chosen = cond ? inputs['then'] : inputs['else'];
      return {
        value: canonicalizeChosenValue('Decimal', chosen, node.id),
      };
    }
    case 'compare.decimal.eq': {
      const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      return { value: a.equals(b) };
    }
    case 'compare.decimal.ne': {
      const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      return { value: !a.equals(b) };
    }
    case 'compare.decimal.gt': {
      const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      return { value: a.greaterThan(b) };
    }
    case 'compare.decimal.gte': {
      const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      return { value: a.greaterThanOrEqualTo(b) };
    }
    case 'compare.decimal.lt': {
      const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      return { value: a.lessThan(b) };
    }
    case 'compare.decimal.lte': {
      const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
      const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
      return { value: a.lessThanOrEqualTo(b) };
    }
    default:
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported node type: ${node.nodeType}`,
      );
  }
}

function canonicalizeDecimalOutput(
  valueType: ValueType,
  value: Decimal,
  nodeId: string,
): string {
  if (!value.isFinite()) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `non-finite decimal result at ${nodeId}`,
    );
  }
  const canonicalized = canonicalizeValueByType(valueType, value.toString());
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal canonicalization failed at ${nodeId}: ${canonicalized.message}`,
    );
  }
  return canonicalized.value as string;
}

function toDecimal(value: unknown, label: string, DecimalCtor: typeof Decimal) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal input must be string/number: ${label}`,
    );
  }

  try {
    const converted = new DecimalCtor(value);
    if (!converted.isFinite()) {
      throw new Error('non-finite');
    }
    return converted;
  } catch {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `invalid decimal input: ${label}`,
    );
  }
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
  DecimalCtor: typeof Decimal,
): unknown {
  if (valueType !== 'Decimal' && valueType !== 'Ratio') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `rounding only applies to Decimal/Ratio outputs`,
    );
  }

  const decimalValue = toDecimal(value, 'output.rounding', DecimalCtor);
  const rounded = decimalValue.toDecimalPlaces(scale, toDecimalRounding(mode));
  const canonicalized = canonicalizeValueByType(valueType, rounded.toString());
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `rounded output is invalid: ${canonicalized.message}`,
    );
  }
  return canonicalized.value;
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

function toBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new RunnerExecutionError(
    'RUNNER_DETERMINISTIC_ERROR',
    `boolean input must be boolean: ${label}`,
  );
}

function getNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new RunnerExecutionError(
    'RUNNER_DETERMINISTIC_ERROR',
    `expected a non-negative integer, got: ${String(value)}`,
  );
}

function getRoundingMode(value: unknown): RoundingMode {
  if (typeof value !== 'string') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `rounding mode must be a string, got: ${String(value)}`,
    );
  }
  switch (value) {
    case 'UP':
    case 'DOWN':
    case 'CEIL':
    case 'FLOOR':
    case 'HALF_UP':
    case 'HALF_DOWN':
    case 'HALF_EVEN':
    case 'HALF_CEIL':
    case 'HALF_FLOOR':
      return value;
    default:
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported rounding mode: ${value}`,
      );
  }
}

function toDecimalRounding(mode: RoundingMode): Decimal.Rounding {
  switch (mode) {
    case 'UP':
      return Decimal.ROUND_UP;
    case 'DOWN':
      return Decimal.ROUND_DOWN;
    case 'CEIL':
      return Decimal.ROUND_CEIL;
    case 'FLOOR':
      return Decimal.ROUND_FLOOR;
    case 'HALF_UP':
      return Decimal.ROUND_HALF_UP;
    case 'HALF_DOWN':
      return Decimal.ROUND_HALF_DOWN;
    case 'HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN;
    case 'HALF_CEIL':
      return Decimal.ROUND_HALF_CEIL;
    case 'HALF_FLOOR':
      return Decimal.ROUND_HALF_FLOOR;
    default: {
      const _exhaustive: never = mode;
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported rounding mode: ${String(_exhaustive)}`,
      );
    }
  }
}

function buildDecimalCtor(config: Record<string, unknown>): typeof Decimal {
  const decimalConfig = config['decimal'];
  if (!isPlainObject(decimalConfig)) {
    return Decimal.clone();
  }

  const options: { precision?: number; rounding?: Decimal.Rounding } = {};

  if (Object.prototype.hasOwnProperty.call(decimalConfig, 'precision')) {
    const precision = decimalConfig['precision'];
    if (
      typeof precision === 'number' &&
      Number.isInteger(precision) &&
      precision > 0
    ) {
      options.precision = precision;
    } else if (precision !== undefined) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        'decimal.precision must be a positive integer',
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(decimalConfig, 'roundingMode')) {
    const roundingMode = decimalConfig['roundingMode'];
    if (roundingMode === undefined) {
      // noop
    } else {
      options.rounding = toDecimalRounding(getRoundingMode(roundingMode));
    }
  }

  return Decimal.clone(options);
}

function canonicalizeChosenValue(
  valueType: ValueType,
  value: unknown,
  nodeId: string,
): unknown {
  const canonicalized = canonicalizeValueByType(valueType, value);
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `invalid ${valueType} at ${nodeId}: ${canonicalized.message}`,
    );
  }
  return canonicalized.value;
}
