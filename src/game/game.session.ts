import {
  GameQuestion,
  GameSpecification,
  shufflePuzzleChoicesForClient,
} from '../contracts/game.contract.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';
import {
  calculateMaxPossibleScore,
  calculateScore,
  evaluatePerformanceResult,
} from './game.scoring.js';
import { ClockFunction, GameTimer } from './game.timer.js';
import {
  ClientQuestion,
  GameResult,
  GameSessionState,
  GameSessionSummary,
  QuestionResult,
} from './game.types.js';
import { getHandler } from './handlers/index.js';
import { normalizeCrosswordWord } from './handlers/crossword.handler.js';

export class GameSession {
  public readonly sessionId: string;
  public readonly specification: GameSpecification;
  public ownerUserId: string | null = null;
  public participantId: string | null = null;
  public displayName: string | null = null;
  public departmentUnit: string | null = null;
  public employeeCode: string | null = null;
  public lockToken: string | null = null;
  public attemptId: string | null = null;
  public submittedReason: string | null = null;
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
  public readonly examTimer: GameTimer;
  private readonly checkpointOpenedIndices: Set<number> = new Set();

  constructor(
    sessionId: string,
    specification: GameSpecification,
    clock?: ClockFunction,
    ownerUserId?: string | null
  ) {
    this.sessionId = sessionId;
    // Deep snapshot specification so active exam/play sessions are never mutated by live edits
    this.specification = JSON.parse(JSON.stringify(specification)) as GameSpecification;
    this.ownerUserId = ownerUserId !== undefined ? ownerUserId : (specification.ownerUserId ?? null);
    this.timer = new GameTimer(clock);
    this.examTimer = new GameTimer(clock);
  }

  public getSessionMode(): 'PLAY' | 'EXAM' {
    return this.specification.settings?.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
  }

  public getQuestionTimeLimitSeconds(questionIndex: number = this.currentQuestionIndex): number {
    if (this.specification.settings?.timerMode === 'UNLIMITED') {
      return 3600;
    }
    const q = this.specification.questions[questionIndex];
    if (typeof q?.timeLimitSeconds === 'number' && Number.isFinite(q.timeLimitSeconds) && q.timeLimitSeconds >= 5) {
      return Math.round(q.timeLimitSeconds);
    }
    return this.specification.settings.timePerQuestion || 20;
  }

  private startQuestionTimerForIndex(questionIndex: number): void {
    const qLimitSec = this.getQuestionTimeLimitSeconds(questionIndex);
    if (this.specification.gameType === 'ADVENTURE') {
      // Wait for checkpoint open before enforcing strict question countdown; keep 600s travel buffer until checkpoint opens
      this.timer.start(qLimitSec + 600);
    } else {
      this.timer.start(qLimitSec);
    }
  }

  /**
   * Starts the strict question countdown when an Adventure checkpoint is opened for the first time.
   * Subsequent calls for the same questionIndex (e.g. on refresh/reconnect) do NOT reset the deadline.
   */
  public activateCheckpoint(questionIndex: number = this.currentQuestionIndex): ClientQuestion {
    if (this.state !== 'QUESTION_ACTIVE') {
      return this.getCurrentClientQuestion();
    }
    if (questionIndex === this.currentQuestionIndex && !this.checkpointOpenedIndices.has(questionIndex)) {
      this.checkpointOpenedIndices.add(questionIndex);
      this.timer.start(this.getQuestionTimeLimitSeconds(questionIndex));
    }
    return this.getCurrentClientQuestion();
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
    this.startQuestionTimerForIndex(0);

    const totalExamSec = Number(this.specification.settings?.totalExamDurationSeconds || 0);
    if (this.specification.settings?.timerMode === 'TOTAL_EXAM' && totalExamSec > 0) {
      this.examTimer.start(totalExamSec);
    }

    try {
      this.persistSessionState();
    } catch {
      // Graceful fallback if SQLite is unavailable in isolated unit tests
    }

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

    const sanitizedChoices =
      question.type === 'PUZZLE' && question.choices
        ? shufflePuzzleChoicesForClient(
            question.choices,
            question.correctAnswer,
            `${this.sessionId}_${question.id}`
          )
        : question.choices
          ? [...question.choices]
          : undefined;

    const sanitizedSliderConfig =
      question.type === 'SLIDER' && question.sliderConfig
        ? {
            min: question.sliderConfig.min,
            max: question.sliderConfig.max,
            step: question.sliderConfig.step,
            ...(question.sliderConfig.unit ? { unit: question.sliderConfig.unit } : {}),
          }
        : undefined;

    const qTimeLimit = this.getQuestionTimeLimitSeconds(this.currentQuestionIndex);
    let deadlineAt = this.timer.getDeadline();
    const rawRemainingSec = Math.max(0, Math.ceil(this.timer.getRemainingTimeMs() / 1000));
    let remainingTimeSeconds =
      this.specification.gameType === 'ADVENTURE' && !this.checkpointOpenedIndices.has(this.currentQuestionIndex)
        ? Math.min(qTimeLimit, rawRemainingSec)
        : rawRemainingSec;

    const examDeadlineAt = this.examTimer.getDeadline();
    let examRemainingSeconds: number | undefined;
    if (examDeadlineAt !== null) {
      examRemainingSeconds = Math.max(0, Math.ceil(this.examTimer.getRemainingTimeMs() / 1000));
      if (examRemainingSeconds < remainingTimeSeconds) {
        remainingTimeSeconds = examRemainingSeconds;
      }
      if (deadlineAt === null || examDeadlineAt < deadlineAt) {
        deadlineAt = examDeadlineAt;
      }
    }

    const crosswordWordLength =
      question.type === 'CROSSWORD'
        ? normalizeCrosswordWord(question.crosswordAnswer || question.correctAnswer || '').length
        : undefined;

    return {
      id: question.id,
      type: question.type,
      question: question.question,
      choices: sanitizedChoices,
      ...(sanitizedSliderConfig ? { sliderConfig: sanitizedSliderConfig } : {}),
      difficulty: question.difficulty,
      crosswordClue: question.crosswordClue,
      ...(crosswordWordLength && crosswordWordLength > 0 ? { crosswordWordLength } : {}),
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.specification.questions.length,
      timePerQuestion: qTimeLimit,
      remainingTimeSeconds,
      ...(deadlineAt !== null ? { deadlineAt } : {}),
      ...(examRemainingSeconds !== undefined ? { examRemainingSeconds } : {}),
      ...(examDeadlineAt !== null ? { examDeadlineAt } : {}),
    };
  }

  /**
   * Idempotently records a timeout for the current active question (0 points, wrong answer).
   * Guaranteed to execute at most once per question.
   */
  public recordTimeout(questionId?: string): QuestionResult {
    if (this.state === 'NOT_STARTED') {
      throw new AppError('GAME_NOT_STARTED', 'Game session has not started yet.', 400);
    }
    if (this.state === 'FINISHED') {
      throw new AppError('GAME_FINISHED', 'Game session is already finished.', 400);
    }
    if (this.state === 'ABANDONED') {
      throw new AppError('INVALID_GAME_STATE', 'Game session has been abandoned.', 400);
    }

    const currentQuestion = this.specification.questions[this.currentQuestionIndex];
    if (!currentQuestion) {
      throw new AppError('QUESTION_NOT_FOUND', 'Active question not found.', 404);
    }

    if (questionId && currentQuestion.id !== questionId) {
      const existingResult = this.questionResults.find(r => r.questionId === questionId);
      if (existingResult) {
        return existingResult;
      }
      throw new AppError(
        'QUESTION_NOT_FOUND',
        `Question ID "${questionId}" does not match active question ID "${currentQuestion.id}".`,
        404
      );
    }

    // Idempotent check: if already answered or timed out for this question, return existing result
    if (this.state === 'QUESTION_ANSWERED' || this.answeredQuestionIds.has(currentQuestion.id)) {
      const existing = this.questionResults.find(r => r.questionId === currentQuestion.id);
      if (existing) {
        this.state = 'QUESTION_ANSWERED';
        return existing;
      }
    }

    const timeLimitMs = this.getQuestionTimeLimitSeconds(this.currentQuestionIndex) * 1000;
    this.wrongCount++;
    this.currentStreak = 0;
    this.answeredQuestionIds.add(currentQuestion.id);
    this.state = 'QUESTION_ANSWERED';

    const result: QuestionResult = {
      questionId: currentQuestion.id,
      answer: '',
      isCorrect: false,
      pointsEarned: 0,
      responseTimeMs: timeLimitMs,
      answeredAt: new Date().toISOString(),
      correctAnswer: currentQuestion.correctAnswer,
      explanation: currentQuestion.explanation,
      sourceReference: currentQuestion.sourceReference,
      timedOut: true,
    };

    this.questionResults.push(result);
    try {
      this.persistSessionState();
    } catch {
      // Graceful fallback
    }
    return result;
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

    // Check total exam timer or question timer expiration
    if (
      (this.examTimer.getDeadline() !== null && this.examTimer.isExpired()) ||
      this.timer.isExpired()
    ) {
      throw new AppError(
        'ANSWER_TIMEOUT',
        'Answer submitted after question time limit expired.',
        400
      );
    }

    const rawResponseTimeMs = this.timer.getResponseTimeMs();
    const timeLimitMs = this.getQuestionTimeLimitSeconds(this.currentQuestionIndex) * 1000;
    const responseTimeMs =
      this.specification.gameType === 'ADVENTURE'
        ? Math.min(rawResponseTimeMs, timeLimitMs)
        : rawResponseTimeMs;

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
      basePoints: currentQuestion.points,
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
      sourceReference: currentQuestion.sourceReference,
    };

    this.questionResults.push(result);
    try {
      this.persistSessionState();
    } catch {
      // Graceful fallback if SQLite is unavailable in isolated unit tests
    }
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

    const totalExamExpired =
      this.examTimer.getDeadline() !== null && this.examTimer.isExpired(-500);

    if (this.state === 'QUESTION_ACTIVE') {
      if (!totalExamExpired && !this.timer.isExpired(-500)) {
        throw new AppError(
          'INVALID_GAME_STATE',
          'Cannot advance while the current question is still active. Please submit an answer first.',
          400
        );
      }

      // Question timer expired without answer: record timeout miss idempotently
      this.recordTimeout();
    }

    // If overall exam duration expired, auto-complete remaining questions as timedOut and finish
    if (totalExamExpired) {
      for (let idx = this.currentQuestionIndex + 1; idx < this.specification.questions.length; idx++) {
        const q = this.specification.questions[idx];
        if (q && !this.answeredQuestionIds.has(q.id)) {
          this.wrongCount++;
          this.currentStreak = 0;
          this.answeredQuestionIds.add(q.id);
          this.questionResults.push({
            questionId: q.id,
            answer: '',
            isCorrect: false,
            pointsEarned: 0,
            responseTimeMs: 0,
            answeredAt: new Date().toISOString(),
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            sourceReference: q.sourceReference,
            timedOut: true,
          });
        }
      }
      this.state = 'FINISHED';
      this.finishedAt = new Date().toISOString();
      const result = this.getResult();
      this.persistSessionState(result);
      return {
        nextQuestionAvailable: false,
        finished: true,
        result,
      };
    }

    const nextIndex = this.currentQuestionIndex + 1;
    if (nextIndex < this.specification.questions.length) {
      this.currentQuestionIndex = nextIndex;
      this.state = 'QUESTION_ACTIVE';
      this.startQuestionTimerForIndex(nextIndex);

      return {
        nextQuestionAvailable: true,
        finished: false,
        question: this.getCurrentClientQuestion(),
      };
    } else {
      this.state = 'FINISHED';
      this.finishedAt = new Date().toISOString();
      const result = this.getResult();
      this.persistSessionState(result);

      return {
        nextQuestionAvailable: false,
        finished: true,
        result,
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
    const result = this.getResult();
    this.persistSessionState(result);
    return result;
  }

  /**
   * Auto-submits an active session when BTC closes the exam.
   * Preserves all already-recorded answers and marks any remaining unanswered questions as timedOut (0 points).
   * Idempotent: if already FINISHED or ABANDONED, returns existing result without double-scoring.
   */
  public autoSubmitOnExamClose(closedAtIso?: string): GameResult {
    if (this.state === 'FINISHED' || this.state === 'ABANDONED') {
      return this.getResult();
    }
    const nowIso = closedAtIso || new Date().toISOString();
    if (!this.startedAt) {
      this.startedAt = nowIso;
    }

    for (let idx = 0; idx < this.specification.questions.length; idx++) {
      const q = this.specification.questions[idx];
      if (q && !this.answeredQuestionIds.has(q.id)) {
        this.wrongCount++;
        this.currentStreak = 0;
        this.answeredQuestionIds.add(q.id);
        this.questionResults.push({
          questionId: q.id,
          answer: '',
          isCorrect: false,
          pointsEarned: 0,
          responseTimeMs: 0,
          answeredAt: nowIso,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          sourceReference: q.sourceReference,
          timedOut: true,
        });
      }
    }

    this.state = 'FINISHED';
    this.finishedAt = nowIso;
    this.submittedReason = 'EXAM_CLOSED_BY_HOST';
    const result = this.getResult();
    try {
      this.persistSessionState(result);
    } catch {
      // Graceful fallback in isolated unit tests
    }
    return result;
  }

  /**
   * Persists the session state and result to SQLite.
   */
  public persistSessionState(precomputedResult?: GameResult): void {
    const result = precomputedResult || this.getResult();
    const totalDurationMs = this.questionResults.reduce(
      (sum, r) => sum + (Number.isFinite(r.responseTimeMs) ? r.responseTimeMs : 0),
      0
    );
    const sessionMode = this.getSessionMode();
    const passThresholdPercent = this.specification.settings?.passThresholdPercent ?? 50;
    const accuracyPercent =
      result.totalQuestions > 0
        ? Math.round((this.correctCount / result.totalQuestions) * 100)
        : 0;
    const isPassed =
      sessionMode === 'EXAM'
        ? this.state === 'FINISHED'
          ? accuracyPercent >= passThresholdPercent
          : null
        : null;
    const resolvedPlayerName = (this.displayName || '').trim() || 'Người chơi cá nhân';

    persistenceRepo.savePracticeSession({
      sessionId: this.sessionId,
      gameId: this.specification.gameId,
      ownerUserId: this.ownerUserId,
      gameTitle: this.specification.title,
      gameType: this.specification.gameType,
      scoringMode: this.specification.settings.scoringMode,
      sessionMode,
      participantId: this.participantId,
      playerName: resolvedPlayerName,
      departmentUnit: this.departmentUnit || '',
      isPassed,
      submittedReason: this.submittedReason,
      state: this.state,
      totalQuestions: result.totalQuestions,
      answeredQuestions: this.questionResults.length,
      correctAnswers: this.correctCount,
      wrongAnswers: this.wrongCount,
      totalScore: this.score,
      maxPossibleScore: result.maxPossibleScore,
      maxStreak: this.maxStreak,
      durationMs: totalDurationMs,
      questionResults: result.questionResults,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    });

    if (
      this.questionResults.length > 0 ||
      this.state === 'FINISHED' ||
      this.state === 'ABANDONED'
    ) {
      const attemptState =
        this.state === 'FINISHED'
          ? 'FINISHED'
          : this.state === 'ABANDONED'
            ? 'ABANDONED'
            : 'IN_PROGRESS';
      try {
        const synced = persistenceRepo.recordParticipantAttemptCompletion({
          attemptId: this.attemptId ?? undefined,
          sessionId: this.sessionId,
          participantId: this.participantId,
          gameId: this.specification.gameId,
          displayName: resolvedPlayerName,
          departmentUnit: this.departmentUnit || '',
          deliveryMode: 'SOLO',
          sessionMode,
          state: attemptState,
          score: this.score,
          maxPossibleScore: result.maxPossibleScore,
          correctAnswers: this.correctCount,
          totalQuestions: result.totalQuestions,
          durationMs: totalDurationMs,
          passThresholdPercent,
          answers: this.questionResults,
          finishedAt: this.finishedAt,
        });
        if (synced && !this.attemptId) {
          this.attemptId = synced.attemptId;
        }
      } catch {
        // Ignore FK failure if GameSession was constructed on an unpersisted in-memory spec in unit tests
      }
    }
  }

  /**
   * Abandons the game session.
   */
  public abandon(): void {
    this.state = 'ABANDONED';
    this.finishedAt = new Date().toISOString();
    try {
      this.persistSessionState();
    } catch {
      // Graceful fallback if SQLite persistence is unavailable
    }
  }

  /**
   * Generates the final GameResult.
   */
  public getResult(): GameResult {
    const totalQuestions = this.specification.questions.length;
    const accuracy = totalQuestions > 0 ? Math.round((this.correctCount / totalQuestions) * 100) : 0;
    const maxPossibleScore = calculateMaxPossibleScore(
      this.specification.questions,
      this.specification.settings.scoringMode
    );
    const sessionMode = this.getSessionMode();
    const evaluation = evaluatePerformanceResult({
      correctAnswers: this.correctCount,
      totalQuestions,
      totalScore: this.score,
      maxPossibleScore,
      sessionMode,
      passThresholdPercent: this.specification.settings?.passThresholdPercent ?? 50,
    });

    return {
      sessionId: this.sessionId,
      gameId: this.specification.gameId,
      title: this.specification.title,
      gameType: this.specification.gameType,
      sessionMode,
      answersPublished: Boolean(this.specification.settings?.answersPublished),
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
      evaluation,
      participantId: this.participantId,
      displayName: this.displayName,
      departmentUnit: this.departmentUnit,
    };
  }

  /**
   * Returns a status summary of the session.
   */
  public getSummary(): GameSessionSummary {
    const examDeadlineAt = this.examTimer.getDeadline();
    const examRemainingSeconds =
      examDeadlineAt !== null
        ? Math.max(0, Math.ceil(this.examTimer.getRemainingTimeMs() / 1000))
        : undefined;

    return {
      sessionId: this.sessionId,
      gameId: this.specification.gameId,
      state: this.state,
      sessionMode: this.getSessionMode(),
      currentQuestionIndex: this.currentQuestionIndex,
      totalQuestions: this.specification.questions.length,
      score: this.score,
      correctCount: this.correctCount,
      wrongCount: this.wrongCount,
      currentStreak: this.currentStreak,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      participantId: this.participantId,
      displayName: this.displayName,
      departmentUnit: this.departmentUnit,
      ...(examRemainingSeconds !== undefined ? { examRemainingSeconds } : {}),
      ...(examDeadlineAt !== null ? { examDeadlineAt } : {}),
    };
  }
}

