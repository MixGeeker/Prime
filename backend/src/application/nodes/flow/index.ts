import type { NodeImplementation } from '../node-implementation.types';
import { FLOW_BRANCH_V1 } from './branch.v1';
import { FLOW_CALL_DEFINITION_V1 } from './call_definition.v1';
import { FLOW_NOOP_V1 } from './noop.v1';
import { FLOW_RETURN_V1 } from './return.v1';
import { FLOW_SEQUENCE_V1 } from './sequence.v1';
import { FLOW_WHILE_V1 } from './while.v1';

export const FLOW_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  FLOW_NOOP_V1,
  FLOW_BRANCH_V1,
  FLOW_CALL_DEFINITION_V1,
  FLOW_SEQUENCE_V1,
  FLOW_WHILE_V1,
  FLOW_RETURN_V1,
];
