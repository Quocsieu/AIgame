import {
  formatCanonicalPuzzleAnswer,
  GameQuestion,
  MAX_ANSWER_LENGTH,
  parsePuzzleSequence,
} from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

function normalizePuzzleItem(text: string): string {
  return text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

export class PuzzleHandler implements GameTypeHandler {
  public validateAnswer(question: GameQuestion, rawAnswer: string): AnswerValidationResult {
    if (typeof rawAnswer !== 'string') {
      return {
        isValid: false,
        normalizedAnswer: '',
        isCorrect: false,
        invalidReason: 'Answer must be a string.',
      };
    }

    const trimmedAnswer = rawAnswer.trim();
    if (!trimmedAnswer) {
      return {
        isValid: false,
        normalizedAnswer: '',
        isCorrect: false,
        invalidReason: 'Answer cannot be empty.',
      };
    }

    if (trimmedAnswer.length > MAX_ANSWER_LENGTH) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer.slice(0, MAX_ANSWER_LENGTH),
        isCorrect: false,
        invalidReason: `Answer exceeds maximum length of ${MAX_ANSWER_LENGTH} characters.`,
      };
    }

    const choices = question.choices || [];
    if (choices.length < 3 || choices.length > 6) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'PUZZLE question must have between 3 and 6 items in choices.',
      };
    }

    const submittedSequence = parsePuzzleSequence(trimmedAnswer);
    if (submittedSequence.length !== choices.length) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: `PUZZLE answer must include all ${choices.length} items in order (received ${submittedSequence.length}).`,
      };
    }

    const choiceByNorm = new Map<string, string>();
    for (const item of choices) {
      choiceByNorm.set(normalizePuzzleItem(item), item);
    }

    const normalizedSubmittedSet = new Set<string>();
    const canonicalSubmittedItems: string[] = [];

    for (const submittedItem of submittedSequence) {
      const norm = normalizePuzzleItem(submittedItem);
      const matchedOriginal = choiceByNorm.get(norm);
      if (!matchedOriginal) {
        return {
          isValid: false,
          normalizedAnswer: trimmedAnswer,
          isCorrect: false,
          invalidReason: `PUZZLE answer contains invalid item "${submittedItem}" not in question items.`,
        };
      }
      if (normalizedSubmittedSet.has(norm)) {
        return {
          isValid: false,
          normalizedAnswer: trimmedAnswer,
          isCorrect: false,
          invalidReason: `PUZZLE answer contains duplicate item "${submittedItem}".`,
        };
      }
      normalizedSubmittedSet.add(norm);
      canonicalSubmittedItems.push(matchedOriginal);
    }

    const canonicalExpected = parsePuzzleSequence(question.correctAnswer);
    if (canonicalExpected.length !== choices.length) {
      return {
        isValid: false,
        normalizedAnswer: formatCanonicalPuzzleAnswer(canonicalSubmittedItems),
        isCorrect: false,
        invalidReason: 'PUZZLE question has malformed canonical correctAnswer.',
      };
    }

    const isCorrect = canonicalSubmittedItems.every(
      (item, index) => normalizePuzzleItem(item) === normalizePuzzleItem(canonicalExpected[index])
    );

    return {
      isValid: true,
      normalizedAnswer: formatCanonicalPuzzleAnswer(canonicalSubmittedItems),
      isCorrect,
    };
  }
}

