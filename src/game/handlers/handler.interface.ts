import { GameQuestion } from '../../contracts/game.contract.js';

export interface AnswerValidationResult {
  isValid: boolean;
  normalizedAnswer: string;
  isCorrect: boolean;
  invalidReason?: string;
}

export interface GameTypeHandler {
  validateAnswer(question: GameQuestion, rawAnswer: string): AnswerValidationResult;
}

