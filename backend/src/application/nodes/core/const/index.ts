import type { NodeImplementation } from '../../node-implementation.types';
import { CORE_CONST_BOOLEAN_V1 } from './boolean.v1';
import { CORE_CONST_DATETIME_V1 } from './datetime.v1';
import { CORE_CONST_DECIMAL_V1 } from './decimal.v1';
import { CORE_CONST_JSON_V1 } from './json.v1';
import { CORE_CONST_RATIO_V1 } from './ratio.v1';
import { CORE_CONST_STRING_V1 } from './string.v1';

export const CORE_CONST_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  CORE_CONST_DECIMAL_V1,
  CORE_CONST_RATIO_V1,
  CORE_CONST_STRING_V1,
  CORE_CONST_BOOLEAN_V1,
  CORE_CONST_DATETIME_V1,
  CORE_CONST_JSON_V1,
];
