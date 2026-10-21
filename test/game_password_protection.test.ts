import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { gamePasswordService } from '../src/services/game.password.service.js';
import { authService } from '../src/services/auth.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import type { GameSpecification } from '../src/contracts/game.contract.js';

describe('PER-QUESTION-SET PASSWORD PROTECTION & ADMIN DECOUPLING TEST SUITE', () => {
  let samplePublicGameId: string;
  let sampleProtectedGameId: string;
  let sampleProtectedGameBId: string;
  const samplePassword = 'MatKhauBoCauHoi2026!';
  const samplePasswordB = 'MatKhauKhac999!';

  // Helper to create a direct in-store and SQLite game
  function createSampleGame(params: {
    gameId: string;
    title: string;
    isPublic: boolean;
    password?: string;
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
      ownerUserId: null,
      isPublic: params.isPublic,
      passwordProtected: Boolean(params.password),
      title: params.title,
      description: 'Mô tả bộ câu hỏi kiểm thử bảo mật mật khẩu.',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: `q_${params.gameId}_1`,
          type: 'MULTIPLE_CHOICE',
          question: 'Thủ đô của Việt Nam là thành phố nào?',
          choices: ['Hà Nội', 'Đà Nẵng', 'Huế', 'TP Hồ Chí Minh'],
          correctAnswer: 'Hà Nội',
          explanation: 'Hà Nội là thủ đô của nước CHXHCN Việt Nam.',
          difficulty: 'EASY',
          sourceReference: {
            sourceId: 'src_test',
            sourceType: 'TXT',
            sourceLocation: 'local',
          },
        },
        {
          id: `q_${params.gameId}_2`,
          type: 'MULTIPLE_CHOICE',
          question: 'Sông nào dài nhất Việt Nam?',
          choices: ['Sông Đồng Nai', 'Sông Hồng', 'Sông Mê Kông', 'Sông Đà'],
          correctAnswer: 'Sông Đồng Nai',
          explanation: 'Sông Đồng Nai là sông nội địa dài nhất Việt Nam.',
          difficulty: 'MEDIUM',
          sourceReference: {
            sourceId: 'src_test',
            sourceType: 'TXT',
            sourceLocation: 'local',
          },
        },
      ],
      settings: {
        questionCount: 2,
        timePerQuestion: 15,
        scoringMode: 'SPEED_BONUS',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_test',
            sourceType: 'TXT',
            sourceName: 'test.txt',
            sourceLocation: 'test',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
    };

    gameStore.save(spec, Date.now(), null, params.isPublic, passwordOptions);
    return spec;
  }

  before(() => {
    resetAllRateLimiters();
    gamePasswordService.clearAll();

    samplePublicGameId = `game_pub_${Date.now()}`;
    sampleProtectedGameId = `game_prot_${Date.now()}`;
    sampleProtectedGameBId = `game_prot_b_${Date.now()}`;

    createSampleGame({
      gameId: samplePublicGameId,
      title: 'Bộ Câu Hỏi Công Khai Không Mật Khẩu',
      isPublic: true,
    });

    createSampleGame({
      gameId: sampleProtectedGameId,
      title: 'Bộ Câu Hỏi Bảo Mật Cấp 1',
      isPublic: true,
      password: samplePassword,
    });

    createSampleGame({
      gameId: sampleProtectedGameBId,
      title: 'Bộ Câu Hỏi Bảo Mật Khác B',
      isPublic: true,
      password: samplePasswordB,
    });
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  // ========================================================
  // GROUP A: TẠO VÀ CẬP NHẬT MẬT KHẨU
  // ========================================================
  describe('Group A: Tạo và cập nhật mật khẩu bộ câu hỏi', () => {
    it('1. Tạo bộ câu hỏi không có mật khẩu thành công (passwordProtected: false)', async () => {
      const gameId = `game_test_nopass_${Date.now()}`;
      const spec = createSampleGame({
        gameId,
        title: 'Game Không Pass',
        isPublic: true,
      });

      const res = await request(app).get(`/api/games/${gameId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.passwordProtected, false);
      assert.equal(res.body.data.questions.length, 2);
    });

    it('2. Tạo bộ câu hỏi có mật khẩu thành công (passwordProtected: true)', async () => {
      const gameId = `game_test_withpass_${Date.now()}`;
      createSampleGame({
        gameId,
        title: 'Game Có Pass',
        isPublic: true,
        password: 'SecretPassword123!',
      });

      const res = await request(app).get(`/api/games/${gameId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.passwordProtected, true);
      assert.equal(res.body.data.requiresPassword, true);
    });

    it('3. Mật khẩu không được lưu dạng plaintext trong database (lưu chuẩn OWASP scrypt)', () => {
      const db = getDatabase();
      const row = db
        .prepare('SELECT password_hash FROM games WHERE game_id = ?')
        .get(sampleProtectedGameId) as { password_hash: string };

      assert.ok(row.password_hash, 'Password hash must be stored');
      assert.notEqual(row.password_hash, samplePassword, 'Plaintext password must NEVER be in DB');
      assert.match(row.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i, 'Must be valid scrypt format');
    });

    it('4. Hash mật khẩu và plaintext không bao giờ xuất hiện trong API response', async () => {
      const resDetail = await request(app).get(`/api/games/${sampleProtectedGameId}`);
      assert.equal(resDetail.status, 200);
      const strDetail = JSON.stringify(resDetail.body);
      assert.equal(strDetail.includes(samplePassword), false, 'Plaintext must not be in response');
      assert.equal(strDetail.includes('scrypt$'), false, 'Password hash must not be in response');

      const resList = await request(app).get('/api/games');
      assert.equal(resList.status, 200);
      const strList = JSON.stringify(resList.body);
      assert.equal(strList.includes('scrypt$'), false, 'Password hash must not be in list response');
    });

    it('5. Cập nhật mật khẩu mới không làm mất nội dung câu hỏi hoặc cấu hình game', async () => {
      const updateGameId = `game_update_pass_${Date.now()}`;
      createSampleGame({
        gameId: updateGameId,
        title: 'Game Cần Đổi Mật Khẩu',
        isPublic: true,
        password: 'OldPassword123!',
      });

      const newPass = 'NewPassword456!';
      const patchRes = await request(app)
        .patch(`/api/games/${updateGameId}`)
        .send({
          passwordProtected: true,
          password: newPass,
          questions: [
            {
              id: 'q_keep_1',
              type: 'MULTIPLE_CHOICE',
              question: 'Cập nhật câu hỏi nhưng giữ nguyên nội dung?',
              choices: ['Đúng', 'Sai', 'Chưa rõ', 'Không biết'],
              correctAnswer: 'Đúng',
              difficulty: 'EASY',
              sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'local' },
            },
          ],
        });

      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.passwordProtected, true);
      assert.equal(patchRes.body.data.questions.length, 1);

      // Verify that new password works and old password fails
      const verifyOld = await request(app)
        .post(`/api/games/${updateGameId}/verify-password`)
        .send({ password: 'OldPassword123!' });
      assert.equal(verifyOld.status, 401);

      const verifyNew = await request(app)
        .post(`/api/games/${updateGameId}/verify-password`)
        .send({ password: newPass });
      assert.equal(verifyNew.status, 200);
      assert.ok(verifyNew.body.data.gameAccessToken);
    });

    it('6. Bỏ mật khẩu (removePassword: true) chuyển bộ câu hỏi sang trạng thái công khai không mật khẩu', async () => {
      const removePassGameId = `game_remove_pass_${Date.now()}`;
      createSampleGame({
        gameId: removePassGameId,
        title: 'Game Sẽ Bỏ Mật Khẩu',
        isPublic: true,
        password: 'PasswordToBeRemoved!',
      });

      const patchRes = await request(app)
        .patch(`/api/games/${removePassGameId}`)
        .send({
          removePassword: true,
          questions: [
            {
              id: 'q_rem_1',
              type: 'MULTIPLE_CHOICE',
              question: 'Bộ câu hỏi đã bỏ mật khẩu?',
              choices: ['A', 'B', 'C', 'D'],
              correctAnswer: 'A',
              difficulty: 'EASY',
              sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'local' },
            },
          ],
        });

      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.passwordProtected, false);

      // GET without any token now returns full questions immediately
      const getRes = await request(app).get(`/api/games/${removePassGameId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.passwordProtected, false);
      assert.equal(getRes.body.data.questions.length, 1);
    });

    it('7. Bộ câu hỏi cũ không có trường mật khẩu trong DB mặc định được xem là không có mật khẩu', async () => {
      const res = await request(app).get(`/api/games/${samplePublicGameId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.passwordProtected, false);
      assert.equal(res.body.data.questions.length, 2);
    });
  });

  // ========================================================
  // GROUP B: XÁC THỰC MẬT KHẨU & TOKEN TRUY CẬP
  // ========================================================
  describe('Group B: Xác thực mật khẩu và bảo vệ token truy cập', () => {
    it('8. Xác thực mật khẩu đúng trả về HTTP 200 và cấp gameAccessToken', async () => {
      const res = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: samplePassword });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.verified, true);
      assert.equal(res.body.data.gameId, sampleProtectedGameId);
      assert.match(res.body.data.gameAccessToken, /^gat_[0-9a-f]{64}$/);
      assert.ok(res.body.data.expiresAt);
    });

    it('9. Xác thực mật khẩu sai bị từ chối với HTTP 401 INVALID_CREDENTIALS', async () => {
      const res = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: 'MatKhauSaiHoanToan!' });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      assert.match(res.body.error.message, /mật khẩu.*không chính xác/i);
    });

    it('10. Gửi request xác thực thiếu mật khẩu hoặc rỗng bị từ chối với HTTP 400 INVALID_REQUEST', async () => {
      const resEmpty = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: '' });

      assert.equal(resEmpty.status, 400);
      assert.equal(resEmpty.body.error.code, 'INVALID_REQUEST');

      const resMissing = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({});

      assert.equal(resMissing.status, 400);
      assert.equal(resMissing.body.error.code, 'INVALID_REQUEST');
    });

    it('11. Ngăn chặn IDOR: gameAccessToken của Game A không thể dùng để truy cập Game B', async () => {
      // 1. Get token for Game A
      const authResA = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: samplePassword });
      assert.equal(authResA.status, 200);
      const tokenA = authResA.body.data.gameAccessToken;

      // 2. Try to access Game B with token A -> must be rejected with safe preview (questions: [])
      const resB = await request(app)
        .get(`/api/games/${sampleProtectedGameBId}`)
        .set('X-Game-Access-Token', tokenA);

      assert.equal(resB.status, 200);
      assert.equal(resB.body.data.passwordProtected, true);
      assert.equal(resB.body.data.requiresPassword, true);
      assert.equal(resB.body.data.questions.length, 0, 'Must NOT reveal Game B questions using Game A token');
    });

    it('12. Đổi ID trong request hoặc giả mạo token bị từ chối không có quyền truy cập', async () => {
      const fakeToken = 'gat_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const res = await request(app)
        .get(`/api/games/${sampleProtectedGameId}`)
        .set('X-Game-Access-Token', fakeToken);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.requiresPassword, true);
      assert.equal(res.body.data.questions.length, 0);
    });

    it('13. Chống brute-force: 5 lần thử mật khẩu sai liên tiếp kích hoạt HTTP 429 RATE_LIMIT_EXCEEDED', async () => {
      const bruteGameId = `game_brute_${Date.now()}`;
      createSampleGame({
        gameId: bruteGameId,
        title: 'Game Chống Brute Force',
        isPublic: true,
        password: 'ValidPassword123!',
      });

      // Send 5 incorrect attempts
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post(`/api/games/${bruteGameId}/verify-password`)
          .send({ password: `WrongAttempt_${i}` });
        assert.equal(res.status, 401);
      }

      // 6th attempt must be rejected with 429
      const blockedRes = await request(app)
        .post(`/api/games/${bruteGameId}/verify-password`)
        .send({ password: 'WrongAttempt_6' });

      assert.equal(blockedRes.status, 429);
      assert.equal(blockedRes.body.error.code, 'RATE_LIMIT_EXCEEDED');
      assert.ok(blockedRes.headers['retry-after']);
    });

    it('14. Quyền truy cập cũ bị thu hồi ngay lập tức khi người tạo đổi hoặc gỡ mật khẩu', async () => {
      const revokeGameId = `game_revoke_${Date.now()}`;
      createSampleGame({
        gameId: revokeGameId,
        title: 'Game Sẽ Thu Hồi Token',
        isPublic: true,
        password: 'OriginalPass123!',
      });

      // Get valid token with original pass
      const verifyRes = await request(app)
        .post(`/api/games/${revokeGameId}/verify-password`)
        .send({ password: 'OriginalPass123!' });
      assert.equal(verifyRes.status, 200);
      const token = verifyRes.body.data.gameAccessToken;

      // Access succeeds with token
      const accessBefore = await request(app)
        .get(`/api/games/${revokeGameId}`)
        .set('X-Game-Access-Token', token);
      assert.equal(accessBefore.status, 200);
      assert.equal(accessBefore.body.data.questions.length, 2);

      // Now creator updates the password
      await request(app)
        .patch(`/api/games/${revokeGameId}`)
        .send({
          passwordProtected: true,
          password: 'CompletelyNewPass456!',
          questions: [
            {
              id: 'q_rev_1',
              type: 'MULTIPLE_CHOICE',
              question: 'Câu hỏi mới?',
              choices: ['1', '2', '3', '4'],
              correctAnswer: '1',
              difficulty: 'EASY',
              sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'local' },
            },
          ],
        });

      // The old token MUST now be revoked and rejected
      const accessAfter = await request(app)
        .get(`/api/games/${revokeGameId}`)
        .set('X-Game-Access-Token', token);
      assert.equal(accessAfter.status, 200);
      assert.equal(accessAfter.body.data.requiresPassword, true);
      assert.equal(accessAfter.body.data.questions.length, 0, 'Old token must be completely revoked');
    });

    it('15. Mật khẩu không xuất hiện trong URL, query, log hay response', async () => {
      const res = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: samplePassword });

      assert.equal(res.status, 200);
      assert.equal(JSON.stringify(res.body).includes(samplePassword), false);
    });
  });

  // ========================================================
  // GROUP C: BẢO VỆ NỘI DUNG & CHỐNG RÒ RỈ DỮ LIỆU
  // ========================================================
  describe('Group C: Bảo vệ nội dung trước khi nhập mật khẩu', () => {
    it('16. Người chưa xác thực gọi GET /api/games/:gameId chỉ nhận metadata an toàn với questions: []', async () => {
      const res = await request(app).get(`/api/games/${sampleProtectedGameId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.passwordProtected, true);
      assert.equal(res.body.data.requiresPassword, true);
      assert.equal(res.body.data.title, 'Bộ Câu Hỏi Bảo Mật Cấp 1');
      assert.equal(Array.isArray(res.body.data.questions), true);
      assert.equal(res.body.data.questions.length, 0, 'Questions MUST be completely empty for unverified caller');
    });

    it('17. Sau khi xác thực đúng mật khẩu và gửi X-Game-Access-Token, lấy đầy đủ câu hỏi và cấu hình game', async () => {
      const authRes = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: samplePassword });
      const token = authRes.body.data.gameAccessToken;

      const res = await request(app)
        .get(`/api/games/${sampleProtectedGameId}`)
        .set('X-Game-Access-Token', token);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.passwordProtected, true);
      assert.equal(res.body.data.questions.length, 2);
      assert.equal(res.body.data.questions[0].question, 'Thủ đô của Việt Nam là thành phố nào?');
    });

    it('18. Không thể xuất dữ liệu (GET /:gameId/export) của game có mật khẩu nếu chưa xác thực (HTTP 401)', async () => {
      const resUnauth = await request(app).get(`/api/games/${sampleProtectedGameId}/export?format=json`);
      assert.equal(resUnauth.status, 401);
      assert.equal(resUnauth.body.error.code, 'PASSWORD_REQUIRED');

      // With token, export succeeds
      const authRes = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: samplePassword });
      const token = authRes.body.data.gameAccessToken;

      const resAuth = await request(app)
        .get(`/api/games/${sampleProtectedGameId}/export?format=json`)
        .set('X-Game-Access-Token', token);
      assert.equal(resAuth.status, 200);
    });

    it('19. GET /api/games (kho game) trả về passwordProtected: true nhưng tuyệt đối không lộ hash hay password', async () => {
      const res = await request(app).get('/api/games');
      assert.equal(res.status, 200);

      const found = res.body.data.games.find((g: any) => g.gameId === sampleProtectedGameId);
      assert.ok(found, 'Protected game must be listed in library');
      assert.equal(found.passwordProtected, true);
      assert.equal(found.password_hash, undefined);
      assert.equal(found.password, undefined);
    });

    it('20. Tạo phiên chơi đơn (POST /api/games/sessions) cho game có mật khẩu bị từ chối nếu không có gameAccessToken', async () => {
      const resBlocked = await request(app)
        .post('/api/games/sessions')
        .send({
          gameId: sampleProtectedGameId,
          publicPlay: true,
        });

      assert.equal(resBlocked.status, 401);
      assert.equal(resBlocked.body.error.code, 'PASSWORD_REQUIRED');
    });
  });

  // ========================================================
  // GROUP D: GAMEPLAY, QR VÀ MULTIPLAYER
  // ========================================================
  describe('Group D: Tích hợp QR, chơi đơn và chơi nhóm', () => {
    it('21. Game công khai (không mật khẩu) tạo phiên chơi đơn và nộp câu trả lời ngay không cần mật khẩu', async () => {
      const sessionRes = await request(app)
        .post('/api/games/sessions')
        .send({
          gameId: samplePublicGameId,
          publicPlay: true,
        });

      assert.equal(sessionRes.status, 200);
      const sessionId = sessionRes.body.data.sessionId;

      const startRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
      assert.equal(startRes.status, 200);
      assert.ok(startRes.body.data.question);
    });

    it('22. Game có mật khẩu tạo phiên chơi đơn thành công khi kèm X-Game-Access-Token và chơi bình thường', async () => {
      const authRes = await request(app)
        .post(`/api/games/${sampleProtectedGameId}/verify-password`)
        .send({ password: samplePassword });
      const token = authRes.body.data.gameAccessToken;

      const sessionRes = await request(app)
        .post('/api/games/sessions')
        .set('X-Game-Access-Token', token)
        .send({
          gameId: sampleProtectedGameId,
          publicPlay: true,
        });

      assert.equal(sessionRes.status, 200);
      const sessionId = sessionRes.body.data.sessionId;

      const startRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
      assert.equal(startRes.status, 200);
      assert.equal(startRes.body.data.question.question, 'Thủ đô của Việt Nam là thành phố nào?');
    });

    it('23. Multiplayer: Phòng chơi của game có mật khẩu hiển thị passwordProtected: true trong GET /api/rooms/:roomCode', async () => {
      const spec = gameStore.get(sampleProtectedGameId)!;
      const room = roomService.createRoom(spec, 50, null);

      const lobbyRes = await request(app).get(`/api/rooms/${room.roomCode}`);
      assert.equal(lobbyRes.status, 200);
      assert.equal(lobbyRes.body.data.roomCode, room.roomCode);
      assert.equal(lobbyRes.body.data.passwordProtected, true);
    });

    it('24. QR Code cho game có mật khẩu không nhúng mật khẩu vào link/QR payload', async () => {
      const qrRes = await request(app).get(`/api/games/${sampleProtectedGameId}/qr`);
      assert.equal(qrRes.status, 200);
      assert.ok(qrRes.body.data.playUrl);
      assert.ok(qrRes.body.data.qrDataUrl);
      assert.equal(qrRes.body.data.playUrl.includes(samplePassword), false);
      assert.equal(qrRes.body.data.playUrl.includes('scrypt$'), false);
    });
  });

  // ========================================================
  // GROUP E: GỠ BỎ HOÀN TOÀN CƠ CHẾ ADMIN CŨ
  // ========================================================
  describe('Group E: Gỡ bỏ hoàn toàn cơ chế Admin Single Password cũ', () => {
    it('25. Các endpoint Admin auth cũ (/api/admin/auth/login, /me, /logout) không còn tồn tại', async () => {
      // Unauthenticated request hits admin firewall and is rejected (no public auth route exists)
      const resLogin = await request(app).post('/api/admin/auth/login').send({ password: 'any' });
      assert.ok([401, 404].includes(resLogin.status), 'Public login route must not exist');

      // Even with a valid admin user session, the routes return 404 Not Found because adminAuthRouter was completely unmounted
      const db = getDatabase();
      const adminId = 'u_adm_test_verif';
      db.prepare(`INSERT OR REPLACE INTO users (user_id, email, display_name, password_hash, role, created_at, updated_at)
        VALUES (?, 'admin_verif@platform.local', 'Admin Test', 'hash', 'ADMIN', datetime('now'), datetime('now'))`).run(adminId);
      const { token: adminToken } = authService.createSessionForUser(adminId);

      const resMe = await request(app)
        .get('/api/admin/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(resMe.status, 404, 'Old /api/admin/auth/me must return 404');

      const resLogout = await request(app)
        .post('/api/admin/auth/logout')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(resLogout.status, 404, 'Old /api/admin/auth/logout must return 404');
    });

    it('26. Endpoint /api/admin/* vẫn được bảo vệ và từ chối request không có quyền Admin', async () => {
      const resOverview = await request(app).get('/api/admin/overview');
      assert.equal(resOverview.status, 401);
      assert.equal(resOverview.body.error.code, 'UNAUTHORIZED');
    });

    it('27. Hệ thống khởi động và chạy hoàn toàn không cần biến môi trường ADMIN_PASSWORD_HASH', () => {
      assert.equal(process.env.ADMIN_PASSWORD_HASH, undefined);
    });
  });
});

