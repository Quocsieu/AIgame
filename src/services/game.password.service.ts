import crypto from 'node:crypto';
import type { Request } from 'express';
import { LIMITS } from '../config/limits.js';

interface GameAccessTokenEntry {
  token: string;
  gameId: string;
  issuedAt: number;
  expiresAt: number;
}

export class GamePasswordService {
  private accessTokens: Map<string, GameAccessTokenEntry> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Precomputed dummy hash for constant-time comparison on invalid/missing hashes
  private readonly dummySalt: string = crypto.randomBytes(16).toString('hex');
  private readonly dummyHash: string = crypto
    .scryptSync('dummy_timing_safe_pass', this.dummySalt, 64)
    .toString('hex');

  constructor() {
    this.startCleanupTimer();
  }

  public startCleanupTimer(intervalMs: number = 5 * 60 * 1000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredTokens();
    }, intervalMs);
    this.cleanupTimer.unref();
  }

  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public cleanupExpiredTokens(now: number = Date.now()): number {
    let count = 0;
    for (const [token, entry] of this.accessTokens.entries()) {
      if (now >= entry.expiresAt) {
        this.accessTokens.delete(token);
        count++;
      }
    }
    return count;
  }

  /**
   * Hashes a game-specific password using OWASP scrypt with a 16-byte random salt.
   */
  public hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password.normalize('NFKC'), salt, 64);
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  /**
   * Constant-time verification of a plaintext password against a stored scrypt hash.
   * Completely eliminates timing attacks.
   */
  public verifyPassword(password: string, storedHash: string | null | undefined): boolean {
    if (!storedHash || !storedHash.startsWith('scrypt$')) {
      // Execute dummy constant-time verification to prevent timing discrepancy
      const dummyBuffer = Buffer.from(this.dummyHash, 'hex');
      const actualDummy = crypto.scryptSync(password.normalize('NFKC'), this.dummySalt, dummyBuffer.length);
      crypto.timingSafeEqual(dummyBuffer, actualDummy);
      return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== 3) {
      return false;
    }

    const [, salt, expectedHex] = parts;
    const expectedBuffer = Buffer.from(expectedHex, 'hex');
    const actualBuffer = crypto.scryptSync(password.normalize('NFKC'), salt, expectedBuffer.length);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  /**
   * Issues a cryptographically random, short-lived game access token strictly scoped to a specific gameId.
   */
  public issueGameAccessToken(
    gameId: string,
    ttlMs: number = LIMITS.GAME_ACCESS_TOKEN_TTL_MS
  ): { token: string; expiresAt: string } {
    const now = Date.now();
    const token = `gat_${crypto.randomBytes(32).toString('hex')}`;
    const expiresAtMs = now + ttlMs;

    this.accessTokens.set(token, {
      token,
      gameId,
      issuedAt: now,
      expiresAt: expiresAtMs,
    });

    return {
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Validates whether a given token grants active, unexpired access to the requested gameId.
   * Prevents cross-game IDOR token reuse.
   */
  public verifyGameAccessToken(token: string | null | undefined, gameId: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }
    const cleanToken = token.trim();
    const entry = this.accessTokens.get(cleanToken);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (now >= entry.expiresAt) {
      this.accessTokens.delete(cleanToken);
      return false;
    }

    // Strict gameId scoping: token issued for game A cannot access game B
    return entry.gameId === gameId;
  }

  /**
   * Revokes all active access tokens for a specific gameId (e.g. when password is updated or removed).
   */
  public revokeTokensForGame(gameId: string): number {
    let revoked = 0;
    for (const [token, entry] of this.accessTokens.entries()) {
      if (entry.gameId === gameId) {
        this.accessTokens.delete(token);
        revoked++;
      }
    }
    return revoked;
  }

  /**
   * Extracts access token from either X-Game-Access-Token header, query string, or body.
   */
  public extractAccessTokenFromRequest(req: Request): string | null {
    const fromHeader = req.headers['x-game-access-token'];
    if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
      return fromHeader.trim();
    }
    if (Array.isArray(fromHeader) && fromHeader[0]?.trim()) {
      return fromHeader[0].trim();
    }

    const fromQuery = req.query.gameAccessToken;
    if (typeof fromQuery === 'string' && fromQuery.trim().length > 0) {
      return fromQuery.trim();
    }

    const fromBody = (req.body as any)?.gameAccessToken;
    if (typeof fromBody === 'string' && fromBody.trim().length > 0) {
      return fromBody.trim();
    }

    return null;
  }

  /**
   * Checks if the incoming request has valid verified access for the given gameId.
   */
  public hasAccess(req: Request, gameId: string): boolean {
    const token = this.extractAccessTokenFromRequest(req);
    return this.verifyGameAccessToken(token, gameId);
  }

  public clearAll(): void {
    this.accessTokens.clear();
  }
}

export const gamePasswordService = new GamePasswordService();

