import type { NodeImplementation } from '../node-implementation.types';
import { LOCALS_GET_NODE_IMPLEMENTATIONS_V1 } from './get';
import { LOCALS_SET_NODE_IMPLEMENTATIONS_V1 } from './set';

export const LOCALS_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  ...LOCALS_GET_NODE_IMPLEMENTATIONS_V1,
  ...LOCALS_SET_NODE_IMPLEMENTATIONS_V1,
];

