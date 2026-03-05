import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import { toDecimal } from '../shared/decimal-runtime';
import { getNonNegativeInt } from '../shared/value-parsers';

export const MATH_FLOOR_V1: NodeImplementation = {
  def: {
    nodeType: 'math.floor',
    title: '向下取整',
    category: 'math',
    description: 'Decimal 向下取整：floor(value, scale)',
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
    const result = value.toDecimalPlaces(scale, DecimalCtor.ROUND_FLOOR);
    return {
      value: canonicalizeDecimalOutput('Decimal', result, node.id),
    };
  },
};
