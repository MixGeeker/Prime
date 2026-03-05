import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_LOG_V1: NodeImplementation = {
  def: {
    nodeType: 'math.log',
    title: '对数',
    category: 'math',
    description: '对数计算：log(value, base)',
    inputs: [
      { name: 'value', valueType: 'Decimal' },
      { name: 'base', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const base = toDecimal(inputs['base'], `${node.id}.base`, DecimalCtor);
    if (value.lessThanOrEqualTo(0)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `log value must be > 0 at ${node.id}`,
      );
    }
    if (base.lessThanOrEqualTo(0)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `log base must be > 0 at ${node.id}`,
      );
    }
    if (base.equals(1)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `log base must not be 1 at ${node.id}`,
      );
    }
    try {
      const result = value.log(base);
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    } catch {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid log operation at ${node.id}`,
      );
    }
  },
};
