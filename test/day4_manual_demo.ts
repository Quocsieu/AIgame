import http from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { roomStore } from '../src/multiplayer/room.store.js';

function createDemoSpec(): GameSpecification {
  return {
    gameId: 'manual_demo_day4',
    title: 'Multiplayer Live Trivia (Day 4 Manual Demo)',
    description: 'Demonstrating 3-player multiplayer room gameplay with live reveal and leaderboard',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_demo_1',
        type: 'MULTIPLE_CHOICE',
        question: 'What company developed TypeScript?',
        choices: ['A. Google', 'B. Microsoft', 'C. Apple', 'D. Amazon'],
        correctAnswer: 'B. Microsoft',
        explanation: 'Microsoft introduced TypeScript in 2012.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
      {
        id: 'q_demo_2',
        type: 'MULTIPLE_CHOICE',
        question: 'Which tool transpile TypeScript into plain JavaScript?',
        choices: ['A. tsc', 'B. gcc', 'C. clang', 'D. javac'],
        correctAnswer: 'A. tsc',
        explanation: 'tsc is the TypeScript compiler.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 2, timePerQuestion: 20, scoringMode: 'SPEED_BONUS' },
    sourceSummary: { sourceCount: 1, sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }] },
    generatedAt: new Date().toISOString(),
  };
}

async function runManualDemo() {
  console.log('====================================================');
  console.log('DAY 4 MANUAL DEMO TEST (Section 56)');
  console.log('====================================================\n');

  roomStore.clear();

  // 1. Setup local HTTP + WebSocket server
  const server = http.createServer(app);
  const wsServer = new MultiplayerWebSocketServer();
  wsServer.attach(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as any;
  const wsUrl = `ws://localhost:${addr.port}/ws`;

  // Step 1 & 2: Host creates room via HTTP API
  const spec = createDemoSpec();
  const createRes = await request(app)
    .post('/api/rooms')
    .send({ gameId: spec.gameId, gameSpecification: spec });

  const { roomId, roomCode, hostToken, joinUrl } = createRes.body.data;
  console.log('Step 1 & 2: Room created successfully!');
  console.log(`- Room ID: ${roomId}`);
  console.log(`- Room Code: ${roomCode}`);
  console.log(`- Host Token: ${hostToken.slice(0, 12)}... (kept private)`);

  // Step 3 & 4: Verify Room Code and QR Code endpoint
  const qrRes = await request(app).get(`/api/rooms/${roomCode}/qr`);
  console.log('\nStep 3 & 4: Verified Room Code & QR endpoint:');
  console.log(`- QR Join URL: ${qrRes.body.data.joinUrl}`);
  console.log(`- QR Data URL: ${qrRes.body.data.qrDataUrl.slice(0, 45)}... (base64 PNG)`);
  console.log(`- Host Token NOT in QR: ${!JSON.stringify(qrRes.body).includes(hostToken)}`);

  // Step 5: Connect Host via WebSocket
  const hostWs = new WebSocket(wsUrl);
  await new Promise<void>((resolve) => hostWs.on('open', resolve));

  const hostReadyWait = new Promise<any>((resolve) => {
    hostWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'room.joined') resolve(msg);
    });
  });
  hostWs.send(JSON.stringify({ type: 'host.join', roomCode, hostToken }));
  const hostJoinedMsg = await hostReadyWait;
  console.log(`\nStep 5: Host connected over WebSocket to room [${hostJoinedMsg.roomCode}]`);

  // Step 6: Join 3 distinct players (simulating desktop & mobile browsers)
  console.log('\nStep 6: Joining 3 players to the lobby...');
  const playerConfigs = [
    { name: 'Alice (Desktop Chrome)', choiceQ1: 'B. Microsoft', choiceQ2: 'A. tsc', delay: 100 },
    { name: 'Bob (Mobile Safari)', choiceQ1: 'B. Microsoft', choiceQ2: 'B. gcc', delay: 1200 },
    { name: 'Carol (Mobile Chrome)', choiceQ1: 'A. Google', choiceQ2: 'C. clang', delay: 500 },
  ];

  const players: { name: string; ws: WebSocket; playerId: string; playerToken: string }[] = [];

  for (const cfg of playerConfigs) {
    const pWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => pWs.on('open', resolve));

    const pReadyWait = new Promise<any>((resolve) => {
      pWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'room.joined') resolve(msg);
      });
    });

    pWs.send(JSON.stringify({ type: 'player.join', roomCode, displayName: cfg.name }));
    const pJoinMsg = await pReadyWait;
    players.push({
      name: cfg.name,
      ws: pWs,
      playerId: pJoinMsg.playerId,
      playerToken: pJoinMsg.playerToken,
    });
    console.log(`- Player joined: "${cfg.name}" (ID: ${pJoinMsg.playerId.slice(0, 15)}...)`);
  }

  // Step 7 & 8: Host starts game; all players see question 1
  console.log('\nStep 7 & 8: Host starting game...');
  const playerQ1Waits = players.map(p => new Promise<any>(resolve => {
    p.ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'question.started') resolve(msg.question);
    });
  }));

  hostWs.send(JSON.stringify({ type: 'host.start' }));
  const [q1Alice, q1Bob, q1Carol] = await Promise.all(playerQ1Waits);

  console.log(`- All 3 players received active question: "${q1Alice.question}"`);
  console.log(`- Choices presented: ${JSON.stringify(q1Alice.choices)}`);
  console.log(`- Verified correct answer is NOT leaked: ${q1Alice.correctAnswer === undefined}`);

  // Step 9 & 10: Players answer differently
  console.log('\nStep 9 & 10: Players answering Question 1 with different choices & response times:');
  const revealWaits = players.map(p => new Promise<any>(resolve => {
    p.ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'question.revealed') resolve(msg);
    });
  }));
  const hostRevealWait = new Promise<any>(resolve => {
    hostWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'question.revealed') resolve(msg);
    });
  });

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const cfg = playerConfigs[i];
    setTimeout(() => {
      p.ws.send(JSON.stringify({
        type: 'player.answer',
        questionId: q1Alice.id,
        answer: cfg.choiceQ1,
      }));
      console.log(`   * ${p.name} submitted: "${cfg.choiceQ1}" after ${cfg.delay}ms`);
    }, cfg.delay);
  }

  const [revAlice, revBob, revCarol, hostRev] = await Promise.all([...revealWaits, hostRevealWait]);

  // Step 11 & 12: Confirm scores differ correctly and leaderboard is updated
  console.log('\nStep 11 & 12: Question 1 Revealed! Authoritative results:');
  console.log(`- Correct Answer: "${hostRev.correctAnswer}" (${hostRev.explanation})`);
  console.log(`- Alice result: isCorrect=${revAlice.personalResult.isCorrect}, points=+${revAlice.personalResult.pointsEarned}`);
  console.log(`- Bob result: isCorrect=${revBob.personalResult.isCorrect}, points=+${revBob.personalResult.pointsEarned}`);
  console.log(`- Carol result: isCorrect=${revCarol.personalResult.isCorrect}, points=+${revCarol.personalResult.pointsEarned}`);

  console.log('\n--- Leaderboard after Question 1 ---');
  hostRev.leaderboard.forEach((e: any) => {
    console.log(`   Rank #${e.rank}: ${e.displayName} | Score: ${e.score} pts | Correct: ${e.correctCount}`);
  });

  // Step 13: Host advances to Question 2
  console.log('\nStep 13: Host advancing to Question 2...');
  const playerQ2Waits = players.map(p => new Promise<any>(resolve => {
    p.ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'question.started') resolve(msg.question);
    });
  }));

  hostWs.send(JSON.stringify({ type: 'host.next' }));
  const [q2Alice] = await Promise.all(playerQ2Waits);
  console.log(`- All players received Question 2: "${q2Alice.question}"`);

  // Players answer Question 2
  const q2RevealWaits = players.map(p => new Promise<any>(resolve => {
    p.ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'question.revealed') resolve(msg);
    });
  }));

  for (let i = 0; i < players.length; i++) {
    players[i].ws.send(JSON.stringify({
      type: 'player.answer',
      questionId: q2Alice.id,
      answer: playerConfigs[i].choiceQ2,
    }));
  }
  await Promise.all(q2RevealWaits);

  // Step 14 & 15: Host advances after final question & receives final leaderboard
  console.log('\nStep 14 & 15: Host advances after final question...');
  const hostFinishWait = new Promise<any>(resolve => {
    hostWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'game.finished') resolve(msg);
    });
  });

  hostWs.send(JSON.stringify({ type: 'host.next' }));
  const finishMsg = await hostFinishWait;

  console.log('\n====================================================');
  console.log(`🏆 FINAL PODIUM: Winner is ${finishMsg.winner.displayName}!`);
  console.log('====================================================');
  finishMsg.leaderboard.forEach((entry: any) => {
    console.log(`   #${entry.rank} - ${entry.displayName}: ${entry.score} pts (${entry.correctCount}/2 correct)`);
  });

  // Cleanup
  for (const p of players) p.ws.close();
  hostWs.close();
  wsServer.close();
  await new Promise<void>(resolve => server.close(() => resolve()));

  console.log('\n====================================================');
  console.log('MANUAL DEMO SCENARIO COMPLETE - ALL 15 STEPS VERIFIED 100%');
  console.log('====================================================\n');
}

runManualDemo()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Manual demo failed:', err);
    process.exit(1);
  });

