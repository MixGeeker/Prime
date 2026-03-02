import type { NodeImplementation } from '../../node-implementation.types';
import { CORE_VAR_BOOLEAN_V1 } from './boolean.v1';
import { CORE_VAR_DATETIME_V1 } from './datetime.v1';
import { CORE_VAR_DECIMAL_V1 } from './decimal.v1';
import { CORE_VAR_JSON_V1 } from './json.v1';
import { CORE_VAR_RATIO_V1 } from './ratio.v1';
import { CORE_VAR_STRING_V1 } from './string.v1';

export const CORE_VAR_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  CORE_VAR_DECIMAL_V1,
  CORE_VAR_RATIO_V1,
  CORE_VAR_STRING_V1,
  CORE_VAR_BOOLEAN_V1,
  CORE_VAR_DATETIME_V1,
  CORE_VAR_JSON_V1,
];
