export const RUNNER_PORT = Symbol('RunnerPort');

export interface RunnerRunParams {
  content: Record<string, unknown>;
  variableValues: Record<string, unknown>;
  runnerConfig?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
}

export interface RunnerRunResult {
  outputs: Record<string, unknown>;
}

export interface RunnerPort {
  run(params: RunnerRunParams): RunnerRunResult;
}
