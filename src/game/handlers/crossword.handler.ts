import { GameQuestion } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

/**
 * Deterministically normalizes crossword words:
 * Trims, strips Vietnamese diacritics (NFD + combining marks + đ/Đ -> D),
 * uppercases, and removes all whitespace.
 */
export function normalizeCrosswordWord(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, '');
}

export class CrosswordHandler implements GameTypeHandler {
  public validateAnswer(question: GameQuestion, rawAnswer: string): AnswerValidationResult {
    if (typeof rawAnswer !== 'string') {
      return {
        isValid: false,
        normalizedAnswer: '',
        isCorrect: false,
        invalidReason: 'Answer must be a string.',
      };
    }

    const trimmed = rawAnswer.trim();
    const expected = question.crosswordAnswer || question.correctAnswer;
    const normalizedInput = normalizeCrosswordWord(trimmed);
    const normalizedExpected = normalizeCrosswordWord(expected);

    const isCorrect = normalizedInput.length > 0 && normalizedInput === normalizedExpected;

    return {
      isValid: true,
      normalizedAnswer: trimmed,
      isCorrect,
    };
  }
}

