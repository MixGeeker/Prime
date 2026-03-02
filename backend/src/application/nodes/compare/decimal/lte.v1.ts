import type { NodeImplementation } from '../../node-implementation.types';
import { toDecimal } from '../../shared/decimal-runtime';

export const COMPARE_DECIMAL_LTE_V1: NodeImplementation = {
  def: {
    nodeType: 'compare.decimal.lte',
    nodeVersion: 1,
    title: '小于等于（Decimal）',
    category: 'compare',
    inputs: [
      { name: 'a', valueType: 'Decimal' },
      { name: 'b', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Boolean' }],
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const a = toDecimal(inputs['a'], `${node.id}.a`, DecimalCtor);
    const b = toDecimal(inputs['b'], `${node.id}.b`, DecimalCtor);
    return { value: a.lessThanOrEqualTo(b) };
  },
};
