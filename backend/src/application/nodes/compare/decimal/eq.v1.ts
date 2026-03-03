import type { NodeImplementation } from '../../node-implementation.types';
import { toDecimal } from '../../shared/decimal-runtime';

export const COMPARE_DECIMAL_EQ_V1: NodeImplementation = {
  def: {
    nodeType: 'compare.decimal.eq',
    title: '等于（Decimal）',
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
    return { value: a.equals(b) };
  },
};
