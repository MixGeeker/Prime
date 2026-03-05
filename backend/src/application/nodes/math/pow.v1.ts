import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_POW_V1: NodeImplementation = {
  def: {
    nodeType: 'math.pow',
    title: '幂运算',
    category: 'math',
    description: 'Decimal 幂运算：pow(base, exp)',
    inputs: [
      { name: 'base', valueType: 'Decimal' },
      { name: 'exp', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const base = toDecimal(inputs['base'], `${node.id}.base`, DecimalCtor);
    const exp = toDecimal(inputs['exp'], `${node.id}.exp`, DecimalCtor);
    try {
      const result = base.pow(exp);
      return {
        value: canonicalizeDecimalOutput('Decimal', result, node.id),
      };
    } catch {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid power operation at ${node.id}`,
      );
    }
  },
};
