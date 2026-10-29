import {
  GameQuestion,
  isStrictTrueFalseChoicePair,
  MAX_ANSWER_LENGTH,
  normalizeTrueFalsePolarity,
} from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

function normalizeButtonText(text: string): string {
  return text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

export class TrueFalseHandler implements GameTypeHandler {
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

    const choices = question.choices && question.choices.length === 2
      ? question.choices
      : ['Đúng', 'Sai'];

    if (!isStrictTrueFalseChoicePair(choices)) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'TRUE_FALSE question must have exactly 2 binary True/False choices.',
      };
    }

    const cleanInput = normalizeButtonText(trimmedAnswer);
    const inputPolarity = normalizeTrueFalsePolarity(trimmedAnswer);

    const matchedChoice =
      choices.find(c => normalizeButtonText(c) === cleanInput) ||
      (inputPolarity ? choices.find(c => normalizeTrueFalsePolarity(c) === inputPolarity) : undefined);

    if (!matchedChoice) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: `Invalid True/False answer "${trimmedAnswer}". Must select one of the two binary choices.`,
      };
    }

    const correctPolarity = normalizeTrueFalsePolarity(question.correctAnswer);
    const matchedPolarity = normalizeTrueFalsePolarity(matchedChoice);
    const isCorrect =
      correctPolarity !== null && matchedPolarity !== null
        ? correctPolarity === matchedPolarity
        : normalizeButtonText(matchedChoice) === normalizeButtonText(question.correctAnswer);

    return {
      isValid: true,
      normalizedAnswer: matchedChoice,
      isCorrect,
    };
  }
}

