import path from 'node:path';
import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { contentRouter } from './routes/content.routes.js';
import { gameRouter } from './routes/game.routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Serve minimal developer smoke-test interface
  app.use(express.static('public'));

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Content ingestion API (Day 1)
  app.use('/api/content', contentRouter);

  // Game generation API (Day 2)
  app.use('/api/games', gameRouter);

  // Centralized error handling
  app.use(errorHandler);

  return app;
}

export const app = createApp();
