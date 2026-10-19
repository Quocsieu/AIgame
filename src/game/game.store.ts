import { LIMITS } from '../config/limits.js';
import { GameSpecification } from '../contracts/game.contract.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';
import type { GameSession } from './game.session.js';

interface StoredSpecEntry {
  spec: GameSpecification;
  createdAt: number;
  lastAccessedAt: number;
}

interface StoredSessionEntry {
  session: GameSession;
  createdAt: number;
  updatedAt: number;
}

export class GameSessionStore {
  private entries: Map<string, StoredSessionEntry> = new Map();
  private ttlMs: number = LIMITS.STORE_TTL_MS;
  private maxEntries: number = LIMITS.MAX_STORED_SESSIONS;
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

  public isSessionActive(session: GameSession): boolean {
    return (
      session.state === 'IN_PROGRESS' ||
      session.state === 'QUESTION_ACTIVE' ||
      session.state === 'QUESTION_ANSWERED'
    );
  }

  public countActiveSessionsForUser(userId: string, now: number = Date.now()): number {
    let activeCount = 0;
    for (const entry of this.entries.values()) {
      if (
        entry.session.ownerUserId === userId &&
        entry.session.state !== 'FINISHED' &&
        entry.session.state !== 'ABANDONED' &&
        now - entry.updatedAt <= this.ttlMs
      ) {
        activeCount++;
      }
    }
    return activeCount;
  }

  public hasActiveSessionForGame(gameId: string, now: number = Date.now()): boolean {
    for (const entry of this.entries.values()) {
      if (
        entry.session.specification.gameId === gameId &&
        this.isSessionActive(entry.session) &&
        now - entry.updatedAt <= this.ttlMs
      ) {
        return true;
      }
    }
    return false;
  }

  public cleanupExpired(now: number = Date.now(), ttlMs: number = this.ttlMs): number {
    let cleaned = 0;
    for (const [sessionId, entry] of this.entries.entries()) {
      if (now - entry.updatedAt > ttlMs) {
        this.entries.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }

  public save(session: GameSession, now: number = Date.now()): void {
    this.cleanupExpired(now);

    if (!this.entries.has(session.sessionId) && this.entries.size >= this.maxEntries) {
      // Find oldest inactive session (FINISHED, ABANDONED, or NOT_STARTED)
      let evictKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.entries.entries()) {
        if (!this.isSessionActive(entry.session) && entry.updatedAt < oldestTime) {
          oldestTime = entry.updatedAt;
          evictKey = key;
        }
      }

      if (evictKey) {
        this.entries.delete(evictKey);
      } else {
        throw new AppError(
          'STORE_CAPACITY_EXCEEDED',
          'Maximum number of active game sessions reached. Please try again later.',
          503
        );
      }
    }

    const existing = this.entries.get(session.sessionId);
    this.entries.set(session.sessionId, {
      session,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    });
  }

  public get(sessionId: string, now: number = Date.now()): GameSession | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return undefined;
    }
    if (now - entry.updatedAt > this.ttlMs) {
      this.entries.delete(sessionId);
      return undefined;
    }
    entry.updatedAt = now;
    return entry.session;
  }

  public has(sessionId: string, now: number = Date.now()): boolean {
    return this.get(sessionId, now) !== undefined;
  }

  public delete(sessionId: string): boolean {
    return this.entries.delete(sessionId);
  }

  public count(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }
}

export const sessionStore = new GameSessionStore();
sessionStore.startCleanupTimer();

export class GameSpecificationStore {
  private entries: Map<string, StoredSpecEntry> = new Map();
  private ttlMs: number = LIMITS.STORE_TTL_MS;
  private maxEntries: number = LIMITS.MAX_STORED_GAMES;
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
    for (const [gameId, entry] of this.entries.entries()) {
      if (now - entry.lastAccessedAt > ttlMs && !sessionStore.hasActiveSessionForGame(gameId, now)) {
        this.entries.delete(gameId);
        cleaned++;
      }
    }
    return cleaned;
  }

  public save(
    spec: GameSpecification,
    now: number = Date.now(),
    ownerUserId?: string | null,
    isPublic?: boolean
  ): void {
    this.cleanupExpired(now);

    if (!this.entries.has(spec.gameId) && this.entries.size >= this.maxEntries) {
      let evictKey: string | null = null;
      let oldestTime = Infinity;

      // Prefer evicting specs without active sessions
      for (const [key, entry] of this.entries.entries()) {
        if (!sessionStore.hasActiveSessionForGame(key, now) && entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt;
          evictKey = key;
        }
      }

      if (evictKey) {
        this.entries.delete(evictKey);
      } else {
        throw new AppError(
          'STORE_CAPACITY_EXCEEDED',
          'Maximum number of active game specifications reached. Please try again later.',
          503
        );
      }
    }

    const storedSpec: GameSpecification = {
      ...spec,
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      ...(isPublic !== undefined ? { isPublic } : {}),
    };

    this.entries.set(spec.gameId, {
      spec: storedSpec,
      createdAt: now,
      lastAccessedAt: now,
    });

    persistenceRepo.saveGameSpecification(storedSpec, ownerUserId, isPublic);
  }

  public get(gameId: string, now: number = Date.now()): GameSpecification | undefined {
    const entry = this.entries.get(gameId);
    if (entry) {
      if (now - entry.lastAccessedAt > this.ttlMs && !sessionStore.hasActiveSessionForGame(gameId, now)) {
        this.entries.delete(gameId);
        return undefined;
      }
      entry.lastAccessedAt = now;
      return entry.spec;
    }

    // Fallback to SQLite persistent storage (survives server restarts)
    const persisted = persistenceRepo.getGameSpecificationById(gameId);
    if (persisted) {
      this.entries.set(gameId, {
        spec: persisted,
        createdAt: now,
        lastAccessedAt: now,
      });
      return persisted;
    }

    return undefined;
  }

  public has(gameId: string, now: number = Date.now()): boolean {
    return this.get(gameId, now) !== undefined;
  }

  public delete(gameId: string): boolean {
    const deletedMem = this.entries.delete(gameId);
    const deletedDb = persistenceRepo.deleteGame(gameId);
    return deletedMem || deletedDb;
  }

  public count(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }
}

export const gameStore = new GameSpecificationStore();
gameStore.startCleanupTimer();



