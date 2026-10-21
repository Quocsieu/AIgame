import { NextFunction, Request, Response, Router } from 'express';
import QRCode from 'qrcode';
import { gameStore } from '../game/game.store.js';
import { rejectGuestOrPlayerWrite } from '../middleware/auth.middleware.js';
import { roomCreateRateLimiter } from '../middleware/rateLimiter.js';
import { roomService } from '../multiplayer/room.service.js';
import { CreateRoomRequestSchema } from '../multiplayer/room.types.js';
import { authService } from '../services/auth.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const roomRouter = Router();

/**
 * Helper to construct the browser join URL for a room.
 */
function buildJoinUrl(req: Request, roomCode: string): string {
  const frontendUrl = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');

  if (frontendUrl) {
    return `${frontendUrl}/?room=${roomCode}`;
  }

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}/?room=${roomCode}`;
}

/**
 * POST /api/rooms
 * Create a new multiplayer room.
 */
roomRouter.post('/', roomCreateRateLimiter.middleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    rejectGuestOrPlayerWrite(req, 'mở phòng multiplayer');

    const parseResult = CreateRoomRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new AppError('INVALID_REQUEST', `Invalid room creation request: ${issues}`, 400);
    }

    const { gameId, gameSpecification, capacity, requirePublished } = parseResult.data;

    let spec = gameSpecification;
    if (!spec) {
      spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game with ID "${gameId}" was not found. Please provide gameSpecification or ingest/generate first.`, 404);
      }
      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (requirePublished && !isPublic) {
        throw new AppError(
          'GAME_NOT_PUBLISHED',
          'Game này chưa được xuất bản nên không thể mở phòng chơi nhiều người.',
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
    } else if (requirePublished && !spec.isPublic) {
      throw new AppError(
        'GAME_NOT_PUBLISHED',
        'Game này chưa được xuất bản nên không thể mở phòng chơi nhiều người.',
        403
      );
    }

    if (req.user) {
      quotaService.enforceActiveRoomLimit(req.user.userId);
    }

    const room = roomService.createRoom(spec, capacity, req.user?.userId ?? null);
    const joinUrl = buildJoinUrl(req, room.roomCode);

    res.status(200).json(
      createSuccessResponse({
        roomId: room.roomId,
        roomCode: room.roomCode,
        hostToken: room.hostToken,
        joinUrl,
        capacity: room.capacity,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode
 * Retrieve safe public lobby information.
 */
roomRouter.get('/:roomCode', (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomCode = String(req.params.roomCode).trim().toUpperCase();
    const room = roomService.getRoomByCode(roomCode);

    res.status(200).json(createSuccessResponse(room.getLobbyInfo()));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode/qr
 * Generate a local QR code encoding the player join URL.
 * NEVER exposes hostToken in the QR code.
 */
roomRouter.get('/:roomCode/qr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomCode = String(req.params.roomCode).trim().toUpperCase();
    const room = roomService.getRoomByCode(roomCode);

    const joinUrl = buildJoinUrl(req, room.roomCode);

    // Generate local QR Data URL encoding joinUrl
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 256,
      errorCorrectionLevel: 'M',
    });

    res.status(200).json(
      createSuccessResponse({
        roomCode: room.roomCode,
        joinUrl,
        qrDataUrl,
      })
    );
  } catch (err) {
    next(err);
  }
});
