import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AuthenticatedUser, authService } from '../services/auth.service.js';
import { AppError } from '../utils/errors.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser | null;
      authToken?: string | null;
      isGuest?: boolean;
    }
  }
}

const GUEST_TOKEN_REGEX = /^gt_[a-f0-9]{24,64}$/i;

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    throw new AppError(
      'UNAUTHORIZED',
      'Authorization header must use Bearer token format.',
      401
    );
  }
  const token = trimmed.slice(7).trim();
  if (!token) {
    throw new AppError('UNAUTHORIZED', 'Bearer token is empty.', 401);
  }
  return token;
}

function extractGuestUser(req: Request): AuthenticatedUser | null {
  const rawHeader = req.headers['x-guest-token'];
  if (!rawHeader) {
    return null;
  }
  const token = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).trim();
  if (!token) {
    return null;
  }
  if (!GUEST_TOKEN_REGEX.test(token)) {
    throw new AppError(
      'INVALID_GUEST_TOKEN',
      'Guest session token format is invalid.',
      400
    );
  }
  const guestHash = crypto
    .createHash('sha256')
    .update(token.toLowerCase())
    .digest('hex')
    .slice(0, 24);
  const guestId = `guest_${guestHash}`;
  return {
    userId: guestId,
    email: `${guestId}@guest.local`,
    displayName: 'Khách',
    role: 'USER',
    createdAt: new Date(0).toISOString(),
  };
}

/**
 * Attaches req.user if a valid Bearer token or X-Guest-Token is provided.
 * If an invalid or expired Bearer token is explicitly provided, rejects with 401 UNAUTHORIZED.
 * If no Authorization or X-Guest-Token header is provided, continues as anonymous (req.user = null).
 */
export function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      // Check for Guest token
      const guestUser = extractGuestUser(req);
      req.user = guestUser;
      req.authToken = null;
      req.isGuest = Boolean(guestUser);
      next();
      return;
    }

    const user = authService.verifySessionToken(token);
    if (!user) {
      throw new AppError(
        'UNAUTHORIZED',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
        401
      );
    }

    req.user = user;
    req.authToken = token;
    req.isGuest = false;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Strictly requires an authenticated user.
 */
export function requireAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError(
        'UNAUTHORIZED',
        'Yêu cầu đăng nhập để thực hiện thao tác này.',
        401
      );
    }

    const user = authService.verifySessionToken(token);
    if (!user) {
      throw new AppError(
        'UNAUTHORIZED',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
        401
      );
    }

    req.user = user;
    req.authToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Strictly requires an authenticated user with ADMIN role.
 * Accepts either an HttpOnly admin_session cookie or a valid Authorization: Bearer token.
 */
export function requireAdminMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    // If already populated and verified as ADMIN
    if (req.user && req.user.role === 'ADMIN') {
      next();
      return;
    }

    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError(
        'UNAUTHORIZED',
        'Yêu cầu xác thực tài khoản Quản trị viên (Admin) để thực hiện thao tác này.',
        401
      );
    }

    const user = authService.verifySessionToken(token);
    if (!user) {
      throw new AppError(
        'UNAUTHORIZED',
        'Phiên quản trị không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập tài khoản Admin.',
        401
      );
    }

    if (user.role !== 'ADMIN') {
      throw new AppError(
        'ACCESS_DENIED',
        'Chỉ Quản trị viên (Admin) mới có quyền truy cập khu vực này.',
        403
      );
    }

    req.user = user;
    req.authToken = token;
    req.isGuest = false;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Returns true if the server is running on a public Production environment.
 * Demo Mode is strictly forbidden when this returns true, even if ADMIN_COST_DEMO_MODE=true.
 */
export function isPublicProductionEnvironment(): boolean {
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    return true;
  }
  if (
    process.env.RENDER ||
    process.env.RENDER_SERVICE_ID ||
    process.env.VERCEL ||
    String(process.env.VERCEL_ENV || '').trim().toLowerCase() === 'production' ||
    String(process.env.RAILWAY_ENVIRONMENT || '').trim().toLowerCase() === 'production' ||
    process.env.FLY_APP_NAME
  ) {
    return true;
  }
  return false;
}

/**
 * Returns true when Local/Development Demo Mode for Admin AI Cost Analytics is enabled.
 * - Strictly blocked on public Production environments.
 * - Never trusts any client-supplied HTTP header.
 * - Enabled in local/development unless ADMIN_COST_DEMO_MODE is explicitly set to 'false' / '0' / 'off'.
 */
export function isAdminCostDemoModeEnabled(): boolean {
  if (isPublicProductionEnvironment()) {
    return false;
  }
  const rawFlag = String(process.env.ADMIN_COST_DEMO_MODE ?? 'true')
    .trim()
    .toLowerCase();
  if (rawFlag === 'false' || rawFlag === '0' || rawFlag === 'off' || rawFlag === 'no') {
    return false;
  }
  return true;
}

/**
 * Separated permission middleware for Admin AI Cost Analytics & Excel Export.
 * - In Local Demo Mode (ADMIN_COST_DEMO_MODE=true & non-production), permits read-only GET/HEAD access
 *   to AI cost analytics and Excel export without requiring an Admin session token.
 * - Never trusts fake client headers (e.g., X-Admin-Demo, X-Admin).
 * - Always rejects Guest/Player tokens (X-Guest-Token, X-Player-Token).
 * - When Demo Mode is disabled or in Production, enforces full requireAdminMiddleware RBAC.
 */
export function requireAdminCostAnalyticsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    if (req.headers['x-player-token'] || req.headers['x-guest-token'] || req.isGuest) {
      throw new AppError(
        'ACCESS_DENIED',
        'Khách hoặc người chơi không được phép truy cập báo cáo chi phí AI.',
        403
      );
    }

    if (req.user && req.user.role === 'ADMIN') {
      next();
      return;
    }

    if (
      isAdminCostDemoModeEnabled() &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      next();
      return;
    }

    requireAdminMiddleware(req, res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * Strictly rejects callers with X-Player-Token, X-Guest-Token, or synthetic guest accounts.
 * Ensures only authenticated organizers (USER/ADMIN) or unauthenticated callers in test/demo mode
 * can access game management and creation features.
 */
export function rejectGuestOrPlayerWrite(req: Request, action: string = 'quản lý game'): void {
  if (req.headers['x-player-token']) {
    throw new AppError(
      'ACCESS_DENIED',
      `Người chơi trong phòng không có quyền ${action}.`,
      403
    );
  }

  if (
    req.headers['x-guest-token'] ||
    req.isGuest ||
    (req.user && req.user.userId && req.user.userId.startsWith('guest_'))
  ) {
    throw new AppError(
      'ACCESS_DENIED',
      `Tài khoản khách (Guest) chỉ có quyền tham gia chơi game. Vui lòng đăng nhập tài khoản người tổ chức hoặc Admin để ${action}.`,
      403
    );
  }
}

