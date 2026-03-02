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
  inputs: {
    globals: Record<string, unknown>;
    params: Record<string, unknown>;
  };
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
