/**
 * Definition 依赖分析与校验（子蓝图调用）。
 *
 * 用途：
 * - 扫描 `flow.call_definition` 节点，构建被调用方 release 的依赖闭包（transitive）
 * - 校验依赖存在且已发布、无循环引用、exposeOutputs 与 callee.outputs 的 key/type 对齐
 * - 产出 Runner 可用的 `definitionBundle`（Runner 运行期不做 DB/IO）
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ValueType } from '../catalog/node-catalog.types';
import type { DefinitionRelease } from '../../domain/definition/definition';
import type { GraphJsonV1 } from '../validation/graph-json.types';
import type { ValidationIssue } from '../validation/validation-issue';
import { UseCaseError } from '../use-cases/use-case.error';
import {
  DEFINITION_RELEASE_REPOSITORY,
  type DefinitionReleaseRepositoryPort,
} from '../ports/definition-release-repository.port';
import type { RunnerDefinitionBundleItem } from '../ports/runner.port';
import { isPlainObject } from '../hashing/canonicalize';

type ExposeKey =
  | 'decimal'
  | 'ratio'
  | 'string'
  | 'boolean'
  | 'datetime'
  | 'json';

const EXPOSE_KEY_TO_VALUE_TYPE: Record<ExposeKey, ValueType> = {
  decimal: 'Decimal',
  ratio: 'Ratio',
  string: 'String',
  boolean: 'Boolean',
  datetime: 'DateTime',
  json: 'Json',
};

type CallNodeRef = {
  nodeId: string;
  nodeIndex: number;
  definitionId: string;
  definitionHash: string;
  entrypointKey?: string;
  exposeOutputs: Partial<Record<ExposeKey, string[]>>;
};

@Injectable()
export class DefinitionDependenciesService {
  constructor(
    @Inject(DEFINITION_RELEASE_REPOSITORY)
    private readonly releaseRepository: DefinitionReleaseRepositoryPort,
  ) {}

  /**
   * 构建 Runner 需要的依赖 bundle（transitive closure），并校验：
   * - 依赖 release 存在且已发布
   * - 依赖调用不存在循环
   * - exposeOutputs 配置的 key/valueType 与 callee.outputs 匹配
   */
  async buildRunnerBundle(params: {
    rootContent: Record<string, unknown>;
    rootRef?: { definitionId: string; definitionHash: string };
  }): Promise<{ bundle: RunnerDefinitionBundleItem[] }> {
    const rootGraph = params.rootContent as unknown as GraphJsonV1;
    const rootKey = params.rootRef
      ? `${params.rootRef.definitionId}@${params.rootRef.definitionHash}`
      : null;

    const releaseByKey = new Map<string, DefinitionRelease>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const loadReleaseOrThrow = async (
      definitionId: string,
      definitionHash: string,
      context?: { nodeId?: string; nodeIndex?: number },
    ): Promise<DefinitionRelease> => {
      const key = `${definitionId}@${definitionHash}`;
      const cached = releaseByKey.get(key);
      if (cached) {
        return cached;
      }

      const found = await this.releaseRepository.getRelease(
        definitionId,
        definitionHash,
      );
      if (!found) {
        throw new UseCaseError(
          'DEFINITION_DEPENDENCY_NOT_FOUND',
          `dependency not found: ${key}`,
          {
            definitionId,
            definitionHash,
            nodeId: context?.nodeId,
            nodeIndex: context?.nodeIndex,
          },
        );
      }
      if (found.status !== 'published') {
        throw new UseCaseError(
          'DEFINITION_DEPENDENCY_NOT_PUBLISHED',
          `dependency is not published: ${key}`,
          {
            definitionId,
            definitionHash,
            status: found.status,
            nodeId: context?.nodeId,
            nodeIndex: context?.nodeIndex,
          },
        );
      }

      releaseByKey.set(key, found);
      return found;
    };

    const validateExposeOutputs = (
      callNode: CallNodeRef,
      calleeGraph: GraphJsonV1,
    ): ValidationIssue[] => {
      const outputTypeByKey = new Map<string, ValueType>();
      for (const output of calleeGraph.outputs ?? []) {
        outputTypeByKey.set(output.key, output.valueType);
      }

      const issues: ValidationIssue[] = [];

      for (const exposeKey of Object.keys(
        EXPOSE_KEY_TO_VALUE_TYPE,
      ) as ExposeKey[]) {
        const requested = callNode.exposeOutputs[exposeKey];
        if (!requested || requested.length === 0) {
          continue;
        }

        const expectedType = EXPOSE_KEY_TO_VALUE_TYPE[exposeKey];
        for (let i = 0; i < requested.length; i++) {
          const outputKey = requested[i];
          if (!outputKey) {
            continue;
          }

          const actual = outputTypeByKey.get(outputKey);
          const pointer = `/nodes/${callNode.nodeIndex}/params/exposeOutputs/${exposeKey}/${i}`;
          if (!actual) {
            issues.push({
              code: 'GRAPH_CALL_DEFINITION_OUTPUT_NOT_FOUND',
              severity: 'error',
              path: pointer,
              message: `callee output is not declared: ${callNode.definitionId}@${callNode.definitionHash} outputs.${outputKey}`,
            });
            continue;
          }
          if (actual !== expectedType) {
            issues.push({
              code: 'GRAPH_CALL_DEFINITION_OUTPUT_TYPE_MISMATCH',
              severity: 'error',
              path: pointer,
              message: `callee output type mismatch: ${actual} -> ${expectedType} for outputs.${outputKey}`,
            });
          }
        }
      }

      return issues;
    };

    const visitRelease = async (
      definitionId: string,
      definitionHash: string,
      path: string[],
      context?: { nodeId?: string; nodeIndex?: number },
    ) => {
      const key = `${definitionId}@${definitionHash}`;
      if (visiting.has(key)) {
        throw new UseCaseError(
          'DEFINITION_DEPENDENCY_CYCLE',
          `dependency cycle detected: ${[...path, key].join(' -> ')}`,
          {
            cycle: [...path, key],
            nodeId: context?.nodeId,
            nodeIndex: context?.nodeIndex,
          },
        );
      }
      if (visited.has(key)) {
        return;
      }

      visiting.add(key);
      const release = await loadReleaseOrThrow(
        definitionId,
        definitionHash,
        context,
      );
      const graph = release.content as unknown as GraphJsonV1;

      for (const callNode of collectCallDefinitionNodes(graph)) {
        const callee = await loadReleaseOrThrow(
          callNode.definitionId,
          callNode.definitionHash,
          {
            nodeId: callNode.nodeId,
            nodeIndex: callNode.nodeIndex,
          },
        );

        const issues = validateExposeOutputs(
          callNode,
          callee.content as unknown as GraphJsonV1,
        );
        if (issues.length > 0) {
          throw new UseCaseError(
            'DEFINITION_INVALID',
            'definition validation failed',
            issues,
          );
        }

        await visitRelease(
          callNode.definitionId,
          callNode.definitionHash,
          [...path, key],
          {
            nodeId: callNode.nodeId,
            nodeIndex: callNode.nodeIndex,
          },
        );
      }

      visiting.delete(key);
      visited.add(key);
    };

    // 先校验 root 的 call nodes（root 可能是 inline definition）
    for (const callNode of collectCallDefinitionNodes(rootGraph)) {
      // rootRef 存在时，禁止 root 直接引用自己（会被 cycle 检测兜底）
      if (
        rootKey &&
        `${callNode.definitionId}@${callNode.definitionHash}` === rootKey
      ) {
        throw new UseCaseError(
          'DEFINITION_DEPENDENCY_CYCLE',
          `dependency cycle detected: ${rootKey} -> ${rootKey}`,
          {
            cycle: [rootKey, rootKey],
            nodeId: callNode.nodeId,
            nodeIndex: callNode.nodeIndex,
          },
        );
      }

      const callee = await loadReleaseOrThrow(
        callNode.definitionId,
        callNode.definitionHash,
        { nodeId: callNode.nodeId, nodeIndex: callNode.nodeIndex },
      );
      const issues = validateExposeOutputs(
        callNode,
        callee.content as unknown as GraphJsonV1,
      );
      if (issues.length > 0) {
        throw new UseCaseError(
          'DEFINITION_INVALID',
          'definition validation failed',
          issues,
        );
      }

      await visitRelease(
        callNode.definitionId,
        callNode.definitionHash,
        rootKey ? [rootKey] : [],
      );
    }

    const keys = [...releaseByKey.keys()].sort((a, b) => a.localeCompare(b));
    const bundle: RunnerDefinitionBundleItem[] = keys
      .filter((key) => key !== rootKey)
      .map((key) => {
        const release = releaseByKey.get(key);
        if (!release) {
          throw new Error(`missing cached release: ${key}`);
        }
        return {
          definitionId: release.definitionId,
          definitionHash: release.definitionHash,
          content: release.content,
          runnerConfig: release.runnerConfig,
          outputSchema: release.outputSchema,
        };
      });

    return { bundle };
  }
}

function collectCallDefinitionNodes(graph: GraphJsonV1): CallNodeRef[] {
  const result: CallNodeRef[] = [];

  for (let i = 0; i < (graph.nodes ?? []).length; i++) {
    const node = graph.nodes[i];
    if (!node || node.nodeType !== 'flow.call_definition') {
      continue;
    }

    if (!isPlainObject(node.params)) {
      continue;
    }

    const definitionId = node.params['definitionId'];
    const definitionHash = node.params['definitionHash'];
    const entrypointKey = node.params['entrypointKey'];

    if (
      typeof definitionId !== 'string' ||
      typeof definitionHash !== 'string'
    ) {
      continue;
    }

    const exposeOutputs: Partial<Record<ExposeKey, string[]>> = {};
    const exposeValue = node.params['exposeOutputs'];
    if (isPlainObject(exposeValue)) {
      for (const key of Object.keys(EXPOSE_KEY_TO_VALUE_TYPE) as ExposeKey[]) {
        const list = exposeValue[key];
        if (
          Array.isArray(list) &&
          list.every((v): v is string => typeof v === 'string')
        ) {
          exposeOutputs[key] = list;
        }
      }
    }

    result.push({
      nodeId: node.id,
      nodeIndex: i,
      definitionId,
      definitionHash,
      entrypointKey:
        typeof entrypointKey === 'string' ? entrypointKey : undefined,
      exposeOutputs,
    });
  }

  return result;
}
