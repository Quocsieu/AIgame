export type QuestionType =
  | 'QUIZ'
  | 'TRUE_FALSE'
  | 'TYPE_ANSWER'
  | 'PUZZLE'
  | 'SLIDER'
  | 'MULTIPLE_CHOICE'
  | 'FILL_IN_THE_BLANK'
  | 'QUICK_BUTTON'
  | 'CROSSWORD';
export type GameType = QuestionType | 'MIXED' | 'ADVENTURE';

export type IndustryId =
  | 'MOTORCYCLE_TRAFFIC'
  | 'BUSINESS_SALES'
  | 'MANUFACTURING_INDUSTRIAL'
  | 'IT_TECHNOLOGY'
  | 'HEALTHCARE_TRAINING'
  | 'FINANCE_BANKING'
  | 'FNB_HOSPITALITY'
  | 'EDUCATION_GENERAL'
  | 'CUSTOM';

export type AvatarId =
  | 'MOTO_RIDER'
  | 'SALES_ADVISOR'
  | 'FACTORY_ENGINEER'
  | 'CYBER_BOT'
  | 'MEDICAL_MEDIC'
  | 'EXPLORER_RUNNER';

export type ObstacleType =
  | 'TRAFFIC_CONE'
  | 'OIL_BARREL'
  | 'TIRE_STACK'
  | 'BARRIER_GATE'
  | 'CARGO_CRATE'
  | 'FORKLIFT_PALLET'
  | 'SERVER_FIREWALL'
  | 'BUG_DRONE'
  | 'BIOHAZARD_CART'
  | 'MEDICAL_SCREEN';

export type DecorStyle =
  | 'GARAGE_WORKSHOP'
  | 'CITY_STREET'
  | 'CORPORATE_PLAZA'
  | 'FACTORY_PLANT'
  | 'CYBER_DATACENTER'
  | 'HOSPITAL_WARD'
  | 'ACADEMY_CAMPUS';

export type GameplayArchetype =
  | 'TRAFFIC_RUNNER_SIM'
  | 'DIAGNOSTIC_WORKBENCH_SIM'
  | 'CYBER_DEFENSE_CONSOLE_SIM'
  | 'SCENARIO_DECISION_SIM';

export type ControlScheme =
  | 'RUNNER_JUMP_CHECKPOINT'
  | 'WORKBENCH_NODE_INSPECT'
  | 'SOC_NODE_TRIAGE'
  | 'SCENARIO_CASE_DECISION';

export type QuestionTriggerMode =
  | 'CHECKPOINT_GATE'
  | 'COMPONENT_DIAGNOSIS'
  | 'INCIDENT_CONTAINMENT'
  | 'CASE_CONSULTATION';

export interface AdventurePalette {
  skyTop: string;
  skyBottom: string;
  horizonGlow: string;
  groundTop: string;
  groundBottom: string;
  roadSurface: string;
  roadLine: string;
  accentColor: string;
  buildingPrimary: string;
  buildingSecondary: string;
}

export interface AdventureStage {
  stageIndex: number;
  questionId?: string;
  checkpointTitle: string;
  zoneLabel: string;
  obstacleType: ObstacleType;
  hintBanner?: string;
}

export interface AdventureConfig {
  version: number;
  industryId: IndustryId;
  industryLabel: string;
  subEnvironment: string;
  learningObjective: string;
  aiDetectedIndustry: boolean;
  aiConfidence: number;
  aiReasoning: string;
  proposalConfirmed: boolean;
  themePresetId: string;
  environmentTitle: string;
  environmentSubtitle: string;
  decorStyle: DecorStyle;
  avatarId: AvatarId;
  avatarLabel: string;
  palette: AdventurePalette;
  obstacleTypes: ObstacleType[];
  obstacleDensity: 'LOW' | 'MEDIUM' | 'HIGH';
  speedMultiplier: number;
  reducedMotion: boolean;
  questionTypes?: QuestionType[];
  gameplayArchetype?: GameplayArchetype;
  controlScheme?: ControlScheme;
  questionTriggerMode?: QuestionTriggerMode;
  winConditionSummary?: string;
  interactiveObjects?: string[];
  stages: AdventureStage[];
}
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ScoringMode = 'STANDARD' | 'SPEED_BONUS' | 'STREAK';
export type SourceType = 'WEBSITE' | 'DOCX' | 'XLSX' | 'PDF' | 'TXT' | 'MARKDOWN' | 'CSV';

export interface MixedQuestionDistribution {
  MULTIPLE_CHOICE: number;
  QUICK_BUTTON: number;
  FILL_IN_THE_BLANK: number;
  CROSSWORD: number;
}

export function calculateMixedTypeCounts(
  totalCount: number,
  distribution?: MixedQuestionDistribution
): Record<QuestionType, number> {
  const dist = distribution || {
    MULTIPLE_CHOICE: 40,
    QUICK_BUTTON: 20,
    FILL_IN_THE_BLANK: 20,
    CROSSWORD: 20,
  };

  const types: (keyof MixedQuestionDistribution)[] = [
    'MULTIPLE_CHOICE',
    'QUICK_BUTTON',
    'FILL_IN_THE_BLANK',
    'CROSSWORD',
  ];

  const rawCounts = types.map(type => {
    const ratio = (dist[type] ?? 0) / 100;
    const exact = totalCount * ratio;
    const floor = Math.floor(exact);
    const remainder = exact - floor;
    return { type, exact, floor, remainder };
  });

  const allocated = rawCounts.reduce((sum, item) => sum + item.floor, 0);
  const deficit = totalCount - allocated;

  rawCounts.sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-6) {
      return b.remainder - a.remainder;
    }
    return (dist[b.type] ?? 0) - (dist[a.type] ?? 0);
  });

  for (let i = 0; i < deficit; i++) {
    rawCounts[i % rawCounts.length].floor += 1;
  }

  const result: Record<QuestionType, number> = {
    QUIZ: 0,
    TRUE_FALSE: 0,
    TYPE_ANSWER: 0,
    PUZZLE: 0,
    SLIDER: 0,
    MULTIPLE_CHOICE: 0,
    QUICK_BUTTON: 0,
    FILL_IN_THE_BLANK: 0,
    CROSSWORD: 0,
  };

  for (const item of rawCounts) {
    result[item.type] = item.floor;
  }

  return result;
}

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

export interface SliderQuestionConfig {
  min: number;
  max: number;
  step: number;
  correctValue: number;
  tolerance: number;
  unit?: string;
}

export interface ClientSliderConfig {
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface GameQuestion {
  id: string;
  type: QuestionType;
  question: string;
  choices?: string[];
  sliderConfig?: SliderQuestionConfig;
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
  coverImageUrl?: string | null;
  title: string;
  description: string;
  gameType: GameType;
  questions: GameQuestion[];
  settings: {
    questionCount: number;
    timePerQuestion: number;
    scoringMode: ScoringMode;
    mixedDistribution?: MixedQuestionDistribution;
    adventureConfig?: AdventureConfig;
  };
  sourceSummary?: {
    sourceCount: number;
  adventureConfig?: AdventureConfig;
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
  sliderConfig?: ClientSliderConfig;
  difficulty: Difficulty;
  crosswordClue?: string;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
  remainingTimeSeconds?: number;
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

export interface GameActiveSessionItem {
  sessionId: string;
  state: string;
  startedAt: string | null;
}

export interface GameActiveRoomItem {
  roomId: string;
  roomCode: string;
  state: string;
  playerCount: number;
  createdAt: number;
}

export interface GameActiveStatus {
  gameId: string;
  hasActiveSession: boolean;
  activeSessionCount: number;
  activeSessions: GameActiveSessionItem[];
  hasActiveRoom: boolean;
  activeRoomCount: number;
  activeRooms: GameActiveRoomItem[];
  isDeletable: boolean;
}

export interface PersistedGameSummary {
  gameId: string;
  ownerUserId: string | null;
  isPublic: boolean;
  coverImageUrl?: string | null;
  title: string;
  description: string;
  gameType: GameType;
  questionCount: number;
  timePerQuestion: number;
  scoringMode: ScoringMode;
  sourceCount: number;
  adventureConfig?: AdventureConfig;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  activeStatus?: GameActiveStatus;
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
  isExternalPlayOnOwnedGame?: boolean;
}

export interface MultiplayerRoomAnalyticsItem {
  roomId: string;
  roomCode: string;
  gameId: string;
  gameTitle: string;
  gameType: string;
  scoringMode: string;
  state?: string;
  playerCount: number;
  totalQuestions: number;
  topScore: number;
  averageScore?: number | null;
  totalScoreEarned: number;
  totalCorrectAnswers: number;
  bestStreak: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  leaderboard: Array<{
    rank: number;
    displayName: string;
    score: number;
    correctCount: number;
    streak: number;
  }>;
}

export interface OwnedGameAnalyticsItem {
  gameId: string;
  gameTitle: string;
  gameType: string;
  isPublic?: boolean;
  questionCount?: number;
  createdAt?: string;
  totalPlaysCount?: number;
  completedPlaysCount?: number;
  inProgressPlaysCount?: number;
  abandonedPlaysCount?: number;
  sessionsCount: number;
  personalSessionsCount?: number;
  publicSessionsCount?: number;
  multiplayerRoomsCount?: number;
  multiplayerPlayersCount?: number;
  questionsAnswered: number;
  correctAnswers: number;
  accuracyPercent: number | null;
  averageScore?: number | null;
  bestScore: number;
  lastPlayedAt: string;
}

export interface LearningAnalyticsSummary {
  scope: {
    userId: string | null;
    from: string | null;
    to: string | null;
    tzOffsetMinutes: number;
  };
  hasData: boolean;
  hasPlayData?: boolean;
  overview: {
    totalGamesCreated: number;
    totalPlaysCount?: number;
    completedPlaysCount?: number;
    inProgressPlaysCount?: number;
    abandonedPlaysCount?: number;
    completionRatePercent?: number | null;
    soloCompletionRatePercent?: number | null;
    multiplayerCompletionRatePercent?: number | null;
    soloAverageScore?: number | null;
    multiplayerAverageScore?: number | null;
    totalPracticeSessions?: number;
    completedPracticeSessions: number;
    inProgressPracticeSessions?: number;
    abandonedPracticeSessions?: number;
    personalPracticeSessions?: number;
    creatorGamePracticeSessions?: number;
    totalMultiplayerRooms?: number;
    completedMultiplayerRooms: number;
    inProgressMultiplayerRooms?: number;
    abandonedMultiplayerRooms?: number;
    multiplayerPlayersCount?: number;
    multiplayerTotalCorrectAnswers?: number;
    multiplayerTotalScoreEarned?: number;
    multiplayerBestStreak?: number;
    totalQuestionsAnswered: number;
    totalCorrectAnswers: number;
    totalWrongAnswers: number;
    overallAccuracyPercent: number | null;
    totalScoreEarned: number;
    soloTotalScoreEarned?: number;
    averageScorePerSession: number | null;
    bestStreak: number;
    totalPracticeDurationMs: number;
  };
  progressOverTime: Array<{
    date: string;
    totalPlaysCount?: number;
    completedPlaysCount?: number;
    inProgressPlaysCount?: number;
    abandonedPlaysCount?: number;
    sessionsCount: number;
    soloSessionsCount?: number;
    multiplayerRoomsCount?: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number | null;
    totalDurationMs: number;
  }>;
  byGameType: Array<{
    gameType: string;
    totalPlaysCount?: number;
    completedPlaysCount?: number;
    sessionsCount: number;
    multiplayerRoomsCount?: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number | null;
  }>;
  byGameTopic: OwnedGameAnalyticsItem[];
  ownedGames?: OwnedGameAnalyticsItem[];
  recentMultiplayerRooms?: MultiplayerRoomAnalyticsItem[];
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
