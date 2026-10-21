import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import type { AiModelProvider, AiProviderUsageMetadata } from '../src/providers/ai.provider.interface.js';

class FullFlowMockAiProvider implements AiModelProvider {
  public mockQuestions = [
    {
      id: 'q_ff_1',
      type: 'MULTIPLE_CHOICE',
      question: 'Thủ đô của Việt Nam là gì?',
      choices: ['Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'],
      correctAnswer: 'Hà Nội',
      explanation: 'Hà Nội là thủ đô của Việt Nam.',
      difficulty: 'EASY',
    },
    {
      id: 'q_ff_2',
      type: 'MULTIPLE_CHOICE',
      question: 'Sông nào dài nhất Việt Nam?',
      choices: ['Sông Đồng Nai', 'Sông Hồng', 'Sông Tiền', 'Sông Hậu'],
      correctAnswer: 'Sông Đồng Nai',
      explanation: 'Sông Đồng Nai là sông nội địa dài nhất Việt Nam.',
      difficulty: 'MEDIUM',
    },
  ];
  public mockTitle = 'Trắc Nghiệm Kiến Thức Địa Lý';

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    return {
      title: this.mockTitle,
      description: 'Bộ câu hỏi tự động kiểm tra kiến thức.',
      questions: this.mockQuestions,
    };
  }

  getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      usageReportedByProvider: true,
    };
  }
}

describe('COMPREHENSIVE AUDIT & ACCEPTANCE — AI Game Platform Full Flow & Authorization', () => {
  let adminToken: string;
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;
  let mockProvider: FullFlowMockAiProvider;

  before(async () => {
    mockProvider = new FullFlowMockAiProvider();
    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();

    // 1. Register User A
    const regA = await request(app)
      .post('/api/auth/register')
      .send({
        email: `usera_${Date.now()}@test.vn`,
        password: 'Password123!',
        displayName: 'Giáo Viên A',
      });
    assert.equal(regA.status, 201);
    userAToken = regA.body.data.token;
    userAId = regA.body.data.user.userId;

    // 2. Register User B
    const regB = await request(app)
      .post('/api/auth/register')
      .send({
        email: `userb_${Date.now()}@test.vn`,
        password: 'Password123!',
        displayName: 'Giáo Viên B',
      });
    assert.equal(regB.status, 201);
    userBToken = regB.body.data.token;
    userBId = regB.body.data.user.userId;

    // 3. Register Admin User
    const regAdmin = await request(app)
      .post('/api/auth/register')
      .send({
        email: `admin_${Date.now()}@test.vn`,
        password: 'AdminPassword123!',
        displayName: 'Hệ Thống Admin',
      });
    assert.equal(regAdmin.status, 201);
    adminToken = regAdmin.body.data.token;
    const adminId = regAdmin.body.data.user.userId;

    // Elevate role to ADMIN in DB
    const db = getDatabase();
    db.prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?").run(adminId);
  });

  beforeEach(() => {
    resetAllRateLimiters();
    gameStore.clear();
    roomStore.clear();
  });

  afterEach(() => {
    resetAllRateLimiters();
    gameStore.clear();
    roomStore.clear();
  });

  // =========================================================================
  // 1. Luồng Tạo Game AI, Xem trước, Chỉnh sửa, Lưu Draft và Xuất bản
  // =========================================================================
  it('1. Admin/Creator creates game, edits questions, saves as DRAFT, and verifies draft isolation', async () => {
    // Ingest content first as User A
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${userAToken}`)
      .attach(
        'files',
        Buffer.from('Tài liệu địa lý Việt Nam. Hà Nội là thủ đô. Sông Đồng Nai là sông nội địa dài nhất.', 'utf-8'),
        'dia_ly_vn.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0]?.sourceId;
    assert.ok(sourceId);

    // AI Generates game (initially saved as DRAFT in SQLite and in-memory store)
    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        sourceIds: [sourceId],
        gameType: 'MULTIPLE_CHOICE',
        difficulty: 'MEDIUM',
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
      });
    assert.equal(genRes.status, 200);
    const createdSpec = genRes.body.data;
    assert.ok(createdSpec.gameId);
    assert.equal(createdSpec.isPublic, false, 'Game should start as unpublished draft');
    assert.equal(createdSpec.ownerUserId, userAId);

    // Verify creator edits and updates questions before saving
    const modifiedQuestions = createdSpec.questions.map((q: any, idx: number) => ({
      ...q,
      question: `Câu hỏi đã biên tập #${idx + 1}: ${q.question}`,
    }));

    const updateRes = await request(app)
      .patch(`/api/games/${createdSpec.gameId}/questions`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        title: 'Bộ Câu Hỏi Kiểm Tra Kiến Thức - Bản Đã Sửa',
        questions: modifiedQuestions,
        isPublic: false, // Save as draft
      });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.title, 'Bộ Câu Hỏi Kiểm Tra Kiến Thức - Bản Đã Sửa');
    assert.equal(updateRes.body.data.isPublic, false);

    // Public solo play link and public QR must reject draft games with 403 GAME_NOT_PUBLISHED
    const qrRes = await request(app).get(`/api/games/${createdSpec.gameId}/qr`);
    assert.equal(qrRes.status, 403);
    assert.equal(qrRes.body.error.code, 'GAME_NOT_PUBLISHED');

    const publicSessionRes = await request(app)
      .post('/api/games/sessions')
      .send({
        gameId: createdSpec.gameId,
        publicPlay: true,
      });
    assert.equal(publicSessionRes.status, 403);
    assert.equal(publicSessionRes.body.error.code, 'GAME_NOT_PUBLISHED');

    // Public multiplayer room must reject draft games with 403 GAME_NOT_PUBLISHED
    const publicRoomRes = await request(app)
      .post('/api/rooms')
      .send({
        gameId: createdSpec.gameId,
        requirePublished: true,
      });
    assert.equal(publicRoomRes.status, 403);
    assert.equal(publicRoomRes.body.error.code, 'GAME_NOT_PUBLISHED');
  });

  // =========================================================================
  // 2. Chế độ Chơi Đơn vs Chơi Nhóm Multiplayer sau khi Xuất Bản
  // =========================================================================
  it('2. Publishing game unlocks Solo Play (Link/QR) and Multiplayer Room creation seamlessly', async () => {
    // Ingest and generate
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${userAToken}`)
      .attach(
        'files',
        Buffer.from('Tài liệu trắc nghiệm văn hóa lịch sử Việt Nam.', 'utf-8'),
        'van_hoa.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        sourceIds: [sourceId],
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 2,
        timePerQuestion: 15,
      });
    assert.equal(genRes.status, 200);
    const game = genRes.body.data;

    // Publish the game
    const publishRes = await request(app)
      .patch(`/api/games/${game.gameId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        questions: game.questions,
        isPublic: true,
      });
    assert.equal(publishRes.status, 200);
    assert.equal(publishRes.body.data.isPublic, true);

    // Now QR code and public solo play link are generated successfully
    const qrRes = await request(app).get(`/api/games/${game.gameId}/qr`);
    assert.equal(qrRes.status, 200);
    assert.ok(qrRes.body.data.playUrl.includes(game.gameId));
    assert.ok(qrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));

    // Public player starts solo play without requiring login
    const sessionRes = await request(app)
      .post('/api/games/sessions')
      .send({
        gameId: game.gameId,
        publicPlay: true,
      });
    assert.equal(sessionRes.status, 200);
    const sessionId = sessionRes.body.data.sessionId;

    const startRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(startRes.status, 200);
    assert.ok(startRes.body.data.question.id);
    assert.equal(startRes.body.data.question.correctAnswer, undefined, 'Must not leak correct answer to player');

    // Host opens Multiplayer room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        gameId: game.gameId,
        capacity: 100,
        requirePublished: true,
      });
    assert.equal(roomRes.status, 200);
    assert.ok(roomRes.body.data.roomCode);
    assert.ok(roomRes.body.data.hostToken);
    assert.ok(roomRes.body.data.joinUrl.includes(roomRes.body.data.roomCode));
  });

  // =========================================================================
  // 3. Phân Quyền Sở Hữu: User B không thể sửa/xóa game của User A
  // =========================================================================
  it('3. Strictly prevents User B from editing or deleting User A games (Ownership enforcement)', async () => {
    // Create game as User A
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${userAToken}`)
      .attach(
        'files',
        Buffer.from('Tài liệu mật của User A.', 'utf-8'),
        'secret_user_a.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        sourceIds: [sourceId],
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 2,
      });
    assert.equal(genRes.status, 200);
    const gameA = genRes.body.data;

    // User B attempts to modify User A's game -> must be rejected with 403 ACCESS_DENIED
    const unauthorizedEdit = await request(app)
      .patch(`/api/games/${gameA.gameId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        title: 'Hacked by User B',
        questions: gameA.questions,
      });
    assert.equal(unauthorizedEdit.status, 403);
    assert.equal(unauthorizedEdit.body.error.code, 'ACCESS_DENIED');

    // User B attempts to delete User A's game -> must be rejected with 403 ACCESS_DENIED
    const unauthorizedDelete = await request(app)
      .delete(`/api/games/${gameA.gameId}`)
      .set('Authorization', `Bearer ${userBToken}`);
    assert.equal(unauthorizedDelete.status, 403);
    assert.equal(unauthorizedDelete.body.error.code, 'ACCESS_DENIED');

    // But ADMIN CAN manage/delete User A's game
    const adminEdit = await request(app)
      .patch(`/api/games/${gameA.gameId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Admin Audited Game Title',
        questions: gameA.questions,
      });
    assert.equal(adminEdit.status, 200);
    assert.equal(adminEdit.body.data.title, 'Admin Audited Game Title');
  });

  // =========================================================================
  // 4. Ngăn chặn triệt để Client Người Chơi (X-Player-Token) ghi dữ liệu
  // =========================================================================
  it('4. Strictly rejects player client writes with X-Player-Token (403 ACCESS_DENIED)', async () => {
    const fakePlayerToken = 'pt_rogue_player_token_123';

    // 1. Ingest content with X-Player-Token -> rejected
    const ingestBlocked = await request(app)
      .post('/api/content/ingest')
      .set('X-Player-Token', fakePlayerToken)
      .send({ urls: ['https://example.com'] });
    assert.equal(ingestBlocked.status, 403);
    assert.equal(ingestBlocked.body.error.code, 'ACCESS_DENIED');

    // 2. Generate game with X-Player-Token -> rejected
    const genBlocked = await request(app)
      .post('/api/games/generate')
      .set('X-Player-Token', fakePlayerToken)
      .send({ sourceIds: ['src_test'], gameType: 'MULTIPLE_CHOICE' });
    assert.equal(genBlocked.status, 403);
    assert.equal(genBlocked.body.error.code, 'ACCESS_DENIED');

    // 3. Create room with X-Player-Token -> rejected
    const roomBlocked = await request(app)
      .post('/api/rooms')
      .set('X-Player-Token', fakePlayerToken)
      .send({ gameId: 'g_test', capacity: 50 });
    assert.equal(roomBlocked.status, 403);
    assert.equal(roomBlocked.body.error.code, 'ACCESS_DENIED');

    // 4. Update questions with X-Player-Token -> rejected
    const updateBlocked = await request(app)
      .patch('/api/games/g_test')
      .set('X-Player-Token', fakePlayerToken)
      .send({ questions: [] });
    assert.equal(updateBlocked.status, 403);
    assert.equal(updateBlocked.body.error.code, 'ACCESS_DENIED');
  });

  // =========================================================================
  // 5. Endpoint /api/auth/whoami trả về đúng định dạng phiên
  // =========================================================================
  it('5. GET /api/auth/whoami resolves authenticated user, guest token, or anonymous state correctly', async () => {
    // 1. With User A Bearer Token
    const whoamiUser = await request(app)
      .get('/api/auth/whoami')
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(whoamiUser.status, 200);
    assert.equal(whoamiUser.body.data.user.userId, userAId);
    assert.equal(whoamiUser.body.data.isGuest, false);

    // 2. With X-Guest-Token
    const whoamiGuest = await request(app)
      .get('/api/auth/whoami')
      .set('X-Guest-Token', 'gt_0123456789abcdef01234567');
    assert.equal(whoamiGuest.status, 200);
    assert.ok(whoamiGuest.body.data.user.userId.startsWith('guest_'));
    assert.equal(whoamiGuest.body.data.isGuest, true);

    // 3. Anonymous (no token)
    const whoamiAnon = await request(app).get('/api/auth/whoami');
    assert.equal(whoamiAnon.status, 200);
    assert.equal(whoamiAnon.body.data.user, null);
    assert.equal(whoamiAnon.body.data.isGuest, false);
  });
});
