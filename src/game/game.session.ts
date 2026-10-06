import { GameQuestion, GameSpecification } from '../contracts/game.contract.js';
import { AppError } from '../utils/errors.js';
import { calculateMaxPossibleScore, calculateScore } from './game.scoring.js';
import { ClockFunction, GameTimer } from './game.timer.js';
import {
  ClientQuestion,
  GameResult,
  GameSessionState,
  GameSessionSummary,
  QuestionResult,
} from './game.types.js';
import { getHandler } from './handlers/index.js';

export class GameSession {
  public readonly sessionId: string;
  public readonly specification: GameSpecification;
  public state: GameSessionState = 'NOT_STARTED';
  public currentQuestionIndex: number = 0;
  public score: number = 0;
  public correctCount: number = 0;
  public wrongCount: number = 0;
  public currentStreak: number = 0;
  public maxStreak: number = 0;
  public startedAt: string | null = null;
  public finishedAt: string | null = null;
  public readonly answeredQuestionIds: Set<string> = new Set();
  public readonly questionResults: QuestionResult[] = [];
  public readonly timer: GameTimer;

  constructor(
    sessionId: string,
    specification: GameSpecification,
    clock?: ClockFunction
  ) {
    this.sessionId = sessionId;
    this.specification = specification;
    this.timer = new GameTimer(clock);
  }

  /**
   * Starts the session and activates the first question.
   */
  public start(): ClientQuestion {
    if (this.state !== 'NOT_STARTED') {
      throw new AppError(
        'INVALID_GAME_STATE',
        `Cannot start game session in state "${this.state}". Session can only be started from NOT_STARTED.`,
        400
      );
    }

    if (this.specification.questions.length === 0) {
      throw new AppError('INVALID_GAME_STATE', 'GameSpecification contains no questions.', 400);
    }

    this.state = 'QUESTION_ACTIVE';
    this.startedAt = new Date().toISOString();
    this.currentQuestionIndex = 0;
    this.timer.start(this.specification.settings.timePerQuestion);

    return this.getCurrentClientQuestion();
  }

  /**
   * Retrieves the current question for the client.
   * Authoritative answers and explanations are stripped.
   */
  public getCurrentClientQuestion(): ClientQuestion {
    if (this.state === 'NOT_STARTED') {
      throw new AppError('GAME_NOT_STARTED', 'Game session has not started yet.', 400);
    }
    if (this.state === 'FINISHED') {
      throw new AppError('GAME_FINISHED', 'Game session is already finished.', 400);
    }
    if (this.state === 'ABANDONED') {
      throw new AppError('INVALID_GAME_STATE', 'Game session has been abandoned.', 400);
    }

    const question = this.specification.questions[this.currentQuestionIndex];
    if (!question) {
      throw new AppError(
        'QUESTION_NOT_FOUND',
        `Question at index ${this.currentQuestionIndex} not found in game specification.`,
        404
      );
    }

    return {
      id: question.id,
      type: question.type,
      question: question.question,
      choices: question.choices ? [...question.choices] : undefined,
      difficulty: question.difficulty,
      crosswordClue: question.crosswordClue,
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.specification.questions.length,
      timePerQuestion: this.specification.settings.timePerQuestion,
    };
  }

  /**
   * Submits an answer for the current active question.
   * Calculates correctness and score server-side; client cannot forge score.
   */
  public submitAnswer(
    questionId: string,
    answer: string,
    _clientTimestamp?: number
  ): QuestionResult {
    if (this.state === 'NOT_STARTED') {
      throw new AppError('GAME_NOT_STARTED', 'Game session has not started yet.', 400);
    }
    if (this.state === 'FINISHED') {
      throw new AppError('GAME_FINISHED', 'Game session is already finished.', 400);
    }
    if (this.state === 'ABANDONED') {
      throw new AppError('INVALID_GAME_STATE', 'Game session has been abandoned.', 400);
    }
    if (this.state === 'QUESTION_ANSWERED') {
      throw new AppError(
        'QUESTION_ALREADY_ANSWERED',
        'Current question has already been answered. Please advance to next question.',
        400
      );
    }

    const currentQuestion = this.specification.questions[this.currentQuestionIndex];
    if (!currentQuestion) {
      throw new AppError('QUESTION_NOT_FOUND', 'Active question not found.', 404);
    }

    if (currentQuestion.id !== questionId) {
      throw new AppError(
        'QUESTION_NOT_FOUND',
        `Question ID "${questionId}" does not match active question ID "${currentQuestion.id}".`,
        404
      );
    }

    if (this.answeredQuestionIds.has(questionId)) {
      throw new AppError(
        'QUESTION_ALREADY_ANSWERED',
        `Question "${questionId}" has already been answered.`,
        400
      );
    }

    // Check timer expiration
    if (this.timer.isExpired()) {
      throw new AppError(
        'ANSWER_TIMEOUT',
        'Answer submitted after question time limit expired.',
        400
      );
    }

    const responseTimeMs = this.timer.getResponseTimeMs();
    const timeLimitMs = this.specification.settings.timePerQuestion * 1000;

    // Validate answer using specific game-type handler
    const handler = getHandler(currentQuestion.type);
    const validation = handler.validateAnswer(currentQuestion, answer);

    if (!validation.isValid) {
      throw new AppError(
        'INVALID_ANSWER',
        validation.invalidReason || 'The submitted answer is invalid for this question type.',
        400
      );
    }

    // Server-side deterministic score calculation
    const scoreResult = calculateScore({
      isCorrect: validation.isCorrect,
      scoringMode: this.specification.settings.scoringMode,
      responseTimeMs,
      timeLimitMs,
      currentStreak: this.currentStreak,
    });

    this.score += scoreResult.pointsEarned;
    this.currentStreak = scoreResult.newStreak;
    if (this.currentStreak > this.maxStreak) {
      this.maxStreak = this.currentStreak;
    }

    if (validation.isCorrect) {
      this.correctCount++;
    } else {
      this.wrongCount++;
    }

    this.answeredQuestionIds.add(questionId);
    this.state = 'QUESTION_ANSWERED';

    const result: QuestionResult = {
      questionId,
      answer,
      isCorrect: validation.isCorrect,
      pointsEarned: scoreResult.pointsEarned,
      responseTimeMs,
      answeredAt: new Date().toISOString(),
      correctAnswer: currentQuestion.correctAnswer,
      explanation: currentQuestion.explanation,
    };

    this.questionResults.push(result);
    return result;
  }

  /**
   * Advances to the next question or finishes the game session if on final question.
   */
  public advance(): {
    nextQuestionAvailable: boolean;
    finished: boolean;
    question?: ClientQuestion;
    result?: GameResult;
  } {
    if (this.state === 'NOT_STARTED') {
      throw new AppError('GAME_NOT_STARTED', 'Game session has not started yet.', 400);
    }
    if (this.state === 'FINISHED') {
      throw new AppError('GAME_FINISHED', 'Cannot advance: game session is already finished.', 400);
    }
    if (this.state === 'ABANDONED') {
      throw new AppError('INVALID_GAME_STATE', 'Cannot advance an abandoned session.', 400);
    }
    if (this.state === 'QUESTION_ACTIVE') {
      throw new AppError(
        'INVALID_GAME_STATE',
        'Cannot advance while the current question is still active. Please submit an answer first.',
        400
      );
    }

    const nextIndex = this.currentQuestionIndex + 1;
    if (nextIndex < this.specification.questions.length) {
      this.currentQuestionIndex = nextIndex;
      this.state = 'QUESTION_ACTIVE';
      this.timer.start(this.specification.settings.timePerQuestion);

      return {
        nextQuestionAvailable: true,
        finished: false,
        question: this.getCurrentClientQuestion(),
      };
    } else {
      this.state = 'FINISHED';
      this.finishedAt = new Date().toISOString();

      return {
        nextQuestionAvailable: false,
        finished: true,
        result: this.getResult(),
      };
    }
  }

  /**
   * Forcibly finishes the game session.
   */
  public finish(): GameResult {
    if (this.state !== 'FINISHED') {
      this.state = 'FINISHED';
      this.finishedAt = new Date().toISOString();
    }
    return this.getResult();
  }

  /**
   * Abandons the game session.
   */
  public abandon(): void {
    this.state = 'ABANDONED';
    this.finishedAt = new Date().toISOString();
  }

  /**
   * Generates the final GameResult.
   */
  public getResult(): GameResult {
    const totalQuestions = this.specification.questions.length;
    const accuracy = totalQuestions > 0 ? Math.round((this.correctCount / totalQuestions) * 100) : 0;
    const maxPossibleScore = calculateMaxPossibleScore(
      totalQuestions,
      this.specification.settings.scoringMode
    );

    return {
      sessionId: this.sessionId,
      gameId: this.specification.gameId,
      title: this.specification.title,
      gameType: this.specification.gameType,
      totalQuestions,
      correctCount: this.correctCount,
      wrongCount: this.wrongCount,
      score: this.score,
      maxPossibleScore,
      startedAt: this.startedAt || new Date().toISOString(),
      finishedAt: this.finishedAt || new Date().toISOString(),
      questionResults: [...this.questionResults],
      accuracy,
      streak: this.maxStreak,
    };
  }

  /**
   * Returns a status summary of the session.
   */
  public getSummary(): GameSessionSummary {
    return {
      sessionId: this.sessionId,
      gameId: this.specification.gameId,
      state: this.state,
      currentQuestionIndex: this.currentQuestionIndex,
      totalQuestions: this.specification.questions.length,
      score: this.score,
      correctCount: this.correctCount,
      wrongCount: this.wrongCount,
      currentStreak: this.currentStreak,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }
}

