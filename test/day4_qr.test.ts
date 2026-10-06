import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { roomStore } from '../src/multiplayer/room.store.js';

function createSampleSpec(): GameSpecification {
  return {
    gameId: 'game_qr_test',
    title: 'QR Test Quiz',
    description: 'QR generation test',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_qr_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Is QR code locally generated?',
        choices: ['A. Yes', 'B. No', 'C. Maybe', 'D. Remote API'],
        correctAnswer: 'A. Yes',
        difficulty: 'EASY',
        sourceReference: { sourceId: 's1', sourceType: 'WEBSITE', sourceLocation: 'http://test' },
      },
    ],
    settings: { questionCount: 1, timePerQuestion: 20, scoringMode: 'STANDARD' },
    sourceSummary: { sourceCount: 1, sources: [{ sourceId: 's1', sourceType: 'WEBSITE', sourceName: 'test', sourceLocation: 'http://test' }] },
    generatedAt: new Date().toISOString(),
  };
}

describe('DAY 4 - QR Code Generation Test Suite', () => {
  beforeEach(() => {
    roomStore.clear();
  });

  it('46. should generate player join URL in room creation API', async () => {
    const spec = createSampleSpec();
    const res = await request(app)
      .post('/api/rooms')
      .send({ gameId: spec.gameId, gameSpecification: spec });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.joinUrl);
    assert.match(res.body.data.joinUrl, /\/\?room=[A-Z0-9]{6}/);
  });

  it('47. should return QR Data URL encoding player join URL via GET /api/rooms/:roomCode/qr', async () => {
    const spec = createSampleSpec();
    const createRes = await request(app)
      .post('/api/rooms')
      .send({ gameId: spec.gameId, gameSpecification: spec });

    const roomCode = createRes.body.data.roomCode;
    const qrRes = await request(app).get(`/api/rooms/${roomCode}/qr`);

    assert.equal(qrRes.status, 200);
    assert.equal(qrRes.body.success, true);
    assert.equal(qrRes.body.data.roomCode, roomCode);
    assert.ok(qrRes.body.data.joinUrl);
    assert.ok(qrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));
  });

  it('48. QR payload and response must NEVER expose hostToken', async () => {
    const spec = createSampleSpec();
    const createRes = await request(app)
      .post('/api/rooms')
      .send({ gameId: spec.gameId, gameSpecification: spec });

    const { roomCode, hostToken } = createRes.body.data;
    assert.ok(hostToken);

    const qrRes = await request(app).get(`/api/rooms/${roomCode}/qr`);
    const qrBodyStr = JSON.stringify(qrRes.body);

    assert.equal(qrBodyStr.includes(hostToken), false, 'hostToken leaked in QR endpoint response!');
    assert.equal(qrRes.body.data.joinUrl.includes(hostToken), false, 'hostToken leaked in joinUrl!');
  });
});

