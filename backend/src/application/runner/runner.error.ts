/**
 * Runner 错误类型。
 *
 * 说明：Runner 错误会被上层 use-case 转换为 job.failed / HTTP 错误码。
 * - `RUNNER_TIMEOUT`：资源限制触发（可重试）
 * - `RUNNER_DETERMINISTIC_ERROR`：确定性错误（通常不可重试）
 */
export class RunnerExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
