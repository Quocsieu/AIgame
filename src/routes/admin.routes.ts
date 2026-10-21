import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { gameStore } from '../game/game.store.js';
import { requireAdminMiddleware } from '../middleware/auth.middleware.js';
import { roomStore } from '../multiplayer/room.store.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const adminRouter = Router();

// Apply requireAdminMiddleware to all routes in this router
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
 * View real AI operational logs
 */
adminRouter.get('/ai-logs', (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = persistenceRepo.getAdminAiLogs(50);
    res.status(200).json(createSuccessResponse({ logs, count: logs.length }));
  } catch (err) {
    next(err);
  }
});

