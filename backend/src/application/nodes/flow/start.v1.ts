import type { NodeImplementation } from '../node-implementation.types';

export const FLOW_START_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.start',
    title: '开始（入口）',
    category: 'flow',
    description:
      '入口事件节点（UE 风格）：没有 exec 输入端口；由 entrypoints.from 指向其 exec 输出端口启动执行。',
    execInputs: [],
    execOutputs: [{ name: 'out' }],
    inputs: [],
    outputs: [],
  },
  evaluate() {
    return {};
  },
};
