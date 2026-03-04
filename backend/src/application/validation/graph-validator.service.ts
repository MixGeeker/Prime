import { Injectable } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type {
  NodeDef,
  NodePortDef,
  ValueType,
} from '../catalog/node-catalog.types';
import { BLUEPRINT_GRAPH_SCHEMA_V2, ROUNDING_MODES } from './graph-json.schema';
import type {
  GraphJsonV2,
  GraphNode,
  PinDef,
  RoundingMode,
} from './graph-json.types';
import type { ValidationIssue } from './validation-issue';

const DECIMAL_STRING_REGEX = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * BlueprintGraph 静态校验（M2）：
 * - 结构字段校验（Ajv）
 * - Node Catalog + paramsSchema 校验（Ajv）
 * - 唯一性、端口合法性、类型兼容、value-DAG 等跨字段校验（手写）
 */
@Injectable()
export class GraphValidatorService {
  private readonly ajv: Ajv;
  private readonly validateGraphSchema: ValidateFunction;

  constructor(private readonly nodeCatalogService: NodeCatalogService) {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    addFormats(this.ajv);
    this.validateGraphSchema = this.ajv.compile(BLUEPRINT_GRAPH_SCHEMA_V2);
  }

  validateGraph(content: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 1) 结构校验（字段/类型/基础约束）
    const okSchema = this.validateGraphSchema(content);
    if (!okSchema) {
      for (const err of this.validateGraphSchema.errors ?? []) {
        issues.push(this.toSchemaIssue(err));
      }
      return issues;
    }

    const graph = content as GraphJsonV2;

    // 2) 唯一性校验（names/ids/keys）
    this.validateUniqueness(graph, issues);

    // 3) defaults typed 校验（MVP 要求）
    this.validateDefaults(graph, issues);

    // 4) nodes：catalog + params 校验；并建立 nodeId -> (node, nodeDef) 索引
    const nodeIndex = this.buildNodeIndex(graph, issues);

    // 4.1) 内置节点的跨字段引用校验（locals）
    this.validateBuiltinReferences(graph, nodeIndex, issues);

    // 4.2) start/end（UE Pin 即契约）
    this.validateStartEnd(graph, nodeIndex, issues);

    // 5) value edges：端口合法性、单入边、类型兼容、value-DAG
    const valueDag = this.validateValueEdges(graph, nodeIndex, issues);
    if (valueDag && !isDag(valueDag.indegree, valueDag.adjacency)) {
      issues.push({
        code: 'GRAPH_VALUE_CYCLE_DETECTED',
        severity: 'error',
        path: '/edges',
        message: 'cycle detected in value edges',
      });
    }

    // 6) exec edges：端口合法性（允许环）
    this.validateExecEdges(graph, nodeIndex, issues);

    return issues;
  }

  private toSchemaIssue(err: ErrorObject): ValidationIssue {
    // 结构错误统一归类为 GRAPH_SCHEMA_INVALID，避免把 Ajv keyword 暴露给调用方。
    return {
      code: 'GRAPH_SCHEMA_INVALID',
      severity: 'error',
      path: err.instancePath || '/',
      message: err.message ?? 'graph schema invalid',
    };
  }

  private validateUniqueness(graph: GraphJsonV2, issues: ValidationIssue[]) {
    const localNames = new Set<string>();
    for (let i = 0; i < graph.locals.length; i++) {
      const l = graph.locals[i];
      if (localNames.has(l.name)) {
        issues.push({
          code: 'GRAPH_DUPLICATE_LOCAL_NAME',
          severity: 'error',
          path: `/locals/${i}/name`,
          message: `duplicate local name: ${l.name}`,
        });
      } else {
        localNames.add(l.name);
      }
    }

    const nodeIds = new Set<string>();
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      if (nodeIds.has(n.id)) {
        issues.push({
          code: 'GRAPH_DUPLICATE_NODE_ID',
          severity: 'error',
          path: `/nodes/${i}/id`,
          message: `duplicate node id: ${n.id}`,
        });
      } else {
        nodeIds.add(n.id);
      }
    }
  }

  private validateDefaults(graph: GraphJsonV2, issues: ValidationIssue[]) {
    for (let i = 0; i < graph.locals.length; i++) {
      const l = graph.locals[i];
      if (
        l.default !== undefined &&
        !isValidValueForType(l.valueType, l.default)
      ) {
        issues.push({
          code: 'GRAPH_INVALID_DEFAULT',
          severity: 'error',
          path: `/locals/${i}/default`,
          message: `default is invalid for type ${l.valueType}`,
        });
      }
    }
  }

  private buildNodeIndex(
    graph: GraphJsonV2,
    issues: ValidationIssue[],
  ): Map<string, IndexedNode> {
    const map = new Map<string, IndexedNode>();

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];

      const nodeDef = this.nodeCatalogService.getNodeDefForGraphNode(node);
      if (!nodeDef) {
        issues.push({
          code: 'GRAPH_NODE_NOT_IN_CATALOG',
          severity: 'error',
          path: `/nodes/${i}/nodeType`,
          message: `node not in catalog: ${node.nodeType}`,
        });
      }

      let paramsOk = true;
      if (nodeDef) {
        const paramsResult = this.nodeCatalogService.validateNodeParams(
          node.nodeType,
          node.params,
        );
        if (!paramsResult.ok) {
          paramsOk = false;
          for (const err of paramsResult.errors ?? []) {
            issues.push({
              code: 'GRAPH_NODE_PARAMS_INVALID',
              severity: 'error',
              path: joinPointer(`/nodes/${i}/params`, err.instancePath),
              message: err.message ?? 'node params invalid',
            });
          }
        }
      }

      map.set(node.id, { node, nodeIndex: i, nodeDef: nodeDef, paramsOk });
    }

    return map;
  }

  private validateValueEdges(
    graph: GraphJsonV2,
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ): {
    indegree: Map<string, number>;
    adjacency: Map<string, string[]>;
  } | null {
    const incomingByToPort = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const indegree = new Map<string, number>();

    for (const nodeId of nodeIndex.keys()) {
      adjacency.set(nodeId, []);
      indegree.set(nodeId, 0);
    }

    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];

      const fromNode = nodeIndex.get(edge.from.nodeId);
      if (!fromNode) {
        issues.push({
          code: 'GRAPH_EDGE_NODE_NOT_FOUND',
          severity: 'error',
          path: `/edges/${i}/from/nodeId`,
          message: `from.nodeId not found: ${edge.from.nodeId}`,
        });
        continue;
      }

      const toNode = nodeIndex.get(edge.to.nodeId);
      if (!toNode) {
        issues.push({
          code: 'GRAPH_EDGE_NODE_NOT_FOUND',
          severity: 'error',
          path: `/edges/${i}/to/nodeId`,
          message: `to.nodeId not found: ${edge.to.nodeId}`,
        });
        continue;
      }

      // value DAG 用的边（只要 node 存在就参与拓扑判断）
      const fromAdj = adjacency.get(edge.from.nodeId);
      if (fromAdj) {
        fromAdj.push(edge.to.nodeId);
      }
      const currentIn = indegree.get(edge.to.nodeId);
      if (currentIn !== undefined) {
        indegree.set(edge.to.nodeId, currentIn + 1);
      }

      // 如果节点不在 catalog，我们仍然认为“nodeId 存在”，但无法做端口/类型校验。
      if (!fromNode.nodeDef || !toNode.nodeDef) {
        continue;
      }

      const fromPort = findPort(fromNode.nodeDef.outputs, edge.from.port);
      if (!fromPort) {
        issues.push({
          code: 'GRAPH_EDGE_PORT_NOT_FOUND',
          severity: 'error',
          path: `/edges/${i}/from/port`,
          message: `from.port not found on node ${edge.from.nodeId}: ${edge.from.port}`,
        });
        continue;
      }

      const toPort = findPort(toNode.nodeDef.inputs, edge.to.port);
      if (!toPort) {
        issues.push({
          code: 'GRAPH_EDGE_PORT_NOT_FOUND',
          severity: 'error',
          path: `/edges/${i}/to/port`,
          message: `to.port not found on node ${edge.to.nodeId}: ${edge.to.port}`,
        });
        continue;
      }

      const toKey = `${edge.to.nodeId}::${edge.to.port}`;
      const prev = incomingByToPort.get(toKey) ?? 0;
      if (prev >= 1) {
        issues.push({
          code: 'GRAPH_EDGE_TO_PORT_MULTIPLE',
          severity: 'error',
          path: `/edges/${i}/to`,
          message: `to port has multiple incoming edges: ${edge.to.nodeId}.${edge.to.port}`,
        });
      }
      incomingByToPort.set(toKey, prev + 1);

      if (!isAssignableValueType(fromPort.valueType, toPort.valueType)) {
        issues.push({
          code: 'GRAPH_TYPE_MISMATCH',
          severity: 'error',
          path: `/edges/${i}`,
          message: `type mismatch: ${fromPort.valueType} -> ${toPort.valueType}`,
        });
      }
    }

    // 输入端口必须被连接（MVP 简化：无可选输入端口）
    for (const indexed of nodeIndex.values()) {
      if (!indexed.nodeDef) {
        continue;
      }
      for (const input of indexed.nodeDef.inputs) {
        const toKey = `${indexed.node.id}::${input.name}`;
        if (!incomingByToPort.has(toKey)) {
          issues.push({
            code: 'GRAPH_MISSING_INPUT_EDGE',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/id`,
            message: `missing edge for ${indexed.node.id}.${input.name}`,
          });
        }
      }
    }

    return { indegree, adjacency };
  }

  private validateExecEdges(
    graph: GraphJsonV2,
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ) {
    const outgoingByFromPort = new Map<string, number>();

    for (let i = 0; i < graph.execEdges.length; i++) {
      const edge = graph.execEdges[i];

      const fromNode = nodeIndex.get(edge.from.nodeId);
      if (!fromNode) {
        issues.push({
          code: 'GRAPH_EXEC_EDGE_NODE_NOT_FOUND',
          severity: 'error',
          path: `/execEdges/${i}/from/nodeId`,
          message: `from.nodeId not found: ${edge.from.nodeId}`,
        });
        continue;
      }

      const toNode = nodeIndex.get(edge.to.nodeId);
      if (!toNode) {
        issues.push({
          code: 'GRAPH_EXEC_EDGE_NODE_NOT_FOUND',
          severity: 'error',
          path: `/execEdges/${i}/to/nodeId`,
          message: `to.nodeId not found: ${edge.to.nodeId}`,
        });
        continue;
      }

      if (!fromNode.nodeDef || !toNode.nodeDef) {
        continue;
      }

      const fromKey = `${edge.from.nodeId}::${edge.from.port}`;
      outgoingByFromPort.set(
        fromKey,
        (outgoingByFromPort.get(fromKey) ?? 0) + 1,
      );
      if ((outgoingByFromPort.get(fromKey) ?? 0) > 1) {
        issues.push({
          code: 'GRAPH_EXEC_EDGE_FROM_PORT_MULTIPLE',
          severity: 'error',
          path: `/execEdges/${i}/from`,
          message: `exec from port has multiple outgoing edges: ${edge.from.nodeId}.${edge.from.port}`,
        });
      }

      const fromPortOk = (fromNode.nodeDef.execOutputs ?? []).some(
        (p) => p.name === edge.from.port,
      );
      if (!fromPortOk) {
        issues.push({
          code: 'GRAPH_EXEC_EDGE_PORT_NOT_FOUND',
          severity: 'error',
          path: `/execEdges/${i}/from/port`,
          message: `from.exec port not found on node ${edge.from.nodeId}: ${edge.from.port}`,
        });
        continue;
      }

      const toPortOk = (toNode.nodeDef.execInputs ?? []).some(
        (p) => p.name === edge.to.port,
      );
      if (!toPortOk) {
        issues.push({
          code: 'GRAPH_EXEC_EDGE_PORT_NOT_FOUND',
          severity: 'error',
          path: `/execEdges/${i}/to/port`,
          message: `to.exec port not found on node ${edge.to.nodeId}: ${edge.to.port}`,
        });
      }
    }
  }

  private validateBuiltinReferences(
    graph: GraphJsonV2,
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ) {
    const localsByName = new Map<string, ValueType>();
    for (const l of graph.locals) {
      localsByName.set(l.name, l.valueType);
    }

    for (const indexed of nodeIndex.values()) {
      if (!indexed.nodeDef || !indexed.paramsOk) {
        continue;
      }

      const nodeType = indexed.node.nodeType;
      const nodeNameParam = readNameParam(indexed.node.params);
      if (!nodeNameParam) {
        continue;
      }

      // locals.get.<type> / locals.set.<type>
      const localGetType = parseTypedNodeValueType(nodeType, 'locals.get.');
      const localSetType = parseTypedNodeValueType(nodeType, 'locals.set.');
      const localType = localGetType ?? localSetType;
      if (localType) {
        const declared = localsByName.get(nodeNameParam);
        if (!declared) {
          issues.push({
            code: 'GRAPH_LOCAL_NOT_FOUND',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/params/name`,
            message: `local is not declared: ${nodeNameParam}`,
          });
          continue;
        }

        const ok =
          localGetType !== null && localGetType !== undefined
            ? isAssignableValueType(declared, localType)
            : isAssignableValueType(localType, declared);

        if (!ok) {
          issues.push({
            code: 'GRAPH_LOCAL_TYPE_MISMATCH',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/params/name`,
            message: `local type mismatch: ${declared} vs ${localType}`,
          });
        }
      }
    }
  }

  private validateStartEnd(
    graph: GraphJsonV2,
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ) {
    // hard cut：禁止旧节点族（避免“start/end 只是占位 + 独立 inputs/outputs 节点”的旧心智模型继续存在）
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      const t = node.nodeType;
      if (
        t === 'flow.return' ||
        t.startsWith('inputs.') ||
        t.startsWith('outputs.set.')
      ) {
        issues.push({
          code: 'GRAPH_NODE_TYPE_FORBIDDEN',
          severity: 'error',
          path: `/nodes/${i}/nodeType`,
          message: `nodeType is forbidden in Graph v2: ${t}`,
        });
      }
    }

    const startNodes = graph.nodes.filter((n) => n.nodeType === 'flow.start');
    if (startNodes.length === 0) {
      issues.push({
        code: 'GRAPH_START_NODE_MISSING',
        severity: 'error',
        path: '/nodes',
        message: 'missing flow.start node',
      });
    }
    if (startNodes.length > 1) {
      issues.push({
        code: 'GRAPH_START_NODE_MULTIPLE',
        severity: 'error',
        path: '/nodes',
        message: `multiple flow.start nodes: ${startNodes.map((n) => n.id).join(', ')}`,
      });
    }

    const endNodes = graph.nodes.filter((n) => n.nodeType === 'flow.end');
    if (endNodes.length === 0) {
      issues.push({
        code: 'GRAPH_END_NODE_MISSING',
        severity: 'error',
        path: '/nodes',
        message: 'missing flow.end node',
      });
    }
    if (endNodes.length > 1) {
      issues.push({
        code: 'GRAPH_END_NODE_MULTIPLE',
        severity: 'error',
        path: '/nodes',
        message: `multiple flow.end nodes: ${endNodes.map((n) => n.id).join(', ')}`,
      });
    }

    // 验证 start/end 的 pins（唯一性/默认值/rounding）
    if (startNodes.length === 1) {
      const start = startNodes[0]!;
      const indexed = nodeIndex.get(start.id);
      if (indexed?.nodeDef && indexed.paramsOk) {
        const hasExecInputs = (indexed.nodeDef.execInputs ?? []).length > 0;
        if (hasExecInputs) {
          issues.push({
            code: 'GRAPH_START_NODE_INVALID',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/nodeType`,
            message: 'flow.start must have no execInputs',
          });
        }
        const hasOut = (indexed.nodeDef.execOutputs ?? []).some(
          (p) => p.name === 'out',
        );
        if (!hasOut) {
          issues.push({
            code: 'GRAPH_START_NODE_INVALID',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/nodeType`,
            message: 'flow.start must have exec output port: out',
          });
        }

        const pins = readPinDefs(indexed.node.params?.['dynamicOutputs']);
        validatePinList({
          pins,
          pointerBase: `/nodes/${indexed.nodeIndex}/params/dynamicOutputs`,
          issues,
          mode: 'start',
        });
      }
    }

    if (endNodes.length === 1) {
      const end = endNodes[0]!;
      const indexed = nodeIndex.get(end.id);
      if (indexed?.nodeDef && indexed.paramsOk) {
        const hasIn = (indexed.nodeDef.execInputs ?? []).some(
          (p) => p.name === 'in',
        );
        if (!hasIn) {
          issues.push({
            code: 'GRAPH_END_NODE_INVALID',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/nodeType`,
            message: 'flow.end must have exec input port: in',
          });
        }

        const pins = readPinDefs(indexed.node.params?.['dynamicInputs']);
        validatePinList({
          pins,
          pointerBase: `/nodes/${indexed.nodeIndex}/params/dynamicInputs`,
          issues,
          mode: 'end',
        });
      }
    }
  }
}

interface IndexedNode {
  node: GraphNode;
  nodeIndex: number;
  nodeDef?: NodeDef;
  paramsOk: boolean;
}

function joinPointer(prefix: string, instancePath: string): string {
  if (!instancePath) {
    return prefix;
  }
  return `${prefix}${instancePath}`;
}

function findPort(ports: NodePortDef[], name: string): NodePortDef | undefined {
  return ports.find((p) => p.name === name);
}

function isAssignableValueType(from: ValueType, to: ValueType): boolean {
  if (from === to) {
    return true;
  }
  // Ratio ⊂ Decimal
  return from === 'Ratio' && to === 'Decimal';
}

function readNameParam(params: unknown): string | null {
  if (params === null || typeof params !== 'object') {
    return null;
  }
  const record = params as Record<string, unknown>;
  const name = record['name'];
  return typeof name === 'string' && name.length > 0 ? name : null;
}

const PIN_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

function isValueType(value: unknown): value is ValueType {
  return (
    value === 'Decimal' ||
    value === 'Ratio' ||
    value === 'String' ||
    value === 'Boolean' ||
    value === 'DateTime' ||
    value === 'Json'
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function readPinDefs(value: unknown): PinDef[] {
  if (!Array.isArray(value)) return [];
  const pins: PinDef[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = item['name'];
    const valueType = item['valueType'];
    if (typeof name !== 'string' || name.length === 0) continue;
    if (!isValueType(valueType)) continue;
    pins.push(item as unknown as PinDef);
  }
  return pins;
}

function validatePinList(params: {
  pins: PinDef[];
  pointerBase: string;
  issues: ValidationIssue[];
  mode: 'start' | 'end';
}) {
  const { pins, pointerBase, issues, mode } = params;

  const seen = new Set<string>();
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i]!;

    if (!PIN_NAME_REGEX.test(pin.name)) {
      issues.push({
        code: 'GRAPH_PIN_NAME_INVALID',
        severity: 'error',
        path: `${pointerBase}/${i}/name`,
        message: `pin name must match ${PIN_NAME_REGEX.source}`,
      });
    }

    if (seen.has(pin.name)) {
      issues.push({
        code: 'GRAPH_PIN_NAME_DUPLICATE',
        severity: 'error',
        path: `${pointerBase}/${i}/name`,
        message: `duplicate pin name: ${pin.name}`,
      });
    } else {
      seen.add(pin.name);
    }

    if (mode === 'start') {
      if (
        Object.prototype.hasOwnProperty.call(pin, 'defaultValue') &&
        pin.defaultValue !== undefined &&
        !isValidValueForType(pin.valueType, pin.defaultValue)
      ) {
        issues.push({
          code: 'GRAPH_PIN_DEFAULT_INVALID',
          severity: 'error',
          path: `${pointerBase}/${i}/defaultValue`,
          message: `defaultValue is invalid for type ${pin.valueType}`,
        });
      }
      continue;
    }

    // mode === 'end'
    if (pin.rounding) {
      if (pin.valueType !== 'Decimal' && pin.valueType !== 'Ratio') {
        issues.push({
          code: 'GRAPH_INVALID_ROUNDING',
          severity: 'error',
          path: `${pointerBase}/${i}/rounding`,
          message: 'rounding is only allowed for Decimal/Ratio outputs',
        });
      }

      if (!Number.isInteger(pin.rounding.scale) || pin.rounding.scale < 0) {
        issues.push({
          code: 'GRAPH_INVALID_ROUNDING',
          severity: 'error',
          path: `${pointerBase}/${i}/rounding/scale`,
          message: 'rounding.scale must be a non-negative integer',
        });
      }

      if (!isRoundingMode(pin.rounding.mode)) {
        issues.push({
          code: 'GRAPH_INVALID_ROUNDING',
          severity: 'error',
          path: `${pointerBase}/${i}/rounding/mode`,
          message: `unknown rounding mode: ${String(pin.rounding.mode)}`,
        });
      }
    }
  }
}

function parseTypedNodeValueType(
  nodeType: string,
  prefix: string,
): ValueType | null {
  if (!nodeType.startsWith(prefix)) {
    return null;
  }
  const suffix = nodeType.slice(prefix.length);
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

function isDag(
  indegree: Map<string, number>,
  adjacency: Map<string, string[]>,
): boolean {
  const queue: string[] = [];
  for (const [nodeId, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  let processed = 0;
  const indegreeCopy = new Map(indegree);
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }
    processed++;
    for (const next of adjacency.get(nodeId) ?? []) {
      const current = indegreeCopy.get(next);
      if (current === undefined) {
        continue;
      }
      const updated = current - 1;
      indegreeCopy.set(next, updated);
      if (updated === 0) {
        queue.push(next);
      }
    }
  }

  return processed === indegree.size;
}

function isRoundingMode(value: unknown): value is RoundingMode {
  return (
    typeof value === 'string' &&
    (ROUNDING_MODES as readonly string[]).includes(value)
  );
}

function isValidValueForType(valueType: ValueType, value: unknown): boolean {
  switch (valueType) {
    case 'Decimal':
      return isValidDecimal(value);
    case 'Ratio':
      return isValidRatio(value);
    case 'String':
      return typeof value === 'string';
    case 'Boolean':
      return typeof value === 'boolean';
    case 'DateTime':
      return typeof value === 'string';
    case 'Json':
      return true;
    default: {
      const _exhaustive: never = valueType;
      return _exhaustive;
    }
  }
}

function isValidDecimal(value: unknown): boolean {
  if (typeof value === 'string') {
    return DECIMAL_STRING_REGEX.test(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return false;
}

function isValidRatio(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }
  if (typeof value === 'string') {
    if (!DECIMAL_STRING_REGEX.test(value)) {
      return false;
    }
    if (value.startsWith('-')) {
      return false;
    }
    if (value === '0' || value.startsWith('0.')) {
      return true;
    }
    if (value === '1') {
      return true;
    }
    if (value.startsWith('1.')) {
      const fractional = value.slice(2);
      return fractional.length > 0 && /^[0]+$/.test(fractional);
    }
    return false;
  }
  return false;
}
