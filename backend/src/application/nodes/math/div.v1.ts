import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_DIV_V1: NodeImplementation = {
  def: {
    nodeType: 'math.div',
    nodeVersion: 1,
    title: '除法',
    category: 'math',
    description: 'Decimal 除法：a / b（除零语义在 runner 里定义）',
    inputs: [
      { name: 'a', valueType: 'Decimal' },
      { name: 'b', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const left = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
    const right = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
    if (right.isZero()) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `division by zero at ${node.id}`,
      );
    }
    const result = left.div(right);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
