import type { NodeImplementation } from '../../node-implementation.types';
import { LOCALS_GET_BOOLEAN_V1 } from './boolean.v1';
import { LOCALS_GET_DATETIME_V1 } from './datetime.v1';
import { LOCALS_GET_DECIMAL_V1 } from './decimal.v1';
import { LOCALS_GET_JSON_V1 } from './json.v1';
import { LOCALS_GET_RATIO_V1 } from './ratio.v1';
import { LOCALS_GET_STRING_V1 } from './string.v1';

export const LOCALS_GET_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  LOCALS_GET_DECIMAL_V1,
  LOCALS_GET_RATIO_V1,
  LOCALS_GET_STRING_V1,
  LOCALS_GET_BOOLEAN_V1,
  LOCALS_GET_DATETIME_V1,
  LOCALS_GET_JSON_V1,
];
