import type { NodeImplementation } from '../../node-implementation.types';
import { RunnerExecutionError } from '../../../runner/runner.error';
import { getString } from '../../shared/value-parsers';
import { canonicalizeChosenValue } from '../../shared/canonicalize';

export const OUTPUTS_SET_BOOLEAN_V1: NodeImplementation = {
  def: {
    nodeType: 'outputs.set.boolean',
    title: '设置输出（Boolean）',
    category: 'outputs',
    description:
      '把一个 Boolean 写入 outputs（params.key）。必须走控制流执行。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'out' }],
    inputs: [{ name: 'value', valueType: 'Boolean' }],
    outputs: [],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['key'],
      properties: {
        key: { type: 'string', minLength: 1 },
      },
    },
  },
  evaluate() {
    return {};
  },
  execute({ node, inputs, runtime }) {
    const key = getString(node.params?.['key']);
    if (!key) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `outputs.set node requires params.key: ${node.id}`,
      );
    }

    const value = canonicalizeChosenValue('Boolean', inputs['value'], node.id);
    runtime.setOutput({ key, value, nodeId: node.id });
    return { kind: 'continue', port: 'out' };
  },
};
