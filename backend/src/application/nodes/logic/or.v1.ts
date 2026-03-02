import type { NodeImplementation } from '../node-implementation.types';
import { toBoolean } from '../shared/value-parsers';

export const LOGIC_OR_V1: NodeImplementation = {
  def: {
    nodeType: 'logic.or',
    nodeVersion: 1,
    title: '或',
    category: 'logic',
    description: 'Boolean OR：a || b',
    inputs: [
      { name: 'a', valueType: 'Boolean' },
      { name: 'b', valueType: 'Boolean' },
    ],
    outputs: [{ name: 'value', valueType: 'Boolean' }],
  },
  evaluate({ node, inputs }) {
    const a = toBoolean(inputs['a'], `${node.id}.a`);
    const b = toBoolean(inputs['b'], `${node.id}.b`);
    return { value: a || b };
  },
};
