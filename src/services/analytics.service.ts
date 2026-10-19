import { getDatabase } from '../storage/sqlite.db.js';

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
    completedMultiplayerRooms: number;
    totalQuestionsAnswered: number;
    totalCorrectAnswers: number;
    totalWrongAnswers: number;
    overallAccuracyPercent: number | null;
    totalScoreEarned: number;
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
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    bestScore: number;
    lastPlayedAt: string;
  }>;
}

export class AnalyticsService {
  /**
   * Computes factual learning analytics strictly scoped to the user's owned records
   * (or anonymous demo records when unauthenticated).
   * Explicitly separates hasData=false / null percentages from 0% accuracy.
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
      sessionWhere.push('owner_user_id = ?');
      sessionParams.push(userId);
      gameWhere.push('owner_user_id = ?');
      gameParams.push(userId);
      roomWhere.push('owner_user_id = ?');
      roomParams.push(userId);
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

    const roomsCountRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM room_history ${roomWhereSql}`)
      .get(...roomParams) as { cnt: number };

    const aggRow = db
      .prepare(
        `SELECT
          COUNT(*) as completed_sessions,
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
      .get(...sessionParams) as Record<string, any>;

    const completedPracticeSessions = Number(aggRow?.completed_sessions || 0);
    const completedMultiplayerRooms = Number(roomsCountRow?.cnt || 0);
    const totalGamesCreated = Number(gamesCountRow?.cnt || 0);
    const totalQuestionsAnswered = Number(aggRow?.sum_answered || 0);
    const totalCorrectAnswers = Number(aggRow?.sum_correct || 0);
    const totalWrongAnswers = Number(aggRow?.sum_wrong || 0);
    const totalScoreEarned = Number(aggRow?.sum_score || 0);
    const bestStreak = Number(aggRow?.best_streak || 0);
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

    const byTopicRows = db
      .prepare(
        `SELECT
          game_id,
          game_title,
          game_type,
          COUNT(*) as sessions_count,
          SUM(answered_questions) as sum_answered,
          SUM(correct_answers) as sum_correct,
          MAX(total_score) as best_score,
          MAX(COALESCE(finished_at, created_at)) as last_played_at
        FROM practice_sessions
        ${sessionWhereSql}
        GROUP BY game_id, game_title, game_type
        ORDER BY last_played_at DESC
        LIMIT 15`
      )
      .all(...sessionParams) as Record<string, any>[];

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
        completedMultiplayerRooms,
        totalQuestionsAnswered,
        totalCorrectAnswers,
        totalWrongAnswers,
        overallAccuracyPercent,
        totalScoreEarned,
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
      byGameType: byTypeRows.map(r => {
        const answered = Number(r.sum_answered || 0);
        const correct = Number(r.sum_correct || 0);
        return {
          gameType: String(r.game_type),
          sessionsCount: Number(r.sessions_count || 0),
          questionsAnswered: answered,
          correctAnswers: correct,
          accuracyPercent: answered > 0 ? Math.round((correct / answered) * 100) : null,
          averageScore: Math.round(Number(r.avg_score || 0)),
        };
      }),
      byGameTopic: byTopicRows.map(r => {
        const answered = Number(r.sum_answered || 0);
        const correct = Number(r.sum_correct || 0);
        return {
          gameId: String(r.game_id),
          gameTitle: String(r.game_title),
          gameType: String(r.game_type),
          sessionsCount: Number(r.sessions_count || 0),
          questionsAnswered: answered,
          correctAnswers: correct,
          accuracyPercent: answered > 0 ? Math.round((correct / answered) * 100) : null,
          bestScore: Number(r.best_score || 0),
          lastPlayedAt: String(r.last_played_at || ''),
        };
      }),
    };
  }
}

export const analyticsService = new AnalyticsService();

