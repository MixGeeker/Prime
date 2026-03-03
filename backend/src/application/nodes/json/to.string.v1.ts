import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';

export const JSON_TO_STRING_V1: NodeImplementation = {
  def: {
    nodeType: 'json.to.string',
    title: 'Json 转 String',
    category: 'json',
    description: '把 Json 值按 String 规则校验并规范化（必须是 string）。',
    inputs: [{ name: 'value', valueType: 'Json' }],
    outputs: [{ name: 'value', valueType: 'String' }],
  },
  evaluate({ node, inputs }) {
    return {
      value: canonicalizeChosenValue('String', inputs['value'], node.id),
    };
  },
};
