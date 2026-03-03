import { canonicalizeValueByType } from '../../../hashing/canonicalize';
import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';

export const CORE_CONST_STRING_V1: NodeImplementation = {
  def: {
    nodeType: 'core.const.string',
    title: '常量（String）',
    category: 'core',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'String' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: { type: 'string' },
      },
    },
  },
  evaluate({ node }) {
    const rawValue = node.params?.['value'];
    const canonicalized = canonicalizeValueByType('String', rawValue);
    if (!canonicalized.ok) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid constant value for ${node.id}: ${canonicalized.message}`,
      );
    }
    return { value: canonicalized.value };
  },
};
