import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';

export const MATH_PERCENTAGE_OF_V1: NodeImplementation = {
  def: {
    nodeType: 'math.percentage_of',
    title: '百分比取值',
    category: 'math',
    description: '百分数语义：value * percent / 100（15 表示 15%）',
    inputs: [
      { name: 'value', valueType: 'Decimal' },
      { name: 'percent', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const percent = toDecimal(
      inputs['percent'],
      `${node.id}.percent`,
      DecimalCtor,
    );
    const result = value.mul(percent).div(100);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
