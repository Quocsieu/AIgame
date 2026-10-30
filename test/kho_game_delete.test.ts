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
  // BATCH TESTS: DELETE ALL GAMES (DELETE /api/games)
  // =========================================================================

  it('6. Player, Guest, and unauthenticated callers calling DELETE /api/games are strictly rejected', async () => {
    const playerDelRes = await request(app)
      .delete('/api/games')
      .set('X-Player-Token', 'pt_rogue_player_bulk_token');
    assert.equal(playerDelRes.status, 403);
    assert.equal(playerDelRes.body.success, false);
    assert.equal(playerDelRes.body.error.code, 'ACCESS_DENIED');

    const guestDelRes = await request(app)
      .delete('/api/games')
      .set('X-Guest-Token', guestToken);
    assert.equal(guestDelRes.status, 403);
    assert.equal(guestDelRes.body.success, false);
    assert.equal(guestDelRes.body.error.code, 'ACCESS_DENIED');

    const unauthDelRes = await request(app).delete('/api/games');
    assert.equal(unauthDelRes.status, 401);
    assert.equal(unauthDelRes.body.success, false);
    assert.equal(unauthDelRes.body.error.code, 'UNAUTHORIZED');
  });

  it('7. Regular user calling DELETE /api/games ONLY deletes their own games and NEVER deletes other users games; ADMIN can delete across warehouse', async () => {
    // Clear any previous games as ADMIN
    await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    resetAllRateLimiters();

    // Create 6 games: 2 owned by User A, 2 owned by User B, 2 unowned (null)
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

    // Regular User A calls DELETE /api/games -> must ONLY delete User A's 2 games
    const userABulkRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(userABulkRes.status, 200);
    assert.equal(userABulkRes.body.success, true);
    assert.equal(userABulkRes.body.data.deletedCount, 2);

    // Verify User A's games are deleted, while User B's games and anonymous games are still intact!
    for (const id of userAGameIds) {
      assert.equal(gameStore.get(id), undefined, `User A game ${id} should be deleted`);
    }
    for (const id of userBGameIds) {
      assert.ok(gameStore.get(id), `User B game ${id} MUST NOT be deleted by User A`);
    }
    for (const id of anonGameIds) {
      assert.ok(gameStore.get(id), `Anonymous game ${id} MUST NOT be bulk-deleted by regular User A`);
    }

    resetAllRateLimiters();

    // Now ADMIN calls DELETE /api/games -> deletes remaining 4 games across warehouse
    const adminBulkRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminBulkRes.status, 200);
    assert.equal(adminBulkRes.body.success, true);
    assert.equal(adminBulkRes.body.data.deletedCount, 4);

    for (const id of [...userBGameIds, ...anonGameIds]) {
      assert.equal(gameStore.get(id), undefined, `Game ${id} should be deleted by ADMIN`);
    }
  });

  it('8. DELETE /api/games safely protects games locked by active room or session and reports skipped list', async () => {
    // Create an idle game
    const idleGameId = `bulk_idle_${Date.now()}`;
    const idleSpec = createTestSpec(idleGameId, userAId);
    gameStore.save(idleSpec, Date.now(), userAId, true);

    // Create a game with an active room
    const roomGameId = `bulk_active_room_${Date.now()}`;
    const roomSpec = createTestSpec(roomGameId, userBId);
    gameStore.save(roomSpec, Date.now(), userBId, true);
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ gameId: roomGameId });
    assert.equal(roomRes.status, 200);

    // Create a game with an active solo session
    const sessionGameId = `bulk_active_sess_${Date.now()}`;
    const sessionSpec = createTestSpec(sessionGameId, userAId);
    gameStore.save(sessionSpec, Date.now(), userAId, true);
    const sessRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: sessionGameId });
    assert.equal(sessRes.status, 200);
    const sId = sessRes.body.data.sessionId;
    await request(app).post(`/api/games/sessions/${sId}/start`);

    // Execute DELETE /api/games as ADMIN to target all 3 games
    const delRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
    // Idle game should be deleted
    assert.ok(delRes.body.data.deletedCount >= 1);
    // 2 active games should be skipped safely
    assert.equal(delRes.body.data.skippedActiveCount, 2);
    assert.ok(Array.isArray(delRes.body.data.skippedGames));
    assert.equal(delRes.body.data.skippedGames.length, 2);

    // Verify idle game is deleted, but active games still exist
    assert.equal(gameStore.get(idleGameId), undefined);
    assert.ok(gameStore.get(roomGameId) !== undefined);
    assert.ok(gameStore.get(sessionGameId) !== undefined);

    // Clean up active rooms and sessions
    roomStore.clear();
    sessionStore.clear();
  });

  it('9. Calling DELETE /api/games as ADMIN when warehouse is empty succeeds without phantom errors', async () => {
    const res = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    resetAllRateLimiters();

    const resEmpty = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(resEmpty.status, 200);
    assert.equal(resEmpty.body.success, true);
    assert.equal(resEmpty.body.data.deletedCount, 0);
  });
});
