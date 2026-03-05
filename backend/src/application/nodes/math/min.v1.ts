import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_MIN_V1: NodeImplementation = {
  def: {
    nodeType: 'math.min',
    title: '最小值',
    category: 'math',
    description: 'Decimal 取小值：min(a, b)',
    inputs: [
      { name: 'a', valueType: 'Decimal' },
      { name: 'b', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
    const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
    const result = a.lessThan(b) ? a : b;
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
