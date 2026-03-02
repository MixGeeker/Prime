/**
 * Graph JSON 的结构校验 schema（MVP）。
 *
 * 说明：
 * - 用 Ajv 做“结构/字段类型/基本约束”的第一层校验；
 * - 其余跨字段规则（唯一性、DAG、端口类型匹配、catalog 校验等）由 GraphValidatorService 负责。
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

export const GRAPH_JSON_SCHEMA_V1 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  // top-level 允许扩展字段（例如 metadata/resolvers），避免 UI/生态字段破坏执行字段。
  additionalProperties: true,
  required: ['schemaVersion', 'variables', 'nodes', 'edges', 'outputs'],
  properties: {
    schemaVersion: { const: 1 },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'valueType'],
        properties: {
          path: {
            type: 'string',
            minLength: 1,
            pattern: '^inputs\\.[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*$',
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
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'nodeType', 'nodeVersion'],
        properties: {
          id: { type: 'string', minLength: 1 },
          nodeType: { type: 'string', minLength: 1 },
          nodeVersion: { type: 'integer', minimum: 1 },
          params: { type: 'object' },
        },
      },
    },
    edges: {
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
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'valueType', 'from'],
        properties: {
          key: { type: 'string', minLength: 1 },
          valueType: { enum: VALUE_TYPES },
          from: { $ref: '#/definitions/endpoint' },
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
    endpoint: {
      type: 'object',
      additionalProperties: false,
      required: ['nodeId', 'port'],
      properties: {
        nodeId: { type: 'string', minLength: 1 },
        port: { type: 'string', minLength: 1 },
      },
    },
  },
} as const;
