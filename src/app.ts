import path from 'node:path';
import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { contentRouter } from './routes/content.routes.js';
import { gameRouter } from './routes/game.routes.js';
import { roomRouter } from './routes/room.routes.js';

const ALLOWED_ORIGINS = new Set([
  'https://ai-game-tau.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

export function createApp(): express.Application {
  const app = express();

  // CORS middleware (allowlist-based for production & local development)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Serve React frontend application if built
  const frontendDistPath = path.resolve(process.cwd(), 'frontend', 'dist');
  app.use(express.static(frontendDistPath));

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

  // Multiplayer room API (Day 4)
  app.use('/api/rooms', roomRouter);

  // Centralized error handling
  app.use(errorHandler);

  return app;
}

export const app = createApp();
