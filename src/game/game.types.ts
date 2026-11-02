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
import type { PerformanceEvaluation } from './game.scoring.js';

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
  sliderConfig?: {
    min: number;
    max: number;
    step: number;
    unit?: string;
  };
  difficulty: Difficulty;
  crosswordClue?: string;
  crosswordWordLength?: number;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
  remainingTimeSeconds?: number;
  deadlineAt?: number;
  examRemainingSeconds?: number;
  examDeadlineAt?: number;
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
  sourceReference?: GameQuestion['sourceReference'];
  timedOut?: boolean;
}

/**
 * Final deterministic game result returned upon session completion.
 */
export interface GameResult {
  sessionId: string;
  gameId: string;
  title: string;
  gameType: GameType;
  sessionMode?: 'PLAY' | 'EXAM';
  examStatus?: 'OPEN' | 'CLOSING' | 'CLOSED';
  answersPublished?: boolean;
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
  evaluation?: PerformanceEvaluation;
  participantId?: string | null;
  displayName?: string | null;
  departmentUnit?: string | null;
}

/**
 * Summary view of session status.
 */
export interface GameSessionSummary {
  sessionId: string;
  gameId: string;
  state: GameSessionState;
  sessionMode?: 'PLAY' | 'EXAM';
  examStatus?: 'OPEN' | 'CLOSING' | 'CLOSED';
  currentQuestionIndex: number;
  totalQuestions: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  currentStreak: number;
  startedAt: string | null;
  finishedAt: string | null;
  participantId?: string | null;
  displayName?: string | null;
  departmentUnit?: string | null;
  examRemainingSeconds?: number;
  examDeadlineAt?: number | null;
}

/**
 * Request schema to create a game session.
 */
export const CreateSessionRequestSchema = z.object({
  gameId: z.string().min(1),
  gameSpecification: GameSpecificationSchema.optional(),
  publicPlay: z.boolean().optional(),
  participantId: z.string().trim().min(1).optional(),
  participantName: z.string().trim().max(120).optional(),
  playerName: z.string().trim().max(120).optional(),
  displayName: z.string().trim().max(120).optional(),
  departmentUnit: z.string().trim().max(120).optional(),
  employeeCode: z.string().trim().max(80).optional(),
  lockToken: z.string().trim().max(200).optional(),
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
  timedOut: z.boolean().optional(),
});
export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;
