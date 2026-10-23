import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { authService } from '../src/services/auth.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { GameSpecification } from '../src/types/game.types.js';

describe('KHO GAME DELETE — Dedicated Business Authorization & Security Suite', () => {
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;

  before(async () => {
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

  it('1. Kho Game manager can proactively delete game created by another user (User B deletes User A game)', async () => {
    const gameId = `kho_cross_del_${Date.now()}`;
    const spec = createTestSpec(gameId, userAId);
    gameStore.save(spec, Date.now(), userAId, true);

    // Verify game exists
    const beforeRes = await request(app).get(`/api/games/${gameId}`);
    assert.equal(beforeRes.status, 200);

    // User B (or guest in Kho Game) deletes User A's game
    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
    assert.equal(delRes.body.data.deleted, true);
    assert.equal(delRes.body.data.gameId, gameId);

    // Confirm game is completely gone
    const afterRes = await request(app).get(`/api/games/${gameId}`);
    assert.equal(afterRes.status, 404);
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

  it('6. Player token calling DELETE /api/games is strictly blocked with 403 ACCESS_DENIED', async () => {
    const playerDelRes = await request(app)
      .delete('/api/games')
      .set('X-Player-Token', 'pt_rogue_player_bulk_token');

    assert.equal(playerDelRes.status, 403);
    assert.equal(playerDelRes.body.success, false);
    assert.equal(playerDelRes.body.error.code, 'ACCESS_DENIED');
  });

  it('7. DELETE /api/games deletes ALL games across multiple users, sessions, and paginated records', async () => {
    // Clear any previous games
    await request(app).delete('/api/games');

    // Create 15 games across User A, User B, and unauthenticated/guest
    const gameIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const gId = `bulk_test_game_${i}_${Date.now()}`;
      const owner = i % 3 === 0 ? userAId : i % 3 === 1 ? userBId : null;
      const spec = createTestSpec(gId, owner || '');
      spec.ownerUserId = owner;
      gameStore.save(spec, Date.now(), owner, true);
      gameIds.push(gId);
    }

    // Verify GET /api/games paginated list sees the games
    const page1Res = await request(app).get('/api/games?limit=5&offset=0');
    assert.equal(page1Res.status, 200);
    assert.ok(page1Res.body.data.total >= 15);

    // Execute DELETE /api/games by Kho Game manager (e.g. User A or User B or guest)
    const delAllRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${userAToken}`);

    assert.equal(delAllRes.status, 200);
    assert.equal(delAllRes.body.success, true);
    assert.ok(delAllRes.body.data.deletedCount >= 15);
    assert.equal(delAllRes.body.data.skippedActiveCount, 0);

    // Verify all 15 games are gone from memory
    for (const id of gameIds) {
      assert.equal(gameStore.get(id), undefined, `Game ${id} should be deleted from memory`);
    }

    // Verify reloading Kho Game list (GET /api/games) returns 0 games
    const reloadRes = await request(app).get('/api/games');
    assert.equal(reloadRes.status, 200);
    assert.equal(reloadRes.body.data.total, 0);
    assert.equal(reloadRes.body.data.games.length, 0);
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

    // Execute DELETE /api/games
    const delRes = await request(app)
      .delete('/api/games')
      .set('Authorization', `Bearer ${userAToken}`);

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

    // Reload list: only the 2 active games remain
    const listRes = await request(app).get('/api/games');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.total, 2);

    // Clean up active rooms and sessions
    roomStore.clear();
    sessionStore.clear();
  });

  it('9. Calling DELETE /api/games when warehouse is empty succeeds without phantom errors', async () => {
    // Delete all remaining games
    const res = await request(app).delete('/api/games');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    // Reset rate limiter before immediate second call
    resetAllRateLimiters();

    // Calling delete again when no games exist
    const resEmpty = await request(app).delete('/api/games');
    assert.equal(resEmpty.status, 200);
    assert.equal(resEmpty.body.success, true);
    assert.equal(resEmpty.body.data.deletedCount, 0);
  });
});
