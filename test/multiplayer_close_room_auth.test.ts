import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';

test('Close Room Full Security & Verification', async () => {
  const app = createApp();

  // Test 1: Check CORS preflight response headers includes X-Host-Token
  const preflightRes = await request(app)
    .options('/api/rooms/TEST12/close')
    .set('Origin', 'https://ai-game-tau.vercel.app')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'x-host-token');

  assert.equal(preflightRes.status, 204);
  const allowHeaders = (preflightRes.headers['access-control-allow-headers'] || '').toLowerCase();
  assert.ok(allowHeaders.includes('x-host-token'), 'CORS must allow x-host-token header');

  const testSpec = {
    gameId: `test_game_close_fix_${Date.now()}`,
    ownerUserId: 'test_creator_123',
    title: 'Test Game',
    description: 'Test Description',
    gameType: 'MULTIPLE_CHOICE' as const,
    isPublic: true,
    generatedAt: new Date().toISOString(),
    sourceSummary: {
      sourceCount: 1,
      sources: [{ sourceId: 'src1', sourceName: 'Sample', sourceType: 'TXT', sourceLocation: 'inline' }],
      totalCharacterCount: 100,
    },
    questions: [
      {
        id: 'q1',
        type: 'MULTIPLE_CHOICE' as const,
        question: 'Question 1?',
        choices: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
        difficulty: 'EASY' as const,
        sourceReference: {
          sourceId: 'src1',
          sourceType: 'TXT' as const,
          sourceLocation: 'inline',
        },
      },
    ],
    settings: {
      questionCount: 1,
      timePerQuestion: 20,
      scoringMode: 'STANDARD' as const,
    },
  };
  gameStore.save(testSpec as any, Date.now(), 'test_creator_123', true);

  // Helper to create room
  async function makeRoom() {
    const res = await request(app)
      .post('/api/rooms')
      .send({
        gameId: testSpec.gameId,
        capacity: 50,
        requirePublished: false,
      });
    assert.equal(res.status, 200);
    return res.body.data;
  }

  // Test 2: Valid close via x-host-token header
  const r1 = await makeRoom();
  const close1 = await request(app)
    .post(`/api/rooms/${r1.roomCode}/close`)
    .set('x-host-token', r1.hostToken);
  assert.equal(close1.status, 200);
  assert.equal(close1.body.data.closed, true);

  // Test 3: Valid close via JSON body with Content-Type: application/json
  const r2 = await makeRoom();
  const close2 = await request(app)
    .post(`/api/rooms/${r2.roomCode}/close`)
    .set('Content-Type', 'application/json')
    .send({ hostToken: r2.hostToken });
  assert.equal(close2.status, 200);
  assert.equal(close2.body.data.closed, true);

  // Test 4: Rejection when Host Token is sent only via URL query param -> 403 ACCESS_DENIED
  const r3 = await makeRoom();
  const close3 = await request(app)
    .post(`/api/rooms/${r3.roomCode}/close?hostToken=${r3.hostToken}`)
    .send({});
  assert.equal(close3.status, 403);
  assert.equal(close3.body.error.code, 'ACCESS_DENIED');

  // Test 5: Rejection with invalid hostToken -> 403
  const r4 = await makeRoom();
  const closeInvalid = await request(app)
    .post(`/api/rooms/${r4.roomCode}/close`)
    .set('x-host-token', 'invalid_random_token_12345');
  assert.equal(closeInvalid.status, 403);
  assert.equal(closeInvalid.body.error.code, 'ACCESS_DENIED');

  // Test 6: Rejection with no hostToken (guest/stranger) -> 403
  const r5 = await makeRoom();
  const closeEmpty = await request(app)
    .post(`/api/rooms/${r5.roomCode}/close`)
    .send({});
  assert.equal(closeEmpty.status, 403);
  assert.equal(closeEmpty.body.error.code, 'ACCESS_DENIED');

  // Test 7: Stranger with player token cannot close room -> 403
  const r6 = await makeRoom();
  const closePlayer = await request(app)
    .post(`/api/rooms/${r6.roomCode}/close`)
    .set('x-player-token', 'random_player_token_123');
  assert.equal(closePlayer.status, 403);
  assert.equal(closePlayer.body.error.code, 'ACCESS_DENIED');

  // Test 8: Host A cannot close Room B with Host A's token -> 403
  const rA = await makeRoom();
  const rB = await makeRoom();
  const closeCrossRoom = await request(app)
    .post(`/api/rooms/${rB.roomCode}/close`)
    .set('x-host-token', rA.hostToken);
  assert.equal(closeCrossRoom.status, 403);
  assert.equal(closeCrossRoom.body.error.code, 'ACCESS_DENIED');
});
