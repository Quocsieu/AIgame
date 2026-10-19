import { LIMITS } from '../config/limits.js';
import { sessionStore } from '../game/game.store.js';
import { roomStore } from '../multiplayer/room.store.js';
import { getDatabase, runInTransaction } from '../storage/sqlite.db.js';
import { AppError } from '../utils/errors.js';

export type QuotaMetricKey = 'DAILY_INGESTIONS' | 'DAILY_GAME_GENERATIONS' | 'DAILY_AI_CALLS';

export interface QuotaCheckResult {
  quotaKey: string;
  windowKey: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

export interface UserQuotaSummary {
  userId: string;
  windowKey: string;
  resetAt: string;
  dailyIngestions: QuotaCheckResult;
  dailyGameGenerations: QuotaCheckResult;
  dailyAiCalls: QuotaCheckResult;
  activeSessions: {
    used: number;
    limit: number;
    remaining: number;
  };
  activeRooms: {
    used: number;
    limit: number;
    remaining: number;
  };
  perRequestLimits: {
    maxUrlsPerRequest: number;
    maxFilesPerRequest: number;
    maxFileBytes: number;
  };
}

export class QuotaService {
  private customLimits: Partial<Record<QuotaMetricKey | 'MAX_ACTIVE_SESSIONS' | 'MAX_ACTIVE_ROOMS', number>> = {};

  public configure(
    overrides: Partial<Record<QuotaMetricKey | 'MAX_ACTIVE_SESSIONS' | 'MAX_ACTIVE_ROOMS', number>>
  ): void {
    this.customLimits = { ...this.customLimits, ...overrides };
  }

  public resetOverrides(): void {
    this.customLimits = {};
  }

  public getLimitForKey(key: QuotaMetricKey): number {
    if (this.customLimits[key] !== undefined) {
      return this.customLimits[key]!;
    }
    switch (key) {
      case 'DAILY_INGESTIONS':
        return LIMITS.QUOTA_DAILY_INGESTIONS;
      case 'DAILY_GAME_GENERATIONS':
        return LIMITS.QUOTA_DAILY_GAME_GENERATIONS;
      case 'DAILY_AI_CALLS':
        return LIMITS.QUOTA_DAILY_AI_CALLS;
    }
  }

  public getMaxActiveSessionsLimit(): number {
    return this.customLimits.MAX_ACTIVE_SESSIONS ?? LIMITS.QUOTA_MAX_ACTIVE_SESSIONS_PER_USER;
  }

  public getMaxActiveRoomsLimit(): number {
    return this.customLimits.MAX_ACTIVE_ROOMS ?? LIMITS.QUOTA_MAX_ACTIVE_ROOMS_PER_USER;
  }

  public getCurrentUtcWindow(now: number = Date.now()): { windowKey: string; resetAt: string } {
    const d = new Date(now);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const windowKey = `${year}-${month}-${day}`;
    const nextMidnightUtc = Date.UTC(year, d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
    return {
      windowKey,
      resetAt: new Date(nextMidnightUtc).toISOString(),
    };
  }

  /**
   * Atomically checks and increments a user's quota counter inside an IMMEDIATE SQLite transaction.
   * Throws HTTP 429 QUOTA_EXCEEDED if the request would exceed the user's quota.
   */
  public consumeUserQuota(
    userId: string | null | undefined,
    quotaKey: QuotaMetricKey,
    amount: number = 1,
    now: number = Date.now()
  ): QuotaCheckResult | null {
    if (!userId) {
      return null;
    }

    const limit = this.getLimitForKey(quotaKey);
    const { windowKey, resetAt } = this.getCurrentUtcWindow(now);
    const nowIso = new Date(now).toISOString();

    return runInTransaction((db) => {
      const row = db
        .prepare(
          'SELECT used_count FROM user_quota_windows WHERE user_id = ? AND quota_key = ? AND window_key = ?'
        )
        .get(userId, quotaKey, windowKey) as { used_count: number } | undefined;

      const currentUsed = row ? Number(row.used_count) : 0;
      if (currentUsed + amount > limit) {
        throw new AppError(
          'QUOTA_EXCEEDED',
          `Bạn đã sử dụng hết hạn mức ${quotaKey} trong ngày (${currentUsed}/${limit}). Hạn mức sẽ đặt lại lúc ${resetAt}.`,
          429,
          {
            quotaKey,
            windowKey,
            limit,
            used: currentUsed,
            remaining: Math.max(0, limit - currentUsed),
            resetAt,
          }
        );
      }

      const nextUsed = currentUsed + amount;
      db.prepare(
        `INSERT INTO user_quota_windows (user_id, quota_key, window_key, used_count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, quota_key, window_key) DO UPDATE SET
           used_count = excluded.used_count,
           updated_at = excluded.updated_at`
      ).run(userId, quotaKey, windowKey, nextUsed, nowIso);

      return {
        quotaKey,
        windowKey,
        limit,
        used: nextUsed,
        remaining: Math.max(0, limit - nextUsed),
        resetAt,
      };
    }, true);
  }

  public enforceActiveSessionLimit(userId: string | null | undefined, now: number = Date.now()): void {
    if (!userId) return;
    const limit = this.getMaxActiveSessionsLimit();
    const activeCount = sessionStore.countActiveSessionsForUser(userId, now);
    if (activeCount >= limit) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `Bạn đang có ${activeCount}/${limit} phiên luyện tập đang hoạt động. Vui lòng hoàn thành phiên hiện tại trước khi tạo phiên mới.`,
        429,
        {
          quotaKey: 'MAX_ACTIVE_SESSIONS',
          limit,
          used: activeCount,
          remaining: 0,
        }
      );
    }
  }

  public enforceActiveRoomLimit(userId: string | null | undefined, now: number = Date.now()): void {
    if (!userId) return;
    const limit = this.getMaxActiveRoomsLimit();
    const activeCount = roomStore.countActiveRoomsForUser(userId, now);
    if (activeCount >= limit) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `Bạn đang có ${activeCount}/${limit} phòng chơi trực tiếp đang hoạt động. Vui lòng kết thúc phòng cũ trước khi mở phòng mới.`,
        429,
        {
          quotaKey: 'MAX_ACTIVE_ROOMS',
          limit,
          used: activeCount,
          remaining: 0,
        }
      );
    }
  }

  public getUserQuotaSummary(userId: string, now: number = Date.now()): UserQuotaSummary {
    const db = getDatabase();
    const { windowKey, resetAt } = this.getCurrentUtcWindow(now);

    const rows = db
      .prepare(
        'SELECT quota_key, used_count FROM user_quota_windows WHERE user_id = ? AND window_key = ?'
      )
      .all(userId, windowKey) as Array<{ quota_key: string; used_count: number }>;

    const usageMap = new Map<string, number>();
    for (const r of rows) {
      usageMap.set(String(r.quota_key), Number(r.used_count));
    }

    const buildItem = (key: QuotaMetricKey): QuotaCheckResult => {
      const limit = this.getLimitForKey(key);
      const used = usageMap.get(key) || 0;
      return {
        quotaKey: key,
        windowKey,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetAt,
      };
    };

    const activeSessionsUsed = sessionStore.countActiveSessionsForUser(userId, now);
    const activeSessionsLimit = this.getMaxActiveSessionsLimit();
    const activeRoomsUsed = roomStore.countActiveRoomsForUser(userId, now);
    const activeRoomsLimit = this.getMaxActiveRoomsLimit();

    return {
      userId,
      windowKey,
      resetAt,
      dailyIngestions: buildItem('DAILY_INGESTIONS'),
      dailyGameGenerations: buildItem('DAILY_GAME_GENERATIONS'),
      dailyAiCalls: buildItem('DAILY_AI_CALLS'),
      activeSessions: {
        used: activeSessionsUsed,
        limit: activeSessionsLimit,
        remaining: Math.max(0, activeSessionsLimit - activeSessionsUsed),
      },
      activeRooms: {
        used: activeRoomsUsed,
        limit: activeRoomsLimit,
        remaining: Math.max(0, activeRoomsLimit - activeRoomsUsed),
      },
      perRequestLimits: {
        maxUrlsPerRequest: LIMITS.MAX_URLS_PER_REQUEST,
        maxFilesPerRequest: LIMITS.MAX_FILES_PER_REQUEST,
        maxFileBytes: LIMITS.MAX_FILE_BYTES,
      },
    };
  }
}

export const quotaService = new QuotaService();

