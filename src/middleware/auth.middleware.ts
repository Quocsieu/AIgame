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

