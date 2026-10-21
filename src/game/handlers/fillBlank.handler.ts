import { GameQuestion, MAX_ANSWER_LENGTH } from '../../contracts/game.contract.js';
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

function collectValidFillBlankAnswers(question: GameQuestion): Set<string> {
  const candidates = new Set<string>();
  const addFromRaw = (raw: string) => {
    const full = normalizeFillBlankText(raw);
    if (full.length > 0) {
      candidates.add(full);
    }
    if (raw.includes('|') || raw.includes(';')) {
      for (const part of raw.split(/[|;]/)) {
        const normPart = normalizeFillBlankText(part);
        if (normPart.length > 0) {
          candidates.add(normPart);
        }
      }
    }
  };

  addFromRaw(question.correctAnswer);
  if (question.acceptedAlternatives && Array.isArray(question.acceptedAlternatives)) {
    for (const alt of question.acceptedAlternatives) {
      if (typeof alt === 'string') {
        addFromRaw(alt);
      }
    }
  }
  return candidates;
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

    const trimmed = rawAnswer.trim();
    if (!trimmed) {
      return {
        isValid: false,
        normalizedAnswer: '',
        isCorrect: false,
        invalidReason: 'Answer cannot be empty.',
      };
    }

    if (trimmed.length > MAX_ANSWER_LENGTH) {
      return {
        isValid: false,
        normalizedAnswer: trimmed.slice(0, MAX_ANSWER_LENGTH),
        isCorrect: false,
        invalidReason: `Answer exceeds maximum length of ${MAX_ANSWER_LENGTH} characters.`,
      };
    }

    const normalizedInput = normalizeFillBlankText(trimmed);
    const validCandidates = collectValidFillBlankAnswers(question);
    const isCorrect = normalizedInput.length > 0 && validCandidates.has(normalizedInput);

    return {
      isValid: true,
      normalizedAnswer: trimmed,
      isCorrect,
    };
  }
}

