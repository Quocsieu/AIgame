import { GameQuestion } from '../../contracts/game.contract.js';
import { AnswerValidationResult, GameTypeHandler } from './handler.interface.js';

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
    // 1. By index letter (A, B, C, D)
    const upperAnswer = trimmedAnswer.toUpperCase().replace(/[\.\)]$/, '').trim();
    const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

    let selectedChoiceIndex = -1;

    if (upperAnswer in letterMap) {
      selectedChoiceIndex = letterMap[upperAnswer];
    } else {
      // 2. By matching choice text directly
      const cleanAnswer = trimmedAnswer.toLowerCase();
      const stripPrefix = (text: string) =>
        text.replace(/^[A-Da-d0-9][\.\)]\s*/, '').trim().toLowerCase();

      selectedChoiceIndex = choices.findIndex(c => {
        const cLower = c.trim().toLowerCase();
        const cStripped = stripPrefix(c);
        const aStripped = stripPrefix(trimmedAnswer);

        return (
          cLower === cleanAnswer ||
          cStripped === aStripped ||
          cLower.startsWith(`${cleanAnswer}.`) ||
          cLower.startsWith(`${cleanAnswer})`) ||
          cleanAnswer.startsWith(cLower)
        );
      });
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

    // Determine correctness server-side against question.correctAnswer
    const stripPrefix = (text: string) =>
      text.replace(/^[A-Da-d0-9][\.\)]\s*/, '').trim().toLowerCase();

    const cleanCorrect = question.correctAnswer.trim().toLowerCase();
    const cleanMatched = matchedChoice.trim().toLowerCase();

    // Check letter match if correctAnswer is "A" / "B" etc.
    const correctLetter = upperAnswer in letterMap && cleanCorrect.length === 1 && cleanCorrect.toUpperCase() in letterMap;
    const isLetterCorrect = correctLetter && letterMap[cleanCorrect.toUpperCase()] === selectedChoiceIndex;

    const isCorrect =
      isLetterCorrect ||
      cleanMatched === cleanCorrect ||
      stripPrefix(matchedChoice) === stripPrefix(question.correctAnswer) ||
      cleanMatched.startsWith(`${cleanCorrect}.`) ||
      cleanMatched.startsWith(`${cleanCorrect})`) ||
      cleanCorrect.startsWith(cleanMatched);

    return {
      isValid: true,
      normalizedAnswer: matchedChoice,
      isCorrect,
    };
  }
}

