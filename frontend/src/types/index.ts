export type QuestionType = 'MULTIPLE_CHOICE' | 'FILL_IN_THE_BLANK' | 'QUICK_BUTTON' | 'CROSSWORD';
export type GameType = QuestionType | 'MIXED';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ScoringMode = 'STANDARD' | 'SPEED_BONUS' | 'STREAK';
export type SourceType = 'WEBSITE' | 'DOCX' | 'XLSX' | 'PDF' | 'TXT' | 'MARKDOWN' | 'CSV';

export interface ProvenanceReference {
  sourceId: string;
  sourceType: SourceType;
  sourceLocation: string;
  page?: number;
  sheet?: string;
  row?: number;
  section?: string;
  sectionHeading?: string;
  paragraphIndex?: number;
}

export interface GameQuestion {
  id: string;
  type: QuestionType;
  question: string;
  choices?: string[];
  correctAnswer: string;
  acceptedAlternatives?: string[];
  explanation?: string;
  difficulty: Difficulty;
  crosswordClue?: string;
  crosswordAnswer?: string;
  sourceReference: ProvenanceReference;
}

export interface GameSpecification {
  gameId: string;
  ownerUserId?: string | null;
  isPublic?: boolean;
  title: string;
  description: string;
  gameType: GameType;
  questions: GameQuestion[];
  settings: {
    questionCount: number;
    timePerQuestion: number;
    scoringMode: ScoringMode;
  };
  sourceSummary?: {
    sourceCount: number;
    sources: {
      sourceId: string;
      sourceType: SourceType;
      sourceName: string;
      sourceLocation: string;
    }[];
  };
  diagnostics?: string[];
  generatedAt: string;
}

export interface SanitizedQuestion {
  id: string;
  type: QuestionType;
  question: string;
  choices?: string[];
  difficulty: Difficulty;
  crosswordClue?: string;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
  deadlineAt?: number;
}

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

export interface PlayerQuestionResult {
  questionId: string;
  answer: string;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
  answeredAt: number;
}

export interface IngestedSourceSection {
  title?: string;
  content: string;
  provenance?: ProvenanceReference;
}

export interface IngestedSource {
  sourceId: string;
  sourceType: SourceType;
  sourceName: string;
  sourceLocation: string;
  title?: string;
  sections?: IngestedSourceSection[];
  metadata?: {
    originalSize?: number;
    characterCount?: number;
    pageCount?: number;
    sheetCount?: number;
  };
  diagnostics?: {
    code: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
  }[];
  tokenEstimate?: number;
}

export interface CreateRoomResponse {
  roomId: string;
  roomCode: string;
  hostToken: string;
  joinUrl: string;
  capacity: number;
}

export interface QrResponse {
  roomCode: string;
  joinUrl: string;
  qrDataUrl: string;
}

// Single-Player Practice Mode Types
export interface PracticeQuestionResult {
  questionId: string;
  answer: string;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
  answeredAt: string;
  correctAnswer: string;
  explanation?: string;
  sourceReference?: ProvenanceReference;
}

export interface PracticeFinalResult {
  sessionId: string;
  gameId: string;
  title: string;
  gameType: GameType;
  totalQuestions: number;
  correctCount?: number;
  wrongCount?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  score?: number;
  totalScore?: number;
  maxPossibleScore: number;
  startedAt?: string;
  finishedAt?: string;
  questionResults: PracticeQuestionResult[];
  accuracy?: number;
  streak?: number;
  maxStreak?: number;
  durationMs?: number;
}

// Phase 3 & Phase 4 Types: Auth, Quotas, Persistence, Analytics & Observability
export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

export interface QuotaCheckItem {
  quotaKey: string;
  windowKey: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

export interface UserQuotaSummary {
  userId: string;
  windowKey: string;
  resetAt: string;
  dailyIngestions: QuotaCheckItem;
  dailyGameGenerations: QuotaCheckItem;
  dailyAiCalls: QuotaCheckItem;
  activeSessions: {
    used: number;
    limit: number;
    remaining: number;
  };
  activeRooms: {
    used: number;
    limit: number;
    remaining: number;
  };
}

export interface PersistedGameSummary {
  gameId: string;
  ownerUserId: string | null;
  isPublic: boolean;
  title: string;
  description: string;
  gameType: GameType;
  questionCount: number;
  timePerQuestion: number;
  scoringMode: ScoringMode;
  sourceCount: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedPracticeSessionRecord {
  sessionId: string;
  gameId: string;
  ownerUserId: string | null;
  gameTitle: string;
  gameType: GameType;
  scoringMode: ScoringMode;
  state: string;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  totalScore: number;
  maxPossibleScore: number;
  maxStreak: number;
  durationMs: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface LearningAnalyticsSummary {
  scope: {
    userId: string | null;
    from: string | null;
    to: string | null;
    tzOffsetMinutes: number;
  };
  hasData: boolean;
  overview: {
    totalGamesCreated: number;
    completedPracticeSessions: number;
    completedMultiplayerRooms: number;
    totalQuestionsAnswered: number;
    totalCorrectAnswers: number;
    totalWrongAnswers: number;
    overallAccuracyPercent: number | null;
    totalScoreEarned: number;
    averageScorePerSession: number | null;
    bestStreak: number;
    totalPracticeDurationMs: number;
  };
  progressOverTime: Array<{
    date: string;
    sessionsCount: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number;
    totalDurationMs: number;
  }>;
  byGameType: Array<{
    gameType: string;
    sessionsCount: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number;
  }>;
  byGameTopic: Array<{
    gameId: string;
    gameTitle: string;
    gameType: string;
    sessionsCount: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    bestScore: number;
    lastPlayedAt: string;
  }>;
}

export interface AiObservabilitySummary {
  totals: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageLatencyMs: number | null;
    callsWithReportedTokens: number;
    callsWithUnknownTokens: number;
    reportedInputTokens: number | null;
    reportedOutputTokens: number | null;
    reportedTotalTokens: number | null;
    estimatedCostUsd: number | null;
    pricingConfigured: boolean;
  };
  questionQuality: {
    totalRequested: number;
    totalGeneratedRaw: number;
    totalValidAccepted: number;
    totalRejectedInvalid: number;
    totalDuplicatesFiltered: number;
    totalDiagnostics: number;
    acceptanceRatePercent: number | null;
  };
}

export interface AdminOverviewStats {
  totalUsers: number;
  totalGames: number;
  publishedGames: number;
  draftGames: number;
  totalSessions: number;
  totalRooms: number;
  activeRoomsCount: number;
  activeRooms?: Array<{
    roomCode: string;
    roomId: string;
    title: string;
    state: string;
    playerCount: number;
    currentQuestionIndex: number;
    totalQuestions: number;
  }>;
}

export interface AdminUserRecord {
  userId: string;
  email: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  gameCount: number;
}

export interface AdminAiLogRecord {
  log_id: string;
  user_id: string | null;
  provider: string;
  model: string;
  operation: string;
  status: string;
  error_code: string | null;
  latency_ms: number;
  total_tokens: number | null;
  generated_questions: number;
  created_at: string;
}
