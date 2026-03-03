import type { NodeImplementation } from '../../node-implementation.types';

export const INPUTS_GLOBALS_ROOT_V1: NodeImplementation = {
  def: {
    nodeType: 'inputs.globals.root',
    title: '读取全局输入（Root）',
    category: 'inputs',
    description: '输出整个 inputs.globals 对象（Json），用于 Json 解析链。',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Json' }],
  },
  evaluate({ runtime }) {
    return { value: runtime.globals };
  },
};
