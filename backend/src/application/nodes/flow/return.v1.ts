import type { NodeImplementation } from '../node-implementation.types';

export const FLOW_RETURN_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.return',
    title: '返回',
    category: 'flow',
    description: '终止当前蓝图执行。',
    execInputs: [{ name: 'in' }],
    execOutputs: [],
    inputs: [],
    outputs: [],
  },
  evaluate() {
    return {};
  },
  execute() {
    return { kind: 'return' };
  },
};

