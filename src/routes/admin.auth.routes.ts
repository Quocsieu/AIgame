import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { adminLoginRateLimiter } from '../middleware/rateLimiter.js';
import { adminAuthService } from '../services/admin.auth.service.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const adminAuthRouter = Router();

const AdminLoginSchema = z.object({
  password: z.string().min(1, 'Vui lòng nhập mật khẩu Quản trị viên.').max(128),
});

/**
 * POST /api/admin/auth/login
 * Authenticates admin using a single environment-configured password,
 * sets an HttpOnly cookie, and returns a session token.
 */
adminAuthRouter.post(
  '/login',
  adminLoginRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const parse = AdminLoginSchema.safeParse(req.body);
      if (!parse.success) {
        throw new AppError('INVALID_REQUEST', parse.error.issues[0]?.message || 'Dữ liệu không hợp lệ.', 400);
      }

      const { password } = parse.data;
      const result = adminAuthService.authenticateAdmin(password);

      // Attach HttpOnly, Secure, SameSite session cookie
      adminAuthService.attachAdminCookie(res, result.token);

      res.status(200).json(
        createSuccessResponse({
          authenticated: true,
          user: result.user,
          token: result.token,
          expiresAt: result.expiresAt,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/auth/me
 * Checks if the caller has an active, valid Admin session (via cookie or Bearer token).
 */
adminAuthRouter.get('/me', (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminUser =
      (req.user && req.user.role === 'ADMIN' ? req.user : null) ||
      adminAuthService.verifyAdminSession(req);

    if (!adminUser) {
      res.status(200).json(
        createSuccessResponse({
          authenticated: false,
          user: null,
        })
      );
      return;
    }

    res.status(200).json(
      createSuccessResponse({
        authenticated: true,
        user: adminUser,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/auth/logout
 * Revokes the admin session and clears the admin HttpOnly cookie.
 */
adminAuthRouter.post('/logout', (req: Request, res: Response, next: NextFunction) => {
  try {
    adminAuthService.logout(req, res);
    res.status(200).json(
      createSuccessResponse({
        loggedOut: true,
      })
    );
  } catch (err) {
    next(err);
  }
});
