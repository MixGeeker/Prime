import type { NodeImplementation } from '../../node-implementation.types';

export const INPUTS_PARAMS_ROOT_V1: NodeImplementation = {
  def: {
    nodeType: 'inputs.params.root',
    title: '读取入口参数（Root）',
    category: 'inputs',
    description: '输出整个 inputs.params 对象（Json），用于 Json 解析链。',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Json' }],
  },
  evaluate({ runtime }) {
    return { value: runtime.params };
  },
};
