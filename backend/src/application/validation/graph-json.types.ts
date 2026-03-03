import type { ValueType } from '../catalog/node-catalog.types';

export type RoundingMode =
  | 'UP'
  | 'DOWN'
  | 'CEIL'
  | 'FLOOR'
  | 'HALF_UP'
  | 'HALF_DOWN'
  | 'HALF_EVEN'
  | 'HALF_CEIL'
  | 'HALF_FLOOR';

export interface GraphInputDef {
  name: string;
  valueType: ValueType;
  required?: boolean;
  description?: string;
  default?: unknown;
  constraints?: Record<string, unknown>;
}

export interface GraphLocalDef {
  name: string;
  valueType: ValueType;
  default?: unknown;
  description?: string;
}

export interface GraphNode {
  id: string;
  nodeType: string;
  params?: Record<string, unknown>;
}

export interface GraphEndpoint {
  nodeId: string;
  port: string;
}

export interface GraphEdge {
  from: GraphEndpoint;
  to: GraphEndpoint;
}

export interface GraphEntrypoint {
  key: string;
  params: GraphInputDef[];
  /**
   * 推荐：entrypoint 从哪个 exec 输出端口开始触发（UE 风格 Event 节点）。
   * Runner 会从该端口的 execEdges 继续执行。
   */
  from?: GraphEndpoint; // exec output

  /**
   * 兼容：旧版 entrypoint 直接指向 exec 输入端口开始执行。
   * 已弃用：请迁移到 from。
   */
  to?: GraphEndpoint; // legacy exec input
}

export interface GraphOutput {
  key: string;
  valueType: ValueType;
  rounding?: {
    scale: number;
    mode: RoundingMode;
  };
}

/**
 * BlueprintGraph（控制流蓝图）：
 * - value edges 必须是 DAG（无环）
 * - execEdges 允许环（loop），由 runner limits 限制步数/耗时
 */
export interface GraphJsonV1 {
  globals: GraphInputDef[];
  entrypoints: GraphEntrypoint[];
  locals: GraphLocalDef[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  execEdges: GraphEdge[];
  outputs: GraphOutput[];
  metadata?: unknown;
  resolvers?: unknown;
}
