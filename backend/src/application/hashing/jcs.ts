import canonicalize from 'canonicalize';

export function jcsCanonicalize(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error('Value is not JSON-serializable for JCS');
  }
  return result;
}
