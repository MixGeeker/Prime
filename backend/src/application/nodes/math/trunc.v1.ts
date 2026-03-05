import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';
import { getNonNegativeInt } from '../shared/value-parsers';

export const MATH_TRUNC_V1: NodeImplementation = {
  def: {
    nodeType: 'math.trunc',
    title: '截断',
    category: 'math',
    description: 'Decimal 截断：trunc(value, scale)（朝 0 方向）',
    inputs: [{ name: 'value', valueType: 'Decimal' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['scale'],
      properties: {
        scale: { type: 'integer', minimum: 0 },
      },
    },
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const scale = getNonNegativeInt(node.params?.['scale']);
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const result = value.toDecimalPlaces(scale, DecimalCtor.ROUND_DOWN);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
