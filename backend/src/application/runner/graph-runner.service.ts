/**
 * BlueprintGraph Runner（控制流解释器）。
 *
 * 核心语义：
 * - execEdges 驱动执行（允许环）；value edges 按需惰性求值（必须 DAG）
 * - locals 提供图内可变状态；当 locals.set 发生时会清空纯节点缓存
 * - impure 节点（含 exec ports）必须先执行后才能读取其 value 输出
 * - 支持 continue_many（用于 `flow.sequence` 等“一进多出”的确定性顺序调度）
 *
 * 子蓝图调用：
 * - Runner 本身不做 DB/HTTP 等 IO
 * - `flow.call_definition` 通过 runtime.callDefinition 调用子图
 * - 被调用方内容必须提前通过 `definitionBundle` 注入
 */
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type { NodeDef, ValueType } from '../catalog/node-catalog.types';
import { getNodeImplementationV1 } from '../nodes/v1/registry';
import type {
  RunnerPort,
  RunnerDefinitionBundleItem,
  RunnerRunParams,
  RunnerRunResult,
} from '../ports/runner.port';
import type {
  GraphEdge,
  GraphEndpoint,
  GraphJsonV2,
  GraphNode,
  PinDef,
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
import type {
  NodeExecutionResult,
  RunnerRuntimeContext,
} from '../nodes/node-implementation.types';

@Injectable()
export class GraphRunnerService implements RunnerPort {
  constructor(private readonly nodeCatalogService: NodeCatalogService) {}

  run(params: RunnerRunParams): RunnerRunResult {
    const definitionBundleMap = new Map<string, RunnerDefinitionBundleItem>();
    for (const item of params.definitionBundle ?? []) {
      const key = `${item.definitionId}@${item.definitionHash}`;
      if (definitionBundleMap.has(key)) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `duplicate definition in bundle: ${key}`,
        );
      }
      definitionBundleMap.set(key, item);
    }

    const rootLimits = readRunnerLimits(
      deepMerge(params.runnerConfig ?? {}, params.options ?? {}),
    );

    return this.runInternal({
      content: params.content,
      entrypointKey: params.entrypointKey,
      inputs: params.inputs,
      runnerConfig: params.runnerConfig,
      options: params.options,
      definitionBundleMap,
      callDepth: 0,
      maxCallDepth: rootLimits.maxCallDepth,
    });
  }

  private runInternal(params: {
    content: Record<string, unknown>;
    entrypointKey?: string;
    inputs: Record<string, unknown>;
    runnerConfig?: Record<string, unknown> | null;
    options?: Record<string, unknown> | null;
    definitionBundleMap: Map<string, RunnerDefinitionBundleItem>;
    callDepth: number;
    maxCallDepth: number;
  }): RunnerRunResult {
    const schemaVersion = params.content['schemaVersion'];
    if (schemaVersion !== 2) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported graph schemaVersion: ${String(schemaVersion)}`,
      );
    }
    const graph = params.content as unknown as GraphJsonV2;

    const effectiveRunnerConfig = deepMerge(
      params.runnerConfig ?? {},
      params.options ?? {},
    );
    const limits = readRunnerLimits(effectiveRunnerConfig);
    const DecimalCtor = buildDecimalCtor(effectiveRunnerConfig);

    if (!isPlainObject(params.inputs)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        'inputs must be an object',
      );
    }

    const runtimeInputs = canonicalizeRuntimeInputsOrThrow({
      pins: readPinDefs(
        graph.nodes.find((n) => n.nodeType === 'flow.start')?.params?.[
          'dynamicOutputs'
        ],
      ),
      inputs: params.inputs,
    });

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
      const defaultValue = local.default;

      if (defaultValue === null || defaultValue === undefined) {
        localsByName.set(local.name, null);
        continue;
      }

      const canonicalized = canonicalizeValueByType(
        local.valueType,
        defaultValue,
      );
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
    let finalOutputs: Record<string, unknown> | null = null;

    const runtime: RunnerRuntimeContext = {
      inputs: runtimeInputs,
      // 兼容：旧节点族仍可能读取 globals/params；Graph v2 下两者指向同一个 inputs。
      globals: runtimeInputs,
      params: runtimeInputs,
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
      setOutput: ({ key, nodeId }) => {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `setOutput is not supported in Graph v2: ${key} (at ${nodeId})`,
        );
      },
      callDefinition: (call) => {
        if (params.callDepth + 1 > params.maxCallDepth) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `call depth exceeds maxCallDepth: ${params.callDepth + 1} > ${params.maxCallDepth}`,
          );
        }

        const key = `${call.definitionId}@${call.definitionHash}`;
        const callee = params.definitionBundleMap.get(key);
        if (!callee) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `callee definition not found in bundle: ${key}`,
          );
        }

        return this.runInternal({
          content: callee.content,
          entrypointKey: call.entrypointKey,
          inputs: call.inputs,
          runnerConfig: callee.runnerConfig ?? null,
          options: params.options ?? null,
          definitionBundleMap: params.definitionBundleMap,
          callDepth: params.callDepth + 1,
          maxCallDepth: params.maxCallDepth,
        });
      },
    };

    const execStack: GraphEndpoint[] = [];
    const startNodes = graph.nodes.filter((n) => n.nodeType === 'flow.start');
    if (startNodes.length !== 1) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `graph must contain exactly 1 flow.start node, got ${startNodes.length}`,
      );
    }
    const startNode = startNodes[0];

    const endNodes = graph.nodes.filter((n) => n.nodeType === 'flow.end');
    if (endNodes.length !== 1) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `graph must contain exactly 1 flow.end node, got ${endNodes.length}`,
      );
    }
    const endNodeId = endNodes[0].id;

    // 预先计算 start 的 value outputs（start 为 impure 节点，但没有 execInputs，不会被 while-loop 执行）
    const startDef = this.nodeCatalogService.getNodeDefForGraphNode(startNode);
    if (!startDef) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.start node is not in catalog: ${startNode.nodeType}`,
      );
    }
    const startImpl = getNodeImplementationV1(startNode.nodeType);
    if (!startImpl) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported node type: ${startNode.nodeType}`,
      );
    }
    const startValueOutputs = startImpl.evaluate({
      node: startNode,
      def: startDef,
      inputs: {},
      runtime,
      DecimalCtor,
    });
    impureOutputsByNodeId.set(startNode.id, startValueOutputs);

    const firstEdge = execEdgeByFromPort.get(`${startNode.id}::out`);
    if (firstEdge) {
      execStack.push(firstEdge.to);
    }
    let steps = 0;

    while (execStack.length > 0) {
      const currentExec = execStack.pop();
      if (!currentExec) {
        break;
      }
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

      const nodeDef = this.nodeCatalogService.getNodeDefForGraphNode(node);
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

      if (node.id === endNodeId) {
        finalOutputs = buildOutputsFromEndNode({
          node,
          inputValues,
          DecimalCtor,
        });
      }

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

      let execResult: NodeExecutionResult | null = null;
      if (impl.execute) {
        execResult = impl.execute({
          node,
          def: nodeDef,
          inputs: inputValues,
          runtime,
          DecimalCtor,
          execInPort: currentExec.port,
        });
      } else if (execOutputs.length === 1 && execOutputs[0]) {
        execResult = { kind: 'continue', port: execOutputs[0].name };
      } else if (execOutputs.length > 1) {
        execResult = { kind: 'return' };
      }

      if (!execResult) {
        continue;
      }

      if (execResult.kind === 'return') {
        execStack.length = 0;
        break;
      }

      if (execResult.kind === 'continue_many') {
        // LIFO 栈：逆序 push 以保证 ports[0] 最先执行（确定性）。
        for (let i = execResult.ports.length - 1; i >= 0; i--) {
          const port = execResult.ports[i];
          if (!port) {
            continue;
          }
          const nextEdge = execEdgeByFromPort.get(`${node.id}::${port}`);
          if (nextEdge) {
            execStack.push(nextEdge.to);
          }
        }
        continue;
      }

      const nextEdge = execEdgeByFromPort.get(`${node.id}::${execResult.port}`);
      if (nextEdge) {
        execStack.push(nextEdge.to);
      }
    }

    if (!finalOutputs) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        'flow.end is not reached; outputs are not produced',
      );
    }

    return { outputs: finalOutputs };
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
        if (node.nodeType === 'flow.call_definition') {
          const pins = readPinDefs(node.params?.['calleeInputPins']);
          const pin = pins.find((p) => p.name === inputPort.name) ?? null;
          const required = pin ? (pin.required ?? true) : true;
          const hasDefault = pin ? Object.hasOwn(pin, 'defaultValue') : false;
          if (!required || hasDefault) {
            continue;
          }
        }
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

    const nodeDef = this.nodeCatalogService.getNodeDefForGraphNode(node);
    if (!nodeDef) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `node is not in catalog: ${node.nodeType}`,
      );
    }

    const isImpure =
      (nodeDef.execInputs ?? []).length > 0 ||
      (nodeDef.execOutputs ?? []).length > 0;
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

function buildOutputsFromEndNode(params: {
  node: GraphNode;
  inputValues: Record<string, unknown>;
  DecimalCtor: typeof Decimal;
}): Record<string, unknown> {
  const pins = readPinDefs(params.node.params?.['dynamicInputs']);
  const outputs: Record<string, unknown> = {};

  for (const pin of pins) {
    const raw = params.inputValues[pin.name];
    const value =
      pin.rounding && pin.rounding.mode && pin.rounding.scale !== undefined
        ? applyOutputRounding(
            raw,
            pin.valueType,
            pin.rounding.scale,
            pin.rounding.mode,
            params.DecimalCtor,
          )
        : raw;
    outputs[pin.name] = value;
  }

  return outputs;
}

function ensureTimeout(startedAt: number, timeoutMs: number) {
  if (Date.now() - startedAt > timeoutMs) {
    throw new RunnerExecutionError('RUNNER_TIMEOUT', 'runner timeout exceeded');
  }
}

function topologicalSortWithDepth(graph: GraphJsonV2): {
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

function canonicalizeRuntimeInputsOrThrow(params: {
  pins: PinDef[];
  inputs: Record<string, unknown>;
}): Record<string, unknown> {
  const { pins, inputs } = params;

  const result: Record<string, unknown> = {};
  for (const pin of pins) {
    const required = pin.required ?? true;
    const hasValue = Object.hasOwn(inputs, pin.name);
    const raw = hasValue ? inputs[pin.name] : undefined;

    let effective: unknown = raw;
    if (effective === undefined) {
      if (Object.hasOwn(pin, 'defaultValue')) {
        effective = pin.defaultValue;
      } else {
        effective = null;
      }
    }

    if (effective === null) {
      if (required) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `missing required input: inputs.${pin.name}`,
        );
      }
      result[pin.name] = null;
      continue;
    }

    const canonicalized = canonicalizeValueByType(pin.valueType, effective);
    if (!canonicalized.ok) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid input for inputs.${pin.name} (${pin.valueType}): ${canonicalized.message}`,
      );
    }
    result[pin.name] = canonicalized.value;
  }

  return result;
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
