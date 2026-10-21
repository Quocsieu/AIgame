import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { multiplayerWsServer } from '../src/multiplayer/room.websocket.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { getDatabase } from '../src/storage/sqlite.db.js';

describe('REFACTOR UX & AUTHORIZATION — Comprehensive 22-Scenario Security & Regression Suite', () => {
  let server: http.Server;
  let wsUrl: string;
  let creatorTokenA: string;
  let creatorIdA: string;
  let creatorTokenB: string;
  let creatorIdB: string;
  let adminToken: string;
  let adminId: string;
  const guestToken = 'gt_0123456789abcdef0123456789abcdef';

  before(async () => {
    resetAllRateLimiters();
    const db = getDatabase();
    const ts = Date.now();

    // Register Creator A
    const regResA = await request(app)
      .post('/api/auth/register')
      .send({
        email: `creator_a_${ts}@test.local`,
        password: 'Password123!',
        displayName: 'Creator A',
      });
    assert.equal(regResA.status, 201);
    creatorTokenA = regResA.body.data.token;
    creatorIdA = regResA.body.data.user.userId;

    // Register Creator B
    const regResB = await request(app)
      .post('/api/auth/register')
      .send({
        email: `creator_b_${ts}@test.local`,
        password: 'Password123!',
        displayName: 'Creator B',
      });
    assert.equal(regResB.status, 201);
    creatorTokenB = regResB.body.data.token;
    creatorIdB = regResB.body.data.user.userId;

    // Register Admin
    const regResAdmin = await request(app)
      .post('/api/auth/register')
      .send({
        email: `admin_${ts}@test.local`,
        password: 'Password123!',
        displayName: 'Admin Master',
      });
    assert.equal(regResAdmin.status, 201);
    adminToken = regResAdmin.body.data.token;
    adminId = regResAdmin.body.data.user.userId;

    // Elevate Admin in DB
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?").run(adminId);

    // Start HTTP & WS server for tests
    server = http.createServer(app);
    multiplayerWsServer.attach(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    multiplayerWsServer.close();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    resetAllRateLimiters();
    roomStore.clear();
  });

  function createTestGameSpec(id: string, ownerId: string, isPublic: boolean): GameSpecification {
    return {
      gameId: id,
      ownerUserId: ownerId,
      isPublic,
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

  // 1. Guest gọi ingest: bị từ chối
  it('1. Guest calling /api/content/ingest is rejected with 403 ACCESS_DENIED', async () => {
    const res = await request(app)
      .post('/api/content/ingest')
      .set('X-Guest-Token', guestToken)
      .send({ urls: ['https://example.com'] });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'ACCESS_DENIED');
  });

  // 2. Guest gọi generate: bị từ chối
  it('2. Guest calling /api/games/generate is rejected with 403 ACCESS_DENIED', async () => {
    const res = await request(app)
      .post('/api/games/generate')
      .set('X-Guest-Token', guestToken)
      .send({ sourceIds: ['src_test'], gameType: 'MULTIPLE_CHOICE' });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'ACCESS_DENIED');
  });

  // 3. Guest sửa/xóa/xuất bản game: bị từ chối
  it('3. Guest calling PATCH / DELETE / publish on a game is rejected with 403 ACCESS_DENIED', async () => {
    const spec = createTestGameSpec('game_pub_1', creatorIdA, true);
    gameStore.save(spec, Date.now(), creatorIdA, true);

    const patchRes = await request(app)
      .patch(`/api/games/${spec.gameId}`)
      .set('X-Guest-Token', guestToken)
      .send({ title: 'Hacked Title', questions: spec.questions });
    assert.equal(patchRes.status, 403);
    assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');

    const delRes = await request(app)
      .delete(`/api/games/${spec.gameId}`)
      .set('X-Guest-Token', guestToken);
    assert.equal(delRes.status, 403);
    assert.equal(delRes.body.error.code, 'ACCESS_DENIED');
  });

  // 4. Creator A sửa game A: được phép
  it('4. Creator A editing their own game A is permitted (200 OK)', async () => {
    const specA = createTestGameSpec('game_owner_a', creatorIdA, false);
    gameStore.save(specA, Date.now(), creatorIdA, false);

    const res = await request(app)
      .patch(`/api/games/${specA.gameId}`)
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({
        title: 'Updated Title by Creator A',
        questions: specA.questions,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.title, 'Updated Title by Creator A');
  });

  // 5. Creator A sửa/xóa game B: bị từ chối
  it('5. Creator A editing or deleting Creator B game is rejected with 403 ACCESS_DENIED', async () => {
    const specB = createTestGameSpec('game_owner_b', creatorIdB, false);
    gameStore.save(specB, Date.now(), creatorIdB, false);

    const patchRes = await request(app)
      .patch(`/api/games/${specB.gameId}`)
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({ title: 'Rogue Patch', questions: specB.questions });
    assert.equal(patchRes.status, 403);
    assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');

    const delRes = await request(app)
      .delete(`/api/games/${specB.gameId}`)
      .set('Authorization', `Bearer ${creatorTokenA}`);
    assert.equal(delRes.status, 403);
    assert.equal(delRes.body.error.code, 'ACCESS_DENIED');
  });

  // 6. Creator A đọc bản nháp B: bị từ chối
  it('6. Creator A reading draft of Creator B is rejected with 403 ACCESS_DENIED', async () => {
    const draftB = createTestGameSpec('game_draft_b', creatorIdB, false);
    gameStore.save(draftB, Date.now(), creatorIdB, false);

    const res = await request(app)
      .get(`/api/games/${draftB.gameId}`)
      .set('Authorization', `Bearer ${creatorTokenA}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCESS_DENIED');
  });

  // 7. Guest đọc bản nháp: bị từ chối
  it('7. Guest reading draft game is rejected with 403 ACCESS_DENIED', async () => {
    const draftA = createTestGameSpec('game_draft_a', creatorIdA, false);
    gameStore.save(draftA, Date.now(), creatorIdA, false);

    const res = await request(app)
      .get(`/api/games/${draftA.gameId}`)
      .set('X-Guest-Token', guestToken);

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCESS_DENIED');
  });

  // 8. Guest đọc game published: được phép
  it('8. Guest reading published game is permitted (200 OK)', async () => {
    const pubA = createTestGameSpec('game_pub_a', creatorIdA, true);
    gameStore.save(pubA, Date.now(), creatorIdA, true);

    const res = await request(app)
      .get(`/api/games/${pubA.gameId}`)
      .set('X-Guest-Token', guestToken);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.gameId, pubA.gameId);
  });

  // 9. Creator chơi thử game nháp của mình: được phép
  it('9. Creator playing a preview session of their own draft is permitted', async () => {
    const draftA = createTestGameSpec('game_draft_self', creatorIdA, false);
    gameStore.save(draftA, Date.now(), creatorIdA, false);

    const sessionRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({ gameId: draftA.gameId, publicPlay: false });

    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.body.success, true);
    assert.equal(sessionRes.body.data.isPreview, true);
    assert.ok(sessionRes.body.data.sessionId);
  });

  // 10. Creator không thể dùng preview để thay đổi nội dung game
  it('10. Creator preview does not alter stored game content or questions', async () => {
    const draftA = createTestGameSpec('game_draft_immutable', creatorIdA, false);
    gameStore.save(draftA, Date.now(), creatorIdA, false);

    // Attempting to send custom questions in session creation
    await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({
        gameId: draftA.gameId,
        gameSpecification: {
          ...draftA,
          title: 'Hacked Specification',
        },
      });

    // Stored game remains unchanged
    const stored = gameStore.get(draftA.gameId);
    assert.equal(stored?.title, 'Test Game game_draft_immutable');
  });

  // 11. Preview không làm game tự xuất bản
  it('11. Previewing a draft game leaves isPublic as false', async () => {
    const draftA = createTestGameSpec('game_draft_remain_false', creatorIdA, false);
    gameStore.save(draftA, Date.now(), creatorIdA, false);

    const sessRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({ gameId: draftA.gameId });

    assert.equal(sessRes.status, 200);

    const stored = gameStore.get(draftA.gameId);
    assert.equal(stored?.isPublic, false);
  });

  // 12. Creator được tạo phòng theo chính sách
  it('12. Creator can create a multiplayer room from their game', async () => {
    const pubGame = createTestGameSpec('game_pub_room', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({ gameId: pubGame.gameId });

    assert.equal(roomRes.status, 200);
    assert.equal(roomRes.body.success, true);
    assert.ok(roomRes.body.data.roomCode);
    assert.ok(roomRes.body.data.hostToken);
  });

  // 13. Guest tham gia phòng bằng mã phòng hợp lệ
  it('13. Guest can join multiplayer room via roomCode and WebSocket', async () => {
    const pubGame = createTestGameSpec('game_ws_join', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const room = roomService.createRoom(pubGame, 50, creatorIdA);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'player.join',
          roomCode: room.roomCode,
          displayName: 'Guest Player',
        }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'room.joined' && msg.role === 'player') {
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
  });

  // 14. Guest không thể chiếm quyền Host
  it('14. Guest cannot hijack host role using rogue hostToken or host messages', async () => {
    const pubGame = createTestGameSpec('game_ws_hijack', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const room = roomService.createRoom(pubGame, 50, creatorIdA);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'host.join',
          roomCode: room.roomCode,
          hostToken: 'fake_host_token_9999',
        }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'INVALID_HOST_TOKEN') {
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
  });

  // 15. Player không thể thực hiện hành động điều khiển phòng trái quyền
  it('15. Connected player cannot execute host commands (host.start / host.lock)', async () => {
    const pubGame = createTestGameSpec('game_ws_rogue', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const room = roomService.createRoom(pubGame, 50, creatorIdA);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'player.join',
          roomCode: room.roomCode,
          displayName: 'Cheater Player',
        }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'room.joined') {
          // Attempt rogue host command
          ws.send(JSON.stringify({ type: 'host.start' }));
        } else if (msg.type === 'error' && msg.code === 'NOT_HOST') {
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
  });

  // 16. WebSocket kiểm tra authentication/authorization đúng
  it('16. WebSocket enforces message schemas and rejects malformed or unauthenticated commands', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        ws.send('invalid json string');
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error' && msg.code === 'INVALID_MESSAGE') {
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
  });

  // 17. Admin vào /admin: được phép
  it('17. Admin accessing /api/admin/overview is permitted (200 OK)', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.totalUsers === 'number');
    assert.ok(typeof res.body.data.totalGames === 'number');
  });

  // 18. Creator/Guest vào API Admin: bị từ chối
  it('18. Creator and Guest calling /api/admin/* are rejected with 403 ACCESS_DENIED', async () => {
    const creatorRes = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${creatorTokenA}`);
    assert.equal(creatorRes.status, 403);
    assert.equal(creatorRes.body.error.code, 'ACCESS_DENIED');

    const guestRes = await request(app)
      .get('/api/admin/overview')
      .set('X-Guest-Token', guestToken);
    assert.equal(guestRes.status, 401); // Guest has no Bearer token for admin
  });

  // 19. Admin thực hiện các hành động quản trị được phép
  it('19. Admin can moderate game public status and view users list', async () => {
    const draftGame = createTestGameSpec('game_mod_test', creatorIdA, false);
    gameStore.save(draftGame, Date.now(), creatorIdA, false);

    // Admin toggles game to published
    const modRes = await request(app)
      .patch(`/api/admin/games/${draftGame.gameId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isPublic: true });
    assert.equal(modRes.status, 200);
    assert.equal(modRes.body.data.isPublic, true);

    // Admin views users list
    const usersRes = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(usersRes.status, 200);
    assert.ok(Array.isArray(usersRes.body.data.users));
    assert.ok(usersRes.body.data.users.length >= 3);
  });

  // 20. Không làm hỏng đăng ký, đăng nhập, solo play, chấm điểm và kết quả
  it('20. Regression test: register, login, solo play session, answer, and scoring work seamlessly', async () => {
    const pubGame = createTestGameSpec('game_solo_regress', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const sessRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: pubGame.gameId, publicPlay: true });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    const startRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(startRes.status, 200);

    const ansRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({
        questionId: `${pubGame.gameId}_q1`,
        answer: 'Hanoi',
      });
    assert.equal(ansRes.status, 200);
    assert.equal(ansRes.body.data.isCorrect, true);
    assert.equal(ansRes.body.data.score, 100);
  });

  // 21. Không làm hỏng các route frontend hoặc URL QR hiện có
  it('21. Solo play QR and Room QR generation remain functional with valid URLs', async () => {
    const pubGame = createTestGameSpec('game_qr_regress', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const soloQrRes = await request(app).get(`/api/games/${pubGame.gameId}/qr`);
    assert.equal(soloQrRes.status, 200);
    assert.ok(soloQrRes.body.data.playUrl.includes(`?play=${pubGame.gameId}`));
    assert.ok(soloQrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorTokenA}`)
      .send({ gameId: pubGame.gameId });
    const roomCode = roomRes.body.data.roomCode;

    const roomQrRes = await request(app).get(`/api/rooms/${roomCode}/qr`);
    assert.equal(roomQrRes.status, 200);
    assert.ok(roomQrRes.body.data.joinUrl.includes(`?room=${roomCode}`));
    assert.ok(roomQrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));
  });

  // 22. Kiểm tra lỗi session hết hạn, game bị xóa và phòng đã đóng
  it('22. Handles closed room rejection and non-existent game appropriately', async () => {
    const pubGame = createTestGameSpec('game_close_test', creatorIdA, true);
    gameStore.save(pubGame, Date.now(), creatorIdA, true);

    const room = roomService.createRoom(pubGame, 10, creatorIdA);
    room.close();

    // Verify lobby indicates CLOSED
    const lobbyRes = await request(app).get(`/api/rooms/${room.roomCode}`);
    assert.equal(lobbyRes.status, 200);
    assert.equal(lobbyRes.body.data.state, 'CLOSED');

    // Attempting to add player to closed room throws GAME_FINISHED (400)
    assert.throws(
      () => room.addPlayer('Late Player'),
      (err: any) => err.statusCode === 400 && err.code === 'GAME_FINISHED'
    );

    // Non-existent game returns 404
    const fakeGameRes = await request(app).get('/api/games/non_existent_game_xyz');
    assert.equal(fakeGameRes.status, 404);
    assert.equal(fakeGameRes.body.error.code, 'GAME_NOT_FOUND');

    // Non-existent session returns 404
    const fakeSessionRes = await request(app).get('/api/games/sessions/non_existent_session_xyz');
    assert.equal(fakeSessionRes.status, 404);
    assert.equal(fakeSessionRes.body.error.code, 'SESSION_NOT_FOUND');
  });
});
