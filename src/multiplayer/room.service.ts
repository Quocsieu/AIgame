import crypto from 'node:crypto';
import {
  GameSpecification,
  GameSpecificationSchema,
  shufflePuzzleChoicesForClient,
} from '../contracts/game.contract.js';
import {
  calculateMaxPossibleScore,
  calculateScore,
  evaluatePerformanceResult,
  PerformanceEvaluation,
} from '../game/game.scoring.js';
import { getHandler } from '../game/handlers/index.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';
import { roomStore } from './room.store.js';
import {
  LeaderboardEntry,
  MULTIPLAYER_CONFIG,
  PlayerQuestionResult,
  PlayerSession,
  RoomLobbyInfo,
  RoomState,
  SanitizedQuestion,
} from './room.types.js';

export class MultiplayerRoom {
  public readonly roomId: string;
  public readonly roomCode: string;
  public readonly gameId: string;
  public readonly gameSpecification: GameSpecification;
  public readonly hostToken: string;
  public ownerUserId: string | null = null;
  public state: RoomState = 'WAITING';
  public isLocked: boolean = false;
  public answersPublished: boolean = false;
  public showExamLeaderboardToPlayers: boolean = false;
  public readonly capacity: number;
  public currentQuestionIndex: number = 0;
  public questionStartedAt: number | null = null;
  public questionDeadlineAt: number | null = null;
  public startedAtIso: string | null = null;
  public finishedAtIso: string | null = null;
  public readonly createdAt: number;
  public updatedAt: number;

  public readonly players: Map<string, PlayerSession> = new Map(); // Keyed by playerToken
  public readonly playerIdToToken: Map<string, string> = new Map(); // playerId -> playerToken
  public readonly participantIdToToken: Map<string, string> = new Map(); // participantId -> playerToken
  public timerHandle: NodeJS.Timeout | null = null;

  constructor(
    roomId: string,
    roomCode: string,
    gameSpecification: GameSpecification,
    hostToken: string,
    capacity: number = MULTIPLAYER_CONFIG.MAX_PLAYERS_PER_ROOM,
    ownerUserId?: string | null
  ) {
    this.roomId = roomId;
    this.roomCode = roomCode.toUpperCase();
    this.gameId = gameSpecification.gameId;
    this.gameSpecification = Object.freeze(JSON.parse(JSON.stringify(gameSpecification)));
    this.hostToken = hostToken;
    this.ownerUserId = ownerUserId ?? gameSpecification.ownerUserId ?? null;
    this.capacity = capacity;
    this.answersPublished = Boolean(gameSpecification.settings?.answersPublished);
    this.showExamLeaderboardToPlayers = Boolean(
      gameSpecification.settings?.showExamLeaderboardToPlayers
    );
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  public getSessionMode(): 'PLAY' | 'EXAM' {
    return this.gameSpecification.settings?.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
  }

  public getRosterMode(): 'FREE_TEXT' | 'PRECONFIGURED' | 'HYBRID' {
    return this.gameSpecification.settings?.rosterMode || 'FREE_TEXT';
  }

  public getPassThresholdPercent(): number {
    return typeof this.gameSpecification.settings?.passThresholdPercent === 'number'
      ? this.gameSpecification.settings.passThresholdPercent
      : 50;
  }

  public getMaxPossibleScore(): number {
    return calculateMaxPossibleScore(
      this.gameSpecification.questions.length,
      this.gameSpecification.settings.scoringMode
    );
  }

  public getQuestionTimeLimitSeconds(index: number = this.currentQuestionIndex): number {
    const q = this.gameSpecification.questions[index];
    if (
      typeof q?.timeLimitSeconds === 'number' &&
      Number.isFinite(q.timeLimitSeconds) &&
      q.timeLimitSeconds >= 5
    ) {
      return Math.round(q.timeLimitSeconds);
    }
    return this.gameSpecification.settings.timePerQuestion || 20;
  }

  public getAutoAdvanceDelayMs(): number {
    if (typeof this.gameSpecification.settings?.autoAdvanceDelayMs === 'number') {
      return this.gameSpecification.settings.autoAdvanceDelayMs;
    }
    return this.getSessionMode() === 'EXAM' ? 1500 : MULTIPLAYER_CONFIG.AUTO_ADVANCE_DELAY_MS;
  }

  public evaluatePlayerPerformance(player: PlayerSession): PerformanceEvaluation {
    return evaluatePerformanceResult({
      correctAnswers: player.correctCount,
      totalQuestions: this.gameSpecification.questions.length,
      totalScore: player.score,
      maxPossibleScore: this.getMaxPossibleScore(),
      sessionMode: this.getSessionMode(),
      passThresholdPercent: this.getPassThresholdPercent(),
    });
  }

  /**
   * Adds a player to the room or reconnects an existing player.
   * Enforces roster slot verification and prevents concurrent slot hijacking.
   */
  public addPlayer(
    displayName: string,
    existingToken?: string,
    participantOpts?: {
      participantId?: string;
      departmentUnit?: string;
      lockToken?: string;
    }
  ): { player: PlayerSession; isReconnect: boolean } {
    const now = Date.now();

    // Check reconnect by existing playerToken
    if (existingToken && this.players.has(existingToken)) {
      const existing = this.players.get(existingToken)!;
      existing.connected = true;
      existing.lastSeenAt = now;
      this.updatedAt = now;
      return { player: existing, isReconnect: true };
    }

    const requestedParticipantId = participantOpts?.participantId?.trim() || undefined;
    const requestedLockToken = participantOpts?.lockToken?.trim() || existingToken || undefined;

    // Check if this participantId is already in the room
    if (requestedParticipantId && this.participantIdToToken.has(requestedParticipantId)) {
      const boundPlayerToken = this.participantIdToToken.get(requestedParticipantId)!;
      const existingPlayer = this.players.get(boundPlayerToken);
      if (existingPlayer) {
        if (
          requestedLockToken &&
          existingPlayer.lockToken &&
          existingPlayer.lockToken === requestedLockToken
        ) {
          existingPlayer.connected = true;
          existingPlayer.lastSeenAt = now;
          this.updatedAt = now;
          return { player: existingPlayer, isReconnect: true };
        }
        throw new AppError(
          'PARTICIPANT_SLOT_LOCKED',
          `Thí sinh "${existingPlayer.displayName}" đã tham gia phòng trên một thiết bị khác.`,
          409
        );
      }
    }

    if (this.state === 'FINISHED' || this.state === 'CLOSED') {
      throw new AppError(
        'GAME_FINISHED',
        'Cannot join a game room that is already finished or closed.',
        400
      );
    }

    if (this.isLocked) {
      throw new AppError('ROOM_LOCKED', 'Phòng chơi đã bị khóa bởi chủ phòng.', 403);
    }

    if (this.players.size >= this.capacity) {
      throw new AppError(
        'ROOM_FULL',
        `Room has reached maximum capacity of ${this.capacity} players.`,
        400
      );
    }

    const rosterMode = this.getRosterMode();
    const sessionMode = this.getSessionMode();
    if ((rosterMode === 'PRECONFIGURED' || sessionMode === 'EXAM') && !requestedParticipantId) {
      try {
        const rosterCheck = persistenceRepo.listParticipants(this.gameId, { limit: 1 });
        if (sessionMode === 'EXAM' && rosterCheck.total === 0) {
          throw new AppError(
            'EXAM_ROSTER_REQUIRED',
            'Phòng thi bắt buộc phải có danh sách thí sinh từ Ban Tổ Chức trước khi tham gia.',
            400
          );
        }
        if (rosterCheck.total > 0 || sessionMode === 'EXAM') {
          throw new AppError(
            'PARTICIPANT_REQUIRED',
            'Phòng này yêu cầu chọn tên từ danh sách người tham gia của Ban Tổ Chức.',
            400
          );
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
      }
    }

    let resolvedDisplayName = displayName.trim().slice(0, 80);
    let resolvedDepartment = participantOpts?.departmentUnit?.trim().slice(0, 120) || '';
    const effectiveLockToken = requestedLockToken || `ws_${crypto.randomUUID()}`;

    if (requestedParticipantId) {
      const claim = persistenceRepo.claimParticipantSlot({
        gameId: this.gameId,
        participantId: requestedParticipantId,
        lockToken: effectiveLockToken,
        roomCode: this.roomCode,
        sessionMode: this.getSessionMode(),
      });
      resolvedDisplayName = claim.participant.fullName;
      resolvedDepartment = claim.participant.departmentUnit;
    }

    if (!resolvedDisplayName) {
      throw new AppError('INVALID_REQUEST', 'Player display name cannot be empty.', 400);
    }

    // Disambiguate duplicate display names in the room
    let cleanName = resolvedDisplayName;
    const existingNames = new Set(
      Array.from(this.players.values()).map(p => p.displayName.trim().toLowerCase())
    );
    if (existingNames.has(resolvedDisplayName.toLowerCase())) {
      const withDept = resolvedDepartment
        ? `${resolvedDisplayName} (${resolvedDepartment})`
        : '';
      if (withDept && !existingNames.has(withDept.toLowerCase())) {
        cleanName = withDept;
      } else {
        let counter = 2;
        while (existingNames.has(`${resolvedDisplayName} #${counter}`.toLowerCase())) {
          counter++;
        }
        cleanName = `${resolvedDisplayName} #${counter}`;
      }
    }

    const playerId = `player_${crypto.randomUUID()}`;
    const playerToken = `token_${crypto.randomUUID()}`;

    let attemptId: string | null = null;
    if (requestedParticipantId) {
      try {
        const attempt = persistenceRepo.recordParticipantAttemptStart({
          gameId: this.gameId,
          participantId: requestedParticipantId,
          roomId: this.roomId,
          roomCode: this.roomCode,
          deliveryMode: 'MULTIPLAYER',
          sessionMode: this.getSessionMode(),
          displayName: cleanName,
          departmentUnit: resolvedDepartment,
          lockToken: effectiveLockToken,
          totalQuestions: this.gameSpecification.questions.length,
          maxPossibleScore: this.getMaxPossibleScore(),
        });
        attemptId = attempt.attemptId;
      } catch {
        // Ignore if SQLite unavailable in unit tests
      }
    }

    const player: PlayerSession = {
      playerId,
      playerToken,
      displayName: cleanName,
      participantId: requestedParticipantId ?? null,
      departmentUnit: resolvedDepartment,
      lockToken: effectiveLockToken,
      attemptId,
      connected: true,
      score: 0,
      correctCount: 0,
      wrongCount: 0,
      currentStreak: 0,
      maxStreak: 0,
      totalResponseTimeMs: 0,
      answeredQuestionIds: new Set(),
      questionResults: new Map(),
      joinedAt: now,
      lastSeenAt: now,
    };

    this.players.set(playerToken, player);
    this.playerIdToToken.set(playerId, playerToken);
    if (requestedParticipantId) {
      this.participantIdToToken.set(requestedParticipantId, playerToken);
    }
    this.updatedAt = now;

    return { player, isReconnect: false };
  }

  /**
   * Marks a player as disconnected.
   */
  public disconnectPlayer(playerToken: string): void {
    const player = this.players.get(playerToken);
    if (player) {
      player.connected = false;
      player.lastSeenAt = Date.now();
      this.updatedAt = Date.now();
    }
  }

  /**
   * Reconnects an existing player using their private playerToken.
   */
  public reconnectPlayer(playerToken: string): PlayerSession {
    const player = this.players.get(playerToken);
    if (!player) {
      throw new AppError(
        'INVALID_PLAYER_TOKEN',
        'Player token is invalid or player does not exist in room.',
        404
      );
    }

    if (this.state === 'CLOSED') {
      throw new AppError('ROOM_EXPIRED', 'Room has been closed.', 400);
    }

    player.connected = true;
    player.lastSeenAt = Date.now();
    this.updatedAt = Date.now();
    return player;
  }

  /**
   * Sets room lock status (Host only).
   * Locked rooms prevent new players from joining, but allow existing players to reconnect.
   */
  public setLock(hostToken: string, locked: boolean): boolean {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }
    this.isLocked = locked;
    this.updatedAt = Date.now();
    return this.isLocked;
  }

  /**
   * Toggles whether exam leaderboard is visible to players (Host only).
   */
  public setExamLeaderboardVisibility(hostToken: string, visible: boolean): boolean {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }
    this.showExamLeaderboardToPlayers = Boolean(visible);
    this.updatedAt = Date.now();
    return this.showExamLeaderboardToPlayers;
  }

  /**
   * Publishes exam answers after the room has finished (Host only).
   */
  public publishAnswers(hostToken: string): Array<{
    id: string;
    questionIndex: number;
    question: string;
    correctAnswer: string;
    explanation?: string;
  }> {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }
    if (this.state !== 'FINISHED') {
      throw new AppError(
        'EXAM_NOT_FINISHED',
        'Chỉ được phép công bố đáp án sau khi toàn bộ phiên thi trong phòng đã kết thúc.',
        400
      );
    }
    this.answersPublished = true;
    this.updatedAt = Date.now();

    return this.gameSpecification.questions.map((q, idx) => ({
      id: q.id,
      questionIndex: idx,
      question: q.question,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    }));
  }

  /**
   * Starts the multiplayer game (Host only).
   */
  public start(hostToken: string): SanitizedQuestion {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }

    if (this.state !== 'WAITING') {
      throw new AppError(
        'INVALID_ROOM_STATE',
        `Game can only be started from WAITING state. Current state: ${this.state}.`,
        400
      );
    }

    if (this.players.size === 0) {
      throw new AppError(
        'INVALID_ROOM_STATE',
        'Cannot start game without any players in the room.',
        400
      );
    }

    this.startedAtIso = new Date().toISOString();
    this.currentQuestionIndex = 0;
    return this.activateQuestion(0);
  }

  /**
   * Activates the question at the specified index.
   */
  public activateQuestion(index: number): SanitizedQuestion {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    this.state = 'QUESTION_ACTIVE';
    this.currentQuestionIndex = index;
    this.questionStartedAt = Date.now();

    const timeLimitSec = this.getQuestionTimeLimitSeconds(index);
    this.questionDeadlineAt = this.questionStartedAt + timeLimitSec * 1000;
    this.updatedAt = Date.now();

    return this.getSanitizedCurrentQuestion();
  }

  /**
   * Submits an answer for a player.
   * Performs server-authoritative validation, timing, and scoring.
   */
  public submitPlayerAnswer(
    playerToken: string,
    questionId: string,
    rawAnswer: string,
    now: number = Date.now()
  ): {
    result: PlayerQuestionResult;
    allAnswered: boolean;
    answeredCount: number;
    totalPlayers: number;
  } {
    const player = this.players.get(playerToken);
    if (!player) {
      throw new AppError('SESSION_NOT_FOUND', 'Player session not found in this room.', 404);
    }

    if (this.state !== 'QUESTION_ACTIVE') {
      throw new AppError(
        'INVALID_ROOM_STATE',
        `Question is not currently active for answering. Current state: ${this.state}.`,
        400
      );
    }

    const activeQuestion = this.gameSpecification.questions[this.currentQuestionIndex];
    if (!activeQuestion || activeQuestion.id !== questionId) {
      throw new AppError(
        'QUESTION_NOT_FOUND',
        `Question "${questionId}" does not match the active question.`,
        404
      );
    }

    if (player.answeredQuestionIds.has(questionId)) {
      throw new AppError(
        'QUESTION_ALREADY_ANSWERED',
        'You have already submitted an answer for this question.',
        400
      );
    }

    // Server-authoritative timer deadline check
    if (this.questionDeadlineAt !== null && now > this.questionDeadlineAt) {
      throw new AppError(
        'ANSWER_TIMEOUT',
        'Answer submitted after question time limit expired.',
        400
      );
    }

    // Reuse Day 3 handler for answer validation
    const handler = getHandler(activeQuestion.type);
    const validation = handler.validateAnswer(activeQuestion, rawAnswer);

    if (!validation.isValid) {
      throw new AppError(
        'INVALID_ANSWER',
        validation.invalidReason || 'Invalid answer submitted.',
        400
      );
    }

    // Reuse Day 3 scoring calculation
    const responseTimeMs = Math.max(0, now - (this.questionStartedAt || now));
    const timeLimitMs = this.getQuestionTimeLimitSeconds(this.currentQuestionIndex) * 1000;

    const scoreResult = calculateScore({
      isCorrect: validation.isCorrect,
      scoringMode: this.gameSpecification.settings.scoringMode,
      responseTimeMs,
      timeLimitMs,
      currentStreak: player.currentStreak,
    });

    player.score += scoreResult.pointsEarned;
    player.currentStreak = scoreResult.newStreak;
    if (player.currentStreak > player.maxStreak) {
      player.maxStreak = player.currentStreak;
    }

    if (validation.isCorrect) {
      player.correctCount++;
    } else {
      player.wrongCount++;
    }

    player.totalResponseTimeMs += responseTimeMs;
    player.answeredQuestionIds.add(questionId);

    const result: PlayerQuestionResult = {
      questionId,
      answer: rawAnswer,
      isCorrect: validation.isCorrect,
      pointsEarned: scoreResult.pointsEarned,
      responseTimeMs,
      answeredAt: now,
    };

    player.questionResults.set(questionId, result);
    this.updatedAt = now;

    // Check if all connected players have answered
    const connectedPlayers = Array.from(this.players.values()).filter(p => p.connected);
    const totalAnsweredCount = Array.from(this.players.values()).filter(p =>
      p.answeredQuestionIds.has(questionId)
    ).length;
    const connectedAnsweredCount = connectedPlayers.filter(p =>
      p.answeredQuestionIds.has(questionId)
    ).length;
    const allAnswered =
      connectedPlayers.length > 0 && connectedAnsweredCount >= connectedPlayers.length;

    return {
      result,
      allAnswered,
      answeredCount: totalAnsweredCount,
      totalPlayers: this.players.size,
    };
  }

  /**
   * Reveals the answer and leaderboard for the current question.
   * Also records timeout (0 pts) idempotently for any player who did not answer before reveal.
   */
  public revealQuestion(): {
    questionId: string;
    correctAnswer: string;
    explanation?: string;
    leaderboard: LeaderboardEntry[];
    answerStats: Record<string, number>;
  } {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    this.state = 'QUESTION_REVEAL';
    const now = Date.now();
    this.updatedAt = now;

    const activeQuestion = this.gameSpecification.questions[this.currentQuestionIndex];
    const timeLimitMs = this.getQuestionTimeLimitSeconds(this.currentQuestionIndex) * 1000;

    // Compute answer stats across all players and record timeout for unanswered players once
    const answerStats: Record<string, number> = {};
    for (const player of this.players.values()) {
      const qResult = player.questionResults.get(activeQuestion.id);
      if (qResult) {
        if (!qResult.timedOut && qResult.answer.trim()) {
          const key = qResult.answer.trim();
          answerStats[key] = (answerStats[key] || 0) + 1;
        }
      } else {
        player.wrongCount++;
        player.currentStreak = 0;
        player.totalResponseTimeMs += timeLimitMs;
        player.answeredQuestionIds.add(activeQuestion.id);
        player.questionResults.set(activeQuestion.id, {
          questionId: activeQuestion.id,
          answer: '',
          isCorrect: false,
          pointsEarned: 0,
          responseTimeMs: timeLimitMs,
          answeredAt: now,
          timedOut: true,
        });
      }
    }

    return {
      questionId: activeQuestion.id,
      correctAnswer: activeQuestion.correctAnswer,
      explanation: activeQuestion.explanation,
      leaderboard: this.getLeaderboard(),
      answerStats,
    };
  }

  /**
   * Advances to the next question or finishes the game (Host only).
   */
  public nextQuestion(hostToken: string): {
    nextQuestionAvailable: boolean;
    question?: SanitizedQuestion;
    finished: boolean;
    finalLeaderboard?: LeaderboardEntry[];
  } {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }

    if (this.state !== 'QUESTION_REVEAL') {
      throw new AppError(
        'INVALID_ROOM_STATE',
        'Cannot advance to next question until the current question has been revealed.',
        400
      );
    }

    const nextIndex = this.currentQuestionIndex + 1;
    if (nextIndex < this.gameSpecification.questions.length) {
      const question = this.activateQuestion(nextIndex);
      return { nextQuestionAvailable: true, question, finished: false };
    } else {
      this.state = 'FINISHED';
      this.updatedAt = Date.now();
      this.finishedAtIso = new Date().toISOString();
      const finalLeaderboard = this.getLeaderboard();
      this.persistHistory(finalLeaderboard);
      return { nextQuestionAvailable: false, finished: true, finalLeaderboard };
    }
  }

  /**
   * Ends the game early (Host only).
   */
  public endGame(hostToken: string): LeaderboardEntry[] {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }

    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    this.state = 'FINISHED';
    this.updatedAt = Date.now();
    this.finishedAtIso = new Date().toISOString();
    const finalLeaderboard = this.getLeaderboard();
    this.persistHistory(finalLeaderboard);
    return finalLeaderboard;
  }

  /**
   * Auto-submits and finishes the room when BTC closes the exam.
   * Marks any unanswered questions for each player as timedOut (0 points) and persists all attempts.
   */
  public forceFinishOnExamClose(closedAtIso?: string): LeaderboardEntry[] {
    if (this.state === 'FINISHED' || this.state === 'CLOSED') {
      return this.getLeaderboard();
    }
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    const nowMs = Date.now();
    const nowIso = closedAtIso || new Date(nowMs).toISOString();
    if (!this.startedAtIso) {
      this.startedAtIso = nowIso;
    }

    for (const player of this.players.values()) {
      for (const q of this.gameSpecification.questions) {
        if (!player.answeredQuestionIds.has(q.id)) {
          player.wrongCount++;
          player.currentStreak = 0;
          player.answeredQuestionIds.add(q.id);
          player.questionResults.set(q.id, {
            questionId: q.id,
            answer: '',
            isCorrect: false,
            pointsEarned: 0,
            responseTimeMs: 0,
            answeredAt: nowMs,
            timedOut: true,
          });
        }
      }
    }

    this.state = 'FINISHED';
    this.updatedAt = nowMs;
    this.finishedAtIso = nowIso;
    const finalLeaderboard = this.getLeaderboard();
    this.persistHistory(finalLeaderboard);
    return finalLeaderboard;
  }

  public persistHistory(leaderboardOverride?: LeaderboardEntry[]): void {
    const leaderboard = leaderboardOverride || this.getLeaderboard();
    const maxPossibleScore = this.getMaxPossibleScore();
    const totalQuestions = this.gameSpecification.questions.length;
    const sessionMode = this.getSessionMode();
    const passThresholdPercent = this.getPassThresholdPercent();

    try {
      persistenceRepo.saveRoomHistory({
        roomId: this.roomId,
        roomCode: this.roomCode,
        gameId: this.gameId,
        ownerUserId: this.ownerUserId,
        gameTitle: this.gameSpecification.title,
        gameType: this.gameSpecification.gameType,
        scoringMode: this.gameSpecification.settings.scoringMode,
        state: this.state,
        playerCount: this.players.size,
        totalQuestions,
        leaderboard,
        startedAt: this.startedAtIso,
        finishedAt: this.finishedAtIso,
      });

      const attemptState = this.state === 'FINISHED' ? 'FINISHED' : 'ABANDONED';
      for (const player of this.players.values()) {
        const answersList = Array.from(player.questionResults.values());
        persistenceRepo.recordParticipantAttemptCompletion({
          attemptId: player.attemptId ?? undefined,
          roomId: this.roomId,
          participantId: player.participantId ?? null,
          gameId: this.gameId,
          displayName: player.displayName,
          departmentUnit: player.departmentUnit || '',
          deliveryMode: 'MULTIPLAYER',
          sessionMode,
          state: attemptState,
          score: player.score,
          maxPossibleScore,
          correctAnswers: player.correctCount,
          totalQuestions,
          durationMs: player.totalResponseTimeMs,
          passThresholdPercent,
          answers: answersList,
          finishedAt: this.finishedAtIso,
        });
      }
    } catch {
      // Graceful fallback in isolated memory tests
    }
  }

  /**
   * Closes and cleans up room resources.
   */
  public close(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    this.state = 'CLOSED';
    this.updatedAt = Date.now();
  }

  /**
   * Returns deterministic leaderboard sorted by:
   * 1. score descending
   * 2. correctCount descending
   * 3. totalResponseTimeMs ascending
   * 4. playerId ascending
   */
  public getLeaderboard(): LeaderboardEntry[] {
    const playerList = Array.from(this.players.values());
    const totalQuestions = this.gameSpecification.questions.length;
    const maxPossibleScore = this.getMaxPossibleScore();
    const isExam = this.getSessionMode() === 'EXAM';
    const threshold = this.getPassThresholdPercent();

    playerList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      if (a.totalResponseTimeMs !== b.totalResponseTimeMs)
        return a.totalResponseTimeMs - b.totalResponseTimeMs;
      return a.playerId.localeCompare(b.playerId);
    });

    return playerList.map((player, index) => {
      const accuracyPercent =
        totalQuestions > 0 ? Math.round((player.correctCount / totalQuestions) * 100) : 0;
      return {
        rank: index + 1,
        playerId: player.playerId,
        displayName: player.displayName,
        participantId: player.participantId ?? null,
        departmentUnit: player.departmentUnit || '',
        score: player.score,
        maxPossibleScore,
        correctCount: player.correctCount,
        totalQuestions,
        accuracyPercent,
        isPassed: isExam ? accuracyPercent >= threshold : null,
        streak: player.maxStreak,
        totalResponseTimeMs: player.totalResponseTimeMs,
        connected: player.connected,
      };
    });
  }

  /**
   * Sanitizes the active question, strictly excluding all answers and explanations.
   */
  public getSanitizedCurrentQuestion(): SanitizedQuestion {
    const question = this.gameSpecification.questions[this.currentQuestionIndex];
    if (!question) {
      throw new AppError('QUESTION_NOT_FOUND', 'Active question not found.', 404);
    }

    return {
      id: question.id,
      type: question.type,
      question: question.question,
      choices:
        question.type === 'PUZZLE' && question.choices
          ? shufflePuzzleChoicesForClient(
              question.choices,
              question.correctAnswer,
              `${this.roomId}_${question.id}`
            )
          : question.choices
            ? [...question.choices]
            : undefined,
      difficulty: question.difficulty,
      crosswordClue: question.crosswordClue,
      ...(question.type === 'SLIDER' && question.sliderConfig
        ? {
            sliderConfig: {
              min: question.sliderConfig.min,
              max: question.sliderConfig.max,
              step: question.sliderConfig.step,
              ...(question.sliderConfig.unit ? { unit: question.sliderConfig.unit } : {}),
            },
          }
        : {}),
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.gameSpecification.questions.length,
      timePerQuestion: this.getQuestionTimeLimitSeconds(this.currentQuestionIndex),
      deadlineAt: this.questionDeadlineAt || Date.now(),
    };
  }

  /**
   * Returns safe public lobby status.
   */
  public getLobbyInfo(): RoomLobbyInfo {
    let hasRoster = false;
    try {
      hasRoster = persistenceRepo.listParticipants(this.gameId, { limit: 1 }).total > 0;
    } catch {
      hasRoster = false;
    }

    return {
      roomCode: this.roomCode,
      gameId: this.gameId,
      state: this.state,
      playerCount: this.players.size,
      capacity: this.capacity,
      title: this.gameSpecification.title,
      gameType: this.gameSpecification.gameType,
      totalQuestions: this.gameSpecification.questions.length,
      sessionMode: this.getSessionMode(),
      rosterMode: this.getRosterMode(),
      hasRoster,
    };
  }
}

/**
 * Service to orchestrate room creation and lookup.
 */
class RoomService {
  public createRoom(
    gameSpecification: GameSpecification,
    capacity: number = MULTIPLAYER_CONFIG.MAX_PLAYERS_PER_ROOM,
    ownerUserId?: string | null
  ): MultiplayerRoom {
    GameSpecificationSchema.parse(gameSpecification);

    const roomId = `room_${crypto.randomUUID()}`;
    const roomCode = roomStore.generateUniqueRoomCode();
    const hostToken = `host_${crypto.randomUUID()}`;
    const resolvedOwner =
      ownerUserId !== undefined ? ownerUserId : gameSpecification.ownerUserId ?? null;

    const room = new MultiplayerRoom(
      roomId,
      roomCode,
      gameSpecification,
      hostToken,
      capacity,
      resolvedOwner
    );
    roomStore.save(room);
    return room;
  }

  public getRoomByCode(roomCode: string): MultiplayerRoom {
    const room = roomStore.getByRoomCode(roomCode);
    if (!room) {
      throw new AppError('ROOM_NOT_FOUND', `Room with code "${roomCode}" not found.`, 404);
    }
    return room;
  }

  public getRoomById(roomId: string): MultiplayerRoom {
    const room = roomStore.getByRoomId(roomId);
    if (!room) {
      throw new AppError('ROOM_NOT_FOUND', `Room with ID "${roomId}" not found.`, 404);
    }
    return room;
  }
}

export const roomService = new RoomService();
