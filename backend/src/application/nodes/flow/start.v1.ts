import type { NodeImplementation } from '../node-implementation.types';

export const FLOW_START_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.start',
    title: '开始',
    category: 'flow',
    description: '入口节点（由 entrypoint 触发）。执行后继续 out。',
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
