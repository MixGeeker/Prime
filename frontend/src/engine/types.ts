export type ValueType = 'Decimal' | 'Ratio' | 'String' | 'Boolean' | 'DateTime' | 'Json';

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

export interface NodePortDef {
  name: string;
  valueType: ValueType;
}

export interface NodeDef {
  nodeType: string;
  title: string;
  category: string;
  description?: string;
  execInputs?: Array<{ name: string }>;
  execOutputs?: Array<{ name: string }>;
  inputs: NodePortDef[];
  outputs: NodePortDef[];
  paramsSchema?: Record<string, unknown>;
}

export interface NodeCatalog {
  schemaVersion: 1;
  nodes: NodeDef[];
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  path?: string;
  message: string;
}

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

export type ContentType = 'graph_json';

export interface DefinitionDraft {
  definitionId: string;
  draftRevisionId: string;
  contentType: ContentType;
  content: GraphJsonV1;
  outputSchema: Record<string, unknown> | null;
  runnerConfig: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DefinitionSummary {
  definitionId: string;
  createdAt: string;
  updatedAt: string;
  latestDefinitionHash: string | null;
  latestStatus: 'published' | 'deprecated' | null;
  latestPublishedAt: string | null;
  draftRevisionId: string | null;
  draftContentType: ContentType | null;
  draftUpdatedAt: string | null;
}

export interface ListResponse<T> {
  items: T[];
  nextCursor: string | null;
}

