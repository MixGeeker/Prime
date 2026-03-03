/**
 * BlueprintGraph 的结构校验 schema（MVP）。
 *
 * 说明：
 * - 用 Ajv 做“结构/字段类型/基本约束”的第一层校验；
 * - 其余跨字段规则（唯一性、value-DAG、端口类型匹配、catalog 校验等）由 GraphValidatorService 负责。
 */

export const ROUNDING_MODES = [
  'UP',
  'DOWN',
  'CEIL',
  'FLOOR',
  'HALF_UP',
  'HALF_DOWN',
  'HALF_EVEN',
  'HALF_CEIL',
  'HALF_FLOOR',
] as const;

export const VALUE_TYPES = [
  'Decimal',
  'Ratio',
  'String',
  'Boolean',
  'DateTime',
  'Json',
] as const;

export const BLUEPRINT_GRAPH_SCHEMA_V1 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  // top-level 允许扩展字段（例如 metadata/resolvers），避免 UI/生态字段破坏执行字段。
  additionalProperties: true,
  required: [
    'globals',
    'entrypoints',
    'locals',
    'nodes',
    'edges',
    'execEdges',
    'outputs',
  ],
  properties: {
    globals: { $ref: '#/definitions/inputDefArray' },
    entrypoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'params', 'to'],
        properties: {
          key: { type: 'string', minLength: 1 },
          params: { $ref: '#/definitions/inputDefArray' },
          to: { $ref: '#/definitions/endpoint' },
        },
      },
    },
    locals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'valueType'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            pattern: '^[A-Za-z0-9_-]+$',
          },
          valueType: { enum: VALUE_TYPES },
          // default 的具体校验需要结合 valueType 做 typed validate，这里先不限制类型。
          default: {},
          description: { type: 'string' },
        },
      },
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'nodeType'],
        properties: {
          id: { type: 'string', minLength: 1 },
          nodeType: { type: 'string', minLength: 1 },
          params: { type: 'object' },
        },
      },
    },
    edges: { $ref: '#/definitions/edgeArray' },
    execEdges: { $ref: '#/definitions/edgeArray' },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'valueType'],
        properties: {
          key: { type: 'string', minLength: 1 },
          valueType: { enum: VALUE_TYPES },
          rounding: {
            type: 'object',
            additionalProperties: false,
            required: ['scale', 'mode'],
            properties: {
              scale: { type: 'integer', minimum: 0 },
              mode: { enum: ROUNDING_MODES },
            },
          },
        },
      },
    },
    metadata: {},
    resolvers: {},
  },
  definitions: {
    inputDefArray: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'valueType'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            pattern: '^[A-Za-z0-9_-]+$',
          },
          valueType: { enum: VALUE_TYPES },
          required: { type: 'boolean' },
          description: { type: 'string' },
          // default 的具体校验需要结合 valueType 做 typed validate，这里先不限制类型。
          default: {},
          constraints: { type: 'object' },
        },
      },
    },
    endpoint: {
      type: 'object',
      additionalProperties: false,
      required: ['nodeId', 'port'],
      properties: {
        nodeId: { type: 'string', minLength: 1 },
        port: { type: 'string', minLength: 1 },
      },
    },
    edgeArray: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to'],
        properties: {
          from: { $ref: '#/definitions/endpoint' },
          to: { $ref: '#/definitions/endpoint' },
        },
      },
    },
  },
} as const;
