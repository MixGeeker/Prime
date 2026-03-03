import { RunnerExecutionError } from '../../runner/runner.error';
import type { NodeImplementation } from '../node-implementation.types';
import { getString } from '../shared/value-parsers';

function splitPath(rawPath: string): string[] {
  const trimmed = rawPath.trim();
  if (!trimmed) return [];

  const normalized = trimmed.startsWith('value.')
    ? trimmed.slice('value.'.length)
    : trimmed.startsWith('value')
      ? trimmed.slice('value'.length)
      : trimmed;

  return normalized
    .split('.')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function selectFromJson(value: unknown, segments: string[]): unknown {
  let current: unknown = value;

  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current[idx];
      continue;
    }

    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(obj, seg)) {
        return undefined;
      }
      current = obj[seg];
      continue;
    }

    return undefined;
  }

  return current;
}

export const JSON_SELECT_V1: NodeImplementation = {
  def: {
    nodeType: 'json.select',
    title: 'Json 解析',
    category: 'json',
    description:
      '从 Json 中选择子字段：默认按 key（逐层），或按 path 直达（a.b.c / value.a.b.c）。',
    inputs: [{ name: 'value', valueType: 'Json' }],
    outputs: [{ name: 'value', valueType: 'Json' }],
    paramsSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['browse', 'path'],
          default: 'browse',
          title: 'mode',
          description: 'browse=逐层 key；path=直达路径',
        },
        key: {
          type: 'string',
          title: 'key',
          description: 'browse 模式下选择的 key',
        },
        path: {
          type: 'string',
          title: 'path',
          description: 'path 模式下的路径，例如 a.b.c 或 value.a.b.c',
        },
      },
    },
  },
  evaluate({ node, inputs }) {
    const mode = getString(node.params?.['mode']) ?? 'browse';
    const inputValue = inputs['value'];

    let selected: unknown;
    if (mode === 'path') {
      const rawPath = getString(node.params?.['path']);
      if (!rawPath) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `json.select requires params.path when mode=path: ${node.id}`,
        );
      }
      const segments = splitPath(rawPath);
      selected = selectFromJson(inputValue, segments);
    } else if (mode === 'browse') {
      const key = getString(node.params?.['key']);
      if (!key) {
        throw new RunnerExecutionError(
          'RUNNER_DETERMINISTIC_ERROR',
          `json.select requires params.key when mode=browse: ${node.id}`,
        );
      }
      selected = selectFromJson(inputValue, [key]);
    } else {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `json.select params.mode must be browse|path: ${node.id}`,
      );
    }

    if (selected === undefined) {
      throw new RunnerExecutionError(
        'RUNNER_DETERMINISTIC_ERROR',
        `json.select result is undefined (missing key/path): ${node.id}`,
      );
    }

    return { value: selected };
  },
};

