import type { PinDef } from '../../validation/graph-json.types';
import { canonicalizeChosenValue } from '../shared/canonicalize';
import type { NodeImplementation } from '../node-implementation.types';
import { RunnerExecutionError } from '../../runner/runner.error';
import { getString } from '../shared/value-parsers';
import { isPlainObject } from '../../hashing/canonicalize';

export const FLOW_CALL_DEFINITION_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.call_definition',
    title: '调用子蓝图',
    category: 'flow',
    description:
      '执行子蓝图（以 definitionHash 冻结引用）。动态输入 pins = callee flow.start，动态输出 pins = callee flow.end。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'out' }],
    inputs: [],
    outputs: [{ name: 'outputs', valueType: 'Json' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: [
        'definitionId',
        'definitionHash',
        'calleeInputPins',
        'calleeOutputPins',
      ],
      properties: {
        definitionId: { type: 'string', minLength: 1 },
        definitionHash: { type: 'string', minLength: 1 },
        calleeInputPins: {
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
                enum: [
                  'Decimal',
                  'Ratio',
                  'String',
                  'Boolean',
                  'DateTime',
                  'Json',
                ],
              },
              required: { type: 'boolean' },
              defaultValue: {},
            },
          },
        },
        calleeOutputPins: {
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
                enum: [
                  'Decimal',
                  'Ratio',
                  'String',
                  'Boolean',
                  'DateTime',
                  'Json',
                ],
              },
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
  evaluate({ node, inputs, runtime }) {
    const definitionId = getString(node.params?.['definitionId']);
    const definitionHash = getString(node.params?.['definitionHash']);

    if (!definitionId || !definitionHash) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.call_definition requires params.definitionId + params.definitionHash: ${node.id}`,
      );
    }

    const inputPins = readPinDefs(node.params?.['calleeInputPins']);
    const outputPins = readPinDefs(node.params?.['calleeOutputPins']);

    const callInputs: Record<string, unknown> = {};
    for (const pin of inputPins) {
      const v = inputs[pin.name];
      if (v !== undefined) {
        callInputs[pin.name] = v;
      }
    }

    const callee = runtime.callDefinition({
      definitionId,
      definitionHash,
      inputs: callInputs,
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

    for (const pin of outputPins) {
      const rawValue = calleeOutputs[pin.name];
      const value = canonicalizeChosenValue(
        pin.valueType,
        rawValue,
        `${node.id}.callee.outputs.${pin.name}`,
      );
      result[pin.name] = value;
    }

    return result;
  },
  execute() {
    return { kind: 'continue', port: 'out' };
  },
};

function readPinDefs(value: unknown): PinDef[] {
  if (!Array.isArray(value)) return [];
  const pins: PinDef[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = item['name'];
    const valueType = item['valueType'];
    if (typeof name !== 'string' || name.length === 0) continue;
    if (
      valueType !== 'Decimal' &&
      valueType !== 'Ratio' &&
      valueType !== 'String' &&
      valueType !== 'Boolean' &&
      valueType !== 'DateTime' &&
      valueType !== 'Json'
    ) {
      continue;
    }
    pins.push(item as unknown as PinDef);
  }
  return pins;
}
