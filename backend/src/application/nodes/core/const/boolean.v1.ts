import { canonicalizeValueByType } from '../../../hashing/canonicalize';
import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';

export const CORE_CONST_BOOLEAN_V1: NodeImplementation = {
  def: {
    nodeType: 'core.const.boolean',
    nodeVersion: 1,
    title: '常量（Boolean）',
    category: 'core',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Boolean' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: { type: 'boolean' },
      },
    },
  },
  evaluate({ node }) {
    const rawValue = node.params?.['value'];
    const canonicalized = canonicalizeValueByType('Boolean', rawValue);
    if (!canonicalized.ok) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid constant value for ${node.id}: ${canonicalized.message}`,
      );
    }
    return { value: canonicalized.value };
  },
};
