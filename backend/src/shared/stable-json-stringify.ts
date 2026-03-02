/**
 * 稳定 JSON 序列化（键排序）。
 *
 * 用途：
 * - 用于生成 requestHash 等“需要跨进程稳定”的字符串表示
 *
 * 注意：
 * - 这不是完整的 RFC 8785（JCS）实现；M3 会引入正式的 JCS + canonicalize
 * - 仅支持 plain object / array；遇到非 plain object 会抛错，避免不稳定行为
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function isJsonPrimitive(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function stringifyJsonValue(value: unknown): string {
  if (isJsonPrimitive(value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'bigint') {
    throw new Error('BigInt is not JSON-serializable');
  }

  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return 'null';
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => stringifyJsonValue(item));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === 'function') {
      return stringifyJsonValue(withToJson.toJSON());
    }

    if (!isPlainObject(value)) {
      throw new Error('Only plain objects/arrays are supported');
    }

    // 对象键按字典序排序，避免不同引擎/插入顺序导致输出不稳定。
    const keys = Object.keys(value).sort();
    const properties: string[] = [];
    for (const key of keys) {
      const propertyValue = value[key];
      if (
        typeof propertyValue === 'undefined' ||
        typeof propertyValue === 'function' ||
        typeof propertyValue === 'symbol'
      ) {
        // 与 JSON.stringify 行为保持一致：跳过 undefined / function / symbol。
        continue;
      }
      properties.push(
        `${JSON.stringify(key)}:${stringifyJsonValue(propertyValue)}`,
      );
    }
    return `{${properties.join(',')}}`;
  }

  return 'null';
}

export function stableJsonStringify(value: unknown): string {
  return stringifyJsonValue(value);
}
