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

export interface GraphVariable {
  path: string;
  valueType: ValueType;
  required?: boolean;
  description?: string;
  default?: unknown;
  constraints?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  nodeType: string;
  nodeVersion: number;
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

export interface GraphOutput {
  key: string;
  valueType: ValueType;
  from: GraphEndpoint;
  rounding?: {
    scale: number;
    mode: RoundingMode;
  };
}

export interface GraphJsonV1 {
  schemaVersion: 1;
  variables: GraphVariable[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  outputs: GraphOutput[];
  metadata?: unknown;
  resolvers?: unknown;
}
