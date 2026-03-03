import type { NodeImplementation } from '../node-implementation.types';
import { INPUTS_GLOBALS_NODE_IMPLEMENTATIONS_V1 } from './globals';
import { INPUTS_PARAMS_NODE_IMPLEMENTATIONS_V1 } from './params';

export const INPUTS_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  ...INPUTS_GLOBALS_NODE_IMPLEMENTATIONS_V1,
  ...INPUTS_PARAMS_NODE_IMPLEMENTATIONS_V1,
];
