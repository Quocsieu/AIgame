import { GameType } from '../../contracts/game.contract.js';
import { AppError } from '../../utils/errors.js';
import { CrosswordHandler } from './crossword.handler.js';
import { FillBlankHandler } from './fillBlank.handler.js';
import { GameTypeHandler } from './handler.interface.js';
import { MultipleChoiceHandler } from './multipleChoice.handler.js';
import { QuickButtonHandler } from './quickButton.handler.js';

export * from './handler.interface.js';
export * from './multipleChoice.handler.js';
export * from './fillBlank.handler.js';
export * from './quickButton.handler.js';
export * from './crossword.handler.js';

const handlerRegistry: Record<string, GameTypeHandler> = {
  MULTIPLE_CHOICE: new MultipleChoiceHandler(),
  FILL_IN_THE_BLANK: new FillBlankHandler(),
  QUICK_BUTTON: new QuickButtonHandler(),
  CROSSWORD: new CrosswordHandler(),
};

/**
 * Returns the appropriate handler for the specified game type.
 * Throws UNSUPPORTED_GAME_TYPE if not found.
 */
export function getHandler(gameType: GameType): GameTypeHandler {
  const handler = handlerRegistry[gameType];
  if (!handler) {
    throw new AppError('UNSUPPORTED_GAME_TYPE', `Unsupported game type: ${gameType}`, 400);
  }
  return handler;
}

