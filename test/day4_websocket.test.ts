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
    gameId: 'game_ws_test',
    title: 'WebSocket Realtime Quiz',
    description: 'Testing realtime multiplayer protocol',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_ws_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Which protocol provides full-duplex communication over a single TCP connection?',
        choices: ['A. HTTP/1.0', 'B. WebSocket', 'C. SMTP', 'D. FTP'],
        correctAnswer: 'B. WebSocket',
        explanation: 'RFC 6455 defines the WebSocket protocol.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
      {
        id: 'q_ws_2',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the default port for unencrypted WebSockets?',
        choices: ['A. 80', 'B. 443', 'C. 8080', 'D. 3000'],
        correctAnswer: 'A. 80',
        explanation: 'ws uses port 80; wss uses port 443.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 2, timePerQuestion: 20, scoringMode: 'STANDARD' },
    sourceSummary: { sourceCount: 1, sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }] },
    generatedAt: new Date().toISOString(),
  };
}

describe('DAY 4 - WebSocket Multiplayer Integration Test Suite', () => {
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

  // ==========================================
  // PROTOCOL SAFETY & ERROR HANDLING (42-45)
  // ==========================================

  it('42. malformed JSON does not crash server and returns error frame', async () => {
    const client = await createClient();
    const waitErr = waitForMessage(client);

    client.send('NOT_A_VALID_JSON{{{');
    const errFrame = await waitErr;

    assert.equal(errFrame.type, 'error');
    assert.equal(errFrame.code, 'INVALID_MESSAGE');
    client.close();
  });

  it('43. unknown message type rejected with error frame', async () => {
    const client = await createClient();
    const waitErr = waitForMessage(client);

    client.send(JSON.stringify({ type: 'hack.the.game', data: 123 }));
    const errFrame = await waitErr;

    assert.equal(errFrame.type, 'error');
    assert.equal(errFrame.code, 'INVALID_MESSAGE');
    client.close();
  });

  it('44. closed socket is safely cleaned up without leaking references', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const client = await createClient();
    const joinWait = waitForMessage(client, (m) => m.type === 'room.joined');

    client.send(JSON.stringify({
      type: 'player.join',
      roomCode: room.roomCode,
      displayName: 'Disconnecter',
    }));

    await joinWait;
    assert.equal(room.players.size, 1);

    // Close socket
    client.close();
    await new Promise((r) => setTimeout(r, 50));

    // Player marked disconnected
    const player = Array.from(room.players.values())[0];
    assert.equal(player.connected, false);
  });

  // ==========================================
  // HTTP REST APIS (49-51)
  // ==========================================

  it('49. POST /api/rooms creates room and returns safe host metadata', async () => {
    const spec = createSampleSpec();
    const res = await request(app)
      .post('/api/rooms')
      .send({ gameId: spec.gameId, gameSpecification: spec });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.roomId);
    assert.ok(res.body.data.roomCode);
    assert.ok(res.body.data.hostToken);
    assert.equal(res.body.data.capacity, 300);
  });

  it('50. GET /api/rooms/:roomCode returns safe lobby info without secrets', async () => {
    const spec = createSampleSpec();
    const createRes = await request(app)
      .post('/api/rooms')
      .send({ gameId: spec.gameId, gameSpecification: spec });

    const code = createRes.body.data.roomCode;
    const lobbyRes = await request(app).get(`/api/rooms/${code}`);

    assert.equal(lobbyRes.status, 200);
    assert.equal(lobbyRes.body.data.roomCode, code);
    assert.equal(lobbyRes.body.data.playerCount, 0);
    assert.equal(lobbyRes.body.data.capacity, 300);
    assert.equal(lobbyRes.body.data.title, spec.title);
    assert.equal((lobbyRes.body.data as any).hostToken, undefined);
  });

  // ==========================================
  // SECURITY & ROLE ISOLATION (38-41)
  // ==========================================

  it('38. player cannot trigger host actions like host.start', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const playerWs = await createClient();
    const joinWait = waitForMessage(playerWs, (m) => m.type === 'room.joined');

    playerWs.send(JSON.stringify({
      type: 'player.join',
      roomCode: room.roomCode,
      displayName: 'SneakyPlayer',
    }));
    await joinWait;

    // Player attempts host.start
    const errWait = waitForMessage(playerWs, (m) => m.type === 'error');
    playerWs.send(JSON.stringify({ type: 'host.start' }));
    const err = await errWait;

    assert.equal(err.code, 'NOT_HOST');
    assert.equal(room.state, 'WAITING');
    playerWs.close();
  });

  it('39. player does not receive answer key in question.started', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const hostWs = await createClient();
    const playerWs = await createClient();

    hostWs.send(JSON.stringify({ type: 'host.join', roomCode: room.roomCode, hostToken: room.hostToken }));
    await waitForMessage(hostWs, (m) => m.type === 'room.joined');

    playerWs.send(JSON.stringify({ type: 'player.join', roomCode: room.roomCode, displayName: 'Alice' }));
    await waitForMessage(playerWs, (m) => m.type === 'room.joined');

    // Host starts
    const qWait = waitForMessage(playerWs, (m) => m.type === 'question.started');
    hostWs.send(JSON.stringify({ type: 'host.start' }));
    const qMsg = await qWait;

    assert.ok(qMsg.question);
    assert.equal(qMsg.question.id, 'q_ws_1');
    assert.equal(qMsg.question.correctAnswer, undefined);
    assert.equal(qMsg.question.acceptedAlternatives, undefined);
    assert.equal(qMsg.question.explanation, undefined);

    hostWs.close();
    playerWs.close();
  });

  // ==========================================
  // COMPLETE MULTIPLAYER E2E FLOW (52-60)
  // ==========================================

  it('52-60. complete multiplayer game flow: host + 2 players join, answer, reveal, next, finish', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    // 1. Connect Host
    const hostWs = await createClient();
    hostWs.send(JSON.stringify({ type: 'host.join', roomCode: room.roomCode, hostToken: room.hostToken }));
    const hostJoined = await waitForMessage(hostWs, (m) => m.type === 'room.joined');
    assert.equal(hostJoined.role, 'host');

    // 2. Connect Player 1 & Player 2
    const p1Ws = await createClient();
    const p2Ws = await createClient();

    p1Ws.send(JSON.stringify({ type: 'player.join', roomCode: room.roomCode, displayName: 'Alice' }));
    const p1Joined = await waitForMessage(p1Ws, (m) => m.type === 'room.joined');
    assert.equal(p1Joined.role, 'player');

    p2Ws.send(JSON.stringify({ type: 'player.join', roomCode: room.roomCode, displayName: 'Bob' }));
    const p2Joined = await waitForMessage(p2Ws, (m) => m.type === 'room.joined');
    assert.equal(p2Joined.role, 'player');

    assert.equal(room.players.size, 2);

    // 3. Host starts game
    const p1Q1Wait = waitForMessage(p1Ws, (m) => m.type === 'question.started');
    const p2Q1Wait = waitForMessage(p2Ws, (m) => m.type === 'question.started');
    hostWs.send(JSON.stringify({ type: 'host.start' }));

    const p1Q1 = await p1Q1Wait;
    const p2Q1 = await p2Q1Wait;
    assert.equal(p1Q1.question.id, 'q_ws_1');
    assert.equal(p2Q1.question.id, 'q_ws_1');

    // 4. Players submit answers
    // Alice submits correct answer ('B. WebSocket')
    // Bob submits incorrect answer ('A. HTTP/1.0')
    const p1RevealWait = waitForMessage(p1Ws, (m) => m.type === 'question.revealed');
    const p2RevealWait = waitForMessage(p2Ws, (m) => m.type === 'question.revealed');
    const hostRevealWait = waitForMessage(hostWs, (m) => m.type === 'question.revealed');

    p1Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_1', answer: 'B. WebSocket' }));
    p2Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_1', answer: 'A. HTTP/1.0' }));

    // Both players answered -> automatic early reveal triggered!
    const [p1Reveal, p2Reveal, hostReveal] = await Promise.all([p1RevealWait, p2RevealWait, hostRevealWait]);

    assert.equal(p1Reveal.correctAnswer, 'B. WebSocket');
    assert.equal(p1Reveal.personalResult.isCorrect, true);
    assert.equal(p1Reveal.personalResult.pointsEarned, 100);

    assert.equal(p2Reveal.personalResult.isCorrect, false);
    assert.equal(p2Reveal.personalResult.pointsEarned, 0);

    // Leaderboard: Alice #1 (100 pts), Bob #2 (0 pts)
    assert.equal(hostReveal.leaderboard[0].displayName, 'Alice');
    assert.equal(hostReveal.leaderboard[0].score, 100);
    assert.equal(hostReveal.leaderboard[1].displayName, 'Bob');
    assert.equal(hostReveal.leaderboard[1].score, 0);

    // 5. Host advances to Question 2
    const p1Q2Wait = waitForMessage(p1Ws, (m) => m.type === 'question.started');
    hostWs.send(JSON.stringify({ type: 'host.next' }));
    const p1Q2 = await p1Q2Wait;
    assert.equal(p1Q2.question.id, 'q_ws_2');

    // 6. Players answer Question 2
    const p1Rev2Wait = waitForMessage(p1Ws, (m) => m.type === 'question.revealed');
    p1Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_2', answer: 'A. 80' })); // correct
    p2Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_2', answer: 'A. 80' })); // correct
    await p1Rev2Wait;

    // 7. Host advances after final question -> game.finished
    const p1FinishWait = waitForMessage(p1Ws, (m) => m.type === 'game.finished');
    const hostFinishWait = waitForMessage(hostWs, (m) => m.type === 'game.finished');
    hostWs.send(JSON.stringify({ type: 'host.next' }));

    const [p1Finish, hostFinish] = await Promise.all([p1FinishWait, hostFinishWait]);
    assert.equal(p1Finish.type, 'game.finished');
    assert.equal(hostFinish.winner.displayName, 'Alice');
    assert.equal(hostFinish.leaderboard.length, 2);

    hostWs.close();
    p1Ws.close();
    p2Ws.close();
  });

  // ==========================================
  // DAY 11.1 - AUTO ADVANCE INTEGRATION TESTS
  // ==========================================

  it('61. allAnswered early-reveal path automatically advances to next question and finishes after final question', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const hostWs = await createClient();
    hostWs.send(JSON.stringify({ type: 'host.join', roomCode: room.roomCode, hostToken: room.hostToken }));
    await waitForMessage(hostWs, (m) => m.type === 'room.joined');

    const p1Ws = await createClient();
    p1Ws.send(JSON.stringify({ type: 'player.join', roomCode: room.roomCode, displayName: 'Alice' }));
    await waitForMessage(p1Ws, (m) => m.type === 'room.joined');

    // Host starts game
    const p1Q1Wait = waitForMessage(p1Ws, (m) => m.type === 'question.started');
    hostWs.send(JSON.stringify({ type: 'host.start' }));
    await p1Q1Wait;

    // Player answers Q1 -> triggers early reveal
    const p1RevealWait = waitForMessage(p1Ws, (m) => m.type === 'question.revealed');
    p1Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_1', answer: 'B. WebSocket' }));
    await p1RevealWait;

    // DO NOT send host.next! Wait for auto-advance to Q2 after 4 seconds
    const p1Q2Wait = waitForMessage(p1Ws, (m) => m.type === 'question.started');
    const p1Q2 = await p1Q2Wait;
    assert.equal(p1Q2.question.id, 'q_ws_2');

    // Player answers Q2 (last question) -> triggers early reveal
    const p1Rev2Wait = waitForMessage(p1Ws, (m) => m.type === 'question.revealed');
    p1Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_2', answer: 'A. 80' }));
    await p1Rev2Wait;

    // DO NOT send host.next! Wait for auto-advance to game.finished after 4 seconds
    const hostFinishWait = waitForMessage(hostWs, (m) => m.type === 'game.finished');
    const hostFinish = await hostFinishWait;
    assert.equal(hostFinish.type, 'game.finished');
    assert.equal(hostFinish.winner.displayName, 'Alice');

    hostWs.close();
    p1Ws.close();
  });

  it('62. manual Host Next before 4s cancels auto-advance timer and prevents double advance', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const hostWs = await createClient();
    hostWs.send(JSON.stringify({ type: 'host.join', roomCode: room.roomCode, hostToken: room.hostToken }));
    await waitForMessage(hostWs, (m) => m.type === 'room.joined');

    const p1Ws = await createClient();
    p1Ws.send(JSON.stringify({ type: 'player.join', roomCode: room.roomCode, displayName: 'Alice' }));
    await waitForMessage(p1Ws, (m) => m.type === 'room.joined');

    hostWs.send(JSON.stringify({ type: 'host.start' }));
    await waitForMessage(p1Ws, (m) => m.type === 'question.started');

    // Player answers Q1
    p1Ws.send(JSON.stringify({ type: 'player.answer', questionId: 'q_ws_1', answer: 'B. WebSocket' }));
    await waitForMessage(p1Ws, (m) => m.type === 'question.revealed');

    // Host manually sends host.next after 200ms (before 4s auto-advance)
    await new Promise((r) => setTimeout(r, 200));
    hostWs.send(JSON.stringify({ type: 'host.next' }));
    const p1Q2 = await waitForMessage(p1Ws, (m) => m.type === 'question.started');
    assert.equal(p1Q2.question.id, 'q_ws_2');

    // Track any messages received in the next 4.5 seconds
    let duplicateAdvanced = false;
    const extraMsgListener = (data: Buffer | string) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'question.started' || m.type === 'game.finished') {
          duplicateAdvanced = true;
        }
      } catch {}
    };
    hostWs.on('message', extraMsgListener);

    // Wait until past the 4000ms delay
    await new Promise((r) => setTimeout(r, 4500));
    hostWs.off('message', extraMsgListener);

    assert.equal(duplicateAdvanced, false, 'Auto-advance timer should have been canceled and not fired again');
    assert.equal(room.state, 'QUESTION_ACTIVE');
    assert.equal(room.currentQuestionIndex, 1);

    hostWs.close();
    p1Ws.close();
  });

  it('63. timeout path automatically reveals and advances to next question without player input', async () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const hostWs = await createClient();
    hostWs.send(JSON.stringify({ type: 'host.join', roomCode: room.roomCode, hostToken: room.hostToken }));
    await waitForMessage(hostWs, (m) => m.type === 'room.joined');

    const p1Ws = await createClient();
    p1Ws.send(JSON.stringify({ type: 'player.join', roomCode: room.roomCode, displayName: 'Alice' }));
    await waitForMessage(p1Ws, (m) => m.type === 'room.joined');

    hostWs.send(JSON.stringify({ type: 'host.start' }));
    await waitForMessage(p1Ws, (m) => m.type === 'question.started');

    // Simulate question timeout in 100ms
    room.questionDeadlineAt = Date.now() + 100;
    (wsServer as any).scheduleQuestionTimer(room);

    // Wait for timeout reveal
    const hostReveal = await waitForMessage(hostWs, (m) => m.type === 'question.revealed');
    assert.equal(hostReveal.type, 'question.revealed');
    assert.equal(room.state, 'QUESTION_REVEAL');

    // Wait for auto-advance to Q2 after 4 seconds
    const p1Q2 = await waitForMessage(p1Ws, (m) => m.type === 'question.started');
    assert.equal(p1Q2.question.id, 'q_ws_2');
    assert.equal(room.state, 'QUESTION_ACTIVE');
    assert.equal(room.currentQuestionIndex, 1);

    hostWs.close();
    p1Ws.close();
  });
});

