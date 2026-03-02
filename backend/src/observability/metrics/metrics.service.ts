import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

type OutboxPublishResult = 'sent' | 'failed';
type JobRequestedResult = 'ack' | 'reject_dlq' | 'nack_requeue';
type JobProcessedStatus = 'succeeded' | 'failed' | 'duplicate' | 'conflict';
type JobExecutionStatus = 'succeeded' | 'failed';
type RetentionTable = 'outbox' | 'drafts' | 'jobs';
type RetentionAction = 'delete' | 'nullify_snapshots';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly outboxPublishTotal: Counter<'result'>;
  private readonly outboxPublishDuration: Histogram;
  private readonly outboxLeasedTotal: Counter;
  private readonly outboxPendingGauge: Gauge;
  private readonly outboxFailedGauge: Gauge;

  private readonly jobRequestedTotal: Counter<'result'>;
  private readonly jobProcessedTotal: Counter<'status'>;
  private readonly jobFailedTotal: Counter<'error_code'>;
  private readonly jobExecutionDuration: Histogram<'status'>;

  private readonly retentionTotal: Counter<'table' | 'action'>;

  constructor(private readonly configService: ConfigService) {
    const enabled = this.configService.get<boolean>('METRICS_ENABLED') ?? true;
    const collectDefault =
      this.configService.get<boolean>('METRICS_COLLECT_DEFAULT') ?? true;

    if (enabled && collectDefault) {
      collectDefaultMetrics({
        register: this.registry,
      });
    }

    this.outboxPublishTotal = new Counter({
      name: 'compute_outbox_publish_total',
      help: 'Outbox publish attempts by result.',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.outboxPublishDuration = new Histogram({
      name: 'compute_outbox_publish_duration_seconds',
      help: 'Outbox publish+confirm duration in seconds.',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.outboxLeasedTotal = new Counter({
      name: 'compute_outbox_batch_leased_total',
      help: 'Total outbox records leased by dispatcher.',
      registers: [this.registry],
    });
    this.outboxPendingGauge = new Gauge({
      name: 'compute_outbox_pending_gauge',
      help: 'Count of outbox records in pending status.',
      registers: [this.registry],
    });
    this.outboxFailedGauge = new Gauge({
      name: 'compute_outbox_failed_gauge',
      help: 'Count of outbox records in failed status (attempts below max).',
      registers: [this.registry],
    });

    this.jobRequestedTotal = new Counter({
      name: 'compute_job_requested_total',
      help: 'Job requested messages handling result.',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.jobProcessedTotal = new Counter({
      name: 'compute_job_processed_total',
      help: 'Job processing result by status.',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.jobFailedTotal = new Counter({
      name: 'compute_job_failed_total',
      help: 'Job failed count by error code.',
      labelNames: ['error_code'],
      registers: [this.registry],
    });
    this.jobExecutionDuration = new Histogram({
      name: 'compute_job_execution_duration_seconds',
      help: 'ExecuteJob duration in seconds.',
      labelNames: ['status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.retentionTotal = new Counter({
      name: 'compute_retention_total',
      help: 'Retention cleaner operations count by table/action.',
      labelNames: ['table', 'action'],
      registers: [this.registry],
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  incOutboxPublish(result: OutboxPublishResult) {
    this.outboxPublishTotal.inc({ result }, 1);
  }

  observeOutboxPublishDuration(durationSeconds: number) {
    this.outboxPublishDuration.observe(durationSeconds);
  }

  addOutboxLeased(count: number) {
    if (count > 0) {
      this.outboxLeasedTotal.inc(count);
    }
  }

  setOutboxPending(count: number) {
    this.outboxPendingGauge.set(Math.max(0, count));
  }

  setOutboxFailed(count: number) {
    this.outboxFailedGauge.set(Math.max(0, count));
  }

  incJobRequested(result: JobRequestedResult) {
    this.jobRequestedTotal.inc({ result }, 1);
  }

  incJobProcessed(status: JobProcessedStatus) {
    this.jobProcessedTotal.inc({ status }, 1);
  }

  incJobFailed(errorCode: string) {
    this.jobFailedTotal.inc({ error_code: errorCode }, 1);
  }

  observeJobExecutionDuration(
    status: JobExecutionStatus,
    durationSeconds: number,
  ) {
    this.jobExecutionDuration.observe({ status }, durationSeconds);
  }

  incRetention(table: RetentionTable, action: RetentionAction, count: number) {
    if (count > 0) {
      this.retentionTotal.inc({ table, action }, count);
    }
  }
}
