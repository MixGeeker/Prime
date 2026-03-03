import type { NodeImplementation } from '../node-implementation.types';
import { LOGIC_AND_V1 } from './and.v1';
import { LOGIC_NOT_V1 } from './not.v1';
import { LOGIC_OR_V1 } from './or.v1';

export const LOGIC_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  LOGIC_AND_V1,
  LOGIC_OR_V1,
  LOGIC_NOT_V1,
];
