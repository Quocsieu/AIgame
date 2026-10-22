import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { authService } from '../src/services/auth.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import type { GameSpecification } from '../src/contracts/game.contract.js';

describe('NO-PASSWORD ARCHITECTURE & DIRECT LINK/QR JOIN TEST SUITE', () => {
  let adminToken: string;
  let userTokenA: string;
  let userIdA: string;
  let userTokenB: string;
  let userIdB: string;
  const guestToken = 'gt_0123456789abcdef0123456789abcdef';
  const playerToken = 'pt_0123456789abcdef0123456789abcdef';

  function createSampleGame(params: {
    gameId: string;
    title: string;
    ownerUserId?: string | null;
    isPublic?: boolean;
  }): GameSpecification {
    const spec: GameSpecification = {
      gameId: params.gameId,
      ownerUserId: params.ownerUserId ?? null,
      isPublic: params.isPublic ?? true,
      title: params.title,
      description: 'Mô tả bộ câu hỏi không mật khẩu.',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: `q_${params.gameId}_1`,
          type: 'MULTIPLE_CHOICE',
          question: 'Thủ đô của Việt Nam là thành phố nào?',
          choices: ['Hà Nội', 'Đà Nẵng', 'Huế', 'TP Hồ Chí Minh'],
          correctAnswer: 'Hà Nội',
          explanation: 'Hà Nội là thủ đô của Việt Nam.',
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

    gameStore.save(spec, Date.now(), params.ownerUserId ?? null, params.isPublic ?? true);
    return spec;
  }

  before(async () => {
    resetAllRateLimiters();
    const ts = Date.now();
    const db = getDatabase();

    const admin = authService.register({
      email: `admin_nopass_${ts}@test.local`,
      password: 'AdminPassword123!',
      displayName: 'Admin User',
    });
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?").run(admin.user.userId);
    adminToken = admin.token;

    const userA = authService.register({
      email: `user_a_nopass_${ts}@test.local`,
      password: 'UserAPassword123!',
      displayName: 'Creator A',
    });
    userTokenA = userA.token;
    userIdA = userA.user.userId;

    const userB = authService.register({
      email: `user_b_nopass_${ts}@test.local`,
      password: 'UserBPassword123!',
      displayName: 'Creator B',
    });
    userTokenB = userB.token;
    userIdB = userB.user.userId;
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  // ========================================================
  // GROUP A: TẠO, SỬA, XÓA GAME KHÔNG CẦN MẬT KHẨU
  // ========================================================
  describe('Group A: Tạo, sửa, xóa game hoàn toàn không yêu cầu mật khẩu', () => {
    it('1. GET /api/games/:gameId trả về đầy đủ câu hỏi và không chứa cờ passwordProtected', async () => {
      const gameId = `game_nopass_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Hoàn Toàn Không Mật Khẩu' });

      const res = await request(app).get(`/api/games/${gameId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.gameId, gameId);
      assert.equal(res.body.data.passwordProtected, undefined);
      assert.equal(res.body.data.questions.length, 2);
    });

    it('2. PATCH /api/games/:gameId cập nhật câu hỏi thành công không cần mật khẩu', async () => {
      const gameId = `game_patch_nopass_${Date.now()}`;
      const game = createSampleGame({ gameId, title: 'Game Chờ Cập Nhật' });

      const res = await request(app)
        .patch(`/api/games/${gameId}`)
        .send({
          title: 'Game Đã Cập Nhật Không Cần Pass',
          questions: game.questions,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.title, 'Game Đã Cập Nhật Không Cần Pass');
      assert.equal(gameStore.get(gameId)?.title, 'Game Đã Cập Nhật Không Cần Pass');
    });

    it('3. DELETE /api/games/:gameId xóa game thành công mà không yêu cầu mật khẩu', async () => {
      const gameId = `game_del_nopass_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Chờ Xóa' });

      const res = await request(app).delete(`/api/games/${gameId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.deleted, true);
      assert.equal(gameStore.get(gameId), undefined);
    });

    it('4. GET /api/games (kho game) không chứa bất kỳ trường password hay password_hash nào', async () => {
      const gameId = `game_list_check_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Kiểm Tra Danh Sách' });

      const res = await request(app).get('/api/games');
      assert.equal(res.status, 200);
      assert.equal(Array.isArray(res.body.data.games), true);

      const found = res.body.data.games.find((g: any) => g.gameId === gameId);
      assert.ok(found);
      assert.equal(found.passwordProtected, undefined);
      assert.equal(found.password_hash, undefined);
      assert.equal(found.password, undefined);
    });
  });

  // ========================================================
  // GROUP B: GỠ BỎ TOÀN BỘ ENDPOINT VÀ TOKEN MẬT KHẨU
  // ========================================================
  describe('Group B: Gỡ bỏ endpoint xác thực mật khẩu cũ', () => {
    it('5. Endpoint POST /api/games/:gameId/verify-password trả về 404 Not Found', async () => {
      const gameId = `game_verify_404_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Thử Verify' });

      const res = await request(app)
        .post(`/api/games/${gameId}/verify-password`)
        .send({ password: 'SomePassword123!' });

      assert.equal(res.status, 404);
    });

    it('6. Các endpoint Admin auth cũ (/api/admin/auth/login, /me) không tồn tại (404/401)', async () => {
      const resLogin = await request(app).post('/api/admin/auth/login').send({ password: 'any' });
      assert.ok([401, 404].includes(resLogin.status));
    });
  });

  // ========================================================
  // GROUP C: BẢO VỆ PHÂN QUYỀN VÀ CƠ CHẾ SỞ HỮU
  // ========================================================
  describe('Group C: Phân quyền và bảo vệ quyền sở hữu không dựa vào mật khẩu', () => {
    it('7. User B KHÔNG THỂ sửa game thuộc sở hữu của User A (HTTP 403 ACCESS_DENIED)', async () => {
      const gameId = `game_owner_guard_edit_${Date.now()}`;
      const gameA = createSampleGame({ gameId, title: 'Game Của User A', ownerUserId: userIdA });

      const res = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({
          title: 'Sửa Trộm Bởi User B',
          questions: gameA.questions,
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCESS_DENIED');
      assert.equal(gameStore.get(gameId)?.title, 'Game Của User A');
    });

    it('8. User B KHÔNG THỂ xóa game thuộc sở hữu của User A (HTTP 403 ACCESS_DENIED)', async () => {
      const gameId = `game_owner_guard_del_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Của User A', ownerUserId: userIdA });

      const res = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${userTokenB}`);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ACCESS_DENIED');
      assert.ok(gameStore.get(gameId));
    });

    it('9. Guest Token (X-Guest-Token) bị chặn sửa và xóa game (HTTP 403 ACCESS_DENIED)', async () => {
      const gameId = `game_guest_guard_${Date.now()}`;
      const game = createSampleGame({ gameId, title: 'Game Khách Không Được Xóa' });

      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Guest-Token', guestToken);
      assert.equal(delRes.status, 403);
      assert.equal(delRes.body.error.code, 'ACCESS_DENIED');

      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('X-Guest-Token', guestToken)
        .send({ title: 'Khách Đổi Tên', questions: game.questions });
      assert.equal(patchRes.status, 403);
      assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');
    });

    it('10. Player Token (X-Player-Token) bị chặn sửa và xóa game (HTTP 403 ACCESS_DENIED)', async () => {
      const gameId = `game_player_guard_${Date.now()}`;
      const game = createSampleGame({ gameId, title: 'Game Người Chơi Không Được Sửa' });

      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('X-Player-Token', playerToken);
      assert.equal(delRes.status, 403);
      assert.equal(delRes.body.error.code, 'ACCESS_DENIED');

      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('X-Player-Token', playerToken)
        .send({ title: 'Player Đổi Tên', questions: game.questions });
      assert.equal(patchRes.status, 403);
      assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');
    });

    it('11. Admin có toàn quyền xóa hoặc sửa bất kỳ game nào (HTTP 200 OK)', async () => {
      const gameId = `game_admin_guard_${Date.now()}`;
      const game = createSampleGame({ gameId, title: 'Game Sẽ Do Admin Quản Lý', ownerUserId: userIdA });

      const patchRes = await request(app)
        .patch(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Tên Do Admin Sửa', questions: game.questions });
      assert.equal(patchRes.status, 200);

      const delRes = await request(app)
        .delete(`/api/games/${gameId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.deleted, true);
    });

    it('12. Không thể xóa game đang có phòng multiplayer hoạt động (HTTP 409 GAME_IN_USE)', async () => {
      const gameId = `game_in_use_${Date.now()}`;
      const spec = createSampleGame({ gameId, title: 'Game Đang Chạy Phòng' });

      const room = roomService.createRoom(spec, 50, null);
      assert.ok(room.roomCode);

      const delRes = await request(app).delete(`/api/games/${gameId}`);
      assert.equal(delRes.status, 409);
      assert.equal(delRes.body.error.code, 'GAME_IN_USE');

      // Close room and verify delete now succeeds
      roomStore.delete(room.roomId);
      const delSuccessRes = await request(app).delete(`/api/games/${gameId}`);
      assert.equal(delSuccessRes.status, 200);
      assert.equal(delSuccessRes.body.data.deleted, true);
    });
  });

  // ========================================================
  // GROUP D: NGƯỜI CHƠI THAM GIA KHÔNG MẬT KHẨU / LINK & QR
  // ========================================================
  describe('Group D: Người chơi tham gia qua Link/QR/Chơi đơn mà không cần mật khẩu', () => {
    it('13. Người chơi tạo phiên chơi đơn và bắt đầu chơi ngay không cần mật khẩu', async () => {
      const gameId = `game_solo_play_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Chơi Đơn' });

      // Create session
      const sessionRes = await request(app)
        .post('/api/games/sessions')
        .send({ gameId, publicPlay: true });
      assert.equal(sessionRes.status, 200);
      const sessionId = sessionRes.body.data.sessionId;

      // Start session
      const startRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
      assert.equal(startRes.status, 200);
      assert.equal(startRes.body.data.question.question, 'Thủ đô của Việt Nam là thành phố nào?');
    });

    it('14. Host tạo phòng multiplayer, GET /api/rooms/:roomCode không đòi hỏi mật khẩu', async () => {
      const gameId = `game_room_info_${Date.now()}`;
      const spec = createSampleGame({ gameId, title: 'Game Tạo Phòng' });
      const room = roomService.createRoom(spec, 50, null);

      const lobbyRes = await request(app).get(`/api/rooms/${room.roomCode}`);
      assert.equal(lobbyRes.status, 200);
      assert.equal(lobbyRes.body.data.roomCode, room.roomCode);
      assert.equal(lobbyRes.body.data.passwordProtected, undefined);
    });

    it('15. QR Code phòng chơi trả về URL tham gia trực tiếp (?room=roomCode) cho người chơi scan', async () => {
      const gameId = `game_qr_room_${Date.now()}`;
      const spec = createSampleGame({ gameId, title: 'Game QR Room' });
      const room = roomService.createRoom(spec, 50, null);

      const qrRes = await request(app).get(`/api/rooms/${room.roomCode}/qr`);
      assert.equal(qrRes.status, 200);
      assert.ok(qrRes.body.data.joinUrl);
      assert.ok(qrRes.body.data.qrDataUrl);
      assert.match(qrRes.body.data.joinUrl, /\?room=/);
      assert.equal(qrRes.body.data.joinUrl.includes('password'), false);
    });

    it('16. Người chơi tham gia phòng bằng addPlayer không cần bất kỳ mật khẩu nào', async () => {
      const gameId = `game_player_join_${Date.now()}`;
      const spec = createSampleGame({ gameId, title: 'Game Tham Gia Phòng' });
      const room = roomService.createRoom(spec, 50, null);

      const { player } = room.addPlayer('Học Sinh Thông Minh');
      assert.ok(player.playerToken);
      assert.equal(player.displayName, 'Học Sinh Thông Minh');
      assert.equal(room.players.size, 1);
    });

    it('17. Xuất dữ liệu game (GET /:gameId/export) hoạt động bình thường', async () => {
      const gameId = `game_export_${Date.now()}`;
      createSampleGame({ gameId, title: 'Game Xuất File' });

      const res = await request(app).get(`/api/games/${gameId}/export?format=json`);
      assert.equal(res.status, 200);
      assert.equal(res.body.gameId, gameId);
    });
  });
});
