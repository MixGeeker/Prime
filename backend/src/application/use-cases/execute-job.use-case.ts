import { Inject, Injectable } from '@nestjs/common';
import type { ComputeJobRequestedV1 } from '../../domain/job/job-request';
import { computeJobRequestHash } from '../../domain/job/request-hash';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '../ports/unit-of-work.port';

/**
 * ExecuteJob 用例（M1 版本：先落幂等存根）。
 *
 * 目标：
 * - 基于 `jobId` 幂等：重复投递不重复执行
 * - 用 `requestHash` 检测“同 jobId 不同 payload”的冲突
 *
 * 说明：
 * - 真正的计算链路（读取 DefinitionVersion / inputs 校验与规范化 / runner / outbox 发布结果）
 *   将在 M5/M6 逐步补齐
 */
export interface ExecuteJobCommand {
  messageId?: string;
  correlationId?: string;
  payload: ComputeJobRequestedV1;
}

export type ExecuteJobResult = {
  kind: 'inserted' | 'duplicate' | 'conflict';
  jobId: string;
  requestHash: string;
};

@Injectable()
export class ExecuteJobUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: ExecuteJobCommand): Promise<ExecuteJobResult> {
    // requestHash 只基于业务 payload（不含 messageId/correlationId），用于去重与冲突检测。
    const requestHash = computeJobRequestHash(command.payload);

    const { kind } = await this.unitOfWork.runInTransaction(({ jobRepo }) =>
      jobRepo.tryInsertRequested({
        jobId: command.payload.jobId,
        requestHash,
        messageId: command.messageId ?? null,
        correlationId: command.correlationId ?? null,
        definitionId: command.payload.definitionRef.definitionId,
        versionUsed: command.payload.definitionRef.version,
      }),
    );

    return { kind, jobId: command.payload.jobId, requestHash };
  }
}
