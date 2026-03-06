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

export interface RoundingDef {
  scale: number;
  mode: RoundingMode;
}

export interface NodePortDef {
  name: string;
  label?: string;
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

/**
 * UE Blueprint 风格：Pin 即契约（用于 flow.start / flow.end 的动态端口定义）。
 * - name: pin 名（也是参数/输出 key）
 * - valueType: 端口类型
 * - required/defaultValue: 输入 pin 的运行时约束（start 输出 pin）
 * - rounding: 输出 pin 的后处理（end 输入 pin）
 */
export interface PinDef {
  name: string;
  label?: string;
  valueType: ValueType;
  required?: boolean;
  defaultValue?: unknown;
  rounding?: RoundingDef;
}

export interface GraphJsonV2 {
  schemaVersion: 2;
  locals: GraphLocalDef[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  execEdges: GraphEdge[];
  metadata?: unknown;
  resolvers?: unknown;
}

export type ContentType = 'graph_json';

export interface DefinitionDraft {
  definitionId: string;
  draftRevisionId: string;
  contentType: ContentType;
  content: GraphJsonV2;
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

export interface InputsCatalogItem {
  name: string;
  label?: string;
  valueType: ValueType;
  description?: string;
  example?: unknown;
}

export interface InputsCatalogV2 {
  schemaVersion: 2;
  inputs: InputsCatalogItem[];
}

export interface IOTemplateItem {
  id: string;
  name: string;
  description?: string;
  inputs: InputsCatalogItem[];
  outputs: InputsCatalogItem[];
}

export interface IOTemplateCatalogV1 {
  schemaVersion: 1;
  templates: IOTemplateItem[];
}
