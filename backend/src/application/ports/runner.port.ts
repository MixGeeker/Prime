/**
 * Runner 端口（application -> runner-core）。
 *
 * 约束：
 * - Runner 必须确定性（纯函数、无 IO）
 * - 子蓝图调用依赖通过 `definitionBundle` 注入，Runner 运行期不得访问 DB
 */
export const RUNNER_PORT = Symbol('RunnerPort');

export interface RunnerDefinitionBundleItem {
  definitionId: string;
  definitionHash: string;
  content: Record<string, unknown>;
  runnerConfig?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface RunnerRunParams {
  content: Record<string, unknown>;
  entrypointKey?: string;
  inputs: Record<string, unknown>;
  runnerConfig?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
  definitionBundle?: RunnerDefinitionBundleItem[];
}

export interface RunnerRunResult {
  outputs: Record<string, unknown>;
}

export interface RunnerPort {
  run(params: RunnerRunParams): RunnerRunResult;
}
