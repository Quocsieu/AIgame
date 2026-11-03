import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { authService } from '../src/services/auth.service.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { GameSpecification } from '../src/types/game.types.js';

describe('KHO GAME DELETE — Dedicated Business Authorization & Security Suite', () => {
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;
  let userAId: string;
  let userBId: string;
  const guestToken = 'gt_0123456789abcdef0123456789abcdef';

  before(async () => {
    const db = getDatabase();

    const regA = authService.register({
      email: `kho_user_a_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      displayName: 'Kho User A',
    });
    userAId = regA.user.userId;
    userAToken = regA.token;

    const regB = authService.register({
      email: `kho_user_b_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      displayName: 'Kho User B',
    });
    userBId = regB.user.userId;
    userBToken = regB.token;

    const regAdmin = authService.register({
      email: `kho_admin_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      displayName: 'Kho Admin',
    });
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?").run(regAdmin.user.userId);
    adminToken = regAdmin.token;
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  function createTestSpec(id: string, ownerId: string): GameSpecification {
    return {
      gameId: id,
      ownerUserId: ownerId,
      isPublic: true,
      title: `Test Game ${id}`,
      description: `Description for ${id}`,
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: `${id}_q1`,
          type: 'MULTIPLE_CHOICE',
          question: 'Capital of Vietnam?',
          choices: ['Hanoi', 'Saigon', 'Danang', 'Hue'],
          correctAnswer: 'Hanoi',
          difficulty: 'EASY',
          sourceReference: {
            sourceId: 'src_1',
            sourceType: 'TXT',
            sourceLocation: 'inline',
          },
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 15,
        scoringMode: 'STANDARD',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_1',
            sourceType: 'TXT',
            sourceName: 'Sample Source',
            sourceLocation: 'inline',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  it('1. DELETE /api/games/:gameId authorization matrix: User A, User B, Guest, Player, and ADMIN', async () => {
    const gameIdA = `kho_owner_a_${Date.now()}`;
    gameStore.save(createTestSpec(gameIdA, userAId), Date.now(), userAId, true);

    const gameIdB = `kho_owner_b_${Date.now()}`;
    gameStore.save(createTestSpec(gameIdB, userBId), Date.now(), userBId, true);

    const gameIdAdminTarget = `kho_admin_target_${Date.now()}`;
    gameStore.save(createTestSpec(gameIdAdminTarget, userBId), Date.now(), userBId, true);

    // 1) User A deletes Game of B -> HTTP 403
    const aDeletesB = await request(app)
      .delete(`/api/games/${gameIdB}`)
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(aDeletesB.status, 403);
    assert.equal(aDeletesB.body.success, false);
    assert.equal(aDeletesB.body.error.code, 'ACCESS_DENIED');
    assert.ok(gameStore.get(gameIdB), 'Game B must remain intact');

    // 2) User B deletes Game of A -> HTTP 403
    const bDeletesA = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('Authorization', `Bearer ${userBToken}`);
    assert.equal(bDeletesA.status, 403);
    assert.equal(bDeletesA.body.success, false);
    assert.equal(bDeletesA.body.error.code, 'ACCESS_DENIED');
    assert.ok(gameStore.get(gameIdA), 'Game A must remain intact');

    // 3) Guest deletes any game -> HTTP 403
    const guestDeletesA = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('X-Guest-Token', guestToken);
    assert.equal(guestDeletesA.status, 403);
    assert.equal(guestDeletesA.body.success, false);
    assert.equal(guestDeletesA.body.error.code, 'ACCESS_DENIED');
    assert.ok(gameStore.get(gameIdA), 'Game A must remain intact after Guest attempt');

    // 4) Player deletes any game -> HTTP 403
    const playerDeletesA = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('X-Player-Token', 'pt_rogue_player_session_token');
    assert.equal(playerDeletesA.status, 403);
    assert.equal(playerDeletesA.body.success, false);
    assert.equal(playerDeletesA.body.error.code, 'ACCESS_DENIED');
    assert.ok(gameStore.get(gameIdA), 'Game A must remain intact after Player attempt');

    // 5) User A deletes Game of A -> Allowed (200 OK)
    const aDeletesA = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(aDeletesA.status, 200);
    assert.equal(aDeletesA.body.success, true);
    assert.equal(aDeletesA.body.data.deleted, true);
    assert.equal(aDeletesA.body.data.gameId, gameIdA);
    assert.equal(gameStore.get(gameIdA), undefined);

    // 6) ADMIN deletes Game of B -> Allowed (200 OK)
    const adminDeletesB = await request(app)
      .delete(`/api/games/${gameIdAdminTarget}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminDeletesB.status, 200);
    assert.equal(adminDeletesB.body.success, true);
    assert.equal(adminDeletesB.body.data.deleted, true);
    assert.equal(gameStore.get(gameIdAdminTarget), undefined);

    // Clean up remaining gameIdB
    await request(app)
      .delete(`/api/games/${gameIdB}`)
      .set('Authorization', `Bearer ${userBToken}`);
  });

  it('2. Player token (player inside a live room) is strictly blocked with 403 ACCESS_DENIED', async () => {
    const gameId = `kho_player_blocked_${Date.now()}`;
    const spec = createTestSpec(gameId, userAId);
    gameStore.save(spec, Date.now(), userAId, true);

    const playerDelRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('X-Player-Token', 'pt_rogue_player_session_token');

    assert.equal(playerDelRes.status, 403);
    assert.equal(playerDelRes.body.success, false);
    assert.equal(playerDelRes.body.error.code, 'ACCESS_DENIED');
    assert.ok(playerDelRes.body.error.message.includes('Người chơi trong phòng không có quyền'));

    // Game remains intact
    const checkRes = await request(app).get(`/api/games/${gameId}`);
    assert.equal(checkRes.status, 200);
  });

  it('3. Attempting to delete a non-existent game returns 404 GAME_NOT_FOUND', async () => {
    const nonExistentId = 'game_definitely_does_not_exist_99999';
    const res = await request(app)
      .delete(`/api/games/${nonExistentId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'GAME_NOT_FOUND');
  });

  it('4. Attempting to delete a game locked by an active multiplayer room returns 409 GAME_IN_USE', async () => {
    const gameId = `kho_active_room_game_${Date.now()}`;
    const spec = createTestSpec(gameId, userAId);
    gameStore.save(spec, Date.now(), userAId, true);

    // Create a live multiplayer room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ gameId });
    assert.equal(roomRes.status, 200);

    // Attempt to delete while room is active
    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.success, false);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');
    assert.ok(delRes.body.error.message.includes('Không thể xóa bộ câu hỏi đang có phiên'));

    // Clean up room so it doesn't leak into subsequent tests
    roomStore.clear();
  });

  it('5. Attempting to delete a game locked by an active solo session returns 409 GAME_IN_USE', async () => {
    const gameId = `kho_active_session_game_${Date.now()}`;
    const spec = createTestSpec(gameId, userAId);
    gameStore.save(spec, Date.now(), userAId, true);

    // Start a solo practice session and transition to IN_PROGRESS
    const sessionRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId });
    assert.equal(sessionRes.status, 200);
    const sessionId = sessionRes.body.data.sessionId;

    const startRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(startRes.status, 200);

    // Attempt to delete while session is active
    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.success, false);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');

    // Clean up session so it doesn't leak into subsequent tests
    sessionStore.clear();
  });

  // =========================================================================
  // BATCH TESTS: DELETE ALL GAMES (DELETE /api/games) — ALL 12 MANDATORY CASES
  // =========================================================================

  it('6. (Cases 8 & 9) Guest token and Player token callers (header, query, body) calling DELETE /api/games are strictly rejected with 403 ACCESS_DENIED', async () => {
    const playerDelRes = await request(app)
      .delete('/api/games')
      .set('X-Player-Token', 'pt_rogue_player_bulk_token');
    assert.equal(playerDelRes.status, 403);
    assert.equal(playerDelRes.body.success, false);
    assert.equal(playerDelRes.body.error.code, 'ACCESS_DENIED');

    const playerQueryDelRes = await request(app)
      .delete('/api/games?playerToken=pt_rogue_query_token');
    assert.equal(playerQueryDelRes.status, 403);
    assert.equal(playerQueryDelRes.body.success, false);
    assert.equal(playerQueryDelRes.body.error.code, 'ACCESS_DENIED');

    const playerBodyDelRes = await request(app)
      .delete('/api/games')
      .send({ playerToken: 'pt_rogue_body_token' });
    assert.equal(playerBodyDelRes.status, 403);
    assert.equal(playerBodyDelRes.body.success, false);
    assert.equal(playerBodyDelRes.body.error.code, 'ACCESS_DENIED');

    const guestDelRes = await request(app)
      .delete('/api/games')
      .set('X-Guest-Token', guestToken);
    assert.equal(guestDelRes.status, 403);
    assert.equal(guestDelRes.body.success, false);
    assert.equal(guestDelRes.body.error.code, 'ACCESS_DENIED');
  });

  it('7. (Cases 3, 4, 10, 11, 12) Unauthenticated Creator and Authenticated User calling DELETE /api/games only delete games in their own scope (works in both Development & Production mode without demo flags)', async () => {
    resetAllRateLimiters();
    await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    resetAllRateLimiters();

    // Create 6 games: 2 owned by User A, 2 owned by User B, 2 unowned (Creator without login)
    const userAGameIds = [`bulk_a1_${Date.now()}`, `bulk_a2_${Date.now()}`];
    const userBGameIds = [`bulk_b1_${Date.now()}`, `bulk_b2_${Date.now()}`];
    const anonGameIds = [`bulk_anon1_${Date.now()}`, `bulk_anon2_${Date.now()}`];

    for (const id of userAGameIds) {
      gameStore.save(createTestSpec(id, userAId), Date.now(), userAId, true);
    }
    for (const id of userBGameIds) {
      gameStore.save(createTestSpec(id, userBId), Date.now(), userBId, true);
    }
    for (const id of anonGameIds) {
      const spec = createTestSpec(id, '');
      spec.ownerUserId = null;
      gameStore.save(spec, Date.now(), null, true);
    }

    // Case 10 & 11: Regular User A calls DELETE /api/games -> must ONLY delete User A's 2 games
    const userABulkRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(userABulkRes.status, 200);
    assert.equal(userABulkRes.body.success, true);
    assert.equal(userABulkRes.body.data.deletedCount, 2);

    for (const id of userAGameIds) {
      assert.equal(gameStore.get(id), undefined, `User A game ${id} should be deleted`);
    }
    for (const id of userBGameIds) {
      assert.ok(gameStore.get(id), `User B game ${id} MUST NOT be deleted by User A`);
    }
    for (const id of anonGameIds) {
      assert.ok(gameStore.get(id), `Anonymous Creator game ${id} MUST NOT be bulk-deleted by User A`);
    }

    resetAllRateLimiters();

    // Case 3, 4, 11, 12: Unauthenticated Creator calls DELETE /api/games in Production mode (no login, no demo flag)
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDemoMode = process.env.ADMIN_DEMO_MODE;
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_DEMO_MODE;
    try {
      const unauthCreatorBulkRes = await request(app).delete('/api/games');
      assert.equal(unauthCreatorBulkRes.status, 200);
      assert.equal(unauthCreatorBulkRes.body.success, true);
      assert.equal(unauthCreatorBulkRes.body.data.deletedCount, 2);
      assert.equal(unauthCreatorBulkRes.body.data.skippedActiveCount, 0);

      // Verify anonymous Creator games are permanently removed from store & DB (Case 4: Refresh won't bring them back)
      for (const id of anonGameIds) {
        assert.equal(gameStore.get(id), undefined, `Unowned Creator game ${id} must be deleted`);
      }
      const listAfterUnauthDelete = await request(app).get('/api/games?scope=mine');
      assert.equal(listAfterUnauthDelete.status, 200);
      assert.equal(listAfterUnauthDelete.body.data.total, 0);

      // Verify User B's games were NEVER touched by the unauthenticated Creator (Case 11)
      for (const id of userBGameIds) {
        assert.ok(gameStore.get(id), `User B game ${id} MUST NOT be deleted by unauthenticated Creator`);
      }
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevDemoMode !== undefined) process.env.ADMIN_DEMO_MODE = prevDemoMode;
    }

    resetAllRateLimiters();

    // Now ADMIN calls DELETE /api/games -> deletes remaining 2 games of User B
    const adminBulkRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminBulkRes.status, 200);
    assert.equal(adminBulkRes.body.success, true);
    assert.equal(adminBulkRes.body.data.deletedCount, 2);

    for (const id of userBGameIds) {
      assert.equal(gameStore.get(id), undefined, `Game ${id} should be deleted by ADMIN`);
    }
  });

  it('8. (Cases 6 & 7) Unauthenticated Creator calling DELETE /api/games safely skips games locked by active solo session or active multiplayer room and deletes idle games', async () => {
    resetAllRateLimiters();
    // Create 3 unowned Creator games: 1 idle, 1 active room, 1 active solo session
    const idleGameId = `bulk_unauth_idle_${Date.now()}`;
    const idleSpec = createTestSpec(idleGameId, '');
    idleSpec.ownerUserId = null;
    gameStore.save(idleSpec, Date.now(), null, true);

    const roomGameId = `bulk_unauth_room_${Date.now()}`;
    const roomSpec = createTestSpec(roomGameId, '');
    roomSpec.ownerUserId = null;
    gameStore.save(roomSpec, Date.now(), null, true);
    const roomRes = await request(app)
      .post('/api/rooms')
      .send({ gameId: roomGameId });
    assert.equal(roomRes.status, 200);

    const sessionGameId = `bulk_unauth_sess_${Date.now()}`;
    const sessionSpec = createTestSpec(sessionGameId, '');
    sessionSpec.ownerUserId = null;
    gameStore.save(sessionSpec, Date.now(), null, true);
    const sessRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: sessionGameId });
    assert.equal(sessRes.status, 200);
    const sId = sessRes.body.data.sessionId;
    await request(app).post(`/api/games/sessions/${sId}/start`);

    // Unauthenticated Creator calls DELETE /api/games
    const delRes = await request(app).delete('/api/games');
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
    assert.equal(delRes.body.data.deletedCount, 1);
    assert.equal(delRes.body.data.skippedActiveCount, 2);
    assert.equal(delRes.body.data.skippedGames.length, 2);

    assert.equal(gameStore.get(idleGameId), undefined);
    assert.ok(gameStore.get(roomGameId) !== undefined);
    assert.ok(gameStore.get(sessionGameId) !== undefined);

    roomStore.clear();
    sessionStore.clear();

    // Cleanup remaining 2 games after sessions/rooms cleared
    resetAllRateLimiters();
    const cleanupRes = await request(app).delete('/api/games');
    assert.equal(cleanupRes.status, 200);
    assert.equal(cleanupRes.body.data.deletedCount, 2);
  });

  it('9. (Case 5) Calling DELETE /api/games without login or as ADMIN when library is empty succeeds safely with deletedCount = 0', async () => {
    resetAllRateLimiters();
    const resUnauthEmpty = await request(app).delete('/api/games');
    assert.equal(resUnauthEmpty.status, 200);
    assert.equal(resUnauthEmpty.body.success, true);
    assert.equal(resUnauthEmpty.body.data.deletedCount, 0);
    assert.equal(resUnauthEmpty.body.data.skippedActiveCount, 0);

    resetAllRateLimiters();

    const resEmpty = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(resEmpty.status, 200);
    assert.equal(resEmpty.body.success, true);
    assert.equal(resEmpty.body.data.deletedCount, 0);
  });
});
