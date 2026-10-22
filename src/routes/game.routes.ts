import { Router, Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import {
  GameSpecificationSchema,
  GenerateGameRequestSchema,
  UpdateGameQuestionsRequestSchema,
} from '../contracts/game.contract.js';
import { gameStore, sessionStore } from '../game/game.store.js';
import { gameDeleteRateLimiter, generateRateLimiter } from '../middleware/rateLimiter.js';
import { rejectGuestOrPlayerWrite } from '../middleware/auth.middleware.js';
import { roomStore } from '../multiplayer/room.store.js';
import { aiQuestionService } from '../services/ai.question.service.js';
import { authService } from '../services/auth.service.js';
import { exportService, ExportFormat } from '../services/export.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { sourceStore } from '../storage/source.store.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';
import { sessionRouter } from './game.session.routes.js';

export const gameRouter = Router();

// Mount Day 3 Game Session Router
gameRouter.use('/sessions', sessionRouter);

function buildSoloPlayUrl(req: Request, gameId: string): string {
  const frontendUrl = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (frontendUrl) {
    return `${frontendUrl}/?play=${encodeURIComponent(gameId)}`;
  }
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}/?play=${encodeURIComponent(gameId)}`;
}

/**
 * GET /api/games
 * List saved game specifications scoped to the authenticated user (or guest/demo/public scope).
 */
gameRouter.get(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const gameType =
        typeof req.query.gameType === 'string' && req.query.gameType.trim()
          ? req.query.gameType.trim()
          : undefined;
      const search =
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const rawStatus =
        typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
      const status =
        rawStatus === 'PUBLISHED' || rawStatus === 'DRAFT' || rawStatus === 'ALL'
          ? rawStatus
          : undefined;
      const rawScope =
        typeof req.query.scope === 'string' ? req.query.scope.trim().toLowerCase() : undefined;
      const scope = rawScope === 'public' ? 'public' : rawScope === 'mine' ? 'mine' : 'manage';

      const result = persistenceRepo.listGames({
        userId: req.user?.userId ?? null,
        isAdmin: req.user?.role === 'ADMIN',
        scope,
        status,
        gameType,
        search,
        limit,
        offset,
      });

      res.status(200).json(createSuccessResponse(result));
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.post(
  '/generate',
  generateRateLimiter.middleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'tạo game bằng AI');

      // 1. Validate request body against Zod schema
      const parseResult = GenerateGameRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new AppError('INVALID_REQUEST', `Request validation failed: ${issues}`, 400);
      }

      const requestData = parseResult.data;

      // 2. Retrieve normalized source content from sources passback or store fallback
      const sourceIds: string[] = requestData.sourceIds || (requestData.sourceId ? [requestData.sourceId] : []);

      // Verify ownership access on stored sources if any
      for (const sid of sourceIds) {
        const sourceOwnerId = sourceStore.getOwnerUserId(sid);
        if (sourceOwnerId) {
          authService.assertResourceAccess({
            resourceType: 'tài liệu nguồn',
            ownerUserId: sourceOwnerId,
            currentUser: req.user,
            mode: 'read',
          });
        }
      }

      const documents =
        requestData.sources && requestData.sources.length > 0
          ? requestData.sources
          : sourceStore.getMany(sourceIds);

      if (documents.length === 0) {
        throw new AppError(
          'SOURCE_NOT_FOUND',
          `None of the requested source IDs (${sourceIds.join(', ')}) were found in the system. Please ingest source content first.`,
          404
        );
      }

      // Enforce per-user / per-guest daily quotas when identified
      if (req.user) {
        quotaService.consumeUserQuota(req.user.userId, 'DAILY_GAME_GENERATIONS', 1);
        quotaService.consumeUserQuota(req.user.userId, 'DAILY_AI_CALLS', 1);
      }

      // 3 & 4 & 5. Build bounded AI input, generate, validate structured output
      const gameSpecification = await aiQuestionService.generateGame(documents, requestData, {
        userId: req.user?.userId ?? null,
      });

      // Save generated specification in store and SQLite persistence as draft (isPublic = false)
      gameStore.save(gameSpecification, Date.now(), req.user?.userId ?? null, false);

      // 6. Return validated GameSpecification
      const savedSpec = gameStore.get(gameSpecification.gameId) || {
        ...gameSpecification,
        ownerUserId: req.user?.userId ?? null,
        isPublic: false,
      };
      res.status(200).json(
        createSuccessResponse(savedSpec)
      );
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.get(
  '/:gameId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }
      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (String(req.query.mode || '').toLowerCase() === 'public' && !isPublic) {
        throw new AppError(
          'GAME_NOT_PUBLISHED',
          'Game này chưa được xuất bản nên không thể mở ở chế độ chơi công khai.',
          403
        );
      }

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'read',
        isPublic,
      });

      res.status(200).json(
        createSuccessResponse({
          ...spec,
          ownerUserId,
          isPublic,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

function handleUpdateGameSpecification(req: Request, res: Response, next: NextFunction): void {
  try {
    rejectGuestOrPlayerWrite(req, 'chỉnh sửa hoặc xuất bản game');

    const gameId = String(req.params.gameId || '');
    const existing = gameStore.get(gameId);
    if (!existing) {
      throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
    }

    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    const ownerUserId = existing.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
    const existingIsPublic = existing.isPublic ?? ownerInfo?.isPublic ?? false;

    authService.assertResourceAccess({
      resourceType: 'bộ câu hỏi',
      ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const parseResult = UpdateGameQuestionsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new AppError('INVALID_REQUEST', `Question validation failed: ${issues}`, 400);
    }

    const { title, description, questions, settings, isPublic } = parseResult.data;

    // Ensure all edited questions match the game's type unless gameType is MIXED
    if (existing.gameType !== 'MIXED') {
      for (let i = 0; i < questions.length; i++) {
        if (questions[i].type !== existing.gameType) {
          throw new AppError(
            'INVALID_REQUEST',
            `Question #${i + 1} type "${questions[i].type}" does not match gameType "${existing.gameType}".`,
            400
          );
        }
      }
    }

    const resolvedIsPublic = isPublic !== undefined ? isPublic : existingIsPublic;

    const updatedSpec = GameSpecificationSchema.parse({
      ...existing,
      ownerUserId,
      isPublic: resolvedIsPublic,
      title: title !== undefined ? title : existing.title,
      description:
        description !== undefined
          ? description.length > 0
            ? description
            : existing.description
          : existing.description,
      questions,
      settings: {
        ...existing.settings,
        ...(settings?.timePerQuestion !== undefined ? { timePerQuestion: settings.timePerQuestion } : {}),
        ...(settings?.scoringMode !== undefined ? { scoringMode: settings.scoringMode } : {}),
        ...(settings?.mixedDistribution !== undefined ? { mixedDistribution: settings.mixedDistribution } : {}),
        questionCount: questions.length,
      },
    });

    gameStore.save(updatedSpec, Date.now(), ownerUserId, resolvedIsPublic);
    res.status(200).json(
      createSuccessResponse(updatedSpec)
    );
  } catch (err) {
    next(err);
  }
}

gameRouter.patch('/:gameId/questions', handleUpdateGameSpecification);
gameRouter.patch('/:gameId', handleUpdateGameSpecification);

/**
 * DELETE /api/games
 * Safely deletes all saved game specifications owned by the caller (or all manageable games if admin),
 * skipping any game currently locked by an active practice session or multiplayer room.
 */
gameRouter.delete(
  '/',
  gameDeleteRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa tất cả game');

      const isUserAdmin = req.user?.role === 'ADMIN';
      const userId = req.user?.userId ?? null;

      const gameIds = persistenceRepo.getGameIdsForUser({
        userId,
        isAdmin: isUserAdmin,
      });

      let deletedCount = 0;
      let skippedActiveCount = 0;

      for (const gameId of gameIds) {
        if (sessionStore.hasActiveSessionForGame(gameId) || roomStore.hasActiveRoomForGame(gameId)) {
          skippedActiveCount++;
          continue;
        }
        gameStore.delete(gameId);
        deletedCount++;
      }

      res.status(200).json(
        createSuccessResponse({
          deleted: true,
          deletedCount,
          skippedActiveCount,
          totalTargeted: gameIds.length,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games/:gameId
 * Safely deletes a saved game specification if owned by the caller and not currently in an active session/room.
 */
gameRouter.delete(
  '/:gameId',
  gameDeleteRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa game');

      const gameId = String(req.params.gameId || '');
      const existing = gameStore.get(gameId);
      if (!existing) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = existing.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'write',
      });

      if (sessionStore.hasActiveSessionForGame(gameId) || roomStore.hasActiveRoomForGame(gameId)) {
        throw new AppError(
          'GAME_IN_USE',
          'Không thể xóa bộ câu hỏi đang có phiên luyện tập hoặc phòng chơi trực tiếp đang diễn ra.',
          409
        );
      }

      gameStore.delete(gameId);
      res.status(200).json(
        createSuccessResponse({
          deleted: true,
          gameId,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/qr
 * Generate a real QR code and public solo-play link for a published game.
 */
gameRouter.get(
  '/:gameId/qr',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (!isPublic) {
        throw new AppError(
          'GAME_NOT_PUBLISHED',
          'Game này chưa được xuất bản nên không thể tạo liên kết và mã QR chơi công khai.',
          403
        );
      }

      const playUrl = buildSoloPlayUrl(req, gameId);
      const qrDataUrl = await QRCode.toDataURL(playUrl, {
        margin: 1,
        width: 256,
        errorCorrectionLevel: 'M',
      });

      res.status(200).json(
        createSuccessResponse({
          gameId,
          title: spec.title,
          playUrl,
          qrDataUrl,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/export?format=csv|json
 * Export question set in CSV or JSON format.
 */
gameRouter.get(
  '/:gameId/export',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const rawFormat = String(req.query.format || 'json').toLowerCase();
      if (rawFormat !== 'csv' && rawFormat !== 'json') {
        throw new AppError('INVALID_EXPORT_FORMAT', `Unsupported export format "${rawFormat}". Supported formats: csv, json.`, 400);
      }
      const format: ExportFormat = rawFormat;

      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'read',
        isPublic,
      });

      const payload = exportService.exportGameQuestions(spec, format);
      res.setHeader('Content-Type', payload.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
      res.status(200).send(payload.body);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/history
 * Retrieve practice sessions and multiplayer room history for a specific game.
 */
gameRouter.get(
  '/:gameId/history',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      authService.assertResourceAccess({
        resourceType: 'lịch sử bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'read',
        isPublic,
      });

      const practiceSessions = persistenceRepo.listPracticeSessions({
        gameId,
        userId: ownerUserId ?? null,
        limit: 50,
      });

      const roomHistory = persistenceRepo.listRoomHistory({
        gameId,
        userId: ownerUserId ?? null,
        limit: 50,
      });

      res.status(200).json(
        createSuccessResponse({
          gameId,
          title: spec.title,
          gameType: spec.gameType,
          practiceSessions,
          roomHistory,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);
