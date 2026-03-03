import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StorageData, StoredJob } from './types';

function nowIso() {
  return new Date().toISOString();
}

function defaultData(): StorageData {
  return {
    schemaVersion: 1,
    updatedAt: nowIso(),
    globalFacts: {},
    jobs: {},
    processedEventMessageIds: {},
  };
}

export class Storage {
  private data: StorageData = defaultData();

  constructor(private readonly path: string) {}

  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') {
        this.data = parsed as StorageData;
      }
    } catch {
      await this.flush();
    }
  }

  async flush() {
    this.data.updatedAt = nowIso();
    await writeFile(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getGlobalFacts() {
    return this.data.globalFacts ?? {};
  }

  async setGlobalFacts(next: Record<string, unknown>) {
    this.data.globalFacts = next;
    await this.flush();
  }

  listJobs(limit: number): StoredJob[] {
    const items = Object.values(this.data.jobs ?? {});
    return items
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit);
  }

  getJob(jobId: string): StoredJob | null {
    return this.data.jobs?.[jobId] ?? null;
  }

  async upsertJob(job: StoredJob) {
    this.data.jobs[job.jobId] = job;
    await this.flush();
  }

  hasProcessedEvent(messageId: string): boolean {
    return Boolean(this.data.processedEventMessageIds?.[messageId]);
  }

  async markEventProcessed(messageId: string) {
    this.data.processedEventMessageIds[messageId] = true;

    // 简单的去重集合膨胀控制：超过 20k 时丢弃最早的一半（MVP 够用）。
    const keys = Object.keys(this.data.processedEventMessageIds);
    if (keys.length > 20_000) {
      const drop = keys.sort().slice(0, Math.floor(keys.length / 2));
      for (const k of drop) delete this.data.processedEventMessageIds[k];
    }

    await this.flush();
  }
}

