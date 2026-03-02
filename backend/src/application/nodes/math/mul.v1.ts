import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_MUL_V1: NodeImplementation = {
  def: {
    nodeType: 'math.mul',
    nodeVersion: 1,
    title: '乘法',
    category: 'math',
    description: 'Decimal 乘法：a * b',
    inputs: [
      { name: 'a', valueType: 'Decimal' },
      { name: 'b', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const result = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor).mul(
      toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor),
    );
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
