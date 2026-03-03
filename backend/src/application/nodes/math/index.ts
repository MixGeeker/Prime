import type { NodeImplementation } from '../node-implementation.types';
import { MATH_ADD_V1 } from './add.v1';
import { MATH_DIV_V1 } from './div.v1';
import { MATH_MUL_V1 } from './mul.v1';
import { MATH_ROUND_V1 } from './round.v1';
import { MATH_SUB_V1 } from './sub.v1';

export const MATH_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  MATH_ADD_V1,
  MATH_SUB_V1,
  MATH_MUL_V1,
  MATH_DIV_V1,
  MATH_ROUND_V1,
];
