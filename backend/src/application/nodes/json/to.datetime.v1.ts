import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';

export const JSON_TO_DATETIME_V1: NodeImplementation = {
  def: {
    nodeType: 'json.to.datetime',
    title: 'Json 转 DateTime',
    category: 'json',
    description:
      '把 Json 值按 DateTime 规则校验并规范化（ISO8601 字符串，会 canonicalize 为 toISOString()）。',
    inputs: [{ name: 'value', valueType: 'Json' }],
    outputs: [{ name: 'value', valueType: 'DateTime' }],
  },
  evaluate({ node, inputs }) {
    return {
      value: canonicalizeChosenValue('DateTime', inputs['value'], node.id),
    };
  },
};
