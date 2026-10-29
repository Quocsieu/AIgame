import { GameQuestion, MAX_ANSWER_LENGTH } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

function parseCoordinates(raw: string): { x: number; y: number } | null {
  try {
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // Fall back to "x,y"
  }

  const parts = raw.split(',').map(p => Number(p.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return { x: parts[0], y: parts[1] };
  }
  return null;
}

export class PinAnswerHandler implements GameTypeHandler {
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

    const config = question.pinConfig;
    if (!config) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'PIN_ANSWER question is missing pinConfig.',
      };
    }

    const coords = parseCoordinates(trimmedAnswer);
    if (!coords) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'PIN_ANSWER must provide valid coordinates as "x,y" or {"x":number,"y":number}.',
      };
    }

    if (coords.x < 0 || coords.x > 100 || coords.y < 0 || coords.y > 100) {
      return {
        isValid: false,
        normalizedAnswer: `${coords.x},${coords.y}`,
        isCorrect: false,
        invalidReason: 'PIN_ANSWER coordinates must be within normalized bounds [0, 100].',
      };
    }

    const distance = Math.hypot(coords.x - config.targetX, coords.y - config.targetY);
    const isCorrect = distance <= config.radius + 1e-9;

    return {
      isValid: true,
      normalizedAnswer: `${coords.x},${coords.y}`,
      isCorrect,
    };
  }
}

