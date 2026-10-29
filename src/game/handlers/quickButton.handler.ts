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

export class QuickButtonHandler implements GameTypeHandler {
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
    if (choices.length < 2 || choices.length > 4) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'QUICK_BUTTON question must have between 2 and 4 choices.',
      };
    }

    const cleanInput = normalizeButtonText(trimmedAnswer);
    const isBinaryTrueFalse = isStrictTrueFalseChoicePair(choices);
    const inputPolarity = isBinaryTrueFalse ? normalizeTrueFalsePolarity(trimmedAnswer) : null;

    const matchedChoice =
      choices.find(c => normalizeButtonText(c) === cleanInput) ||
      (inputPolarity ? choices.find(c => normalizeTrueFalsePolarity(c) === inputPolarity) : undefined);

    if (!matchedChoice) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: `Invalid choice "${trimmedAnswer}". Must select one of the provided button choices.`,
      };
    }

    const cleanCorrect = normalizeButtonText(question.correctAnswer);
    const correctPolarity = isBinaryTrueFalse ? normalizeTrueFalsePolarity(question.correctAnswer) : null;
    const matchedPolarity = isBinaryTrueFalse ? normalizeTrueFalsePolarity(matchedChoice) : null;
    const isCorrect =
      normalizeButtonText(matchedChoice) === cleanCorrect ||
      (correctPolarity !== null && matchedPolarity !== null && correctPolarity === matchedPolarity);

    return {
      isValid: true,
      normalizedAnswer: matchedChoice,
      isCorrect,
    };
  }
}

