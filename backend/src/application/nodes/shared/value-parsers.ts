import { RunnerExecutionError } from '../../runner/runner.error';

export function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function getNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new RunnerExecutionError(
    'RUNNER_DETERMINISTIC_ERROR',
    `expected a non-negative integer, got: ${String(value)}`,
  );
}

export function toBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new RunnerExecutionError(
    'RUNNER_DETERMINISTIC_ERROR',
    `boolean input must be boolean: ${label}`,
  );
}
