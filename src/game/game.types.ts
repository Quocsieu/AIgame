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

export const GameSessionStateEnum = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'QUESTION_ACTIVE',
  'QUESTION_ANSWERED',
  'FINISHED',
  'ABANDONED',
]);
export type GameSessionState = z.infer<typeof GameSessionStateEnum>;

/**
 * Client-facing question representation.
 * Explicitly omits authoritative correctAnswer, acceptedAlternatives, and explanation.
 */
export interface ClientQuestion {
  id: string;
  type: GameType;
  question: string;
  choices?: string[];
  difficulty: Difficulty;
  crosswordClue?: string;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
}

/**
 * Authoritative result of a single question submission.
 */
export interface QuestionResult {
  questionId: string;
  answer: string;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
  answeredAt: string;
  correctAnswer: string;
  explanation?: string;
}

/**
 * Final deterministic game result returned upon session completion.
 */
export interface GameResult {
  sessionId: string;
  gameId: string;
  title: string;
  gameType: GameType;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  score: number;
  maxPossibleScore: number;
  startedAt: string;
  finishedAt: string;
  questionResults: QuestionResult[];
  accuracy: number;
  streak: number;
}

/**
 * Summary view of session status.
 */
export interface GameSessionSummary {
  sessionId: string;
  gameId: string;
  state: GameSessionState;
  currentQuestionIndex: number;
  totalQuestions: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  currentStreak: number;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Request schema to create a game session.
 */
export const CreateSessionRequestSchema = z.object({
  gameId: z.string().min(1),
  gameSpecification: GameSpecificationSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

/**
 * Request schema to submit an answer.
 * Does NOT accept client-supplied score or isCorrect.
 */
export const SubmitAnswerRequestSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
  clientTimestamp: z.number().optional(),
});
export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;

