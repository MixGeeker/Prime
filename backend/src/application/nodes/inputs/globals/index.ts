import type { NodeImplementation } from '../../node-implementation.types';
import { INPUTS_GLOBALS_BOOLEAN_V1 } from './boolean.v1';
import { INPUTS_GLOBALS_DATETIME_V1 } from './datetime.v1';
import { INPUTS_GLOBALS_DECIMAL_V1 } from './decimal.v1';
import { INPUTS_GLOBALS_JSON_V1 } from './json.v1';
import { INPUTS_GLOBALS_RATIO_V1 } from './ratio.v1';
import { INPUTS_GLOBALS_STRING_V1 } from './string.v1';

export const INPUTS_GLOBALS_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  INPUTS_GLOBALS_DECIMAL_V1,
  INPUTS_GLOBALS_RATIO_V1,
  INPUTS_GLOBALS_STRING_V1,
  INPUTS_GLOBALS_BOOLEAN_V1,
  INPUTS_GLOBALS_DATETIME_V1,
  INPUTS_GLOBALS_JSON_V1,
];
