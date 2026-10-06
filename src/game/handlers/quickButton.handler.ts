import { GameQuestion } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

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

    const choices = question.choices || [];
    if (choices.length < 2 || choices.length > 4) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'QUICK_BUTTON question must have between 2 and 4 choices.',
      };
    }

    const cleanInput = trimmedAnswer.toLowerCase();
    const matchedChoice = choices.find(c => c.trim().toLowerCase() === cleanInput);

    if (!matchedChoice) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: `Invalid choice "${trimmedAnswer}". Must select one of the provided button choices.`,
      };
    }

    const cleanCorrect = question.correctAnswer.trim().toLowerCase();
    const isCorrect = matchedChoice.trim().toLowerCase() === cleanCorrect;

    return {
      isValid: true,
      normalizedAnswer: matchedChoice,
      isCorrect,
    };
  }
}

