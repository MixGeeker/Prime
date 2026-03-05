import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_ABS_V1: NodeImplementation = {
  def: {
    nodeType: 'math.abs',
    title: '绝对值',
    category: 'math',
    description: 'Decimal 绝对值：abs(value)',
    inputs: [{ name: 'value', valueType: 'Decimal' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const result = value.abs();
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
