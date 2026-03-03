import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';
import { getString } from '../../shared/value-parsers';

export const INPUTS_PARAMS_BOOLEAN_V1: NodeImplementation = {
  def: {
    nodeType: 'inputs.params.boolean',
    title: '读取入口参数（Boolean）',
    category: 'inputs',
    description: '从 inputs.params 读取一个 Boolean（params.name）。',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Boolean' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 },
      },
    },
  },
  evaluate({ node, runtime }) {
    const name = getString(node.params?.['name']);
    if (!name) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `inputs.params node requires params.name: ${node.id}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(runtime.params, name)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `entrypoint param is not available at runtime: ${name}`,
      );
    }
    return {
      value: runtime.params[name],
    };
  },
};
