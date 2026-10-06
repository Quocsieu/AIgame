import { NextFunction, Request, Response, Router } from 'express';
import { gameEngine } from '../game/game.engine.js';
import {
  CreateSessionRequestSchema,
  SubmitAnswerRequestSchema,
} from '../game/game.types.js';
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

    const { gameId, gameSpecification } = parseResult.data;
    const session = gameEngine.createSession(gameId, gameSpecification);

    res.status(200).json(
      createSuccessResponse({
        sessionId: session.sessionId,
        gameId: session.specification.gameId,
        state: session.state,
        totalQuestions: session.specification.questions.length,
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
    const result = gameEngine.getResult(sessionId);

    res.status(200).json(createSuccessResponse(result));
  } catch (err) {
    next(err);
  }
});

