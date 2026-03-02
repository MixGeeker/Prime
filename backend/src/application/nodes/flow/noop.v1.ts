import type { NodeImplementation } from '../node-implementation.types';

export const FLOW_NOOP_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.noop',
    title: '空操作',
    category: 'flow',
    description: '无副作用，直接继续执行 out。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'out' }],
    inputs: [],
    outputs: [],
  },
  evaluate() {
    return {};
  },
  execute() {
    return { kind: 'continue', port: 'out' };
  },
};

