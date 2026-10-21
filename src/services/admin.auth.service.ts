import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { LIMITS } from '../config/limits.js';
import { getDatabase } from '../storage/sqlite.db.js';
import { AppError } from '../utils/errors.js';
import { AuthenticatedUser, authService, hashPassword, verifyPassword } from './auth.service.js';

export const ADMIN_USER_ID = 'usr_system_admin';
export const ADMIN_COOKIE_NAME = 'admin_session';

export function extractAdminTokenFromRequest(req: Request): string | null {
  // 1. Check req.cookies if cookie-parser middleware is present
  const reqWithCookies = req as Request & { cookies?: Record<string, string> };
  if (reqWithCookies.cookies && typeof reqWithCookies.cookies[ADMIN_COOKIE_NAME] === 'string') {
    const val = reqWithCookies.cookies[ADMIN_COOKIE_NAME].trim();
    if (val) return val;
  }

  // 2. Parse from Cookie header directly
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]+)`));
    if (match && match[1]) {
      try {
        const val = decodeURIComponent(match[1].trim());
        if (val) return val;
      } catch {
        // malformed cookie fallback
      }
    }
  }

  // 3. Fallback to Authorization: Bearer at_...
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      const token = trimmed.slice(7).trim();
      if (token.startsWith('at_')) {
        return token;
      }
    }
  }

  return null;
}

export class AdminAuthService {
  private inMemoryDevHash: string | null = null;

  /**
   * Resolves the configured ADMIN_PASSWORD_HASH or fails safe if unconfigured.
   */
  public getConfiguredHash(): string {
    const hash = (process.env.ADMIN_PASSWORD_HASH || LIMITS.ADMIN_PASSWORD_HASH || '').trim();
    if (hash) {
      return hash;
    }

    const plainPass = (process.env.ADMIN_PASSWORD || LIMITS.ADMIN_PASSWORD || '').trim();
    if (plainPass) {
      if (!this.inMemoryDevHash) {
        this.inMemoryDevHash = hashPassword(plainPass);
      }
      return this.inMemoryDevHash;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      throw new AppError(
        'ADMIN_AUTH_NOT_CONFIGURED',
        'Khu vực quản trị chưa được cấu hình biến môi trường ADMIN_PASSWORD_HASH trên máy chủ production.',
        503
      );
    }

    throw new AppError(
      'ADMIN_AUTH_NOT_CONFIGURED',
      'Vui lòng thiết lập biến môi trường ADMIN_PASSWORD_HASH trong tệp .env để sử dụng chức năng quản trị.',
      503
    );
  }

  /**
   * Verifies the provided admin password and creates an authenticated admin session.
   */
  public authenticateAdmin(password: string): {
    user: AuthenticatedUser;
    token: string;
    expiresAt: string;
  } {
    if (!password || typeof password !== 'string' || password.length === 0) {
      throw new AppError('INVALID_CREDENTIALS', 'Vui lòng nhập mật khẩu Quản trị viên.', 401);
    }

    const expectedHash = this.getConfiguredHash();
    const isValid = verifyPassword(password, expectedHash);

    if (!isValid) {
      throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu quản trị viên không chính xác.', 401);
    }

    // Ensure the root admin account exists in SQLite
    const db = getDatabase();
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO users (user_id, email, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ADMIN', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET role = 'ADMIN', display_name = 'Quản Trị Viên', updated_at = excluded.updated_at`
    ).run(
      ADMIN_USER_ID,
      'admin@system.local',
      'Quản Trị Viên',
      'system_locked_admin_pass',
      nowIso,
      nowIso
    );

    const session = authService.createSessionForUser(ADMIN_USER_ID, LIMITS.ADMIN_SESSION_TTL_MS);

    const user: AuthenticatedUser = {
      userId: ADMIN_USER_ID,
      email: 'admin@system.local',
      displayName: 'Quản Trị Viên',
      role: 'ADMIN',
      createdAt: nowIso,
    };

    return {
      user,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Sets the HttpOnly admin session cookie on the Express Response.
   */
  public attachAdminCookie(res: Response, token: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const maxAgeSec = Math.floor(LIMITS.ADMIN_SESSION_TTL_MS / 1000);

    const cookieParts = [
      `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${maxAgeSec}`,
      'HttpOnly',
      isProduction ? 'SameSite=None' : 'SameSite=Lax',
    ];

    if (isProduction) {
      cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
  }

  /**
   * Clears the admin session cookie on the Express Response.
   */
  public clearAdminCookie(res: Response): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieParts = [
      `${ADMIN_COOKIE_NAME}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      isProduction ? 'SameSite=None' : 'SameSite=Lax',
    ];

    if (isProduction) {
      cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
  }

  /**
   * Verifies if the request carries a valid Admin session (via cookie or Bearer token).
   */
  public verifyAdminSession(req: Request): AuthenticatedUser | null {
    const token = extractAdminTokenFromRequest(req);
    if (!token) {
      return null;
    }

    const user = authService.verifySessionToken(token);
    if (!user || user.role !== 'ADMIN') {
      return null;
    }

    return user;
  }

  /**
   * Logs out the admin session and revokes the token.
   */
  public logout(req: Request, res: Response): void {
    const token = extractAdminTokenFromRequest(req);
    if (token) {
      authService.logout(token);
    }
    this.clearAdminCookie(res);
  }
}

export const adminAuthService = new AdminAuthService();
