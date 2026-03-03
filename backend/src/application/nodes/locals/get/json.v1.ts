import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';
import { getString } from '../../shared/value-parsers';

export const LOCALS_GET_JSON_V1: NodeImplementation = {
  def: {
    nodeType: 'locals.get.json',
    title: '读取局部变量（Json）',
    category: 'locals',
    description: '读取 locals 中的 Json 变量（params.name）。',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Json' }],
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
        `locals.get node requires params.name: ${node.id}`,
      );
    }
    return {
      value: runtime.getLocal(name),
    };
  },
};
