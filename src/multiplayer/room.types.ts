import { z } from 'zod';
import {
  Difficulty,
  DifficultyEnum,
  GameQuestion,
  GameSpecification,
  GameSpecificationSchema,
  GameType,
  GameTypeEnum,
  ScoringMode,
} from '../contracts/game.contract.js';

export const RoomStateEnum = z.enum([
  'WAITING',
  'QUESTION_ACTIVE',
  'QUESTION_REVEAL',
  'FINISHED',
  'CLOSED',
]);
export type RoomState = z.infer<typeof RoomStateEnum>;

export const MULTIPLAYER_CONFIG = {
  MAX_PLAYERS_PER_ROOM: 300,
  ROOM_TTL_MS: 2 * 60 * 60 * 1000, // 2 hours
  ROOM_CODE_LENGTH: 6,
  // Ambiguity-free uppercase alphabet (excludes confusing characters: 0, O, 1, I, 5, S)
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRTUVWXYZ2346789',
} as const;

/**
 * Result of a single player answering one question.
 */
export interface PlayerQuestionResult {
  questionId: string;
  answer: string;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
  answeredAt: number;
}

/**
 * Single player session state in a multiplayer room.
 */
export interface PlayerSession {
  playerId: string;
  playerToken: string;
  displayName: string;
  connected: boolean;
  score: number;
  correctCount: number;
  wrongCount: number;
  currentStreak: number;
  maxStreak: number;
  totalResponseTimeMs: number;
  answeredQuestionIds: Set<string>;
  questionResults: Map<string, PlayerQuestionResult>;
  joinedAt: number;
  lastSeenAt: number;
}

/**
 * Deterministically sorted leaderboard entry.
 */
export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  score: number;
  correctCount: number;
  streak: number;
  totalResponseTimeMs: number;
  connected: boolean;
}

/**
 * Sanitized question DTO for players and host before question reveal.
 * Strictly excludes correctAnswer, acceptedAlternatives, and explanation.
 */
export interface SanitizedQuestion {
  id: string;
  type: GameType;
  question: string;
  choices?: string[];
  difficulty: Difficulty;
  crosswordClue?: string;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
  deadlineAt: number;
}

// ==========================================
// Inbound WebSocket Message Schemas
// ==========================================

export const HostJoinSchema = z.object({
  type: z.literal('host.join'),
  roomCode: z.string().min(1),
  hostToken: z.string().min(1),
});

export const HostStartSchema = z.object({
  type: z.literal('host.start'),
});

export const HostNextSchema = z.object({
  type: z.literal('host.next'),
});

export const HostEndSchema = z.object({
  type: z.literal('host.end'),
});

export const PlayerJoinSchema = z.object({
  type: z.literal('player.join'),
  roomCode: z.string().min(1),
  displayName: z.string().trim().min(1).max(30),
  playerToken: z.string().optional(),
});

export const PlayerAnswerSchema = z.object({
  type: z.literal('player.answer'),
  questionId: z.string().min(1),
  answer: z.string(),
});

export const PlayerReconnectSchema = z.object({
  type: z.literal('player.reconnect'),
  roomCode: z.string().min(1),
  playerToken: z.string().min(1),
});

export const PlayerLeaveSchema = z.object({
  type: z.literal('player.leave'),
});

export type HostInboundMessage =
  | z.infer<typeof HostJoinSchema>
  | z.infer<typeof HostStartSchema>
  | z.infer<typeof HostNextSchema>
  | z.infer<typeof HostEndSchema>;

export type PlayerInboundMessage =
  | z.infer<typeof PlayerJoinSchema>
  | z.infer<typeof PlayerAnswerSchema>
  | z.infer<typeof PlayerReconnectSchema>
  | z.infer<typeof PlayerLeaveSchema>;

export type InboundMessage = HostInboundMessage | PlayerInboundMessage;

// ==========================================
// Outbound WebSocket Message Types
// ==========================================

export type OutboundMessage =
  | {
      type: 'room.joined';
      role: 'host' | 'player';
      roomCode: string;
      roomId: string;
      playerId?: string;
      playerToken?: string;
      state: RoomState;
      title: string;
      gameType: GameType;
      totalQuestions: number;
      playerCount: number;
    }
  | {
      type: 'lobby.playerJoined';
      playerCount: number;
      player: { id: string; displayName: string };
    }
  | {
      type: 'lobby.playerLeft';
      playerCount: number;
      playerId: string;
    }
  | {
      type: 'game.started';
      totalQuestions: number;
    }
  | {
      type: 'question.started';
      question: SanitizedQuestion;
    }
  | {
      type: 'question.answerReceived';
      questionId: string;
    }
  | {
      type: 'question.timeUp';
    }
  | {
      type: 'question.revealed';
      questionId: string;
      correctAnswer: string;
      explanation?: string;
      leaderboard: LeaderboardEntry[];
      personalResult?: PlayerQuestionResult;
      answerStats?: Record<string, number>;
    }
  | {
      type: 'leaderboard.updated';
      leaderboard: LeaderboardEntry[];
    }
  | {
      type: 'game.finished';
      leaderboard: LeaderboardEntry[];
      winner?: LeaderboardEntry;
      totalQuestions: number;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

// ==========================================
// HTTP Request & Response Schemas
// ==========================================

export const CreateRoomRequestSchema = z.object({
  gameId: z.string().min(1),
  gameSpecification: GameSpecificationSchema.optional(),
  capacity: z.number().int().min(1).max(300).optional(),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export interface CreateRoomResponseData {
  roomId: string;
  roomCode: string;
  hostToken: string;
  joinUrl: string;
  capacity: number;
}

export interface RoomLobbyInfo {
  roomCode: string;
  state: RoomState;
  playerCount: number;
  capacity: number;
  title: string;
  gameType: GameType;
  totalQuestions: number;
}

