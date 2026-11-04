import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { gameStore } from '../game/game.store.js';
import {
  isAdminCostDemoModeEnabled,
  requireAdminCostAnalyticsMiddleware,
  requireAdminMiddleware,
} from '../middleware/auth.middleware.js';
import { roomStore } from '../multiplayer/room.store.js';
import { aiObservabilityService } from '../services/ai.observability.service.js';
import { exportService } from '../services/export.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const adminRouter = Router();

function sanitizeAiCostReportForPublicView<T extends ReturnType<typeof aiObservabilityService.getAdminAiCostReport>>(
  report: T,
  isAdmin: boolean
): T {
  if (isAdmin) {
    return report;
  }
  const sanitizeReq = <R extends { userId: string | null; errorCode: string | null }>(r: R): R => ({
    ...r,
    userId: null,
    errorCode: null,
  });
  return {
    ...report,
    persistenceStatus: {
      ...report.persistenceStatus,
      databasePath: '',
    },
    byGame: report.byGame.map((g) => ({
      ...g,
      requests: (g.requests || []).map(sanitizeReq),
    })),
    apiLogs: (report.apiLogs || []).map(sanitizeReq),
  };
}

/**
 * GET /api/admin/ai-costs
 * Comprehensive AI Token & Cost Tracking Report (KPIs, 100/1000/10000 scaling projections, per-game & per-model breakdown)
 */
adminRouter.get(
  '/ai-costs',
  requireAdminCostAnalyticsMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const presetRaw = typeof req.query.preset === 'string' ? req.query.preset.trim().toUpperCase() : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
      const model = typeof req.query.model === 'string' ? req.query.model.trim() : undefined;
      const gameType = typeof req.query.gameType === 'string' ? req.query.gameType.trim() : undefined;
      const taskType = typeof req.query.taskType === 'string' ? req.query.taskType.trim() : undefined;
      const questionCount =
        typeof req.query.questionCount === 'string'
          ? req.query.questionCount.trim()
          : typeof req.query.requestedQuestions === 'string'
            ? req.query.requestedQuestions.trim()
            : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;

      const rawReport = aiObservabilityService.getAdminAiCostReport({
        preset: (presetRaw as any) || undefined,
        from,
        to,
        model,
        gameType,
        taskType,
        questionCount,
        status,
      });
      const isAdmin = req.user?.role === 'ADMIN';
      const report = sanitizeAiCostReportForPublicView(rawReport, isAdmin);

      res.status(200).json(
        createSuccessResponse({
          ...report,
          demoMode: isAdminCostDemoModeEnabled(),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/ai-costs/export
 * On-demand 4-Sheet Excel (.xlsx) Export for AI Token & Cost Budget Management
 */
adminRouter.get(
  '/ai-costs/export',
  requireAdminCostAnalyticsMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const presetRaw = typeof req.query.preset === 'string' ? req.query.preset.trim().toUpperCase() : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
      const model = typeof req.query.model === 'string' ? req.query.model.trim() : undefined;
      const gameType = typeof req.query.gameType === 'string' ? req.query.gameType.trim() : undefined;
      const taskType = typeof req.query.taskType === 'string' ? req.query.taskType.trim() : undefined;
      const questionCount =
        typeof req.query.questionCount === 'string'
          ? req.query.questionCount.trim()
          : typeof req.query.requestedQuestions === 'string'
            ? req.query.requestedQuestions.trim()
            : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;

      const rawReport = aiObservabilityService.getAdminAiCostReport({
        preset: (presetRaw as any) || undefined,
        from,
        to,
        model,
        gameType,
        taskType,
        questionCount,
        status,
      });
      const isAdmin = req.user?.role === 'ADMIN';
      const report = sanitizeAiCostReportForPublicView(rawReport, isAdmin);

      const formatRaw = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : undefined;
      const modeRaw = typeof req.query.mode === 'string' ? req.query.mode.trim().toLowerCase() : undefined;

      const exported =
        formatRaw === 'csv' || modeRaw === 'game-creations'
          ? exportService.exportGameCreationCostReport(report, formatRaw === 'csv' ? 'csv' : 'xlsx')
          : exportService.exportAdminAiCostReportExcel(report);
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.status(200).send(exported.body);
    } catch (err) {
      next(err);
    }
  }
);

// Apply requireAdminMiddleware to all remaining routes in this router
adminRouter.use(requireAdminMiddleware);

/**
 * GET /api/admin/overview
 * Real administrative platform statistics
 */
adminRouter.get('/overview', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = persistenceRepo.getAdminOverview();
    const activeRooms = roomStore.getAll().map((r) => ({
      roomCode: r.roomCode,
      roomId: r.roomId,
      title: r.gameSpecification.title,
      state: r.state,
      playerCount: r.players.size,
      currentQuestionIndex: r.currentQuestionIndex,
      totalQuestions: r.gameSpecification.questions.length,
    }));

    res.status(200).json(
      createSuccessResponse({
        ...stats,
        activeRoomsCount: activeRooms.length,
        activeRooms,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users
 * Real user accounts list (passwords excluded)
 */
adminRouter.get('/users', (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = persistenceRepo.getAdminUsers();
    res.status(200).json(createSuccessResponse({ users, count: users.length }));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/games
 * List all games across the platform for moderation
 */
adminRouter.get('/games', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
    const status = rawStatus === 'PUBLISHED' || rawStatus === 'DRAFT' || rawStatus === 'ALL' ? rawStatus : undefined;

    const result = persistenceRepo.listGames({
      isAdmin: true,
      scope: 'manage',
      status,
      search,
      limit,
      offset,
    });

    res.status(200).json(createSuccessResponse(result));
  } catch (err) {
    next(err);
  }
});

const UpdateGameStatusSchema = z.object({
  isPublic: z.boolean(),
});

/**
 * PATCH /api/admin/games/:gameId/status
 * Moderate game publication status (publish or unpublish)
 */
adminRouter.patch('/games/:gameId/status', (req: Request, res: Response, next: NextFunction) => {
  try {
    const gameId = String(req.params.gameId || '');
    const parse = UpdateGameStatusSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError('INVALID_REQUEST', 'Giá trị isPublic phải là true hoặc false.', 400);
    }

    const { isPublic } = parse.data;
    const stored = gameStore.get(gameId);
    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);

    if (!stored && !ownerInfo) {
      throw new AppError('GAME_NOT_FOUND', `Game "${gameId}" không tồn tại.`, 404);
    }

    if (stored) {
      stored.isPublic = isPublic;
      gameStore.save(stored, Date.now(), stored.ownerUserId, isPublic);
    } else {
      persistenceRepo.setGamePublicStatus(gameId, isPublic);
    }

    res.status(200).json(
      createSuccessResponse({
        gameId,
        isPublic,
        message: isPublic ? 'Game đã được xuất bản công khai.' : 'Game đã được chuyển về bản nháp.',
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/games/:gameId
 * Administrative deletion of any game violating terms
 */
adminRouter.delete('/games/:gameId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const gameId = String(req.params.gameId || '');
    const stored = gameStore.get(gameId);
    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);

    if (!stored && !ownerInfo) {
      throw new AppError('GAME_NOT_FOUND', `Game "${gameId}" không tồn tại.`, 404);
    }

    gameStore.delete(gameId);

    res.status(200).json(
      createSuccessResponse({
        deleted: true,
        gameId,
        message: 'Game đã được xóa thành công bởi Quản trị viên.',
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/rooms
 * View active multiplayer rooms
 */
adminRouter.get('/rooms', (req: Request, res: Response, next: NextFunction) => {
  try {
    const activeRooms = roomStore.getAll().map((r) => r.getLobbyInfo());
    const historicalRooms = persistenceRepo.listRoomHistory({ limit: 20 });
    res.status(200).json(
      createSuccessResponse({
        activeRooms,
        historicalRooms,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/ai-logs
 * View real AI operational logs with optional filtering
 */
adminRouter.get('/ai-logs', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId.trim() : undefined;
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : undefined;
    const operation = typeof req.query.operation === 'string' ? req.query.operation.trim() : undefined;

    const logs = persistenceRepo.getAdminAiLogs({
      limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
      from,
      to,
      gameId,
      model,
      operation,
    });
    res.status(200).json(createSuccessResponse({ logs, count: logs.length }));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/ai-logs/export
 * Export AI usage logs in CSV or Excel (.xlsx) format
 */
adminRouter.get('/ai-logs/export', (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawFormat = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'csv';
    const format: 'csv' | 'xlsx' = rawFormat === 'xlsx' ? 'xlsx' : 'csv';
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId.trim() : undefined;
    const model = typeof req.query.model === 'string' ? req.query.model.trim() : undefined;
    const operation = typeof req.query.operation === 'string' ? req.query.operation.trim() : undefined;

    const logs = persistenceRepo.getAdminAiLogs({
      limit: 1000,
      from,
      to,
      gameId,
      model,
      operation,
    });

    const exported = exportService.exportAdminAiUsageLogs(logs, format);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.status(200).send(exported.body);
  } catch (err) {
    next(err);
  }
});



