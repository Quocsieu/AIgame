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
 *    - Correct: BASE_POINTS (100)
 *
 * 2. SPEED_BONUS:
 *    - Incorrect: 0 points
 *    - Correct: BASE_POINTS + round(MAX_SPEED_BONUS * (remainingTimeMs / timeLimitMs))
 *      Bounded range: [100, 150]
 *
 * 3. STREAK:
 *    - Incorrect: 0 points, streak resets to 0
 *    - Correct: newStreak = currentStreak + 1
 *      streakBonus = min((newStreak - 1) * STREAK_BONUS_PER_STEP, MAX_STREAK_BONUS)
 *      points = BASE_POINTS + streakBonus
 *      Bounded range: [100, 200]
 */
export function calculateScore(input: ScoreCalculationInput): ScoreCalculationResult {
  const { isCorrect, scoringMode, responseTimeMs, timeLimitMs, currentStreak } = input;

  if (!isCorrect) {
    return {
      pointsEarned: 0,
      newStreak: 0,
    };
  }

  const newStreak = currentStreak + 1;
  let pointsEarned = SCORING_CONSTANTS.BASE_POINTS;

  switch (scoringMode) {
    case 'STANDARD':
      pointsEarned = SCORING_CONSTANTS.BASE_POINTS;
      break;

    case 'SPEED_BONUS': {
      const remainingMs = Math.max(0, timeLimitMs - responseTimeMs);
      const ratio = timeLimitMs > 0 ? Math.min(1, Math.max(0, remainingMs / timeLimitMs)) : 0;
      const speedBonus = Math.round(SCORING_CONSTANTS.MAX_SPEED_BONUS * ratio);
      pointsEarned = SCORING_CONSTANTS.BASE_POINTS + speedBonus;
      break;
    }

    case 'STREAK': {
      const streakMultiplier = Math.max(0, newStreak - 1);
      const streakBonus = Math.min(
        streakMultiplier * SCORING_CONSTANTS.STREAK_BONUS_PER_STEP,
        SCORING_CONSTANTS.MAX_STREAK_BONUS
      );
      pointsEarned = SCORING_CONSTANTS.BASE_POINTS + streakBonus;
      break;
    }

    default:
      pointsEarned = SCORING_CONSTANTS.BASE_POINTS;
  }

  return {
    pointsEarned,
    newStreak,
  };
}

/**
 * Calculates the theoretical maximum possible score for a game.
 */
export function calculateMaxPossibleScore(
  questionCount: number,
  scoringMode: ScoringMode
): number {
  if (questionCount <= 0) return 0;

  switch (scoringMode) {
    case 'STANDARD':
      return questionCount * SCORING_CONSTANTS.BASE_POINTS;

    case 'SPEED_BONUS':
      return questionCount * (SCORING_CONSTANTS.BASE_POINTS + SCORING_CONSTANTS.MAX_SPEED_BONUS);

    case 'STREAK': {
      let maxScore = 0;
      for (let i = 1; i <= questionCount; i++) {
        const streakBonus = Math.min(
          (i - 1) * SCORING_CONSTANTS.STREAK_BONUS_PER_STEP,
          SCORING_CONSTANTS.MAX_STREAK_BONUS
        );
        maxScore += SCORING_CONSTANTS.BASE_POINTS + streakBonus;
      }
      return maxScore;
    }

    default:
      return questionCount * SCORING_CONSTANTS.BASE_POINTS;
  }
}

