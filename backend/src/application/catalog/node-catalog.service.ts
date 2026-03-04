import { Injectable } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { NODE_CATALOG_V1 } from './node-catalog.v1';
import type { NodeCatalog, NodeDef, NodePortDef } from './node-catalog.types';
import type { GraphNode } from '../validation/graph-json.types';

export type NodeKey = string;

export interface ParamsValidationResult {
  ok: boolean;
  /**
   * Ajv errors（当 ok=false 时才会有）。
   * - instancePath 是 JSON Pointer（以 `/` 开头）
   * - message 是人类可读的错误说明
   */
  errors?: ErrorObject[];
}

/**
 * Node Catalog 服务：
 * - 提供节点白名单数据
 * - 预编译 paramsSchema（Ajv），供 graph validate 复用
 */
@Injectable()
export class NodeCatalogService {
  private readonly catalog: NodeCatalog = NODE_CATALOG_V1;
  private readonly nodesByKey = new Map<NodeKey, NodeDef>();
  private readonly paramsValidatorsByKey = new Map<NodeKey, ValidateFunction>();
  private readonly ajv: Ajv;

  constructor() {
    // M2 统一使用 Ajv 校验 paramsSchema（draft-07）。
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    addFormats(this.ajv);

    for (const node of this.catalog.nodes) {
      const key = this.getNodeKey(node.nodeType);
      if (this.nodesByKey.has(key)) {
        throw new Error(`Duplicate node in catalog: ${key}`);
      }
      this.nodesByKey.set(key, node);

      if (node.paramsSchema) {
        const validate = this.ajv.compile(node.paramsSchema);
        this.paramsValidatorsByKey.set(key, validate);
      }
    }
  }

  getCatalog(): NodeCatalog {
    return this.catalog;
  }

  getNode(nodeType: string): NodeDef | undefined {
    return this.nodesByKey.get(this.getNodeKey(nodeType));
  }

  /**
   * 解析“动态 pin”后的节点定义（UE Blueprint 风格）。
   *
   * 说明：
   * - Catalog 里仍然是 nodeType 的“基准定义”（静态 ports）
   * - 对于 `flow.start` / `flow.end`，其 value ports 来自 node.params.dynamicOutputs / dynamicInputs
   * - 返回的 NodeDef 可能是一个新对象（避免污染 Catalog 内的基准定义）
   */
  getNodeDefForGraphNode(node: GraphNode): NodeDef | undefined {
    const base = this.getNode(node.nodeType);
    if (!base) return undefined;

    if (node.nodeType === 'flow.start') {
      const dynamic = readDynamicPorts(node.params?.['dynamicOutputs']);
      if (dynamic.length === 0) return base;
      return {
        ...base,
        outputs: [...base.outputs, ...dynamic],
      };
    }

    if (node.nodeType === 'flow.end') {
      const dynamic = readDynamicPorts(node.params?.['dynamicInputs']);
      if (dynamic.length === 0) return base;
      return {
        ...base,
        inputs: [...base.inputs, ...dynamic],
      };
    }

    return base;
  }

  validateNodeParams(
    nodeType: string,
    params: unknown,
  ): ParamsValidationResult {
    const node = this.getNode(nodeType);
    if (!node) {
      return {
        ok: false,
        errors: [
          {
            keyword: 'catalog',
            instancePath: '',
            schemaPath: '',
            params: {},
            message: 'node not found in catalog',
          },
        ],
      };
    }

    // 没有 paramsSchema 的节点，params 只能缺省或为空对象。
    if (!node.paramsSchema) {
      if (params === undefined) {
        return { ok: true };
      }
      if (isPlainObject(params) && Object.keys(params).length === 0) {
        return { ok: true };
      }
      return {
        ok: false,
        errors: [
          {
            keyword: 'params',
            instancePath: '',
            schemaPath: '',
            params: {},
            message: 'params is not allowed for this node',
          },
        ],
      };
    }

    const key = this.getNodeKey(nodeType);
    const validate = this.paramsValidatorsByKey.get(key);
    if (!validate) {
      // 理论上不会发生：有 paramsSchema 就必定会编译出 validate。
      return {
        ok: false,
        errors: [
          {
            keyword: 'internal',
            instancePath: '',
            schemaPath: '',
            params: {},
            message: 'params schema is not compiled',
          },
        ],
      };
    }

    const ok = validate(params ?? {});
    if (ok) {
      return { ok: true };
    }
    return { ok: false, errors: validate.errors ?? [] };
  }

  getNodeKey(nodeType: string): NodeKey {
    return nodeType;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function readDynamicPorts(value: unknown): NodePortDef[] {
  if (!Array.isArray(value)) return [];

  const ports: NodePortDef[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = item['name'];
    const valueType = item['valueType'];
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof valueType !== 'string' || !valueType.trim()) continue;
    ports.push({ name: name.trim(), valueType: valueType as any });
  }
  return ports;
}
