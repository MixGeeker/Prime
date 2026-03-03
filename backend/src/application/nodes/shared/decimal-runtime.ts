import Decimal from 'decimal.js';
import type { RoundingMode } from '../../validation/graph-json.types';
import { RunnerExecutionError } from '../../runner/runner.error';

export function toDecimal(
  value: unknown,
  label: string,
  DecimalCtor: typeof Decimal,
): Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `decimal input must be string/number: ${label}`,
    );
  }

  try {
    const converted = new DecimalCtor(value);
    if (!converted.isFinite()) {
      throw new Error('non-finite');
    }
    return converted;
  } catch {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `invalid decimal input: ${label}`,
    );
  }
}

export function getRoundingMode(value: unknown): RoundingMode {
  if (typeof value !== 'string') {
    throw new RunnerExecutionError(
      'RUNNER_DETERMINISTIC_ERROR',
      `rounding mode must be a string, got: ${String(value)}`,
    );
  }
  switch (value) {
    case 'UP':
    case 'DOWN':
    case 'CEIL':
    case 'FLOOR':
    case 'HALF_UP':
    case 'HALF_DOWN':
    case 'HALF_EVEN':
    case 'HALF_CEIL':
    case 'HALF_FLOOR':
      return value;
    default:
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported rounding mode: ${value}`,
      );
  }
}

export function toDecimalRounding(mode: RoundingMode): Decimal.Rounding {
  switch (mode) {
    case 'UP':
      return Decimal.ROUND_UP;
    case 'DOWN':
      return Decimal.ROUND_DOWN;
    case 'CEIL':
      return Decimal.ROUND_CEIL;
    case 'FLOOR':
      return Decimal.ROUND_FLOOR;
    case 'HALF_UP':
      return Decimal.ROUND_HALF_UP;
    case 'HALF_DOWN':
      return Decimal.ROUND_HALF_DOWN;
    case 'HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN;
    case 'HALF_CEIL':
      return Decimal.ROUND_HALF_CEIL;
    case 'HALF_FLOOR':
      return Decimal.ROUND_HALF_FLOOR;
    default: {
      const _exhaustive: never = mode;
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `unsupported rounding mode: ${String(_exhaustive)}`,
      );
    }
  }
}
