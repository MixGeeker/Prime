import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';
import { getString } from '../../shared/value-parsers';

export const CORE_VAR_STRING_V1: NodeImplementation = {
  def: {
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
  evaluate({ node, variableValues }) {
    const path = getString(node.params?.['path']);
    if (!path) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `core.var node requires params.path: ${node.id}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(variableValues, path)) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `variable path is not available at runtime: ${path}`,
      );
    }
    return {
      value: variableValues[path],
    };
  },
};
