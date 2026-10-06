import http from 'node:http';
import { WebSocket } from 'ws';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';

function createStressSpec(): GameSpecification {
  return {
    gameId: 'game_stress_300',
    title: '300-Player Concurrency Test Quiz',
    description: 'Local stress test with 300 simultaneous connections',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_stress_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Which HTTP status code represents OK?',
        choices: ['A. 200', 'B. 404', 'C. 500', 'D. 301'],
        correctAnswer: 'A. 200',
        explanation: '200 indicates HTTP success.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 1, timePerQuestion: 30, scoringMode: 'STANDARD' },
    sourceSummary: { sourceCount: 1, sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }] },
    generatedAt: new Date().toISOString(),
  };
}

async function run300PlayerStressTest() {
  console.log('====================================================');
  console.log('STARTING DAY 4 LOCAL 300-PLAYER STRESS TEST');
  console.log('====================================================\n');

  roomStore.clear();

  // 1. Setup local HTTP + WebSocket server on ephemeral port
  const server = http.createServer(app);
  const wsServer = new MultiplayerWebSocketServer();
  wsServer.attach(server);

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });

  const addr = server.address() as any;
  const wsUrl = `ws://localhost:${addr.port}/ws`;
  console.log(`Step 1: Local test server listening at ${wsUrl}`);

  // 2. Create room for 300 players
  const spec = createStressSpec();
  const room = roomService.createRoom(spec, 300);
  console.log(`Step 2: Created room [${room.roomCode}] with capacity: ${room.capacity}`);

  // 3. Connect Host
  const hostWs = new WebSocket(wsUrl);
  await new Promise<void>((resolve) => hostWs.on('open', resolve));

  const hostReadyPromise = new Promise<void>((resolve) => {
    hostWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'room.joined') resolve();
    });
  });

  hostWs.send(JSON.stringify({
    type: 'host.join',
    roomCode: room.roomCode,
    hostToken: room.hostToken,
  }));
  await hostReadyPromise;
  console.log('Step 3: Host joined and authorized');

  // 4. Connect 300 concurrent player WebSocket clients
  const TARGET_PLAYERS = 300;
  console.log(`Step 4: Connecting ${TARGET_PLAYERS} simultaneous WebSocket clients in batches...`);

  const playerSockets: WebSocket[] = [];
  const playerTokens: string[] = [];

  const BATCH_SIZE = 50;
  for (let batchStart = 0; batchStart < TARGET_PLAYERS; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TARGET_PLAYERS);
    const batchPromises: Promise<void>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const p = new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.on('open', () => {
          playerSockets.push(ws);
          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'room.joined') {
                playerTokens.push(msg.playerToken);
                resolve();
              }
            } catch (err) {
              reject(err);
            }
          });

          ws.send(JSON.stringify({
            type: 'player.join',
            roomCode: room.roomCode,
            displayName: `Player_${i + 1}`,
          }));
        });
        ws.on('error', reject);
      });
      batchPromises.push(p);
    }

    await Promise.all(batchPromises);
    console.log(`   Connected ${batchEnd} / ${TARGET_PLAYERS} players...`);
  }

  console.log(`\nStep 5: Verified ${playerSockets.length} connected players in room!`);
  if (room.players.size !== TARGET_PLAYERS) {
    throw new Error(`Expected ${TARGET_PLAYERS} players in room, but got ${room.players.size}`);
  }

  // 6. Host starts game
  console.log('Step 6: Host starting game across 300 players...');
  const playerQuestionPromises = playerSockets.map((ws) => {
    return new Promise<void>((resolve) => {
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'question.started') {
          ws.off('message', handler);
          resolve();
        }
      };
      ws.on('message', handler);
    });
  });

  hostWs.send(JSON.stringify({ type: 'host.start' }));
  await Promise.all(playerQuestionPromises);
  console.log('   All 300 players received question.started event!');

  // 7. Test duplicate answer rejection on Player 0 while question is active
  console.log('Step 7: Testing duplicate answer rejection on Player 0 while question is active...');
  const p0 = playerSockets[0];

  // First answer from Player 0
  const p0AnswerWait = new Promise<void>((resolve) => {
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'question.answerReceived') {
        p0.off('message', handler);
        resolve();
      }
    };
    p0.on('message', handler);
    p0.send(JSON.stringify({
      type: 'player.answer',
      questionId: 'q_stress_1',
      answer: 'A. 200',
    }));
  });
  await p0AnswerWait;

  // Immediate second answer attempt from Player 0
  const p0DupWait = new Promise<void>((resolve) => {
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'error' && msg.code === 'QUESTION_ALREADY_ANSWERED') {
        p0.off('message', handler);
        resolve();
      }
    };
    p0.on('message', handler);
    p0.send(JSON.stringify({
      type: 'player.answer',
      questionId: 'q_stress_1',
      answer: 'A. 200',
    }));
  });
  await p0DupWait;
  console.log('   Duplicate answer correctly rejected with QUESTION_ALREADY_ANSWERED!');

  // 8. Remaining 299 players submit answers
  console.log('Step 8: Remaining 299 players submitting deterministic answers...');
  const answerPromises: Promise<void>[] = [];

  for (let i = 1; i < TARGET_PLAYERS; i++) {
    const ws = playerSockets[i];
    const answerChoice = (i % 2 === 0) ? 'A. 200' : 'B. 404';

    const p = new Promise<void>((resolve) => {
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'question.answerReceived') {
          ws.off('message', handler);
          resolve();
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({
        type: 'player.answer',
        questionId: 'q_stress_1',
        answer: answerChoice,
      }));
    });
    answerPromises.push(p);
  }

  await Promise.all(answerPromises);
  console.log('   All 300 player answers successfully accepted by server!');

  // 9. Host next -> game finishes and leaderboard produced
  console.log('Step 9: Host advances to finish game...');
  const hostFinishWait = new Promise<any>((resolve) => {
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'game.finished') {
        hostWs.off('message', handler);
        resolve(msg);
      }
    };
    hostWs.on('message', handler);
  });

  hostWs.send(JSON.stringify({ type: 'host.next' }));
  const finishMsg = await hostFinishWait;

  console.log('Step 10: Verifying final leaderboard size and scores...');
  console.log(`   Leaderboard length: ${finishMsg.leaderboard.length}`);
  if (finishMsg.leaderboard.length !== TARGET_PLAYERS) {
    throw new Error(`Expected leaderboard length ${TARGET_PLAYERS}, got ${finishMsg.leaderboard.length}`);
  }
  console.log(`   Top Player: ${finishMsg.winner.displayName} with ${finishMsg.winner.score} pts (rank #${finishMsg.winner.rank})`);

  // 10. Clean up all sockets and server
  console.log('Step 11: Disconnecting 300 clients and closing server cleanly...');
  for (const ws of playerSockets) {
    ws.close();
  }
  hostWs.close();
  wsServer.close();

  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log('\n====================================================');
  console.log('300-PLAYER STRESS TEST: PASS (300/300 CONCURRENT PLAYERS)');
  console.log('====================================================\n');
}

run300PlayerStressTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Stress test failed:', err);
    process.exit(1);
  });

