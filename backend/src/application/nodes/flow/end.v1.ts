import type { NodeImplementation } from '../node-implementation.types';

export const FLOW_END_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.end',
    title: '结束',
    category: 'flow',
    description: '结束节点（UE Return 风格）：聚合输出并终止当前蓝图执行。',
    execInputs: [{ name: 'in' }],
    execOutputs: [],
    inputs: [],
    outputs: [],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        dynamicInputs: {
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
              rounding: {
                type: 'object',
                additionalProperties: false,
                required: ['scale', 'mode'],
                properties: {
                  scale: { type: 'integer', minimum: 0 },
                  mode: {
                    type: 'string',
                    enum: [
                      'UP',
                      'DOWN',
                      'CEIL',
                      'FLOOR',
                      'HALF_UP',
                      'HALF_DOWN',
                      'HALF_EVEN',
                      'HALF_CEIL',
                      'HALF_FLOOR',
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  evaluate() {
    return {};
  },
  execute() {
    return { kind: 'return' };
  },
};

