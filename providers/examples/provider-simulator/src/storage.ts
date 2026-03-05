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

export type StorageOptions = {
  /**
   * 将多次更新合并为一次落盘的时间窗（ms）。
   * - 越大：吞吐越高、但崩溃时丢失的“本地视图”越多
   * - 越小：更接近“每次写盘”的一致性，但吞吐更差
   */
  flushIntervalMs?: number;
  /** 是否输出可读的 pretty JSON（更慢，默认 false） */
  prettyJson?: boolean;
};

export class Storage {
  private data: StorageData = defaultData();

  private readonly flushIntervalMs: number;
  private readonly prettyJson: boolean;

  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;
  private flushRequestedWhileInFlight = false;

  constructor(
    private readonly path: string,
    options?: StorageOptions,
  ) {
    const interval = Number(options?.flushIntervalMs ?? 200);
    this.flushIntervalMs = Number.isFinite(interval) && interval >= 10 ? interval : 200;
    this.prettyJson = options?.prettyJson === true;
  }

  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') {
        this.data = parsed as StorageData;
      }
    } catch {
      // 文件不存在或解析失败：写入一个最小初始文件，避免后续读失败。
      this.dirty = true;
      await this.flushNow();
    }
  }

  /**
   * 立即落盘（用于 shutdown/异常退出前的尽力持久化）。
   * 会等待正在进行的 flush，并在必要时补一次 flush，直到数据稳定。
   */
  async flushNow() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 等待 in-flight flush，并在 dirty 时补写，直到无脏数据。
    while (true) {
      if (this.flushInFlight) {
        await this.flushInFlight;
      }
      if (!this.dirty) {
        return;
      }
      this.dirty = false;

      const p = this.flushInternal();
      this.flushInFlight = p;
      try {
        await p;
      } finally {
        this.flushInFlight = null;
      }
    }
  }

  /** 标记脏并按时间窗合并落盘（高吞吐路径）。 */
  scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushDebounced();
    }, this.flushIntervalMs);
  }

  private async flushDebounced() {
    if (this.flushInFlight) {
      this.flushRequestedWhileInFlight = true;
      return;
    }
    if (!this.dirty) {
      return;
    }
    this.dirty = false;

    const p = this.flushInternal();
    this.flushInFlight = p;
    try {
      await p;
    } finally {
      this.flushInFlight = null;
    }

    if (this.flushRequestedWhileInFlight || this.dirty) {
      this.flushRequestedWhileInFlight = false;
      this.scheduleFlush();
    }
  }

  private async flushInternal() {
    const startedAt = Date.now();
    this.data.updatedAt = nowIso();
    const json = this.prettyJson
      ? JSON.stringify(this.data, null, 2)
      : JSON.stringify(this.data);
    await writeFile(this.path, json, 'utf8');

    const durationMs = Date.now() - startedAt;
    if (durationMs >= 200) {
      // eslint-disable-next-line no-console
      console.warn(
        `[provider-simulator] storage flush slow: durationMs=${durationMs} bytes=${json.length}`,
      );
    }
  }

  getGlobalFacts() {
    return this.data.globalFacts ?? {};
  }

  async setGlobalFacts(next: Record<string, unknown>) {
    this.data.globalFacts = next;
    this.scheduleFlush();
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
    this.scheduleFlush();
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

    this.scheduleFlush();
  }
}

