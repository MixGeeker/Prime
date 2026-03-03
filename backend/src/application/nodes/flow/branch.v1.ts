import type { NodeImplementation } from '../node-implementation.types';
import { toBoolean } from '../shared/value-parsers';

export const FLOW_BRANCH_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.branch',
    title: '分支',
    category: 'flow',
    description: '控制流分支：cond=true 走 true，否则走 false。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'true' }, { name: 'false' }],
    inputs: [{ name: 'cond', valueType: 'Boolean' }],
    outputs: [],
  },
  evaluate() {
    return {};
  },
  execute({ node, inputs }) {
    const cond = toBoolean(inputs['cond'], `${node.id}.cond`);
    return { kind: 'continue', port: cond ? 'true' : 'false' };
  },
};
