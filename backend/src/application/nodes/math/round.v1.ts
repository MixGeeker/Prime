import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeDecimalOutput } from '../shared/canonicalize';
import {
  getRoundingMode,
  toDecimal,
  toDecimalRounding,
} from '../shared/decimal-runtime';
import { getNonNegativeInt } from '../shared/value-parsers';

export const MATH_ROUND_V1: NodeImplementation = {
  def: {
    nodeType: 'math.round',
    title: '取整/舍入',
    category: 'math',
    description: 'Decimal 舍入：round(value, scale, mode)',
    inputs: [{ name: 'value', valueType: 'Decimal' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['scale', 'mode'],
      properties: {
        scale: { type: 'integer', minimum: 0 },
        mode: {
          type: 'string',
          enum: [
            'UP',
            'DOWN',
            'CEIL',
            'FLOOR',
            'HALF_UP',
            'HALF_DOWN',
            'HALF_EVEN',
            'HALF_CEIL',
            'HALF_FLOOR',
          ],
        },
      },
    },
  },
  evaluate({ node, inputs, DecimalCtor }) {
    const scale = getNonNegativeInt(node.params?.['scale']);
    const mode = getRoundingMode(node.params?.['mode']);
    const value = toDecimal(inputs['value'], `${node.id}.value`, DecimalCtor);
    const rounded = value.toDecimalPlaces(scale, toDecimalRounding(mode));
    return {
      value: canonicalizeDecimalOutput('Decimal', rounded, node.id),
    };
  },
};
