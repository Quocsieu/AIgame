import { Router, Request, Response, NextFunction } from 'express';
import { aiObservabilityService } from '../services/ai.observability.service.js';
import { analyticsService } from '../services/analytics.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { createSuccessResponse } from '../utils/errors.js';

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

