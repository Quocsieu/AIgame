import dotenv from 'dotenv';
dotenv.config();

export const LIMITS = {
  MAX_URLS_PER_REQUEST: parseInt(process.env.MAX_URLS_PER_REQUEST || '5', 10),
  MAX_WEBSITE_RESPONSE_BYTES: parseInt(process.env.MAX_WEBSITE_RESPONSE_BYTES || '2097152', 10), // 2 MB
  MAX_FILE_BYTES: parseInt(process.env.MAX_FILE_BYTES || '10485760', 10), // 10 MB
  MAX_EXTRACTED_TEXT_LENGTH: parseInt(process.env.MAX_EXTRACTED_TEXT_LENGTH || '100000', 10), // 100,000 characters
  HTTP_REQUEST_TIMEOUT_MS: parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '10000', 10), // 10 seconds
  AI_GENERATION_TIMEOUT_MS: parseInt(process.env.AI_GENERATION_TIMEOUT_MS || '60000', 10),
  MAX_FILES_PER_REQUEST: 5,

  // Store Lifecycle & Capacity Limits
  STORE_TTL_MS: parseInt(process.env.STORE_TTL_MS || String(2 * 60 * 60 * 1000), 10), // 2 hours
  STORE_CLEANUP_INTERVAL_MS: parseInt(process.env.STORE_CLEANUP_INTERVAL_MS || String(5 * 60 * 1000), 10), // 5 minutes
  MAX_STORED_SOURCES: parseInt(process.env.MAX_STORED_SOURCES || '500', 10),
  MAX_STORED_GAMES: parseInt(process.env.MAX_STORED_GAMES || '500', 10),
  MAX_STORED_SESSIONS: parseInt(process.env.MAX_STORED_SESSIONS || '1000', 10),
  MAX_ACTIVE_ROOMS: parseInt(process.env.MAX_ACTIVE_ROOMS || '200', 10),

  // Rate Limiting (In-memory per single instance)
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  RATE_LIMIT_INGEST_MAX: parseInt(process.env.RATE_LIMIT_INGEST_MAX || '30', 10),
  RATE_LIMIT_GENERATE_MAX: parseInt(process.env.RATE_LIMIT_GENERATE_MAX || '40', 10),
  RATE_LIMIT_ROOM_CREATE_MAX: parseInt(process.env.RATE_LIMIT_ROOM_CREATE_MAX || '40', 10),
  RATE_LIMIT_AUTH_MAX: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '20', 10),

  // Phase 3: Persistence & Export
  DATABASE_PATH: process.env.DATABASE_PATH || '',
  SOURCE_EXCERPT_MAX_CHARS: parseInt(process.env.SOURCE_EXCERPT_MAX_CHARS || '2000', 10),
  EXPORT_MAX_ROWS: parseInt(process.env.EXPORT_MAX_ROWS || '500', 10),

  // Phase 3: AI Cost Estimation (optional; only applied when configured & tokens reported)
  GEMINI_INPUT_COST_PER_1M_USD: process.env.GEMINI_INPUT_COST_PER_1M_USD
    ? parseFloat(process.env.GEMINI_INPUT_COST_PER_1M_USD)
    : null,
  GEMINI_OUTPUT_COST_PER_1M_USD: process.env.GEMINI_OUTPUT_COST_PER_1M_USD
    ? parseFloat(process.env.GEMINI_OUTPUT_COST_PER_1M_USD)
    : null,

  // Phase 4: Authentication & User Quotas
  AUTH_TOKEN_TTL_MS: parseInt(process.env.AUTH_TOKEN_TTL_MS || String(24 * 60 * 60 * 1000), 10), // 24 hours
  QUOTA_DAILY_INGESTIONS: parseInt(process.env.QUOTA_DAILY_INGESTIONS || '40', 10),
  QUOTA_DAILY_GAME_GENERATIONS: parseInt(process.env.QUOTA_DAILY_GAME_GENERATIONS || '25', 10),
  QUOTA_DAILY_AI_CALLS: parseInt(process.env.QUOTA_DAILY_AI_CALLS || '30', 10),
  QUOTA_MAX_ACTIVE_SESSIONS_PER_USER: parseInt(process.env.QUOTA_MAX_ACTIVE_SESSIONS_PER_USER || '5', 10),
  QUOTA_MAX_ACTIVE_ROOMS_PER_USER: parseInt(process.env.QUOTA_MAX_ACTIVE_ROOMS_PER_USER || '3', 10),
};



