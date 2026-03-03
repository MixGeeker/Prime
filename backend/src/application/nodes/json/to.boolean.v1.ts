import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';

export const JSON_TO_BOOLEAN_V1: NodeImplementation = {
  def: {
    nodeType: 'json.to.boolean',
    title: 'Json 转 Boolean',
    category: 'json',
    description: '把 Json 值按 Boolean 规则校验并规范化（必须是 boolean）。',
    inputs: [{ name: 'value', valueType: 'Json' }],
    outputs: [{ name: 'value', valueType: 'Boolean' }],
  },
  evaluate({ node, inputs }) {
    return {
      value: canonicalizeChosenValue('Boolean', inputs['value'], node.id),
    };
  },
};

