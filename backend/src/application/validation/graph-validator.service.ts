import { Injectable } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type {
  NodeDef,
  NodePortDef,
  ValueType,
} from '../catalog/node-catalog.types';
import { BLUEPRINT_GRAPH_SCHEMA_V1, ROUNDING_MODES } from './graph-json.schema';
import type {
  GraphEntrypoint,
  GraphJsonV1,
  GraphNode,
  GraphOutput,
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
    this.validateGraphSchema = this.ajv.compile(BLUEPRINT_GRAPH_SCHEMA_V1);
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

    const graph = content as GraphJsonV1;

    // 2) 唯一性校验（names/ids/keys）
    this.validateUniqueness(graph, issues);

    // 3) defaults typed 校验（MVP 要求）
    this.validateDefaults(graph, issues);

    // 4) nodes：catalog + params 校验；并建立 nodeId -> (node, nodeDef) 索引
    const nodeIndex = this.buildNodeIndex(graph, issues);

    // 4.1) 内置节点的跨字段引用校验（globals/params/locals）
    this.validateBuiltinReferences(graph, nodeIndex, issues);

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

    // 7) entrypoints：必须包含 main；to 必须指向 exec 输入端口
    this.validateEntrypoints(graph.entrypoints, nodeIndex, issues);

    // 8) outputs：from 必须合法；rounding 约束
    this.validateOutputs(graph.outputs, nodeIndex, issues);

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

  private validateUniqueness(graph: GraphJsonV1, issues: ValidationIssue[]) {
    const globalNames = new Set<string>();
    for (let i = 0; i < graph.globals.length; i++) {
      const g = graph.globals[i];
      if (globalNames.has(g.name)) {
        issues.push({
          code: 'GRAPH_DUPLICATE_GLOBAL_NAME',
          severity: 'error',
          path: `/globals/${i}/name`,
          message: `duplicate global name: ${g.name}`,
        });
      } else {
        globalNames.add(g.name);
      }
    }

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

    const entrypointKeys = new Set<string>();
    for (let i = 0; i < graph.entrypoints.length; i++) {
      const ep = graph.entrypoints[i];
      if (entrypointKeys.has(ep.key)) {
        issues.push({
          code: 'GRAPH_DUPLICATE_ENTRYPOINT_KEY',
          severity: 'error',
          path: `/entrypoints/${i}/key`,
          message: `duplicate entrypoint key: ${ep.key}`,
        });
      } else {
        entrypointKeys.add(ep.key);
      }

      const paramNames = new Set<string>();
      for (let j = 0; j < ep.params.length; j++) {
        const p = ep.params[j];
        if (paramNames.has(p.name)) {
          issues.push({
            code: 'GRAPH_DUPLICATE_ENTRYPOINT_PARAM_NAME',
            severity: 'error',
            path: `/entrypoints/${i}/params/${j}/name`,
            message: `duplicate entrypoint param name: ${p.name}`,
          });
        } else {
          paramNames.add(p.name);
        }
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

    const outputKeys = new Set<string>();
    for (let i = 0; i < graph.outputs.length; i++) {
      const o = graph.outputs[i];
      if (outputKeys.has(o.key)) {
        issues.push({
          code: 'GRAPH_DUPLICATE_OUTPUT_KEY',
          severity: 'error',
          path: `/outputs/${i}/key`,
          message: `duplicate output key: ${o.key}`,
        });
      } else {
        outputKeys.add(o.key);
      }
    }
  }

  private validateDefaults(graph: GraphJsonV1, issues: ValidationIssue[]) {
    for (let i = 0; i < graph.globals.length; i++) {
      const g = graph.globals[i];
      if (
        g.default !== undefined &&
        !isValidValueForType(g.valueType, g.default)
      ) {
        issues.push({
          code: 'GRAPH_INVALID_DEFAULT',
          severity: 'error',
          path: `/globals/${i}/default`,
          message: `default is invalid for type ${g.valueType}`,
        });
      }
    }

    for (let i = 0; i < graph.entrypoints.length; i++) {
      const ep = graph.entrypoints[i];
      for (let j = 0; j < ep.params.length; j++) {
        const p = ep.params[j];
        if (
          p.default !== undefined &&
          !isValidValueForType(p.valueType, p.default)
        ) {
          issues.push({
            code: 'GRAPH_INVALID_DEFAULT',
            severity: 'error',
            path: `/entrypoints/${i}/params/${j}/default`,
            message: `default is invalid for type ${p.valueType}`,
          });
        }
      }
    }

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
    graph: GraphJsonV1,
    issues: ValidationIssue[],
  ): Map<string, IndexedNode> {
    const map = new Map<string, IndexedNode>();

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];

      const nodeDef = this.nodeCatalogService.getNode(node.nodeType);
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
    graph: GraphJsonV1,
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
    graph: GraphJsonV1,
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
    graph: GraphJsonV1,
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ) {
    const globalsByName = new Map<string, ValueType>();
    for (const g of graph.globals) {
      globalsByName.set(g.name, g.valueType);
    }

    const localsByName = new Map<string, ValueType>();
    for (const l of graph.locals) {
      localsByName.set(l.name, l.valueType);
    }

    const entrypointParamTypesByName = new Map<string, Set<ValueType>>();
    for (const ep of graph.entrypoints) {
      for (const p of ep.params) {
        const set =
          entrypointParamTypesByName.get(p.name) ?? new Set<ValueType>();
        set.add(p.valueType);
        entrypointParamTypesByName.set(p.name, set);
      }
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

      // inputs.globals.<type>
      const globalType = parseTypedNodeValueType(nodeType, 'inputs.globals.');
      if (globalType) {
        const declared = globalsByName.get(nodeNameParam);
        if (!declared) {
          issues.push({
            code: 'GRAPH_INPUT_GLOBAL_NOT_FOUND',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/params/name`,
            message: `global is not declared: ${nodeNameParam}`,
          });
          continue;
        }
        if (!isAssignableValueType(declared, globalType)) {
          issues.push({
            code: 'GRAPH_INPUT_GLOBAL_TYPE_MISMATCH',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/params/name`,
            message: `global type mismatch: ${declared} -> ${globalType}`,
          });
        }
        continue;
      }

      // inputs.params.<type>
      const paramType = parseTypedNodeValueType(nodeType, 'inputs.params.');
      if (paramType) {
        const declaredTypes = entrypointParamTypesByName.get(nodeNameParam);
        if (!declaredTypes || declaredTypes.size === 0) {
          issues.push({
            code: 'GRAPH_INPUT_PARAM_NOT_FOUND',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/params/name`,
            message: `entrypoint param is not declared: ${nodeNameParam}`,
          });
          continue;
        }

        const ok = [...declaredTypes].some((t) =>
          isAssignableValueType(t, paramType),
        );
        if (!ok) {
          issues.push({
            code: 'GRAPH_INPUT_PARAM_TYPE_MISMATCH',
            severity: 'error',
            path: `/nodes/${indexed.nodeIndex}/params/name`,
            message: `entrypoint param type mismatch: ${nodeNameParam}`,
          });
        }
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

  private validateEntrypoints(
    entrypoints: GraphEntrypoint[],
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ) {
    if (!entrypoints.some((e) => e.key === 'main')) {
      issues.push({
        code: 'GRAPH_ENTRYPOINT_MISSING',
        severity: 'error',
        path: '/entrypoints',
        message: 'missing entrypoint: main',
      });
    }

    for (let i = 0; i < entrypoints.length; i++) {
      const ep = entrypoints[i];
      const target = nodeIndex.get(ep.to.nodeId);
      if (!target) {
        issues.push({
          code: 'GRAPH_ENTRYPOINT_INVALID',
          severity: 'error',
          path: `/entrypoints/${i}/to/nodeId`,
          message: `entrypoint target node not found: ${ep.to.nodeId}`,
        });
        continue;
      }
      if (!target.nodeDef) {
        continue;
      }
      const ok = (target.nodeDef.execInputs ?? []).some(
        (p) => p.name === ep.to.port,
      );
      if (!ok) {
        issues.push({
          code: 'GRAPH_ENTRYPOINT_INVALID',
          severity: 'error',
          path: `/entrypoints/${i}/to/port`,
          message: `entrypoint target exec port not found: ${ep.to.nodeId}.${ep.to.port}`,
        });
      }
    }
  }

  private validateOutputs(
    outputs: GraphOutput[],
    nodeIndex: Map<string, IndexedNode>,
    issues: ValidationIssue[],
  ) {
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      const source = nodeIndex.get(output.from.nodeId);
      if (!source) {
        issues.push({
          code: 'GRAPH_OUTPUT_FROM_INVALID',
          severity: 'error',
          path: `/outputs/${i}/from/nodeId`,
          message: `output source node not found: ${output.from.nodeId}`,
        });
        continue;
      }
      if (!source.nodeDef) {
        continue;
      }

      const fromPort = findPort(source.nodeDef.outputs, output.from.port);
      if (!fromPort) {
        issues.push({
          code: 'GRAPH_OUTPUT_FROM_INVALID',
          severity: 'error',
          path: `/outputs/${i}/from/port`,
          message: `output source port not found: ${output.from.nodeId}.${output.from.port}`,
        });
        continue;
      }

      if (!isAssignableValueType(fromPort.valueType, output.valueType)) {
        issues.push({
          code: 'GRAPH_OUTPUT_TYPE_MISMATCH',
          severity: 'error',
          path: `/outputs/${i}`,
          message: `output type mismatch: ${fromPort.valueType} -> ${output.valueType}`,
        });
      }

      if (output.rounding) {
        if (output.valueType !== 'Decimal' && output.valueType !== 'Ratio') {
          issues.push({
            code: 'GRAPH_INVALID_ROUNDING',
            severity: 'error',
            path: `/outputs/${i}/rounding`,
            message: 'rounding is only allowed for Decimal/Ratio outputs',
          });
        }
        if (
          !Number.isInteger(output.rounding.scale) ||
          output.rounding.scale < 0
        ) {
          issues.push({
            code: 'GRAPH_INVALID_ROUNDING',
            severity: 'error',
            path: `/outputs/${i}/rounding/scale`,
            message: 'rounding.scale must be a non-negative integer',
          });
        }
        if (!isRoundingMode(output.rounding.mode)) {
          issues.push({
            code: 'GRAPH_INVALID_ROUNDING',
            severity: 'error',
            path: `/outputs/${i}/rounding/mode`,
            message: `unknown rounding mode: ${String(output.rounding.mode)}`,
          });
        }
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
