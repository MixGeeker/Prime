import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_SQRT_V1: NodeImplementation = {
  def: {
    nodeType: 'math.sqrt',
    title: '平方根',
    category: 'math',
    description: 'Decimal 开方：sqrt(value)',
    inputs: [{ name: 'value', valueType: 'Decimal' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    if (value.isNegative()) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `square root of negative value at ${node.id}`,
      );
    }
    const result = value.sqrt();
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
