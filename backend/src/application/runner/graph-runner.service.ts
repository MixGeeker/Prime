import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type { ValueType } from '../catalog/node-catalog.types';
import { getNodeImplementationV1 } from '../nodes/v1/registry';
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
import {
  getRoundingMode,
  toDecimal,
  toDecimalRounding,
} from '../nodes/shared/decimal-runtime';
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

      const impl = getNodeImplementationV1(node.nodeType, node.nodeVersion);
      if (!impl) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `unsupported node type: ${node.nodeType}`,
        );
      }

      const currentOutputs = impl.evaluate({
        node,
        def: nodeDef,
        inputs: inputValues,
        variableValues: params.variableValues,
        DecimalCtor,
      });
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
