/**
 * 内置节点实现注册表（v1）。
 *
 * 说明：
 * - Node Catalog 的单一事实来源是 NodeImplementation.def
 * - Runner 执行时会通过 nodeType 在此处找到 evaluate/execute 实现
 * - key=def.nodeType，必须全局唯一
 */
import { CORE_CONST_NODE_IMPLEMENTATIONS_V1 } from '../core/const';
import { CORE_NODE_IMPLEMENTATIONS_V1 } from '../core';
import { COMPARE_DECIMAL_NODE_IMPLEMENTATIONS_V1 } from '../compare/decimal';
import { FLOW_NODE_IMPLEMENTATIONS_V1 } from '../flow';
import { INPUTS_NODE_IMPLEMENTATIONS_V1 } from '../inputs';
import { JSON_NODE_IMPLEMENTATIONS_V1 } from '../json';
import { LOGIC_NODE_IMPLEMENTATIONS_V1 } from '../logic';
import { LOCALS_NODE_IMPLEMENTATIONS_V1 } from '../locals';
import { MATH_NODE_IMPLEMENTATIONS_V1 } from '../math';
import type { NodeImplementation } from '../node-implementation.types';

export type NodeImplementationKey = string;

export const NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  ...FLOW_NODE_IMPLEMENTATIONS_V1,
  ...INPUTS_NODE_IMPLEMENTATIONS_V1,
  ...LOCALS_NODE_IMPLEMENTATIONS_V1,
  ...CORE_CONST_NODE_IMPLEMENTATIONS_V1,
  ...JSON_NODE_IMPLEMENTATIONS_V1,
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
  const key: NodeImplementationKey = impl.def.nodeType;
  if (implementationsByKey.has(key)) {
    throw new Error(`Duplicate node implementation: ${key}`);
  }
  implementationsByKey.set(key, impl);
}

export function getNodeImplementationV1(
  nodeType: string,
): NodeImplementation | undefined {
  return implementationsByKey.get(nodeType);
}
