import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_EXP_V1: NodeImplementation = {
  def: {
    nodeType: 'math.exp',
    title: '自然指数',
    category: 'math',
    description: '指数计算：e ^ value',
    inputs: [{ name: 'value', valueType: 'Decimal' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    try {
      const result = value.exp();
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    } catch {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid exponential operation at ${node.id}`,
      );
    }
  },
};
