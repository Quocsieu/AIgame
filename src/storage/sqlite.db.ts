import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LIMITS } from '../config/limits.js';
import { AppError } from '../utils/errors.js';

export interface MigrationDefinition {
  version: number;
  name: string;
  upSql: string;
}

export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    name: '001_phase3_phase4_initial_schema',
    upSql: `
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'USER',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at);

      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_location TEXT NOT NULL,
        title TEXT NOT NULL,
        original_size INTEGER NOT NULL DEFAULT 0,
        character_count INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER,
        sections_meta_json TEXT NOT NULL DEFAULT '[]',
        text_excerpt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sources_owner ON sources(owner_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        is_public INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        game_type TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        source_summary_json TEXT NOT NULL,
        diagnostics_json TEXT,
        generated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_games_owner_created ON games(owner_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_games_type ON games(game_type);

      CREATE TABLE IF NOT EXISTS game_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        question_type TEXT NOT NULL,
        question_text TEXT NOT NULL,
        choices_json TEXT,
        correct_answer TEXT NOT NULL,
        accepted_alternatives_json TEXT,
        explanation TEXT,
        difficulty TEXT,
        source_reference_json TEXT NOT NULL,
        crossword_clue TEXT,
        crossword_answer TEXT,
        UNIQUE(game_id, question_id),
        FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_game_questions_game ON game_questions(game_id, position ASC);

      CREATE TABLE IF NOT EXISTS practice_sessions (
        session_id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        owner_user_id TEXT,
        game_title TEXT NOT NULL,
        game_type TEXT NOT NULL,
        scoring_mode TEXT NOT NULL,
        state TEXT NOT NULL,
        total_questions INTEGER NOT NULL,
        answered_questions INTEGER NOT NULL,
        correct_answers INTEGER NOT NULL,
        wrong_answers INTEGER NOT NULL,
        total_score INTEGER NOT NULL,
        max_possible_score INTEGER NOT NULL,
        max_streak INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        results_json TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_practice_sessions_owner ON practice_sessions(owner_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_practice_sessions_game ON practice_sessions(game_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS room_history (
        room_id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        game_id TEXT NOT NULL,
        owner_user_id TEXT,
        game_title TEXT NOT NULL,
        game_type TEXT NOT NULL,
        scoring_mode TEXT NOT NULL,
        state TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        leaderboard_json TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_room_history_owner ON room_history(owner_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_room_history_game ON room_history(game_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        log_id TEXT PRIMARY KEY,
        user_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        usage_is_estimated INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        requested_questions INTEGER NOT NULL DEFAULT 0,
        generated_questions INTEGER NOT NULL DEFAULT 0,
        valid_questions INTEGER NOT NULL DEFAULT 0,
        rejected_questions INTEGER NOT NULL DEFAULT 0,
        duplicate_questions INTEGER NOT NULL DEFAULT 0,
        diagnostics_count INTEGER NOT NULL DEFAULT 0,
        game_type TEXT,
        difficulty TEXT,
        source_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON ai_usage_logs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_quota_windows (
        user_id TEXT NOT NULL,
        quota_key TEXT NOT NULL,
        window_key TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, quota_key, window_key)
      );
    `,
  },
  {
    version: 2,
    name: '002_game_password_protection',
    upSql: `
      ALTER TABLE games ADD COLUMN is_password_protected INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE games ADD COLUMN password_hash TEXT;
    `,
  },
  {
    version: 3,
    name: '003_game_cover_images',
    upSql: `
      ALTER TABLE games ADD COLUMN cover_image_url TEXT;
      ALTER TABLE games ADD COLUMN cover_image_prompt_hash TEXT;
      ALTER TABLE games ADD COLUMN cover_image_updated_at TEXT;
      ALTER TABLE game_questions ADD COLUMN slider_config_json TEXT;
    `,
  },
];

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string = '';

export function resolveDefaultDatabasePath(): string {
  const configured = (process.env.DATABASE_PATH || LIMITS.DATABASE_PATH || '').trim();
  if (configured) {
    return configured;
  }
  return path.resolve(process.cwd(), 'data', 'platform.sqlite');
}

export function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const checkStmt = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const insertStmt = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    const existing = checkStmt.get(migration.version) as { version: number } | undefined;
    if (existing) {
      continue;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.upSql);
      insertStmt.run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new AppError(
        'DATABASE_MIGRATION_FAILED',
        `Failed to apply migration ${migration.name}: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }
  }
}

export function getDatabase(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const targetPath = resolveDefaultDatabasePath();
  return initDatabase(targetPath);
}

export function initDatabase(dbPath?: string): DatabaseSync {
  const resolvedPath = dbPath ? dbPath.trim() : resolveDefaultDatabasePath();

  if (dbInstance && currentDbPath === resolvedPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors on old instance
    }
    dbInstance = null;
  }

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  try {
    const db = new DatabaseSync(resolvedPath);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
    if (resolvedPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
    }
    db.exec('PRAGMA synchronous = NORMAL;');

    applyMigrations(db);

    dbInstance = db;
    currentDbPath = resolvedPath;
    return db;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'DATABASE_ERROR',
      `Failed to initialize SQLite database at "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
      500
    );
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } finally {
      dbInstance = null;
      currentDbPath = '';
    }
  }
}

export function getCurrentDatabasePath(): string {
  return currentDbPath || resolveDefaultDatabasePath();
}

export function runInTransaction<T>(fn: (db: DatabaseSync) => T, immediate: boolean = true): T {
  const db = getDatabase();
  db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    if (err instanceof AppError) throw err;
    throw new AppError(
      'DATABASE_ERROR',
      `Database transaction failed: ${err instanceof Error ? err.message : String(err)}`,
      500
    );
  }
}
