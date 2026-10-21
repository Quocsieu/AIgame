import { GameQuestion, MAX_ANSWER_LENGTH } from '../../contracts/game.contract.js';
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

function collectValidCrosswordAnswers(question: GameQuestion): Set<string> {
  const candidates = new Set<string>();
  const addFromRaw = (raw: string) => {
    const full = normalizeCrosswordWord(raw);
    if (full.length > 0) {
      candidates.add(full);
    }
    if (raw.includes('|') || raw.includes(';')) {
      for (const part of raw.split(/[|;]/)) {
        const normPart = normalizeCrosswordWord(part);
        if (normPart.length > 0) {
          candidates.add(normPart);
        }
      }
    }
  };

  if (question.crosswordAnswer) {
    addFromRaw(question.crosswordAnswer);
  }
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

    const normalizedInput = normalizeCrosswordWord(trimmed);
    const validCandidates = collectValidCrosswordAnswers(question);
    const isCorrect = normalizedInput.length > 0 && validCandidates.has(normalizedInput);

    return {
      isValid: true,
      normalizedAnswer: trimmed,
      isCorrect,
    };
  }
}

