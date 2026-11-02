import crypto from 'node:crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { gameEngine } from '../game/game.engine.js';
import { calculateMaxPossibleScore, evaluatePerformanceResult } from '../game/game.scoring.js';
import { gameStore } from '../game/game.store.js';
import {
  CreateSessionRequestSchema,
  GameResult,
  SubmitAnswerRequestSchema,
} from '../game/game.types.js';
import { authService } from '../services/auth.service.js';
import { exportService, ExportFormat } from '../services/export.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const sessionRouter = Router();

function resolveGameExamState(gameId: string, fallbackSpec?: any, currentUser?: any): {
  sessionMode: 'PLAY' | 'EXAM';
  examStatus: 'OPEN' | 'CLOSING' | 'CLOSED';
  examOpenAt: string | null;
  examCloseAt: string | null;
  examClosedAt: string | null;
  answersPublished: boolean;
  canRevealAnswers: boolean;
  autoAdvanceMs: number;
  passThresholdPercent: number;
} {
  const liveSpec = gameStore.get(gameId) || fallbackSpec;
  const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
  const ownerUserId = liveSpec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
  const sessionMode: 'PLAY' | 'EXAM' =
    liveSpec?.settings?.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
  const rawExamStatus = liveSpec?.settings?.examStatus;
  const examStatus: 'OPEN' | 'CLOSING' | 'CLOSED' =
    rawExamStatus === 'CLOSED' || rawExamStatus === 'CLOSING' ? rawExamStatus : 'OPEN';
  const examOpenAt =
    typeof liveSpec?.settings?.examOpenAt === 'string' && liveSpec.settings.examOpenAt.trim()
      ? liveSpec.settings.examOpenAt.trim()
      : null;
  const examCloseAt =
    typeof liveSpec?.settings?.examCloseAt === 'string' && liveSpec.settings.examCloseAt.trim()
      ? liveSpec.settings.examCloseAt.trim()
      : null;
  const examClosedAt =
    typeof liveSpec?.settings?.examClosedAt === 'string' && liveSpec.settings.examClosedAt.trim()
      ? liveSpec.settings.examClosedAt.trim()
      : null;
  const answersPublished = Boolean(liveSpec?.settings?.answersPublished);
  const isOwnerOrAdmin =
    Boolean(currentUser?.role === 'ADMIN') ||
    Boolean(currentUser?.userId && ownerUserId && currentUser.userId === ownerUserId);

  const canRevealAnswers = sessionMode === 'PLAY' || answersPublished;
  const autoAdvanceMs =
    typeof liveSpec?.settings?.autoAdvanceDelayMs === 'number'
      ? liveSpec.settings.autoAdvanceDelayMs
      : sessionMode === 'EXAM'
        ? 1500
        : 3500;
  const passThresholdPercent =
    typeof liveSpec?.settings?.passThresholdPercent === 'number'
      ? liveSpec.settings.passThresholdPercent
      : 50;

  return {
    sessionMode,
    examStatus,
    examOpenAt,
    examCloseAt,
    examClosedAt,
    answersPublished,
    canRevealAnswers,
    autoAdvanceMs,
    passThresholdPercent,
    ...(isOwnerOrAdmin ? { isOwnerOrAdmin: true } : {}),
  } as any;
}

function sanitizeGameResultForClient(
  result: GameResult,
  examState: {
    sessionMode: 'PLAY' | 'EXAM';
    examStatus?: 'OPEN' | 'CLOSING' | 'CLOSED';
    answersPublished: boolean;
    canRevealAnswers: boolean;
    passThresholdPercent: number;
  }
): GameResult {
  const evaluation =
    result.evaluation ||
    evaluatePerformanceResult({
      correctAnswers: result.correctCount,
      totalQuestions: result.totalQuestions,
      totalScore: result.score,
      maxPossibleScore: result.maxPossibleScore,
      sessionMode: examState.sessionMode,
      passThresholdPercent: examState.passThresholdPercent,
    });

  if (examState.canRevealAnswers) {
    return {
      ...result,
      sessionMode: examState.sessionMode,
      examStatus: examState.examStatus || 'OPEN',
      answersPublished: examState.answersPublished,
      evaluation,
    };
  }

  return {
    ...result,
    sessionMode: examState.sessionMode,
    examStatus: examState.examStatus || 'OPEN',
    answersPublished: examState.answersPublished,
    evaluation,
    questionResults: (result.questionResults || []).map(qr => ({
      questionId: qr.questionId,
      answer: qr.answer,
      isCorrect: qr.isCorrect,
      pointsEarned: qr.pointsEarned,
      responseTimeMs: qr.responseTimeMs,
      answeredAt: qr.answeredAt,
      timedOut: qr.timedOut,
      correctAnswer: '[Đáp án sẽ được công bố sau khi kết thúc kỳ thi]',
      explanation: undefined,
      sourceReference: undefined,
    })),
  };
}

/**
 * POST /api/games/sessions
 * Create or resume a single-player game session (Solo Play or Solo Exam).
 */
sessionRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = CreateSessionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new AppError('INVALID_REQUEST', `Invalid session creation request: ${issues}`, 400);
    }

    const {
      gameId,
      gameSpecification,
      publicPlay,
      participantId,
      participantName,
      playerName,
      displayName,
      departmentUnit,
      employeeCode,
      lockToken,
    } = parseResult.data;

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

    const effectiveSpec = storedSpec || gameSpecification;
    const rosterMode = effectiveSpec?.settings?.rosterMode || 'FREE_TEXT';
    const sessionMode: 'PLAY' | 'EXAM' =
      effectiveSpec?.settings?.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
    const examStatus = effectiveSpec?.settings?.examStatus || 'OPEN';

    // V3 Stage 4 & 5: Enforce examStatus and examOpenAt / examCloseAt window on backend clock
    if (examStatus === 'CLOSED' || examStatus === 'CLOSING') {
      throw new AppError(
        'EXAM_CLOSED',
        'Đợt thi này đã kết thúc, không thể bắt đầu lượt thi mới.',
        403
      );
    }

    const examOpenAtStr = effectiveSpec?.settings?.examOpenAt;
    if (typeof examOpenAtStr === 'string' && examOpenAtStr.trim()) {
      const openAtMs = Date.parse(examOpenAtStr.trim());
      if (!Number.isNaN(openAtMs) && Date.now() < openAtMs) {
        throw new AppError(
          'EXAM_NOT_OPEN_YET',
          'Đợt thi chưa đến giờ mở. Vui lòng quay lại khi đợt thi bắt đầu.',
          403
        );
      }
    }

    const examCloseAtStr = effectiveSpec?.settings?.examCloseAt;
    if (typeof examCloseAtStr === 'string' && examCloseAtStr.trim()) {
      const closeAtMs = Date.parse(examCloseAtStr.trim());
      if (!Number.isNaN(closeAtMs) && Date.now() > closeAtMs) {
        throw new AppError(
          'EXAM_CLOSED',
          'Đợt thi đã hết thời gian mở, không thể bắt đầu lượt thi mới.',
          403
        );
      }
    }

    // V3 Stage 4: In EXAM mode, participant roster is mandatory and participantId must be selected
    if (sessionMode === 'EXAM' && storedSpec) {
      const rosterCheck = persistenceRepo.listParticipants(gameId, { limit: 1 });
      if (rosterCheck.total === 0) {
        throw new AppError(
          'EXAM_ROSTER_REQUIRED',
          'Chế độ Thi cá nhân bắt buộc phải cấu hình danh sách thí sinh trước khi mở đợt thi.',
          400
        );
      }
      if (!participantId) {
        throw new AppError(
          'PARTICIPANT_REQUIRED',
          'Ở chế độ Thi cá nhân, thí sinh bắt buộc phải chọn tên trong danh sách và xác nhận danh tính trước khi bắt đầu.',
          400
        );
      }
    }

    // Check if roster is preconfigured and has participants in PLAY mode
    if (rosterMode === 'PRECONFIGURED' && publicPlay && !participantId) {
      const rosterCheck = persistenceRepo.listParticipants(gameId, { limit: 1 });
      if (rosterCheck.total > 0) {
        throw new AppError(
          'PARTICIPANT_REQUIRED',
          'Vui lòng chọn tên của bạn trong danh sách người tham gia và xác nhận danh tính trước khi bắt đầu.',
          400
        );
      }
    }

    const effectiveLockToken =
      lockToken?.trim() ||
      (typeof req.headers['x-participant-token'] === 'string'
        ? req.headers['x-participant-token'].trim()
        : '') ||
      req.user?.userId ||
      `ptok_${crypto.randomUUID()}`;

    let resolvedParticipantName =
      participantName?.trim() ||
      playerName?.trim() ||
      displayName?.trim() ||
      req.user?.displayName ||
      null;
    let resolvedDepartment = departmentUnit?.trim() || null;
    let resolvedEmployeeCode = employeeCode?.trim() || null;

    // V3 Stage 3B: In Solo Play without participantId, require a valid player name if publicPlay is active or name fields were provided
    const hasExplicitNameField =
      req.body?.displayName !== undefined ||
      req.body?.playerName !== undefined ||
      req.body?.participantName !== undefined;
    if (
      sessionMode === 'PLAY' &&
      !participantId &&
      (publicPlay || hasExplicitNameField) &&
      (!resolvedParticipantName || resolvedParticipantName.length < 2)
    ) {
      throw new AppError(
        'PLAYER_NAME_REQUIRED',
        'Vui lòng nhập họ và tên hợp lệ (tối thiểu 2 ký tự) trước khi bắt đầu chơi.',
        400
      );
    }

    if (participantId) {
      const claim = persistenceRepo.claimParticipantSlot({
        gameId,
        participantId,
        lockToken: effectiveLockToken,
        sessionMode,
      });

      resolvedParticipantName = claim.participant.fullName;
      resolvedDepartment = claim.participant.departmentUnit;
      resolvedEmployeeCode = claim.participant.employeeCode;

      // If resuming an already active session on refresh/reconnect, return that session without resetting deadline!
      if (claim.resumed && claim.activeSessionId) {
        try {
          const existingSession = gameEngine.getSession(claim.activeSessionId);
          if (
            existingSession &&
            existingSession.state !== 'FINISHED' &&
            existingSession.state !== 'ABANDONED'
          ) {
            res.status(200).json(
              createSuccessResponse({
                sessionId: existingSession.sessionId,
                gameId: existingSession.specification.gameId,
                state: existingSession.state,
                sessionMode,
                resumed: true,
                participantId: claim.participant.participantId,
                displayName: claim.participant.fullName,
                departmentUnit: claim.participant.departmentUnit,
                lockToken: effectiveLockToken,
                totalQuestions: existingSession.specification.questions.length,
                isPreview: !resolvedIsPublic,
              })
            );
            return;
          }
        } catch {
          // Active session expired from memory, proceed to create fresh session bound to claimed slot
        }
      }
    }

    if (req.user) {
      quotaService.enforceActiveSessionLimit(req.user.userId);
    }

    // Do not allow client-supplied custom specification to overwrite stored game
    const customSpecToUse = storedSpec ? undefined : gameSpecification;
    const session = gameEngine.createSession(gameId, customSpecToUse, req.user?.userId ?? null, {
      participantId: participantId ?? null,
      displayName: resolvedParticipantName,
      departmentUnit: resolvedDepartment,
      employeeCode: resolvedEmployeeCode,
      lockToken: effectiveLockToken,
    });

    if (participantId || resolvedParticipantName) {
      const maxPossibleScore = calculateMaxPossibleScore(
        session.specification.questions.length,
        session.specification.settings.scoringMode
      );
      const attempt = persistenceRepo.recordParticipantAttemptStart({
        gameId: session.specification.gameId,
        participantId: participantId ?? null,
        sessionId: session.sessionId,
        deliveryMode: 'SOLO',
        sessionMode,
        displayName: resolvedParticipantName || 'Người chơi',
        departmentUnit: resolvedDepartment || '',
        employeeCode: resolvedEmployeeCode || '',
        lockToken: effectiveLockToken,
        totalQuestions: session.specification.questions.length,
        maxPossibleScore,
      });
      session.attemptId = attempt.attemptId;
    }

    res.status(200).json(
      createSuccessResponse({
        sessionId: session.sessionId,
        gameId: session.specification.gameId,
        state: session.state,
        sessionMode,
        resumed: false,
        participantId: session.participantId,
        displayName: session.displayName,
        departmentUnit: session.departmentUnit,
        lockToken: effectiveLockToken,
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
 * Starts the session (or returns current question if already started on refresh) without answer leakage.
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

    // If session is already active (e.g. client refreshed browser during Solo Exam), return current state & question without resetting deadline!
    if (session.state === 'QUESTION_ACTIVE' || session.state === 'QUESTION_ANSWERED') {
      res.status(200).json(
        createSuccessResponse({
          session: session.getSummary(),
          question: session.getCurrentClientQuestion(),
          resumed: true,
        })
      );
      return;
    }

    const startResult = gameEngine.start(sessionId);

    res.status(200).json(createSuccessResponse(startResult));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/sessions/:sessionId/checkpoint
 * Activates strict question timer when an Adventure checkpoint opens for the first time.
 */
sessionRouter.post('/:sessionId/checkpoint', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const questionIndex =
      typeof req.body?.questionIndex === 'number' ? req.body.questionIndex : undefined;
    const question = gameEngine.activateCheckpoint(sessionId, questionIndex);
    res.status(200).json(createSuccessResponse({ question }));
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

    const examState = resolveGameExamState(
      session.specification.gameId,
      session.specification,
      req.user
    );
    res.status(200).json(
      createSuccessResponse({
        ...session.getSummary(),
        examStatus: examState.examStatus,
        examClosedAt: examState.examClosedAt,
      })
    );
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
 * POST /api/games/sessions/:sessionId/timeout
 * Records a question timeout idempotently (at most once per question) and returns mode-appropriate feedback.
 */
sessionRouter.post('/:sessionId/timeout', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);
    authService.assertResourceAccess({
      resourceType: 'phiên luyện tập',
      ownerUserId: session.ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const questionId =
      typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : undefined;
    const timeoutResult = gameEngine.recordTimeout(sessionId, questionId);
    const examState = resolveGameExamState(
      session.specification.gameId,
      session.specification,
      req.user
    );

    if (!examState.canRevealAnswers) {
      res.status(200).json(
        createSuccessResponse({
          questionId: timeoutResult.questionId,
          timedOut: true,
          examAnswerRecorded: true,
          sessionMode: 'EXAM',
          autoAdvanceMs: examState.autoAdvanceMs,
          nextQuestionAvailable: timeoutResult.nextQuestionAvailable,
        })
      );
      return;
    }

    res.status(200).json(
      createSuccessResponse({
        ...timeoutResult,
        sessionMode: examState.sessionMode,
        autoAdvanceMs: examState.autoAdvanceMs,
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/sessions/:sessionId/answer
 * Submits player answer, performs server-side validation and scoring.
 * In EXAM mode (before answersPublished), strictly omits correctAnswer, explanation, isCorrect, and pointsEarned.
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

    const { questionId, answer, clientTimestamp, timedOut } = parseResult.data;
    const examState = resolveGameExamState(
      session.specification.gameId,
      session.specification,
      req.user
    );

    if (
      examState.examStatus === 'CLOSED' ||
      examState.examStatus === 'CLOSING' ||
      session.state === 'FINISHED'
    ) {
      throw new AppError(
        'EXAM_CLOSED',
        'Đợt thi đã kết thúc. Bài làm của bạn đã được hệ thống tự động thu và chấm điểm.',
        403
      );
    }

    if (timedOut || answer === '__TIMEOUT__') {
      const timeoutResult = gameEngine.recordTimeout(sessionId, questionId);
      if (!examState.canRevealAnswers) {
        res.status(200).json(
          createSuccessResponse({
            questionId: timeoutResult.questionId,
            timedOut: true,
            examAnswerRecorded: true,
            sessionMode: 'EXAM',
            autoAdvanceMs: examState.autoAdvanceMs,
            nextQuestionAvailable: timeoutResult.nextQuestionAvailable,
          })
        );
        return;
      }
      res.status(200).json(
        createSuccessResponse({
          ...timeoutResult,
          sessionMode: examState.sessionMode,
          autoAdvanceMs: examState.autoAdvanceMs,
        })
      );
      return;
    }

    const answerResult = gameEngine.submitAnswer(sessionId, questionId, answer, clientTimestamp);

    if (!examState.canRevealAnswers) {
      res.status(200).json(
        createSuccessResponse({
          questionId: answerResult.questionId,
          examAnswerRecorded: true,
          sessionMode: 'EXAM',
          autoAdvanceMs: examState.autoAdvanceMs,
          nextQuestionAvailable: answerResult.nextQuestionAvailable,
        })
      );
      return;
    }

    res.status(200).json(
      createSuccessResponse({
        ...answerResult,
        sessionMode: examState.sessionMode,
        autoAdvanceMs: examState.autoAdvanceMs,
      })
    );
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
    if (advanceResult.finished && advanceResult.result) {
      const examState = resolveGameExamState(
        session.specification.gameId,
        session.specification,
        req.user
      );
      advanceResult.result = sanitizeGameResultForClient(advanceResult.result, examState);
    }

    res.status(200).json(createSuccessResponse(advanceResult));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/sessions/:sessionId/end
 * POST /api/games/sessions/:sessionId/abandon
 * Safely ends an active practice session and releases game delete locks.
 * Authorized for session owner, game owner, or Admin.
 */
function handleEndSession(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = String(req.params.sessionId);
    const session = gameEngine.getSession(sessionId);

    const gameId = session.specification.gameId;
    const storedSpec = gameStore.get(gameId);
    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    const gameOwnerUserId =
      storedSpec?.ownerUserId ?? ownerInfo?.ownerUserId ?? session.specification.ownerUserId ?? null;

    const currentUserId = req.user?.userId ?? null;
    const isAdmin = req.user?.role === 'ADMIN';
    const isSessionOwner = Boolean(session.ownerUserId && currentUserId === session.ownerUserId);
    const isGameOwner = Boolean(gameOwnerUserId && currentUserId === gameOwnerUserId);
    const isUnowned = !session.ownerUserId && !gameOwnerUserId;

    if (!isAdmin && !isSessionOwner && !isGameOwner && !isUnowned) {
      throw new AppError(
        'ACCESS_DENIED',
        'Bạn không có quyền kết thúc phiên luyện tập này.',
        403
      );
    }

    const summary = gameEngine.endSession(sessionId);
    res.status(200).json(
      createSuccessResponse({
        ended: true,
        session: summary,
      })
    );
  } catch (err) {
    next(err);
  }
}

sessionRouter.post('/:sessionId/end', handleEndSession);
sessionRouter.post('/:sessionId/abandon', handleEndSession);

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
      const rawResult = gameEngine.getResult(sessionId);
      const examState = resolveGameExamState(
        activeSession.specification.gameId,
        activeSession.specification,
        req.user
      );
      const sanitized = sanitizeGameResultForClient(rawResult, examState);
      res.status(200).json(createSuccessResponse(sanitized));
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

    const examState = resolveGameExamState(persisted.gameId, undefined, req.user);
    const evaluation = evaluatePerformanceResult({
      correctAnswers: persisted.correctAnswers,
      totalQuestions: persisted.totalQuestions,
      totalScore: persisted.totalScore,
      maxPossibleScore: persisted.maxPossibleScore,
      sessionMode: examState.sessionMode,
      passThresholdPercent: examState.passThresholdPercent,
    });

    const sanitizedResults = examState.canRevealAnswers
      ? persisted.questionResults
      : (persisted.questionResults || []).map(qr => ({
          questionId: qr.questionId,
          answer: qr.answer,
          isCorrect: qr.isCorrect,
          pointsEarned: qr.pointsEarned,
          responseTimeMs: qr.responseTimeMs,
          answeredAt: qr.answeredAt,
          correctAnswer: '[Đáp án sẽ được công bố sau khi kết thúc kỳ thi]',
          explanation: undefined,
          sourceReference: undefined,
        }));

    res.status(200).json(
      createSuccessResponse({
        sessionId: persisted.sessionId,
        gameId: persisted.gameId,
        title: persisted.gameTitle,
        gameType: persisted.gameType,
        sessionMode: examState.sessionMode,
        answersPublished: examState.answersPublished,
        state: 'FINISHED',
        totalScore: persisted.totalScore,
        score: persisted.totalScore,
        maxPossibleScore: persisted.maxPossibleScore,
        correctAnswers: persisted.correctAnswers,
        correctCount: persisted.correctAnswers,
        wrongAnswers: persisted.wrongAnswers,
        wrongCount: persisted.wrongAnswers,
        totalQuestions: persisted.totalQuestions,
        maxStreak: persisted.maxStreak,
        durationMs: persisted.durationMs,
        evaluation,
        questionResults: sanitizedResults,
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

    const examState = resolveGameExamState(persisted.gameId, undefined, req.user);
    if (!examState.canRevealAnswers && !(examState as any).isOwnerOrAdmin) {
      throw new AppError(
        'EXAM_ANSWERS_LOCKED',
        'Đáp án kỳ thi chưa được Ban Tổ Chức công bố nên chưa thể xuất chi tiết bài làm.',
        403
      );
    }

    const payload = exportService.exportPracticeSession(persisted, format);
    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
    res.status(200).send(payload.body);
  } catch (err) {
    next(err);
  }
});
