import { GameQuestion } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

/**
 * Deterministically normalizes free-form text:
 * - trims leading/trailing whitespace
 * - Unicode normalization (NFC)
 * - case-insensitive lowercase
 * - collapses repeated whitespace into a single space
 */
export function normalizeFillBlankText(input: string): string {
  return input
    .trim()
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export class FillBlankHandler implements GameTypeHandler {
  public validateAnswer(question: GameQuestion, rawAnswer: string): AnswerValidationResult {
    if (typeof rawAnswer !== 'string') {
      return {
        isValid: false,
        normalizedAnswer: '',
        isCorrect: false,
        invalidReason: 'Answer must be a string.',
      };
    }

    const normalizedInput = normalizeFillBlankText(rawAnswer);
    const normalizedCorrect = normalizeFillBlankText(question.correctAnswer);

    // Check match against primary correct answer
    if (normalizedInput === normalizedCorrect && normalizedInput.length > 0) {
      return {
        isValid: true,
        normalizedAnswer: rawAnswer.trim(),
        isCorrect: true,
      };
    }

    // Check match against accepted alternatives if present
    if (question.acceptedAlternatives && Array.isArray(question.acceptedAlternatives)) {
      const matchesAlternative = question.acceptedAlternatives.some(
        alt => normalizeFillBlankText(alt) === normalizedInput && normalizedInput.length > 0
      );

      if (matchesAlternative) {
        return {
          isValid: true,
          normalizedAnswer: rawAnswer.trim(),
          isCorrect: true,
        };
      }
    }

    return {
      isValid: true,
      normalizedAnswer: rawAnswer.trim(),
      isCorrect: false,
    };
  }
}

