import crypto from 'node:crypto';
import { GameSpecification, GameSpecificationSchema } from '../contracts/game.contract.js';
import { calculateScore } from '../game/game.scoring.js';
import { getHandler } from '../game/handlers/index.js';
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
  public state: RoomState = 'WAITING';
  public readonly capacity: number;
  public currentQuestionIndex: number = 0;
  public questionStartedAt: number | null = null;
  public questionDeadlineAt: number | null = null;
  public readonly createdAt: number;
  public updatedAt: number;

  public readonly players: Map<string, PlayerSession> = new Map(); // Keyed by playerToken
  public readonly playerIdToToken: Map<string, string> = new Map(); // playerId -> playerToken
  public timerHandle: NodeJS.Timeout | null = null;

  constructor(
    roomId: string,
    roomCode: string,
    gameSpecification: GameSpecification,
    hostToken: string,
    capacity: number = MULTIPLAYER_CONFIG.MAX_PLAYERS_PER_ROOM
  ) {
    this.roomId = roomId;
    this.roomCode = roomCode.toUpperCase();
    this.gameId = gameSpecification.gameId;
    this.gameSpecification = Object.freeze(JSON.parse(JSON.stringify(gameSpecification)));
    this.hostToken = hostToken;
    this.capacity = capacity;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * Adds a player to the room or reconnects an existing player.
   */
  public addPlayer(
    displayName: string,
    existingToken?: string
  ): { player: PlayerSession; isReconnect: boolean } {
    const now = Date.now();

    // Check reconnect
    if (existingToken && this.players.has(existingToken)) {
      const existing = this.players.get(existingToken)!;
      existing.connected = true;
      existing.lastSeenAt = now;
      this.updatedAt = now;
      return { player: existing, isReconnect: true };
    }

    if (this.state === 'FINISHED' || this.state === 'CLOSED') {
      throw new AppError('GAME_FINISHED', 'Cannot join a game room that is already finished or closed.', 400);
    }

    if (this.players.size >= this.capacity) {
      throw new AppError('ROOM_FULL', `Room has reached maximum capacity of ${this.capacity} players.`, 400);
    }

    const cleanName = displayName.trim().slice(0, 30);
    if (!cleanName) {
      throw new AppError('INVALID_REQUEST', 'Player display name cannot be empty.', 400);
    }

    const playerId = `player_${crypto.randomUUID()}`;
    const playerToken = `token_${crypto.randomUUID()}`;

    const player: PlayerSession = {
      playerId,
      playerToken,
      displayName: cleanName,
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
      throw new AppError('INVALID_PLAYER_TOKEN', 'Player token is invalid or player does not exist in room.', 404);
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
   * Starts the multiplayer game (Host only).
   */
  public start(hostToken: string): SanitizedQuestion {
    if (hostToken !== this.hostToken) {
      throw new AppError('INVALID_HOST_TOKEN', 'Action denied: invalid host token.', 403);
    }

    if (this.state !== 'WAITING') {
      throw new AppError('INVALID_ROOM_STATE', `Game can only be started from WAITING state. Current state: ${this.state}.`, 400);
    }

    if (this.players.size === 0) {
      throw new AppError('INVALID_ROOM_STATE', 'Cannot start game without any players in the room.', 400);
    }

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

    const timeLimitSec = this.gameSpecification.settings.timePerQuestion;
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
  ): { result: PlayerQuestionResult; allAnswered: boolean } {
    const player = this.players.get(playerToken);
    if (!player) {
      throw new AppError('SESSION_NOT_FOUND', 'Player session not found in this room.', 404);
    }

    if (this.state !== 'QUESTION_ACTIVE') {
      throw new AppError('INVALID_ROOM_STATE', `Question is not currently active for answering. Current state: ${this.state}.`, 400);
    }

    const activeQuestion = this.gameSpecification.questions[this.currentQuestionIndex];
    if (!activeQuestion || activeQuestion.id !== questionId) {
      throw new AppError('QUESTION_NOT_FOUND', `Question "${questionId}" does not match the active question.`, 404);
    }

    if (player.answeredQuestionIds.has(questionId)) {
      throw new AppError('QUESTION_ALREADY_ANSWERED', 'You have already submitted an answer for this question.', 400);
    }

    // Server-authoritative timer deadline check
    if (this.questionDeadlineAt !== null && now > this.questionDeadlineAt) {
      throw new AppError('ANSWER_TIMEOUT', 'Answer submitted after question time limit expired.', 400);
    }

    // Reuse Day 3 handler for answer validation
    const handler = getHandler(activeQuestion.type);
    const validation = handler.validateAnswer(activeQuestion, rawAnswer);

    if (!validation.isValid) {
      throw new AppError('INVALID_ANSWER', validation.invalidReason || 'Invalid answer submitted.', 400);
    }

    // Reuse Day 3 scoring calculation
    const responseTimeMs = Math.max(0, now - (this.questionStartedAt || now));
    const timeLimitMs = this.gameSpecification.settings.timePerQuestion * 1000;

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
    const answeredCount = connectedPlayers.filter(p => p.answeredQuestionIds.has(questionId)).length;
    const allAnswered = connectedPlayers.length > 0 && answeredCount >= connectedPlayers.length;

    return { result, allAnswered };
  }

  /**
   * Reveals the answer and leaderboard for the current question.
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
    this.updatedAt = Date.now();

    const activeQuestion = this.gameSpecification.questions[this.currentQuestionIndex];

    // Compute answer stats across all players who answered
    const answerStats: Record<string, number> = {};
    for (const player of this.players.values()) {
      const qResult = player.questionResults.get(activeQuestion.id);
      if (qResult) {
        const key = qResult.answer.trim();
        answerStats[key] = (answerStats[key] || 0) + 1;
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
      throw new AppError('INVALID_ROOM_STATE', 'Cannot advance to next question until the current question has been revealed.', 400);
    }

    const nextIndex = this.currentQuestionIndex + 1;
    if (nextIndex < this.gameSpecification.questions.length) {
      const question = this.activateQuestion(nextIndex);
      return { nextQuestionAvailable: true, question, finished: false };
    } else {
      this.state = 'FINISHED';
      this.updatedAt = Date.now();
      return { nextQuestionAvailable: false, finished: true, finalLeaderboard: this.getLeaderboard() };
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
    return this.getLeaderboard();
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

    playerList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      if (a.totalResponseTimeMs !== b.totalResponseTimeMs) return a.totalResponseTimeMs - b.totalResponseTimeMs;
      return a.playerId.localeCompare(b.playerId);
    });

    return playerList.map((player, index) => ({
      rank: index + 1,
      playerId: player.playerId,
      displayName: player.displayName,
      score: player.score,
      correctCount: player.correctCount,
      streak: player.maxStreak,
      totalResponseTimeMs: player.totalResponseTimeMs,
      connected: player.connected,
    }));
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
      choices: question.choices ? [...question.choices] : undefined,
      difficulty: question.difficulty,
      crosswordClue: question.crosswordClue,
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.gameSpecification.questions.length,
      timePerQuestion: this.gameSpecification.settings.timePerQuestion,
      deadlineAt: this.questionDeadlineAt || Date.now(),
    };
  }

  /**
   * Returns safe public lobby status.
   */
  public getLobbyInfo(): RoomLobbyInfo {
    return {
      roomCode: this.roomCode,
      state: this.state,
      playerCount: this.players.size,
      capacity: this.capacity,
      title: this.gameSpecification.title,
      gameType: this.gameSpecification.gameType,
      totalQuestions: this.gameSpecification.questions.length,
    };
  }
}

/**
 * Service to orchestrate room creation and lookup.
 */
class RoomService {
  public createRoom(
    gameSpecification: GameSpecification,
    capacity: number = MULTIPLAYER_CONFIG.MAX_PLAYERS_PER_ROOM
  ): MultiplayerRoom {
    GameSpecificationSchema.parse(gameSpecification);

    const roomId = `room_${crypto.randomUUID()}`;
    const roomCode = roomStore.generateUniqueRoomCode();
    const hostToken = `host_${crypto.randomUUID()}`;

    const room = new MultiplayerRoom(roomId, roomCode, gameSpecification, hostToken, capacity);
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

