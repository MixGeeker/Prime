import { stableJsonStringify } from '../../shared/stable-json-stringify';

export function jcsCanonicalize(value: unknown): string {
  return stableJsonStringify(value);
}
