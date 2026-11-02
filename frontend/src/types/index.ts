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

export type AdventureAssetType = 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE';
export type AdventureAssetSource = 'ANTIGRAVITY_BANANA_PACK' | 'GEMINI_BANANA_RUNTIME';
export type AdventureAssetStatus =
  | 'READY'
  | 'ASSET_GENERATION_PENDING'
  | 'ASSET_GENERATION_FAILED'
  | 'LEGACY_UNVERIFIED';

export interface AdventureAssetMetadata {
  industryId: IndustryId;
  assetType: AdventureAssetType;
  fileName: string;
  url: string;
  relativePath: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  source: AdventureAssetSource;
  verified: boolean;
}

export interface AdventureBoundAssets {
  background: AdventureAssetMetadata;
  character: AdventureAssetMetadata;
  obstacle: AdventureAssetMetadata;
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
  questionDistribution?: MixedQuestionDistribution;
  gameplayArchetype?: GameplayArchetype;
  controlScheme?: ControlScheme;
  questionTriggerMode?: QuestionTriggerMode;
  winConditionSummary?: string;
  interactiveObjects?: string[];
  stages: AdventureStage[];
  assetStatus?: AdventureAssetStatus;
  assetPackSource?: AdventureAssetSource | null;
  assets?: AdventureBoundAssets | null;
  assetError?: string | null;
  assetErrorCode?: string | null;
  assetUpdatedAt?: string | null;
}
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ScoringMode = 'STANDARD' | 'SPEED_BONUS' | 'STREAK';
export type SessionMode = 'PLAY' | 'EXAM';
export type TimerMode = 'PER_QUESTION' | 'TOTAL_EXAM' | 'UNLIMITED';
export type RosterMode = 'FREE_TEXT' | 'PRECONFIGURED' | 'HYBRID';
export type OfficialAttemptPolicy = 'LATEST_ATTEMPT' | 'HIGHEST_SCORE';
export type AudioPresetId =
  | 'NONE'
  | 'ENERGETIC_ARENA'
  | 'EXAM_FOCUS'
  | 'ADVENTURE_QUEST'
  | 'CORPORATE_CALM'
  | 'ARCADE_FUN'
  | 'CLASSROOM_QUIZ'
  | 'CORPORATE_TRAINING'
  | 'CUSTOM';

export type SoundPackId =
  | 'ARCADE_FUN'
  | 'CLASSROOM_QUIZ'
  | 'ADVENTURE_QUEST'
  | 'CORPORATE_TRAINING'
  | 'ENERGETIC_ARENA'
  | 'EXAM_FOCUS'
  | 'CORPORATE_CALM'
  | 'CUSTOM'
  | 'NONE';

export type SfxCueType =
  | 'correct'
  | 'wrong'
  | 'timeout'
  | 'countdown'
  | 'start'
  | 'finish'
  | 'top3';

export interface CustomSfxOverride {
  url: string;
  audioUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export type ExamStatus = 'OPEN' | 'CLOSING' | 'CLOSED';

export interface GameAudioConfig {
  enabled: boolean;
  bgmEnabled?: boolean;
  presetId: AudioPresetId;
  soundPackId?: SoundPackId;
  customAudioUrl?: string | null;
  customAudioFileName?: string | null;
  customAudioName?: string | null;
  customAudioMimeType?: string | null;
  customAudioSizeBytes?: number | null;
  customSfxOverrides?: Partial<Record<SfxCueType, CustomSfxOverride | null>>;
  volume: number;
  countdownSoundEnabled: boolean;
  countdownTriggerSeconds: number;
  sfxEnabled?: boolean;
}

export type PerformanceTier = 'NEEDS_EFFORT' | 'PARTIAL_MASTERY' | 'GOOD' | 'EXCELLENT';

export interface PerformanceEvaluation {
  correctAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  accuracyPercentage?: number;
  totalScore: number;
  maxPossibleScore: number;
  tier: PerformanceTier;
  tierLabel:
    | 'Cần cố gắng thêm'
    | 'Đã nắm được một phần kiến thức'
    | 'Làm tốt'
    | 'Xuất sắc';
  comment: string;
  isPassed: boolean | null;
  passStatusLabel: 'Đạt' | 'Chưa đạt' | null;
  passThresholdPercent: number;
}

export function calculateFrontendMaxPossibleScore(
  questionCount: number,
  scoringMode: ScoringMode = 'SPEED_BONUS'
): number {
  const count = Math.max(0, Math.floor(Number(questionCount) || 0));
  if (count === 0) return 0;
  const basePoints = 100;
  const maxSpeedBonus = 50;
  const streakBonusStep = 20;
  const maxStreakMultiplier = 5;

  switch (scoringMode) {
    case 'STANDARD':
      return count * basePoints;
    case 'SPEED_BONUS':
      return count * (basePoints + maxSpeedBonus);
    case 'STREAK': {
      let total = 0;
      for (let i = 0; i < count; i++) {
        const effectiveStreak = Math.min(i, maxStreakMultiplier);
        total += basePoints + maxSpeedBonus + effectiveStreak * streakBonusStep;
      }
      return total;
    }
    default:
      return count * basePoints;
  }
}

export function evaluateFrontendPerformance(
  paramsOrCorrect:
    | {
        correctAnswers: number;
        totalQuestions: number;
        totalScore?: number;
        maxPossibleScore?: number;
        sessionMode?: SessionMode;
        passThresholdPercent?: number;
      }
    | number,
  totalQuestionsArg?: number,
  passThresholdArg?: number
): PerformanceEvaluation {
  const params =
    typeof paramsOrCorrect === 'number'
      ? {
          correctAnswers: paramsOrCorrect,
          totalQuestions: totalQuestionsArg ?? 0,
          totalScore: paramsOrCorrect * 100,
          maxPossibleScore: (totalQuestionsArg ?? 0) * 100,
          sessionMode: (passThresholdArg !== undefined ? 'EXAM' : 'PLAY') as SessionMode,
          passThresholdPercent: passThresholdArg,
        }
      : paramsOrCorrect;

  const safeTotal = Math.max(0, Math.floor(Number(params.totalQuestions) || 0));
  const safeCorrect = Math.min(
    safeTotal,
    Math.max(0, Math.floor(Number(params.correctAnswers) || 0))
  );
  const accuracyPercent =
    safeTotal > 0 ? Math.min(100, Math.max(0, Math.round((safeCorrect / safeTotal) * 100))) : 0;
  const totalScore = Math.max(0, Math.round(Number(params.totalScore ?? safeCorrect * 100) || 0));
  const maxPossibleScore = Math.max(
    totalScore,
    Math.round(Number(params.maxPossibleScore ?? safeTotal * 100) || 0)
  );
  const sessionMode: SessionMode = params.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
  const passThresholdPercent =
    typeof params.passThresholdPercent === 'number' && Number.isFinite(params.passThresholdPercent)
      ? Math.min(100, Math.max(0, Math.round(params.passThresholdPercent)))
      : 50;

  let tier: PerformanceTier;
  let tierLabel: PerformanceEvaluation['tierLabel'];
  let comment: string;

  if (accuracyPercent >= 90) {
    tier = 'EXCELLENT';
    tierLabel = 'Xuất sắc';
    comment = 'Bạn đã nắm vững toàn diện nội dung và hoàn thành bài với độ chính xác rất cao.';
  } else if (accuracyPercent >= 70) {
    tier = 'GOOD';
    tierLabel = 'Làm tốt';
    comment = 'Bạn nắm khá chắc kiến thức cốt lõi, chỉ còn một vài chi tiết nhỏ cần lưu ý thêm.';
  } else if (accuracyPercent >= 50) {
    tier = 'PARTIAL_MASTERY';
    tierLabel = 'Đã nắm được một phần kiến thức';
    comment = 'Bạn đã hiểu các ý cơ bản nhưng cần ôn tập thêm để củng cố phần kiến thức còn thiếu.';
  } else {
    tier = 'NEEDS_EFFORT';
    tierLabel = 'Cần cố gắng thêm';
    comment = 'Hãy xem lại tài liệu và luyện tập thêm để nắm vững kiến thức trọng tâm nhé.';
  }

  const isPassed = sessionMode === 'EXAM' ? accuracyPercent >= passThresholdPercent : null;
  const passStatusLabel = isPassed === null ? null : isPassed ? 'Đạt' : 'Chưa đạt';

  return {
    correctAnswers: safeCorrect,
    totalQuestions: safeTotal,
    accuracyPercent,
    accuracyPercentage: accuracyPercent,
    totalScore,
    maxPossibleScore,
    tier,
    tierLabel,
    comment,
    isPassed,
    passStatusLabel,
    passThresholdPercent,
  };
}

export type SourceType = 'WEBSITE' | 'DOCX' | 'XLSX' | 'PDF' | 'TXT' | 'MARKDOWN' | 'CSV';

export interface MixedQuestionDistribution {
  MULTIPLE_CHOICE: number;
  QUICK_BUTTON: number;
  FILL_IN_THE_BLANK: number;
  CROSSWORD: number;
}

export type BaseDistributionQuestionType = keyof MixedQuestionDistribution;

export const BASE_DISTRIBUTION_QUESTION_TYPES: BaseDistributionQuestionType[] = [
  'MULTIPLE_CHOICE',
  'QUICK_BUTTON',
  'FILL_IN_THE_BLANK',
  'CROSSWORD',
];

export function normalizeToBaseDistributionType(
  rawType: string
): BaseDistributionQuestionType | null {
  switch (rawType) {
    case 'MULTIPLE_CHOICE':
    case 'QUIZ':
      return 'MULTIPLE_CHOICE';
    case 'QUICK_BUTTON':
    case 'TRUE_FALSE':
      return 'QUICK_BUTTON';
    case 'FILL_IN_THE_BLANK':
    case 'TYPE_ANSWER':
      return 'FILL_IN_THE_BLANK';
    case 'CROSSWORD':
      return 'CROSSWORD';
    default:
      return null;
  }
}

export function buildDefaultQuestionDistributionForTypes(
  questionTypes?: readonly string[]
): MixedQuestionDistribution {
  const selectedSet = new Set<BaseDistributionQuestionType>();
  if (Array.isArray(questionTypes)) {
    for (const t of questionTypes) {
      const mapped = normalizeToBaseDistributionType(String(t));
      if (mapped) {
        selectedSet.add(mapped);
      }
    }
  }
  const activeTypes =
    selectedSet.size > 0
      ? BASE_DISTRIBUTION_QUESTION_TYPES.filter(t => selectedSet.has(t))
      : (['MULTIPLE_CHOICE', 'QUICK_BUTTON'] as BaseDistributionQuestionType[]);

  const dist: MixedQuestionDistribution = {
    MULTIPLE_CHOICE: 0,
    QUICK_BUTTON: 0,
    FILL_IN_THE_BLANK: 0,
    CROSSWORD: 0,
  };

  const count = activeTypes.length;
  const basePct = Math.floor(100 / count);
  const remainder = 100 - basePct * count;

  activeTypes.forEach((t, idx) => {
    dist[t] = basePct + (idx < remainder ? 1 : 0);
  });

  return dist;
}

export function calculateMixedTypeCounts(
  totalCount: number,
  distribution?: MixedQuestionDistribution
): Record<QuestionType, number> {
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

  if (totalCount <= 0) {
    return result;
  }

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
    const pct = Math.max(0, Number(dist[type] ?? 0));
    const ratio = pct / 100;
    const exact = totalCount * ratio;
    const floor = pct > 0 ? Math.floor(exact) : 0;
    const remainder = pct > 0 ? exact - floor : 0;
    return { type, pct, exact, floor, remainder };
  });

  const allocated = rawCounts.reduce((sum, item) => sum + item.floor, 0);
  const deficit = totalCount - allocated;

  const positiveBuckets = rawCounts.filter(item => item.pct > 0);
  if (positiveBuckets.length > 0 && deficit > 0) {
    positiveBuckets.sort((a, b) => {
      if (Math.abs(b.remainder - a.remainder) > 1e-6) {
        return b.remainder - a.remainder;
      }
      return b.pct - a.pct;
    });

    for (let i = 0; i < deficit; i++) {
      positiveBuckets[i % positiveBuckets.length].floor += 1;
    }
  }

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
  timeLimitSeconds?: number;
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
    sessionMode?: SessionMode;
    timerMode?: TimerMode;
    totalExamDurationSeconds?: number;
    autoAdvanceDelayMs?: number;
    passThresholdPercent?: number;
    officialAttemptPolicy?: OfficialAttemptPolicy;
    rosterMode?: RosterMode;
    answersPublished?: boolean;
    answersPublishedAt?: string | null;
    showExamLeaderboardToPlayers?: boolean;
    examStatus?: ExamStatus;
    examOpenAt?: string | null;
    examCloseAt?: string | null;
    examClosedAt?: string | null;
    allowReplay?: boolean;
    audioConfig?: GameAudioConfig;
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
  crosswordWordLength?: number;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
  remainingTimeSeconds?: number;
  deadlineAt?: number;
  sessionMode?: SessionMode;
  timerMode?: TimerMode;
  examRemainingSeconds?: number;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  participantId?: string | null;
  departmentUnit?: string;
  score: number;
  maxPossibleScore?: number;
  correctCount: number;
  totalQuestions?: number;
  accuracyPercent?: number;
  isPassed?: boolean | null;
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
  timedOut?: boolean;
  examRedacted?: boolean;
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
  timedOut?: boolean;
  examRedacted?: boolean;
  correctAnswer?: string;
  explanation?: string;
  sourceReference?: ProvenanceReference;
}

export interface PracticeFinalResult {
  sessionId: string;
  gameId: string;
  title: string;
  gameType: GameType;
  sessionMode?: SessionMode;
  answersPublished?: boolean;
  passThresholdPercent?: number;
  isPassed?: boolean | null;
  accuracyPercent?: number;
  evaluation?: PerformanceEvaluation;
  performanceEvaluation?: PerformanceEvaluation;
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

export interface ParticipantRosterItem {
  id?: string;
  participantId: string;
  gameId?: string;
  fullName: string;
  departmentUnit: string;
  employeeCode?: string;
  contactInfo?: string;
  allowedAttempts?: number;
  usedAttempts?: number;
  attemptsUsed?: number;
  retakesGranted?: number;
  activeSessionId?: string | null;
  activeRoomCode?: string | null;
  isLocked?: boolean;
  lockStatus?: string;
  canJoin?: boolean;
  canStartAttempt?: boolean;
  bestScore?: number | null;
  latestScore?: number | null;
  latestCorrectAnswers?: number | null;
  latestTotalQuestions?: number | null;
  latestAccuracyPercent?: number | null;
  latestDurationMs?: number | null;
  latestIsPassed?: boolean | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  retakeGrantedCount?: number;
}

export type PublicParticipantItem = ParticipantRosterItem;

export interface ParticipantAttemptHistoryItem {
  attemptId: string;
  gameId: string;
  participantId: string | null;
  sessionId: string | null;
  roomId: string | null;
  roomCode: string | null;
  deliveryMode: 'SOLO' | 'MULTIPLAYER';
  sessionMode: SessionMode;
  attemptNumber: number;
  displayName: string;
  departmentUnit: string;
  state: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED';
  score: number;
  maxPossibleScore: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  durationMs: number;
  isPassed: boolean | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ScoreboardParticipantEntry {
  rank: number | null;
  participantId: string | null;
  fullName: string;
  departmentUnit: string;
  employeeCode: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  correctAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  score: number;
  maxPossibleScore: number;
  isPassed: boolean | null;
  durationMs: number;
  usedAttempts: number;
  attemptsUsed?: number;
  allowedAttempts: number;
  retakeGrantedCount: number;
  officialAttemptId: string | null;
  officialAttemptNumber: number | null;
  officialAttempt?: {
    totalScore: number;
    correctAnswers: number;
    totalQuestions: number;
    accuracyPercent: number;
    evaluationTierLabel?: string;
    isPassed: boolean | null;
  } | null;
  finishedAt: string | null;
  attemptHistory: ParticipantAttemptHistoryItem[];
}

export interface GameScoreboardSummary {
  gameId: string;
  gameTitle: string;
  sessionMode: SessionMode;
  officialAttemptPolicy: OfficialAttemptPolicy;
  passThresholdPercent: number;
  answersPublished: boolean;
  totalParticipants?: number;
  passedCount?: number;
  failedCount?: number;
  participants?: ScoreboardParticipantEntry[];
  totals: {
    totalParticipants: number;
    completedCount: number;
    inProgressCount: number;
    pendingCount: number;
    passedCount: number;
    failedCount: number;
  };
  top3: ScoreboardParticipantEntry[];
  entries: ScoreboardParticipantEntry[];
  allEntries: ScoreboardParticipantEntry[];
  totalFiltered: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  departments: string[];
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
