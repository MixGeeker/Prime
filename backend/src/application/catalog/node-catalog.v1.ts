import type { NodeCatalog } from './node-catalog.types';

/**
 * 内置 Node Catalog（MVP）。
 *
 * 设计取舍：
 * - 变量/常量节点按 valueType 拆分（core.var.* / core.const.*），避免“输出类型随 params 变化”的泛型节点，
 *   让静态校验（端口类型、连线类型）更容易落地。
 */
export const NODE_CATALOG_V1: NodeCatalog = {
  schemaVersion: 1,
  nodes: [
    // -----------------------------
    // core.var.*：变量读取（source）
    // -----------------------------
    {
      nodeType: 'core.var.decimal',
      nodeVersion: 1,
      title: '变量（Decimal）',
      category: 'core',
      description: '从 inputs 读取一个 Decimal 变量（params.path）。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Decimal' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      nodeType: 'core.var.ratio',
      nodeVersion: 1,
      title: '变量（Ratio）',
      category: 'core',
      description: '从 inputs 读取一个 Ratio 变量（0..1）。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Ratio' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      nodeType: 'core.var.string',
      nodeVersion: 1,
      title: '变量（String）',
      category: 'core',
      description: '从 inputs 读取一个 String 变量。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'String' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      nodeType: 'core.var.boolean',
      nodeVersion: 1,
      title: '变量（Boolean）',
      category: 'core',
      description: '从 inputs 读取一个 Boolean 变量。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Boolean' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      nodeType: 'core.var.datetime',
      nodeVersion: 1,
      title: '变量（DateTime）',
      category: 'core',
      description: '从 inputs 读取一个 DateTime（ISO 字符串）变量。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'DateTime' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      nodeType: 'core.var.json',
      nodeVersion: 1,
      title: '变量（Json）',
      category: 'core',
      description: '从 inputs 读取一个 Json 变量（不做强类型语义）。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Json' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
        },
      },
    },

    // -----------------------------
    // core.const.*：常量（source）
    // -----------------------------
    {
      nodeType: 'core.const.decimal',
      nodeVersion: 1,
      title: '常量（Decimal）',
      category: 'core',
      description: '在图中内联一个 Decimal 常量。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Decimal' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: {
          value: {
            anyOf: [
              {
                type: 'string',
                pattern: '^-?(0|[1-9]\\\\d*)(\\\\.\\\\d+)?$',
              },
              { type: 'number' },
            ],
          },
        },
      },
    },
    {
      nodeType: 'core.const.ratio',
      nodeVersion: 1,
      title: '常量（Ratio）',
      category: 'core',
      description: '在图中内联一个 Ratio 常量（0..1）。',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Ratio' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: {
          value: {
            anyOf: [
              {
                type: 'string',
                pattern: '^-?(0|[1-9]\\\\d*)(\\\\.\\\\d+)?$',
              },
              { type: 'number' },
            ],
          },
        },
      },
    },
    {
      nodeType: 'core.const.string',
      nodeVersion: 1,
      title: '常量（String）',
      category: 'core',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'String' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: {
          value: { type: 'string' },
        },
      },
    },
    {
      nodeType: 'core.const.boolean',
      nodeVersion: 1,
      title: '常量（Boolean）',
      category: 'core',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Boolean' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: {
          value: { type: 'boolean' },
        },
      },
    },
    {
      nodeType: 'core.const.datetime',
      nodeVersion: 1,
      title: '常量（DateTime）',
      category: 'core',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'DateTime' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: {
          value: { type: 'string' },
        },
      },
    },
    {
      nodeType: 'core.const.json',
      nodeVersion: 1,
      title: '常量（Json）',
      category: 'core',
      inputs: [],
      outputs: [{ name: 'value', valueType: 'Json' }],
      paramsSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: {
          value: {},
        },
      },
    },

    // -----------------------------
    // math.*：基础数值节点（执行在 M5 才会实现）
    // -----------------------------
    {
      nodeType: 'math.add',
      nodeVersion: 1,
      title: '加法',
      category: 'math',
      description: 'Decimal 加法：a + b',
      inputs: [
        { name: 'a', valueType: 'Decimal' },
        { name: 'b', valueType: 'Decimal' },
      ],
      outputs: [{ name: 'value', valueType: 'Decimal' }],
    },
    {
      nodeType: 'math.sub',
      nodeVersion: 1,
      title: '减法',
      category: 'math',
      description: 'Decimal 减法：a - b',
      inputs: [
        { name: 'a', valueType: 'Decimal' },
        { name: 'b', valueType: 'Decimal' },
      ],
      outputs: [{ name: 'value', valueType: 'Decimal' }],
    },
    {
      nodeType: 'math.mul',
      nodeVersion: 1,
      title: '乘法',
      category: 'math',
      description: 'Decimal 乘法：a * b',
      inputs: [
        { name: 'a', valueType: 'Decimal' },
        { name: 'b', valueType: 'Decimal' },
      ],
      outputs: [{ name: 'value', valueType: 'Decimal' }],
    },
    {
      nodeType: 'math.div',
      nodeVersion: 1,
      title: '除法',
      category: 'math',
      description: 'Decimal 除法：a / b（除零语义在 runner 里定义）',
      inputs: [
        { name: 'a', valueType: 'Decimal' },
        { name: 'b', valueType: 'Decimal' },
      ],
      outputs: [{ name: 'value', valueType: 'Decimal' }],
    },
  ],
};
