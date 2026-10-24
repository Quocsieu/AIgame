import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { app } from '../src/app.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { authService } from '../src/services/auth.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { GameSpecification } from '../src/types/game.types.js';

describe('GAME LIFECYCLE MANAGEMENT & SAFE DELETION SUITE', () => {
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let wsUrl: string;

  let ownerToken: string;
  let ownerId: string;
  let strangerToken: string;
  let strangerId: string;

  before(async () => {
    // Start WebSocket test server
    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        wsUrl = `ws://localhost:${addr.port}/ws`;
        resolve();
      });
    });

    // Register users
    const regOwner = authService.register({
      email: `lifecycle_owner_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      displayName: 'Lifecycle Owner',
    });
    ownerId = regOwner.user.userId;
    ownerToken = regOwner.token;

    const regStranger = authService.register({
      email: `lifecycle_stranger_${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      displayName: 'Lifecycle Stranger',
    });
    strangerId = regStranger.user.userId;
    strangerToken = regStranger.token;
  });

  after(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  function createTestSpec(id: string, userId: string): GameSpecification {
    return {
      gameId: id,
      ownerUserId: userId,
      isPublic: true,
      title: `Lifecycle Test Game ${id}`,
      description: `Description for ${id}`,
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: `${id}_q1`,
          type: 'MULTIPLE_CHOICE',
          question: 'Capital of Vietnam?',
          choices: ['Hà Nội', 'Sài Gòn', 'Đà Nẵng', 'Huế'],
          correctAnswer: 'Hà Nội',
          difficulty: 'EASY',
          sourceReference: {
            sourceId: 'src_1',
            sourceType: 'TXT',
            sourceLocation: 'inline',
          },
        },
        {
          id: `${id}_q2`,
          type: 'MULTIPLE_CHOICE',
          question: 'Largest city of Vietnam by population?',
          choices: ['TP Hồ Chí Minh', 'Hà Nội', 'Hải Phòng', 'Cần Thơ'],
          correctAnswer: 'TP Hồ Chí Minh',
          difficulty: 'MEDIUM',
          sourceReference: {
            sourceId: 'src_2',
            sourceType: 'TXT',
            sourceLocation: 'inline',
          },
        },
      ],
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_1',
            sourceType: 'TXT',
            sourceName: 'Sample 1',
            sourceLocation: 'inline',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // GROUP I: CHƠI ĐƠN (SOLO PRACTICE LIFECYCLE)
  // =========================================================================

  it('1. Game có phiên chơi đơn hoạt động -> Kho Game nhận diện đúng chế độ', async () => {
    const gameId = `solo_status_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Create & start solo session
    const sessRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Check status in Kho Game status API
    const statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.data.hasActiveSession, true);
    assert.equal(statusRes.body.data.activeSessionCount, 1);
    assert.equal(statusRes.body.data.hasActiveRoom, false);
    assert.equal(statusRes.body.data.isDeletable, false);
  });

  it('2. Người tạo kết thúc phiên hợp lệ -> phiên được đóng và trạng thái cập nhật', async () => {
    const gameId = `solo_end_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const sessRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessionId = sessRes.body.data.sessionId;

    await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // End session
    const endRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(endRes.status, 200);
    assert.equal(endRes.body.data.ended, true);
    assert.equal(endRes.body.data.session.state, 'ABANDONED');

    // Status updated
    const statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.hasActiveSession, false);
    assert.equal(statusRes.body.data.isDeletable, true);
  });

  it('3. Game không còn phiên/phòng hoạt động -> xóa được', async () => {
    const gameId = `solo_del_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.data.deleted, true);
  });

  it('4. Game có nhiều phiên chơi đơn -> kết thúc một phiên không kết thúc các phiên khác', async () => {
    const gameId = `multi_solo_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Create session 1
    const s1Res = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const s1Id = s1Res.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${s1Id}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Create session 2
    const s2Res = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const s2Id = s2Res.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${s2Id}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Verify 2 active sessions
    let status = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(status.body.data.activeSessionCount, 2);

    // End session 1 only
    await request(app)
      .post(`/api/games/sessions/${s1Id}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Verify session 2 is still active
    status = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(status.body.data.activeSessionCount, 1);
    assert.equal(status.body.data.hasActiveSession, true);
    assert.equal(status.body.data.isDeletable, false);

    // End session 2
    await request(app)
      .post(`/api/games/sessions/${s2Id}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    status = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(status.body.data.hasActiveSession, false);
    assert.equal(status.body.data.isDeletable, true);
  });

  it('5. Kết thúc phiên không xóa kết quả đã lưu trong SQLite', async () => {
    const gameId = `solo_persist_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessionId = sRes.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Answer Q1 correctly
    await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ questionId: `${gameId}_q1`, answer: 'Hà Nội' });

    // End session
    await request(app)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Check persistence record
    const persisted = persistenceRepo.getPracticeSessionById(sessionId);
    assert.ok(persisted);
    assert.equal(persisted.sessionId, sessionId);
    assert.equal(persisted.correctAnswers, 1);
  });

  it('6. Người không có quyền không thể kết thúc phiên (403 ACCESS_DENIED)', async () => {
    const gameId = `unauth_end_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessionId = sRes.body.data.sessionId;

    // Stranger tries to end owner session
    const failRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${strangerToken}`);
    assert.equal(failRes.status, 403);
    assert.equal(failRes.body.error.code, 'ACCESS_DENIED');
  });

  it('7. Người chơi không thể tiếp tục gửi câu trả lời sau khi phiên bị kết thúc', async () => {
    const gameId = `answ_ended_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessionId = sRes.body.data.sessionId;

    await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // End session
    await request(app)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Player attempts to answer
    const answRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ questionId: `${gameId}_q1`, answer: 'Hà Nội' });
    assert.equal(answRes.status, 400);
    assert.equal(answRes.body.error.code, 'INVALID_GAME_STATE');
  });

  // =========================================================================
  // GROUP II: CHƠI NHÓM (MULTIPLAYER LIFECYCLE)
  // =========================================================================

  it('8. Phòng đang chờ người chơi -> hiển thị đúng trạng thái WAITING', async () => {
    const gameId = `room_wait_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    assert.equal(roomRes.status, 200);
    const roomCode = roomRes.body.data.roomCode;

    const statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.hasActiveRoom, true);
    assert.equal(statusRes.body.data.activeRoomCount, 1);
    assert.equal(statusRes.body.data.activeRooms[0].roomCode, roomCode);
    assert.equal(statusRes.body.data.activeRooms[0].state, 'WAITING');
    assert.equal(statusRes.body.data.isDeletable, false);

    // Clean up
    roomStore.clear();
  });

  it('9. Phòng đang chơi -> hiển thị chế độ chơi nhóm và thông tin phòng hợp lệ', async () => {
    const gameId = `room_play_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const room = roomService.createRoom(spec, 50, ownerId);
    room.addPlayer('Alice');
    room.start(room.hostToken);

    const statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.hasActiveRoom, true);
    assert.equal(statusRes.body.data.activeRooms[0].state, 'QUESTION_ACTIVE');

    roomStore.clear();
  });

  it('10. Trận đấu kết thúc -> phòng đóng và giải phóng khóa xóa game', async () => {
    const gameId = `room_finish_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const room = roomService.createRoom(spec, 50, ownerId);
    room.addPlayer('Alice');
    room.start(room.hostToken);

    // End match
    room.endGame(room.hostToken);
    assert.equal(room.state, 'FINISHED');

    const statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.hasActiveRoom, false);
    assert.equal(statusRes.body.data.isDeletable, true);

    roomStore.clear();
  });

  it('11. Người chơi rời phòng không làm đóng phòng của tất cả người khác', async () => {
    const gameId = `room_leave_iso_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const room = roomService.createRoom(spec, 50, ownerId);
    const { player: p1 } = room.addPlayer('Alice');
    const { player: p2 } = room.addPlayer('Bob');
    assert.equal(room.players.size, 2);

    // Player 1 disconnects
    room.disconnectPlayer(p1.playerToken);
    assert.equal(room.players.size, 2); // player record kept for leaderboard
    assert.equal(room.state, 'WAITING'); // room still active

    // Bob can still play and host can start
    room.start(room.hostToken);
    assert.equal(room.state, 'QUESTION_ACTIVE');

    roomStore.clear();
  });

  it('12. Chơi lại tạo phòng mới và PIN mới theo cơ chế hiện tại', async () => {
    const gameId = `room_rematch_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Room 1
    const r1Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const code1 = r1Res.body.data.roomCode;

    // Close Room 1
    await request(app)
      .post(`/api/rooms/${code1}/close`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Room 2 (rematch)
    const r2Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const code2 = r2Res.body.data.roomCode;

    assert.notEqual(code1, code2);
    assert.equal(code2.length, 6);

    roomStore.clear();
  });

  it('13. Phòng đã đóng không nhận người chơi hoặc câu trả lời mới', async () => {
    const gameId = `room_closed_deny_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const room = roomService.createRoom(spec, 50, ownerId);
    const { player } = room.addPlayer('Existing Player');
    room.close();

    // Adding player fails
    assert.throws(() => {
      room.addPlayer('Late Player');
    }, /(finished or closed|GAME_FINISHED)/);

    // Submitting answer fails
    assert.throws(() => {
      room.submitPlayerAnswer(player.playerToken, `${gameId}_q1`, 'A');
    }, /(Question is not currently active|INVALID_ROOM_STATE)/);

    roomStore.clear();
  });

  // =========================================================================
  // GROUP III: BẢO VỆ XÓA GAME (DELETE PROTECTION MATRIX)
  // =========================================================================

  it('14. Phiên chơi đơn hoạt động -> DELETE trả 409 GAME_IN_USE', async () => {
    const gameId = `del_lock_solo_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    await request(app)
      .post(`/api/games/sessions/${sRes.body.data.sessionId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');
    assert.ok(delRes.body.error.message.includes('Không thể xóa bộ câu hỏi đang có phiên'));

    sessionStore.clear();
  });

  it('15. Phòng chơi nhóm hoạt động -> DELETE trả 409 GAME_IN_USE', async () => {
    const gameId = `del_lock_room_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });

    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');

    roomStore.clear();
  });

  it('16. Vừa còn phiên đơn vừa còn phòng nhóm -> DELETE vẫn bị chặn', async () => {
    const gameId = `del_lock_both_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Solo session
    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    await request(app)
      .post(`/api/games/sessions/${sRes.body.data.sessionId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Multiplayer room
    await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });

    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');

    sessionStore.clear();
    roomStore.clear();
  });

  it('17. Kết thúc phiên đơn nhưng phòng nhóm vẫn hoạt động -> DELETE vẫn bị chặn', async () => {
    const gameId = `del_end_solo_keep_room_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Solo session
    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessId = sRes.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${sessId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Multiplayer room
    await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });

    // End solo session
    await request(app)
      .post(`/api/games/sessions/${sessId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Room still active -> delete must still be blocked
    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');

    roomStore.clear();
  });

  it('18. Kết thúc phòng nhóm nhưng phiên đơn vẫn hoạt động -> DELETE vẫn bị chặn', async () => {
    const gameId = `del_end_room_keep_solo_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Solo session
    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessId = sRes.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${sessId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Multiplayer room
    const rRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const roomCode = rRes.body.data.roomCode;

    // Close room
    await request(app)
      .post(`/api/rooms/${roomCode}/close`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Solo still active -> delete must still be blocked
    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.error.code, 'GAME_IN_USE');

    sessionStore.clear();
  });

  it('19. Không còn phiên/phòng hoạt động -> DELETE thành công', async () => {
    const gameId = `del_free_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // Solo session
    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessId = sRes.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${sessId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Room
    const rRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const roomCode = rRes.body.data.roomCode;

    // Release both
    await request(app)
      .post(`/api/games/sessions/${sessId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    await request(app)
      .post(`/api/rooms/${roomCode}/close`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // DELETE now succeeds 200
    const delRes = await request(app)
      .delete(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.data.deleted, true);
  });

  it('20. Kho Game cập nhật trạng thái chính xác sau khi kết thúc phiên/phòng', async () => {
    const gameId = `status_sync_${Date.now()}`;
    const spec = createTestSpec(gameId, ownerId);
    gameStore.save(spec, Date.now(), ownerId, true);

    // 1. Initial: deletable
    let statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.isDeletable, true);

    // 2. Start solo session: locked
    const sRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ gameId });
    const sessId = sRes.body.data.sessionId;
    await request(app)
      .post(`/api/games/sessions/${sessId}/start`)
      .set('Authorization', `Bearer ${ownerToken}`);

    statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.hasActiveSession, true);
    assert.equal(statusRes.body.data.isDeletable, false);

    // 3. End session: unlocked
    await request(app)
      .post(`/api/games/sessions/${sessId}/end`)
      .set('Authorization', `Bearer ${ownerToken}`);

    statusRes = await request(app)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(statusRes.body.data.hasActiveSession, false);
    assert.equal(statusRes.body.data.isDeletable, true);
  });
});
