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
  to: GraphEndpoint; // exec input
}

export interface GraphOutput {
  key: string;
  valueType: ValueType;
  from: GraphEndpoint;
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

