import type { NodeImplementation } from '../node-implementation.types';
import { toBoolean } from '../shared/value-parsers';

export const LOGIC_NOT_V1: NodeImplementation = {
  def: {
    nodeType: 'logic.not',
    title: '非',
    category: 'logic',
    description: 'Boolean NOT：!value',
    inputs: [{ name: 'value', valueType: 'Boolean' }],
    outputs: [{ name: 'value', valueType: 'Boolean' }],
  },
  evaluate({ node, inputs }) {
    const value = toBoolean(inputs['value'], `${node.id}.value`);
    return { value: !value };
  },
};
