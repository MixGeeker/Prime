import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_MOD_V1: NodeImplementation = {
  def: {
    nodeType: 'math.mod',
    title: '取模',
    category: 'math',
    description: 'Decimal 取余：a mod b',
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
        `modulo by zero at ${node.id}`,
      );
    }
    const result = left.mod(right);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
