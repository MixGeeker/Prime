import { CORE_CONST_NODE_IMPLEMENTATIONS_V1 } from '../core/const';
import { CORE_NODE_IMPLEMENTATIONS_V1 } from '../core';
import { CORE_VAR_NODE_IMPLEMENTATIONS_V1 } from '../core/var';
import { COMPARE_DECIMAL_NODE_IMPLEMENTATIONS_V1 } from '../compare/decimal';
import { LOGIC_NODE_IMPLEMENTATIONS_V1 } from '../logic';
import { MATH_NODE_IMPLEMENTATIONS_V1 } from '../math';
import type { NodeImplementation } from '../node-implementation.types';

export type NodeImplementationKey = `${string}@${number}`;

export const NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  ...CORE_VAR_NODE_IMPLEMENTATIONS_V1,
  ...CORE_CONST_NODE_IMPLEMENTATIONS_V1,
  ...MATH_NODE_IMPLEMENTATIONS_V1,
  ...LOGIC_NODE_IMPLEMENTATIONS_V1,
  ...COMPARE_DECIMAL_NODE_IMPLEMENTATIONS_V1,
  ...CORE_NODE_IMPLEMENTATIONS_V1,
];

const implementationsByKey = new Map<
  NodeImplementationKey,
  NodeImplementation
>();
for (const impl of NODE_IMPLEMENTATIONS_V1) {
  const key: NodeImplementationKey = `${impl.def.nodeType}@${impl.def.nodeVersion}`;
  if (implementationsByKey.has(key)) {
    throw new Error(`Duplicate node implementation: ${key}`);
  }
  implementationsByKey.set(key, impl);
}

export function getNodeImplementationV1(
  nodeType: string,
  nodeVersion: number,
): NodeImplementation | undefined {
  return implementationsByKey.get(`${nodeType}@${nodeVersion}`);
}
