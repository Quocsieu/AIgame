import { Router, Request, Response, NextFunction } from 'express';
import { rejectGuestOrPlayerWrite } from '../middleware/auth.middleware.js';
import { aiObservabilityService } from '../services/ai.observability.service.js';
import { analyticsService } from '../services/analytics.service.js';
import { authService } from '../services/auth.service.js';
import { exportService, ScoreboardExportFormat } from '../services/export.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const analyticsRouter = Router();
export const observabilityRouter = Router();
export const quotaRouter = Router();
export const historyRouter = Router();

/**
 * GET /api/analytics/learning
 * Scoped learning analytics for authenticated user or demo session scope.
 */
analyticsRouter.get(
  '/learning',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const tzOffsetMinutes = req.query.tzOffsetMinutes !== undefined ? Number(req.query.tzOffsetMinutes) : 0;
      const from = typeof req.query.from === 'string' && req.query.from.trim() ? req.query.from.trim() : undefined;
      const to = typeof req.query.to === 'string' && req.query.to.trim() ? req.query.to.trim() : undefined;

      const summary = analyticsService.getLearningAnalytics({
        userId: req.user?.userId ?? null,
        tzOffsetMinutes: Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0,
        from,
        to,
      });

      res.status(200).json(createSuccessResponse(summary));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/observability/ai
 * Aggregated AI usage & quality metrics.
 */
observabilityRouter.get(
  '/ai',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query.from === 'string' && req.query.from.trim() ? req.query.from.trim() : undefined;
      const to = typeof req.query.to === 'string' && req.query.to.trim() ? req.query.to.trim() : undefined;

      const summary = aiObservabilityService.getSummary({
        userId: req.user?.userId,
        from,
        to,
      });

      res.status(200).json(createSuccessResponse(summary));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/observability/ai/benchmark
 * Run deterministic AI output quality benchmark on sample fixtures.
 */
observabilityRouter.post(
  '/ai/benchmark',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await aiObservabilityService.runDeterministicBenchmark();
      res.status(200).json(createSuccessResponse(report));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/quotas/me
 * Return current user's quota summary (or anonymous default quota info).
 */
quotaRouter.get(
  '/me',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(200).json(
          createSuccessResponse({
            authenticated: false,
            quotas: null,
          })
        );
        return;
      }

      const quotas = quotaService.getUserQuotaSummary(req.user.userId);
      res.status(200).json(
        createSuccessResponse({
          authenticated: true,
          quotas,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/sessions
 * List completed practice sessions scoped to the caller.
 */
historyRouter.get(
  '/sessions',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const gameId = typeof req.query.gameId === 'string' && req.query.gameId.trim() ? req.query.gameId.trim() : undefined;
      const sessions = persistenceRepo.listPracticeSessions({
        userId: req.user?.userId ?? null,
        gameId,
        limit,
      });
      res.status(200).json(createSuccessResponse(sessions));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/rooms
 * List completed multiplayer rooms scoped to the caller (including rooms on owned games).
 */
historyRouter.get(
  '/rooms',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const gameId =
        typeof req.query.gameId === 'string' && req.query.gameId.trim()
          ? req.query.gameId.trim()
          : undefined;
      const rooms = persistenceRepo.listRoomHistory({
        userId: req.user?.userId ?? null,
        gameId,
        limit,
      });
      res.status(200).json(createSuccessResponse(rooms));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/sources
 * List ingested source metadata scoped to the caller.
 */
historyRouter.get(
  '/sources',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const sources = persistenceRepo.listSources(req.user?.userId ?? null, limit);
      res.status(200).json(createSuccessResponse(sources));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/activities
 * Unified Play / Exam History list for Statistics page (Solo & Multiplayer, Play & Exam).
 * Rejects Player/Guest tokens and scopes strictly to Creator's owned games (or all for Admin).
 */
historyRouter.get(
  '/activities',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xem lịch sử quản trị của BTC');

      const sessionMode =
        typeof req.query.sessionMode === 'string' ? req.query.sessionMode.trim() : 'ALL';
      const deliveryMode =
        typeof req.query.deliveryMode === 'string' ? req.query.deliveryMode.trim() : 'ALL';
      const gameId =
        typeof req.query.gameId === 'string' && req.query.gameId.trim()
          ? req.query.gameId.trim()
          : undefined;
      const search =
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const sortOrder =
        typeof req.query.sortOrder === 'string' ? req.query.sortOrder.trim() : 'NEWEST';
      const page = req.query.page !== undefined ? Math.max(1, Number(req.query.page) || 1) : 1;
      const limit =
        req.query.limit !== undefined
          ? Math.min(100, Math.max(1, Number(req.query.limit) || 20))
          : 20;
      const offset =
        req.query.offset !== undefined && Number.isFinite(Number(req.query.offset))
          ? Math.max(0, Number(req.query.offset))
          : undefined;

      const result = persistenceRepo.listPlayExamHistory({
        userId: req.user?.userId ?? null,
        isAdmin: req.user?.role === 'ADMIN',
        gameId,
        sessionMode,
        deliveryMode,
        search,
        sortOrder,
        page,
        limit,
        offset,
      });

      res.status(200).json(createSuccessResponse(result));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/activities/:historyId
 * Detailed view of a specific Play/Exam History run (Solo or Multiplayer).
 * Enforces strict ownership check (prevents IDOR) and never leaks unrevealed exam answers.
 */
historyRouter.get(
  '/activities/:historyId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xem chi tiết lịch sử quản trị của BTC');

      const historyId = String(req.params.historyId || '').trim();
      const detail = persistenceRepo.getPlayExamHistoryDetail(historyId);
      if (!detail) {
        throw new AppError(
          'HISTORY_NOT_FOUND',
          `Không tìm thấy bản ghi lịch sử "${historyId}".`,
          404
        );
      }

      authService.assertResourceAccess({
        resourceType: 'lịch sử phiên chơi/thi',
        ownerUserId: detail.ownerUserId,
        currentUser: req.user,
        mode: 'write',
      });

      const { ownerUserId: _omitOwner, ...safeDetail } = detail;
      res.status(200).json(createSuccessResponse(safeDetail));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/activities/:historyId/export?format=csv|xlsx|json
 * Exports a Play/Exam History run to CSV, Excel (.xlsx), or JSON.
 * Enforces strict ownership check (prevents IDOR) and neutralizes Formula Injection.
 */
historyRouter.get(
  '/activities/:historyId/export',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xuất dữ liệu lịch sử quản trị của BTC');

      const historyId = String(req.params.historyId || '').trim();
      const detail = persistenceRepo.getPlayExamHistoryDetail(historyId);
      if (!detail) {
        throw new AppError(
          'HISTORY_NOT_FOUND',
          `Không tìm thấy bản ghi lịch sử "${historyId}".`,
          404
        );
      }

      authService.assertResourceAccess({
        resourceType: 'lịch sử phiên chơi/thi',
        ownerUserId: detail.ownerUserId,
        currentUser: req.user,
        mode: 'write',
      });

      const rawFormat = String(req.query.format || 'xlsx').trim().toLowerCase();
      if (rawFormat !== 'csv' && rawFormat !== 'xlsx' && rawFormat !== 'json') {
        throw new AppError(
          'INVALID_EXPORT_FORMAT',
          'Định dạng xuất không hợp lệ. Chỉ hỗ trợ csv, xlsx hoặc json.',
          400
        );
      }

      const exported = exportService.exportPlayExamHistoryDetail(
        detail,
        rawFormat as ScoreboardExportFormat
      );

      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.status(200).send(exported.body);
    } catch (err) {
      next(err);
    }
  }
);

