import type { NodeImplementation } from '../../node-implementation.types';
import { canonicalizeChosenValue } from '../../shared/canonicalize';
import { getString } from '../../shared/value-parsers';
import { RunnerExecutionError } from '../../../runner/runner.error';

export const LOCALS_SET_DATETIME_V1: NodeImplementation = {
  def: {
    nodeType: 'locals.set.datetime',
    title: '设置局部变量（DateTime）',
    category: 'locals',
    description: '设置 locals 中的 DateTime 变量（params.name）。',
    execInputs: [{ name: 'in' }],
    execOutputs: [{ name: 'out' }],
    inputs: [{ name: 'value', valueType: 'DateTime' }],
    outputs: [],
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
  evaluate() {
    return {};
  },
  execute({ node, inputs, runtime }) {
    const name = getString(node.params?.['name']);
    if (!name) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `locals.set node requires params.name: ${node.id}`,
      );
    }

    const value = canonicalizeChosenValue('DateTime', inputs['value'], node.id);
    runtime.setLocal(name, value);
    return { kind: 'continue', port: 'out' };
  },
};

