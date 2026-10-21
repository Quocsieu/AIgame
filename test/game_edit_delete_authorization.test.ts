import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { gamePasswordService } from '../src/services/game.password.service.js';
import { authService } from '../src/services/auth.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import type { GameSpecification } from '../src/contracts/game.contract.js';

describe('BACKEND HARDENING — GAME EDIT/DELETE AUTHORIZATION', () => {
  const passwordA = 'PassGameA123!';
  const passwordB = 'PassGameB456!';

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
    password?: string;
    title?: string;
  }): GameSpecification {
    let passwordOptions: { isPasswordProtected?: boolean; passwordHash?: string | null } | undefined;
    if (params.password) {
      const hash = gamePasswordService.hashPassword(params.password);
      passwordOptions = { isPasswordProtected: true, passwordHash: hash };
    } else {
      passwordOptions = { isPasswordProtected: false, passwordHash: null };
    }

    const spec: GameSpecification = {
      gameId: params.gameId,
      ownerUserId: params.ownerUserId ?? null,
      isPublic: params.isPublic ?? false,
      passwordProtected: Boolean(params.password),
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

    gameStore.save(spec, Date.now(), params.ownerUserId ?? null, params.isPublic ?? false, passwordOptions);
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
  // 1. REPRO & RESOLUTION: Anonymous Password-Protected Games
  // ========================================================
  describe('Group 1: Anonymous Password-Protected Games (ownerUserId: null)', () => {
    it('1.1. Direct DELETE on anonymous password-protected game WITHOUT credentials is REJECTED with 401 UNAUTHORIZED', async () => {
      const gameId = `test_anon_del_reject_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: null, password: passwordA });

      const res = await request(app).delete(`/api/games/${gameId}`);

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
      assert.match(res.body.error.message, /bảo vệ bằng mật khẩu/i);
      // Ensure game is NOT deleted
      assert.ok(gameStore.get(gameId));
    });

    it('1.2. Direct PATCH on anonymous password-protected game WITHOUT credentials is REJECTED with 401 UNAUTHORIZED', async () => {
      const gameId = `test_anon_patch_reject_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null, password: passwordA, title: 'Original Title' });

      const res = await request(app)
        .patch(`/api/games/${gameId}`)
        .send({
          title: 'Hacked Title',
          questions: game.questions,
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
      assert.match(res.body.error.message, /bảo vệ bằng mật khẩu/i);
      // Ensure title was not changed
      assert.equal(gameStore.get(gameId)?.title, 'Original Title');
    });

    it('1.3. Authorized DELETE on anonymous password-protected game WITH X-Game-Access-Token SUCCEEDS with 200', async () => {
      const gameId = `test_anon_del_auth_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: null, password: passwordA });

      // Step 1: Verify password to obtain token
      const verifyRes = await request(app)
        .post(`/api/games/${gameId}/verify-password`)
        .send({ password: passwordA });
      assert.equal(verifyRes.status, 200);
      const token = verifyRes.body.data.gameAccessToken;

      // Step 2: Delete with X-Game-Access-Token
      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Game-Access-Token', token);

      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.deleted, true);
      assert.equal(gameStore.get(gameId), undefined);
    });

    it('1.4. Authorized PATCH on anonymous password-protected game WITH X-Game-Access-Token SUCCEEDS with 200', async () => {
      const gameId = `test_anon_patch_auth_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null, password: passwordA });

      // Step 1: Verify password to obtain token
      const verifyRes = await request(app)
        .post(`/api/games/${gameId}/verify-password`)
        .send({ password: passwordA });
      assert.equal(verifyRes.status, 200);
      const token = verifyRes.body.data.gameAccessToken;

      // Step 2: Patch with X-Game-Access-Token
      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('X-Game-Access-Token', token)
        .send({
          title: 'Authorized Updated Title',
          questions: game.questions,
        });

      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.title, 'Authorized Updated Title');
      assert.equal(gameStore.get(gameId)?.title, 'Authorized Updated Title');
    });

    it('1.5. Direct password in request body or X-Game-Password header allows edit/delete', async () => {
      const gameId = `test_anon_direct_pass_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null, password: passwordA });

      // Edit with body.password
      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .send({
          title: 'Direct Pass Edit',
          questions: game.questions,
          password: passwordA,
        });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.title, 'Direct Pass Edit');

      // Delete with X-Game-Password header
      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Game-Password', passwordA);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.deleted, true);
    });

    it('1.6. Wrong token or wrong password is REJECTED with 401 UNAUTHORIZED', async () => {
      const gameId = `test_anon_wrong_pass_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: null, password: passwordA });

      // Wrong token
      const wrongTokenRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Game-Access-Token', 'gat_invalid_fake_token_00000000000000000000000000000000');
      assert.equal(wrongTokenRes.status, 401);

      // Wrong password header
      const wrongPassRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Game-Password', 'WrongPass!');
      assert.equal(wrongPassRes.status, 401);
    });

    it('1.7. IDOR Prevention: Token for Game A CANNOT be used to edit/delete Game B', async () => {
      const gameIdA = `test_idor_a_${Date.now()}`;
      const gameIdB = `test_idor_b_${Date.now()}`;
      createTestGame({ gameId: gameIdA, ownerUserId: null, password: passwordA });
      createTestGame({ gameId: gameIdB, ownerUserId: null, password: passwordB });

      // Verify Game A
      const verifyA = await request(app)
        .post(`/api/games/${gameIdA}/verify-password`)
        .send({ password: passwordA });
      const tokenA = verifyA.body.data.gameAccessToken;

      // Try to DELETE Game B using Token A -> REJECTED 401
      const idorDel = await request(app)
        .delete(`/api/games/${gameIdB}`)
        .set('X-Game-Access-Token', tokenA);
      assert.equal(idorDel.status, 401);
      assert.ok(gameStore.get(gameIdB));
    });
  });

  // ========================================================
  // 2. RESOURCE OWNERSHIP ISOLATION (Rule 4)
  // ========================================================
  describe('Group 2: Resource Ownership Isolation (Rule 4: Knowing password does not bypass ownership)', () => {
    it('2.1. User B CANNOT edit User A game even if User B knows the game password or passes gameAccessToken', async () => {
      const gameId = `test_owned_isolation_${Date.now()}`;
      const gameA = createTestGame({ gameId, ownerUserId: userIdA, password: passwordA });

      // Obtain token for gameA
      const verifyRes = await request(app)
        .post(`/api/games/${gameId}/verify-password`)
        .send({ password: passwordA });
      const token = verifyRes.body.data.gameAccessToken;

      // User B attempts to edit User A's game while providing the valid gameAccessToken
      const res = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .set('X-Game-Access-Token', token)
        .send({
          title: 'Hacked by User B',
          questions: gameA.questions,
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCESS_DENIED');
      assert.equal(gameStore.get(gameId)?.title, gameA.title);
    });

    it('2.2. User B CANNOT delete User A game even if User B knows the game password', async () => {
      const gameId = `test_owned_del_isolation_${Date.now()}`;
      createTestGame({ gameId, ownerUserId: userIdA, password: passwordA });

      const verifyRes = await request(app)
        .post(`/api/games/${gameId}/verify-password`)
        .send({ password: passwordA });
      const token = verifyRes.body.data.gameAccessToken;

      const res = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .set('X-Game-Access-Token', token);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCESS_DENIED');
      assert.ok(gameStore.get(gameId));
    });
  });

  // ========================================================
  // 3. GUEST & PLAYER REJECTION
  // ========================================================
  describe('Group 3: Guest and Player Token Rejection', () => {
    it('3.1. Guest token (X-Guest-Token) CANNOT delete or edit games (403)', async () => {
      const gameId = `test_guest_guard_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: null, password: undefined });

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
      const game = createTestGame({ gameId, ownerUserId: null, password: undefined });

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
    it('4.1. Admin CAN delete and edit any password-protected game without needing game password (200)', async () => {
      const gameId = `test_admin_override_${Date.now()}`;
      const game = createTestGame({ gameId, ownerUserId: userIdA, password: passwordA });

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
      const game = createTestGame({ gameId, ownerUserId: null, password: undefined });

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

