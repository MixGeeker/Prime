/**
 * Node Catalog 的数据结构（与 `doc/API_DESIGN.md` 对齐）。
 *
 * 说明：
 * - Catalog 是引擎的“节点白名单”，Editor 也会依赖它来渲染节点与校验连线。
 * - `valueType` 目前只支持 `doc/VALUE_TYPES.md` 的 MVP 原子类型（纯 Decimal 系）。
 */

export type ValueType =
  | 'Decimal'
  | 'Ratio'
  | 'String'
  | 'Boolean'
  | 'DateTime'
  | 'Json';

export interface NodePortDef {
  /** port 名称（用于 edges.from/to.port） */
  name: string;
  /** port 值类型（用于静态校验） */
  valueType: ValueType;
}

export interface NodeDef {
  nodeType: string;
  title: string;
  category: string;
  description?: string;
  /** exec 输入端口（控制流） */
  execInputs?: Array<{ name: string }>;
  /** exec 输出端口（控制流） */
  execOutputs?: Array<{ name: string }>;
  inputs: NodePortDef[];
  outputs: NodePortDef[];
  /**
   * 节点参数 schema（JSON Schema draft-07）。
   *
   * 约定：
   * - 由 Ajv 统一校验
   * - 若缺省，则该节点不允许携带 params（或必须为空对象）
   */
  paramsSchema?: Record<string, unknown>;
}

export interface NodeCatalog {
  schemaVersion: 1;
  nodes: NodeDef[];
}
