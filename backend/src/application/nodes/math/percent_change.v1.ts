import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_PERCENT_CHANGE_V1: NodeImplementation = {
  def: {
    nodeType: 'math.percent_change',
    title: '百分比变化',
    category: 'math',
    description: '百分数语义：(new - old) / old * 100',
    inputs: [
      { name: 'old', valueType: 'Decimal' },
      { name: 'new', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const oldValue = toDecimal(inputs['old'], `${node.id}.old`, DecimalCtor);
    const newValue = toDecimal(inputs['new'], `${node.id}.new`, DecimalCtor);
    if (oldValue.isZero()) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `percent change divisor is zero at ${node.id}`,
      );
    }
    const result = newValue.minus(oldValue).div(oldValue).mul(100);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
