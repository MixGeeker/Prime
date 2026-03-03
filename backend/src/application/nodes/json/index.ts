import type { NodeImplementation } from '../node-implementation.types';
import { JSON_SELECT_V1 } from './select.v1';
import { JSON_TO_BOOLEAN_V1 } from './to.boolean.v1';
import { JSON_TO_DATETIME_V1 } from './to.datetime.v1';
import { JSON_TO_DECIMAL_V1 } from './to.decimal.v1';
import { JSON_TO_RATIO_V1 } from './to.ratio.v1';
import { JSON_TO_STRING_V1 } from './to.string.v1';

export const JSON_NODE_IMPLEMENTATIONS_V1: NodeImplementation[] = [
  JSON_SELECT_V1,
  JSON_TO_DECIMAL_V1,
  JSON_TO_RATIO_V1,
  JSON_TO_STRING_V1,
  JSON_TO_BOOLEAN_V1,
  JSON_TO_DATETIME_V1,
];

