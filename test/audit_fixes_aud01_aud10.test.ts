import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';
import { app } from '../src/app.js';
import { GameSession } from '../src/game/game.session.js';
import { gameStore } from '../src/game/game.store.js';
import {
  GeminiModelProvider,
  sanitizeAiErrorMessage,
  AiQuestionService,
} from '../src/services/ai.question.service.js';
import { aiImageService } from '../src/services/ai.image.service.js';
import { analyticsService } from '../src/services/analytics.service.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { GameSpecification } from '../src/contracts/game.contract.js';

function createTestSpec(overrides: Partial<GameSpecification> = {}): GameSpecification {
  const gameId = overrides.gameId || `game_aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    gameId,
    title: overrides.title || 'Bộ câu hỏi kiểm thử Audit',
    description: overrides.description || 'Mô tả bộ câu hỏi kiểm thử',
    gameType: overrides.gameType || 'MULTIPLE_CHOICE',
    ownerUserId: overrides.ownerUserId ?? null,
    isPublic: overrides.isPublic ?? true,
    ...(overrides.coverImageUrl ? { coverImageUrl: overrides.coverImageUrl } : {}),
    settings: overrides.settings || {
      questionCount: 2,
      timePerQuestion: 15,
      scoringMode: 'SPEED_BONUS',
    },
    questions: overrides.questions || [
      {
        id: 'q1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu hỏi số 1?',
        choices: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'],
        correctAnswer: 'Đáp án A',
        explanation: 'Giải thích câu 1',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_aud_1',
          sourceType: 'FILE',
          sourceLocation: 'audit.txt',
        },
      },
      {
        id: 'q2',
        type: 'SLIDER',
        question: 'Câu hỏi thanh trượt số 2?',
        sliderConfig: {
          min: 0,
          max: 100,
          step: 5,
          correctValue: 50,
          tolerance: 5,
          unit: '%',
        },
        correctAnswer: '50',
        explanation: 'Giải thích câu 2',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_aud_1',
          sourceType: 'FILE',
          sourceLocation: 'audit.txt',
        },
      },
    ],
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_aud_1',
          sourceType: 'FILE',
          sourceLocation: 'audit.txt',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

describe('Audit Fixes AUD-01 -> AUD-10 Verification Suite', () => {
  it('AUD-02 & AUD-08: GameSession exposes remainingTimeSeconds/deadlineAt and advances cleanly on timeout (including 500ms jitter)', () => {
    const spec = createTestSpec({
      settings: {
        questionCount: 2,
        timePerQuestion: 10,
        scoringMode: 'SPEED_BONUS',
      },
    });

    let fakeNow = 1_700_000_000_000;
    const session = new GameSession(`sess_aud02_${Date.now()}`, spec, () => fakeNow);
    session.start();

    // Advance clock by 4 seconds -> 6 seconds remaining
    fakeNow += 4_000;
    const clientQ = session.getCurrentClientQuestion();
    assert.equal(clientQ.id, 'q1');
    assert.equal((clientQ as any).correctAnswer, undefined);
    assert.equal(clientQ.remainingTimeSeconds, 6);
    assert.equal(typeof clientQ.deadlineAt, 'number');

    // Advance clock to 9.7s elapsed (within 500ms client countdown jitter window before 10.0s)
    fakeNow += 5_700;
    const advResult = session.advance();
    assert.equal(advResult.nextQuestionAvailable, true);
    assert.equal(advResult.finished, false);
    assert.equal(session.getSummary().wrongCount, 1);
    assert.equal(session.getSummary().currentQuestionIndex, 1);
  });

  it('AUD-04: GeminiModelProvider sends API key in x-goog-api-key header (never in URL) and sanitizes error messages', async () => {
    const fakeKey = 'AIzaSyTestSecretKey1234567890abcdef';
    const rawMsg = `Fetch failed for https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=${fakeKey} with token ${encodeURIComponent(fakeKey)}`;
    const sanitized = sanitizeAiErrorMessage(rawMsg, fakeKey);
    assert.equal(sanitized.includes(fakeKey), false);
    assert.equal(sanitized.includes('key=AIza'), false);
    assert.equal(sanitized.includes('[REDACTED_API_KEY]'), true);

    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input: any, init?: any) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return new Response(
        JSON.stringify({
          error: {
            message: `Invalid key ${fakeKey} at ?key=${fakeKey}`,
          },
        }),
        { status: 400 }
      );
    }) as typeof fetch;

    try {
      const provider = new GeminiModelProvider(fakeKey, 'gemini-2.5-flash');
      await assert.rejects(
        async () => {
          await provider.generateJson('Test prompt', 'Test system instruction');
        },
        (err: any) => {
          assert.equal(err.message.includes(fakeKey), false);
          return true;
        }
      );
      assert.equal(capturedUrl.includes(fakeKey), false);
      assert.equal(capturedUrl.includes('?key='), false);
      assert.equal(capturedHeaders['x-goog-api-key'], fakeKey);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('AUD-03: Learning analytics aggregates creator solo sessions, external solo plays on creator games, and finished multiplayer rooms without duplication or PII leakage', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const creatorAuth = await authService.register({
      email: `creator_aud03_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Creator AUD03',
    });
    const otherPlayerAuth = await authService.register({
      email: `player_aud03_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Other Player AUD03',
    });

    const creatorId = creatorAuth.user.userId;
    const otherPlayerId = otherPlayerAuth.user.userId;

    const creatorGame = createTestSpec({
      gameId: `game_creator_${suffix}`,
      title: 'Game Của Creator AUD03',
      ownerUserId: creatorId,
      isPublic: true,
    });
    gameStore.save(creatorGame, Date.now(), creatorId, true);

    // 1. Creator plays their own game (should count once, not twice!)
    const creatorSession = new GameSession(
      `sess_creator_${suffix}`,
      creatorGame,
      undefined,
      creatorId
    );
    creatorSession.start();
    creatorSession.submitAnswer('q1', 'Đáp án A');
    creatorSession.advance();
    creatorSession.submitAnswer('q2', '50');
    creatorSession.advance();

    // 2. Another logged-in user plays creator's public game in Solo mode
    const externalSession = new GameSession(
      `sess_external_${suffix}`,
      creatorGame,
      undefined,
      otherPlayerId
    );
    externalSession.start();
    externalSession.submitAnswer('q1', 'Đáp án B');
    externalSession.advance();
    externalSession.submitAnswer('q2', '50');
    externalSession.advance();

    // 3. A multiplayer room on creator's game finishes
    persistenceRepo.saveRoomHistory({
      roomId: `room_aud03_${suffix}`,
      roomCode: `R${suffix.slice(-5).toUpperCase()}`.slice(0, 6),
      gameId: creatorGame.gameId,
      ownerUserId: creatorId,
      gameTitle: creatorGame.title,
      gameType: creatorGame.gameType,
      scoringMode: 'SPEED_BONUS',
      state: 'FINISHED',
      playerCount: 3,
      totalQuestions: 2,
      leaderboard: [
        {
          rank: 1,
          playerId: 'p1',
          displayName: 'Học viên 1',
          score: 1850,
          correctCount: 2,
          currentStreak: 2,
          bestStreak: 2,
        },
        {
          rank: 2,
          playerId: 'p2',
          displayName: 'Học viên 2',
          score: 920,
          correctCount: 1,
          currentStreak: 1,
          bestStreak: 1,
        },
      ],
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      finishedAt: new Date().toISOString(),
    });

    const report = analyticsService.getLearningAnalytics({ userId: creatorId });
    assert.equal(report.overview.completedPracticeSessions, 2);
    assert.equal(report.overview.personalPracticeSessions, 1);
    assert.equal(report.overview.creatorGamePracticeSessions, 1);
    assert.equal(report.overview.totalQuestionsAnswered, 4);
    assert.equal(report.overview.totalCorrectAnswers, 3);
    assert.equal(report.overview.completedMultiplayerRooms, 1);
    assert.equal(report.overview.multiplayerPlayersCount, 3);
    assert.equal(report.overview.multiplayerTotalCorrectAnswers, 3);
    assert.equal(report.overview.multiplayerTotalScoreEarned, 2770);
    assert.equal(report.recentMultiplayerRooms.length >= 1, true);

    // Verify PII redaction on listPracticeSessions when viewing external play on creator's game
    const listedSessions = persistenceRepo.listPracticeSessions({ userId: creatorId });
    const extRecord = listedSessions.find((s) => s.sessionId === externalSession.sessionId);
    assert.ok(extRecord);
    assert.equal(extRecord.ownerUserId, null);
    assert.equal(extRecord.isExternalPlayOnOwnedGame, true);

    // Verify GET /api/history/rooms endpoint
    const roomsRes = await request(app)
      .get('/api/history/rooms')
      .set('Authorization', `Bearer ${creatorAuth.token}`);
    assert.equal(roomsRes.status, 200);
    assert.equal(Array.isArray(roomsRes.body.data), true);
    assert.equal(
      roomsRes.body.data.some((r: any) => r.gameId === creatorGame.gameId),
      true
    );
  });

  it('AUD-05 & AUD-06: GET /api/games returns full-database KPI counts across pages and strictly scopes mine vs manage', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userA = await authService.register({
      email: `usera_aud06_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'User A AUD06',
    });
    const userB = await authService.register({
      email: `userb_aud06_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'User B AUD06',
    });

    const gameAPub = createTestSpec({
      gameId: `game_a_pub_${suffix}`,
      title: 'Game A Public',
      ownerUserId: userA.user.userId,
      isPublic: true,
    });
    const gameADraft = createTestSpec({
      gameId: `game_a_draft_${suffix}`,
      title: 'Game A Draft',
      ownerUserId: userA.user.userId,
      isPublic: false,
    });
    const gameBPub = createTestSpec({
      gameId: `game_b_pub_${suffix}`,
      title: 'Game B Public',
      ownerUserId: userB.user.userId,
      isPublic: true,
    });

    gameStore.save(gameAPub, Date.now(), userA.user.userId, true);
    gameStore.save(gameADraft, Date.now(), userA.user.userId, false);
    gameStore.save(gameBPub, Date.now(), userB.user.userId, true);

    // User A queries scope=mine with limit=1: page has 1 item, but counts reflect all 2 owned games (1 pub, 1 draft)
    const mineRes = await request(app)
      .get('/api/games?scope=mine&limit=1')
      .set('Authorization', `Bearer ${userA.token}`);
    assert.equal(mineRes.status, 200);
    assert.equal(mineRes.body.data.games.length, 1);
    assert.equal(mineRes.body.data.counts.totalAll, 2);
    assert.equal(mineRes.body.data.counts.publishedCount, 1);
    assert.equal(mineRes.body.data.counts.draftCount, 1);
    assert.equal(mineRes.body.data.counts.ownedCount, 2);

    // User B queries scope=mine: only gets User B's 1 game, never User A's public game
    const mineResB = await request(app)
      .get('/api/games?scope=mine&limit=20')
      .set('Authorization', `Bearer ${userB.token}`);
    assert.equal(mineResB.status, 200);
    assert.equal(mineResB.body.data.games.length, 1);
    assert.equal(mineResB.body.data.games[0].gameId, gameBPub.gameId);
  });

  it('AUD-07: Adventure AI prompt does not duplicate CRITICAL RULES FOR ADVENTURE GAME MODE', () => {
    const service = new AiQuestionService();
    const prompt = service.buildBoundedPrompt(
      [
        {
          sourceId: 'src_adv_prompt',
          sourceType: 'FILE',
          sourceLocation: 'adv.txt',
          title: 'Tài liệu Adventure',
          text: 'Bước 1 khởi động hệ thống. Bước 2 kiểm tra an toàn. Bước 3 vận hành dây chuyền sản xuất.',
          sections: [
            {
              id: 's1',
              title: 'Quy trình',
              content: 'Bước 1 khởi động hệ thống. Bước 2 kiểm tra an toàn. Bước 3 vận hành dây chuyền sản xuất.',
              provenance: {
                sourceId: 'src_adv_prompt',
                sourceType: 'FILE',
                sourceLocation: 'adv.txt',
                section: 'Quy trình',
              },
            },
          ],
          extractedItems: [],
          extractedAt: new Date().toISOString(),
        } as any,
      ],
      'ADVENTURE',
      5,
      'MEDIUM',
      {
        adventureQuestionTypes: ['PUZZLE', 'SLIDER'],
      }
    );

    const occurrences =
      prompt.split('CRITICAL RULES FOR ADVENTURE GAME MODE (GAME ĐI CẢNH THEO NGÀNH NGHỀ):').length - 1;
    assert.equal(occurrences, 1);
  });

  it('AUD-10: Deleting a game removes orphaned cover image file only when no other game references it', async () => {
    const tmpCoversDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-covers-test-'));
    aiImageService.setDefaultCoversDir(tmpCoversDir);

    try {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const coverFileName = `cover_test_${suffix}.png`;
      const coverUrl = `/covers/${coverFileName}`;
      const coverFilePath = path.join(tmpCoversDir, coverFileName);
      fs.writeFileSync(coverFilePath, Buffer.alloc(64, 1));

      const game1 = createTestSpec({
        gameId: `game_cover_1_${suffix}`,
        title: 'Game Cover 1',
        coverImageUrl: coverUrl,
      });
      gameStore.save(game1, Date.now(), null, true);

      // Duplicate game1 -> game2 shares the same cover_image_url
      const game2 = persistenceRepo.duplicateGame(game1.gameId, null, 'Game Cover 2 (Copy)');
      assert.ok(game2);
      gameStore.save(game2, Date.now(), null, false);

      // Delete game1 -> file MUST remain because game2 still references coverUrl
      const del1Res = await request(app).delete(`/api/games/${game1.gameId}`);
      assert.equal(del1Res.status, 200);
      assert.equal(fs.existsSync(coverFilePath), true);

      // Delete game2 -> now 0 games reference coverUrl, so file MUST be unlinked
      const del2Res = await request(app).delete(`/api/games/${game2.gameId}`);
      assert.equal(del2Res.status, 200);
      assert.equal(fs.existsSync(coverFilePath), false);
    } finally {
      aiImageService.setDefaultCoversDir(path.resolve(process.cwd(), 'public', 'covers'));
      fs.rmSync(tmpCoversDir, { recursive: true, force: true });
    }
  });
});
