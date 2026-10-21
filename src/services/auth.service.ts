import crypto from 'node:crypto';
import { z } from 'zod';
import { LIMITS } from '../config/limits.js';
import { getDatabase } from '../storage/sqlite.db.js';
import { AppError } from '../utils/errors.js';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

export const RegisterRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Địa chỉ email không hợp lệ.')
    .max(120)
    .transform(v => v.toLowerCase()),
  password: z
    .string()
    .min(8, 'Mật khẩu phải có ít nhất 8 ký tự.')
    .max(128, 'Mật khẩu tối đa 128 ký tự.'),
  displayName: z
    .string()
    .trim()
    .min(2, 'Tên hiển thị phải có ít nhất 2 ký tự.')
    .max(60, 'Tên hiển thị tối đa 60 ký tự.'),
});

export const LoginRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Thông tin đăng nhập không hợp lệ.')
    .max(120)
    .transform(v => v.toLowerCase()),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.').max(128),
});

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x42);
const DUMMY_HASH = crypto.scryptSync('dummy_password_for_timing', DUMMY_SALT, KEY_LEN, SCRYPT_PARAMS);

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length !== 16 || expected.length !== KEY_LEN) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(derived, expected);
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export class AuthService {
  /**
   * Registers a new user account and creates an authenticated session token.
   */
  public register(input: unknown): {
    user: AuthenticatedUser;
    token: string;
    expiresAt: string;
  } {
    const parsed = RegisterRequestSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => i.message).join(' ');
      throw new AppError('INVALID_REQUEST', issues, 400);
    }

    const { email, password, displayName } = parsed.data;
    const db = getDatabase();

    const existing = db
      .prepare('SELECT user_id FROM users WHERE email = ?')
      .get(email) as { user_id: string } | undefined;

    if (existing) {
      // Do not leak sensitive details; return standard registration conflict error
      throw new AppError(
        'REGISTRATION_FAILED',
        'Không thể đăng ký với địa chỉ email này. Vui lòng kiểm tra lại hoặc đăng nhập.',
        409
      );
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const passwordHash = hashPassword(password);
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO users (user_id, email, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USER', ?, ?)`
    ).run(userId, email, displayName, passwordHash, nowIso, nowIso);

    const user: AuthenticatedUser = {
      userId,
      email,
      displayName,
      role: 'USER',
      createdAt: nowIso,
    };

    const session = this.createSessionForUser(userId);
    return {
      user,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Authenticates a user without leaking whether an email exists.
   */
  public login(input: unknown): {
    user: AuthenticatedUser;
    token: string;
    expiresAt: string;
  } {
    const parsed = LoginRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không chính xác.',
        401
      );
    }

    const { email, password } = parsed.data;
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email) as Record<string, any> | undefined;

    if (!row) {
      // Perform constant-time dummy scrypt computation to prevent timing enumeration
      const derived = crypto.scryptSync(password, DUMMY_SALT, KEY_LEN, SCRYPT_PARAMS);
      crypto.timingSafeEqual(derived, DUMMY_HASH);
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không chính xác.',
        401
      );
    }

    const isValid = verifyPassword(password, String(row.password_hash));
    if (!isValid) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không chính xác.',
        401
      );
    }

    const user: AuthenticatedUser = {
      userId: String(row.user_id),
      email: String(row.email),
      displayName: String(row.display_name),
      role: (row.role || 'USER') as 'USER' | 'ADMIN',
      createdAt: String(row.created_at),
    };

    const session = this.createSessionForUser(user.userId);
    return {
      user,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  public createSessionForUser(
    userId: string,
    ttlMs: number = LIMITS.AUTH_TOKEN_TTL_MS
  ): { token: string; expiresAt: string } {
    const db = getDatabase();
    const rawToken = `at_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = hashSessionToken(rawToken);
    const now = Date.now();
    const expiresAtMs = now + ttlMs;
    const nowIso = new Date(now).toISOString();

    // Opportunistically clean up expired sessions for this user
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND expires_at < ?').run(userId, now);

    db.prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`
    ).run(tokenHash, userId, expiresAtMs, nowIso);

    return {
      token: rawToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  public verifySessionToken(rawToken: string, now: number = Date.now()): AuthenticatedUser | null {
    if (!rawToken || !rawToken.startsWith('at_')) {
      return null;
    }

    const db = getDatabase();
    const tokenHash = hashSessionToken(rawToken);

    const row = db
      .prepare(
        `SELECT
          s.token_hash, s.expires_at, s.revoked_at,
          u.user_id, u.email, u.display_name, u.role, u.created_at
         FROM auth_sessions s
         INNER JOIN users u ON u.user_id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as Record<string, any> | undefined;

    if (!row) {
      return null;
    }

    if (row.revoked_at !== null && row.revoked_at !== undefined) {
      return null;
    }

    if (Number(row.expires_at) <= now) {
      db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }

    return {
      userId: String(row.user_id),
      email: String(row.email),
      displayName: String(row.display_name),
      role: (row.role || 'USER') as 'USER' | 'ADMIN',
      createdAt: String(row.created_at),
    };
  }

  public logout(rawToken: string): void {
    if (!rawToken) return;
    const db = getDatabase();
    const tokenHash = hashSessionToken(rawToken);
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').run(
      new Date().toISOString(),
      tokenHash
    );
  }

  /**
   * Enforces ownership-based authorization on a resource.
   * - Resources owned by a specific user (ownerUserId != null) can ONLY be modified/exported by that user,
   *   and can only be read by that user (unless isPublic is true and mode === 'read').
   * - Resources created in anonymous demo mode (ownerUserId == null) remain accessible for backwards compatibility.
   */
  public assertResourceAccess(options: {
    resourceType: string;
    ownerUserId: string | null | undefined;
    currentUser: AuthenticatedUser | null | undefined;
    mode: 'read' | 'write';
    isPublic?: boolean;
  }): void {
    const ownerId = options.ownerUserId ?? null;
    if (!ownerId) {
      // Unowned / demo resource
      return;
    }

    const currentUserId = options.currentUser?.userId ?? null;
    if (options.currentUser?.role === 'ADMIN') {
      return;
    }

    // Guests are strictly forbidden from writing/managing persistent resources (games, sources, etc.)
    // Even if ownerUserId was historically set to a guest ID, guest ownership does NOT confer management rights.
    if (
      options.mode === 'write' &&
      options.resourceType !== 'phiên luyện tập' &&
      currentUserId &&
      currentUserId.startsWith('guest_')
    ) {
      throw new AppError(
        'ACCESS_DENIED',
        `Tài khoản khách (Guest) không có quyền chỉnh sửa, lưu thay đổi, xuất bản hoặc xóa ${options.resourceType}. Vui lòng đăng nhập tài khoản người tổ chức hoặc Admin.`,
        403
      );
    }

    if (options.mode === 'read' && options.isPublic) {
      return;
    }

    if (!currentUserId || currentUserId !== ownerId) {
      throw new AppError(
        'ACCESS_DENIED',
        `Bạn không có quyền truy cập hoặc thao tác trên ${options.resourceType} này.`,
        403
      );
    }
  }
}

export const authService = new AuthService();

