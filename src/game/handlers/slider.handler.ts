import { GameQuestion, MAX_ANSWER_LENGTH } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

export class SliderHandler implements GameTypeHandler {
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

    const config = question.sliderConfig;
    if (!config) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'SLIDER question is missing sliderConfig.',
      };
    }

    const value = Number(trimmedAnswer);
    if (!Number.isFinite(value)) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'SLIDER answer must be a finite numeric value.',
      };
    }

    if (value < config.min || value > config.max) {
      return {
        isValid: false,
        normalizedAnswer: String(value),
        isCorrect: false,
        invalidReason: `SLIDER value ${value} is outside allowed range [${config.min}, ${config.max}].`,
      };
    }

    const diff = Math.abs(value - config.correctValue);
    const isCorrect = diff <= (config.tolerance ?? 0) + 1e-9;

    return {
      isValid: true,
      normalizedAnswer: String(value),
      isCorrect,
    };
  }
}

