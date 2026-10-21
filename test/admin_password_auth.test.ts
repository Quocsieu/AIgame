import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { adminLoginRateLimiter, resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { hashPassword } from '../src/services/auth.service.js';
import { ADMIN_COOKIE_NAME } from '../src/services/admin.auth.service.js';

describe('ADMIN PASSWORD AUTHENTICATION & SECURITY TEST SUITE', () => {
  const TEST_ADMIN_PASSWORD = 'CorrectAdminSuperSecretPass2026!';
  const testPasswordHash = hashPassword(TEST_ADMIN_PASSWORD);

  before(() => {
    // Inject test admin password hash
    process.env.ADMIN_PASSWORD_HASH = testPasswordHash;
    resetAllRateLimiters();
  });

  after(() => {
    delete process.env.ADMIN_PASSWORD_HASH;
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  // 1. Rejects login when password is empty
  it('1. Rejects login when password is empty or missing (400 INVALID_REQUEST)', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: '' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.message.includes('mật khẩu'));
  });

  // 2. Rejects login when password is incorrect
  it('2. Rejects login when password is incorrect (401 INVALID_CREDENTIALS)', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: 'WrongPassword123' });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  // 3. Successful login returns 200, user, and sets HttpOnly cookie
  it('3. Successful login with correct password returns 200 and sets HttpOnly session cookie', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: TEST_ADMIN_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.authenticated, true);
    assert.equal(res.body.data.user.role, 'ADMIN');
    assert.ok(res.body.data.token.startsWith('at_'));

    // Verify Set-Cookie header
    const setCookie = res.headers['set-cookie'];
    assert.ok(Array.isArray(setCookie) && setCookie.length > 0);
    const cookieStr = setCookie.join('; ');
    assert.ok(cookieStr.includes(`${ADMIN_COOKIE_NAME}=`));
    assert.ok(cookieStr.includes('HttpOnly'));
    assert.ok(cookieStr.includes('Path=/'));
  });

  // 4. Verifies session status via GET /api/admin/auth/me with Cookie
  it('4. Checks session status via GET /api/admin/auth/me with cookie', async () => {
    // Login to get cookie
    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: TEST_ADMIN_PASSWORD });
    const cookies = loginRes.headers['set-cookie'];

    // Verify /me with cookie
    const meRes = await request(app)
      .get('/api/admin/auth/me')
      .set('Cookie', cookies);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.authenticated, true);
    assert.equal(meRes.body.data.user.role, 'ADMIN');
  });

  // 5. GET /api/admin/auth/me without session returns authenticated: false
  it('5. GET /api/admin/auth/me without session returns authenticated: false', async () => {
    const meRes = await request(app).get('/api/admin/auth/me');

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.authenticated, false);
  });

  // 6. Accessing protected admin endpoint without session is rejected (401)
  it('6. Accessing protected admin endpoint without session is rejected with 401 UNAUTHORIZED', async () => {
    const res = await request(app).get('/api/admin/overview');

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // 7. Accessing protected admin endpoint with admin cookie succeeds (200 OK)
  it('7. Accessing protected admin endpoint with admin cookie succeeds (200 OK)', async () => {
    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: TEST_ADMIN_PASSWORD });
    const cookies = loginRes.headers['set-cookie'];

    const overviewRes = await request(app)
      .get('/api/admin/overview')
      .set('Cookie', cookies);

    assert.equal(overviewRes.status, 200);
    assert.equal(overviewRes.body.success, true);
    assert.ok(overviewRes.body.data.totalGames !== undefined);
  });

  // 8. Rate limiting: 5 consecutive invalid password attempts triggers 429
  it('8. Brute-force rate limiting: 5 invalid attempts triggers 429 RATE_LIMIT_EXCEEDED', async () => {
    adminLoginRateLimiter.reset();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ password: 'BadPasswordAttempt' });
      assert.equal(res.status, 401);
    }

    // 6th attempt must be rejected with 429
    const blockedRes = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: 'BadPasswordAttempt' });

    assert.equal(blockedRes.status, 429);
    assert.equal(blockedRes.body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(blockedRes.headers['retry-after']);
  });

  // 9. Logout clears the cookie and revokes session
  it('9. Logout clears the HttpOnly cookie and revokes the active session', async () => {
    const loginRes = await request(app)
      .post('/api/admin/auth/login')
      .send({ password: TEST_ADMIN_PASSWORD });
    const cookies = loginRes.headers['set-cookie'];
    const token = loginRes.body.data.token;

    // Logout
    const logoutRes = await request(app)
      .post('/api/admin/auth/logout')
      .set('Cookie', cookies);

    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.data.loggedOut, true);

    // Verify Set-Cookie cleared Max-Age=0
    const clearedCookies = logoutRes.headers['set-cookie'].join('; ');
    assert.ok(clearedCookies.includes('Max-Age=0'));

    // Attempting to call protected endpoint with revoked token/cookie fails
    const callAfterLogout = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(callAfterLogout.status, 401);
  });

  // 10. Player flow remains completely open and accessible without password
  it('10. Player flow: solo play, question retrieval, and answer submissions work without any login', async () => {
    // Seed a published game in store
    const gameId = 'game_player_free_access';
    gameStore.save(
      {
        gameId,
        title: 'Trò chơi mở cho người chơi',
        gameType: 'MULTIPLE_CHOICE',
        questions: [
          {
            id: 'q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Hà Nội là thủ đô của quốc gia nào?',
            choices: ['Việt Nam', 'Lào', 'Campuchia', 'Thái Lan'],
            correctAnswer: 'Việt Nam',
            explanation: 'Hà Nội là thủ đô của Việt Nam.',
          },
        ],
        settings: {
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
        },
      },
      Date.now(),
      null,
      true // isPublic = true
    );

    // Player generates solo QR
    const qrRes = await request(app).get(`/api/games/${gameId}/qr`);
    assert.equal(qrRes.status, 200);
    assert.ok(qrRes.body.data.playUrl);

    // Player creates practice session without any auth headers
    const sessRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId, publicPlay: true });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    // Player starts session
    const startRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.question.question, 'Hà Nội là thủ đô của quốc gia nào?');

    // Player submits answer
    const ansRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({
        questionId: 'q1',
        answer: 'Việt Nam',
        clientTimestamp: Date.now(),
      });
    assert.equal(ansRes.status, 200);
    assert.equal(ansRes.body.data.isCorrect, true);
  });

  // 11. Deletion without admin auth is rejected (401 or 403)
  it('11. Unauthenticated or non-admin deletion of a game is strictly rejected', async () => {
    const gameId = 'game_protected_from_deletion';
    gameStore.save(
      {
        gameId,
        title: 'Game bảo vệ',
        gameType: 'MULTIPLE_CHOICE',
        questions: [
          {
            id: 'q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi test',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
          },
        ],
        settings: { timePerQuestion: 15, scoringMode: 'STANDARD' },
      },
      Date.now(),
      'usr_other',
      true
    );

    // Unauthenticated delete
    const unauthDelRes = await request(app).delete(`/api/games/${gameId}`);
    assert.equal(unauthDelRes.status, 403);

    // Guest delete
    const guestDelRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('X-Guest-Token', 'gt_0123456789abcdef0123456789abcdef');
    assert.equal(guestDelRes.status, 403);
  });
});
