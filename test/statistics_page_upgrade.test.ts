import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app.js';
import { GameSession } from '../src/game/game.session.js';
import { gameStore } from '../src/game/game.store.js';
import { analyticsService } from '../src/services/analytics.service.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { GameSpecification } from '../src/contracts/game.contract.js';

function createTestSpec(overrides: Partial<GameSpecification> = {}): GameSpecification {
  const gameId =
    overrides.gameId || `game_stats_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    gameId,
    title: overrides.title || 'Bộ câu hỏi kiểm thử Thống kê',
    description: overrides.description || 'Mô tả bộ câu hỏi kiểm thử Thống kê',
    gameType: overrides.gameType || 'MULTIPLE_CHOICE',
    ownerUserId: overrides.ownerUserId ?? null,
    isPublic: overrides.isPublic ?? true,
    settings: overrides.settings || {
      questionCount: 2,
      timePerQuestion: 15,
      scoringMode: 'STANDARD',
    },
    questions: overrides.questions || [
      {
        id: 'q1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu hỏi kiểm thử số 1?',
        choices: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'],
        correctAnswer: 'Đáp án A',
        explanation: 'Giải thích câu 1',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_stats_1',
          sourceType: 'FILE',
          sourceLocation: 'stats.txt',
        },
      },
      {
        id: 'q2',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu hỏi kiểm thử số 2?',
        choices: ['Đáp án 1', 'Đáp án 2', 'Đáp án 3', 'Đáp án 4'],
        correctAnswer: 'Đáp án 2',
        explanation: 'Giải thích câu 2',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_stats_1',
          sourceType: 'FILE',
          sourceLocation: 'stats.txt',
        },
      },
    ],
    sourceSummary: overrides.sourceSummary || {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_stats_1',
          sourceType: 'FILE',
          sourceName: 'stats.txt',
          sourceLocation: 'stats.txt',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

describe('Statistics Page ("Thống kê") & Creator Analytics Verification Suite', () => {
  it('1. Account with NO games and NO plays returns 0 counts, null averageScore, hasData=false, hasPlayData=false', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const emptyUser = authService.register({
      email: `empty_stats_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Empty Stats User',
    });

    const res = await request(app)
      .get('/api/analytics/learning')
      .set('Authorization', `Bearer ${emptyUser.token}`);

    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.hasData, false);
    assert.equal(data.hasPlayData, false);
    assert.equal(data.overview.totalGamesCreated, 0);
    assert.equal(data.overview.totalPlaysCount, 0);
    assert.equal(data.overview.completedPlaysCount, 0);
    assert.equal(data.overview.completionRatePercent, null);
    assert.equal(data.overview.soloCompletionRatePercent, null);
    assert.equal(data.overview.multiplayerCompletionRatePercent, null);
    assert.equal(data.overview.averageScorePerSession, null);
    assert.equal(data.overview.soloAverageScore, null);
    assert.equal(data.overview.multiplayerAverageScore, null);
    assert.equal(data.progressOverTime.length, 0);
    assert.equal(data.ownedGames.length, 0);
  });

  it('2. Account with created games but NO plays returns totalGamesCreated > 0, totalPlaysCount = 0, null rates/scores, and lists games with 0 plays in ownedGames', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const creator = authService.register({
      email: `noplay_creator_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'No Play Creator',
    });

    const game1 = createTestSpec({
      gameId: `game_np1_${suffix}`,
      title: 'Bộ câu hỏi Chưa Ai Chơi 1',
      ownerUserId: creator.user.userId,
      isPublic: true,
    });
    const game2 = createTestSpec({
      gameId: `game_np2_${suffix}`,
      title: 'Bộ câu hỏi Chưa Ai Chơi 2',
      ownerUserId: creator.user.userId,
      isPublic: false,
    });

    gameStore.save(game1, Date.now() - 1000, creator.user.userId, true);
    gameStore.save(game2, Date.now(), creator.user.userId, false);

    const res = await request(app)
      .get('/api/analytics/learning')
      .set('Authorization', `Bearer ${creator.token}`);

    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.hasData, true);
    assert.equal(data.hasPlayData, false);
    assert.equal(data.overview.totalGamesCreated, 2);
    assert.equal(data.overview.totalPlaysCount, 0);
    assert.equal(data.overview.completedPlaysCount, 0);
    assert.equal(data.overview.completionRatePercent, null);
    assert.equal(data.overview.soloCompletionRatePercent, null);
    assert.equal(data.overview.multiplayerCompletionRatePercent, null);
    assert.equal(data.overview.averageScorePerSession, null);
    assert.equal(data.overview.soloAverageScore, null);
    assert.equal(data.overview.multiplayerAverageScore, null);
    assert.equal(data.progressOverTime.length, 0);
    assert.equal(data.ownedGames.length, 2);
    assert.equal(data.ownedGames[0].totalPlaysCount, 0);
    assert.equal(data.ownedGames[0].completedPlaysCount, 0);
    assert.equal(data.ownedGames[0].averageScore, null);
  });

  it('3. Account with BOTH Solo (FINISHED, IN_PROGRESS, ABANDONED) and Multiplayer rooms computes accurate completion rates, mode comparison metrics, and daily chart', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const creator = authService.register({
      email: `active_creator_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Active Creator',
    });

    // Game A: Popular game (will get 3 solo sessions + 1 multiplayer room = 4 total plays, 2 completed)
    const gamePopular = createTestSpec({
      gameId: `game_pop_${suffix}`,
      title: 'Game Nổi Bật Hàng Đầu',
      ownerUserId: creator.user.userId,
      isPublic: true,
    });
    // Game B: Less played game (will get 1 finished solo session = 1 total play)
    const gameSecond = createTestSpec({
      gameId: `game_sec_${suffix}`,
      title: 'Game Đứng Thứ Hai',
      ownerUserId: creator.user.userId,
      isPublic: true,
    });
    // Game C: Unplayed game (0 plays)
    const gameUnplayed = createTestSpec({
      gameId: `game_zero_${suffix}`,
      title: 'Game Chưa Có Lượt Chơi',
      ownerUserId: creator.user.userId,
      isPublic: false,
    });

    gameStore.save(gamePopular, Date.now() - 3000, creator.user.userId, true);
    gameStore.save(gameSecond, Date.now() - 2000, creator.user.userId, true);
    gameStore.save(gameUnplayed, Date.now() - 1000, creator.user.userId, false);

    // 1. Finished solo session on Game Popular (2/2 correct -> 200 points in STANDARD mode)
    const sFin1 = new GameSession(
      `sess_fin1_${suffix}`,
      gamePopular,
      undefined,
      creator.user.userId
    );
    sFin1.start();
    sFin1.submitAnswer('q1', 'Đáp án A');
    sFin1.advance();
    sFin1.submitAnswer('q2', 'Đáp án 2');
    sFin1.advance();
    assert.equal(sFin1.state, 'FINISHED');

    // 2. In-progress solo session on Game Popular (should count in totalPlaysCount, NOT in completedPlaysCount or averageScore)
    const sInProg = new GameSession(`sess_inprog_${suffix}`, gamePopular, undefined, null);
    sInProg.start();
    sInProg.submitAnswer('q1', 'Đáp án A');
    assert.equal(sInProg.state, 'QUESTION_ANSWERED');

    // 3. Abandoned solo session on Game Popular (should count in totalPlaysCount, NOT in completedPlaysCount or averageScore)
    const sAband = new GameSession(`sess_aband_${suffix}`, gamePopular, undefined, null);
    sAband.start();
    sAband.abandon();
    assert.equal(sAband.state, 'ABANDONED');

    // 4. Finished Multiplayer Room on Game Popular (2 players: scores 400 and 200)
    persistenceRepo.saveRoomHistory({
      roomId: `room_pop_${suffix}`,
      roomCode: `P${suffix.slice(-5).toUpperCase()}`.slice(0, 6),
      gameId: gamePopular.gameId,
      ownerUserId: creator.user.userId,
      gameTitle: gamePopular.title,
      gameType: gamePopular.gameType,
      scoringMode: 'STANDARD',
      state: 'FINISHED',
      playerCount: 2,
      totalQuestions: 2,
      leaderboard: [
        {
          rank: 1,
          playerId: 'p1',
          displayName: 'Người chơi 1',
          score: 400,
          correctCount: 2,
          streak: 2,
          totalResponseTimeMs: 3000,
          connected: true,
        },
        {
          rank: 2,
          playerId: 'p2',
          displayName: 'Người chơi 2',
          score: 200,
          correctCount: 1,
          streak: 1,
          totalResponseTimeMs: 4000,
          connected: true,
        },
      ],
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      finishedAt: new Date().toISOString(),
    });

    // 5. Finished solo session on Game Second (1/2 correct -> 100 points in STANDARD mode)
    const sFin2 = new GameSession(
      `sess_fin2_${suffix}`,
      gameSecond,
      undefined,
      creator.user.userId
    );
    sFin2.start();
    sFin2.submitAnswer('q1', 'Đáp án A');
    sFin2.advance();
    sFin2.submitAnswer('q2', 'Đáp án 1'); // wrong
    sFin2.advance();
    assert.equal(sFin2.state, 'FINISHED');

    const report = analyticsService.getLearningAnalytics({ userId: creator.user.userId });

    // Verify Overview KPIs
    assert.equal(report.overview.totalGamesCreated, 3);
    assert.equal(report.overview.totalPracticeSessions, 4); // 2 FINISHED + 1 IN_PROGRESS + 1 ABANDONED
    assert.equal(report.overview.completedPracticeSessions, 2);
    assert.equal(report.overview.inProgressPracticeSessions, 1);
    assert.equal(report.overview.abandonedPracticeSessions, 1);
    assert.equal(report.overview.totalMultiplayerRooms, 1);
    assert.equal(report.overview.completedMultiplayerRooms, 1);
    assert.equal(report.overview.totalPlaysCount, 5); // 4 solo + 1 room
    assert.equal(report.overview.completedPlaysCount, 3); // 2 finished solo + 1 finished room
    assert.equal(report.overview.completionRatePercent, 60); // 3 / 5 = 60%
    assert.equal(report.overview.soloCompletionRatePercent, 50); // 2 / 4 = 50%
    assert.equal(report.overview.multiplayerCompletionRatePercent, 100); // 1 / 1 = 100%

    // Valid scores: sFin1 (200) + sFin2 (100) + room player 1 (400) + room player 2 (200) = 900 / 4 = 225
    assert.equal(report.overview.averageScorePerSession, 225);
    assert.equal(report.overview.soloAverageScore, 150); // (200 + 100) / 2 = 150
    assert.equal(report.overview.multiplayerAverageScore, 300); // (400 + 200) / 2 = 300

    // Verify Top Games sorting (by totalPlaysCount DESC: Game Popular (4) -> Game Second (1) -> Game Unplayed (0))
    assert.equal(report.ownedGames.length, 3);
    assert.equal(report.ownedGames[0].gameId, gamePopular.gameId);
    assert.equal(report.ownedGames[0].totalPlaysCount, 4);
    assert.equal(report.ownedGames[0].completedPlaysCount, 2);
    assert.equal(report.ownedGames[0].averageScore, 267); // (200 + 400 + 200) / 3 = 266.67 -> 267

    assert.equal(report.ownedGames[1].gameId, gameSecond.gameId);
    assert.equal(report.ownedGames[1].totalPlaysCount, 1);
    assert.equal(report.ownedGames[1].completedPlaysCount, 1);
    assert.equal(report.ownedGames[1].averageScore, 100);

    assert.equal(report.ownedGames[2].gameId, gameUnplayed.gameId);
    assert.equal(report.ownedGames[2].totalPlaysCount, 0);
    assert.equal(report.ownedGames[2].completedPlaysCount, 0);
    assert.equal(report.ownedGames[2].averageScore, null);

    // Verify daily activity chart series has today's bucket with 5 total plays and 3 completed plays
    assert.equal(report.progressOverTime.length >= 1, true);
    const todayBucket = report.progressOverTime[report.progressOverTime.length - 1];
    assert.equal(todayBucket.totalPlaysCount, 5);
    assert.equal(todayBucket.completedPlaysCount, 3);
  });

  it('4. Cross-account isolation: User A and User B statistics never mix owned games or plays', () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userA = authService.register({
      email: `iso_a_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'User A Isolation',
    });
    const userB = authService.register({
      email: `iso_b_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'User B Isolation',
    });

    const gameA = createTestSpec({
      gameId: `game_iso_a_${suffix}`,
      title: 'Game Của User A',
      ownerUserId: userA.user.userId,
      isPublic: true,
    });
    const gameB = createTestSpec({
      gameId: `game_iso_b_${suffix}`,
      title: 'Game Của User B',
      ownerUserId: userB.user.userId,
      isPublic: true,
    });

    gameStore.save(gameA, Date.now(), userA.user.userId, true);
    gameStore.save(gameB, Date.now(), userB.user.userId, true);

    // User B plays User A's public game
    const bPlaysAGame = new GameSession(
      `sess_b_on_a_${suffix}`,
      gameA,
      undefined,
      userB.user.userId
    );
    bPlaysAGame.start();
    bPlaysAGame.submitAnswer('q1', 'Đáp án A');
    bPlaysAGame.advance();
    bPlaysAGame.submitAnswer('q2', 'Đáp án 2');
    bPlaysAGame.advance();

    const statsA = analyticsService.getLearningAnalytics({ userId: userA.user.userId });
    const statsB = analyticsService.getLearningAnalytics({ userId: userB.user.userId });

    // User A sees 1 owned game (gameA) with 1 play
    assert.equal(statsA.overview.totalGamesCreated, 1);
    assert.equal(statsA.overview.totalPlaysCount, 1);
    assert.equal(statsA.overview.completedPlaysCount, 1);
    assert.equal(statsA.ownedGames.length, 1);
    assert.equal(statsA.ownedGames[0].gameId, gameA.gameId);

    // User B sees 1 owned game (gameB) with 0 plays on User B's owned games (gameA does NOT leak into User B's owned game stats)
    assert.equal(statsB.overview.totalGamesCreated, 1);
    assert.equal(statsB.overview.totalPlaysCount, 0);
    assert.equal(statsB.ownedGames.length, 1);
    assert.equal(statsB.ownedGames[0].gameId, gameB.gameId);
  });

  it('5. Solo-only plays: populates Solo metrics while Multiplayer completion rate and average score remain null', () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const soloCreator = authService.register({
      email: `solo_only_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Solo Only Creator',
    });

    const gameSolo = createTestSpec({
      gameId: `game_solo_only_${suffix}`,
      title: 'Game Chỉ Có Solo',
      ownerUserId: soloCreator.user.userId,
      isPublic: true,
    });
    gameStore.save(gameSolo, Date.now(), soloCreator.user.userId, true);

    const s1 = new GameSession(`sess_so1_${suffix}`, gameSolo, undefined, soloCreator.user.userId);
    s1.start();
    s1.submitAnswer('q1', 'Đáp án A');
    s1.advance();
    s1.submitAnswer('q2', 'Đáp án 2');
    s1.advance();

    const s2 = new GameSession(`sess_so2_${suffix}`, gameSolo, undefined, null);
    s2.start();
    s2.abandon();

    const stats = analyticsService.getLearningAnalytics({ userId: soloCreator.user.userId });
    assert.equal(stats.overview.totalPracticeSessions, 2);
    assert.equal(stats.overview.completedPracticeSessions, 1);
    assert.equal(stats.overview.abandonedPracticeSessions, 1);
    assert.equal(stats.overview.totalMultiplayerRooms, 0);
    assert.equal(stats.overview.completedMultiplayerRooms, 0);
    assert.equal(stats.overview.completionRatePercent, 50);
    assert.equal(stats.overview.soloCompletionRatePercent, 50);
    assert.equal(stats.overview.multiplayerCompletionRatePercent, null);
    assert.equal(stats.overview.soloAverageScore, 200);
    assert.equal(stats.overview.multiplayerAverageScore, null);
  });

  it('6. Multiplayer-only plays: populates Multiplayer metrics while Solo completion rate and average score remain null', () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const multiCreator = authService.register({
      email: `multi_only_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Multiplayer Only Creator',
    });

    const gameMulti = createTestSpec({
      gameId: `game_multi_only_${suffix}`,
      title: 'Game Chỉ Có Multiplayer',
      ownerUserId: multiCreator.user.userId,
      isPublic: true,
    });
    gameStore.save(gameMulti, Date.now(), multiCreator.user.userId, true);

    persistenceRepo.saveRoomHistory({
      roomId: `room_mo_${suffix}`,
      roomCode: `M${suffix.slice(-5).toUpperCase()}`.slice(0, 6),
      gameId: gameMulti.gameId,
      ownerUserId: multiCreator.user.userId,
      gameTitle: gameMulti.title,
      gameType: gameMulti.gameType,
      scoringMode: 'STANDARD',
      state: 'FINISHED',
      playerCount: 2,
      totalQuestions: 2,
      leaderboard: [
        {
          rank: 1,
          playerId: 'mp1',
          displayName: 'Player MP 1',
          score: 500,
          correctCount: 2,
          streak: 2,
          totalResponseTimeMs: 2500,
          connected: true,
        },
        {
          rank: 2,
          playerId: 'mp2',
          displayName: 'Player MP 2',
          score: 300,
          correctCount: 1,
          streak: 1,
          totalResponseTimeMs: 3500,
          connected: true,
        },
      ],
      startedAt: new Date(Date.now() - 45_000).toISOString(),
      finishedAt: new Date().toISOString(),
    });

    const stats = analyticsService.getLearningAnalytics({ userId: multiCreator.user.userId });
    assert.equal(stats.overview.totalPracticeSessions, 0);
    assert.equal(stats.overview.completedPracticeSessions, 0);
    assert.equal(stats.overview.totalMultiplayerRooms, 1);
    assert.equal(stats.overview.completedMultiplayerRooms, 1);
    assert.equal(stats.overview.completionRatePercent, 100);
    assert.equal(stats.overview.soloCompletionRatePercent, null);
    assert.equal(stats.overview.multiplayerCompletionRatePercent, 100);
    assert.equal(stats.overview.soloAverageScore, null);
    assert.equal(stats.overview.multiplayerAverageScore, 400);
  });

  it('7. Navigation label in App.tsx is renamed from "Báo cáo" to "Thống kê" and ReportsPage.tsx replaces "Game nổi bật" with gameplay analysis sections', () => {
    const appTsxPath = path.resolve(process.cwd(), 'frontend', 'src', 'App.tsx');
    const content = fs.readFileSync(appTsxPath, 'utf-8');
    assert.equal(
      content.includes("label: 'Thống kê'"),
      true,
      'App.tsx navItems must display "Thống kê"'
    );
    assert.equal(
      content.includes("label: 'Báo cáo'"),
      false,
      'App.tsx navItems must no longer display "Báo cáo"'
    );

    const reportsTsxPath = path.resolve(
      process.cwd(),
      'frontend',
      'src',
      'pages',
      'ReportsPage.tsx'
    );
    const reportsContent = fs.readFileSync(reportsTsxPath, 'utf-8');
    assert.equal(
      reportsContent.includes('Game nổi bật'),
      false,
      'ReportsPage.tsx must no longer display the "Game nổi bật" created games list'
    );
    assert.equal(
      reportsContent.includes('statistics-top-games'),
      false,
      'ReportsPage.tsx must no longer render data-testid="statistics-top-games"'
    );
    assert.equal(
      reportsContent.includes('statistics-completion-analysis'),
      true,
      'ReportsPage.tsx must render completion rate analysis section'
    );
    assert.equal(
      reportsContent.includes('statistics-mode-comparison'),
      true,
      'ReportsPage.tsx must render Solo vs Multiplayer comparison section'
    );
    assert.equal(
      reportsContent.includes('statistics-activity-chart'),
      true,
      'ReportsPage.tsx must render daily plays chart section'
    );
  });
});
