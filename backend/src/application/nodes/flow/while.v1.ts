import type { NodeImplementation } from '../node-implementation.types';
import { toBoolean } from '../shared/value-parsers';

export const FLOW_WHILE_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.while',
    title: 'While',
    category: 'flow',
    description:
      'While(cond)：cond=true 进入 body，cond=false 走 completed；通过 execEdges 回连实现循环。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'body' }, { name: 'completed' }],
    inputs: [{ name: 'cond', valueType: 'Boolean' }],
    outputs: [],
  },
  evaluate() {
    return {};
  },
  execute({ node, inputs }) {
    const cond = toBoolean(inputs['cond'], `${node.id}.cond`);
    return { kind: 'continue', port: cond ? 'body' : 'completed' };
  },
};
