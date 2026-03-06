import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DedupeStore } from './types.js';

export class MemoryDedupeStore implements DedupeStore {
  private readonly seen = new Set<string>();

  async has(messageId: string): Promise<boolean> {
    return this.seen.has(messageId);
  }

  async mark(messageId: string): Promise<void> {
    this.seen.add(messageId);
  }
}

export class JsonFileDedupeStore implements DedupeStore {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private initialized = false;

  constructor(
    private readonly path: string,
    private readonly options?: { maxEntries?: number },
  ) {}

  async has(messageId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.seen.has(messageId);
  }

  async mark(messageId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.seen.has(messageId)) return;

    this.seen.add(messageId);
    this.order.push(messageId);

    const maxEntries = this.options?.maxEntries ?? 20_000;
    while (this.order.length > maxEntries) {
      const dropped = this.order.shift();
      if (dropped) {
        this.seen.delete(dropped);
      }
    }

    await this.flush();
  }

  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.flush();
  }

  private async ensureLoaded() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as { messageIds?: unknown };
      const items = Array.isArray(parsed.messageIds) ? parsed.messageIds : [];
      for (const item of items) {
        if (typeof item !== 'string' || this.seen.has(item)) continue;
        this.seen.add(item);
        this.order.push(item);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async flush() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      JSON.stringify({ schemaVersion: 1, messageIds: this.order }, null, 2),
      'utf8',
    );
  }
}
