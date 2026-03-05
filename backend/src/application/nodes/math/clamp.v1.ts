import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_CLAMP_V1: NodeImplementation = {
  def: {
    nodeType: 'math.clamp',
    title: '范围限制',
    category: 'math',
    description: 'Decimal 限幅：clamp(value, min, max)',
    inputs: [
      { name: 'value', valueType: 'Decimal' },
      { name: 'min', valueType: 'Decimal' },
      { name: 'max', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const min = toDecimal(inputs['min'], `${node.id}.min`, DecimalCtor);
    const max = toDecimal(inputs['max'], `${node.id}.max`, DecimalCtor);
    if (min.greaterThan(max)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid clamp range at ${node.id}: min > max`,
      );
    }
    const clamped = value.lessThan(min)
      ? min
      : value.greaterThan(max)
        ? max
        : value;
    return {
      value: canonicalizeDecimalOutput('Decimal', clamped, node.id),
    };
  },
};
