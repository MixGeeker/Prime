import { canonicalizeValueByType } from '../../../hashing/canonicalize';
import { RunnerExecutionError } from '../../../runner/runner.error';
import type { NodeImplementation } from '../../node-implementation.types';

export const CORE_CONST_RATIO_V1: NodeImplementation = {
  def: {
    nodeType: 'core.const.ratio',
    title: '常量（Ratio）',
    category: 'core',
    description: '在图中内联一个 Ratio 常量（0..1）。',
    inputs: [],
    outputs: [{ name: 'value', valueType: 'Ratio' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: {
          anyOf: [
            {
              type: 'string',
              pattern: '^-?(0|[1-9]\\d*)(\\.\\d+)?$',
            },
            { type: 'number' },
          ],
        },
      },
    },
  },
  evaluate({ node }) {
    const rawValue = node.params?.['value'];
    const canonicalized = canonicalizeValueByType('Ratio', rawValue);
    if (!canonicalized.ok) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `invalid constant value for ${node.id}: ${canonicalized.message}`,
      );
    }
    return { value: canonicalized.value };
  },
};
