import { GameQuestion, MAX_ANSWER_LENGTH } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

function normalizeChoiceText(text: string): string {
  return text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

function stripOptionPrefix(text: string): string {
  return normalizeChoiceText(text.replace(/^[A-Da-d][\.\)]\s*/, ''));
}

export class MultipleChoiceHandler implements GameTypeHandler {
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
    if (choices.length !== 4) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: 'MULTIPLE_CHOICE question must have exactly 4 choices.',
      };
    }

    // Try matching answer to one of the 4 choices:
    // 1. By single option letter (A, B, C, D or A., B), etc.)
    const upperAnswer = trimmedAnswer.toUpperCase().replace(/^([A-D])[\.\)]$/, '$1');
    const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

    let selectedChoiceIndex = -1;

    if (upperAnswer in letterMap) {
      selectedChoiceIndex = letterMap[upperAnswer];
    } else {
      // 2. By exact full choice match first, then exact stripped option text match (no startsWith)
      const normAnswer = normalizeChoiceText(trimmedAnswer);
      selectedChoiceIndex = choices.findIndex(c => normalizeChoiceText(c) === normAnswer);

      if (selectedChoiceIndex === -1) {
        const strippedAnswer = stripOptionPrefix(trimmedAnswer);
        if (strippedAnswer.length > 0) {
          selectedChoiceIndex = choices.findIndex(c => stripOptionPrefix(c) === strippedAnswer);
        }
      }
    }

    if (selectedChoiceIndex < 0 || selectedChoiceIndex >= choices.length) {
      return {
        isValid: false,
        normalizedAnswer: trimmedAnswer,
        isCorrect: false,
        invalidReason: `Invalid choice "${trimmedAnswer}". Answer must match one of the 4 options: A, B, C, or D.`,
      };
    }

    const matchedChoice = choices[selectedChoiceIndex];

    // Determine correctness server-side against question.correctAnswer without prefix startsWith bugs
    const trimmedCorrect = question.correctAnswer.trim();
    const upperCorrect = trimmedCorrect.toUpperCase().replace(/^([A-D])[\.\)]$/, '$1');
    let correctChoiceIndex = -1;

    if (upperCorrect in letterMap) {
      correctChoiceIndex = letterMap[upperCorrect];
    } else {
      const normCorrect = normalizeChoiceText(trimmedCorrect);
      correctChoiceIndex = choices.findIndex(c => normalizeChoiceText(c) === normCorrect);

      if (correctChoiceIndex === -1) {
        const strippedCorrect = stripOptionPrefix(trimmedCorrect);
        if (strippedCorrect.length > 0) {
          correctChoiceIndex = choices.findIndex(c => stripOptionPrefix(c) === strippedCorrect);
        }
      }
    }

    const isCorrect =
      correctChoiceIndex !== -1
        ? selectedChoiceIndex === correctChoiceIndex
        : normalizeChoiceText(matchedChoice) === normalizeChoiceText(trimmedCorrect) ||
          (stripOptionPrefix(matchedChoice).length > 0 &&
            stripOptionPrefix(matchedChoice) === stripOptionPrefix(trimmedCorrect));

    return {
      isValid: true,
      normalizedAnswer: matchedChoice,
      isCorrect,
    };
  }
}

