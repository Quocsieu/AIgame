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
          difficulty, source_reference_json, crossword_clue, crossword_answer
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          q.crosswordAnswer ?? null
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
}

export const persistenceRepo = new PersistenceRepository();
