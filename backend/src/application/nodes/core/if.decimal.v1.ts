import type { NodeImplementation } from '../node-implementation.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';
import { toBoolean } from '../shared/value-parsers';

export const CORE_IF_DECIMAL_V1: NodeImplementation = {
  def: {
    nodeType: 'core.if.decimal',
    nodeVersion: 1,
    title: '条件（Decimal）',
    category: 'core',
    description: 'cond ? then : else',
    inputs: [
      { name: 'cond', valueType: 'Boolean' },
      { name: 'then', valueType: 'Decimal' },
      { name: 'else', valueType: 'Decimal' },
    ],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
  },
  evaluate({ node, inputs }) {
    const cond = toBoolean(inputs['cond'], `${node.id}.cond`);
    const chosen = cond ? inputs['then'] : inputs['else'];
    return {
      value: canonicalizeChosenValue('Decimal', chosen, node.id),
    };
  },
};
