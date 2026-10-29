import { getDatabase } from '../storage/sqlite.db.js';

export interface MultiplayerRoomAnalyticsItem {
  roomId: string;
  roomCode: string;
  gameId: string;
  gameTitle: string;
  gameType: string;
  scoringMode: string;
  playerCount: number;
  totalQuestions: number;
  topScore: number;
  totalScoreEarned: number;
  totalCorrectAnswers: number;
  bestStreak: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  leaderboard: Array<{
    rank: number;
    displayName: string;
    score: number;
    correctCount: number;
    streak: number;
  }>;
}

export interface LearningAnalyticsSummary {
  scope: {
    userId: string | null;
    from: string | null;
    to: string | null;
    tzOffsetMinutes: number;
  };
  hasData: boolean;
  overview: {
    totalGamesCreated: number;
    completedPracticeSessions: number;
    personalPracticeSessions: number;
    creatorGamePracticeSessions: number;
    completedMultiplayerRooms: number;
    multiplayerPlayersCount: number;
    multiplayerTotalCorrectAnswers: number;
    multiplayerTotalScoreEarned: number;
    multiplayerBestStreak: number;
    totalQuestionsAnswered: number;
    totalCorrectAnswers: number;
    totalWrongAnswers: number;
    overallAccuracyPercent: number | null;
    totalScoreEarned: number;
    soloTotalScoreEarned: number;
    averageScorePerSession: number | null;
    bestStreak: number;
    totalPracticeDurationMs: number;
  };
  progressOverTime: Array<{
    date: string;
    sessionsCount: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number;
    totalDurationMs: number;
  }>;
  byGameType: Array<{
    gameType: string;
    sessionsCount: number;
    multiplayerRoomsCount?: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number;
  }>;
  byGameTopic: Array<{
    gameId: string;
    gameTitle: string;
    gameType: string;
    sessionsCount: number;
    personalSessionsCount?: number;
    publicSessionsCount?: number;
    multiplayerRoomsCount?: number;
    multiplayerPlayersCount?: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    bestScore: number;
    lastPlayedAt: string;
  }>;
  recentMultiplayerRooms: MultiplayerRoomAnalyticsItem[];
}

export class AnalyticsService {
  /**
   * Computes factual learning & game usage analytics scoped to the user's personal records
   * and games owned by the user (or anonymous demo records when unauthenticated).
   * Explicitly separates hasData=false / null percentages from 0% accuracy,
   * avoids fabricating unrecorded per-question multiplayer counts, and prevents duplicate counting.
   */
  public getLearningAnalytics(options: {
    userId?: string | null;
    from?: string;
    to?: string;
    tzOffsetMinutes?: number;
  } = {}): LearningAnalyticsSummary {
    const db = getDatabase();
    const userId = options.userId ?? null;
    const tzOffsetMinutes =
      typeof options.tzOffsetMinutes === 'number' &&
      Number.isFinite(options.tzOffsetMinutes) &&
      options.tzOffsetMinutes >= -840 &&
      options.tzOffsetMinutes <= 840
        ? Math.trunc(options.tzOffsetMinutes)
        : 0;

    const sessionWhere: string[] = ["state = 'FINISHED'"];
    const sessionParams: any[] = [];

    const gameWhere: string[] = [];
    const gameParams: any[] = [];

    const roomWhere: string[] = ["state = 'FINISHED'"];
    const roomParams: any[] = [];

    if (userId) {
      // Include personal sessions OR sessions played on games owned by this creator (deduplicated by SQL OR)
      sessionWhere.push(
        '(owner_user_id = ? OR game_id IN (SELECT game_id FROM games WHERE owner_user_id = ?))'
      );
      sessionParams.push(userId, userId);
      gameWhere.push('owner_user_id = ?');
      gameParams.push(userId);
      roomWhere.push(
        '(owner_user_id = ? OR game_id IN (SELECT game_id FROM games WHERE owner_user_id = ?))'
      );
      roomParams.push(userId, userId);
    } else {
      sessionWhere.push('owner_user_id IS NULL');
      gameWhere.push('owner_user_id IS NULL');
      roomWhere.push('owner_user_id IS NULL');
    }

    if (options.from) {
      sessionWhere.push('created_at >= ?');
      sessionParams.push(options.from);
      gameWhere.push('created_at >= ?');
      gameParams.push(options.from);
      roomWhere.push('created_at >= ?');
      roomParams.push(options.from);
    }

    if (options.to) {
      sessionWhere.push('created_at <= ?');
      sessionParams.push(options.to);
      gameWhere.push('created_at <= ?');
      gameParams.push(options.to);
      roomWhere.push('created_at <= ?');
      roomParams.push(options.to);
    }

    const sessionWhereSql = `WHERE ${sessionWhere.join(' AND ')}`;
    const gameWhereSql = `WHERE ${gameWhere.join(' AND ')}`;
    const roomWhereSql = `WHERE ${roomWhere.join(' AND ')}`;

    const gamesCountRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM games ${gameWhereSql}`)
      .get(...gameParams) as { cnt: number };

    // Fetch finished multiplayer rooms in scope
    const roomRows = db
      .prepare(
        `SELECT
          room_id, room_code, game_id, owner_user_id, game_title, game_type,
          scoring_mode, state, player_count, total_questions, leaderboard_json,
          started_at, finished_at, created_at
        FROM room_history
        ${roomWhereSql}
        ORDER BY COALESCE(finished_at, created_at) DESC`
      )
      .all(...roomParams) as Record<string, any>[];

    let multiplayerPlayersCount = 0;
    let multiplayerTotalCorrectAnswers = 0;
    let multiplayerTotalScoreEarned = 0;
    let multiplayerBestStreak = 0;

    const parsedRooms: MultiplayerRoomAnalyticsItem[] = roomRows.map(row => {
      let rawLb: any[] = [];
      try {
        rawLb = JSON.parse(String(row.leaderboard_json || '[]'));
        if (!Array.isArray(rawLb)) rawLb = [];
      } catch {
        rawLb = [];
      }

      const safeLb = rawLb.map((entry, idx) => ({
        rank: Number(entry?.rank || idx + 1),
        displayName: String(entry?.displayName || `Người chơi ${idx + 1}`),
        score: Number(entry?.score || 0),
        correctCount: Number(entry?.correctCount || 0),
        streak: Number(entry?.streak || 0),
      }));

      const roomPlayers = Math.max(Number(row.player_count || 0), safeLb.length);
      const roomTopScore = safeLb.reduce((max, e) => Math.max(max, e.score), 0);
      const roomSumScore = safeLb.reduce((sum, e) => sum + e.score, 0);
      const roomSumCorrect = safeLb.reduce((sum, e) => sum + e.correctCount, 0);
      const roomMaxStreak = safeLb.reduce((max, e) => Math.max(max, e.streak), 0);

      multiplayerPlayersCount += roomPlayers;
      multiplayerTotalCorrectAnswers += roomSumCorrect;
      multiplayerTotalScoreEarned += roomSumScore;
      if (roomMaxStreak > multiplayerBestStreak) {
        multiplayerBestStreak = roomMaxStreak;
      }

      return {
        roomId: String(row.room_id),
        roomCode: String(row.room_code),
        gameId: String(row.game_id),
        gameTitle: String(row.game_title),
        gameType: String(row.game_type),
        scoringMode: String(row.scoring_mode || 'STANDARD'),
        playerCount: roomPlayers,
        totalQuestions: Number(row.total_questions || 0),
        topScore: roomTopScore,
        totalScoreEarned: roomSumScore,
        totalCorrectAnswers: roomSumCorrect,
        bestStreak: roomMaxStreak,
        startedAt: row.started_at ? String(row.started_at) : null,
        finishedAt: row.finished_at ? String(row.finished_at) : null,
        createdAt: String(row.created_at),
        leaderboard: safeLb,
      };
    });

    const aggRow = db
      .prepare(
        `SELECT
          COUNT(*) as completed_sessions,
          SUM(CASE WHEN ${userId ? 'owner_user_id = ?' : 'owner_user_id IS NULL'} THEN 1 ELSE 0 END) as personal_sessions,
          SUM(CASE WHEN ${userId ? '(owner_user_id IS NULL OR owner_user_id != ?)' : '0'} THEN 1 ELSE 0 END) as creator_external_sessions,
          SUM(answered_questions) as sum_answered,
          SUM(correct_answers) as sum_correct,
          SUM(wrong_answers) as sum_wrong,
          SUM(total_score) as sum_score,
          AVG(total_score) as avg_score,
          MAX(max_streak) as best_streak,
          SUM(duration_ms) as sum_duration_ms
        FROM practice_sessions
        ${sessionWhereSql}`
      )
      .get(...(userId ? [userId, userId, ...sessionParams] : sessionParams)) as Record<string, any>;

    const completedPracticeSessions = Number(aggRow?.completed_sessions || 0);
    const personalPracticeSessions = Number(aggRow?.personal_sessions || 0);
    const creatorGamePracticeSessions = Number(aggRow?.creator_external_sessions || 0);
    const completedMultiplayerRooms = parsedRooms.length;
    const totalGamesCreated = Number(gamesCountRow?.cnt || 0);
    const totalQuestionsAnswered = Number(aggRow?.sum_answered || 0);
    const totalCorrectAnswers = Number(aggRow?.sum_correct || 0);
    const totalWrongAnswers = Number(aggRow?.sum_wrong || 0);
    const soloTotalScoreEarned = Number(aggRow?.sum_score || 0);
    const totalScoreEarned = soloTotalScoreEarned + multiplayerTotalScoreEarned;
    const soloBestStreak = Number(aggRow?.best_streak || 0);
    const bestStreak = Math.max(soloBestStreak, multiplayerBestStreak);
    const totalPracticeDurationMs = Number(aggRow?.sum_duration_ms || 0);

    const hasData =
      completedPracticeSessions > 0 || completedMultiplayerRooms > 0 || totalGamesCreated > 0;

    const overallAccuracyPercent =
      totalQuestionsAnswered > 0
        ? Math.round((totalCorrectAnswers / totalQuestionsAnswered) * 100)
        : null;

    const averageScorePerSession =
      completedPracticeSessions > 0 && aggRow?.avg_score !== null
        ? Math.round(Number(aggRow.avg_score))
        : null;

    // SQLite modifier for timezone offset: e.g. '+420 minutes' or '-300 minutes'
    const tzModifier = `${tzOffsetMinutes >= 0 ? '+' : ''}${tzOffsetMinutes} minutes`;

    const progressRows = db
      .prepare(
        `SELECT
          date(COALESCE(finished_at, created_at), ?) as bucket_date,
          COUNT(*) as sessions_count,
          SUM(answered_questions) as sum_answered,
          SUM(correct_answers) as sum_correct,
          AVG(total_score) as avg_score,
          SUM(duration_ms) as sum_duration
        FROM practice_sessions
        ${sessionWhereSql}
        GROUP BY bucket_date
        ORDER BY bucket_date ASC
        LIMIT 60`
      )
      .all(tzModifier, ...sessionParams) as Record<string, any>[];

    const byTypeRows = db
      .prepare(
        `SELECT
          game_type,
          COUNT(*) as sessions_count,
          SUM(answered_questions) as sum_answered,
          SUM(correct_answers) as sum_correct,
          AVG(total_score) as avg_score
        FROM practice_sessions
        ${sessionWhereSql}
        GROUP BY game_type
        ORDER BY sessions_count DESC`
      )
      .all(...sessionParams) as Record<string, any>[];

    const byTypeMap = new Map<
      string,
      {
        gameType: string;
        sessionsCount: number;
        multiplayerRoomsCount: number;
        questionsAnswered: number;
        correctAnswers: number;
        accuracyPercent: number | null;
        averageScore: number;
      }
    >();

    for (const r of byTypeRows) {
      const answered = Number(r.sum_answered || 0);
      const correct = Number(r.sum_correct || 0);
      const gt = String(r.game_type);
      byTypeMap.set(gt, {
        gameType: gt,
        sessionsCount: Number(r.sessions_count || 0),
        multiplayerRoomsCount: 0,
        questionsAnswered: answered,
        correctAnswers: correct,
        accuracyPercent: answered > 0 ? Math.round((correct / answered) * 100) : null,
        averageScore: Math.round(Number(r.avg_score || 0)),
      });
    }

    for (const rm of parsedRooms) {
      const existing = byTypeMap.get(rm.gameType);
      if (existing) {
        existing.multiplayerRoomsCount += 1;
      } else {
        byTypeMap.set(rm.gameType, {
          gameType: rm.gameType,
          sessionsCount: 0,
          multiplayerRoomsCount: 1,
          questionsAnswered: 0,
          correctAnswers: rm.totalCorrectAnswers,
          accuracyPercent: null,
          averageScore: rm.topScore,
        });
      }
    }

    const byTopicRows = db
      .prepare(
        `SELECT
          game_id,
          game_title,
          game_type,
          COUNT(*) as sessions_count,
          SUM(CASE WHEN ${userId ? 'owner_user_id = ?' : 'owner_user_id IS NULL'} THEN 1 ELSE 0 END) as personal_sessions_count,
          SUM(CASE WHEN ${userId ? '(owner_user_id IS NULL OR owner_user_id != ?)' : '0'} THEN 1 ELSE 0 END) as public_sessions_count,
          SUM(answered_questions) as sum_answered,
          SUM(correct_answers) as sum_correct,
          MAX(total_score) as best_score,
          MAX(COALESCE(finished_at, created_at)) as last_played_at
        FROM practice_sessions
        ${sessionWhereSql}
        GROUP BY game_id, game_title, game_type
        ORDER BY last_played_at DESC`
      )
      .all(...(userId ? [userId, userId, ...sessionParams] : sessionParams)) as Record<string, any>[];

    const byTopicMap = new Map<
      string,
      {
        gameId: string;
        gameTitle: string;
        gameType: string;
        sessionsCount: number;
        personalSessionsCount: number;
        publicSessionsCount: number;
        multiplayerRoomsCount: number;
        multiplayerPlayersCount: number;
        questionsAnswered: number;
        correctAnswers: number;
        accuracyPercent: number | null;
        bestScore: number;
        lastPlayedAt: string;
      }
    >();

    for (const r of byTopicRows) {
      const answered = Number(r.sum_answered || 0);
      const correct = Number(r.sum_correct || 0);
      const gid = String(r.game_id);
      byTopicMap.set(gid, {
        gameId: gid,
        gameTitle: String(r.game_title),
        gameType: String(r.game_type),
        sessionsCount: Number(r.sessions_count || 0),
        personalSessionsCount: Number(r.personal_sessions_count || 0),
        publicSessionsCount: Number(r.public_sessions_count || 0),
        multiplayerRoomsCount: 0,
        multiplayerPlayersCount: 0,
        questionsAnswered: answered,
        correctAnswers: correct,
        accuracyPercent: answered > 0 ? Math.round((correct / answered) * 100) : null,
        bestScore: Number(r.best_score || 0),
        lastPlayedAt: String(r.last_played_at || ''),
      });
    }

    for (const rm of parsedRooms) {
      const roomPlayedAt = rm.finishedAt || rm.createdAt;
      const existing = byTopicMap.get(rm.gameId);
      if (existing) {
        existing.multiplayerRoomsCount += 1;
        existing.multiplayerPlayersCount += rm.playerCount;
        existing.bestScore = Math.max(existing.bestScore, rm.topScore);
        if (roomPlayedAt > existing.lastPlayedAt) {
          existing.lastPlayedAt = roomPlayedAt;
        }
      } else {
        byTopicMap.set(rm.gameId, {
          gameId: rm.gameId,
          gameTitle: rm.gameTitle,
          gameType: rm.gameType,
          sessionsCount: 0,
          personalSessionsCount: 0,
          publicSessionsCount: 0,
          multiplayerRoomsCount: 1,
          multiplayerPlayersCount: rm.playerCount,
          questionsAnswered: 0,
          correctAnswers: rm.totalCorrectAnswers,
          accuracyPercent: null,
          bestScore: rm.topScore,
          lastPlayedAt: roomPlayedAt,
        });
      }
    }

    const mergedTopics = Array.from(byTopicMap.values())
      .sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt))
      .slice(0, 15);

    return {
      scope: {
        userId,
        from: options.from || null,
        to: options.to || null,
        tzOffsetMinutes,
      },
      hasData,
      overview: {
        totalGamesCreated,
        completedPracticeSessions,
        personalPracticeSessions,
        creatorGamePracticeSessions,
        completedMultiplayerRooms,
        multiplayerPlayersCount,
        multiplayerTotalCorrectAnswers,
        multiplayerTotalScoreEarned,
        multiplayerBestStreak,
        totalQuestionsAnswered,
        totalCorrectAnswers,
        totalWrongAnswers,
        overallAccuracyPercent,
        totalScoreEarned,
        soloTotalScoreEarned,
        averageScorePerSession,
        bestStreak,
        totalPracticeDurationMs,
      },
      progressOverTime: progressRows.map(r => {
        const answered = Number(r.sum_answered || 0);
        const correct = Number(r.sum_correct || 0);
        return {
          date: String(r.bucket_date || 'N/A'),
          sessionsCount: Number(r.sessions_count || 0),
          questionsAnswered: answered,
          correctAnswers: correct,
          accuracyPercent: answered > 0 ? Math.round((correct / answered) * 100) : null,
          averageScore: Math.round(Number(r.avg_score || 0)),
          totalDurationMs: Number(r.sum_duration || 0),
        };
      }),
      byGameType: Array.from(byTypeMap.values()),
      byGameTopic: mergedTopics,
      recentMultiplayerRooms: parsedRooms.slice(0, 20),
    };
  }
}

export const analyticsService = new AnalyticsService();
