import { NextFunction, Request, Response, Router } from 'express';
import { gameEngine } from '../game/game.engine.js';
import { gameStore } from '../game/game.store.js';
import {
  CreateSessionRequestSchema,
  SubmitAnswerRequestSchema,
} from '../game/game.types.js';
import { authService } from '../services/auth.service.js';
import { exportService, ExportFormat } from '../services/export.service.js';
import { gamePasswordService } from '../services/game.password.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const sessionRouter = Router();

/**
 * POST /api/games/sessions
 * Create a new single-player game session.
 */
sessionRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = CreateSessionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new AppError('INVALID_REQUEST', `Invalid session creation request: ${issues}`, 400);
    }

    const { gameId, gameSpecification, publicPlay } = parseResult.data;

    // Verify draft access: public play MUST be on a published game
    const storedSpec = gameStore.get(gameId);
    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    const resolvedIsPublic = storedSpec?.isPublic ?? ownerInfo?.isPublic ?? gameSpecification?.isPublic ?? false;
    const resolvedOwnerUserId = storedSpec?.ownerUserId ?? ownerInfo?.ownerUserId ?? gameSpecification?.ownerUserId ?? null;

    if (publicPlay && !resolvedIsPublic) {
      throw new AppError(
        'GAME_NOT_PUBLISHED',
        'Game này chưa được xuất bản nên không thể bắt đầu phiên chơi công khai.',
        403
      );
    }

    // Verify password protection if the game is password-protected
    const isPasswordProtected = storedSpec?.passwordProtected ?? ownerInfo?.passwordProtected ?? false;
    if (isPasswordProtected && !gamePasswordService.hasAccess(req, gameId)) {
      throw new AppError(
        'PASSWORD_REQUIRED',
        'Bộ câu hỏi này được bảo vệ bằng mật khẩu. Vui lòng xác thực mật khẩu trước khi bắt đầu chơi.',
        401
      );
    }

    // If game is draft (unpublished), caller MUST be owner or Admin to preview/play
    if (!resolvedIsPublic) {
      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId: resolvedOwnerUserId,
        currentUser: req.user,
        mode: 'read',
        isPublic: false,
      });
    }

    if (req.user) {
      quotaService.enforceActiveSessionLimit(req.user.userId);
    }

    // Do not allow client-supplied custom specification to overwrite stored game
    const customSpecToUse = storedSpec ? undefined : gameSpecification;
    const session = gameEngine.createSession(gameId, customSpecToUse, req.user?.userId ?? null);

    res.status(200).json(
      createSuccessResponse({
        sessionId: session.sessionId,
        gameId: session.specification.gameId,
        state: session.state,
        totalQuestions: session.specification.questions.length,
        isPreview: !resolvedIsPublic,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/sessions/:sessionId/start
 * Starts the session and returns the first question without answer leakage.
 */
sessionRouter.post('/:sessionId/start', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const startResult = gameEngine.start(sessionId);

    res.status(200).json(createSuccessResponse(startResult));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/games/sessions/:sessionId
 * Returns the current session state and score summary.
 */
sessionRouter.get('/:sessionId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'read',
    });

    res.status(200).json(createSuccessResponse(session.getSummary()));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/games/sessions/:sessionId/question
 * Returns the active question without authoritative correctAnswer.
 */
sessionRouter.get('/:sessionId/question', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'read',
    });

    const question = gameEngine.getCurrentQuestion(sessionId);

    res.status(200).json(createSuccessResponse(question));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/sessions/:sessionId/answer
 * Submits player answer, performs server-side validation and scoring.
 */
sessionRouter.post('/:sessionId/answer', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const parseResult = SubmitAnswerRequestSchema.safeParse(req.body);

    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new AppError('INVALID_REQUEST', `Invalid answer submission: ${issues}`, 400);
    }

    const { questionId, answer, clientTimestamp } = parseResult.data;
    const answerResult = gameEngine.submitAnswer(sessionId, questionId, answer, clientTimestamp);

    res.status(200).json(createSuccessResponse(answerResult));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/sessions/:sessionId/next
 * Advances to the next question or finishes the game session.
 */
sessionRouter.post('/:sessionId/next', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const advanceResult = gameEngine.advance(sessionId);

    res.status(200).json(createSuccessResponse(advanceResult));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/games/sessions/:sessionId/result
 * Returns final game result. Throws if game is not finished yet.
 */
sessionRouter.get('/:sessionId/result', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    try {
      const activeSession = gameEngine.getSession(sessionId);
      authService.assertResourceAccess({
        resourceType: 'kết quả phiên luyện tập',
        ownerUserId: activeSession.ownerUserId,
        currentUser: req.user,
        mode: 'read',
      });
      const result = gameEngine.getResult(sessionId);
      res.status(200).json(createSuccessResponse(result));
      return;
    } catch (innerErr) {
      if (innerErr instanceof AppError && innerErr.code !== 'SESSION_NOT_FOUND') {
        throw innerErr;
      }
    }

    // Fallback to persisted practice session result if evicted from active memory or after server restart
    const persisted = persistenceRepo.getPracticeSessionById(sessionId);
    if (!persisted) {
      throw new AppError('SESSION_NOT_FOUND', `Game session "${sessionId}" was not found.`, 404);
    }
    authService.assertResourceAccess({
      resourceType: 'kết quả phiên luyện tập',
      ownerUserId: persisted.ownerUserId,
      currentUser: req.user,
      mode: 'read',
    });

    if (persisted.state !== 'FINISHED') {
      throw new AppError('GAME_NOT_FINISHED', 'Game session is not finished yet.', 400);
    }

    res.status(200).json(
      createSuccessResponse({
        sessionId: persisted.sessionId,
        gameId: persisted.gameId,
        title: persisted.gameTitle,
        gameType: persisted.gameType,
        state: 'FINISHED',
        totalScore: persisted.totalScore,
        maxPossibleScore: persisted.maxPossibleScore,
        correctAnswers: persisted.correctAnswers,
        wrongAnswers: persisted.wrongAnswers,
        totalQuestions: persisted.totalQuestions,
        maxStreak: persisted.maxStreak,
        durationMs: persisted.durationMs,
        questionResults: persisted.questionResults,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/games/sessions/:sessionId/export?format=csv|json
 * Export completed practice session result in CSV or JSON format.
 */
sessionRouter.get('/:sessionId/export', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const rawFormat = String(req.query.format || 'json').toLowerCase();
    if (rawFormat !== 'csv' && rawFormat !== 'json') {
      throw new AppError('INVALID_EXPORT_FORMAT', `Unsupported export format "${rawFormat}". Supported formats: csv, json.`, 400);
    }
    const format: ExportFormat = rawFormat;

    const persisted = persistenceRepo.getPracticeSessionById(sessionId);
    if (!persisted || persisted.state !== 'FINISHED') {
      // Check if session exists in active memory
      try {
        const activeSession = gameEngine.getSession(sessionId);
        authService.assertResourceAccess({
          resourceType: 'phiên luyện tập',
          ownerUserId: activeSession.ownerUserId,
          currentUser: req.user,
          mode: 'read',
        });
        if (activeSession.state !== 'FINISHED') {
          throw new AppError('SESSION_NOT_FINISHED', 'Cannot export session before it is finished.', 400);
        }
      } catch (innerErr) {
        if (innerErr instanceof AppError && innerErr.code !== 'SESSION_NOT_FOUND') {
          throw innerErr;
        }
      }
      throw new AppError('SESSION_NOT_FOUND', `Completed practice session "${sessionId}" not found.`, 404);
    }

    authService.assertResourceAccess({
      resourceType: 'kết quả phiên luyện tập',
      ownerUserId: persisted.ownerUserId,
      currentUser: req.user,
      mode: 'read',
    });

    const payload = exportService.exportPracticeSession(persisted, format);
    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
    res.status(200).send(payload.body);
  } catch (err) {
    next(err);
  }
});
