import type { NodeImplementation } from '../node-implementation.types';

export const FLOW_START_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.start',
    title: '开始（入口）',
    category: 'flow',
    description:
      '入口事件节点（UE 风格）：没有 exec 输入端口；同时承载输入契约（dynamicOutputs 作为 value 输出 pins）。',
    execInputs: [],
    execOutputs: [{ name: 'out' }],
    inputs: [],
    outputs: [],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        dynamicOutputs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'valueType'],
            properties: {
              name: { type: 'string', minLength: 1 },
              label: { type: 'string' },
              valueType: {
                type: 'string',
                enum: ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'],
              },
              required: { type: 'boolean' },
              defaultValue: {},
            },
          },
        },
      },
    },
  },
  evaluate({ runtime }) {
    return { ...runtime.inputs };
  },
};
