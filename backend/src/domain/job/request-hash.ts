import { createHash } from 'crypto';
import { stableJsonStringify } from '../../shared/stable-json-stringify';
import type { ComputeJobRequestedV1 } from './job-request';

/**
 * 计算 `jobs.request_hash`：
 * - 目的：检测“同 jobId 不同 payload”的冲突（生产端 bug）
 * - 约定：只基于业务 payload（不包含 messageId/correlationId 等追踪字段）
 *
 * 默认实现：
 * - 使用“稳定 JSON 串”（键排序、去除 undefined）后做 sha256
 * - 这不是完整 RFC 8785 JCS；M3 会补齐 hashing/canonicalize 的正式实现
 */
export function computeJobRequestHash(payload: ComputeJobRequestedV1): string {
  const canonical = stableJsonStringify({
    schemaVersion: payload.schemaVersion,
    jobId: payload.jobId,
    definitionRef: payload.definitionRef,
    entrypointKey: payload.entrypointKey,
    inputs: payload.inputs,
    options: payload.options,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
