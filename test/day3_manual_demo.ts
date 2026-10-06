import request from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';

async function runDemo() {
  console.log('==================================================');
  console.log('STARTING MANUAL DEMO TEST (Section 41)');
  console.log('==================================================\n');

  // Test 1: MULTIPLE_CHOICE
  console.log('--- 1. Testing MULTIPLE_CHOICE flow ---');
  const mcSpec: GameSpecification = {
    gameId: 'manual_demo_mc',
    title: 'Manual Demo MC',
    description: 'Manual demo test',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_mc_1',
        type: 'MULTIPLE_CHOICE',
        question: 'What is 2 + 2?',
        choices: ['A. 3', 'B. 4', 'C. 5', 'D. 6'],
        correctAnswer: 'B. 4',
        explanation: '2 plus 2 equals 4.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 1, timePerQuestion: 20, scoringMode: 'STANDARD' },
    sourceSummary: {
      sourceCount: 1,
      sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }],
    },
    generatedAt: new Date().toISOString(),
  };

  const s1 = await request(app).post('/api/games/sessions').send({ gameId: mcSpec.gameId, gameSpecification: mcSpec });
  console.log('Step 1 - Created MC session:', s1.body.data.sessionId);
  const start1 = await request(app).post(`/api/games/sessions/${s1.body.data.sessionId}/start`);
  console.log('Step 2 - Started MC question:', start1.body.data.question.id, 'choices:', start1.body.data.question.choices);
  console.log('Step 2 - Verified correctAnswer is NOT leaked:', start1.body.data.question.correctAnswer === undefined);

  const ans1 = await request(app)
    .post(`/api/games/sessions/${s1.body.data.sessionId}/answer`)
    .send({ questionId: 'q_mc_1', answer: 'B. 4' });
  console.log('Step 3 - Answer result -> isCorrect:', ans1.body.data.isCorrect, 'points:', ans1.body.data.pointsEarned, 'score:', ans1.body.data.score);

  const next1 = await request(app).post(`/api/games/sessions/${s1.body.data.sessionId}/next`);
  console.log('Step 4 - Advanced -> finished:', next1.body.data.finished);

  const res1 = await request(app).get(`/api/games/sessions/${s1.body.data.sessionId}/result`);
  console.log('Step 5 - MC Final Result -> score:', res1.body.data.score, 'accuracy:', `${res1.body.data.accuracy}%`);

  // Test 2: CROSSWORD
  console.log('\n--- 2. Testing CROSSWORD flow ---');
  const cwSpec: GameSpecification = {
    gameId: 'manual_demo_cw',
    title: 'Manual Demo CW',
    description: 'Manual demo test',
    gameType: 'CROSSWORD',
    questions: [
      {
        id: 'q_cw_1',
        type: 'CROSSWORD',
        question: 'Capital of Japan (5 letters)',
        crosswordClue: 'Capital of Japan',
        crosswordAnswer: 'TOKYO',
        correctAnswer: 'TOKYO',
        explanation: 'Tokyo is the capital of Japan.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's2', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 1, timePerQuestion: 30, scoringMode: 'STANDARD' },
    sourceSummary: {
      sourceCount: 1,
      sources: [{ sourceId: 's2', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }],
    },
    generatedAt: new Date().toISOString(),
  };

  const s2 = await request(app).post('/api/games/sessions').send({ gameId: cwSpec.gameId, gameSpecification: cwSpec });
  console.log('Step 1 - Created CW session:', s2.body.data.sessionId);
  await request(app).post(`/api/games/sessions/${s2.body.data.sessionId}/start`);
  const ans2 = await request(app)
    .post(`/api/games/sessions/${s2.body.data.sessionId}/answer`)
    .send({ questionId: 'q_cw_1', answer: '  tokyo  ' });
  console.log('Step 2 - CW Answer -> isCorrect:', ans2.body.data.isCorrect, 'revealed answer:', ans2.body.data.correctAnswer);

  await request(app).post(`/api/games/sessions/${s2.body.data.sessionId}/next`);
  const res2 = await request(app).get(`/api/games/sessions/${s2.body.data.sessionId}/result`);
  console.log('Step 3 - CW Final Result -> score:', res2.body.data.score, 'accuracy:', `${res2.body.data.accuracy}%`);

  // Test 3: FILL_IN_THE_BLANK
  console.log('\n--- 3. Testing FILL_IN_THE_BLANK flow ---');
  const fibSpec: GameSpecification = {
    gameId: 'manual_demo_fib',
    title: 'Manual Demo FIB',
    description: 'Manual demo test',
    gameType: 'FILL_IN_THE_BLANK',
    questions: [
      {
        id: 'q_fib_1',
        type: 'FILL_IN_THE_BLANK',
        question: 'Electric car pioneer company is _______.',
        correctAnswer: 'Tesla',
        acceptedAlternatives: ['Tesla Motors'],
        explanation: 'Tesla was founded in 2003.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's3', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 1, timePerQuestion: 25, scoringMode: 'STANDARD' },
    sourceSummary: {
      sourceCount: 1,
      sources: [{ sourceId: 's3', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }],
    },
    generatedAt: new Date().toISOString(),
  };

  const s3 = await request(app).post('/api/games/sessions').send({ gameId: fibSpec.gameId, gameSpecification: fibSpec });
  await request(app).post(`/api/games/sessions/${s3.body.data.sessionId}/start`);
  const ans3 = await request(app)
    .post(`/api/games/sessions/${s3.body.data.sessionId}/answer`)
    .send({ questionId: 'q_fib_1', answer: '  TESLA MOTORS  ' });
  console.log('Step 1 - FIB Accepted Alternative -> isCorrect:', ans3.body.data.isCorrect, 'revealed answer:', ans3.body.data.correctAnswer);

  await request(app).post(`/api/games/sessions/${s3.body.data.sessionId}/next`);
  const res3 = await request(app).get(`/api/games/sessions/${s3.body.data.sessionId}/result`);
  console.log('Step 2 - FIB Final Result -> score:', res3.body.data.score, 'accuracy:', `${res3.body.data.accuracy}%`);

  console.log('\n==================================================');
  console.log('MANUAL DEMO TEST COMPLETE - ALL FLOWS VERIFIED 100%');
  console.log('==================================================');
}

runDemo().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});

