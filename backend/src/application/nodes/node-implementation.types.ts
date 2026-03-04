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
  /**
   * Graph v2：单一 inputs 容器（Pin 即契约）。
   * - 对应 job payload 的 inputs（仅保留 start pins 声明过的字段，且已 canonicalize）
   */
  inputs: Record<string, unknown>;

  /**
   * 兼容字段：旧节点族仍可能读取 globals/params。
   * Graph v2 下两者会指向同一个 inputs 容器。
   */
  globals: Record<string, unknown>;
  params: Record<string, unknown>;
  getLocal(name: string): unknown;
  setLocal(name: string, value: unknown): void;
  setOutput(params: { key: string; value: unknown; nodeId: string }): void;
  callDefinition(params: {
    definitionId: string;
    definitionHash: string;
    entrypointKey?: string;
    inputs: Record<string, unknown>;
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
