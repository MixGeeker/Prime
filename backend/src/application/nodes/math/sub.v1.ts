import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_SUB_V1: NodeImplementation = {
  def: {
    nodeType: 'math.sub',
    nodeVersion: 1,
    title: '减法',
    category: 'math',
    description: 'Decimal 减法：a - b',
    inputs: [
      { name: 'a', valueType: 'Decimal' },
      { name: 'b', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const result = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor).minus(
      toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor),
    );
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
