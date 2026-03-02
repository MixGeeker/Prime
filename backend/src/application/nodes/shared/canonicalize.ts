import type Decimal from 'decimal.js';
import type { ValueType } from '../../catalog/node-catalog.types';
import { canonicalizeValueByType } from '../../hashing/canonicalize';
import { RunnerExecutionError } from '../../runner/runner.error';

export function canonicalizeDecimalOutput(
  valueType: ValueType,
  value: Decimal,
  nodeId: string,
): string {
  if (!value.isFinite()) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `non-finite decimal result at ${nodeId}`,
    );
  }
  const canonicalized = canonicalizeValueByType(valueType, value.toString());
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal canonicalization failed at ${nodeId}: ${canonicalized.message}`,
    );
  }
  return canonicalized.value as string;
}

export function canonicalizeChosenValue(
  valueType: ValueType,
  value: unknown,
  nodeId: string,
): unknown {
  const canonicalized = canonicalizeValueByType(valueType, value);
  if (!canonicalized.ok) {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `invalid ${valueType} at ${nodeId}: ${canonicalized.message}`,
    );
  }
  return canonicalized.value;
}
