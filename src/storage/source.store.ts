import { CanonicalDocument } from '../contracts/canonical.contract.js';
import { LIMITS } from '../config/limits.js';
import { persistenceRepo, PersistedSourceMetadata } from './persistence.repository.js';

interface StoredSourceEntry {
  document: CanonicalDocument;
  ownerUserId: string | null;
  createdAt: number;
  lastAccessedAt: number;
}

export class SourceStore {
  private entries: Map<string, StoredSourceEntry> = new Map();
  private ttlMs: number = LIMITS.STORE_TTL_MS;
  private maxEntries: number = LIMITS.MAX_STORED_SOURCES;
  private cleanupTimer: NodeJS.Timeout | null = null;

  public configure(options: { ttlMs?: number; maxEntries?: number }): void {
    if (options.ttlMs !== undefined && options.ttlMs > 0) {
      this.ttlMs = options.ttlMs;
    }
    if (options.maxEntries !== undefined && options.maxEntries > 0) {
      this.maxEntries = options.maxEntries;
    }
  }

  public startCleanupTimer(intervalMs: number = LIMITS.STORE_CLEANUP_INTERVAL_MS): void {
    if (this.cleanupTimer) {
      return;
    }
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, intervalMs);
    this.cleanupTimer.unref();
  }

  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public cleanupExpired(now: number = Date.now(), ttlMs: number = this.ttlMs): number {
    let cleaned = 0;
    for (const [sourceId, entry] of this.entries.entries()) {
      if (now - entry.lastAccessedAt > ttlMs) {
        this.entries.delete(sourceId);
        cleaned++;
      }
    }
    return cleaned;
  }

  public save(
    document: CanonicalDocument,
    now: number = Date.now(),
    ownerUserId?: string | null
  ): void {
    this.cleanupExpired(now);

    if (!this.entries.has(document.sourceId) && this.entries.size >= this.maxEntries) {
      // Evict least-recently accessed source
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.entries.entries()) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    const existing = this.entries.get(document.sourceId);
    const resolvedOwner =
      ownerUserId !== undefined ? ownerUserId : existing ? existing.ownerUserId : null;

    this.entries.set(document.sourceId, {
      document,
      ownerUserId: resolvedOwner ?? null,
      createdAt: now,
      lastAccessedAt: now,
    });

    persistenceRepo.saveSourceMetadata(document, resolvedOwner);
  }

  public get(sourceId: string, now: number = Date.now()): CanonicalDocument | undefined {
    const entry = this.entries.get(sourceId);
    if (!entry) {
      return undefined;
    }
    if (now - entry.lastAccessedAt > this.ttlMs) {
      this.entries.delete(sourceId);
      return undefined;
    }
    entry.lastAccessedAt = now;
    return entry.document;
  }

  public getOwnerUserId(sourceId: string): string | null | undefined {
    const entry = this.entries.get(sourceId);
    if (entry) {
      return entry.ownerUserId;
    }
    const meta = persistenceRepo.getSourceMetadata(sourceId);
    return meta ? meta.ownerUserId : undefined;
  }

  public getMetadata(sourceId: string): PersistedSourceMetadata | undefined {
    return persistenceRepo.getSourceMetadata(sourceId);
  }

  public getAll(now: number = Date.now()): CanonicalDocument[] {
    this.cleanupExpired(now);
    return Array.from(this.entries.values()).map(e => e.document);
  }

  public getMany(sourceIds: string[], now: number = Date.now()): CanonicalDocument[] {
    const found: CanonicalDocument[] = [];
    for (const id of sourceIds) {
      const doc = this.get(id, now);
      if (doc) {
        found.push(doc);
      }
    }
    return found;
  }

  public count(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }
}

export const sourceStore = new SourceStore();
sourceStore.startCleanupTimer();


