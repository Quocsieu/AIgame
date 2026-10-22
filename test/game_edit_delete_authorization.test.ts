import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { authService } from '../src/services/auth.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import type { GameSpecification } from '../src/contracts/game.contract.js';

describe('BACKEND HARDENING — GAME EDIT/DELETE AUTHORIZATION (NO PASSWORDS)', () => {
  let adminToken: string;
  let userTokenA: string;
  let userIdA: string;
  let userTokenB: string;
  let userIdB: string;
  const guestToken = 'gt_0123456789abcdef0123456789abcdef';
  const playerToken = 'pt_0123456789abcdef0123456789abcdef';

  function createTestGame(params: {
    gameId: string;
    ownerUserId?: string | null;
    isPublic?: boolean;
    title?: string;
  }): GameSpecification {
    const spec: GameSpecification = {
      gameId: params.gameId,
      ownerUserId: params.ownerUserId ?? null,
      isPublic: params.isPublic ?? false,
      title: params.title || `Test Game ${params.gameId}`,
      description: 'Game for authorization test',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: `q_${params.gameId}_1`,
          type: 'MULTIPLE_CHOICE',
          question: 'Thủ đô của Việt Nam là gì?',
          choices: ['Hà Nội', 'Đà Nẵng', 'Huế', 'TP HCM'],
          correctAnswer: 'Hà Nội',
          explanation: 'Hà Nội là thủ đô',
          difficulty: 'EASY',
          sourceReference: {
            sourceId: 'src_test',
            sourceType: 'TXT',
            sourceLocation: 'local',
          },
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_test',
            sourceType: 'TXT',
            sourceName: 'test.txt',
            sourceLocation: 'local',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
    };

    gameStore.save(spec, Date.now(), params.ownerUserId ?? null, params.isPublic ?? false);
    return spec;
  }

  before(async () => {
    const ts = Date.now();
    const db = getDatabase();

    const admin = authService.register({
      email: `admin_hardening_${ts}@test.local`,
      password: 'Admin123!',
      displayName: 'Admin Hardening',
    });
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?").run(admin.user.userId);
    adminToken = admin.token;

    const userA = authService.register({
      email: `user_a_${ts}@test.local`,
      password: 'UserA123!',
      displayName: 'User A',
    });
    userTokenA = userA.token;
    userIdA = userA.user.userId;

    const userB = authService.register({
      email: `user_b_${ts}@test.local`,
      password: 'UserB123!',
      displayName: 'User B',
    });
    userTokenB = userB.token;
    userIdB = userB.user.userId;
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  // ========================================================
  // 1. ANONYMOUS / DEMO GAMES (ownerUserId: null)
  // ========================================================
  describe('Group 1: Anonymous / Demo Games (ownerUserId: null) - No password required', () => {
    it('1.1. Direct DELETE on anonymous game succeeds without any password (200)', async () => {
      const gameId = `test_anon_del_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: null });

      const res = await request(app).delete(`/api/games/${gameId}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.deleted, true);
      assert.equal(gameStore.get(gameId), undefined);
    });

    it('1.2. Direct PATCH on anonymous game succeeds without any password (200)', async () => {
      const gameId = `test_anon_patch_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null, title: 'Original Title' });

      const res = await request(app)
        .patch(`/api/games/${gameId}`)
        .send({
          title: 'Direct Updated Title',
          questions: game.questions,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.title, 'Direct Updated Title');
      assert.equal(gameStore.get(gameId)?.title, 'Direct Updated Title');
    });

    it('1.3. Old verify-password route returns 404 Not Found since password endpoints are removed', async () => {
      const gameId = `test_anon_no_verify_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: null });

      const verifyRes = await request(app)
        .post(`/api/games/${gameId}/verify-password`)
        .send({ password: 'AnyPassword123!' });

      assert.equal(verifyRes.status, 404);
    });
  });

  // ========================================================
  // 2. RESOURCE OWNERSHIP ISOLATION
  // ========================================================
  describe('Group 2: Resource Ownership Isolation (User B cannot edit/delete User A game)', () => {
    it('2.1. User B CANNOT edit User A game (403 ACCESS_DENIED)', async () => {
      const gameId = `test_owned_isolation_${Date.now()}`;
      const gameA = createTestGame({ gameId, ownerUserId: userIdA });

      const res = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({
          title: 'Hacked by User B',
          questions: gameA.questions,
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCESS_DENIED');
      assert.equal(gameStore.get(gameId)?.title, gameA.title);
    });

    it('2.2. User B CANNOT delete User A game (403 ACCESS_DENIED)', async () => {
      const gameId = `test_owned_del_isolation_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: userIdA });

      const res = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenB}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCESS_DENIED');
      assert.ok(gameStore.get(gameId));
    });

    it('2.3. User A (owner) CAN edit and delete their own game without password (200 OK)', async () => {
      const gameId = `test_owner_success_${Date.now()}`;
      const gameA = createTestGame({ gameId, ownerUserId: userIdA, title: 'Original A' });

      // Owner edit
      const editRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenA}`)
        .send({
          title: 'Owner Updated A',
          questions: gameA.questions,
        });
      assert.equal(editRes.status, 200);
      assert.equal(editRes.body.data.title, 'Owner Updated A');

      // Owner delete
      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenA}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.deleted, true);
      assert.equal(gameStore.get(gameId), undefined);
    });
  });

  // ========================================================
  // 3. GUEST & PLAYER REJECTION
  // ========================================================
  describe('Group 3: Guest and Player Token Rejection', () => {
    it('3.1. Guest token (X-Guest-Token) CANNOT delete or edit games (403)', async () => {
      const gameId = `test_guest_guard_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null });

      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Guest-Token', guestToken);
      assert.equal(delRes.status, 403);
      assert.equal(delRes.body.error.code, 'ACCESS_DENIED');

      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('X-Guest-Token', guestToken)
        .send({ title: 'Guest Edit', questions: game.questions });
      assert.equal(patchRes.status, 403);
      assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');
    });

    it('3.2. Player token (X-Player-Token) CANNOT delete or edit games (403)', async () => {
      const gameId = `test_player_guard_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null });

      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Player-Token', playerToken);
      assert.equal(delRes.status, 403);
      assert.equal(delRes.body.error.code, 'ACCESS_DENIED');

      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('X-Player-Token', playerToken)
        .send({ title: 'Player Edit', questions: game.questions });
      assert.equal(patchRes.status, 403);
      assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');
    });
  });

  // ========================================================
  // 4. ADMIN PRIVILEGE & UNPROTECTED DEMO GAMES
  // ========================================================
  describe('Group 4: Admin Authority & Unprotected Anonymous/Demo Games', () => {
    it('4.1. Admin CAN delete and edit any user game without needing game password (200)', async () => {
      const gameId = `test_admin_override_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: userIdA });

      // Admin patches without password
      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Admin Audited Title',
          questions: game.questions,
        });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.title, 'Admin Audited Title');

      // Admin deletes without password
      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.deleted, true);
    });

    it('4.2. Unprotected anonymous games (demo/public) can still be edited and deleted anonymously (200)', async () => {
      const gameId = `test_demo_unprotected_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null });

      // Anonymous edit on unprotected game
      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .send({
          title: 'Demo Updated Title',
          questions: game.questions,
        });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.title, 'Demo Updated Title');

      // Anonymous delete on unprotected game
      const delRes = await request(app).delete(`/api/games/${gameId}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.deleted, true);
      assert.equal(gameStore.get(gameId), undefined);
    });
  });
});
