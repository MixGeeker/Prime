import type { ValueType } from '../../catalog/node-catalog.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';
import type { NodeImplementation } from '../node-implementation.types';
import { RunnerExecutionError } from '../../runner/runner.error';
import { getString } from '../shared/value-parsers';
import { isPlainObject } from '../../hashing/canonicalize';

type ExposeKey =
  | 'decimal'
  | 'ratio'
  | 'string'
  | 'boolean'
  | 'datetime'
  | 'json';

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
      '执行子蓝图（以 definitionHash 冻结引用）。输入为 inputs(Json)，输出为 outputs(Json) + 可选强类型槽位。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'out' }],
    inputs: [{ name: 'inputs', valueType: 'Json' }],
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
    const entrypointKey =
      getString(node.params?.['entrypointKey']) ?? undefined;

    if (!definitionId || !definitionHash) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.call_definition requires params.definitionId + params.definitionHash: ${node.id}`,
      );
    }

    const rawInputs = inputs['inputs'];
    if (!isPlainObject(rawInputs)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.call_definition inputs.inputs must be an object: ${node.id}`,
      );
    }

    const callee = runtime.callDefinition({
      definitionId,
      definitionHash,
      entrypointKey,
      inputs: rawInputs,
    });

    const rawCalleeOutputs = callee.outputs;
    if (
      rawCalleeOutputs !== undefined &&
      rawCalleeOutputs !== null &&
      !isPlainObject(rawCalleeOutputs)
    ) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `callee outputs must be an object: ${definitionId}@${definitionHash}`,
      );
    }

    const calleeOutputs: Record<string, unknown> = isPlainObject(
      rawCalleeOutputs,
    )
      ? rawCalleeOutputs
      : {};

    const result: Record<string, unknown> = {
      outputs: calleeOutputs,
    };

    const exposeOutputsRaw = node.params?.['exposeOutputs'];
    const exposeOutputs = isPlainObject(exposeOutputsRaw)
      ? exposeOutputsRaw
      : null;

    for (const slot of EXPOSE_SLOTS) {
      const listRaw = exposeOutputs ? exposeOutputs[slot.key] : undefined;
      if (
        !Array.isArray(listRaw) ||
        listRaw.length === 0 ||
        !listRaw.every(
          (v): v is string => typeof v === 'string' && v.length > 0,
        )
      ) {
        continue;
      }

      const list = listRaw;
      for (let i = 0; i < list.length; i++) {
        const outputKey = list[i];
        if (!Object.hasOwn(calleeOutputs, outputKey)) {
          throw new RunnerExecutionError(
            'RUNNER_DETERMINISTIC_ERROR',
            `callee output not found: ${definitionId}@${definitionHash} outputs.${outputKey}`,
          );
        }

        const rawValue = calleeOutputs[outputKey];
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
