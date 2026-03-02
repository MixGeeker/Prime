import type { NodeDef } from '../catalog/node-catalog.types';
import type { GraphNode } from '../validation/graph-json.types';

export interface RunnerRuntimeContext {
  globals: Record<string, unknown>;
  params: Record<string, unknown>;
  getLocal(name: string): unknown;
  setLocal(name: string, value: unknown): void;
}

export interface NodeEvaluationContext {
  node: GraphNode;
  def: NodeDef;
  inputs: Record<string, unknown>;
  runtime: RunnerRuntimeContext;
  DecimalCtor: typeof import('decimal.js').default;
}

export interface NodeExecutionContext extends NodeEvaluationContext {
  execInPort: string;
}

export type NodeExecutionResult =
  | { kind: 'continue'; port: string }
  | { kind: 'return' };

export interface NodeImplementation {
  def: NodeDef;
  evaluate(ctx: NodeEvaluationContext): Record<string, unknown>;
  execute?(ctx: NodeExecutionContext): NodeExecutionResult;
}
