import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_SIGN_V1: NodeImplementation = {
  def: {
    nodeType: 'math.sign',
    title: '符号函数',
    category: 'math',
    description: '返回 Decimal -1、0 或 1',
    inputs: [{ name: 'value', valueType: 'Decimal' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const result = value.isZero()
      ? new DecimalCtor(0)
      : value.isPositive()
        ? new DecimalCtor(1)
        : new DecimalCtor(-1);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
