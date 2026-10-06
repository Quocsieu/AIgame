import { Router, Request, Response, NextFunction } from 'express';
import { GenerateGameRequestSchema } from '../contracts/game.contract.js';
import { aiQuestionService } from '../services/ai.question.service.js';
import { sourceStore } from '../storage/source.store.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

export const gameRouter = Router();

gameRouter.post(
  '/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Validate request body against Zod schema
      const parseResult = GenerateGameRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new AppError('INVALID_REQUEST', `Request validation failed: ${issues}`, 400);
      }

      const requestData = parseResult.data;

      // 2. Retrieve normalized source content from store
      const sourceIds: string[] = requestData.sourceIds || (requestData.sourceId ? [requestData.sourceId] : []);
      const documents = sourceStore.getMany(sourceIds);

      if (documents.length === 0) {
        throw new AppError(
          'SOURCE_NOT_FOUND',
          `None of the requested source IDs (${sourceIds.join(', ')}) were found in the system. Please ingest source content first.`,
          404
        );
      }

      // 3 & 4 & 5. Build bounded AI input, generate, validate structured output
      const gameSpecification = await aiQuestionService.generateGame(documents, requestData);

      // 6. Return validated GameSpecification
      res.status(200).json(createSuccessResponse(gameSpecification));
    } catch (err) {
      next(err);
    }
  }
);
