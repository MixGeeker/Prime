import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MetricsService } from '../../observability/metrics/metrics.service';
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '../../application/ports/unit-of-work.port';

@Injectable()
export class RetentionCleanerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCleanerService.name);
  private running = false;
  private readonly cronName = 'retention-cleaner';

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit() {
    const roles = parseWorkerRoles(
      this.configService.get<string>('WORKER_ROLES') ?? 'consumer,dispatcher',
    );
    if (!roles.has('maintenance')) {
      return;
    }

    const enabled =
      this.configService.get<boolean>('RETENTION_CLEANER_ENABLED') ?? true;
    if (!enabled) {
      this.logger.log('Retention cleaner disabled by env.');
      return;
    }

    const cron =
      this.configService.get<string>('RETENTION_CLEANER_CRON') ??
      '0 */10 * * * *';
    const job = new CronJob(cron, () => void this.runOnce());
    this.schedulerRegistry.addCronJob(this.cronName, job);
    job.start();

    this.logger.log(`Retention cleaner started: cron=${cron}`);
  }

  async onModuleDestroy() {
    try {
      const job = this.schedulerRegistry.getCronJob(this.cronName);
      await job.stop();
      this.schedulerRegistry.deleteCronJob(this.cronName);
    } catch {
      // ignore
    }
  }

  private async runOnce() {
    if (this.running) {
      this.logger.warn('Retention cleaner is already running; skip.');
      return;
    }
    this.running = true;

    const startedAt = process.hrtime.bigint();
    try {
      const now = new Date();
      const batchSize =
        this.configService.get<number>('RETENTION_BATCH_SIZE') ?? 500;

      const outboxSentTtlDays =
        this.configService.get<number>('OUTBOX_SENT_TTL_DAYS') ?? 30;
      const jobsSnapshotTtlDays =
        this.configService.get<number>('JOBS_SNAPSHOT_TTL_DAYS') ?? 180;
      const draftTtlDays =
        this.configService.get<number>('DRAFT_TTL_DAYS') ?? 30;

      const outboxCutoff = addDays(now, -outboxSentTtlDays);
      const jobsCutoff = addDays(now, -jobsSnapshotTtlDays);
      const draftsCutoff = addDays(now, -draftTtlDays);

      const deletedOutbox = await this.deleteOutboxSentOlderThan(
        outboxCutoff,
        batchSize,
      );
      const clearedJobs = await this.clearJobSnapshotsOlderThan(
        jobsCutoff,
        batchSize,
      );
      const deletedDrafts = await this.deleteDraftsOlderThan(
        draftsCutoff,
        batchSize,
      );

      this.metricsService.incRetention('outbox', 'delete', deletedOutbox);
      this.metricsService.incRetention(
        'jobs',
        'nullify_snapshots',
        clearedJobs,
      );
      this.metricsService.incRetention('drafts', 'delete', deletedDrafts);

      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.logger.log(
        `Retention cleaner batch done: outboxDeleted=${deletedOutbox} jobsCleared=${clearedJobs} draftsDeleted=${deletedDrafts} durationMs=${Math.round(durationMs)}`,
      );
    } catch (error) {
      this.logger.error(`Retention cleaner failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async deleteOutboxSentOlderThan(cutoff: Date, limit: number) {
    return this.unitOfWork.runInTransaction(async ({ outboxRepo }) =>
      outboxRepo.deleteSentOlderThan({ cutoff, limit }),
    );
  }

  private async clearJobSnapshotsOlderThan(cutoff: Date, limit: number) {
    return this.unitOfWork.runInTransaction(async ({ jobRepo }) =>
      jobRepo.clearSnapshotsOlderThan({ cutoff, limit }),
    );
  }

  private async deleteDraftsOlderThan(cutoff: Date, limit: number) {
    return this.unitOfWork.runInTransaction(async ({ draftRepo }) =>
      draftRepo.deleteOlderThan({ cutoff, limit }),
    );
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseWorkerRoles(
  value: string,
): Set<'consumer' | 'dispatcher' | 'maintenance'> {
  const roles = new Set<'consumer' | 'dispatcher' | 'maintenance'>();
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (
      part === 'consumer' ||
      part === 'dispatcher' ||
      part === 'maintenance'
    ) {
      roles.add(part);
    }
  }

  if (roles.size === 0) {
    roles.add('consumer');
  }

  return roles;
}
