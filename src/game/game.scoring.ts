import { ScoringMode } from '../contracts/game.contract.js';

/**
 * Configurable scoring constants.
 * Small bounded integers preventing inflated score values.
 */
export const SCORING_CONSTANTS = {
  /** Base score awarded for any correct answer */
  BASE_POINTS: 100,
  /** Maximum speed bonus awarded for instantaneous correct answer */
  MAX_SPEED_BONUS: 50,
  /** Bonus points added per consecutive correct answer */
  STREAK_BONUS_PER_STEP: 20,
  /** Maximum streak bonus cap */
  MAX_STREAK_BONUS: 100,
} as const;

export interface ScoreCalculationInput {
  isCorrect: boolean;
  scoringMode: ScoringMode;
  responseTimeMs: number;
  timeLimitMs: number;
  currentStreak: number;
  basePoints?: number;
}

export interface ScoreCalculationResult {
  pointsEarned: number;
  newStreak: number;
}

/**
 * Deterministic scoring engine.
 *
 * Scoring Formulas:
 *
 * 1. STANDARD:
 *    - Incorrect: 0 points
 *    - Correct: basePoints (default 100)
 *
 * 2. SPEED_BONUS:
 *    - Incorrect: 0 points
 *    - Correct: basePoints + round(MAX_SPEED_BONUS * (remainingTimeMs / timeLimitMs))
 *
 * 3. STREAK:
 *    - Incorrect: 0 points, streak resets to 0
 *    - Correct: newStreak = currentStreak + 1
 *      streakBonus = min((newStreak - 1) * STREAK_BONUS_PER_STEP, MAX_STREAK_BONUS)
 *      points = basePoints + streakBonus
 */
export function calculateScore(input: ScoreCalculationInput): ScoreCalculationResult {
  const { isCorrect, scoringMode, responseTimeMs, timeLimitMs, currentStreak } = input;
  const effectiveBasePoints =
    typeof input.basePoints === 'number' &&
    Number.isFinite(input.basePoints) &&
    input.basePoints >= 10
      ? Math.round(input.basePoints)
      : SCORING_CONSTANTS.BASE_POINTS;

  if (!isCorrect) {
    return {
      pointsEarned: 0,
      newStreak: 0,
    };
  }

  const newStreak = currentStreak + 1;
  let pointsEarned = effectiveBasePoints;

  switch (scoringMode) {
    case 'STANDARD':
      pointsEarned = effectiveBasePoints;
      break;

    case 'SPEED_BONUS': {
      const remainingMs = Math.max(0, timeLimitMs - responseTimeMs);
      const ratio = timeLimitMs > 0 ? Math.min(1, Math.max(0, remainingMs / timeLimitMs)) : 0;
      const speedBonus = Math.round(SCORING_CONSTANTS.MAX_SPEED_BONUS * ratio);
      pointsEarned = effectiveBasePoints + speedBonus;
      break;
    }

    case 'STREAK': {
      const streakMultiplier = Math.max(0, newStreak - 1);
      const streakBonus = Math.min(
        streakMultiplier * SCORING_CONSTANTS.STREAK_BONUS_PER_STEP,
        SCORING_CONSTANTS.MAX_STREAK_BONUS
      );
      pointsEarned = effectiveBasePoints + streakBonus;
      break;
    }

    default:
      pointsEarned = effectiveBasePoints;
  }

  return {
    pointsEarned,
    newStreak,
  };
}

/**
 * Calculates the theoretical maximum possible score for a game.
 * Supports either a question count or an array of questions with optional per-question `points`.
 */
export function calculateMaxPossibleScore(
  questionsOrCount: number | ReadonlyArray<{ points?: number | null }>,
  scoringMode: ScoringMode
): number {
  const basePointsList: number[] = Array.isArray(questionsOrCount)
    ? questionsOrCount.map((q) =>
        typeof q?.points === 'number' && Number.isFinite(q.points) && q.points >= 10
          ? Math.round(q.points)
          : SCORING_CONSTANTS.BASE_POINTS
      )
    : Array.from({ length: Math.max(0, Math.floor(Number(questionsOrCount) || 0)) }, () =>
        SCORING_CONSTANTS.BASE_POINTS
      );

  if (basePointsList.length === 0) return 0;

  switch (scoringMode) {
    case 'STANDARD':
      return basePointsList.reduce((sum, bp) => sum + bp, 0);

    case 'SPEED_BONUS':
      return basePointsList.reduce(
        (sum, bp) => sum + bp + SCORING_CONSTANTS.MAX_SPEED_BONUS,
        0
      );

    case 'STREAK': {
      let maxScore = 0;
      for (let i = 1; i <= basePointsList.length; i++) {
        const streakBonus = Math.min(
          (i - 1) * SCORING_CONSTANTS.STREAK_BONUS_PER_STEP,
          SCORING_CONSTANTS.MAX_STREAK_BONUS
        );
        maxScore += basePointsList[i - 1] + streakBonus;
      }
      return maxScore;
    }

    default:
      return basePointsList.reduce((sum, bp) => sum + bp, 0);
  }
}

export type PerformanceTier = 'NEEDS_EFFORT' | 'PARTIAL_MASTERY' | 'GOOD_WORK' | 'EXCELLENT';

export interface PerformanceEvaluation {
  correctAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  totalScore: number;
  maxPossibleScore: number;
  tier: PerformanceTier;
  tierLabel: string;
  comment: string;
  isPassed?: boolean;
  passThresholdPercent?: number;
}

export function evaluatePerformanceResult(input: {
  correctAnswers: number;
  totalQuestions: number;
  totalScore: number;
  maxPossibleScore: number;
  sessionMode?: 'PLAY' | 'EXAM';
  passThresholdPercent?: number;
}): PerformanceEvaluation {
  const safeTotalQuestions = Math.max(0, Math.floor(Number(input.totalQuestions) || 0));
  const safeCorrectAnswers = Math.max(
    0,
    Math.min(safeTotalQuestions, Math.floor(Number(input.correctAnswers) || 0))
  );
  const accuracyPercent =
    safeTotalQuestions > 0 ? Math.round((safeCorrectAnswers / safeTotalQuestions) * 100) : 0;

  let tier: PerformanceTier;
  let tierLabel: string;
  let comment: string;

  if (accuracyPercent < 50) {
    tier = 'NEEDS_EFFORT';
    tierLabel = 'Cần cố gắng thêm';
    comment = 'Cần cố gắng thêm. Bạn hãy ôn tập thêm để nắm vững nội dung hơn.';
  } else if (accuracyPercent < 70) {
    tier = 'PARTIAL_MASTERY';
    tierLabel = 'Đã nắm được một phần kiến thức';
    comment =
      'Đã nắm được một phần kiến thức. Kết quả khá, bạn đã nắm được phần cơ bản nhưng vẫn còn có thể cải thiện.';
  } else if (accuracyPercent < 90) {
    tier = 'GOOD_WORK';
    tierLabel = 'Làm tốt';
    comment = 'Làm tốt! Bạn hiểu nội dung khá chắc chắn.';
  } else {
    tier = 'EXCELLENT';
    tierLabel = 'Xuất sắc';
    comment = 'Xuất sắc! Bạn nắm rất vững kiến thức của chủ đề này.';
  }

  const threshold =
    typeof input.passThresholdPercent === 'number' && Number.isFinite(input.passThresholdPercent)
      ? Math.max(0, Math.min(100, input.passThresholdPercent))
      : 50;

  const isExam = input.sessionMode === 'EXAM';

  return {
    correctAnswers: safeCorrectAnswers,
    totalQuestions: safeTotalQuestions,
    accuracyPercent,
    totalScore: Math.max(0, Math.floor(Number(input.totalScore) || 0)),
    maxPossibleScore: Math.max(0, Math.floor(Number(input.maxPossibleScore) || 0)),
    tier,
    tierLabel,
    comment,
    ...(isExam
      ? {
          isPassed: accuracyPercent >= threshold,
          passThresholdPercent: threshold,
        }
      : {}),
  };
}


