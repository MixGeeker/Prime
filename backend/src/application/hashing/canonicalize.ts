import type { ValueType } from '../catalog/node-catalog.types';

const DECIMAL_REGEX = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

type CanonicalizeSuccess<T> = {
  ok: true;
  value: T;
};

type CanonicalizeFailure = {
  ok: false;
  message: string;
};

export type CanonicalizeResult<T> =
  | CanonicalizeSuccess<T>
  | CanonicalizeFailure;

export interface CanonicalJobOptions {
  decimal?: {
    precision?: number;
    roundingMode?: string;
  };
}

export function canonicalizeValueByType(
  valueType: ValueType,
  value: unknown,
): CanonicalizeResult<unknown> {
  switch (valueType) {
    case 'Decimal': {
      return canonicalizeDecimal(value);
    }
    case 'Ratio': {
      const decimal = canonicalizeDecimal(value);
      if (!decimal.ok) {
        return decimal;
      }
      if (!isCanonicalRatio(decimal.value)) {
        return {
          ok: false,
          message: `ratio is out of range [0, 1]: ${decimal.value}`,
        };
      }
      return decimal;
    }
    case 'String':
      return typeof value === 'string'
        ? { ok: true, value }
        : { ok: false, message: 'value is not a string' };
    case 'Boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, message: 'value is not a boolean' };
    case 'DateTime':
      return canonicalizeDateTime(value);
    case 'Json':
      return { ok: true, value };
    default: {
      const _exhaustive: never = valueType;
      return {
        ok: false,
        message: `unsupported valueType: ${String(_exhaustive)}`,
      };
    }
  }
}

export function canonicalizeDecimal(
  value: unknown,
): CanonicalizeResult<string> {
  if (typeof value === 'bigint') {
    return { ok: true, value: value.toString() };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ok: false, message: 'number must be finite' };
    }
    return canonicalizeDecimalString(value.toString());
  }

  if (typeof value === 'string') {
    return canonicalizeDecimalString(value);
  }

  return { ok: false, message: 'decimal must be string/number/bigint' };
}

export function canonicalizeDateTime(
  value: unknown,
): CanonicalizeResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, message: 'DateTime must be an ISO string' };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return { ok: false, message: 'DateTime is invalid' };
  }
  return { ok: true, value: parsed.toISOString() };
}

export function canonicalizeJobOptions(
  options: unknown,
): CanonicalizeResult<CanonicalJobOptions> {
  if (options === undefined) {
    return { ok: true, value: {} };
  }

  if (!isPlainObject(options)) {
    return { ok: false, message: 'options must be an object' };
  }

  const optionKeys = Object.keys(options);
  for (const key of optionKeys) {
    if (key !== 'decimal') {
      return { ok: false, message: `unsupported options field: ${key}` };
    }
  }

  const decimalValue = options['decimal'];
  if (decimalValue === undefined) {
    return { ok: true, value: {} };
  }

  if (!isPlainObject(decimalValue)) {
    return { ok: false, message: 'options.decimal must be an object' };
  }

  const decimalKeys = Object.keys(decimalValue);
  for (const key of decimalKeys) {
    if (key !== 'precision' && key !== 'roundingMode') {
      return {
        ok: false,
        message: `unsupported options.decimal field: ${key}`,
      };
    }
  }

  const result: CanonicalJobOptions['decimal'] = {};

  if (
    Object.prototype.hasOwnProperty.call(decimalValue, 'precision') &&
    decimalValue['precision'] !== undefined
  ) {
    const precision = decimalValue['precision'];
    if (
      typeof precision !== 'number' ||
      !Number.isInteger(precision) ||
      precision <= 0
    ) {
      return {
        ok: false,
        message: 'options.decimal.precision must be a positive integer',
      };
    }
    result.precision = precision;
  }

  if (
    Object.prototype.hasOwnProperty.call(decimalValue, 'roundingMode') &&
    decimalValue['roundingMode'] !== undefined
  ) {
    const roundingMode = decimalValue['roundingMode'];
    if (typeof roundingMode !== 'string' || roundingMode.length === 0) {
      return {
        ok: false,
        message: 'options.decimal.roundingMode must be a non-empty string',
      };
    }
    result.roundingMode = roundingMode;
  }

  if (Object.keys(result).length === 0) {
    return { ok: true, value: {} };
  }

  return {
    ok: true,
    value: {
      decimal: result,
    },
  };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeDecimalString(value: string): CanonicalizeResult<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'decimal cannot be empty' };
  }

  const matched = DECIMAL_REGEX.exec(trimmed);
  if (!matched) {
    return { ok: false, message: `invalid decimal format: ${value}` };
  }

  const sign = matched[1] === '-' ? '-' : '';
  const integer = matched[2];
  const fraction = matched[3] ?? '';
  const exponentValue = matched[4] ?? '0';
  const exponent = Number(exponentValue);
  if (!Number.isSafeInteger(exponent)) {
    return { ok: false, message: `invalid exponent: ${exponentValue}` };
  }

  const digits = `${integer}${fraction}`;
  const decimalPoint = integer.length + exponent;

  let normalized: string;
  if (decimalPoint <= 0) {
    normalized = `0.${'0'.repeat(-decimalPoint)}${digits}`;
  } else if (decimalPoint >= digits.length) {
    normalized = `${digits}${'0'.repeat(decimalPoint - digits.length)}`;
  } else {
    normalized = `${digits.slice(0, decimalPoint)}.${digits.slice(decimalPoint)}`;
  }

  const normalizedParts = normalizePlainDecimal(normalized);
  if (normalizedParts === '0') {
    return { ok: true, value: '0' };
  }

  return {
    ok: true,
    value: sign === '-' ? `-${normalizedParts}` : normalizedParts,
  };
}

function normalizePlainDecimal(value: string): string {
  const parts = value.split('.');
  let integer = parts[0] ?? '0';
  let fraction = parts[1] ?? '';

  integer = integer.replace(/^0+(?=\d)/, '');
  if (integer.length === 0) {
    integer = '0';
  }

  fraction = fraction.replace(/0+$/, '');

  if (integer === '0' && fraction.length === 0) {
    return '0';
  }

  if (fraction.length === 0) {
    return integer;
  }

  return `${integer}.${fraction}`;
}

function isCanonicalRatio(value: string): boolean {
  if (value === '0' || value === '1') {
    return true;
  }
  if (value.startsWith('-')) {
    return false;
  }
  if (value.startsWith('0.')) {
    return true;
  }
  return false;
}
