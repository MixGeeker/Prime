import type { NodeImplementation } from '../node-implementation.types';
import { RunnerExecutionError } from '../../runner/runner.error';

const MAX_SEQUENCE_OUTS = 8;

export const FLOW_SEQUENCE_V1: NodeImplementation = {
  def: {
    nodeType: 'flow.sequence',
    title: '顺序执行',
    category: 'flow',
    description:
      '顺序触发多个分支：按 out0→out1→... 的顺序执行（通过 Runner 的确定性调度实现）。',
    execInputs: [{ name: 'in' }],
    execOutputs: Array.from({ length: MAX_SEQUENCE_OUTS }, (_, i) => ({
      name: `out${i}`,
    })),
    inputs: [],
    outputs: [],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['count'],
      properties: {
        count: { type: 'integer', minimum: 1, maximum: MAX_SEQUENCE_OUTS },
      },
    },
  },
  evaluate() {
    return {};
  },
  execute({ node }) {
    const rawCount = node.params?.['count'];
    if (
      typeof rawCount !== 'number' ||
      !Number.isInteger(rawCount) ||
      rawCount < 1 ||
      rawCount > MAX_SEQUENCE_OUTS
    ) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `flow.sequence params.count must be an integer between 1 and ${MAX_SEQUENCE_OUTS}: ${node.id}`,
      );
    }

    const ports = Array.from({ length: rawCount }, (_, i) => `out${i}`);
    return { kind: 'continue_many', ports };
  },
};
