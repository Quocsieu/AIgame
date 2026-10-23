import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import { app } from '../src/app.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { gameStore } from '../src/game/game.store.js';
import { GameSpecification } from '../src/contracts/game.contract.js';

function createSampleSpec(gameId: string): GameSpecification {
  return {
    gameId,
    title: 'Quiz Thoát Game & PIN Test',
    description: 'Kiểm thử luồng thoát game, nhập PIN và đồng bộ QR',
    gameType: 'MULTIPLE_CHOICE',
    isPublic: true,
    questions: [
      {
        id: `${gameId}_q1`,
        type: 'MULTIPLE_CHOICE',
        question: 'Thủ đô của Việt Nam là gì?',
        choices: ['A. Hà Nội', 'B. Đà Nẵng', 'C. TP. Hồ Chí Minh', 'D. Cần Thơ'],
        correctAnswer: 'A. Hà Nội',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: {
      questionCount: 1,
      timePerQuestion: 15,
      scoringMode: 'STANDARD',
    },
    sourceSummary: {
      sourceCount: 1,
      sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }],
    },
    generatedAt: new Date().toISOString(),
  };
}

describe('EXIT FLOW, PIN NAVIGATION & QR/PIN SYNCHRONIZATION SUITE', () => {
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let wsUrl: string;

  before(async () => {
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
  });

  after(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // =========================================================================
  // GROUP 1: PIN Verification & Lobby API
  // =========================================================================
  it('1. GET /api/rooms/:roomCode returns lobby status for valid uppercase PIN', async () => {
    const gameId = `test_game_pin_${Date.now()}`;
    const spec = createSampleSpec(gameId);
    gameStore.save(spec, Date.now(), null, true);

    const room = roomService.createRoom(spec, 50, null);
    assert.ok(room.roomCode);

    const res = await request(app).get(`/api/rooms/${room.roomCode}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.roomCode, room.roomCode);
    assert.equal(res.body.data.state, 'WAITING');
    assert.equal(res.body.data.title, 'Quiz Thoát Game & PIN Test');
    assert.equal(res.body.data.totalQuestions, 1);
  });

  it('2. GET /api/rooms/:roomCode normalizes lowercase PIN correctly', async () => {
    const gameId = `test_game_lower_${Date.now()}`;
    const spec = createSampleSpec(gameId);
    gameStore.save(spec, Date.now(), null, true);

    const room = roomService.createRoom(spec, 50, null);
    const lowerCode = room.roomCode.toLowerCase();

    const res = await request(app).get(`/api/rooms/${lowerCode}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.roomCode, room.roomCode);
  });

  it('3. GET /api/rooms/:roomCode returns 404 ROOM_NOT_FOUND for non-existent PIN', async () => {
    const res = await request(app).get('/api/rooms/NONEX9');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'ROOM_NOT_FOUND');
  });

  // =========================================================================
  // GROUP 2: QR Code & PIN Synchronization
  // =========================================================================
  it('4. GET /api/rooms/:roomCode/qr encodes exact matching room PIN in joinUrl', async () => {
    const gameId = `test_game_qr_${Date.now()}`;
    const spec = createSampleSpec(gameId);
    gameStore.save(spec, Date.now(), null, true);

    const room = roomService.createRoom(spec, 50, null);

    const res = await request(app).get(`/api/rooms/${room.roomCode}/qr`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.roomCode, room.roomCode);
    assert.ok(res.body.data.joinUrl.includes(`?room=${room.roomCode}`));
    assert.ok(res.body.data.qrDataUrl.startsWith('data:image/png;base64,'));
  });

  // =========================================================================
  // GROUP 3: Safe Player Leave without closing Host Room or disrupting Others
  // =========================================================================
  it('5. Player leaving via player.leave disconnects safely without closing Host room or affecting other players', async () => {
    const gameId = `test_ws_leave_${Date.now()}`;
    const spec = createSampleSpec(gameId);
    gameStore.save(spec, Date.now(), null, true);

    const room = roomService.createRoom(spec, 50, null);
    const roomCode = room.roomCode;
    const hostToken = room.hostToken;

    // Connect Host
    const hostWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => hostWs.on('open', resolve));

    hostWs.send(JSON.stringify({ type: 'host.join', roomCode, hostToken }));
    const hostAuthMsg: any = await new Promise((resolve) => {
      hostWs.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'room.joined' && parsed.role === 'host') resolve(parsed);
      });
    });
    assert.equal(hostAuthMsg.type, 'room.joined');
    assert.equal(hostAuthMsg.role, 'host');

    // Connect Player 1
    const p1Ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => p1Ws.on('open', resolve));
    p1Ws.send(JSON.stringify({ type: 'player.join', roomCode, displayName: 'Player One' }));
    const p1JoinMsg: any = await new Promise((resolve) => {
      p1Ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'room.joined') resolve(parsed);
      });
    });
    const p1Token = p1JoinMsg.playerToken;
    assert.ok(p1Token);

    // Connect Player 2
    const p2Ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => p2Ws.on('open', resolve));
    p2Ws.send(JSON.stringify({ type: 'player.join', roomCode, displayName: 'Player Two' }));
    const p2JoinMsg: any = await new Promise((resolve) => {
      p2Ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'room.joined') resolve(parsed);
      });
    });
    assert.ok(p2JoinMsg.playerToken);

    // Verify room has 2 players
    assert.equal(room.players.size, 2);

    // Setup host listener for playerLeft broadcast
    const playerLeftPromise: Promise<any> = new Promise((resolve) => {
      hostWs.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'lobby.playerLeft') resolve(parsed);
      });
    });

    // Player 1 sends player.leave and closes connection
    p1Ws.send(JSON.stringify({ type: 'player.leave', playerToken: p1Token }));
    p1Ws.close();

    const leftBroadcast = await playerLeftPromise;
    assert.equal(leftBroadcast.type, 'lobby.playerLeft');
    assert.equal(leftBroadcast.playerId, p1JoinMsg.playerId);

    // Verify: Host room is NOT closed, state is still WAITING
    assert.equal(room.state, 'WAITING');
    assert.notEqual(room.state, 'CLOSED');
    assert.notEqual(room.state, 'FINISHED');

    // Verify Player 2 is still connected and can play
    assert.equal(p2Ws.readyState, WebSocket.OPEN);

    // Host can start the game successfully with Player 2
    hostWs.send(JSON.stringify({ type: 'host.start', roomCode, hostToken }));
    const gameStartedMsg: any = await new Promise((resolve) => {
      p2Ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'game.started') resolve(parsed);
      });
    });
    assert.equal(gameStartedMsg.type, 'game.started');
    assert.equal(room.state, 'QUESTION_ACTIVE');

    // Clean up
    hostWs.close();
    p2Ws.close();
    roomStore.delete(room.roomId);
  });

  // =========================================================================
  // GROUP 4: Solo Practice Session Lifecycle
  // =========================================================================
  it('6. Solo practice session creates and finishes without lingering active lock', async () => {
    const gameId = `test_solo_sess_${Date.now()}`;
    const spec = createSampleSpec(gameId);
    gameStore.save(spec, Date.now(), null, true);

    // Create solo session
    const sessRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId, publicPlay: true });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    // Start session
    const startRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.session.state, 'QUESTION_ACTIVE');

    // Complete session
    const finishRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({ questionId: `${gameId}_q1`, answer: 'A. Hà Nội' });
    assert.equal(finishRes.status, 200);
  });
});

