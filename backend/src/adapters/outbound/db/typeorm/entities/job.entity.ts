import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * jobs 表：幂等存根 +（可选）结果存档。
 *
 * 设计要点：
 * - `job_id` 必须全局唯一，用于引擎幂等（重复投递不重复执行）
 * - `request_hash` 用于检测“同 jobId 不同 payload”的冲突
 * - inputs/outputs 快照字段保留为 nullable；MVP 可先不存，后续按审计需求开启
 */
@Entity({ name: 'jobs' })
export class JobEntity {
  @PrimaryColumn({ name: 'job_id', type: 'text' })
  jobId!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'message_id', type: 'text', nullable: true })
  messageId!: string | null;

  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId!: string | null;

  @Column({ name: 'definition_id', type: 'text' })
  definitionId!: string;

  @Column({ name: 'version_used', type: 'int' })
  versionUsed!: number;

  @Column({ name: 'definition_hash', type: 'text', nullable: true })
  definitionHash!: string | null;

  @Column({ name: 'inputs_hash', type: 'text', nullable: true })
  inputsHash!: string | null;

  @Column({ name: 'outputs_hash', type: 'text', nullable: true })
  outputsHash!: string | null;

  @Column({ name: 'status', type: 'text' })
  status!: string;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'computed_at', type: 'timestamptz', nullable: true })
  computedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'inputs_snapshot_json', type: 'jsonb', nullable: true })
  inputsSnapshotJson!: Record<string, unknown> | null;

  @Column({ name: 'outputs_json', type: 'jsonb', nullable: true })
  outputsJson!: Record<string, unknown> | null;

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
