import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';

export const JSON_TO_RATIO_V1: NodeImplementation = {
  def: {
    nodeType: 'json.to.ratio',
    title: 'Json 转 Ratio',
    category: 'json',
    description: '把 Json 值按 Ratio 规则校验并规范化（0..1 的 Decimal）。',
    inputs: [{ name: 'value', valueType: 'Json' }],
    outputs: [{ name: 'value', valueType: 'Ratio' }],
  },
  evaluate({ node, inputs }) {
    return {
      value: canonicalizeChosenValue('Ratio', inputs['value'], node.id),
    };
  },
};
