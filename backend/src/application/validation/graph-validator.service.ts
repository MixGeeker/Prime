import { Injectable } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { NodeCatalogService } from '../catalog/node-catalog.service';
import type {
  NodeDef,
  NodePortDef,
  ValueType,
} from '../catalog/node-catalog.types';
import { GRAPH_JSON_SCHEMA_V1, ROUNDING_MODES } from './graph-json.schema';
import type { GraphJsonV1, GraphNode, RoundingMode } from './graph-json.types';
import type { ValidationIssue } from './validation-issue';

const DECIMAL_STRING_REGEX = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Graph 静态校验（M2）：
 * - 结构字段校验（Ajv）
 * - Node Catalog + paramsSchema 校验（Ajv）
 * - 唯一性、端口合法性、类型兼容、DAG 等跨字段校验（手写）
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
    this.validateGraphSchema = this.ajv.compile(GRAPH_JSON_SCHEMA_V1);
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

    // 结构校验通过后，可以安全地按 GraphJsonV1 继续做跨字段校验。
    const graph = content as GraphJsonV1;

    // 2) 唯一性校验
    this.validateUniqueness(graph, issues);

    // 3) variables.default typed 校验（MVP 要求）
    this.validateVariableDefaults(graph, issues);

    // 4) nodes：catalog + params 校验；并建立 nodeId -> (node, nodeDef) 索引
    const nodeIndex = this.buildNodeIndex(graph, issues);

    // 5) edges：端口合法性、单入边、类型兼容
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

      // DAG 用的边（只要 node 存在就参与拓扑判断）
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

      // 单入边（同一个 to.nodeId + to.port 只能接一条 edge）
      const toKey = `${edge.to.nodeId}::${edge.to.port}`;
      const seen = incomingByToPort.get(toKey);
      if (seen !== undefined) {
        issues.push({
          code: 'GRAPH_EDGE_TO_PORT_MULTIPLE',
          severity: 'error',
          path: `/edges/${i}/to`,
          message: `input port already connected: ${edge.to.nodeId}.${edge.to.port}`,
        });
      } else {
        incomingByToPort.set(toKey, i);
      }

      // 类型兼容
      if (!isAssignableValueType(fromPort.valueType, toPort.valueType)) {
        issues.push({
          code: 'GRAPH_TYPE_MISMATCH',
          severity: 'error',
          path: `/edges/${i}`,
          message: `type mismatch: ${fromPort.valueType} -> ${toPort.valueType}`,
        });
      }
    }

    // 6) 每个节点的每个输入端口必须“恰好 1 条入边”
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      const indexed = nodeIndex.get(node.id);
      if (!indexed || !indexed.nodeDef) {
        continue;
      }
      for (const input of indexed.nodeDef.inputs) {
        const key = `${node.id}::${input.name}`;
        if (!incomingByToPort.has(key)) {
          issues.push({
            code: 'GRAPH_MISSING_INPUT_EDGE',
            severity: 'error',
            path: `/nodes/${i}`,
            message: `missing input edge: ${node.id}.${input.name}`,
          });
        }
      }
    }

    // 7) outputs：from 合法性 + 类型兼容 + rounding 约束
    for (let i = 0; i < graph.outputs.length; i++) {
      const output = graph.outputs[i];

      const fromNode = nodeIndex.get(output.from.nodeId);
      if (!fromNode) {
        issues.push({
          code: 'GRAPH_OUTPUT_FROM_INVALID',
          severity: 'error',
          path: `/outputs/${i}/from/nodeId`,
          message: `output.from.nodeId not found: ${output.from.nodeId}`,
        });
        continue;
      }

      // 节点存在但不在 catalog 的情况，已经在 nodes 校验阶段报错；此处不再重复报 output 错误。
      if (!fromNode.nodeDef) {
        continue;
      }

      const fromPort = findPort(fromNode.nodeDef.outputs, output.from.port);
      if (!fromPort) {
        issues.push({
          code: 'GRAPH_OUTPUT_FROM_INVALID',
          severity: 'error',
          path: `/outputs/${i}/from/port`,
          message: `output.from.port not found on node ${output.from.nodeId}: ${output.from.port}`,
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

    // 8) DAG 校验（无环）
    if (!isDag(indegree, adjacency)) {
      issues.push({
        code: 'GRAPH_CYCLE_DETECTED',
        severity: 'error',
        path: '/edges',
        message: 'cycle detected in graph',
      });
    }

    return issues;
  }

  private toSchemaIssue(err: ErrorObject): ValidationIssue {
    if (err.instancePath === '/schemaVersion') {
      return {
        code: 'GRAPH_SCHEMA_VERSION_UNSUPPORTED',
        severity: 'error',
        path: '/schemaVersion',
        message: 'schemaVersion is not supported (expected 1)',
      };
    }

    // 结构错误统一归类为 GRAPH_SCHEMA_INVALID，避免把 Ajv keyword 暴露给调用方。
    return {
      code: 'GRAPH_SCHEMA_INVALID',
      severity: 'error',
      path: err.instancePath || '/',
      message: err.message ?? 'graph schema invalid',
    };
  }

  private validateUniqueness(graph: GraphJsonV1, issues: ValidationIssue[]) {
    const variablePaths = new Set<string>();
    for (let i = 0; i < graph.variables.length; i++) {
      const v = graph.variables[i];
      if (variablePaths.has(v.path)) {
        issues.push({
          code: 'GRAPH_DUPLICATE_VARIABLE_PATH',
          severity: 'error',
          path: `/variables/${i}/path`,
          message: `duplicate variable path: ${v.path}`,
        });
      } else {
        variablePaths.add(v.path);
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

  private validateVariableDefaults(
    graph: GraphJsonV1,
    issues: ValidationIssue[],
  ) {
    for (let i = 0; i < graph.variables.length; i++) {
      const variable = graph.variables[i];

      // default 字段缺省表示“没有 default”；如果显式写了 default，就必须能通过 typed 校验。
      if (!Object.prototype.hasOwnProperty.call(variable, 'default')) {
        continue;
      }

      const defaultValue = (variable as { default?: unknown }).default;
      if (!isValidValueForType(variable.valueType, defaultValue)) {
        issues.push({
          code: 'GRAPH_SCHEMA_INVALID',
          severity: 'error',
          path: `/variables/${i}/default`,
          message: `default does not match valueType: ${variable.valueType}`,
        });
      }

      // Ratio 需要额外范围校验（0..1）
      if (variable.valueType === 'Ratio' && !isValidRatio(defaultValue)) {
        issues.push({
          code: 'GRAPH_TYPE_MISMATCH',
          severity: 'error',
          path: `/variables/${i}/default`,
          message: 'Ratio must be within [0, 1]',
        });
      }
    }
  }

  private buildNodeIndex(
    graph: GraphJsonV1,
    issues: ValidationIssue[],
  ): Map<string, IndexedNode> {
    const map = new Map<string, IndexedNode>();

    // 变量声明：供 core.var.* 校验 path 与类型。
    const variableByPath = new Map<string, { valueType: ValueType }>();
    for (const v of graph.variables) {
      variableByPath.set(v.path, { valueType: v.valueType });
    }

    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      if (map.has(node.id)) {
        // 重复 nodeId 已在 uniqueness 阶段报错；这里忽略后续重复项，避免索引被覆盖。
        continue;
      }

      const nodeDef = this.nodeCatalogService.getNode(
        node.nodeType,
        node.nodeVersion,
      );
      if (!nodeDef) {
        issues.push({
          code: 'GRAPH_NODE_NOT_IN_CATALOG',
          severity: 'error',
          path: `/nodes/${i}`,
          message: `node not in catalog: ${node.nodeType}@${node.nodeVersion}`,
        });
        map.set(node.id, { node, nodeIndex: i, paramsOk: false });
        continue;
      }

      const paramsResult = this.nodeCatalogService.validateNodeParams(
        node.nodeType,
        node.nodeVersion,
        node.params,
      );
      const paramsOk = paramsResult.ok;
      if (!paramsResult.ok) {
        for (const err of paramsResult.errors ?? []) {
          issues.push({
            code: 'GRAPH_NODE_PARAMS_INVALID',
            severity: 'error',
            path: joinPointer(`/nodes/${i}/params`, err.instancePath),
            message: err.message ?? 'node params invalid',
          });
        }
      }

      // core.var.*：要求 params.path 存在于 variables 且 valueType 匹配
      if (paramsOk && node.nodeType.startsWith('core.var.')) {
        const path = getString(node.params?.['path']);
        if (!path) {
          issues.push({
            code: 'GRAPH_NODE_PARAMS_INVALID',
            severity: 'error',
            path: `/nodes/${i}/params/path`,
            message: 'params.path is required for variable node',
          });
        } else {
          const declared = variableByPath.get(path);
          if (!declared) {
            issues.push({
              code: 'GRAPH_VARIABLE_PATH_NOT_DECLARED',
              severity: 'error',
              path: `/nodes/${i}/params/path`,
              message: `variable path not declared: ${path}`,
            });
          } else {
            const expected = findPort(nodeDef.outputs, 'value')?.valueType;
            if (expected && declared.valueType !== expected) {
              issues.push({
                code: 'GRAPH_VARIABLE_TYPE_MISMATCH',
                severity: 'error',
                path: `/nodes/${i}/params/path`,
                message: `variable type mismatch: ${declared.valueType} (declared) != ${expected} (node)`,
              });
            }
          }
        }
      }

      // core.const.*：value 做 typed 校验（尤其 Decimal/Ratio）
      if (paramsOk && node.nodeType.startsWith('core.const.')) {
        const outputType = findPort(nodeDef.outputs, 'value')?.valueType;
        const value = node.params?.['value'];
        if (outputType) {
          if (!isValidValueForType(outputType, value)) {
            issues.push({
              code: 'GRAPH_NODE_PARAMS_INVALID',
              severity: 'error',
              path: `/nodes/${i}/params/value`,
              message: `const value does not match valueType: ${outputType}`,
            });
          }
          if (outputType === 'Ratio' && !isValidRatio(value)) {
            issues.push({
              code: 'GRAPH_NODE_PARAMS_INVALID',
              severity: 'error',
              path: `/nodes/${i}/params/value`,
              message: 'Ratio must be within [0, 1]',
            });
          }
        }
      }

      map.set(node.id, { node, nodeIndex: i, nodeDef, paramsOk });
    }

    return map;
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
      return isValidDecimal(value);
    case 'String':
      return typeof value === 'string';
    case 'Boolean':
      return typeof value === 'boolean';
    case 'DateTime':
      return typeof value === 'string';
    case 'Json':
      return true;
    default: {
      // 穷尽保护：未来新增类型时，避免静默放过
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
      // 1.000... 允许；只要小数部分全是 0
      const fractional = value.slice(2);
      return fractional.length > 0 && /^[0]+$/.test(fractional);
    }
    return false;
  }
  return false;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
