import type { NodeImplementation } from '../../node-implementation.types';
import { LOCALS_SET_BOOLEAN_V1 } from './boolean.v1';
import { LOCALS_SET_DATETIME_V1 } from './datetime.v1';
import { LOCALS_SET_DECIMAL_V1 } from './decimal.v1';
import { LOCALS_SET_JSON_V1 } from './json.v1';
import { LOCALS_SET_RATIO_V1 } from './ratio.v1';
import { LOCALS_SET_STRING_V1 } from './string.v1';

export const LOCALS_SET_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  LOCALS_SET_DECIMAL_V1,
  LOCALS_SET_RATIO_V1,
  LOCALS_SET_STRING_V1,
  LOCALS_SET_BOOLEAN_V1,
  LOCALS_SET_DATETIME_V1,
  LOCALS_SET_JSON_V1,
];

