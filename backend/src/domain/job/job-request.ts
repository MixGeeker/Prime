/**
 * MQ command `compute.job.requested.v1` 的 payload 结构。
 *
 * 参考：`compute-engine/API_DESIGN.md` 2.1
 */
export interface ComputeJobRequestedV1 {
  schemaVersion: 1;
  jobId: string;
  definitionRef: {
    definitionId: string;
    definitionHash: string;
  };
  entrypointKey?: string;
  inputs: Record<string, unknown>;
  options?: Record<string, unknown>;
}
