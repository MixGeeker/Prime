import type { NodeImplementation } from '../../node-implementation.types';
import { COMPARE_DECIMAL_EQ_V1 } from './eq.v1';
import { COMPARE_DECIMAL_GT_V1 } from './gt.v1';
import { COMPARE_DECIMAL_GTE_V1 } from './gte.v1';
import { COMPARE_DECIMAL_LT_V1 } from './lt.v1';
import { COMPARE_DECIMAL_LTE_V1 } from './lte.v1';
import { COMPARE_DECIMAL_NE_V1 } from './ne.v1';

export const COMPARE_DECIMAL_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  COMPARE_DECIMAL_EQ_V1,
  COMPARE_DECIMAL_NE_V1,
  COMPARE_DECIMAL_GT_V1,
  COMPARE_DECIMAL_GTE_V1,
  COMPARE_DECIMAL_LT_V1,
  COMPARE_DECIMAL_LTE_V1,
];
