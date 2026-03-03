import type { ValueType } from '../../catalog/node-catalog.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';
import type { NodeImplementation } from '../node-implementation.types';
import { RunnerExecutionError } from '../../runner/runner.error';
import { getString } from '../shared/value-parsers';
import { isPlainObject } from '../../hashing/canonicalize';

type ExposeKey = 'decimal' | 'ratio' | 'string' | 'boolean' | 'datetime' | 'json';

const EXPOSE_SLOTS: Array<{
  key: ExposeKey;
  valueType: ValueType;
  portPrefix: string;
}> = [
  { key: 'decimal', valueType: 'Decimal', portPrefix: 'decimal' },
  { key: 'ratio', valueType: 'Ratio', portPrefix: 'ratio' },
  { key: 'string', valueType: 'String', portPrefix: 'string' },
  { key: 'boolean', valueType: 'Boolean', portPrefix: 'boolean' },
  { key: 'datetime', valueType: 'DateTime', portPrefix: 'datetime' },
  { key: 'json', valueType: 'Json', portPrefix: 'json' },
];

export const FLOW_CALL_DEFINITION_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.call_definition',
    title: '调用子蓝图',
    category: 'flow',
    description:
      '执行子蓝图（以 definitionHash 冻结引用）。输入为 globals/params(Json)，输出为 outputs(Json) + 可选强类型槽位。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'out' }],
    inputs: [
      { name: 'globals', valueType: 'Json' },
      { name: 'params', valueType: 'Json' },
    ],
    outputs: [
      { name: 'outputs', valueType: 'Json' },
      { name: 'decimal0', valueType: 'Decimal' },
      { name: 'decimal1', valueType: 'Decimal' },
      { name: 'ratio0', valueType: 'Ratio' },
      { name: 'ratio1', valueType: 'Ratio' },
      { name: 'string0', valueType: 'String' },
      { name: 'string1', valueType: 'String' },
      { name: 'boolean0', valueType: 'Boolean' },
      { name: 'boolean1', valueType: 'Boolean' },
      { name: 'datetime0', valueType: 'DateTime' },
      { name: 'datetime1', valueType: 'DateTime' },
      { name: 'json0', valueType: 'Json' },
      { name: 'json1', valueType: 'Json' },
    ],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['definitionId', 'definitionHash'],
      properties: {
        definitionId: { type: 'string', minLength: 1 },
        definitionHash: { type: 'string', minLength: 1 },
        entrypointKey: { type: 'string', minLength: 1 },
        exposeOutputs: {
          type: 'object',
          additionalProperties: false,
          properties: {
            decimal: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              maxItems: 2,
            },
            ratio: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              maxItems: 2,
            },
            string: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              maxItems: 2,
            },
            boolean: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              maxItems: 2,
            },
            datetime: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              maxItems: 2,
            },
            json: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              maxItems: 2,
            },
          },
        },
      },
    },
  },
  evaluate({ node, inputs, runtime }) {
    const definitionId = getString(node.params?.['definitionId']);
    const definitionHash = getString(node.params?.['definitionHash']);
    const entrypointKey = getString(node.params?.['entrypointKey']) ?? undefined;

    if (!definitionId || !definitionHash) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.call_definition requires params.definitionId + params.definitionHash: ${node.id}`,
      );
    }

    const rawGlobals = inputs['globals'];
    const rawParams = inputs['params'];
    if (!isPlainObject(rawGlobals)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.call_definition inputs.globals must be an object: ${node.id}`,
      );
    }
    if (!isPlainObject(rawParams)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.call_definition inputs.params must be an object: ${node.id}`,
      );
    }

    const callee = runtime.callDefinition({
      definitionId,
      definitionHash,
      entrypointKey,
      inputs: {
        globals: rawGlobals,
        params: rawParams,
      },
    });

    const calleeOutputs = callee.outputs ?? {};

    const result: Record<string, unknown> = {
      outputs: calleeOutputs,
    };

    const exposeOutputs = isPlainObject(node.params?.['exposeOutputs'])
      ? (node.params?.['exposeOutputs'] as Record<string, unknown>)
      : null;

    for (const slot of EXPOSE_SLOTS) {
      const list = exposeOutputs ? exposeOutputs[slot.key] : undefined;
      if (!Array.isArray(list) || list.length === 0) {
        continue;
      }

      for (let i = 0; i < list.length; i++) {
        const outputKey = list[i];
        if (typeof outputKey !== 'string' || outputKey.length === 0) {
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(calleeOutputs, outputKey)) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `callee output not found: ${definitionId}@${definitionHash} outputs.${outputKey}`,
          );
        }

        const rawValue = (calleeOutputs as Record<string, unknown>)[outputKey];
        const value = canonicalizeChosenValue(
          slot.valueType,
          rawValue,
          `${node.id}.callee.outputs.${outputKey}`,
        );
        result[`${slot.portPrefix}${i}`] = value;
      }
    }

    return result;
  },
  execute() {
    return { kind: 'continue', port: 'out' };
  },
};

