import { roomStore } from '../multiplayer/room.store.js';
import { getDatabase } from '../storage/sqlite.db.js';

export interface MultiplayerRoomAnalyticsItem {
  roomId: string;
  roomCode: string;
  gameId: string;
  gameTitle: string;
  gameType: string;
  scoringMode: string;
  state?: string;
  playerCount: number;
  totalQuestions: number;
  topScore: number;
  averageScore: number | null;
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

export interface OwnedGameAnalyticsItem {
  gameId: string;
  gameTitle: string;
  gameType: string;
  isPublic: boolean;
  questionCount: number;
  createdAt: string;
  totalPlaysCount: number;
  completedPlaysCount: number;
  inProgressPlaysCount: number;
  abandonedPlaysCount: number;
  sessionsCount: number;
  personalSessionsCount: number;
  publicSessionsCount: number;
  multiplayerRoomsCount: number;
  multiplayerPlayersCount: number;
  questionsAnswered: number;
  correctAnswers: number;
  accuracyPercent: number | null;
  averageScore: number | null;
  bestScore: number;
  lastPlayedAt: string;
}

export interface LearningAnalyticsSummary {
  scope: {
    userId: string | null;
    from: string | null;
    to: string | null;
    tzOffsetMinutes: number;
  };
  hasData: boolean;
  hasPlayData: boolean;
  overview: {
    totalGamesCreated: number;
    totalPlaysCount: number;
    completedPlaysCount: number;
    inProgressPlaysCount: number;
    abandonedPlaysCount: number;
    completionRatePercent: number | null;
    soloCompletionRatePercent: number | null;
    multiplayerCompletionRatePercent: number | null;
    soloAverageScore: number | null;
    multiplayerAverageScore: number | null;
    totalPracticeSessions: number;
    completedPracticeSessions: number;
    inProgressPracticeSessions: number;
    abandonedPracticeSessions: number;
    personalPracticeSessions: number;
    creatorGamePracticeSessions: number;
    totalMultiplayerRooms: number;
    completedMultiplayerRooms: number;
    inProgressMultiplayerRooms: number;
    abandonedMultiplayerRooms: number;
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
    totalPlaysCount: number;
    completedPlaysCount: number;
    inProgressPlaysCount: number;
    abandonedPlaysCount: number;
    sessionsCount: number;
    soloSessionsCount: number;
    multiplayerRoomsCount: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number | null;
    totalDurationMs: number;
  }>;
  byGameType: Array<{
    gameType: string;
    totalPlaysCount: number;
    completedPlaysCount: number;
    sessionsCount: number;
    multiplayerRoomsCount?: number;
    questionsAnswered: number;
    correctAnswers: number;
    accuracyPercent: number | null;
    averageScore: number | null;
  }>;
  byGameTopic: OwnedGameAnalyticsItem[];
  ownedGames: OwnedGameAnalyticsItem[];
  recentMultiplayerRooms: MultiplayerRoomAnalyticsItem[];
}

export class AnalyticsService {
  /**
   * Computes factual creator & game usage statistics scoped strictly to the account's owned games
   * (or anonymous demo records when unauthenticated).
   * Explicitly separates hasData=false / null averages from 0 score/accuracy,
   * distinguishes FINISHED vs IN_PROGRESS vs ABANDONED sessions, and prevents duplicate counting.
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

    // 1. Owned games scope (always scoped strictly to current account's owned games)
    const ownedGamesWhereSql = userId ? 'WHERE owner_user_id = ?' : 'WHERE owner_user_id IS NULL';
    const ownedGamesParams: any[] = userId ? [userId] : [];

    const ownedGameRows = db
      .prepare(
        `SELECT
          g.game_id,
          g.title,
          g.game_type,
          g.is_public,
          g.settings_json,
          g.created_at,
          g.updated_at,
          (SELECT COUNT(*) FROM game_questions gq WHERE gq.game_id = g.game_id) as question_count
        FROM games g
        ${ownedGamesWhereSql}
        ORDER BY g.created_at DESC`
      )
      .all(...ownedGamesParams) as Record<string, any>[];

    const totalGamesCreated = ownedGameRows.length;
    const ownedGameIdSet = new Set<string>(ownedGameRows.map(r => String(r.game_id)));

    // 2. Scope for sessions and multiplayer rooms belonging to this account's games
    // Strictly excludes any game owned by another user so two accounts never mix statistics.
    const activityScopeCondition = userId
      ? `(game_id IN (SELECT game_id FROM games WHERE owner_user_id = ?) OR (owner_user_id = ? AND game_id NOT IN (SELECT game_id FROM games WHERE owner_user_id IS NOT NULL AND owner_user_id != ?)))`
      : `(owner_user_id IS NULL AND game_id NOT IN (SELECT game_id FROM games WHERE owner_user_id IS NOT NULL))`;
    const activityScopeParams: any[] = userId ? [userId, userId, userId] : [];

    const allSessionsWhere: string[] = [activityScopeCondition];
    const allSessionsParams: any[] = [...activityScopeParams];

    const roomWhere: string[] = [activityScopeCondition];
    const roomParams: any[] = [...activityScopeParams];

    if (options.from) {
      allSessionsWhere.push('COALESCE(finished_at, started_at, created_at) >= ?');
      allSessionsParams.push(options.from);
      roomWhere.push('COALESCE(finished_at, started_at, created_at) >= ?');
      roomParams.push(options.from);
    }

    if (options.to) {
      allSessionsWhere.push('COALESCE(finished_at, started_at, created_at) <= ?');
      allSessionsParams.push(options.to);
      roomWhere.push('COALESCE(finished_at, started_at, created_at) <= ?');
      roomParams.push(options.to);
    }

    const allSessionsWhereSql = `WHERE ${allSessionsWhere.join(' AND ')}`;
    const roomWhereSql = `WHERE ${roomWhere.join(' AND ')}`;

    // 3. Fetch all solo sessions in scope (FINISHED, IN_PROGRESS, ABANDONED)
    const sessionRows = db
      .prepare(
        `SELECT
          session_id, game_id, owner_user_id, game_title, game_type, scoring_mode,
          state, total_questions, answered_questions, correct_answers, wrong_answers,
          total_score, max_possible_score, max_streak, duration_ms,
          started_at, finished_at, created_at
        FROM practice_sessions
        ${allSessionsWhereSql}
        ORDER BY COALESCE(finished_at, started_at, created_at) DESC`
      )
      .all(...allSessionsParams) as Record<string, any>[];

    // 4. Fetch persisted multiplayer rooms in scope
    const roomRows = db
      .prepare(
        `SELECT
          room_id, room_code, game_id, owner_user_id, game_title, game_type,
          scoring_mode, state, player_count, total_questions, leaderboard_json,
          started_at, finished_at, created_at
        FROM room_history
        ${roomWhereSql}
        ORDER BY COALESCE(finished_at, started_at, created_at) DESC`
      )
      .all(...roomParams) as Record<string, any>[];

    const persistedRoomIds = new Set<string>(roomRows.map(r => String(r.room_id)));

    // Also inspect active/closed rooms in memory (deduplicated against persistedRoomIds)
    const memoryRooms = roomStore.getAll().filter(rm => {
      if (persistedRoomIds.has(rm.roomId)) return false;
      const belongsToAccount = userId
        ? ownedGameIdSet.has(rm.gameId) || rm.ownerUserId === userId
        : !rm.ownerUserId && (ownedGameIdSet.size === 0 || ownedGameIdSet.has(rm.gameId));
      if (!belongsToAccount) return false;
      const createdIso = rm.startedAtIso || new Date(rm.createdAt).toISOString();
      if (options.from && createdIso < options.from) return false;
      if (options.to && createdIso > options.to) return false;
      return true;
    });

    let completedMultiplayerRooms = 0;
    let inProgressMultiplayerRooms = 0;
    let abandonedMultiplayerRooms = 0;
    let multiplayerPlayersCount = 0;
    let multiplayerTotalCorrectAnswers = 0;
    let multiplayerTotalScoreEarned = 0;
    let multiplayerBestStreak = 0;
    let multiplayerValidScoreEntriesCount = 0;

    const parsedRooms: MultiplayerRoomAnalyticsItem[] = [];

    for (const row of roomRows) {
      const rmState = String(row.state || 'FINISHED');
      let rawLb: any[] = [];
      try {
        rawLb = JSON.parse(String(row.leaderboard_json || '[]'));
        if (!Array.isArray(rawLb)) rawLb = [];
      } catch {
        rawLb = [];
      }

      const safeLb = rawLb
        .filter(entry => entry && Number.isFinite(Number(entry.score)) && Number(entry.score) >= 0)
        .map((entry, idx) => ({
          rank: Number(entry?.rank || idx + 1),
          displayName: String(entry?.displayName || `Người chơi ${idx + 1}`),
          score: Number(entry.score),
          correctCount: Math.max(0, Number(entry?.correctCount || 0)),
          streak: Math.max(0, Number(entry?.streak || 0)),
        }));

      const roomPlayers = Math.max(Number(row.player_count || 0), safeLb.length);
      const roomTopScore = safeLb.reduce((max, e) => Math.max(max, e.score), 0);
      const roomSumScore = safeLb.reduce((sum, e) => sum + e.score, 0);
      const roomAvgScore = safeLb.length > 0 ? Math.round(roomSumScore / safeLb.length) : null;
      const roomSumCorrect = safeLb.reduce((sum, e) => sum + e.correctCount, 0);
      const roomMaxStreak = safeLb.reduce((max, e) => Math.max(max, e.streak), 0);

      if (rmState === 'FINISHED') {
        completedMultiplayerRooms += 1;
        multiplayerPlayersCount += roomPlayers;
        multiplayerTotalCorrectAnswers += roomSumCorrect;
        multiplayerTotalScoreEarned += roomSumScore;
        multiplayerValidScoreEntriesCount += safeLb.length;
        if (roomMaxStreak > multiplayerBestStreak) {
          multiplayerBestStreak = roomMaxStreak;
        }
      } else if (rmState === 'CLOSED' || rmState === 'ABANDONED') {
        abandonedMultiplayerRooms += 1;
      } else {
        inProgressMultiplayerRooms += 1;
      }

      parsedRooms.push({
        roomId: String(row.room_id),
        roomCode: String(row.room_code),
        gameId: String(row.game_id),
        gameTitle: String(row.game_title),
        gameType: String(row.game_type),
        scoringMode: String(row.scoring_mode || 'STANDARD'),
        state: rmState,
        playerCount: roomPlayers,
        totalQuestions: Number(row.total_questions || 0),
        topScore: roomTopScore,
        averageScore: roomAvgScore,
        totalScoreEarned: roomSumScore,
        totalCorrectAnswers: roomSumCorrect,
        bestStreak: roomMaxStreak,
        startedAt: row.started_at ? String(row.started_at) : null,
        finishedAt: row.finished_at ? String(row.finished_at) : null,
        createdAt: String(row.created_at),
        leaderboard: safeLb,
      });
    }

    for (const memRoom of memoryRooms) {
      if (memRoom.state === 'FINISHED') {
        completedMultiplayerRooms += 1;
      } else if (memRoom.state === 'CLOSED') {
        abandonedMultiplayerRooms += 1;
      } else {
        inProgressMultiplayerRooms += 1;
      }
    }

    // 5. Aggregate solo sessions by state and compute valid scores
    let completedPracticeSessions = 0;
    let inProgressPracticeSessions = 0;
    let abandonedPracticeSessions = 0;
    let personalPracticeSessions = 0;
    let creatorGamePracticeSessions = 0;
    let totalQuestionsAnswered = 0;
    let totalCorrectAnswers = 0;
    let totalWrongAnswers = 0;
    let soloTotalScoreEarned = 0;
    let soloValidScoreSum = 0;
    let soloValidScoreCount = 0;
    let soloBestStreak = 0;
    let totalPracticeDurationMs = 0;

    for (const sRow of sessionRows) {
      const sState = String(sRow.state || 'IN_PROGRESS');
      if (sState === 'FINISHED') {
        completedPracticeSessions += 1;
        const isPersonal = userId ? sRow.owner_user_id === userId : sRow.owner_user_id === null;
        if (isPersonal) {
          personalPracticeSessions += 1;
        } else {
          creatorGamePracticeSessions += 1;
        }

        const qAnswered = Math.max(0, Number(sRow.answered_questions || 0));
        const qCorrect = Math.max(0, Number(sRow.correct_answers || 0));
        const qWrong = Math.max(0, Number(sRow.wrong_answers || 0));
        const rawScore = sRow.total_score;
        const numericScore = Number(rawScore);
        const totalQs = Number(sRow.total_questions || 0);
        const streak = Math.max(0, Number(sRow.max_streak || 0));
        const dur = Math.max(0, Number(sRow.duration_ms || 0));

        totalQuestionsAnswered += qAnswered;
        totalCorrectAnswers += qCorrect;
        totalWrongAnswers += qWrong;
        totalPracticeDurationMs += dur;
        if (streak > soloBestStreak) {
          soloBestStreak = streak;
        }

        if (rawScore !== null && rawScore !== undefined && Number.isFinite(numericScore) && numericScore >= 0 && totalQs > 0) {
          soloTotalScoreEarned += numericScore;
          soloValidScoreSum += numericScore;
          soloValidScoreCount += 1;
        }
      } else if (sState === 'ABANDONED') {
        abandonedPracticeSessions += 1;
      } else {
        inProgressPracticeSessions += 1;
      }
    }

    const totalPracticeSessions =
      completedPracticeSessions + inProgressPracticeSessions + abandonedPracticeSessions;
    const totalMultiplayerRooms =
      completedMultiplayerRooms + inProgressMultiplayerRooms + abandonedMultiplayerRooms;
    const totalPlaysCount = totalPracticeSessions + totalMultiplayerRooms;
    const completedPlaysCount = completedPracticeSessions + completedMultiplayerRooms;
    const inProgressPlaysCount = inProgressPracticeSessions + inProgressMultiplayerRooms;
    const abandonedPlaysCount = abandonedPracticeSessions + abandonedMultiplayerRooms;

    const totalScoreEarned = soloTotalScoreEarned + multiplayerTotalScoreEarned;
    const bestStreak = Math.max(soloBestStreak, multiplayerBestStreak);

    const hasPlayData = totalPlaysCount > 0;
    const hasData = totalGamesCreated > 0 || totalPlaysCount > 0;

    const overallAccuracyPercent =
      totalQuestionsAnswered > 0
        ? Math.round((totalCorrectAnswers / totalQuestionsAnswered) * 100)
        : null;

    const totalValidScoreEntries = soloValidScoreCount + multiplayerValidScoreEntriesCount;
    const averageScorePerSession =
      totalValidScoreEntries > 0
        ? Math.round((soloValidScoreSum + multiplayerTotalScoreEarned) / totalValidScoreEntries)
        : null;

    const completionRatePercent =
      totalPlaysCount > 0 ? Math.round((completedPlaysCount / totalPlaysCount) * 100) : null;
    const soloCompletionRatePercent =
      totalPracticeSessions > 0
        ? Math.round((completedPracticeSessions / totalPracticeSessions) * 100)
        : null;
    const multiplayerCompletionRatePercent =
      totalMultiplayerRooms > 0
        ? Math.round((completedMultiplayerRooms / totalMultiplayerRooms) * 100)
        : null;
    const soloAverageScore =
      soloValidScoreCount > 0 ? Math.round(soloValidScoreSum / soloValidScoreCount) : null;
    const multiplayerAverageScore =
      multiplayerValidScoreEntriesCount > 0
        ? Math.round(multiplayerTotalScoreEarned / multiplayerValidScoreEntriesCount)
        : null;

    // 6. Daily activity chart series (progressOverTime) combining solo & multiplayer plays by local date
    const toLocalDateBucket = (isoStr: string | null | undefined): string => {
      const raw = isoStr ? Date.parse(isoStr) : NaN;
      if (!Number.isFinite(raw)) return 'N/A';
      const shifted = new Date(raw + tzOffsetMinutes * 60_000);
      return shifted.toISOString().slice(0, 10);
    };

    const dailyMap = new Map<
      string,
      {
        date: string;
        totalPlaysCount: number;
        completedPlaysCount: number;
        inProgressPlaysCount: number;
        abandonedPlaysCount: number;
        soloSessionsCount: number;
        multiplayerRoomsCount: number;
        questionsAnswered: number;
        correctAnswers: number;
        validScoreSum: number;
        validScoreCount: number;
        totalDurationMs: number;
      }
    >();

    const ensureDayBucket = (dateKey: string) => {
      let bucket = dailyMap.get(dateKey);
      if (!bucket) {
        bucket = {
          date: dateKey,
          totalPlaysCount: 0,
          completedPlaysCount: 0,
          inProgressPlaysCount: 0,
          abandonedPlaysCount: 0,
          soloSessionsCount: 0,
          multiplayerRoomsCount: 0,
          questionsAnswered: 0,
          correctAnswers: 0,
          validScoreSum: 0,
          validScoreCount: 0,
          totalDurationMs: 0,
        };
        dailyMap.set(dateKey, bucket);
      }
      return bucket;
    };

    for (const sRow of sessionRows) {
      const dateKey = toLocalDateBucket(
        (sRow.finished_at as string) || (sRow.started_at as string) || (sRow.created_at as string)
      );
      if (dateKey === 'N/A') continue;
      const bucket = ensureDayBucket(dateKey);
      const sState = String(sRow.state || 'IN_PROGRESS');
      bucket.totalPlaysCount += 1;
      bucket.soloSessionsCount += 1;

      if (sState === 'FINISHED') {
        bucket.completedPlaysCount += 1;
        bucket.questionsAnswered += Math.max(0, Number(sRow.answered_questions || 0));
        bucket.correctAnswers += Math.max(0, Number(sRow.correct_answers || 0));
        bucket.totalDurationMs += Math.max(0, Number(sRow.duration_ms || 0));
        const numericScore = Number(sRow.total_score);
        if (
          sRow.total_score !== null &&
          sRow.total_score !== undefined &&
          Number.isFinite(numericScore) &&
          numericScore >= 0 &&
          Number(sRow.total_questions || 0) > 0
        ) {
          bucket.validScoreSum += numericScore;
          bucket.validScoreCount += 1;
        }
      } else if (sState === 'ABANDONED') {
        bucket.abandonedPlaysCount += 1;
      } else {
        bucket.inProgressPlaysCount += 1;
      }
    }

    for (const rm of parsedRooms) {
      const dateKey = toLocalDateBucket(rm.finishedAt || rm.startedAt || rm.createdAt);
      if (dateKey === 'N/A') continue;
      const bucket = ensureDayBucket(dateKey);
      bucket.totalPlaysCount += 1;
      bucket.multiplayerRoomsCount += 1;

      if (rm.state === 'FINISHED') {
        bucket.completedPlaysCount += 1;
        bucket.correctAnswers += rm.totalCorrectAnswers;
        if (rm.leaderboard.length > 0) {
          bucket.validScoreSum += rm.totalScoreEarned;
          bucket.validScoreCount += rm.leaderboard.length;
        }
      } else if (rm.state === 'CLOSED' || rm.state === 'ABANDONED') {
        bucket.abandonedPlaysCount += 1;
      } else {
        bucket.inProgressPlaysCount += 1;
      }
    }

    for (const memRoom of memoryRooms) {
      const dateKey = toLocalDateBucket(memRoom.startedAtIso || new Date(memRoom.createdAt).toISOString());
      if (dateKey === 'N/A') continue;
      const bucket = ensureDayBucket(dateKey);
      bucket.totalPlaysCount += 1;
      bucket.multiplayerRoomsCount += 1;
      if (memRoom.state === 'FINISHED') {
        bucket.completedPlaysCount += 1;
      } else if (memRoom.state === 'CLOSED') {
        bucket.abandonedPlaysCount += 1;
      } else {
        bucket.inProgressPlaysCount += 1;
      }
    }

    const progressOverTime = Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-365)
      .map(b => ({
        date: b.date,
        totalPlaysCount: b.totalPlaysCount,
        completedPlaysCount: b.completedPlaysCount,
        inProgressPlaysCount: b.inProgressPlaysCount,
        abandonedPlaysCount: b.abandonedPlaysCount,
        sessionsCount: b.completedPlaysCount,
        soloSessionsCount: b.soloSessionsCount,
        multiplayerRoomsCount: b.multiplayerRoomsCount,
        questionsAnswered: b.questionsAnswered,
        correctAnswers: b.correctAnswers,
        accuracyPercent:
          b.questionsAnswered > 0 ? Math.round((b.correctAnswers / b.questionsAnswered) * 100) : null,
        averageScore:
          b.validScoreCount > 0 ? Math.round(b.validScoreSum / b.validScoreCount) : 0,
        totalDurationMs: b.totalDurationMs,
      }));

    // 7. Breakdown by gameType
    const byTypeMap = new Map<
      string,
      {
        gameType: string;
        totalPlaysCount: number;
        completedPlaysCount: number;
        sessionsCount: number;
        multiplayerRoomsCount: number;
        questionsAnswered: number;
        correctAnswers: number;
        validScoreSum: number;
        validScoreCount: number;
      }
    >();

    const ensureTypeEntry = (gt: string) => {
      let entry = byTypeMap.get(gt);
      if (!entry) {
        entry = {
          gameType: gt,
          totalPlaysCount: 0,
          completedPlaysCount: 0,
          sessionsCount: 0,
          multiplayerRoomsCount: 0,
          questionsAnswered: 0,
          correctAnswers: 0,
          validScoreSum: 0,
          validScoreCount: 0,
        };
        byTypeMap.set(gt, entry);
      }
      return entry;
    };

    for (const sRow of sessionRows) {
      const gt = String(sRow.game_type);
      const entry = ensureTypeEntry(gt);
      const sState = String(sRow.state || 'IN_PROGRESS');
      entry.totalPlaysCount += 1;
      if (sState === 'FINISHED') {
        entry.completedPlaysCount += 1;
        entry.sessionsCount += 1;
        entry.questionsAnswered += Math.max(0, Number(sRow.answered_questions || 0));
        entry.correctAnswers += Math.max(0, Number(sRow.correct_answers || 0));
        const numericScore = Number(sRow.total_score);
        if (
          sRow.total_score !== null &&
          sRow.total_score !== undefined &&
          Number.isFinite(numericScore) &&
          numericScore >= 0 &&
          Number(sRow.total_questions || 0) > 0
        ) {
          entry.validScoreSum += numericScore;
          entry.validScoreCount += 1;
        }
      }
    }

    for (const rm of parsedRooms) {
      const entry = ensureTypeEntry(rm.gameType);
      entry.totalPlaysCount += 1;
      if (rm.state === 'FINISHED') {
        entry.completedPlaysCount += 1;
        entry.multiplayerRoomsCount += 1;
        entry.correctAnswers += rm.totalCorrectAnswers;
        if (rm.leaderboard.length > 0) {
          entry.validScoreSum += rm.totalScoreEarned;
          entry.validScoreCount += rm.leaderboard.length;
        }
      }
    }

    // 8. Breakdown by Owned Game ("Game nổi bật" — includes games with 0 plays, sorted by totalPlaysCount DESC)
    const gameStatsMap = new Map<
      string,
      OwnedGameAnalyticsItem & {
        validScoreSum: number;
        validScoreCount: number;
      }
    >();

    for (const gRow of ownedGameRows) {
      const gid = String(gRow.game_id);
      let qCount = Number(gRow.question_count || 0);
      if (qCount === 0 && gRow.settings_json) {
        try {
          const parsedSettings = JSON.parse(String(gRow.settings_json));
          qCount = Number(parsedSettings?.questionCount || 0);
        } catch {
          // ignore
        }
      }

      gameStatsMap.set(gid, {
        gameId: gid,
        gameTitle: String(gRow.title),
        gameType: String(gRow.game_type),
        isPublic: Number(gRow.is_public) === 1,
        questionCount: qCount,
        createdAt: String(gRow.created_at || ''),
        totalPlaysCount: 0,
        completedPlaysCount: 0,
        inProgressPlaysCount: 0,
        abandonedPlaysCount: 0,
        sessionsCount: 0,
        personalSessionsCount: 0,
        publicSessionsCount: 0,
        multiplayerRoomsCount: 0,
        multiplayerPlayersCount: 0,
        questionsAnswered: 0,
        correctAnswers: 0,
        accuracyPercent: null,
        averageScore: null,
        bestScore: 0,
        lastPlayedAt: '',
        validScoreSum: 0,
        validScoreCount: 0,
      });
    }

    const ensureGameEntry = (gid: string, title: string, gameType: string, createdAt: string) => {
      let item = gameStatsMap.get(gid);
      if (!item) {
        item = {
          gameId: gid,
          gameTitle: title,
          gameType,
          isPublic: false,
          questionCount: 0,
          createdAt,
          totalPlaysCount: 0,
          completedPlaysCount: 0,
          inProgressPlaysCount: 0,
          abandonedPlaysCount: 0,
          sessionsCount: 0,
          personalSessionsCount: 0,
          publicSessionsCount: 0,
          multiplayerRoomsCount: 0,
          multiplayerPlayersCount: 0,
          questionsAnswered: 0,
          correctAnswers: 0,
          accuracyPercent: null,
          averageScore: null,
          bestScore: 0,
          lastPlayedAt: '',
          validScoreSum: 0,
          validScoreCount: 0,
        };
        gameStatsMap.set(gid, item);
      }
      return item;
    };

    for (const sRow of sessionRows) {
      const gid = String(sRow.game_id);
      const playedAt = String(sRow.finished_at || sRow.started_at || sRow.created_at || '');
      const item = ensureGameEntry(
        gid,
        String(sRow.game_title),
        String(sRow.game_type),
        String(sRow.created_at || '')
      );
      const sState = String(sRow.state || 'IN_PROGRESS');

      item.totalPlaysCount += 1;
      if (playedAt > item.lastPlayedAt) {
        item.lastPlayedAt = playedAt;
      }

      if (sState === 'FINISHED') {
        item.completedPlaysCount += 1;
        item.sessionsCount += 1;
        const isPersonal = userId ? sRow.owner_user_id === userId : sRow.owner_user_id === null;
        if (isPersonal) {
          item.personalSessionsCount += 1;
        } else {
          item.publicSessionsCount += 1;
        }

        const qAnswered = Math.max(0, Number(sRow.answered_questions || 0));
        const qCorrect = Math.max(0, Number(sRow.correct_answers || 0));
        item.questionsAnswered += qAnswered;
        item.correctAnswers += qCorrect;

        const numericScore = Number(sRow.total_score);
        if (
          sRow.total_score !== null &&
          sRow.total_score !== undefined &&
          Number.isFinite(numericScore) &&
          numericScore >= 0 &&
          Number(sRow.total_questions || 0) > 0
        ) {
          item.validScoreSum += numericScore;
          item.validScoreCount += 1;
          if (numericScore > item.bestScore) {
            item.bestScore = numericScore;
          }
        }
      } else if (sState === 'ABANDONED') {
        item.abandonedPlaysCount += 1;
      } else {
        item.inProgressPlaysCount += 1;
      }
    }

    for (const rm of parsedRooms) {
      const roomPlayedAt = rm.finishedAt || rm.startedAt || rm.createdAt;
      const item = ensureGameEntry(rm.gameId, rm.gameTitle, rm.gameType, rm.createdAt);
      item.totalPlaysCount += 1;
      if (roomPlayedAt > item.lastPlayedAt) {
        item.lastPlayedAt = roomPlayedAt;
      }

      if (rm.state === 'FINISHED') {
        item.completedPlaysCount += 1;
        item.multiplayerRoomsCount += 1;
        item.multiplayerPlayersCount += rm.playerCount;
        item.correctAnswers += rm.totalCorrectAnswers;
        if (rm.topScore > item.bestScore) {
          item.bestScore = rm.topScore;
        }
        if (rm.leaderboard.length > 0) {
          item.validScoreSum += rm.totalScoreEarned;
          item.validScoreCount += rm.leaderboard.length;
        }
      } else if (rm.state === 'CLOSED' || rm.state === 'ABANDONED') {
        item.abandonedPlaysCount += 1;
      } else {
        item.inProgressPlaysCount += 1;
      }
    }

    for (const memRoom of memoryRooms) {
      const item = ensureGameEntry(
        memRoom.gameId,
        memRoom.gameSpecification.title,
        memRoom.gameSpecification.gameType,
        new Date(memRoom.createdAt).toISOString()
      );
      item.totalPlaysCount += 1;
      if (memRoom.state === 'FINISHED') {
        item.completedPlaysCount += 1;
      } else if (memRoom.state === 'CLOSED') {
        item.abandonedPlaysCount += 1;
      } else {
        item.inProgressPlaysCount += 1;
      }
    }

    const ownedGamesList: OwnedGameAnalyticsItem[] = Array.from(gameStatsMap.values())
      .map(({ validScoreSum, validScoreCount, ...rest }) => ({
        ...rest,
        accuracyPercent:
          rest.questionsAnswered > 0
            ? Math.round((rest.correctAnswers / rest.questionsAnswered) * 100)
            : null,
        averageScore:
          validScoreCount > 0 ? Math.round(validScoreSum / validScoreCount) : null,
      }))
      .sort((a, b) => {
        if (b.totalPlaysCount !== a.totalPlaysCount) {
          return b.totalPlaysCount - a.totalPlaysCount;
        }
        if (b.completedPlaysCount !== a.completedPlaysCount) {
          return b.completedPlaysCount - a.completedPlaysCount;
        }
        if (b.lastPlayedAt !== a.lastPlayedAt) {
          return b.lastPlayedAt.localeCompare(a.lastPlayedAt);
        }
        return b.createdAt.localeCompare(a.createdAt);
      });

    return {
      scope: {
        userId,
        from: options.from || null,
        to: options.to || null,
        tzOffsetMinutes,
      },
      hasData,
      hasPlayData,
      overview: {
        totalGamesCreated,
        totalPlaysCount,
        completedPlaysCount,
        inProgressPlaysCount,
        abandonedPlaysCount,
        completionRatePercent,
        soloCompletionRatePercent,
        multiplayerCompletionRatePercent,
        soloAverageScore,
        multiplayerAverageScore,
        totalPracticeSessions,
        completedPracticeSessions,
        inProgressPracticeSessions,
        abandonedPracticeSessions,
        personalPracticeSessions,
        creatorGamePracticeSessions,
        totalMultiplayerRooms,
        completedMultiplayerRooms,
        inProgressMultiplayerRooms,
        abandonedMultiplayerRooms,
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
      progressOverTime,
      byGameType: Array.from(byTypeMap.values()).map(t => ({
        gameType: t.gameType,
        totalPlaysCount: t.totalPlaysCount,
        completedPlaysCount: t.completedPlaysCount,
        sessionsCount: t.sessionsCount,
        multiplayerRoomsCount: t.multiplayerRoomsCount,
        questionsAnswered: t.questionsAnswered,
        correctAnswers: t.correctAnswers,
        accuracyPercent:
          t.questionsAnswered > 0 ? Math.round((t.correctAnswers / t.questionsAnswered) * 100) : null,
        averageScore:
          t.validScoreCount > 0 ? Math.round(t.validScoreSum / t.validScoreCount) : 0,
      })),
      byGameTopic: ownedGamesList.slice(0, 30),
      ownedGames: ownedGamesList,
      recentMultiplayerRooms: parsedRooms.slice(0, 20),
    };
  }
}

export const analyticsService = new AnalyticsService();
