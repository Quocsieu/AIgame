import { Router, Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import {
  ADVENTURE_THEME_PRESETS,
  analyzeSourceContentForAdventure,
  INDUSTRY_CATALOG,
  IndustryIdEnum,
  sanitizeAdventureConfig,
} from '../contracts/adventure.contract.js';
import {
  GameSpecificationSchema,
  GenerateGameRequestSchema,
  UpdateGameQuestionsRequestSchema,
} from '../contracts/game.contract.js';
import { gameStore, sessionStore } from '../game/game.store.js';
import { gameDeleteRateLimiter, generateRateLimiter } from '../middleware/rateLimiter.js';
import { rejectGuestOrPlayerWrite } from '../middleware/auth.middleware.js';
import { roomStore } from '../multiplayer/room.store.js';
import {
  cleanupOrphanedAdventureGameAssets,
  listVerifiedAdventureAssetPacks,
  provisionAdventureAssetsForGame,
  resolveAdventureAssetPack,
  verifyAdventureGameAssets,
} from '../services/adventure-asset-pack.service.js';
import { aiImageService } from '../services/ai.image.service.js';
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

export interface GameActiveStatus {
  gameId: string;
  hasActiveSession: boolean;
  activeSessionCount: number;
  activeSessions: Array<{
    sessionId: string;
    state: string;
    startedAt: string | null;
  }>;
  hasActiveRoom: boolean;
  activeRoomCount: number;
  activeRooms: Array<{
    roomId: string;
    roomCode: string;
    state: string;
    playerCount: number;
    createdAt: number;
  }>;
  isDeletable: boolean;
}

export function computeGameActiveStatus(gameId: string): GameActiveStatus {
  const activeSessions = sessionStore.getActiveSessionsForGame(gameId);
  const activeRooms = roomStore.getActiveRoomsForGame(gameId);

  const hasActiveSession = activeSessions.length > 0;
  const hasActiveRoom = activeRooms.length > 0;

  return {
    gameId,
    hasActiveSession,
    activeSessionCount: activeSessions.length,
    activeSessions: activeSessions.map((s) => ({
      sessionId: s.sessionId,
      state: s.state,
      startedAt: s.startedAt,
    })),
    hasActiveRoom,
    activeRoomCount: activeRooms.length,
    activeRooms: activeRooms.map((r) => ({
      roomId: r.roomId,
      roomCode: r.roomCode,
      state: r.state,
      playerCount: r.players.size,
      createdAt: r.createdAt,
    })),
    isDeletable: !hasActiveSession && !hasActiveRoom,
  };
}

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

      const enrichedGames = result.games.map((game) => ({
        ...game,
        activeStatus: computeGameActiveStatus(game.gameId),
      }));

      const activeCount = (result.scopeGameIds || []).filter(
        (gid) =>
          sessionStore.hasActiveSessionForGame(gid) || roomStore.hasActiveRoomForGame(gid)
      ).length;

      res.status(200).json(
        createSuccessResponse({
          games: enrichedGames,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore,
          counts: {
            ...result.counts,
            activeCount,
          },
        })
      );
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
      const sourceIds: string[] = Array.from(
        new Set(
          [
            ...(Array.isArray(requestData.sourceIds) ? requestData.sourceIds : []),
            ...(typeof requestData.sourceId === 'string' ? [requestData.sourceId] : []),
            ...(Array.isArray(requestData.sources)
              ? requestData.sources.map(s => s?.sourceId)
              : []),
          ]
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id.length > 0)
        )
      );

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

      const validInlineSources = Array.isArray(requestData.sources)
        ? requestData.sources.filter(
            doc => doc && typeof doc.sourceId === 'string' && doc.sourceId.trim().length > 0
          )
        : [];
      const storedDocuments = sourceStore.getMany(sourceIds);
      const documents =
        validInlineSources.length > 0 ? validInlineSources : storedDocuments;

      if (documents.length === 0) {
        if (sourceIds.length === 0) {
          throw new AppError(
            'INVALID_REQUEST',
            'Request validation failed: sourceId: Either "sourceId", "sourceIds", or "sources" must be provided.',
            400
          );
        }
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
      const rawGameSpecification = await aiQuestionService.generateGame(documents, requestData, {
        userId: req.user?.userId ?? null,
      });

      let gameSpecification = rawGameSpecification;
      if (gameSpecification.gameType === 'ADVENTURE') {
        const assetProvision = await provisionAdventureAssetsForGame(gameSpecification, {
          userId: req.user?.userId ?? null,
        });
        gameSpecification = assetProvision.specification;
      }

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
  '/adventure/catalog',
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(
        createSuccessResponse({
          industries: INDUSTRY_CATALOG,
          themePresets: ADVENTURE_THEME_PRESETS,
          verifiedAssetPacks: listVerifiedAdventureAssetPacks(),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.post(
  '/adventure/analyze',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const sourceIds: string[] = Array.from(
        new Set(
          [
            ...(Array.isArray(body.sourceIds) ? body.sourceIds : []),
            ...(typeof body.sourceId === 'string' ? [body.sourceId] : []),
            ...(Array.isArray(body.sources) ? body.sources.map((s: any) => s?.sourceId) : []),
          ]
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id.length > 0)
        )
      );
      const documents =
        Array.isArray(body.sources) && body.sources.length > 0
          ? body.sources
          : sourceStore.getMany(sourceIds);

      const parsedIndustry = IndustryIdEnum.safeParse(body.preferredIndustryId);
      const preferredIndustryId = parsedIndustry.success ? parsedIndustry.data : undefined;

      const proposal = analyzeSourceContentForAdventure(documents, {
        preferredIndustryId,
        customIndustryLabel:
          typeof body.customIndustryLabel === 'string' ? body.customIndustryLabel : undefined,
        topicFocus: typeof body.topicFocus === 'string' ? body.topicFocus : undefined,
        questionCount: typeof body.questionCount === 'number' ? body.questionCount : 5,
      });

      res.status(200).json(createSuccessResponse(proposal));
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
      const coverMeta = persistenceRepo.getGameCoverMetadata(gameId);
      const coverImageUrl = spec.coverImageUrl ?? coverMeta?.coverImageUrl ?? null;

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
          ...(coverImageUrl ? { coverImageUrl } : {}),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

async function handleUpdateGameSpecification(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const { title, description, questions, settings, isPublic, coverImageUrl, generateCover } = parseResult.data;

    // Ensure all edited questions match the game's type (including canonical/legacy aliases) unless gameType is MIXED or ADVENTURE
    if (existing.gameType !== 'MIXED' && existing.gameType !== 'ADVENTURE') {
      const isEquivalentType = (gType: string, qType: string): boolean => {
        if (gType === qType) return true;
        if ((gType === 'QUIZ' || gType === 'MULTIPLE_CHOICE') && (qType === 'QUIZ' || qType === 'MULTIPLE_CHOICE')) return true;
        if ((gType === 'TRUE_FALSE' || gType === 'QUICK_BUTTON') && (qType === 'TRUE_FALSE' || qType === 'QUICK_BUTTON')) return true;
        if ((gType === 'TYPE_ANSWER' || gType === 'FILL_IN_THE_BLANK') && (qType === 'TYPE_ANSWER' || qType === 'FILL_IN_THE_BLANK')) return true;
        return false;
      };
      for (let i = 0; i < questions.length; i++) {
        if (!isEquivalentType(existing.gameType, questions[i].type)) {
          throw new AppError(
            'INVALID_REQUEST',
            `Question #${i + 1} type "${questions[i].type}" does not match gameType "${existing.gameType}".`,
            400
          );
        }
      }
    }

    const resolvedIsPublic = isPublic !== undefined ? isPublic : existingIsPublic;
    const coverMeta = persistenceRepo.getGameCoverMetadata(gameId);
    const resolvedCoverUrl =
      coverImageUrl !== undefined
        ? coverImageUrl
        : existing.coverImageUrl ?? coverMeta?.coverImageUrl ?? null;

    const updatedSpec = GameSpecificationSchema.parse({
      ...existing,
      ownerUserId,
      isPublic: resolvedIsPublic,
      ...(resolvedCoverUrl ? { coverImageUrl: resolvedCoverUrl } : {}),
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
        ...(settings?.adventureConfig !== undefined
          ? {
              adventureConfig: sanitizeAdventureConfig(
                settings.adventureConfig,
                existing.settings.adventureConfig ||
                  analyzeSourceContentForAdventure([], {
                    questionCount: questions.length,
                    questions,
                  }),
                questions
              ),
            }
          : existing.settings.adventureConfig
            ? {
                adventureConfig: sanitizeAdventureConfig(
                  existing.settings.adventureConfig,
                  existing.settings.adventureConfig,
                  questions
                ),
              }
            : {}),
        questionCount: questions.length,
      },
    });

    if (updatedSpec.gameType === 'ADVENTURE' && updatedSpec.settings.adventureConfig) {
      const existingAdv = existing.settings?.adventureConfig;
      const incomingAdv = settings?.adventureConfig;
      const currentAdv = updatedSpec.settings.adventureConfig;
      const isLegacyAdventure =
        existingAdv?.assetStatus === undefined &&
        (existingAdv?.version ?? 1) < 2 &&
        incomingAdv?.assetStatus === undefined &&
        currentAdv.industryId !== 'CUSTOM';

      if (!isLegacyAdventure) {
        const nowIso = new Date().toISOString();

        // Never trust client-supplied asset metadata alone; prefer existing server-verified assets for the same industryId
        if (
          existingAdv?.assets &&
          existingAdv.assets.background.industryId === currentAdv.industryId &&
          existingAdv.assets.character.industryId === currentAdv.industryId &&
          existingAdv.assets.obstacle.industryId === currentAdv.industryId
        ) {
          currentAdv.assets = existingAdv.assets;
          currentAdv.assetPackSource = existingAdv.assetPackSource ?? existingAdv.assets.background.source;
        }

        let checkResult = verifyAdventureGameAssets(updatedSpec);

        // If industry is one of the 8 pre-defined industries and not yet verified (e.g. user changed industryId), resolve from pack
        if (!checkResult.verified && currentAdv.industryId !== 'CUSTOM') {
          const packRes = resolveAdventureAssetPack(currentAdv.industryId);
          if (packRes.verified && packRes.pack) {
            currentAdv.version = Math.max(currentAdv.version || 1, 2);
            currentAdv.assets = packRes.pack.assets;
            currentAdv.assetPackSource = 'ANTIGRAVITY_BANANA_PACK';
            currentAdv.assetStatus = 'READY';
            currentAdv.assetError = null;
            currentAdv.assetErrorCode = null;
            currentAdv.assetUpdatedAt = nowIso;
            checkResult = verifyAdventureGameAssets(updatedSpec);
          } else {
            checkResult = {
              verified: false,
              industryId: currentAdv.industryId,
              assetStatus: 'ASSET_GENERATION_FAILED',
              assets: null,
              missingAssets: packRes.missingAssets,
              errors: packRes.errors,
              errorCode: 'ASSET_PACK_INTEGRITY_ERROR',
            };
          }
        }

        if (checkResult.verified && checkResult.assets) {
          currentAdv.version = Math.max(currentAdv.version || 1, 2);
          currentAdv.assets = checkResult.assets;
          currentAdv.assetPackSource = checkResult.assets.background.source;
          currentAdv.assetStatus = 'READY';
          currentAdv.assetError = null;
          currentAdv.assetErrorCode = null;
          currentAdv.assetUpdatedAt = currentAdv.assetUpdatedAt || nowIso;
        } else {
          const errDetail =
            checkResult.errors.join('; ') ||
            existingAdv?.assetError ||
            'Chưa có đủ 3 tài nguyên hình ảnh hợp lệ (background, character, obstacle).';
          currentAdv.version = Math.max(currentAdv.version || 1, 2);
          currentAdv.assets = null;
          currentAdv.assetPackSource = null;
          currentAdv.assetStatus = 'ASSET_GENERATION_FAILED';
          currentAdv.assetError = errDetail.slice(0, 500);
          currentAdv.assetErrorCode =
            existingAdv?.assetErrorCode || checkResult.errorCode || 'ADVENTURE_ASSETS_INCOMPLETE';
          currentAdv.assetUpdatedAt = nowIso;

          // Always preserve the edited questions and draft data (isPublic = false) before rejecting completion/publish
          const draftToPreserve = {
            ...updatedSpec,
            isPublic: false,
          };
          gameStore.save(draftToPreserve, Date.now(), ownerUserId, false);

          throw new AppError(
            'ADVENTURE_ASSETS_INCOMPLETE',
            `Không thể hoàn tất lưu hoặc xuất bản game Adventure khi bộ 3 tài nguyên hình ảnh (background, character, obstacle) chưa hợp lệ hoặc chưa được tạo đầy đủ. Bộ câu hỏi nháp đã được giữ lại để bạn thử tạo ảnh lại. Chi tiết: ${currentAdv.assetError}`,
            422
          );
        }
      }
    }

    gameStore.save(updatedSpec, Date.now(), ownerUserId, resolvedIsPublic);

    // If generateCover is requested, attempt cover generation gracefully without ever failing the save/publish flow
    if (generateCover) {
      try {
        const coverResult = await aiImageService.generateCoverForGame(updatedSpec, {
          userId: req.user?.userId ?? null,
          forceRegenerate: false,
          throwOnError: false,
        });
        if (coverResult.coverImageUrl) {
          updatedSpec.coverImageUrl = coverResult.coverImageUrl;
        }
      } catch {
        // Never block game save/publish if cover generation fails or hits quota
      }
    }

    res.status(200).json(
      createSuccessResponse(updatedSpec)
    );
  } catch (err) {
    next(err);
  }
}

gameRouter.patch('/:gameId/questions', handleUpdateGameSpecification);
gameRouter.patch('/:gameId', handleUpdateGameSpecification);

async function handleRetryAdventureAssets(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    rejectGuestOrPlayerWrite(req, 'tạo lại tài nguyên hình ảnh Adventure');

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

    if (existing.gameType !== 'ADVENTURE') {
      throw new AppError(
        'INVALID_REQUEST',
        'Chỉ hỗ trợ tạo tài nguyên hình ảnh Adventure cho game thuộc thể loại ADVENTURE.',
        400
      );
    }

    const body = req.body || {};

    let updatedQuestions = existing.questions;
    let updatedTitle = existing.title;
    let updatedDescription = existing.description;

    if (Array.isArray(body.questions) && body.questions.length > 0) {
      const parseResult = UpdateGameQuestionsRequestSchema.safeParse({
        title: typeof body.title === 'string' ? body.title : existing.title,
        description: typeof body.description === 'string' ? body.description : existing.description,
        questions: body.questions,
      });
      if (parseResult.success) {
        updatedQuestions = parseResult.data.questions;
        if (parseResult.data.title) updatedTitle = parseResult.data.title;
        if (parseResult.data.description && parseResult.data.description.length > 0) {
          updatedDescription = parseResult.data.description;
        }
      }
    } else {
      if (typeof body.title === 'string' && body.title.trim().length > 0) {
        updatedTitle = body.title.trim().slice(0, 200);
      }
      if (typeof body.description === 'string' && body.description.trim().length > 0) {
        updatedDescription = body.description.trim().slice(0, 1000);
      }
    }

    const baseAdv =
      existing.settings?.adventureConfig ||
      analyzeSourceContentForAdventure([], {
        questionCount: updatedQuestions.length,
        questions: updatedQuestions,
      });

    const nextAdvInput = {
      ...baseAdv,
      ...(typeof body.industryId === 'string' ? { industryId: body.industryId } : {}),
      ...(typeof body.industryLabel === 'string' && body.industryLabel.trim()
        ? { industryLabel: body.industryLabel.trim() }
        : {}),
      ...(typeof body.subEnvironment === 'string' && body.subEnvironment.trim()
        ? { subEnvironment: body.subEnvironment.trim() }
        : {}),
    };

    const sanitizedAdv = sanitizeAdventureConfig(nextAdvInput, baseAdv, updatedQuestions);
    const candidateSpec = GameSpecificationSchema.parse({
      ...existing,
      ownerUserId,
      title: updatedTitle,
      description: updatedDescription,
      questions: updatedQuestions,
      settings: {
        ...existing.settings,
        questionCount: updatedQuestions.length,
        adventureConfig: sanitizedAdv,
      },
    });

    const forceRegenerate =
      body.forceRegenerate !== undefined ? Boolean(body.forceRegenerate) : false;

    const provisionResult = await provisionAdventureAssetsForGame(candidateSpec, {
      userId: req.user?.userId ?? null,
      forceRegenerate,
    });

    // Always persist updated specification (keeping all existing questions intact)
    const nextIsPublic = provisionResult.verified ? existingIsPublic : false;
    const savedSpec = {
      ...provisionResult.specification,
      ownerUserId,
      isPublic: nextIsPublic,
    };
    gameStore.save(savedSpec, Date.now(), ownerUserId, nextIsPublic);

    if (!provisionResult.verified) {
      const statusCode = provisionResult.errorCode === 'AI_QUOTA_EXCEEDED' ? 429 : 422;
      throw new AppError(
        provisionResult.errorCode || 'ADVENTURE_ASSETS_INCOMPLETE',
        provisionResult.errors.join('; ') ||
          'Không thể tạo bộ tài nguyên hình ảnh Adventure. Bộ câu hỏi hiện tại vẫn được giữ nguyên.',
        statusCode
      );
    }

    res.status(200).json(createSuccessResponse(savedSpec));
  } catch (err) {
    next(err);
  }
}

gameRouter.post(
  '/:gameId/adventure-assets/retry',
  generateRateLimiter.middleware,
  handleRetryAdventureAssets
);
gameRouter.post(
  '/:gameId/adventure-assets',
  generateRateLimiter.middleware,
  handleRetryAdventureAssets
);

/**
 * POST /api/games/:gameId/cover
 * Generate or regenerate a Gemini cover image for a specific game.
 * Gracefully falls back to SVG illustration if Gemini image service is unavailable.
 */
gameRouter.post(
  '/:gameId/cover',
  generateRateLimiter.middleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'tạo ảnh bìa game bằng AI');

      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'write',
      });

      const forceRegenerate = Boolean(req.body?.forceRegenerate);
      const result = await aiImageService.generateCoverForGame(spec, {
        userId: req.user?.userId ?? null,
        forceRegenerate,
        throwOnError: false,
      });

      res.status(200).json(createSuccessResponse(result));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/duplicate
 * Duplicate an existing game into the current user's library as a Draft.
 */
gameRouter.post(
  '/:gameId/duplicate',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'sao chép bộ câu hỏi');

      const gameId = String(req.params.gameId || '');
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

      const customTitle =
        typeof req.body?.title === 'string' && req.body.title.trim().length > 0
          ? req.body.title.trim()
          : undefined;

      const duplicated = persistenceRepo.duplicateGame(
        gameId,
        req.user?.userId ?? null,
        customTitle
      );

      if (!duplicated) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      gameStore.save(duplicated, Date.now(), req.user?.userId ?? null, false);
      res.status(201).json(createSuccessResponse(duplicated));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games
 * Safely deletes saved game specifications scoped strictly by authorization:
 * - Rejects Player and Guest tokens (403 ACCESS_DENIED).
 * - Requires an authenticated user session (401 UNAUTHORIZED).
 * - Regular authenticated users (USER) can only delete games they own (ownerUserId === req.user.userId).
 * - Administrators (ADMIN) can delete across the repository per admin policy.
 * - Skips and reports any game currently locked by an active practice session or multiplayer room.
 */
gameRouter.delete(
  '/',
  gameDeleteRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa hàng loạt bộ câu hỏi');

      if (!req.user || !req.user.userId) {
        throw new AppError(
          'UNAUTHORIZED',
          'Yêu cầu đăng nhập để thực hiện thao tác xóa hàng loạt bộ câu hỏi.',
          401
        );
      }

      const isAdmin = req.user.role === 'ADMIN';
      const currentUserId = req.user.userId;

      // Collect game IDs strictly scoped to the caller's permission (owner-only for USER, all for ADMIN)
      const dbGameIds = persistenceRepo.getGameIdsForUser({
        userId: currentUserId,
        isAdmin,
      });
      const memGameIds = gameStore.getAllKeys().filter((id) => {
        if (isAdmin) return true;
        const spec = gameStore.get(id);
        const ownerInfo = persistenceRepo.getGameOwnerInfo(id);
        const ownerUserId = spec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
        return ownerUserId !== null && ownerUserId === currentUserId;
      });
      const targetGameIds = Array.from(new Set([...dbGameIds, ...memGameIds]));

      let deletedCount = 0;
      let skippedActiveCount = 0;
      const skippedGames: Array<{ gameId: string; title?: string; reason: string }> = [];

      for (const gameId of targetGameIds) {
        const spec = gameStore.get(gameId);
        const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
        const ownerUserId = spec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

        // Defense-in-depth: regular users can never delete another user's game or unowned system games in bulk
        if (!isAdmin && ownerUserId !== currentUserId) {
          continue;
        }

        const hasSession = sessionStore.hasActiveSessionForGame(gameId);
        const hasRoom = roomStore.hasActiveRoomForGame(gameId);

        if (hasSession || hasRoom) {
          skippedActiveCount++;
          skippedGames.push({
            gameId,
            title: spec?.title || gameId,
            reason: hasRoom
              ? 'Phòng chơi trực tiếp đang diễn ra'
              : 'Phiên luyện tập đang hoạt động',
          });
          continue;
        }

        try {
          const coverUrl =
            spec?.coverImageUrl ?? persistenceRepo.getGameCoverMetadata(gameId)?.coverImageUrl ?? null;
          gameStore.delete(gameId);
          if (coverUrl) {
            aiImageService.cleanupOrphanedCoverImage(coverUrl);
          }
          cleanupOrphanedAdventureGameAssets(gameId, process.cwd(), (urlPrefix) =>
            persistenceRepo.countGamesByAdventureAssetPrefix(urlPrefix) > 0
          );
          deletedCount++;
        } catch (err: any) {
          // Continue deleting other games if a single game deletion encounters an unexpected error
          console.error(`[DeleteAllGames] Failed to delete game "${gameId}":`, err);
        }
      }

      res.status(200).json(
        createSuccessResponse({
          deleted: true,
          deletedCount,
          skippedActiveCount,
          totalTargeted: targetGameIds.length,
          skippedGames,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games/:gameId
 * Safely deletes a saved game specification from the game repository.
 * Enforces strict write authorization:
 * - Rejects Guest and Player tokens (403 ACCESS_DENIED).
 * - Verifies ownership via authService.assertResourceAccess(..., mode: 'write') so only the owner or ADMIN can delete an owned game.
 * - Prevents deletion of games currently in use by an active session or multiplayer room (409 GAME_IN_USE).
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

      const coverUrl =
        existing.coverImageUrl ?? persistenceRepo.getGameCoverMetadata(gameId)?.coverImageUrl ?? null;
      gameStore.delete(gameId);
      if (coverUrl) {
        aiImageService.cleanupOrphanedCoverImage(coverUrl);
      }
      cleanupOrphanedAdventureGameAssets(gameId, process.cwd(), (urlPrefix) =>
        persistenceRepo.countGamesByAdventureAssetPrefix(urlPrefix) > 0
      );
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
 * GET /api/games/:gameId/status
 * Returns active sessions and rooms for a specific game, along with deletable status.
 */
gameRouter.get('/:gameId/status', (req: Request, res: Response, next: NextFunction) => {
  try {
    const gameId = String(req.params.gameId || '');
    const spec = gameStore.get(gameId);
    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    if (!spec && !ownerInfo) {
      throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
    }

    const ownerUserId = spec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
    const isPublic = spec?.isPublic ?? ownerInfo?.isPublic ?? false;

    authService.assertResourceAccess({
      resourceType: 'bộ câu hỏi',
      ownerUserId,
      currentUser: req.user,
      mode: 'read',
      isPublic,
    });

    const activeStatus = computeGameActiveStatus(gameId);
    res.status(200).json(createSuccessResponse(activeStatus));
  } catch (err) {
    next(err);
  }
});

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
