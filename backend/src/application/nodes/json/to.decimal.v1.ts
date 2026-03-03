import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';

export const JSON_TO_DECIMAL_V1: NodeImplementation = {
  def: {
    nodeType: 'json.to.decimal',
    title: 'Json 转 Decimal',
    category: 'json',
    description: '把 Json 值按 Decimal 规则校验并规范化（string/number/bigint）。',
    inputs: [{ name: 'value', valueType: 'Json' }],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs }) {
    return {
      value: canonicalizeChosenValue('Decimal', inputs['value'], node.id),
    };
  },
};

