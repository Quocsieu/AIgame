import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';

function createSampleSpec(): GameSpecification {
  return {
    gameId: 'game_cp4_test',
    title: 'Checkpoint 4 Multiplayer Quiz',
    description: 'Testing F5 reconnect, state recovery, security and lock mechanics',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_cp4_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 1: Giao thức nào hỗ trợ kết nối hai chiều thời gian thực?',
        choices: ['A. HTTP/1.0', 'B. WebSocket', 'C. SMTP', 'D. FTP'],
        correctAnswer: 'B. WebSocket',
        explanation: 'WebSocket cung cấp kênh giao tiếp hai chiều thời gian thực.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
      {
        id: 'q_cp4_2',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 2: Cơ chế nào bảo vệ Host khỏi việc bị giả mạo?',
        choices: ['A. Token bí mật do server sinh', 'B. Tên người dùng', 'C. Cookie tùy ý', 'D. Không cần bảo vệ'],
        correctAnswer: 'A. Token bí mật do server sinh',
        explanation: 'Server sinh hostToken ngẫu nhiên và kiểm tra nghiêm ngặt.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 2, timePerQuestion: 20, scoringMode: 'STANDARD' },
    sourceSummary: {
      sourceCount: 1,
      sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }],
    },
    generatedAt: new Date().toISOString(),
  };
}

describe('CHECKPOINT 4 — Multiplayer, Host/Player Session Recovery, Security & Room Locking', () => {
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

  beforeEach(() => {
    roomStore.clear();
  });

  afterEach(() => {
    roomStore.clear();
  });

  function createClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws: WebSocket, predicate?: (msg: any) => boolean): Promise<any> {
    return new Promise((resolve) => {
      const listener = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (!predicate || predicate(parsed)) {
            ws.off('message', listener);
            resolve(parsed);
          }
        } catch {}
      };
      ws.on('message', listener);
    });
  }

  it('1. Host F5/reconnect recovers room state, existing players list, active question and timer deadline', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    // 1. Player joins room first
    const p1 = await createClient();
    const waitP1Join = waitForMessage(p1, (m) => m.type === 'room.joined');
    p1.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Minh Tuấn',
      })
    );
    await waitP1Join;

    // 2. Host joins room
    const host1 = await createClient();
    const waitHost1 = waitForMessage(host1, (m) => m.type === 'room.joined');
    host1.send(
      JSON.stringify({
        type: 'host.join',
        roomCode: room.roomCode,
        hostToken: room.hostToken,
      })
    );
    const hostJoinMsg = await waitHost1;
    assert.equal(hostJoinMsg.role, 'host');
    assert.equal(hostJoinMsg.state, 'WAITING');
    assert.equal(hostJoinMsg.playerCount, 1);
    assert.equal(hostJoinMsg.players.length, 1);
    assert.equal(hostJoinMsg.players[0].displayName, 'Minh Tuấn');

    // Host starts game
    const waitStart = waitForMessage(host1, (m) => m.type === 'question.started');
    host1.send(JSON.stringify({ type: 'host.start' }));
    const startMsg = await waitStart;
    assert.equal(startMsg.question.id, 'q_cp4_1');

    // 3. Host simulates F5 (closes socket and reconnects with same roomCode and hostToken)
    host1.close();

    const host2 = await createClient();
    const waitHost2Join = waitForMessage(host2, (m) => m.type === 'room.joined');
    const waitHost2Q = waitForMessage(host2, (m) => m.type === 'question.started');

    host2.send(
      JSON.stringify({
        type: 'host.join',
        roomCode: room.roomCode,
        hostToken: room.hostToken,
      })
    );

    const reconnectedJoin = await waitHost2Join;
    assert.equal(reconnectedJoin.role, 'host');
    assert.equal(reconnectedJoin.state, 'QUESTION_ACTIVE');
    assert.equal(reconnectedJoin.players.length, 1);

    const reconnectedQ = await waitHost2Q;
    assert.equal(reconnectedQ.question.id, 'q_cp4_1');
    assert.ok(reconnectedQ.question.deadlineAt > Date.now());

    p1.close();
    host2.close();
  });

  it('2. Player F5/reconnect does not create duplicate players, does not duplicate scores, and restores answered state', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const host = await createClient();
    const waitHostJoin = waitForMessage(host, (m) => m.type === 'room.joined');
    host.send(
      JSON.stringify({
        type: 'host.join',
        roomCode: room.roomCode,
        hostToken: room.hostToken,
      })
    );
    await waitHostJoin;

    // Player 1 joins
    const p1 = await createClient();
    const waitP1Join = waitForMessage(p1, (m) => m.type === 'room.joined');
    p1.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Lan Anh',
      })
    );
    const p1Joined = await waitP1Join;
    const playerToken = p1Joined.playerToken;
    const playerId = p1Joined.playerId;
    assert.ok(playerToken);
    assert.ok(playerId);

    // Player 2 joins (to keep question active after Player 1 answers)
    const pOther = await createClient();
    const waitOtherJoin = waitForMessage(pOther, (m) => m.type === 'room.joined');
    pOther.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Mai Linh',
      })
    );
    await waitOtherJoin;

    // Host starts question 1
    const waitQ1P1 = waitForMessage(p1, (m) => m.type === 'question.started');
    const waitQ1Other = waitForMessage(pOther, (m) => m.type === 'question.started');
    host.send(JSON.stringify({ type: 'host.start' }));
    await Promise.all([waitQ1P1, waitQ1Other]);

    // Player 1 answers correctly; Player 2 hasn't answered yet, so room stays QUESTION_ACTIVE
    const waitAck = waitForMessage(p1, (m) => m.type === 'question.answerReceived');
    p1.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q_cp4_1',
        answer: 'B. WebSocket',
      })
    );
    await waitAck;

    // Player 1 simulates F5 / refresh (disconnects and reconnects with player.reconnect)
    p1.close();

    const p1Recovered = await createClient();
    const waitP1RecoveredJoin = waitForMessage(p1Recovered, (m) => m.type === 'room.joined');
    const waitP1RecoveredQ = waitForMessage(p1Recovered, (m) => m.type === 'question.started');
    const waitP1RecoveredAck = waitForMessage(p1Recovered, (m) => m.type === 'question.answerReceived');

    p1Recovered.send(
      JSON.stringify({
        type: 'player.reconnect',
        roomCode: room.roomCode,
        playerToken,
      })
    );

    const reconnectedJoin = await waitP1RecoveredJoin;
    assert.equal(reconnectedJoin.playerId, playerId);
    assert.equal(room.players.size, 2, 'Room must still have exactly 2 players (no duplicate player created)');

    await waitP1RecoveredQ;
    const answerSync = await waitP1RecoveredAck;
    assert.equal(answerSync.questionId, 'q_cp4_1');

    // Player 1 attempts to submit a second answer -> server must reject with QUESTION_ALREADY_ANSWERED
    const waitDoubleAnswerErr = waitForMessage(p1Recovered, (m) => m.type === 'error');
    p1Recovered.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q_cp4_1',
        answer: 'A. HTTP/1.0',
      })
    );
    const doubleErr = await waitDoubleAnswerErr;
    assert.equal(doubleErr.code, 'QUESTION_ALREADY_ANSWERED');

    // Player 2 answers -> triggers early reveal
    const waitRevealP1 = waitForMessage(p1Recovered, (m) => m.type === 'question.revealed');
    pOther.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q_cp4_1',
        answer: 'A. HTTP/1.0',
      })
    );

    const revealMsg = await waitRevealP1;
    assert.equal(revealMsg.personalResult.isCorrect, true);
    assert.equal(revealMsg.leaderboard.length, 2);
    const lanAnhResult = revealMsg.leaderboard.find((l: any) => l.displayName === 'Lan Anh');
    assert.equal(lanAnhResult.score, 100);

    host.close();
    p1Recovered.close();
    pOther.close();
  });

  it('3. Disambiguates duplicate display names gracefully and handles room lock/unlock correctly', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    // Host joins
    const host = await createClient();
    const waitHostJoin = waitForMessage(host, (m) => m.type === 'room.joined');
    host.send(
      JSON.stringify({
        type: 'host.join',
        roomCode: room.roomCode,
        hostToken: room.hostToken,
      })
    );
    await waitHostJoin;

    // Player 1 joins as "Hoàng Long"
    const p1 = await createClient();
    const waitP1 = waitForMessage(p1, (m) => m.type === 'room.joined');
    p1.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Hoàng Long',
      })
    );
    const p1Join = await waitP1;
    const p1Token = p1Join.playerToken;

    // Player 2 joins with identical name "Hoàng Long" -> server disambiguates to "Hoàng Long #2"
    const p2 = await createClient();
    const waitP2 = waitForMessage(p2, (m) => m.type === 'room.joined');
    p2.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Hoàng Long',
      })
    );
    await waitP2;

    const allPlayers = Array.from(room.players.values());
    assert.equal(allPlayers.length, 2);
    assert.equal(allPlayers[0].displayName, 'Hoàng Long');
    assert.equal(allPlayers[1].displayName, 'Hoàng Long #2');

    // Host locks room
    const waitLock = waitForMessage(host, (m) => m.type === 'room.lockStateChanged');
    host.send(JSON.stringify({ type: 'host.lock' }));
    const lockMsg = await waitLock;
    assert.equal(lockMsg.isLocked, true);
    assert.equal(room.isLocked, true);

    // Player 3 tries to join locked room -> rejected with ROOM_LOCKED
    const p3 = await createClient();
    const waitP3Err = waitForMessage(p3, (m) => m.type === 'error');
    p3.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Người Đến Sau',
      })
    );
    const p3Err = await waitP3Err;
    assert.equal(p3Err.code, 'ROOM_LOCKED');
    p3.close();

    // But existing player (p1) CAN still reconnect to the locked room
    p1.close();
    const p1Reconnect = await createClient();
    const waitP1Rec = waitForMessage(p1Reconnect, (m) => m.type === 'room.joined');
    p1Reconnect.send(
      JSON.stringify({
        type: 'player.reconnect',
        roomCode: room.roomCode,
        playerToken: p1Token,
      })
    );
    const recMsg = await waitP1Rec;
    assert.equal(recMsg.role, 'player');
    assert.equal(recMsg.isLocked, true);

    // Host unlocks room
    const waitUnlock = waitForMessage(host, (m) => m.type === 'room.lockStateChanged');
    host.send(JSON.stringify({ type: 'host.unlock' }));
    const unlockMsg = await waitUnlock;
    assert.equal(unlockMsg.isLocked, false);
    assert.equal(room.isLocked, false);

    // Now new player can join
    const p4 = await createClient();
    const waitP4 = waitForMessage(p4, (m) => m.type === 'room.joined');
    p4.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Người Mới Sau Mở Khóa',
      })
    );
    const p4Join = await waitP4;
    assert.equal(p4Join.role, 'player');

    host.close();
    p1Reconnect.close();
    p2.close();
    p4.close();
  });

  it('4. Blocks host impersonation, rogue client commands, and rejects closed or invalid rooms', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    // 1. Rogue client attempts host.start without host authentication -> rejected
    const rogue = await createClient();
    const waitRogueErr = waitForMessage(rogue, (m) => m.type === 'error');
    rogue.send(JSON.stringify({ type: 'host.start' }));
    const rogueErr = await waitRogueErr;
    assert.equal(rogueErr.code, 'NOT_HOST');

    // 2. Client with forged host token tries to join host
    const waitForgedErr = waitForMessage(rogue, (m) => m.type === 'error');
    rogue.send(
      JSON.stringify({
        type: 'host.join',
        roomCode: room.roomCode,
        hostToken: 'forged_fake_token_123',
      })
    );
    const forgedErr = await waitForgedErr;
    assert.equal(forgedErr.code, 'INVALID_HOST_TOKEN');

    // 3. Client sends player.answer without registering in room
    const waitAnswerErr = waitForMessage(rogue, (m) => m.type === 'error');
    rogue.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q_cp4_1',
        answer: 'B. WebSocket',
      })
    );
    const ansErr = await waitAnswerErr;
    assert.equal(ansErr.code, 'SESSION_NOT_FOUND');

    // 4. Joining non-existent room returns ROOM_NOT_FOUND
    const waitNonExist = waitForMessage(rogue, (m) => m.type === 'error');
    rogue.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: 'XYZ999',
        displayName: 'Khách',
      })
    );
    const nonExistErr = await waitNonExist;
    assert.equal(nonExistErr.code, 'ROOM_NOT_FOUND');

    // 5. Joining closed room returns GAME_FINISHED
    room.close();
    const waitClosed = waitForMessage(rogue, (m) => m.type === 'error');
    rogue.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Khách',
      })
    );
    const closedErr = await waitClosed;
    assert.equal(closedErr.code, 'GAME_FINISHED');

    rogue.close();
  });

  it('5. Broadcasts synchronized state to multiple concurrent clients and ends room cleanly', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const host = await createClient();
    const p1 = await createClient();
    const p2 = await createClient();

    // Host joins
    const waitHostJoin = waitForMessage(host, (m) => m.type === 'room.joined');
    host.send(
      JSON.stringify({
        type: 'host.join',
        roomCode: room.roomCode,
        hostToken: room.hostToken,
      })
    );
    await waitHostJoin;

    // P1 joins
    const waitP1Join = waitForMessage(p1, (m) => m.type === 'room.joined');
    p1.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Chiến Binh 1',
      })
    );
    await waitP1Join;

    // P2 joins
    const waitP2Join = waitForMessage(p2, (m) => m.type === 'room.joined');
    p2.send(
      JSON.stringify({
        type: 'player.join',
        roomCode: room.roomCode,
        displayName: 'Chiến Binh 2',
      })
    );
    await waitP2Join;

    // Host starts game -> Host, P1, P2 all receive synchronized question.started
    const waitHostQ = waitForMessage(host, (m) => m.type === 'question.started');
    const waitP1Q = waitForMessage(p1, (m) => m.type === 'question.started');
    const waitP2Q = waitForMessage(p2, (m) => m.type === 'question.started');

    host.send(JSON.stringify({ type: 'host.start' }));

    const [msgHostQ, msgP1Q, msgP2Q] = await Promise.all([waitHostQ, waitP1Q, waitP2Q]);
    assert.equal(msgHostQ.question.id, 'q_cp4_1');
    assert.equal(msgP1Q.question.id, 'q_cp4_1');
    assert.equal(msgP2Q.question.id, 'q_cp4_1');

    // Both players answer -> early reveal triggered
    const waitP1Reveal = waitForMessage(p1, (m) => m.type === 'question.revealed');
    const waitP2Reveal = waitForMessage(p2, (m) => m.type === 'question.revealed');
    const waitHostReveal = waitForMessage(host, (m) => m.type === 'question.revealed');

    p1.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q_cp4_1',
        answer: 'B. WebSocket',
      })
    );
    p2.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q_cp4_1',
        answer: 'A. HTTP/1.0',
      })
    );

    const [revealHost, revealP1, revealP2] = await Promise.all([
      waitHostReveal,
      waitP1Reveal,
      waitP2Reveal,
    ]);

    assert.equal(revealP1.personalResult.isCorrect, true);
    assert.equal(revealP2.personalResult.isCorrect, false);
    assert.equal(revealHost.leaderboard[0].displayName, 'Chiến Binh 1');

    // Host ends game
    const waitFinish = waitForMessage(p1, (m) => m.type === 'game.finished');
    host.send(JSON.stringify({ type: 'host.end' }));
    const finishMsg = await waitFinish;
    assert.equal(finishMsg.winner.displayName, 'Chiến Binh 1');

    host.close();
    p1.close();
    p2.close();
  });
});

