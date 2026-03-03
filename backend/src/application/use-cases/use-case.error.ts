/**
 * UseCaseError：应用层的“可预期业务错误”。
 *
 * 说明：
 * - 由 controller / MQ handler 映射为 HTTP 状态码或 job.failed 错误码
 * - 与程序 bug（INTERNAL_ERROR）区分，便于重试策略与告警治理
 */
export class UseCaseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
