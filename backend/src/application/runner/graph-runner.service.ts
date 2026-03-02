import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type { NodeDef, ValueType } from '../catalog/node-catalog.types';
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
import type { RunnerRuntimeContext } from '../nodes/node-implementation.types';

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

    const { maxDepth } = topologicalSortWithDepth(graph);
    if (maxDepth > limits.maxDepth) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `graph depth exceeds maxDepth: ${maxDepth} > ${limits.maxDepth}`,
      );
    }

    const startedAt = Date.now();

    const nodeById = new Map<string, GraphNode>();
    for (const node of graph.nodes) {
      nodeById.set(node.id, node);
    }

    const incomingValueEdgeByPort = new Map<string, GraphEdge>();
    for (const edge of graph.edges) {
      incomingValueEdgeByPort.set(`${edge.to.nodeId}::${edge.to.port}`, edge);
    }

    const execEdgeByFromPort = new Map<string, GraphEdge>();
    for (const edge of graph.execEdges) {
      const key = `${edge.from.nodeId}::${edge.from.port}`;
      if (execEdgeByFromPort.has(key)) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `exec output has multiple outgoing edges: ${key}`,
        );
      }
      execEdgeByFromPort.set(key, edge);
    }

    const localsByName = new Map<string, unknown>();
    for (const local of graph.locals) {
      const hasDefault = Object.prototype.hasOwnProperty.call(local, 'default');
      const defaultValue = hasDefault
        ? (local as { default?: unknown }).default
        : null;

      if (defaultValue === null || defaultValue === undefined) {
        localsByName.set(local.name, null);
        continue;
      }

      const canonicalized = canonicalizeValueByType(local.valueType, defaultValue);
      if (!canonicalized.ok) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `invalid local default for ${local.name}: ${canonicalized.message}`,
        );
      }
      localsByName.set(local.name, canonicalized.value);
    }

    const pureOutputsCacheByNodeId = new Map<string, Record<string, unknown>>();
    const impureOutputsByNodeId = new Map<string, Record<string, unknown>>();

    const runtime: RunnerRuntimeContext = {
      globals: params.inputs.globals,
      params: params.inputs.params,
      getLocal: (name) => {
        if (!localsByName.has(name)) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `local is not declared: ${name}`,
          );
        }
        return localsByName.get(name);
      },
      setLocal: (name, value) => {
        if (!localsByName.has(name)) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `local is not declared: ${name}`,
          );
        }
        localsByName.set(name, value);
        pureOutputsCacheByNodeId.clear();
      },
    };

    const entrypointKey =
      typeof params.entrypointKey === 'string' && params.entrypointKey.length > 0
        ? params.entrypointKey
        : 'main';
    const entrypoint = graph.entrypoints.find((ep) => ep.key === entrypointKey);
    if (!entrypoint) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `entrypoint not found: ${entrypointKey}`,
      );
    }

    let currentExec = entrypoint.to;
    let steps = 0;

    while (currentExec) {
      ensureTimeout(startedAt, limits.timeoutMs);
      steps++;
      if (steps > limits.maxSteps) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `exec steps exceeds maxSteps: ${steps} > ${limits.maxSteps}`,
        );
      }

      const node = nodeById.get(currentExec.nodeId);
      if (!node) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `node not found: ${currentExec.nodeId}`,
        );
      }

      const nodeDef = this.nodeCatalogService.getNode(node.nodeType);
      if (!nodeDef) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `node is not in catalog: ${node.nodeType}`,
        );
      }

      const execInputs = nodeDef.execInputs ?? [];
      if (!execInputs.some((p) => p.name === currentExec.port)) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `exec input port not found: ${node.id}.${currentExec.port}`,
        );
      }

      const impl = getNodeImplementationV1(node.nodeType);
      if (!impl) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `unsupported node type: ${node.nodeType}`,
        );
      }

      const inputValues = this.buildInputValues({
        node,
        nodeDef,
        nodeById,
        incomingValueEdgeByPort,
        pureOutputsCacheByNodeId,
        impureOutputsByNodeId,
        startedAt,
        timeoutMs: limits.timeoutMs,
        runtime,
        DecimalCtor,
      });

      const valueOutputs = impl.evaluate({
        node,
        def: nodeDef,
        inputs: inputValues,
        runtime,
        DecimalCtor,
      });

      if (nodeDef.outputs.length > 0) {
        impureOutputsByNodeId.set(node.id, valueOutputs);
        pureOutputsCacheByNodeId.clear();
      }

      const execOutputs = nodeDef.execOutputs ?? [];
      if (execOutputs.length === 0) {
        break;
      }

      const execResult = impl.execute
        ? impl.execute({
            node,
            def: nodeDef,
            inputs: inputValues,
            runtime,
            DecimalCtor,
            execInPort: currentExec.port,
          })
        : execOutputs.length === 1
          ? { kind: 'continue' as const, port: execOutputs[0]!.name }
          : { kind: 'return' as const };

      if (execResult.kind === 'return') {
        break;
      }

      const nextEdge = execEdgeByFromPort.get(`${node.id}::${execResult.port}`);
      if (!nextEdge) {
        break;
      }
      currentExec = nextEdge.to;
    }

    const outputs: Record<string, unknown> = {};
    for (const output of graph.outputs) {
      ensureTimeout(startedAt, limits.timeoutMs);

      const value = this.readValue({
        nodeId: output.from.nodeId,
        port: output.from.port,
        nodeById,
        incomingValueEdgeByPort,
        pureOutputsCacheByNodeId,
        impureOutputsByNodeId,
        startedAt,
        timeoutMs: limits.timeoutMs,
        runtime,
        DecimalCtor,
      });

      const outputValue = output.rounding
        ? applyOutputRounding(
            value,
            output.valueType,
            output.rounding.scale,
            output.rounding.mode,
            DecimalCtor,
          )
        : value;

      outputs[output.key] = outputValue;
    }

    return { outputs };
  }

  private buildInputValues(params: {
    node: GraphNode;
    nodeDef: NodeDef;
    nodeById: Map<string, GraphNode>;
    incomingValueEdgeByPort: Map<string, GraphEdge>;
    pureOutputsCacheByNodeId: Map<string, Record<string, unknown>>;
    impureOutputsByNodeId: Map<string, Record<string, unknown>>;
    startedAt: number;
    timeoutMs: number;
    runtime: RunnerRuntimeContext;
    DecimalCtor: typeof Decimal;
  }): Record<string, unknown> {
    const {
      node,
      nodeDef,
      nodeById,
      incomingValueEdgeByPort,
      pureOutputsCacheByNodeId,
      impureOutputsByNodeId,
      startedAt,
      timeoutMs,
      runtime,
      DecimalCtor,
    } = params;

    const inputValues: Record<string, unknown> = {};
    for (const inputPort of nodeDef.inputs) {
      ensureTimeout(startedAt, timeoutMs);

      const incomingEdge = incomingValueEdgeByPort.get(
        `${node.id}::${inputPort.name}`,
      );
      if (!incomingEdge) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `missing edge for ${node.id}.${inputPort.name}`,
        );
      }

      inputValues[inputPort.name] = this.readValue({
        nodeId: incomingEdge.from.nodeId,
        port: incomingEdge.from.port,
        nodeById,
        incomingValueEdgeByPort,
        pureOutputsCacheByNodeId,
        impureOutputsByNodeId,
        startedAt,
        timeoutMs,
        runtime,
        DecimalCtor,
      });
    }

    return inputValues;
  }

  private readValue(params: {
    nodeId: string;
    port: string;
    nodeById: Map<string, GraphNode>;
    incomingValueEdgeByPort: Map<string, GraphEdge>;
    pureOutputsCacheByNodeId: Map<string, Record<string, unknown>>;
    impureOutputsByNodeId: Map<string, Record<string, unknown>>;
    startedAt: number;
    timeoutMs: number;
    runtime: RunnerRuntimeContext;
    DecimalCtor: typeof Decimal;
  }): unknown {
    const {
      nodeId,
      port,
      nodeById,
      incomingValueEdgeByPort,
      pureOutputsCacheByNodeId,
      impureOutputsByNodeId,
      startedAt,
      timeoutMs,
      runtime,
      DecimalCtor,
    } = params;

    ensureTimeout(startedAt, timeoutMs);

    const node = nodeById.get(nodeId);
    if (!node) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `node not found: ${nodeId}`,
      );
    }

    const nodeDef = this.nodeCatalogService.getNode(node.nodeType);
    if (!nodeDef) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `node is not in catalog: ${node.nodeType}`,
      );
    }

    const isImpure =
      (nodeDef.execInputs ?? []).length > 0 || (nodeDef.execOutputs ?? []).length > 0;
    if (isImpure) {
      const outputs = impureOutputsByNodeId.get(node.id);
      if (!outputs) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `impure node outputs not available before execution: ${node.id}`,
        );
      }
      if (!Object.prototype.hasOwnProperty.call(outputs, port)) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `source port not found: ${node.id}.${port}`,
        );
      }
      return outputs[port];
    }

    const cached = pureOutputsCacheByNodeId.get(node.id);
    if (cached) {
      if (!Object.prototype.hasOwnProperty.call(cached, port)) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `source port not found: ${node.id}.${port}`,
        );
      }
      return cached[port];
    }

    const impl = getNodeImplementationV1(node.nodeType);
    if (!impl) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported node type: ${node.nodeType}`,
      );
    }

    const inputValues = this.buildInputValues({
      node,
      nodeDef,
      nodeById,
      incomingValueEdgeByPort,
      pureOutputsCacheByNodeId,
      impureOutputsByNodeId,
      startedAt,
      timeoutMs,
      runtime,
      DecimalCtor,
    });

    const outputs = impl.evaluate({
      node,
      def: nodeDef,
      inputs: inputValues,
      runtime,
      DecimalCtor,
    });
    pureOutputsCacheByNodeId.set(node.id, outputs);

    if (!Object.prototype.hasOwnProperty.call(outputs, port)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `source port not found: ${node.id}.${port}`,
      );
    }
    return outputs[port];
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

  return { maxDepth };
}

function readRunnerLimits(config: unknown): {
  maxNodes: number;
  maxDepth: number;
  maxSteps: number;
  timeoutMs: number;
  maxCallDepth: number;
} {
  const defaults = {
    maxNodes: 500,
    maxDepth: 200,
    maxSteps: 20000,
    timeoutMs: 3000,
    maxCallDepth: 8,
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
    maxSteps: readPositiveInt(limitsValue['maxSteps'], defaults.maxSteps),
    timeoutMs: readPositiveInt(limitsValue['timeoutMs'], defaults.timeoutMs),
    maxCallDepth: readPositiveInt(
      limitsValue['maxCallDepth'],
      defaults.maxCallDepth,
    ),
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
