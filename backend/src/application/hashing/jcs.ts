/**
 * JCS（JSON Canonicalization Scheme）封装。
 *
 * 用途：将 JSON object 规范化为稳定字符串（键排序等），避免不同序列化顺序影响哈希。
 */
import canonicalize from 'canonicalize';

export function jcsCanonicalize(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error('Value is not JSON-serializable for JCS');
  }
  return result;
}
