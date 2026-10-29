import { GameType, QuestionType } from '../../contracts/game.contract.js';
import { AppError } from '../../utils/errors.js';
import { CrosswordHandler } from './crossword.handler.js';
import { FillBlankHandler } from './fillBlank.handler.js';
import { GameTypeHandler } from './handler.interface.js';
import { MultipleChoiceHandler } from './multipleChoice.handler.js';
import { PuzzleHandler } from './puzzle.handler.js';
import { QuickButtonHandler } from './quickButton.handler.js';
import { SliderHandler } from './slider.handler.js';
import { TrueFalseHandler } from './trueFalse.handler.js';

export * from './handler.interface.js';
export * from './multipleChoice.handler.js';
export * from './fillBlank.handler.js';
export * from './quickButton.handler.js';
export * from './trueFalse.handler.js';
export * from './puzzle.handler.js';
export * from './slider.handler.js';
export * from './crossword.handler.js';

const multipleChoiceHandler = new MultipleChoiceHandler();
const fillBlankHandler = new FillBlankHandler();
const quickButtonHandler = new QuickButtonHandler();
const trueFalseHandler = new TrueFalseHandler();
const puzzleHandler = new PuzzleHandler();
const sliderHandler = new SliderHandler();
const crosswordHandler = new CrosswordHandler();

const handlerRegistry: Record<string, GameTypeHandler> = {
  QUIZ: multipleChoiceHandler,
  MULTIPLE_CHOICE: multipleChoiceHandler,
  TRUE_FALSE: trueFalseHandler,
  QUICK_BUTTON: quickButtonHandler,
  TYPE_ANSWER: fillBlankHandler,
  FILL_IN_THE_BLANK: fillBlankHandler,
  PUZZLE: puzzleHandler,
  SLIDER: sliderHandler,
  CROSSWORD: crosswordHandler,
};

/**
 * Returns the appropriate handler for the specified game/question type.
 * Throws UNSUPPORTED_GAME_TYPE if not found.
 */
export function getHandler(gameType: GameType | QuestionType): GameTypeHandler {
  const handler = handlerRegistry[gameType];
  if (!handler) {
    throw new AppError('UNSUPPORTED_GAME_TYPE', `Unsupported game type: ${gameType}`, 400);
  }
  return handler;
}
