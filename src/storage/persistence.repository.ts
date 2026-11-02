import crypto from 'node:crypto';
import { LIMITS } from '../config/limits.js';
import { AdventureConfig } from '../contracts/adventure.contract.js';
import { CanonicalDocument } from '../contracts/canonical.contract.js';
import {
  GameQuestion,
  GameSpecification,
  GameType,
  ScoringMode,
} from '../contracts/game.contract.js';
import { GameResult } from '../game/game.types.js';
import { LeaderboardEntry } from '../multiplayer/room.types.js';
import { AppError } from '../utils/errors.js';
import { getDatabase, runInTransaction } from './sqlite.db.js';

export interface PersistedSourceMetadata {
  sourceId: string;
  ownerUserId: string | null;
  sourceType: CanonicalDocument['sourceType'];
  sourceName: string;
  sourceLocation: string;
  title: string;
  originalSize: number;
  characterCount: number;
  pageCount?: number;
  sectionTitles: string[];
  textExcerpt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedGameSummary {
  gameId: string;
  ownerUserId: string | null;
  isPublic: boolean;
  coverImageUrl?: string | null;
  title: string;
  description: string;
  gameType: GameType;
  questionCount: number;
  timePerQuestion: number;
  scoringMode: ScoringMode;
  adventureConfig?: AdventureConfig;
  sourceCount: number;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedPracticeSessionRecord {
  sessionId: string;
  gameId: string;
  ownerUserId: string | null;
  gameTitle: string;
  gameType: GameType;
  scoringMode: ScoringMode;
  adventureConfig?: AdventureConfig;
  state: string;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  totalScore: number;
  maxPossibleScore: number;
  maxStreak: number;
  durationMs: number;
  questionResults: GameResult['questionResults'];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isExternalPlayOnOwnedGame?: boolean;
}

export interface PersistedRoomHistoryRecord {
  roomId: string;
  roomCode: string;
  gameId: string;
  ownerUserId: string | null;
  gameTitle: string;
  gameType: GameType;
  scoringMode: ScoringMode;
  adventureConfig?: AdventureConfig;
  state: string;
  playerCount: number;
  totalQuestions: number;
  leaderboard: LeaderboardEntry[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isExternalPlayOnOwnedGame?: boolean;
}

export class PersistenceRepository {
  /**
   * Persists source document metadata and a bounded excerpt without storing full raw document content.
   */
  public saveSourceMetadata(
    doc: CanonicalDocument,
    ownerUserId?: string | null
  ): void {
    const db = getDatabase();
    const nowIso = new Date().toISOString();
    const sectionTitles = (doc.sections || [])
      .map(s => s.title || s.provenance?.section || '')
      .filter(Boolean)
      .slice(0, 50);
    const excerpt = (doc.text || '').slice(0, LIMITS.SOURCE_EXCERPT_MAX_CHARS);

    try {
      const existing = db
        .prepare('SELECT owner_user_id, created_at FROM sources WHERE source_id = ?')
        .get(doc.sourceId) as { owner_user_id: string | null; created_at: string } | undefined;

      const resolvedOwner =
        ownerUserId !== undefined ? ownerUserId : existing ? existing.owner_user_id : null;
      const createdAt = existing ? existing.created_at : doc.metadata?.extractedAt || nowIso;

      db.prepare(
        `INSERT INTO sources (
          source_id, owner_user_id, source_type, source_name, source_location,
          title, original_size, character_count, page_count, sections_meta_json,
          text_excerpt, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          owner_user_id = excluded.owner_user_id,
          source_type = excluded.source_type,
          source_name = excluded.source_name,
          source_location = excluded.source_location,
          title = excluded.title,
          original_size = excluded.original_size,
          character_count = excluded.character_count,
          page_count = excluded.page_count,
          sections_meta_json = excluded.sections_meta_json,
          text_excerpt = excluded.text_excerpt,
          updated_at = excluded.updated_at`
      ).run(
        doc.sourceId,
        resolvedOwner ?? null,
        doc.sourceType,
        doc.sourceName,
        doc.sourceLocation,
        doc.title,
        doc.metadata?.originalSize ?? 0,
        doc.metadata?.characterCount ?? doc.text.length,
        doc.metadata?.pageCount ?? null,
        JSON.stringify(sectionTitles),
        excerpt,
        createdAt,
        nowIso
      );
    } catch (err) {
      throw new AppError(
        'DATABASE_WRITE_FAILED',
        `Failed to persist source metadata for "${doc.sourceId}": ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }
  }

  public getSourceMetadata(sourceId: string): PersistedSourceMetadata | undefined {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM sources WHERE source_id = ?')
      .get(sourceId) as Record<string, any> | undefined;

    if (!row) return undefined;

    let sectionTitles: string[] = [];
    try {
      sectionTitles = JSON.parse(row.sections_meta_json || '[]');
    } catch {
      sectionTitles = [];
    }

    return {
      sourceId: String(row.source_id),
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      sourceType: row.source_type as CanonicalDocument['sourceType'],
      sourceName: String(row.source_name),
      sourceLocation: String(row.source_location),
      title: String(row.title),
      originalSize: Number(row.original_size || 0),
      characterCount: Number(row.character_count || 0),
      pageCount: row.page_count !== null && row.page_count !== undefined ? Number(row.page_count) : undefined,
      sectionTitles,
      textExcerpt: String(row.text_excerpt || ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public listSources(
    ownerUserId?: string | null,
    limit: number = 50
  ): PersistedSourceMetadata[] {
    const db = getDatabase();
    const safeLimit = Math.min(100, Math.max(1, limit));
    const rows = (
      ownerUserId
        ? db
            .prepare('SELECT * FROM sources WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(ownerUserId, safeLimit)
        : db
            .prepare('SELECT * FROM sources WHERE owner_user_id IS NULL ORDER BY created_at DESC LIMIT ?')
            .all(safeLimit)
    ) as Record<string, any>[];

    return rows.map((row) => {
      let sectionTitles: string[] = [];
      try {
        sectionTitles = JSON.parse(row.sections_meta_json || '[]');
      } catch {
        sectionTitles = [];
      }
      return {
        sourceId: String(row.source_id),
        ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
        sourceType: row.source_type as CanonicalDocument['sourceType'],
        sourceName: String(row.source_name),
        sourceLocation: String(row.source_location),
        title: String(row.title),
        originalSize: Number(row.original_size || 0),
        characterCount: Number(row.character_count || 0),
        pageCount:
          row.page_count !== null && row.page_count !== undefined
            ? Number(row.page_count)
            : undefined,
        sectionTitles,
        textExcerpt: String(row.text_excerpt || ''),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }

  /**
   * Persists a GameSpecification and all its questions transactionally.
   */
  public saveGameSpecification(
    spec: GameSpecification,
    ownerUserId?: string | null,
    isPublic?: boolean
  ): void {
    const nowIso = new Date().toISOString();

    runInTransaction((db) => {
      const existing = db
        .prepare('SELECT owner_user_id, is_public, cover_image_url, created_at FROM games WHERE game_id = ?')
        .get(spec.gameId) as
        | { owner_user_id: string | null; is_public: number; cover_image_url: string | null; created_at: string }
        | undefined;

      const resolvedOwner =
        ownerUserId !== undefined
          ? ownerUserId
          : spec.ownerUserId !== undefined
            ? spec.ownerUserId
            : existing
              ? existing.owner_user_id
              : null;

      const resolvedPublic =
        isPublic !== undefined
          ? isPublic
          : spec.isPublic !== undefined
            ? spec.isPublic
            : existing
              ? Boolean(existing.is_public)
              : false;

      const resolvedCoverUrl =
        spec.coverImageUrl !== undefined
          ? spec.coverImageUrl
          : existing?.cover_image_url ?? null;

      const createdAt = existing ? existing.created_at : spec.generatedAt || nowIso;

      db.prepare(
        `INSERT INTO games (
          game_id, owner_user_id, is_public, is_password_protected, password_hash,
          cover_image_url, title, description, game_type,
          settings_json, source_summary_json, diagnostics_json, generated_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
          owner_user_id = excluded.owner_user_id,
          is_public = excluded.is_public,
          is_password_protected = 0,
          password_hash = NULL,
          cover_image_url = excluded.cover_image_url,
          title = excluded.title,
          description = excluded.description,
          game_type = excluded.game_type,
          settings_json = excluded.settings_json,
          source_summary_json = excluded.source_summary_json,
          diagnostics_json = excluded.diagnostics_json,
          generated_at = excluded.generated_at,
          updated_at = excluded.updated_at`
      ).run(
        spec.gameId,
        resolvedOwner ?? null,
        resolvedPublic ? 1 : 0,
        resolvedCoverUrl,
        spec.title,
        spec.description ?? '',
        spec.gameType,
        JSON.stringify(spec.settings ?? { questionCount: 5, timePerQuestion: 20, scoringMode: 'STANDARD' }),
        JSON.stringify(spec.sourceSummary ?? { sourceCount: 0, sources: [] }),
        spec.diagnostics ? JSON.stringify(spec.diagnostics) : null,
        spec.generatedAt ?? nowIso,
        createdAt,
        nowIso
      );

      db.prepare('DELETE FROM game_questions WHERE game_id = ?').run(spec.gameId);

      const insertQ = db.prepare(
        `INSERT INTO game_questions (
          game_id, question_id, position, question_type, question_text,
          choices_json, slider_config_json, correct_answer, accepted_alternatives_json, explanation,
          difficulty, source_reference_json, crossword_clue, crossword_answer, time_limit_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      spec.questions.forEach((q, idx) => {
        insertQ.run(
          spec.gameId,
          q.id,
          idx,
          q.type,
          q.question,
          q.choices ? JSON.stringify(q.choices) : null,
          q.sliderConfig ? JSON.stringify(q.sliderConfig) : null,
          q.correctAnswer,
          q.acceptedAlternatives ? JSON.stringify(q.acceptedAlternatives) : null,
          q.explanation ?? null,
          q.difficulty ?? 'MEDIUM',
          q.sourceReference ? JSON.stringify(q.sourceReference) : '{}',
          q.crosswordClue ?? null,
          q.crosswordAnswer ?? null,
          typeof q.timeLimitSeconds === 'number' && Number.isFinite(q.timeLimitSeconds)
            ? Math.round(q.timeLimitSeconds)
            : null
        );
      });
    });
  }

  public getGameOwnerInfo(gameId: string): { ownerUserId: string | null; isPublic: boolean } | undefined {
    const db = getDatabase();
    const row = db
      .prepare('SELECT owner_user_id, is_public FROM games WHERE game_id = ?')
      .get(gameId) as { owner_user_id: string | null; is_public: number } | undefined;

    if (!row) return undefined;
    return {
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      isPublic: Boolean(row.is_public),
    };
  }

  public getGamePasswordAuthData(_gameId: string): {
    isPasswordProtected: boolean;
    passwordHash: string | null;
  } {
    return {
      isPasswordProtected: false,
      passwordHash: null,
    };
  }

  public getGameCoverMetadata(gameId: string): {
    coverImageUrl: string | null;
    coverImagePromptHash: string | null;
    coverImageUpdatedAt: string | null;
  } | undefined {
    const db = getDatabase();
    const row = db
      .prepare('SELECT cover_image_url, cover_image_prompt_hash, cover_image_updated_at FROM games WHERE game_id = ?')
      .get(gameId) as
      | { cover_image_url: string | null; cover_image_prompt_hash: string | null; cover_image_updated_at: string | null }
      | undefined;

    if (!row) return undefined;
    return {
      coverImageUrl: row.cover_image_url ? String(row.cover_image_url) : null,
      coverImagePromptHash: row.cover_image_prompt_hash ? String(row.cover_image_prompt_hash) : null,
      coverImageUpdatedAt: row.cover_image_updated_at ? String(row.cover_image_updated_at) : null,
    };
  }

  public updateGameCover(
    gameId: string,
    coverImageUrl: string | null,
    promptHash: string | null
  ): boolean {
    const db = getDatabase();
    const nowIso = new Date().toISOString();
    const res = db
      .prepare(
        `UPDATE games
         SET cover_image_url = ?, cover_image_prompt_hash = ?, cover_image_updated_at = ?, updated_at = ?
         WHERE game_id = ?`
      )
      .run(coverImageUrl, promptHash, nowIso, nowIso, gameId);
    return Number(res.changes || 0) > 0;
  }

  public duplicateGame(
    sourceGameId: string,
    newOwnerUserId: string | null,
    customTitle?: string
  ): GameSpecification | undefined {
    const existing = this.getGameSpecificationById(sourceGameId);
    if (!existing) return undefined;

    const nowIso = new Date().toISOString();
    const newGameId = `game_${crypto.randomUUID()}`;
    const baseTitle = customTitle?.trim() || `${existing.title} (Bản sao)`;
    const safeTitle = baseTitle.slice(0, 100);

    const duplicatedSpec: GameSpecification = {
      ...existing,
      gameId: newGameId,
      ownerUserId: newOwnerUserId,
      isPublic: false,
      coverImageUrl: existing.coverImageUrl ?? null,
      title: safeTitle,
      questions: existing.questions.map((q, idx) => ({
        ...q,
        id: `q_${idx + 1}_${crypto.randomUUID().slice(0, 8)}`,
      })),
      generatedAt: nowIso,
    };

    this.saveGameSpecification(duplicatedSpec, newOwnerUserId, false);
    return duplicatedSpec;
  }

  public getGameSpecificationById(gameId: string): GameSpecification | undefined {
    const db = getDatabase();
    const gameRow = db
      .prepare('SELECT * FROM games WHERE game_id = ?')
      .get(gameId) as Record<string, any> | undefined;

    if (!gameRow) return undefined;

    const questionRows = db
      .prepare('SELECT * FROM game_questions WHERE game_id = ? ORDER BY position ASC')
      .all(gameId) as Record<string, any>[];

    if (questionRows.length === 0) return undefined;

    const questions: GameQuestion[] = questionRows.map((row) => {
      const q: GameQuestion = {
        id: String(row.question_id),
        type: row.question_type as GameQuestion['type'],
        question: String(row.question_text),
        correctAnswer: String(row.correct_answer),
        difficulty: (row.difficulty || 'MEDIUM') as GameQuestion['difficulty'],
        sourceReference: JSON.parse(String(row.source_reference_json)),
      };
      if (row.choices_json) {
        q.choices = JSON.parse(String(row.choices_json));
      }
      if (row.slider_config_json) {
        try {
          q.sliderConfig = JSON.parse(String(row.slider_config_json));
        } catch {
          // ignore malformed sliderConfig
        }
      }
      if (row.accepted_alternatives_json) {
        q.acceptedAlternatives = JSON.parse(String(row.accepted_alternatives_json));
      }
      if (row.explanation !== null && row.explanation !== undefined) {
        q.explanation = String(row.explanation);
      }
      if (row.crossword_clue !== null && row.crossword_clue !== undefined) {
        q.crosswordClue = String(row.crossword_clue);
      }
      if (row.crossword_answer !== null && row.crossword_answer !== undefined) {
        q.crosswordAnswer = String(row.crossword_answer);
      }
      if (row.time_limit_seconds !== null && row.time_limit_seconds !== undefined) {
        const parsedLimit = Number(row.time_limit_seconds);
        if (Number.isFinite(parsedLimit) && parsedLimit >= 5) {
          q.timeLimitSeconds = Math.round(parsedLimit);
        }
      }
      return q;
    });

    const spec: GameSpecification = {
      gameId: String(gameRow.game_id),
      title: String(gameRow.title),
      description: String(gameRow.description),
      gameType: gameRow.game_type as GameType,
      questions,
      settings: JSON.parse(String(gameRow.settings_json)),
      sourceSummary: JSON.parse(String(gameRow.source_summary_json)),
      generatedAt: String(gameRow.generated_at),
    };

    if (gameRow.owner_user_id) {
      spec.ownerUserId = String(gameRow.owner_user_id);
    }
    if (gameRow.is_public !== undefined && gameRow.is_public !== null) {
      spec.isPublic = Boolean(gameRow.is_public);
    }
    if (gameRow.cover_image_url) {
      spec.coverImageUrl = String(gameRow.cover_image_url);
    }
    if (gameRow.diagnostics_json) {
      spec.diagnostics = JSON.parse(String(gameRow.diagnostics_json));
    }

    return spec;
  }

  public listGames(options: {
    userId?: string | null;
    isAdmin?: boolean;
    scope?: 'manage' | 'public' | 'mine';
    status?: 'ALL' | 'PUBLISHED' | 'DRAFT';
    gameType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): {
    games: PersistedGameSummary[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    counts: {
      totalAll: number;
      publishedCount: number;
      draftCount: number;
      ownedCount: number;
    };
    scopeGameIds: string[];
  } {
    const db = getDatabase();
    const limit = Math.min(100, Math.max(1, options.limit ?? 25));
    const offset = Math.max(0, options.offset ?? 0);

    const baseScopeConditions: string[] = [];
    const baseScopeParams: any[] = [];

    if (options.scope === 'public') {
      baseScopeConditions.push('is_public = 1');
    } else if (options.scope === 'mine') {
      if (options.userId) {
        baseScopeConditions.push('owner_user_id = ?');
        baseScopeParams.push(options.userId);
      } else {
        baseScopeConditions.push('owner_user_id IS NULL');
      }
    } else {
      if (!options.isAdmin) {
        if (options.userId) {
          baseScopeConditions.push('(owner_user_id = ? OR is_public = 1)');
          baseScopeParams.push(options.userId);
        } else {
          baseScopeConditions.push('(owner_user_id IS NULL OR is_public = 1)');
        }
      }
    }

    const baseScopeWhere =
      baseScopeConditions.length > 0 ? `WHERE ${baseScopeConditions.join(' AND ')}` : '';
    const ownedSqlCondition = options.userId ? 'owner_user_id = ?' : 'owner_user_id IS NULL';
    const ownedParams = options.userId ? [options.userId] : [];

    const aggregateRow = db
      .prepare(
        `SELECT
          COUNT(*) as total_all,
          COALESCE(SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END), 0) as published_count,
          COALESCE(SUM(CASE WHEN is_public = 0 THEN 1 ELSE 0 END), 0) as draft_count,
          COALESCE(SUM(CASE WHEN ${ownedSqlCondition} THEN 1 ELSE 0 END), 0) as owned_count
        FROM games ${baseScopeWhere}`
      )
      .get(...ownedParams, ...baseScopeParams) as {
      total_all: number;
      published_count: number;
      draft_count: number;
      owned_count: number;
    };

    const scopeIdRows = db
      .prepare(`SELECT game_id FROM games ${baseScopeWhere}`)
      .all(...baseScopeParams) as { game_id: string }[];
    const scopeGameIds = scopeIdRows.map((r) => String(r.game_id));

    const conditions: string[] = [...baseScopeConditions];
    const params: any[] = [...baseScopeParams];

    if (options.scope !== 'public') {
      if (options.status === 'PUBLISHED') {
        conditions.push('is_public = 1');
      } else if (options.status === 'DRAFT') {
        conditions.push('is_public = 0');
      }
    }

    if (options.gameType && options.gameType !== 'ALL') {
      conditions.push('game_type = ?');
      params.push(options.gameType);
    }

    if (options.search && options.search.trim().length > 0) {
      const pattern = `%${options.search.trim()}%`;
      conditions.push('(title LIKE ? OR description LIKE ?)');
      params.push(pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM games ${whereClause}`)
      .get(...params) as { cnt: number };

    const rows = db
      .prepare(
        `SELECT * FROM games ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, any>[];

    const games: PersistedGameSummary[] = rows.map((row) => {
      const settings = JSON.parse(String(row.settings_json || '{}'));
      const sourceSummary = JSON.parse(String(row.source_summary_json || '{"sourceCount":0}'));
      return {
        gameId: String(row.game_id),
        ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
        isPublic: Boolean(row.is_public),
        ...(row.cover_image_url ? { coverImageUrl: String(row.cover_image_url) } : {}),
        title: String(row.title),
        description: String(row.description),
        gameType: row.game_type as GameType,
        questionCount: Number(settings.questionCount || 0),
        timePerQuestion: Number(settings.timePerQuestion || 20),
        scoringMode: (settings.scoringMode || 'STANDARD') as ScoringMode,
        ...(settings.adventureConfig ? { adventureConfig: settings.adventureConfig } : {}),
        sourceCount: Number(sourceSummary.sourceCount || 0),
        generatedAt: String(row.generated_at),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });

    const total = Number(countRow?.cnt || 0);
    return {
      games,
      total,
      limit,
      offset,
      hasMore: offset + games.length < total,
      counts: {
        totalAll: Number(aggregateRow?.total_all || 0),
        publishedCount: Number(aggregateRow?.published_count || 0),
        draftCount: Number(aggregateRow?.draft_count || 0),
        ownedCount: Number(aggregateRow?.owned_count || 0),
      },
      scopeGameIds,
    };
  }

  public countGamesByCoverUrl(coverImageUrl: string): number {
    if (!coverImageUrl) return 0;
    const db = getDatabase();
    const row = db
      .prepare('SELECT COUNT(*) as cnt FROM games WHERE cover_image_url = ?')
      .get(coverImageUrl) as { cnt: number } | undefined;
    return Number(row?.cnt || 0);
  }

  public countGamesByAdventureAssetPrefix(urlPrefix: string): number {
    if (!urlPrefix) return 0;
    const db = getDatabase();
    const row = db
      .prepare('SELECT COUNT(*) as cnt FROM games WHERE settings_json LIKE ?')
      .get(`%${urlPrefix}%`) as { cnt: number } | undefined;
    return Number(row?.cnt || 0);
  }

  public deleteGame(gameId: string): boolean {
    return runInTransaction((db) => {
      db.prepare('DELETE FROM game_questions WHERE game_id = ?').run(gameId);
      const res = db.prepare('DELETE FROM games WHERE game_id = ?').run(gameId);
      return Number(res.changes || 0) > 0;
    });
  }

  public getAllGameIds(): string[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT game_id FROM games').all() as { game_id: string }[];
    return rows.map((r) => String(r.game_id));
  }

  public getGameIdsForUser(options: { userId: string | null; isAdmin?: boolean }): string[] {
    const db = getDatabase();
    if (options.isAdmin) {
      const rows = db.prepare('SELECT game_id FROM games').all() as { game_id: string }[];
      return rows.map((r) => String(r.game_id));
    }
    if (!options.userId) {
      // Unauthenticated / guest games where owner_user_id IS NULL or starts with guest_
      const rows = db.prepare('SELECT game_id FROM games WHERE owner_user_id IS NULL OR owner_user_id LIKE ?').all('guest_%') as { game_id: string }[];
      return rows.map((r) => String(r.game_id));
    }
    const rows = db.prepare('SELECT game_id FROM games WHERE owner_user_id = ?').all(options.userId) as { game_id: string }[];
    return rows.map((r) => String(r.game_id));
  }

  /**
   * Persists a practice session state / result.
   */
  public savePracticeSession(record: {
    sessionId: string;
    gameId: string;
    ownerUserId?: string | null;
    gameTitle: string;
    gameType: GameType;
    scoringMode: ScoringMode;
    adventureConfig?: AdventureConfig;
    state: string;
    totalQuestions: number;
    answeredQuestions: number;
    correctAnswers: number;
    wrongAnswers: number;
    totalScore: number;
    maxPossibleScore: number;
    maxStreak: number;
    durationMs: number;
    questionResults: GameResult['questionResults'];
    startedAt: string | null;
    finishedAt: string | null;
  }): void {
    const db = getDatabase();
    const nowIso = new Date().toISOString();

    const existing = db
      .prepare('SELECT owner_user_id, created_at FROM practice_sessions WHERE session_id = ?')
      .get(record.sessionId) as { owner_user_id: string | null; created_at: string } | undefined;

    const resolvedOwner =
      record.ownerUserId !== undefined
        ? record.ownerUserId
        : existing
          ? existing.owner_user_id
          : null;
    const createdAt = existing ? existing.created_at : record.startedAt || nowIso;

    db.prepare(
      `INSERT INTO practice_sessions (
        session_id, game_id, owner_user_id, game_title, game_type, scoring_mode,
        state, total_questions, answered_questions, correct_answers, wrong_answers,
        total_score, max_possible_score, max_streak, duration_ms, results_json,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        state = excluded.state,
        answered_questions = excluded.answered_questions,
        correct_answers = excluded.correct_answers,
        wrong_answers = excluded.wrong_answers,
        total_score = excluded.total_score,
        max_possible_score = excluded.max_possible_score,
        max_streak = excluded.max_streak,
        duration_ms = excluded.duration_ms,
        results_json = excluded.results_json,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        updated_at = excluded.updated_at`
    ).run(
      record.sessionId,
      record.gameId,
      resolvedOwner ?? null,
      record.gameTitle,
      record.gameType,
      record.scoringMode,
      record.state,
      record.totalQuestions,
      record.answeredQuestions,
      record.correctAnswers,
      record.wrongAnswers,
      record.totalScore,
      record.maxPossibleScore,
      record.maxStreak,
      record.durationMs,
      JSON.stringify(record.questionResults),
      record.startedAt,
      record.finishedAt,
      createdAt,
      nowIso
    );
  }

  public getPracticeSessionById(sessionId: string): PersistedPracticeSessionRecord | undefined {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM practice_sessions WHERE session_id = ?')
      .get(sessionId) as Record<string, any> | undefined;

    if (!row) return undefined;
    return this.mapPracticeSessionRow(row);
  }

  public listPracticeSessions(options: {
    userId?: string | null;
    gameId?: string;
    onlyFinished?: boolean;
    includeOwnedGames?: boolean;
    limit?: number;
    offset?: number;
  } = {}): PersistedPracticeSessionRecord[] {
    const db = getDatabase();
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const offset = Math.max(0, options.offset ?? 0);

    const conditions: string[] = [];
    const params: any[] = [];

    if (options.userId !== undefined) {
      if (options.userId === null) {
        conditions.push('owner_user_id IS NULL');
      } else if (options.includeOwnedGames !== false) {
        conditions.push(
          '(owner_user_id = ? OR game_id IN (SELECT game_id FROM games WHERE owner_user_id = ?))'
        );
        params.push(options.userId, options.userId);
      } else {
        conditions.push('owner_user_id = ?');
        params.push(options.userId);
      }
    }

    if (options.gameId) {
      conditions.push('game_id = ?');
      params.push(options.gameId);
    }

    if (options.onlyFinished) {
      conditions.push("state = 'FINISHED'");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT * FROM practice_sessions ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, any>[];

    return rows.map(r => {
      const mapped = this.mapPracticeSessionRow(r);
      if (options.userId && mapped.ownerUserId && mapped.ownerUserId !== options.userId) {
        // Redact foreign player's userId when creator views plays on their owned game
        return {
          ...mapped,
          ownerUserId: null,
          isExternalPlayOnOwnedGame: true,
        };
      }
      if (options.userId && !mapped.ownerUserId) {
        return {
          ...mapped,
          isExternalPlayOnOwnedGame: true,
        };
      }
      return mapped;
    });
  }

  private mapPracticeSessionRow(row: Record<string, any>): PersistedPracticeSessionRecord {
    return {
      sessionId: String(row.session_id),
      gameId: String(row.game_id),
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      gameTitle: String(row.game_title),
      gameType: row.game_type as GameType,
      scoringMode: (row.scoring_mode || 'STANDARD') as ScoringMode,
      state: String(row.state),
      totalQuestions: Number(row.total_questions),
      answeredQuestions: Number(row.answered_questions),
      correctAnswers: Number(row.correct_answers),
      wrongAnswers: Number(row.wrong_answers),
      totalScore: Number(row.total_score),
      maxPossibleScore: Number(row.max_possible_score),
      maxStreak: Number(row.max_streak),
      durationMs: Number(row.duration_ms || 0),
      questionResults: JSON.parse(String(row.results_json || '[]')),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  /**
   * Persists multiplayer room history upon completion without storing raw player answers or tokens.
   */
  public saveRoomHistory(record: {
    roomId: string;
    roomCode: string;
    gameId: string;
    ownerUserId?: string | null;
    gameTitle: string;
    gameType: GameType;
    scoringMode: ScoringMode;
    adventureConfig?: AdventureConfig;
    state: string;
    playerCount: number;
    totalQuestions: number;
    leaderboard: LeaderboardEntry[];
    startedAt: string | null;
    finishedAt: string | null;
  }): void {
    const db = getDatabase();
    const nowIso = new Date().toISOString();

    const existing = db
      .prepare('SELECT owner_user_id, created_at FROM room_history WHERE room_id = ?')
      .get(record.roomId) as { owner_user_id: string | null; created_at: string } | undefined;

    const resolvedOwner =
      record.ownerUserId !== undefined
        ? record.ownerUserId
        : existing
          ? existing.owner_user_id
          : null;
    const createdAt = existing ? existing.created_at : record.startedAt || nowIso;

    // Sanitize leaderboard entries to ensure only aggregate scores/ranks are persisted (no raw answers or tokens)
    const safeLeaderboard: LeaderboardEntry[] = record.leaderboard.map(entry => ({
      rank: entry.rank,
      playerId: entry.playerId,
      displayName: entry.displayName,
      score: entry.score,
      correctCount: entry.correctCount,
      streak: entry.streak,
      totalResponseTimeMs: entry.totalResponseTimeMs,
      connected: Boolean(entry.connected),
    }));

    db.prepare(
      `INSERT INTO room_history (
        room_id, room_code, game_id, owner_user_id, game_title, game_type,
        scoring_mode, state, player_count, total_questions, leaderboard_json,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        state = excluded.state,
        player_count = excluded.player_count,
        leaderboard_json = excluded.leaderboard_json,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        updated_at = excluded.updated_at`
    ).run(
      record.roomId,
      record.roomCode,
      record.gameId,
      resolvedOwner ?? null,
      record.gameTitle,
      record.gameType,
      record.scoringMode,
      record.state,
      record.playerCount,
      record.totalQuestions,
      JSON.stringify(safeLeaderboard),
      record.startedAt,
      record.finishedAt,
      createdAt,
      nowIso
    );
  }

  public getRoomHistoryById(roomId: string): PersistedRoomHistoryRecord | undefined {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM room_history WHERE room_id = ?')
      .get(roomId) as Record<string, any> | undefined;

    if (!row) return undefined;
    return this.mapRoomHistoryRow(row);
  }

  public listRoomHistory(options: {
    userId?: string | null;
    gameId?: string;
    includeOwnedGames?: boolean;
    limit?: number;
    offset?: number;
  } = {}): PersistedRoomHistoryRecord[] {
    const db = getDatabase();
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const offset = Math.max(0, options.offset ?? 0);

    const conditions: string[] = [];
    const params: any[] = [];

    if (options.userId !== undefined) {
      if (options.userId === null) {
        conditions.push('owner_user_id IS NULL');
      } else if (options.includeOwnedGames !== false) {
        conditions.push(
          '(owner_user_id = ? OR game_id IN (SELECT game_id FROM games WHERE owner_user_id = ?))'
        );
        params.push(options.userId, options.userId);
      } else {
        conditions.push('owner_user_id = ?');
        params.push(options.userId);
      }
    }

    if (options.gameId) {
      conditions.push('game_id = ?');
      params.push(options.gameId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT * FROM room_history ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, any>[];

    return rows.map(r => {
      const mapped = this.mapRoomHistoryRow(r);
      if (options.userId && mapped.ownerUserId && mapped.ownerUserId !== options.userId) {
        return {
          ...mapped,
          ownerUserId: null,
        };
      }
      return mapped;
    });
  }

  public getAdminOverview(): {
    totalUsers: number;
    totalGames: number;
    publishedGames: number;
    draftGames: number;
    totalSessions: number;
    totalRooms: number;
  } {
    const db = getDatabase();
    const userRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const gameRow = db.prepare('SELECT COUNT(*) as count FROM games').get() as { count: number };
    const pubRow = db.prepare('SELECT COUNT(*) as count FROM games WHERE is_public = 1').get() as { count: number };
    const draftRow = db.prepare('SELECT COUNT(*) as count FROM games WHERE is_public = 0').get() as { count: number };
    const sessRow = db.prepare('SELECT COUNT(*) as count FROM practice_sessions').get() as { count: number };
    const roomRow = db.prepare('SELECT COUNT(*) as count FROM room_history').get() as { count: number };

    return {
      totalUsers: userRow?.count ?? 0,
      totalGames: gameRow?.count ?? 0,
      publishedGames: pubRow?.count ?? 0,
      draftGames: draftRow?.count ?? 0,
      totalSessions: sessRow?.count ?? 0,
      totalRooms: roomRow?.count ?? 0,
    };
  }

  public getAdminUsers(): {
    userId: string;
    email: string;
    displayName: string;
    role: string;
    createdAt: string;
    gameCount: number;
  }[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT 
        u.user_id, u.email, u.display_name, u.role, u.created_at,
        COUNT(g.game_id) as game_count
      FROM users u
      LEFT JOIN games g ON g.owner_user_id = u.user_id
      GROUP BY u.user_id
      ORDER BY u.created_at DESC
    `).all() as Record<string, any>[];

    return rows.map(r => ({
      userId: String(r.user_id),
      email: String(r.email),
      displayName: String(r.display_name),
      role: String(r.role),
      createdAt: String(r.created_at),
      gameCount: Number(r.game_count || 0),
    }));
  }

  public getAdminAiLogs(limit: number = 50): Record<string, any>[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT log_id, user_id, provider, model, operation, status, error_code, latency_ms,
             total_tokens, generated_questions, created_at
      FROM ai_usage_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, any>[];
    return rows;
  }

  public setGamePublicStatus(gameId: string, isPublic: boolean): boolean {
    const db = getDatabase();
    const result = db.prepare('UPDATE games SET is_public = ?, updated_at = ? WHERE game_id = ?').run(
      isPublic ? 1 : 0,
      new Date().toISOString(),
      gameId
    );
    return result.changes > 0;
  }

  private mapRoomHistoryRow(row: Record<string, any>): PersistedRoomHistoryRecord {
    return {
      roomId: String(row.room_id),
      roomCode: String(row.room_code),
      gameId: String(row.game_id),
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      gameTitle: String(row.game_title),
      gameType: row.game_type as GameType,
      scoringMode: (row.scoring_mode || 'STANDARD') as ScoringMode,
      state: String(row.state),
      playerCount: Number(row.player_count),
      totalQuestions: Number(row.total_questions),
      leaderboard: JSON.parse(String(row.leaderboard_json || '[]')),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // =========================================================================
  // V2: PARTICIPANT ROSTER, ATTEMPTS, RETAKE & SCOREBOARD
  // =========================================================================

  private normalizeParticipantName(rawName: string): string {
    return String(rawName || '')
      .trim()
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private mapParticipantRow(
    row: Record<string, any>,
    includeSensitiveFields: boolean = true
  ): PersistedParticipantRecord {
    return {
      participantId: String(row.participant_id),
      gameId: String(row.game_id),
      fullName: String(row.full_name),
      departmentUnit: String(row.department_unit || ''),
      employeeCode: includeSensitiveFields ? String(row.employee_code || '') : '',
      contactInfo: includeSensitiveFields ? String(row.contact_info || '') : '',
      allowedAttempts: Number(row.allowed_attempts || 1),
      usedAttempts: Number(row.used_attempts || 0),
      activeSessionId: includeSensitiveFields && row.active_session_id ? String(row.active_session_id) : null,
      activeRoomCode: includeSensitiveFields && row.active_room_code ? String(row.active_room_code) : null,
      isLocked: Boolean(row.active_lock_token && row.status === 'IN_PROGRESS'),
      bestScore:
        includeSensitiveFields && row.best_score !== null && row.best_score !== undefined
          ? Number(row.best_score)
          : null,
      latestScore:
        includeSensitiveFields && row.latest_score !== null && row.latest_score !== undefined
          ? Number(row.latest_score)
          : null,
      latestCorrectAnswers:
        includeSensitiveFields && row.latest_correct_answers !== null && row.latest_correct_answers !== undefined
          ? Number(row.latest_correct_answers)
          : null,
      latestTotalQuestions:
        includeSensitiveFields && row.latest_total_questions !== null && row.latest_total_questions !== undefined
          ? Number(row.latest_total_questions)
          : null,
      latestAccuracyPercent:
        includeSensitiveFields && row.latest_accuracy_percent !== null && row.latest_accuracy_percent !== undefined
          ? Number(row.latest_accuracy_percent)
          : null,
      latestDurationMs:
        includeSensitiveFields && row.latest_duration_ms !== null && row.latest_duration_ms !== undefined
          ? Number(row.latest_duration_ms)
          : null,
      latestIsPassed:
        includeSensitiveFields && row.latest_is_passed !== null && row.latest_is_passed !== undefined
          ? Boolean(row.latest_is_passed)
          : null,
      status: String(row.status || 'PENDING') as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED',
      retakeGrantedCount: Number(row.retake_granted_count || 0),
      retakeGrantedBy: includeSensitiveFields && row.retake_granted_by ? String(row.retake_granted_by) : null,
      retakeGrantedAt: includeSensitiveFields && row.retake_granted_at ? String(row.retake_granted_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public getParticipantById(
    gameId: string,
    participantId: string,
    includeSensitiveFields: boolean = true
  ): PersistedParticipantRecord | undefined {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
      .get(gameId, participantId) as Record<string, any> | undefined;
    if (!row) return undefined;
    return this.mapParticipantRow(row, includeSensitiveFields);
  }

  public listParticipants(
    gameId: string,
    options: {
      search?: string;
      departmentUnit?: string;
      status?: string;
      limit?: number;
      offset?: number;
      includeSensitiveFields?: boolean;
    } = {}
  ): {
    participants: PersistedParticipantRecord[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    departments: string[];
  } {
    const db = getDatabase();
    const limit = Math.min(500, Math.max(1, options.limit ?? 200));
    const offset = Math.max(0, options.offset ?? 0);
    const includeSensitive = options.includeSensitiveFields !== false;

    const conditions: string[] = ['game_id = ?'];
    const params: any[] = [gameId];

    if (options.departmentUnit && options.departmentUnit.trim() && options.departmentUnit !== 'ALL') {
      conditions.push('department_unit = ?');
      params.push(options.departmentUnit.trim());
    }

    if (options.status && options.status.trim() && options.status !== 'ALL') {
      conditions.push('status = ?');
      params.push(options.status.trim().toUpperCase());
    }

    if (options.search && options.search.trim()) {
      const pattern = `%${options.search.trim().toLowerCase()}%`;
      conditions.push(
        '(normalized_name LIKE ? OR LOWER(department_unit) LIKE ? OR LOWER(employee_code) LIKE ?)'
      );
      params.push(pattern, pattern, pattern);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM game_participants ${whereClause}`)
      .get(...params) as { cnt: number };

    const rows = db
      .prepare(
        `SELECT * FROM game_participants ${whereClause}
         ORDER BY department_unit ASC, full_name ASC, created_at ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, any>[];

    const deptRows = db
      .prepare(
        `SELECT DISTINCT department_unit FROM game_participants
         WHERE game_id = ? AND department_unit != ''
         ORDER BY department_unit ASC`
      )
      .all(gameId) as Array<{ department_unit: string }>;

    const total = Number(countRow?.cnt || 0);
    const participants = rows.map(r => this.mapParticipantRow(r, includeSensitive));

    return {
      participants,
      total,
      limit,
      offset,
      hasMore: offset + participants.length < total,
      departments: deptRows.map(d => String(d.department_unit)),
    };
  }

  /**
   * Bulk insert or update participants in a game roster.
   * Each participant gets a unique internal participant_id (never using full_name as PK, so duplicate names are never merged).
   */
  public upsertParticipants(
    gameId: string,
    items: Array<{
      participantId?: string;
      fullName: string;
      departmentUnit?: string;
      employeeCode?: string;
      contactInfo?: string;
      allowedAttempts?: number;
    }>,
    replaceAll: boolean = false
  ): PersistedParticipantRecord[] {
    const nowIso = new Date().toISOString();

    return runInTransaction(db => {
      if (replaceAll) {
        db.prepare('DELETE FROM game_participants WHERE game_id = ?').run(gameId);
      }

      const insertStmt = db.prepare(
        `INSERT INTO game_participants (
          participant_id, game_id, full_name, normalized_name,
          department_unit, employee_code, contact_info,
          allowed_attempts, used_attempts, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', ?, ?)
        ON CONFLICT(participant_id) DO UPDATE SET
          full_name = excluded.full_name,
          normalized_name = excluded.normalized_name,
          department_unit = excluded.department_unit,
          employee_code = excluded.employee_code,
          contact_info = excluded.contact_info,
          allowed_attempts = excluded.allowed_attempts,
          updated_at = excluded.updated_at`
      );

      for (const raw of items) {
        const cleanName = String(raw.fullName || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        if (!cleanName) continue;

        const pid =
          raw.participantId && raw.participantId.trim()
            ? raw.participantId.trim()
            : `ptp_${crypto.randomUUID()}`;
        const normName = this.normalizeParticipantName(cleanName);
        const dept = String(raw.departmentUnit || '').trim().slice(0, 120);
        const empCode = String(raw.employeeCode || '').trim().slice(0, 80);
        const contact = String(raw.contactInfo || '').trim().slice(0, 160);
        const allowed = Math.max(1, Math.min(50, Math.floor(Number(raw.allowedAttempts) || 1)));

        insertStmt.run(pid, gameId, cleanName, normName, dept, empCode, contact, allowed, nowIso, nowIso);
      }

      const allRows = db
        .prepare(
          'SELECT * FROM game_participants WHERE game_id = ? ORDER BY department_unit ASC, full_name ASC, created_at ASC'
        )
        .all(gameId) as Record<string, any>[];
      return allRows.map(r => this.mapParticipantRow(r, true));
    });
  }

  public updateParticipant(
    gameId: string,
    participantId: string,
    updates: {
      fullName?: string;
      departmentUnit?: string;
      employeeCode?: string;
      contactInfo?: string;
      allowedAttempts?: number;
    }
  ): PersistedParticipantRecord | undefined {
    const db = getDatabase();
    const existing = db
      .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
      .get(gameId, participantId) as Record<string, any> | undefined;
    if (!existing) return undefined;

    const fullName =
      updates.fullName !== undefined
        ? updates.fullName.trim().replace(/\s+/g, ' ').slice(0, 120)
        : String(existing.full_name);
    if (!fullName) {
      throw new AppError('INVALID_PARTICIPANT_NAME', 'Họ và tên người tham gia không được để trống.', 400);
    }

    const departmentUnit =
      updates.departmentUnit !== undefined
        ? updates.departmentUnit.trim().slice(0, 120)
        : String(existing.department_unit || '');
    const employeeCode =
      updates.employeeCode !== undefined
        ? updates.employeeCode.trim().slice(0, 80)
        : String(existing.employee_code || '');
    const contactInfo =
      updates.contactInfo !== undefined
        ? updates.contactInfo.trim().slice(0, 160)
        : String(existing.contact_info || '');
    const allowedAttempts =
      updates.allowedAttempts !== undefined
        ? Math.max(1, Math.min(50, Math.floor(Number(updates.allowedAttempts) || 1)))
        : Number(existing.allowed_attempts || 1);

    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE game_participants
       SET full_name = ?, normalized_name = ?, department_unit = ?,
           employee_code = ?, contact_info = ?, allowed_attempts = ?, updated_at = ?
       WHERE game_id = ? AND participant_id = ?`
    ).run(
      fullName,
      this.normalizeParticipantName(fullName),
      departmentUnit,
      employeeCode,
      contactInfo,
      allowedAttempts,
      nowIso,
      gameId,
      participantId
    );

    return this.getParticipantById(gameId, participantId, true);
  }

  public deleteParticipant(gameId: string, participantId: string): boolean {
    const db = getDatabase();
    const res = db
      .prepare('DELETE FROM game_participants WHERE game_id = ? AND participant_id = ?')
      .run(gameId, participantId);
    return Number(res.changes || 0) > 0;
  }

  public clearParticipants(gameId: string): number {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM game_participants WHERE game_id = ?').run(gameId);
    return Number(res.changes || 0);
  }

  /**
   * Atomically claims or resumes a participant slot for Solo or Multiplayer Play/Exam.
   * Prevents race conditions when two connections try to claim the same participant concurrently.
   */
  public claimParticipantSlot(params: {
    gameId: string;
    participantId: string;
    lockToken: string;
    sessionId?: string | null;
    roomCode?: string | null;
    sessionMode?: 'PLAY' | 'EXAM';
  }): {
    resumed: boolean;
    participant: PersistedParticipantRecord;
    activeSessionId: string | null;
    activeRoomCode: string | null;
  } {
    const nowIso = new Date().toISOString();
    const cleanToken = String(params.lockToken || '').trim();
    if (!cleanToken) {
      throw new AppError('INVALID_LOCK_TOKEN', 'Thiếu mã xác thực phiên làm bài của thí sinh.', 400);
    }

    return runInTransaction(db => {
      const row = db
        .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
        .get(params.gameId, params.participantId) as Record<string, any> | undefined;

      if (!row) {
        throw new AppError(
          'PARTICIPANT_NOT_FOUND',
          'Không tìm thấy thí sinh này trong danh sách của Ban Tổ Chức.',
          404
        );
      }

      const status = String(row.status || 'PENDING');
      const activeLockToken = row.active_lock_token ? String(row.active_lock_token) : null;
      const activeLockedAt = row.active_locked_at ? Date.parse(String(row.active_locked_at)) : 0;
      const isLockStale = activeLockedAt > 0 && Date.now() - activeLockedAt > 2 * 60 * 60 * 1000;

      const allowedAttempts = Number(row.allowed_attempts || 1);
      const usedAttempts = Number(row.used_attempts || 0);

      // Case 1: Same device / same lockToken reconnecting or refreshing an active session
      if (activeLockToken && activeLockToken === cleanToken && status === 'IN_PROGRESS') {
        const nextSessionId =
          params.sessionId !== undefined
            ? params.sessionId
            : row.active_session_id
              ? String(row.active_session_id)
              : null;
        const nextRoomCode =
          params.roomCode !== undefined
            ? params.roomCode
            : row.active_room_code
              ? String(row.active_room_code)
              : null;

        db.prepare(
          `UPDATE game_participants
           SET active_session_id = ?, active_room_code = ?, active_locked_at = ?, updated_at = ?
           WHERE game_id = ? AND participant_id = ?`
        ).run(nextSessionId, nextRoomCode, nowIso, nowIso, params.gameId, params.participantId);

        const updatedRow = db
          .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
          .get(params.gameId, params.participantId) as Record<string, any>;

        return {
          resumed: true,
          participant: this.mapParticipantRow(updatedRow, true),
          activeSessionId: nextSessionId,
          activeRoomCode: nextRoomCode,
        };
      }

      // Case 2: Another device currently holds an active non-stale lock on this participant
      if (activeLockToken && activeLockToken !== cleanToken && status === 'IN_PROGRESS' && !isLockStale) {
        throw new AppError(
          'PARTICIPANT_SLOT_LOCKED',
          `Thí sinh "${row.full_name}" đang trong bài làm trên một phiên kết nối khác. Nếu bạn gặp sự cố thiết bị, vui lòng liên hệ Ban Tổ Chức để được cấp quyền thi lại.`,
          409
        );
      }

      // Case 3: Check attempt limit (Strict for EXAM mode; PLAY mode allows replaying to improve HIGHEST_SCORE)
      const isPlayUnlimited = params.sessionMode === 'PLAY';
      if (!isPlayUnlimited && usedAttempts >= allowedAttempts) {
        throw new AppError(
          'ATTEMPT_LIMIT_REACHED',
          `Thí sinh "${row.full_name}" đã hoàn thành đủ số lượt cho phép (${usedAttempts}/${allowedAttempts} lượt). Vui lòng liên hệ Ban Tổ Chức nếu cần cấp quyền làm lại.`,
          403
        );
      }

      // Case 4: Claim the slot atomically
      const nextSessionId = params.sessionId ?? null;
      const nextRoomCode = params.roomCode ?? null;

      db.prepare(
        `UPDATE game_participants
         SET status = 'IN_PROGRESS',
             active_lock_token = ?,
             active_locked_at = ?,
             active_session_id = ?,
             active_room_code = ?,
             updated_at = ?
         WHERE game_id = ? AND participant_id = ?`
      ).run(
        cleanToken,
        nowIso,
        nextSessionId,
        nextRoomCode,
        nowIso,
        params.gameId,
        params.participantId
      );

      const updatedRow = db
        .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
        .get(params.gameId, params.participantId) as Record<string, any>;

      return {
        resumed: false,
        participant: this.mapParticipantRow(updatedRow, true),
        activeSessionId: nextSessionId,
        activeRoomCode: nextRoomCode,
      };
    });
  }

  public recordParticipantAttemptStart(params: {
    attemptId?: string;
    gameId: string;
    participantId?: string | null;
    sessionId?: string | null;
    roomId?: string | null;
    roomCode?: string | null;
    deliveryMode: 'SOLO' | 'MULTIPLAYER';
    sessionMode: 'PLAY' | 'EXAM';
    displayName: string;
    departmentUnit?: string;
    employeeCode?: string;
    lockToken?: string | null;
    totalQuestions: number;
    maxPossibleScore: number;
    startedAt?: string;
  }): PersistedParticipantAttemptRecord {
    const nowIso = params.startedAt || new Date().toISOString();
    const tokenHash = params.lockToken
      ? crypto.createHash('sha256').update(params.lockToken).digest('hex')
      : null;

    return runInTransaction(db => {
      // Check if an IN_PROGRESS attempt already exists for the same sessionId or (roomId + participantId/displayName)
      if (params.sessionId) {
        const existingBySession = db
          .prepare('SELECT * FROM game_participant_attempts WHERE session_id = ?')
          .get(params.sessionId) as Record<string, any> | undefined;
        if (existingBySession) {
          return this.mapParticipantAttemptRow(existingBySession);
        }
      }
      if (params.roomId && params.participantId) {
        const existingByRoomParticipant = db
          .prepare(
            "SELECT * FROM game_participant_attempts WHERE room_id = ? AND participant_id = ? AND state = 'IN_PROGRESS' ORDER BY attempt_number DESC LIMIT 1"
          )
          .get(params.roomId, params.participantId) as Record<string, any> | undefined;
        if (existingByRoomParticipant) {
          return this.mapParticipantAttemptRow(existingByRoomParticipant);
        }
      }

      let attemptNumber = 1;
      if (params.participantId) {
        const countRow = db
          .prepare('SELECT COUNT(*) as cnt FROM game_participant_attempts WHERE participant_id = ?')
          .get(params.participantId) as { cnt: number };
        attemptNumber = Number(countRow?.cnt || 0) + 1;
      } else {
        const countRow = db
          .prepare(
            'SELECT COUNT(*) as cnt FROM game_participant_attempts WHERE game_id = ? AND LOWER(display_name) = LOWER(?)'
          )
          .get(params.gameId, params.displayName.trim()) as { cnt: number };
        attemptNumber = Number(countRow?.cnt || 0) + 1;
      }

      const attemptId = params.attemptId || `att_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO game_participant_attempts (
          attempt_id, game_id, participant_id, session_id, room_id, room_code,
          delivery_mode, session_mode, attempt_number,
          display_name, department_unit, employee_code, participant_token_hash,
          state, score, max_possible_score, correct_answers, total_questions,
          accuracy_percent, duration_ms, is_passed, answers_json,
          started_at, finished_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 0, ?, 0, ?, 0, 0, NULL, '[]', ?, NULL, ?, ?)`
      ).run(
        attemptId,
        params.gameId,
        params.participantId ?? null,
        params.sessionId ?? null,
        params.roomId ?? null,
        params.roomCode ?? null,
        params.deliveryMode,
        params.sessionMode,
        attemptNumber,
        params.displayName.trim(),
        String(params.departmentUnit || '').trim(),
        String(params.employeeCode || '').trim(),
        tokenHash,
        params.maxPossibleScore,
        params.totalQuestions,
        nowIso,
        nowIso,
        nowIso
      );

      if (params.participantId && params.sessionId) {
        db.prepare(
          `UPDATE game_participants
           SET active_session_id = ?, updated_at = ?
           WHERE game_id = ? AND participant_id = ?`
        ).run(params.sessionId, nowIso, params.gameId, params.participantId);
      }

      const created = db
        .prepare('SELECT * FROM game_participant_attempts WHERE attempt_id = ?')
        .get(attemptId) as Record<string, any>;
      return this.mapParticipantAttemptRow(created);
    });
  }

  public recordParticipantAttemptCompletion(params: {
    attemptId?: string;
    sessionId?: string;
    roomId?: string;
    participantId?: string | null;
    gameId: string;
    displayName?: string;
    departmentUnit?: string;
    deliveryMode?: 'SOLO' | 'MULTIPLAYER';
    sessionMode?: 'PLAY' | 'EXAM';
    state: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED';
    score: number;
    maxPossibleScore: number;
    correctAnswers: number;
    totalQuestions: number;
    durationMs: number;
    passThresholdPercent?: number;
    answers?: any[];
    finishedAt?: string | null;
  }): PersistedParticipantAttemptRecord | undefined {
    const nowIso = new Date().toISOString();

    return runInTransaction(db => {
      let existingRow: Record<string, any> | undefined;
      if (params.attemptId) {
        existingRow = db
          .prepare('SELECT * FROM game_participant_attempts WHERE attempt_id = ?')
          .get(params.attemptId) as Record<string, any> | undefined;
      }
      if (!existingRow && params.sessionId) {
        existingRow = db
          .prepare('SELECT * FROM game_participant_attempts WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(params.sessionId) as Record<string, any> | undefined;
      }
      if (!existingRow && params.roomId && params.participantId) {
        existingRow = db
          .prepare(
            'SELECT * FROM game_participant_attempts WHERE room_id = ? AND participant_id = ? ORDER BY attempt_number DESC LIMIT 1'
          )
          .get(params.roomId, params.participantId) as Record<string, any> | undefined;
      }
      if (!existingRow && params.roomId && params.displayName) {
        existingRow = db
          .prepare(
            'SELECT * FROM game_participant_attempts WHERE room_id = ? AND LOWER(display_name) = LOWER(?) ORDER BY attempt_number DESC LIMIT 1'
          )
          .get(params.roomId, params.displayName.trim()) as Record<string, any> | undefined;
      }

      const safeTotal = Math.max(0, Number(params.totalQuestions) || 0);
      const safeCorrect = Math.max(0, Math.min(safeTotal, Number(params.correctAnswers) || 0));
      const accuracyPercent = safeTotal > 0 ? Math.round((safeCorrect / safeTotal) * 100) : 0;
      const sessionMode =
        params.sessionMode ||
        (existingRow?.session_mode as 'PLAY' | 'EXAM' | undefined) ||
        'PLAY';
      const threshold =
        typeof params.passThresholdPercent === 'number' && Number.isFinite(params.passThresholdPercent)
          ? Math.max(0, Math.min(100, params.passThresholdPercent))
          : 50;
      const isPassed = sessionMode === 'EXAM' ? (accuracyPercent >= threshold ? 1 : 0) : null;

      let targetAttemptId: string;
      let resolvedParticipantId: string | null =
        params.participantId !== undefined
          ? params.participantId
          : existingRow?.participant_id
            ? String(existingRow.participant_id)
            : null;
      const wasAlreadyFinished = existingRow && String(existingRow.state) === 'FINISHED';

      if (existingRow) {
        targetAttemptId = String(existingRow.attempt_id);
        const finishedAt =
          params.state === 'FINISHED' || params.state === 'ABANDONED'
            ? params.finishedAt || existingRow.finished_at || nowIso
            : null;
        const answersJson =
          params.answers !== undefined ? JSON.stringify(params.answers) : String(existingRow.answers_json || '[]');

        db.prepare(
          `UPDATE game_participant_attempts
           SET state = ?, score = ?, max_possible_score = ?,
               correct_answers = ?, total_questions = ?, accuracy_percent = ?,
               duration_ms = ?, is_passed = ?, answers_json = ?,
               finished_at = ?, updated_at = ?
           WHERE attempt_id = ?`
        ).run(
          params.state,
          Math.max(0, Math.round(params.score)),
          Math.max(0, Math.round(params.maxPossibleScore)),
          safeCorrect,
          safeTotal,
          accuracyPercent,
          Math.max(0, Math.round(params.durationMs)),
          isPassed,
          answersJson,
          finishedAt,
          nowIso,
          targetAttemptId
        );
      } else {
        // Create on-the-fly if not started earlier (e.g., free-text player in room or solo)
        let attemptNumber = 1;
        if (resolvedParticipantId) {
          const cntRow = db
            .prepare('SELECT COUNT(*) as cnt FROM game_participant_attempts WHERE participant_id = ?')
            .get(resolvedParticipantId) as { cnt: number };
          attemptNumber = Number(cntRow?.cnt || 0) + 1;
        }
        targetAttemptId = params.attemptId || `att_${crypto.randomUUID()}`;
        const finishedAt =
          params.state === 'FINISHED' || params.state === 'ABANDONED'
            ? params.finishedAt || nowIso
            : null;

        db.prepare(
          `INSERT INTO game_participant_attempts (
            attempt_id, game_id, participant_id, session_id, room_id, room_code,
            delivery_mode, session_mode, attempt_number,
            display_name, department_unit, employee_code, participant_token_hash,
            state, score, max_possible_score, correct_answers, total_questions,
            accuracy_percent, duration_ms, is_passed, answers_json,
            started_at, finished_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          targetAttemptId,
          params.gameId,
          resolvedParticipantId,
          params.sessionId ?? null,
          params.roomId ?? null,
          params.deliveryMode || 'SOLO',
          sessionMode,
          attemptNumber,
          String(params.displayName || 'Người chơi').trim(),
          String(params.departmentUnit || '').trim(),
          params.state,
          Math.max(0, Math.round(params.score)),
          Math.max(0, Math.round(params.maxPossibleScore)),
          safeCorrect,
          safeTotal,
          accuracyPercent,
          Math.max(0, Math.round(params.durationMs)),
          isPassed,
          JSON.stringify(params.answers || []),
          nowIso,
          finishedAt,
          nowIso,
          nowIso
        );
      }

      // Synchronize participant roster record when FINISHED
      if (resolvedParticipantId && params.state === 'FINISHED' && !wasAlreadyFinished) {
        const pRow = db
          .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
          .get(params.gameId, resolvedParticipantId) as Record<string, any> | undefined;

        if (pRow) {
          const nextUsed = Number(pRow.used_attempts || 0) + 1;
          const prevBest =
            pRow.best_score !== null && pRow.best_score !== undefined
              ? Number(pRow.best_score)
              : null;
          const nextBest =
            prevBest === null
              ? Math.round(params.score)
              : Math.max(prevBest, Math.round(params.score));

          db.prepare(
            `UPDATE game_participants
             SET used_attempts = ?,
                 status = 'COMPLETED',
                 active_session_id = NULL,
                 active_room_code = NULL,
                 active_lock_token = NULL,
                 active_locked_at = NULL,
                 best_score = ?,
                 latest_score = ?,
                 latest_correct_answers = ?,
                 latest_total_questions = ?,
                 latest_accuracy_percent = ?,
                 latest_duration_ms = ?,
                 latest_is_passed = ?,
                 updated_at = ?
             WHERE game_id = ? AND participant_id = ?`
          ).run(
            nextUsed,
            nextBest,
            Math.round(params.score),
            safeCorrect,
            safeTotal,
            accuracyPercent,
            Math.max(0, Math.round(params.durationMs)),
            isPassed,
            nowIso,
            params.gameId,
            resolvedParticipantId
          );
        }
      }

      const finalRow = db
        .prepare('SELECT * FROM game_participant_attempts WHERE attempt_id = ?')
        .get(targetAttemptId) as Record<string, any> | undefined;
      return finalRow ? this.mapParticipantAttemptRow(finalRow) : undefined;
    });
  }

  /**
   * Grants a retake to a participant safely.
   * Marks any stuck IN_PROGRESS attempt as ABANDONED (preserving history),
   * unlocks the participant slot, and ensures allowed_attempts >= used_attempts + additionalAttempts.
   */
  public grantParticipantRetake(params: {
    gameId: string;
    participantId: string;
    grantedByUserId: string | null;
    additionalAttempts?: number;
  }): PersistedParticipantRecord {
    const nowIso = new Date().toISOString();
    const extra = Math.max(1, Math.min(10, Math.floor(Number(params.additionalAttempts) || 1)));

    return runInTransaction(db => {
      const row = db
        .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
        .get(params.gameId, params.participantId) as Record<string, any> | undefined;

      if (!row) {
        throw new AppError(
          'PARTICIPANT_NOT_FOUND',
          'Không tìm thấy thí sinh cần cấp quyền thi lại.',
          404
        );
      }

      // Mark any stuck IN_PROGRESS attempts for this participant as ABANDONED without deleting them
      db.prepare(
        `UPDATE game_participant_attempts
         SET state = 'ABANDONED', finished_at = COALESCE(finished_at, ?), updated_at = ?
         WHERE game_id = ? AND participant_id = ? AND state = 'IN_PROGRESS'`
      ).run(nowIso, nowIso, params.gameId, params.participantId);

      const used = Number(row.used_attempts || 0);
      const currentAllowed = Number(row.allowed_attempts || 1);
      // Whether two retake requests arrive sequentially or concurrently, increase allowed_attempts deterministically
      const nextAllowed = Math.max(used, currentAllowed) + extra;
      const nextRetakeCount = Number(row.retake_granted_count || 0) + extra;

      db.prepare(
        `UPDATE game_participants
         SET allowed_attempts = ?,
             status = CASE WHEN used_attempts > 0 THEN 'COMPLETED' ELSE 'PENDING' END,
             active_session_id = NULL,
             active_room_code = NULL,
             active_lock_token = NULL,
             active_locked_at = NULL,
             retake_granted_count = ?,
             retake_granted_by = ?,
             retake_granted_at = ?,
             updated_at = ?
         WHERE game_id = ? AND participant_id = ?`
      ).run(
        nextAllowed,
        nextRetakeCount,
        params.grantedByUserId ?? 'HOST',
        nowIso,
        nowIso,
        params.gameId,
        params.participantId
      );

      const updated = db
        .prepare('SELECT * FROM game_participants WHERE game_id = ? AND participant_id = ?')
        .get(params.gameId, params.participantId) as Record<string, any>;

      return this.mapParticipantRow(updated, true);
    });
  }

  public listParticipantAttempts(
    gameId: string,
    participantId?: string
  ): PersistedParticipantAttemptRecord[] {
    const db = getDatabase();
    const rows = (
      participantId
        ? db
            .prepare(
              'SELECT * FROM game_participant_attempts WHERE game_id = ? AND participant_id = ? ORDER BY attempt_number ASC, created_at ASC'
            )
            .all(gameId, participantId)
        : db
            .prepare(
              'SELECT * FROM game_participant_attempts WHERE game_id = ? ORDER BY created_at DESC LIMIT 1000'
            )
            .all(gameId)
    ) as Record<string, any>[];
    return rows.map(r => this.mapParticipantAttemptRow(r));
  }

  private mapParticipantAttemptRow(row: Record<string, any>): PersistedParticipantAttemptRecord {
    let answers: any[] = [];
    try {
      answers = JSON.parse(String(row.answers_json || '[]'));
    } catch {
      answers = [];
    }
    return {
      attemptId: String(row.attempt_id),
      gameId: String(row.game_id),
      participantId: row.participant_id ? String(row.participant_id) : null,
      sessionId: row.session_id ? String(row.session_id) : null,
      roomId: row.room_id ? String(row.room_id) : null,
      roomCode: row.room_code ? String(row.room_code) : null,
      deliveryMode: String(row.delivery_mode || 'SOLO') as 'SOLO' | 'MULTIPLAYER',
      sessionMode: String(row.session_mode || 'PLAY') as 'PLAY' | 'EXAM',
      attemptNumber: Number(row.attempt_number || 1),
      displayName: String(row.display_name),
      departmentUnit: String(row.department_unit || ''),
      employeeCode: String(row.employee_code || ''),
      state: String(row.state || 'IN_PROGRESS') as 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED',
      score: Number(row.score || 0),
      maxPossibleScore: Number(row.max_possible_score || 0),
      correctAnswers: Number(row.correct_answers || 0),
      totalQuestions: Number(row.total_questions || 0),
      accuracyPercent: Number(row.accuracy_percent || 0),
      durationMs: Number(row.duration_ms || 0),
      isPassed:
        row.is_passed !== null && row.is_passed !== undefined ? Boolean(row.is_passed) : null,
      answers,
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  /**
   * Builds the unified BTC Scoreboard for a game, combining pre-configured roster participants
   * and any ad-hoc attempts (Solo or Multiplayer), applying the approved Official Attempt Policy:
   * - EXAM default: LATEST_ATTEMPT (latest finished valid attempt)
   * - PLAY default: HIGHEST_SCORE (highest score; tie-break by accuracyPercent DESC, durationMs ASC)
   */
  public getGameScoreboard(
    gameId: string,
    options: {
      search?: string;
      departmentUnit?: string;
      statusFilter?: string; // ALL | COMPLETED | IN_PROGRESS | PENDING | PASSED | FAILED
      sortBy?: 'rank' | 'score' | 'accuracy' | 'duration' | 'name' | 'attempts';
      sortDir?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
    } = {}
  ): GameScoreboardSummary {
    const spec = this.getGameSpecificationById(gameId);
    const sessionMode: 'PLAY' | 'EXAM' =
      spec?.settings?.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
    const officialAttemptPolicy: 'LATEST_ATTEMPT' | 'HIGHEST_SCORE' =
      spec?.settings?.officialAttemptPolicy ||
      (sessionMode === 'EXAM' ? 'LATEST_ATTEMPT' : 'HIGHEST_SCORE');
    const passThresholdPercent =
      typeof spec?.settings?.passThresholdPercent === 'number'
        ? spec.settings.passThresholdPercent
        : 50;
    const totalQuestionsDefault = spec?.questions?.length || 0;

    const db = getDatabase();
    const rosterRows = db
      .prepare('SELECT * FROM game_participants WHERE game_id = ? ORDER BY department_unit ASC, full_name ASC')
      .all(gameId) as Record<string, any>[];
    const attemptRows = db
      .prepare('SELECT * FROM game_participant_attempts WHERE game_id = ? ORDER BY attempt_number ASC, created_at ASC')
      .all(gameId) as Record<string, any>[];

    const attempts = attemptRows.map(r => this.mapParticipantAttemptRow(r));
    const attemptsByParticipantId = new Map<string, PersistedParticipantAttemptRecord[]>();
    const adhocAttemptsByKey = new Map<string, PersistedParticipantAttemptRecord[]>();

    for (const att of attempts) {
      if (att.participantId) {
        const list = attemptsByParticipantId.get(att.participantId) || [];
        list.push(att);
        attemptsByParticipantId.set(att.participantId, list);
      } else {
        const key = `${att.displayName.trim().toLowerCase()}::${att.departmentUnit.trim().toLowerCase()}`;
        const list = adhocAttemptsByKey.get(key) || [];
        list.push(att);
        adhocAttemptsByKey.set(key, list);
      }
    }

    const selectOfficialAttempt = (
      list: PersistedParticipantAttemptRecord[]
    ): PersistedParticipantAttemptRecord | null => {
      const finished = list.filter(a => a.state === 'FINISHED');
      const pool = finished.length > 0 ? finished : list;
      if (pool.length === 0) return null;

      if (officialAttemptPolicy === 'LATEST_ATTEMPT') {
        return pool[pool.length - 1];
      }
      // HIGHEST_SCORE: highest score -> highest accuracy -> shortest duration -> latest attempt
      return [...pool].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.accuracyPercent !== a.accuracyPercent) return b.accuracyPercent - a.accuracyPercent;
        const durA = a.durationMs > 0 ? a.durationMs : Number.MAX_SAFE_INTEGER;
        const durB = b.durationMs > 0 ? b.durationMs : Number.MAX_SAFE_INTEGER;
        if (durA !== durB) return durA - durB;
        return b.attemptNumber - a.attemptNumber;
      })[0];
    };

    const entries: ScoreboardParticipantEntry[] = [];

    for (const r of rosterRows) {
      const p = this.mapParticipantRow(r, true);
      const pAttempts = attemptsByParticipantId.get(p.participantId) || [];
      const official = selectOfficialAttempt(pAttempts);
      const finishedAttempts = pAttempts.filter(a => a.state === 'FINISHED');
      const hasFinished = finishedAttempts.length > 0;
      const effectiveStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' = hasFinished
        ? 'COMPLETED'
        : p.status === 'IN_PROGRESS' || pAttempts.some(a => a.state === 'IN_PROGRESS')
          ? 'IN_PROGRESS'
          : 'PENDING';

      const score = official ? official.score : 0;
      const maxPossibleScore = official ? official.maxPossibleScore : 0;
      const correctAnswers = official ? official.correctAnswers : 0;
      const totalQuestions = official ? official.totalQuestions : totalQuestionsDefault;
      const accuracyPercent = official ? official.accuracyPercent : 0;
      const durationMs = official ? official.durationMs : 0;
      const isPassed =
        sessionMode === 'EXAM'
          ? hasFinished
            ? accuracyPercent >= passThresholdPercent
            : null
          : null;

      entries.push({
        rank: null,
        participantId: p.participantId,
        fullName: p.fullName,
        departmentUnit: p.departmentUnit,
        employeeCode: p.employeeCode,
        status: effectiveStatus,
        correctAnswers,
        totalQuestions,
        accuracyPercent,
        score,
        maxPossibleScore,
        isPassed,
        durationMs,
        usedAttempts: Math.max(p.usedAttempts, finishedAttempts.length),
        allowedAttempts: p.allowedAttempts,
        retakeGrantedCount: p.retakeGrantedCount,
        officialAttemptId: official ? official.attemptId : null,
        officialAttemptNumber: official ? official.attemptNumber : null,
        finishedAt: official ? official.finishedAt : null,
        attemptHistory: pAttempts,
      });
    }

    // Include ad-hoc participants who played without a preconfigured roster ID
    for (const [, list] of adhocAttemptsByKey.entries()) {
      const official = selectOfficialAttempt(list);
      if (!official) continue;
      const finishedAttempts = list.filter(a => a.state === 'FINISHED');
      const hasFinished = finishedAttempts.length > 0;
      const effectiveStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' = hasFinished
        ? 'COMPLETED'
        : 'IN_PROGRESS';
      const isPassed =
        sessionMode === 'EXAM'
          ? hasFinished
            ? official.accuracyPercent >= passThresholdPercent
            : null
          : null;

      entries.push({
        rank: null,
        participantId: null,
        fullName: official.displayName,
        departmentUnit: official.departmentUnit,
        employeeCode: official.employeeCode,
        status: effectiveStatus,
        correctAnswers: official.correctAnswers,
        totalQuestions: official.totalQuestions || totalQuestionsDefault,
        accuracyPercent: official.accuracyPercent,
        score: official.score,
        maxPossibleScore: official.maxPossibleScore,
        isPassed,
        durationMs: official.durationMs,
        usedAttempts: finishedAttempts.length || list.length,
        allowedAttempts: Math.max(1, finishedAttempts.length),
        retakeGrantedCount: 0,
        officialAttemptId: official.attemptId,
        officialAttemptNumber: official.attemptNumber,
        finishedAt: official.finishedAt,
        attemptHistory: list,
      });
    }

    // Rank all COMPLETED entries deterministically: score DESC -> correctAnswers DESC -> durationMs ASC -> fullName ASC
    const completedEntries = entries
      .filter(e => e.status === 'COMPLETED')
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.correctAnswers !== a.correctAnswers) return b.correctAnswers - a.correctAnswers;
        const durA = a.durationMs > 0 ? a.durationMs : Number.MAX_SAFE_INTEGER;
        const durB = b.durationMs > 0 ? b.durationMs : Number.MAX_SAFE_INTEGER;
        if (durA !== durB) return durA - durB;
        return a.fullName.localeCompare(b.fullName, 'vi');
      });

    completedEntries.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    const top3 = completedEntries.slice(0, 3);

    // Filter entries for table view
    let filtered = [...entries];
    if (options.departmentUnit && options.departmentUnit.trim() && options.departmentUnit !== 'ALL') {
      filtered = filtered.filter(e => e.departmentUnit === options.departmentUnit!.trim());
    }
    if (options.statusFilter && options.statusFilter !== 'ALL') {
      const sf = options.statusFilter.toUpperCase();
      if (sf === 'PASSED') {
        filtered = filtered.filter(e => e.status === 'COMPLETED' && e.isPassed === true);
      } else if (sf === 'FAILED') {
        filtered = filtered.filter(e => e.status === 'COMPLETED' && e.isPassed === false);
      } else {
        filtered = filtered.filter(e => e.status === sf);
      }
    }
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      filtered = filtered.filter(
        e =>
          e.fullName.toLowerCase().includes(q) ||
          e.departmentUnit.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q)
      );
    }

    // Sort filtered entries
    const sortBy = options.sortBy || 'rank';
    const sortDir = options.sortDir || 'asc';
    const dirMul = sortDir === 'desc' ? -1 : 1;

    filtered.sort((a, b) => {
      if (sortBy === 'score') {
        return (a.score - b.score) * dirMul;
      }
      if (sortBy === 'accuracy') {
        return (a.accuracyPercent - b.accuracyPercent) * dirMul;
      }
      if (sortBy === 'duration') {
        return (a.durationMs - b.durationMs) * dirMul;
      }
      if (sortBy === 'name') {
        return a.fullName.localeCompare(b.fullName, 'vi') * dirMul;
      }
      if (sortBy === 'attempts') {
        return (a.usedAttempts - b.usedAttempts) * dirMul;
      }
      // Default: rank ASC (completed ranked first, then IN_PROGRESS, then PENDING)
      const rankA = a.rank ?? 999999;
      const rankB = b.rank ?? 999999;
      if (rankA !== rankB) return (rankA - rankB) * dirMul;
      return a.fullName.localeCompare(b.fullName, 'vi');
    });

    const totalFiltered = filtered.length;
    const limit = Math.min(1000, Math.max(1, options.limit ?? 200));
    const offset = Math.max(0, options.offset ?? 0);
    const paged = filtered.slice(offset, offset + limit);

    const departments = Array.from(
      new Set(entries.map(e => e.departmentUnit).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'vi'));

    return {
      gameId,
      gameTitle: spec?.title || '',
      sessionMode,
      officialAttemptPolicy,
      passThresholdPercent,
      answersPublished: Boolean(spec?.settings?.answersPublished),
      totals: {
        totalParticipants: entries.length,
        completedCount: entries.filter(e => e.status === 'COMPLETED').length,
        inProgressCount: entries.filter(e => e.status === 'IN_PROGRESS').length,
        pendingCount: entries.filter(e => e.status === 'PENDING').length,
        passedCount: entries.filter(e => e.status === 'COMPLETED' && e.isPassed === true).length,
        failedCount: entries.filter(e => e.status === 'COMPLETED' && e.isPassed === false).length,
      },
      top3,
      entries: paged,
      allEntries: entries,
      totalFiltered,
      limit,
      offset,
      hasMore: offset + paged.length < totalFiltered,
      departments,
    };
  }
}

export interface PersistedParticipantRecord {
  participantId: string;
  gameId: string;
  fullName: string;
  departmentUnit: string;
  employeeCode: string;
  contactInfo: string;
  allowedAttempts: number;
  usedAttempts: number;
  activeSessionId: string | null;
  activeRoomCode: string | null;
  isLocked: boolean;
  bestScore: number | null;
  latestScore: number | null;
  latestCorrectAnswers: number | null;
  latestTotalQuestions: number | null;
  latestAccuracyPercent: number | null;
  latestDurationMs: number | null;
  latestIsPassed: boolean | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  retakeGrantedCount: number;
  retakeGrantedBy: string | null;
  retakeGrantedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedParticipantAttemptRecord {
  attemptId: string;
  gameId: string;
  participantId: string | null;
  sessionId: string | null;
  roomId: string | null;
  roomCode: string | null;
  deliveryMode: 'SOLO' | 'MULTIPLAYER';
  sessionMode: 'PLAY' | 'EXAM';
  attemptNumber: number;
  displayName: string;
  departmentUnit: string;
  employeeCode: string;
  state: 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED';
  score: number;
  maxPossibleScore: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  durationMs: number;
  isPassed: boolean | null;
  answers: any[];
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreboardParticipantEntry {
  rank: number | null;
  participantId: string | null;
  fullName: string;
  departmentUnit: string;
  employeeCode: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  correctAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  score: number;
  maxPossibleScore: number;
  isPassed: boolean | null;
  durationMs: number;
  usedAttempts: number;
  allowedAttempts: number;
  retakeGrantedCount: number;
  officialAttemptId: string | null;
  officialAttemptNumber: number | null;
  finishedAt: string | null;
  attemptHistory: PersistedParticipantAttemptRecord[];
}

export interface GameScoreboardSummary {
  gameId: string;
  gameTitle: string;
  sessionMode: 'PLAY' | 'EXAM';
  officialAttemptPolicy: 'LATEST_ATTEMPT' | 'HIGHEST_SCORE';
  passThresholdPercent: number;
  answersPublished: boolean;
  totals: {
    totalParticipants: number;
    completedCount: number;
    inProgressCount: number;
    pendingCount: number;
    passedCount: number;
    failedCount: number;
  };
  top3: ScoreboardParticipantEntry[];
  entries: ScoreboardParticipantEntry[];
  allEntries: ScoreboardParticipantEntry[];
  totalFiltered: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  departments: string[];
}

export const persistenceRepo = new PersistenceRepository();
