import { Router, Request, Response, NextFunction } from 'express';
import { requireAuthMiddleware } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';
import { authService, RegisterRequestSchema, LoginRequestSchema } from '../services/auth.service.js';
import { quotaService } from '../services/quota.service.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Create a new account and issue a session token.
 */
authRouter.post(
  '/register',
  authRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = RegisterRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new AppError('INVALID_REQUEST', `Registration validation failed: ${issues}`, 400);
      }

      const result = authService.register(parseResult.data);
      const quotas = quotaService.getUserQuotaSummary(result.user.userId);

      res.status(201).json(
        createSuccessResponse({
          user: result.user,
          token: result.token,
          expiresAt: result.expiresAt,
          quotas,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/login
 * Authenticate with email and password.
 */
authRouter.post(
  '/login',
  authRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = LoginRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new AppError('INVALID_REQUEST', `Login validation failed: ${issues}`, 400);
      }

      const result = authService.login(parseResult.data);
      const quotas = quotaService.getUserQuotaSummary(result.user.userId);

      res.status(200).json(
        createSuccessResponse({
          user: result.user,
          token: result.token,
          expiresAt: result.expiresAt,
          quotas,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 * Invalidate the active session token.
 */
authRouter.post(
  '/logout',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.authToken) {
        authService.logout(req.authToken);
      }
      res.status(200).json(createSuccessResponse({ loggedOut: true }));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/auth/me
 * Return authenticated user profile and active usage quotas.
 */
authRouter.get(
  '/me',
  requireAuthMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const quotas = quotaService.getUserQuotaSummary(user.userId);
      res.status(200).json(
        createSuccessResponse({
          user,
          quotas,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/auth/whoami
 * Return session identity for either authenticated users, guest creators, or anonymous visitors.
 */
authRouter.get(
  '/whoami',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(
        createSuccessResponse({
          user: req.user || null,
          isGuest: Boolean(req.isGuest),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

