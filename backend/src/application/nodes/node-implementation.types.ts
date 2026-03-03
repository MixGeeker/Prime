/**
 * NodeImplementation 类型体系（节点实现契约）。
 *
 * 说明：
 * - `evaluate()`：纯 value 计算（用于 value edges）；必须确定性
 * - `execute()`：控制流执行（用于 execEdges）；可返回 continue/return/continue_many
 * - `runtime`：runner 注入的运行时上下文（globals/params/locals + callDefinition）
 */
import type { NodeDef } from '../catalog/node-catalog.types';
import type { GraphNode } from '../validation/graph-json.types';

export interface RunnerRuntimeContext {
  globals: Record<string, unknown>;
  params: Record<string, unknown>;
  getLocal(name: string): unknown;
  setLocal(name: string, value: unknown): void;
  setOutput(params: { key: string; value: unknown; nodeId: string }): void;
  callDefinition(params: {
    definitionId: string;
    definitionHash: string;
    entrypointKey?: string;
    inputs: {
      globals: Record<string, unknown>;
      params: Record<string, unknown>;
    };
  }): {
    outputs: Record<string, unknown>;
  };
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
  | { kind: 'continue_many'; ports: string[] }
  | { kind: 'return' };

export interface NodeImplementation {
  def: NodeDef;
  evaluate(ctx: NodeEvaluationContext): Record<string, unknown>;
  execute?(ctx: NodeExecutionContext): NodeExecutionResult;
}
