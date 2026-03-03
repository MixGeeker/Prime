import type { NodeImplementation } from '../node-implementation.types';
import { OUTPUTS_SET_BOOLEAN_V1 } from './set/boolean.v1';
import { OUTPUTS_SET_DATETIME_V1 } from './set/datetime.v1';
import { OUTPUTS_SET_DECIMAL_V1 } from './set/decimal.v1';
import { OUTPUTS_SET_JSON_V1 } from './set/json.v1';
import { OUTPUTS_SET_RATIO_V1 } from './set/ratio.v1';
import { OUTPUTS_SET_STRING_V1 } from './set/string.v1';

export const OUTPUTS_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  OUTPUTS_SET_DECIMAL_V1,
  OUTPUTS_SET_RATIO_V1,
  OUTPUTS_SET_STRING_V1,
  OUTPUTS_SET_BOOLEAN_V1,
  OUTPUTS_SET_DATETIME_V1,
  OUTPUTS_SET_JSON_V1,
];
