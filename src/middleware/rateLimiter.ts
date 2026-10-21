import { Request, Response, NextFunction } from 'express';
import { LIMITS } from '../config/limits.js';
import { AppError } from '../utils/errors.js';

export interface RateLimiterOptions {
  name: string;
  windowMs: number;
  maxRequests: number;
  maxTrackedKeys?: number;
  message?: string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory single-instance rate limiter.
 * Note: Counters are stored in process memory and protect a single Node.js instance.
 * Client IP resolution relies on Express `req.ip` (which only honors X-Forwarded-For
 * when `trust proxy` is explicitly configured on the Express app).
 */
export class InMemoryRateLimiter {
  private buckets: Map<string, RateLimitBucket> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private readonly maxTrackedKeys: number;
  private readonly message: string;
  public readonly name: string;

  constructor(options: RateLimiterOptions) {
    this.name = options.name;
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.maxTrackedKeys = options.maxTrackedKeys ?? 5000;
    this.message =
      options.message ??
      `Too many requests to ${options.name}. Please wait before trying again.`;
  }

  public configure(options: { windowMs?: number; maxRequests?: number }): void {
    if (options.windowMs !== undefined && options.windowMs > 0) {
      this.windowMs = options.windowMs;
    }
    if (options.maxRequests !== undefined && options.maxRequests > 0) {
      this.maxRequests = options.maxRequests;
    }
  }

  public reset(): void {
    this.buckets.clear();
  }

  public cleanupExpired(now: number = Date.now()): number {
    let cleaned = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  private resolveClientKey(req: Request): string {
    // Only rely on Express's req.ip (which respects app.get('trust proxy')) or socket address.
    // Never blindly trust X-Forwarded-For when trust proxy is disabled.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return ip;
  }

  public middleware = (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = this.resolveClientKey(req);

    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (!bucket && this.buckets.size >= this.maxTrackedKeys) {
        this.cleanupExpired(now);
        if (this.buckets.size >= this.maxTrackedKeys) {
          const oldestKey = this.buckets.keys().next().value;
          if (oldestKey !== undefined) {
            this.buckets.delete(oldestKey);
          }
        }
      }

      bucket = {
        count: 0,
        resetAt: now + this.windowMs,
      };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, this.maxRequests - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(this.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > this.maxRequests) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(new AppError('RATE_LIMIT_EXCEEDED', this.message, 429));
      return;
    }

    next();
  };
}

export const ingestRateLimiter = new InMemoryRateLimiter({
  name: 'content-ingest',
  windowMs: LIMITS.RATE_LIMIT_WINDOW_MS,
  maxRequests: LIMITS.RATE_LIMIT_INGEST_MAX,
  message: 'Rate limit exceeded for content ingestion. Please wait before uploading or fetching more sources.',
});

export const generateRateLimiter = new InMemoryRateLimiter({
  name: 'ai-generate',
  windowMs: LIMITS.RATE_LIMIT_WINDOW_MS,
  maxRequests: LIMITS.RATE_LIMIT_GENERATE_MAX,
  message: 'Rate limit exceeded for AI question generation. Please wait before generating another game.',
});

export const roomCreateRateLimiter = new InMemoryRateLimiter({
  name: 'room-create',
  windowMs: LIMITS.RATE_LIMIT_WINDOW_MS,
  maxRequests: LIMITS.RATE_LIMIT_ROOM_CREATE_MAX,
  message: 'Rate limit exceeded for room creation. Please wait before creating another room.',
});

export const authRateLimiter = new InMemoryRateLimiter({
  name: 'auth-endpoint',
  windowMs: LIMITS.RATE_LIMIT_WINDOW_MS,
  maxRequests: LIMITS.RATE_LIMIT_AUTH_MAX,
  message: 'Too many authentication attempts. Please wait before trying again.',
});

export const gamePasswordVerifyRateLimiter = new InMemoryRateLimiter({
  name: 'game-password-verify',
  windowMs: LIMITS.RATE_LIMIT_WINDOW_MS,
  maxRequests: LIMITS.RATE_LIMIT_GAME_PASSWORD_VERIFY_MAX,
  message: 'Bạn đã thử mật khẩu sai quá nhiều lần. Vui lòng đợi 1 phút trước khi thử lại.',
});

export function resetAllRateLimiters(): void {
  ingestRateLimiter.reset();
  generateRateLimiter.reset();
  roomCreateRateLimiter.reset();
  authRateLimiter.reset();
  gamePasswordVerifyRateLimiter.reset();
}


