import type { NodeDef } from '../catalog/node-catalog.types';
import type { GraphNode } from '../validation/graph-json.types';

export interface NodeEvaluationContext {
  node: GraphNode;
  def: NodeDef;
  inputs: Record<string, unknown>;
  variableValues: Record<string, unknown>;
  DecimalCtor: typeof import('decimal.js').default;
}

export interface NodeImplementation {
  def: NodeDef;
  evaluate(ctx: NodeEvaluationContext): Record<string, unknown>;
}
