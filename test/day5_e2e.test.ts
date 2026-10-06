import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { app } from '../src/app.js';
import { GameSpecificationSchema } from '../src/contracts/game.contract.js';
import { multiplayerWsServer } from '../src/multiplayer/room.websocket.js';
import { aiQuestionService, AiModelProvider } from '../src/services/ai.question.service.js';
import { createMotoCareDocxBuffer } from './fixtures/demo_motocare_fixture.js';

class DeterministicTestAiProvider implements AiModelProvider {
  public mockQuestions: any[] = [];
  public mockTitle: string = 'Test End-to-End Game';

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    return {
      title: this.mockTitle,
      description: 'End-to-End automated test game generated from ingested document.',
      questions: this.mockQuestions,
    };
  }
}

describe('DAY 5 — End-to-End Integration Test Suite', () => {
  let server: http.Server;
  let port: number;
  let wsUrl: string;
  let mockAiProvider: DeterministicTestAiProvider;

  before(async () => {
    mockAiProvider = new DeterministicTestAiProvider();
    aiQuestionService.setProvider(mockAiProvider);

    server = http.createServer(app);
    multiplayerWsServer.attach(server);

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 3000;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    multiplayerWsServer.close();
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  it('1. GET /health and GET / return 200 OK with React root', async () => {
    const healthRes = await request(app).get('/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'ok');

    const rootRes = await request(app).get('/');
    assert.equal(rootRes.status, 200);
    assert.match(rootRes.text, /<div id="root">/);
  });

  it('2. Full Primary Pipeline: Ingest DOCX -> AI Generate -> Create Room -> QR -> Realtime Gameplay -> Podium', async () => {
    // ----------------------------------------------------
    // Step A: Ingest Real Document via POST /api/content/ingest
    // ----------------------------------------------------
    const docxBuffer = await createMotoCareDocxBuffer();
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .attach('files', docxBuffer, 'maintenance_guide.docx');

    assert.equal(ingestRes.status, 200);
    assert.equal(ingestRes.body.success, true);
    assert.ok(ingestRes.body.data.sources.length >= 1);
    const sourceId = ingestRes.body.data.sources[0].sourceId;
    assert.ok(sourceId.startsWith('src_file_'));

    // ----------------------------------------------------
    // Step B: AI Generate Game via POST /api/games/generate
    // ----------------------------------------------------
    mockAiProvider.mockTitle = 'Vehicle Maintenance Knowledge Challenge';
    mockAiProvider.mockQuestions = [
      {
        id: 'q_e2e_1',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the recommended mineral oil replacement interval?',
        choices: ['A. 500 km', 'B. 1,500 - 2,000 km', 'C. 5,000 km', 'D. 10,000 km'],
        correctAnswer: 'B. 1,500 - 2,000 km',
        explanation: 'Standard mineral engine oil should be replaced every 1,500 to 2,000 km.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId,
          sourceType: 'DOCX',
          sourceName: 'maintenance_guide.docx',
          sectionHeading: 'ENGINE OIL',
        },
      },
      {
        id: 'q_e2e_2',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the minimum safe brake pad friction lining thickness?',
        choices: ['A. 0.5 mm', 'B. 2.0 mm', 'C. 4.0 mm', 'D. 6.0 mm'],
        correctAnswer: 'B. 2.0 mm',
        explanation: 'Brake pads worn below 2.0 mm thickness pose severe safety hazards.',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId,
          sourceType: 'DOCX',
          sourceName: 'maintenance_guide.docx',
          sectionHeading: 'BRAKE SYSTEM',
        },
      },
    ];

    const generateRes = await request(app)
      .post('/api/games/generate')
      .send({
        sourceId,
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 2,
        timePerQuestion: 15,
      });

    assert.equal(generateRes.status, 200);
    assert.equal(generateRes.body.success, true);
    const gameSpec = generateRes.body.data;
    const validatedSpec = GameSpecificationSchema.safeParse(gameSpec);
    assert.equal(validatedSpec.success, true);
    const gameId = gameSpec.gameId;

    // ----------------------------------------------------
    // Step C: Create Multiplayer Room via POST /api/rooms
    // ----------------------------------------------------
    const roomRes = await request(app)
      .post('/api/rooms')
      .send({ gameId, capacity: 50 });

    assert.equal(roomRes.status, 200);
    assert.equal(roomRes.body.success, true);
    const { roomCode, hostToken, joinUrl } = roomRes.body.data;
    assert.equal(typeof roomCode, 'string');
    assert.equal(roomCode.length, 6);
    assert.ok(joinUrl.includes(roomCode));

    // ----------------------------------------------------
    // Step D: Validate QR Code endpoint security
    // ----------------------------------------------------
    const qrRes = await request(app).get(`/api/rooms/${roomCode}/qr`);
    assert.equal(qrRes.status, 200);
    assert.equal(qrRes.body.success, true);
    assert.ok(qrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));
    // Ensure hostToken is NEVER in the QR response
    assert.equal(JSON.stringify(qrRes.body).includes(hostToken), false);

    // ----------------------------------------------------
    // Step E: WebSocket Realtime Gameplay with Host + 3 Players
    // ----------------------------------------------------
    const hostWs = new WebSocket(wsUrl);
    const playerWs1 = new WebSocket(wsUrl);
    const playerWs2 = new WebSocket(wsUrl);
    const playerWs3 = new WebSocket(wsUrl);

    await Promise.all([
      new Promise(res => hostWs.on('open', res)),
      new Promise(res => playerWs1.on('open', res)),
      new Promise(res => playerWs2.on('open', res)),
      new Promise(res => playerWs3.on('open', res)),
    ]);

    // Helper to receive next message of expected type
    function waitForMsg(ws: WebSocket, targetType: string): Promise<any> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout waiting for message type "${targetType}"`));
        }, 5000);

        const onMsg = (event: any) => {
          try {
            const data = JSON.parse(event.toString());
            if (data.type === targetType) {
              clearTimeout(timeout);
              ws.off('message', onMsg);
              resolve(data);
            }
          } catch {
            // ignore non-json
          }
        };
        ws.on('message', onMsg);
      });
    }

    // 1. Host authorizes
    const hostJoinPromise = waitForMsg(hostWs, 'room.joined');
    hostWs.send(JSON.stringify({ type: 'host.join', roomCode, hostToken }));
    const hostJoined = await hostJoinPromise;
    assert.equal(hostJoined.role, 'host');

    // 2. Players join lobby
    const p1JoinPromise = waitForMsg(playerWs1, 'room.joined');
    playerWs1.send(JSON.stringify({ type: 'player.join', roomCode, displayName: 'Alice (Chrome)' }));
    const p1Joined = await p1JoinPromise;
    assert.ok(p1Joined.playerToken);

    const p2JoinPromise = waitForMsg(playerWs2, 'room.joined');
    playerWs2.send(JSON.stringify({ type: 'player.join', roomCode, displayName: 'Bob (Mobile)' }));
    const p2Joined = await p2JoinPromise;
    assert.ok(p2Joined.playerToken);

    const p3JoinPromise = waitForMsg(playerWs3, 'room.joined');
    playerWs3.send(JSON.stringify({ type: 'player.join', roomCode, displayName: 'Charlie (Tablet)' }));
    const p3Joined = await p3JoinPromise;
    assert.ok(p3Joined.playerToken);

    // 3. Host starts game
    const q1PromiseHost = waitForMsg(hostWs, 'question.started');
    const q1PromiseP1 = waitForMsg(playerWs1, 'question.started');
    const q1PromiseP2 = waitForMsg(playerWs2, 'question.started');
    const q1PromiseP3 = waitForMsg(playerWs3, 'question.started');

    hostWs.send(JSON.stringify({ type: 'host.start' }));

    const [q1Host, q1P1, q1P2, q1P3] = await Promise.all([
      q1PromiseHost,
      q1PromiseP1,
      q1PromiseP2,
      q1PromiseP3,
    ]);

    // Verify answer secrecy: NO answer or explanation leaked in question.started!
    assert.equal(q1P1.question.correctAnswer, undefined);
    assert.equal(q1P1.question.explanation, undefined);
    assert.equal(q1Host.question.id, 'q_e2e_1');

    // 4. Players answer Question 1
    const p1RevealPromise = waitForMsg(playerWs1, 'question.revealed');
    const p2RevealPromise = waitForMsg(playerWs2, 'question.revealed');
    const p3RevealPromise = waitForMsg(playerWs3, 'question.revealed');
    const hostRevealPromise = waitForMsg(hostWs, 'question.revealed');

    // Alice submits correct answer fast
    playerWs1.send(JSON.stringify({
      type: 'player.answer',
      questionId: 'q_e2e_1',
      answer: 'B. 1,500 - 2,000 km',
    }));

    // Bob submits correct answer
    playerWs2.send(JSON.stringify({
      type: 'player.answer',
      questionId: 'q_e2e_1',
      answer: 'B. 1,500 - 2,000 km',
    }));

    // Charlie submits wrong answer
    playerWs3.send(JSON.stringify({
      type: 'player.answer',
      questionId: 'q_e2e_1',
      answer: 'A. 500 km',
    }));

    // Early reveal fires automatically when all 3 players answered!
    const [p1Rev, p2Rev, p3Rev, hostRev] = await Promise.all([
      p1RevealPromise,
      p2RevealPromise,
      p3RevealPromise,
      hostRevealPromise,
    ]);

    assert.equal(hostRev.correctAnswer, 'B. 1,500 - 2,000 km');
    assert.equal(p1Rev.personalResult.isCorrect, true);
    assert.ok(p1Rev.personalResult.pointsEarned > 0);
    assert.equal(p2Rev.personalResult.isCorrect, true);
    assert.equal(p3Rev.personalResult.isCorrect, false);
    assert.equal(p3Rev.personalResult.pointsEarned, 0);

    // 5. Host advances to Question 2
    const q2PromiseP1 = waitForMsg(playerWs1, 'question.started');
    hostWs.send(JSON.stringify({ type: 'host.next' }));
    const q2P1 = await q2PromiseP1;
    assert.equal(q2P1.question.id, 'q_e2e_2');

    // Alice and Bob answer Q2 correctly
    const p1Rev2Promise = waitForMsg(playerWs1, 'question.revealed');
    playerWs1.send(JSON.stringify({ type: 'player.answer', questionId: 'q_e2e_2', answer: 'B. 2.0 mm' }));
    playerWs2.send(JSON.stringify({ type: 'player.answer', questionId: 'q_e2e_2', answer: 'A. 0.5 mm' }));
    playerWs3.send(JSON.stringify({ type: 'player.answer', questionId: 'q_e2e_2', answer: 'C. 4.0 mm' }));

    await p1Rev2Promise;

    // 6. Host advances after final question -> game.finished
    const finishPromiseHost = waitForMsg(hostWs, 'game.finished');
    const finishPromiseP1 = waitForMsg(playerWs1, 'game.finished');

    hostWs.send(JSON.stringify({ type: 'host.next' }));

    const [finishHost, finishP1] = await Promise.all([finishPromiseHost, finishPromiseP1]);
    assert.ok(finishHost.leaderboard.length === 3);
    assert.equal(finishHost.winner.displayName, 'Alice (Chrome)');
    assert.equal(finishP1.leaderboard[0].displayName, 'Alice (Chrome)');

    // Clean up WebSockets
    hostWs.close();
    playerWs1.close();
    playerWs2.close();
    playerWs3.close();
  });

  it('3. Smoke test secondary game type (QUICK_BUTTON) E2E', async () => {
    mockAiProvider.mockTitle = 'Quick Speed T/F Check';
    mockAiProvider.mockQuestions = [
      {
        id: 'q_qb_1',
        type: 'QUICK_BUTTON',
        question: 'HTTP is a stateful transport protocol.',
        choices: ['True', 'False'],
        correctAnswer: 'False',
        explanation: 'HTTP is inherently a stateless application-level protocol.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_dummy',
          sourceType: 'WEBSITE',
          sourceLocation: 'http://test',
        },
      },
    ];

    // Direct room creation from validated specification
    const spec = {
      gameId: 'game_qb_smoke',
      title: 'Quick Button Smoke',
      description: 'Quick button test',
      gameType: 'QUICK_BUTTON',
      questions: mockAiProvider.mockQuestions,
      settings: { questionCount: 1, timePerQuestion: 10, scoringMode: 'STANDARD' },
      sourceSummary: { sourceCount: 1, sources: [{ sourceId: 'src_dummy', sourceType: 'WEBSITE', sourceName: 'protocol_guide.html', sourceLocation: 'http://test' }] },
      generatedAt: new Date().toISOString(),
    };

    const roomRes = await request(app).post('/api/rooms').send({ gameId: spec.gameId, gameSpecification: spec });
    assert.equal(roomRes.status, 200);
    const { roomCode, hostToken } = roomRes.body.data;

    const hostWs = new WebSocket(wsUrl);
    const playerWs = new WebSocket(wsUrl);

    await Promise.all([
      new Promise(res => hostWs.on('open', res)),
      new Promise(res => playerWs.on('open', res)),
    ]);

    function waitFor(ws: WebSocket, type: string): Promise<any> {
      return new Promise((resolve) => {
        const handler = (evt: any) => {
          const m = JSON.parse(evt.toString());
          if (m.type === type) {
            ws.off('message', handler);
            resolve(m);
          }
        };
        ws.on('message', handler);
      });
    }

    const hostJoinPromise = waitFor(hostWs, 'room.joined');
    hostWs.send(JSON.stringify({ type: 'host.join', roomCode, hostToken }));
    await hostJoinPromise;

    const playerJoinPromise = waitFor(playerWs, 'room.joined');
    playerWs.send(JSON.stringify({ type: 'player.join', roomCode, displayName: 'QuickTester' }));
    await playerJoinPromise;

    const qPromise = waitFor(playerWs, 'question.started');
    hostWs.send(JSON.stringify({ type: 'host.start' }));
    const qData = await qPromise;
    assert.equal(qData.question.type, 'QUICK_BUTTON');
    assert.deepEqual(qData.question.choices, ['True', 'False']);

    const revPromise = waitFor(playerWs, 'question.revealed');
    playerWs.send(JSON.stringify({ type: 'player.answer', questionId: 'q_qb_1', answer: 'False' }));
    const revData = await revPromise;
    assert.equal(revData.personalResult.isCorrect, true);

    hostWs.close();
    playerWs.close();
  });
});

