import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';
import { getString } from '../../shared/value-parsers';

export const INPUTS_GLOBALS_DECIMAL_V1: NodeImplementation = {
  def: {
    nodeType: 'inputs.globals.decimal',
    title: '读取全局输入（Decimal）',
    category: 'inputs',
    description: '从 inputs.globals 读取一个 Decimal（params.name）。',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Decimal' }],
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
        `inputs.globals node requires params.name: ${node.id}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(runtime.globals, name)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `global input is not available at runtime: ${name}`,
      );
    }
    return {
      value: runtime.globals[name],
    };
  },
};

