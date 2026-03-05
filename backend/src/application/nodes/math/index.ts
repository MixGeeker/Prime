import type { NodeImplementation } from '../node-implementation.types';
import { MATH_ABS_V1 } from './abs.v1';
import { MATH_ADD_V1 } from './add.v1';
import { MATH_CEIL_V1 } from './ceil.v1';
import { MATH_CLAMP_V1 } from './clamp.v1';
import { MATH_DIV_V1 } from './div.v1';
import { MATH_EXP_V1 } from './exp.v1';
import { MATH_FLOOR_V1 } from './floor.v1';
import { MATH_LOG_V1 } from './log.v1';
import { MATH_MAX_V1 } from './max.v1';
import { MATH_MIN_V1 } from './min.v1';
import { MATH_MOD_V1 } from './mod.v1';
import { MATH_MUL_V1 } from './mul.v1';
import { MATH_PERCENTAGE_OF_V1 } from './percentage_of.v1';
import { MATH_PERCENT_CHANGE_V1 } from './percent_change.v1';
import { MATH_POW_V1 } from './pow.v1';
import { MATH_ROUND_V1 } from './round.v1';
import { MATH_SIGN_V1 } from './sign.v1';
import { MATH_SQRT_V1 } from './sqrt.v1';
import { MATH_SUB_V1 } from './sub.v1';
import { MATH_TRUNC_V1 } from './trunc.v1';

export const MATH_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  MATH_ABS_V1,
  MATH_ADD_V1,
  MATH_CEIL_V1,
  MATH_CLAMP_V1,
  MATH_FLOOR_V1,
  MATH_TRUNC_V1,
  MATH_PERCENTAGE_OF_V1,
  MATH_PERCENT_CHANGE_V1,
  MATH_SIGN_V1,
  MATH_MAX_V1,
  MATH_MIN_V1,
  MATH_MOD_V1,
  MATH_SUB_V1,
  MATH_MUL_V1,
  MATH_DIV_V1,
  MATH_LOG_V1,
  MATH_EXP_V1,
  MATH_POW_V1,
  MATH_ROUND_V1,
  MATH_SQRT_V1,
];
