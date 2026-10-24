import crypto from 'node:crypto';
import { GameSpecification, GameSpecificationSchema } from '../contracts/game.contract.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';
import { GameSession } from './game.session.js';
import { gameStore, sessionStore } from './game.store.js';
import { ClockFunction } from './game.timer.js';
import {
  ClientQuestion,
  GameResult,
  GameSessionSummary,
} from './game.types.js';

export class GameEngine {
  private clock?: ClockFunction;

  constructor(clock?: ClockFunction) {
    this.clock = clock;
  }

  /**
   * Sets the clock function used for deterministic timing calculations.
   */
  public setClock(clock: ClockFunction): void {
    this.clock = clock;
  }

  /**
   * Creates a new game session for a single player.
   */
  public createSession(
    gameId: string,
    customSpec?: GameSpecification,
    ownerUserId?: string | null
  ): GameSession {
    let spec = customSpec;

    if (!spec) {
      spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game with ID "${gameId}" was not found.`, 404);
      }
    } else {
      // Validate provided custom specification
      GameSpecificationSchema.parse(spec);
      gameStore.save(spec, Date.now(), ownerUserId);
    }

    const sessionId = `session_${crypto.randomUUID()}`;
    const resolvedOwner = ownerUserId !== undefined ? ownerUserId : spec.ownerUserId ?? null;
    const session = new GameSession(sessionId, spec, this.clock, resolvedOwner);
    sessionStore.save(session);

    return session;
  }

  /**
   * Retrieves an active or stored game session by sessionId.
   */
  public getSession(sessionId: string): GameSession {
    const session = sessionStore.get(sessionId);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', `Game session "${sessionId}" not found.`, 404);
    }
    return session;
  }

  /**
   * Starts a game session and returns the first question without answer secrets.
   */
  public start(sessionId: string): { session: GameSessionSummary; question: ClientQuestion } {
    const session = this.getSession(sessionId);
    const question = session.start();
    return {
      session: session.getSummary(),
      question,
    };
  }

  /**
   * Returns the currently active question for the session.
   */
  public getCurrentQuestion(sessionId: string): ClientQuestion {
    const session = this.getSession(sessionId);
    return session.getCurrentClientQuestion();
  }

  /**
   * Submits an answer for the active question.
   */
  public submitAnswer(
    sessionId: string,
    questionId: string,
    answer: string,
    clientTimestamp?: number
  ): {
    questionId: string;
    isCorrect: boolean;
    pointsEarned: number;
    score: number;
    correctAnswer: string;
    explanation?: string;
    nextQuestionAvailable: boolean;
  } {
    const session = this.getSession(sessionId);
    const result = session.submitAnswer(questionId, answer, clientTimestamp);
    const nextQuestionAvailable = session.currentQuestionIndex + 1 < session.specification.questions.length;

    return {
      questionId: result.questionId,
      isCorrect: result.isCorrect,
      pointsEarned: result.pointsEarned,
      score: session.score,
      correctAnswer: result.correctAnswer,
      explanation: result.explanation,
      nextQuestionAvailable,
    };
  }

  /**
   * Advances the session to the next question or finishes the session.
   */
  public advance(sessionId: string): {
    nextQuestionAvailable: boolean;
    finished: boolean;
    question?: ClientQuestion;
    result?: GameResult;
  } {
    const session = this.getSession(sessionId);
    return session.advance();
  }

  /**
   * Safely ends/abandons an active game session and releases locks.
   * Handles idempotent calls gracefully.
   */
  public endSession(sessionId: string): GameSessionSummary {
    const session = this.getSession(sessionId);
    if (session.state !== 'FINISHED' && session.state !== 'ABANDONED') {
      session.abandon();
      sessionStore.save(session);
    }
    return session.getSummary();
  }

  /**
   * Retrieves the final GameResult once the game is finished (from memory or SQLite history).
   */
  public getResult(sessionId: string): GameResult {
    const inMemory = sessionStore.get(sessionId);
    if (inMemory) {
      if (inMemory.state !== 'FINISHED') {
        throw new AppError('INVALID_GAME_STATE', 'Game session is not finished yet.', 400);
      }
      return inMemory.getResult();
    }

    const persisted = persistenceRepo.getPracticeSessionById(sessionId);
    if (persisted) {
      if (persisted.state !== 'FINISHED') {
        throw new AppError('INVALID_GAME_STATE', 'Game session is not finished yet.', 400);
      }
      const accuracy =
        persisted.totalQuestions > 0
          ? Math.round((persisted.correctAnswers / persisted.totalQuestions) * 100)
          : 0;
      return {
        sessionId: persisted.sessionId,
        gameId: persisted.gameId,
        title: persisted.gameTitle,
        gameType: persisted.gameType,
        totalQuestions: persisted.totalQuestions,
        correctCount: persisted.correctAnswers,
        wrongCount: persisted.wrongAnswers,
        score: persisted.totalScore,
        maxPossibleScore: persisted.maxPossibleScore,
        startedAt: persisted.startedAt || persisted.createdAt,
        finishedAt: persisted.finishedAt || persisted.updatedAt,
        questionResults: persisted.questionResults,
        accuracy,
        streak: persisted.maxStreak,
      };
    }

    throw new AppError('SESSION_NOT_FOUND', `Game session "${sessionId}" not found.`, 404);
  }

  /**
   * Forcibly completes a game session.
   */
  public finish(sessionId: string): GameResult {
    const session = this.getSession(sessionId);
    return session.finish();
  }
}

export const gameEngine = new GameEngine();


