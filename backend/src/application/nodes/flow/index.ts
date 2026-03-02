import type { NodeImplementation } from '../node-implementation.types';
import { FLOW_BRANCH_V1 } from './branch.v1';
import { FLOW_NOOP_V1 } from './noop.v1';
import { FLOW_RETURN_V1 } from './return.v1';

export const FLOW_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  FLOW_NOOP_V1,
  FLOW_BRANCH_V1,
  FLOW_RETURN_V1,
];

