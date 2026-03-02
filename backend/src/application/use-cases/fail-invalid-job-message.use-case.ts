import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { jcsCanonicalize } from '../hashing/jcs';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '../ports/unit-of-work.port';

export interface FailInvalidJobMessageCommand {
  messageId?: string;
  correlationId?: string;
  jobId: string;
  definitionRef: {
    definitionId: string;
    version: number;
  };
  rawPayload: unknown;
  reason: string;
  details?: unknown;
}

export type FailInvalidJobMessageResult =
  | {
      kind: 'duplicate' | 'conflict';
      jobId: string;
      requestHash: string;
      outboxEventId: null;
    }
  | {
      kind: 'failed';
      jobId: string;
      requestHash: string;
      outboxEventId: string;
    };

@Injectable()
export class FailInvalidJobMessageUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(
    command: FailInvalidJobMessageCommand,
  ): Promise<FailInvalidJobMessageResult> {
    const requestHash = sha256Hex(jcsCanonicalize(command.rawPayload));
    const outboxEventId = randomUUID();

    const result = await this.unitOfWork.runInTransaction(
      async ({ jobRepo, outboxRepo }) => {
        const insertResult = await jobRepo.tryInsertRequested({
          jobId: command.jobId,
          requestHash,
          messageId: command.messageId ?? null,
          correlationId: command.correlationId ?? null,
          definitionId: command.definitionRef.definitionId,
          versionUsed: command.definitionRef.version,
        });

        if (insertResult.kind !== 'inserted') {
          return { kind: insertResult.kind };
        }

        const failedAt = new Date();
        await jobRepo.markFailed({
          jobId: command.jobId,
          definitionHash: null,
          inputsHash: null,
          errorCode: 'INVALID_MESSAGE',
          errorMessage: command.reason,
          failedAt,
        });

        await outboxRepo.enqueue({
          id: outboxEventId,
          eventType: 'compute.job.failed.v1',
          routingKey: 'compute.job.failed.v1',
          payload: {
            schemaVersion: 1,
            jobId: command.jobId,
            definitionRefUsed: command.definitionRef,
            error: {
              code: 'INVALID_MESSAGE',
              message: command.reason,
              details: command.details,
            },
            retryable: false,
            failedAt: failedAt.toISOString(),
          },
          headers: {
            messageId: command.messageId ?? null,
            correlationId: command.correlationId ?? null,
          },
        });

        return { kind: 'failed' as const };
      },
    );

    if (result.kind === 'duplicate' || result.kind === 'conflict') {
      return {
        kind: result.kind,
        jobId: command.jobId,
        requestHash,
        outboxEventId: null,
      };
    }

    return {
      kind: 'failed',
      jobId: command.jobId,
      requestHash,
      outboxEventId,
    };
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
