import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { getDatabase } from '../src/storage/sqlite.db.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import type { AiModelProvider, AiProviderUsageMetadata } from '../src/providers/ai.provider.interface.js';

class GuestHardeningMockAiProvider implements AiModelProvider {
  public aiCalled = false;
  public mockQuestions = [
    {
      id: 'q_gh_1',
      type: 'MULTIPLE_CHOICE',
      question: 'Thủ đô của Việt Nam là gì?',
      choices: ['Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'],
      correctAnswer: 'Hà Nội',
      explanation: 'Hà Nội là thủ đô của Việt Nam.',
      difficulty: 'EASY',
    },
  ];
  public mockTitle = 'Bộ Câu Hỏi An Toàn Thông Tin';

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    this.aiCalled = true;
    return {
      title: this.mockTitle,
      description: 'Bộ câu hỏi kiểm thử bảo mật phân quyền guest.',
      questions: this.mockQuestions,
    };
  }

  getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      usageReportedByProvider: true,
    };
  }
}

describe('GUEST AUTHORIZATION HARDENING — Regression & Security Tests', () => {
  let mockProvider: GuestHardeningMockAiProvider;
  let organizerToken: string;
  let organizerUserId: string;
  let organizerBToken: string;
  let organizerBUserId: string;
  let adminToken: string;
  let adminUserId: string;
  const guestToken = 'gt_99999999999999999999999999999999';

  before(async () => {
    mockProvider = new GuestHardeningMockAiProvider();
    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();

    // 1. Register Organizer A
    const regA = await request(app)
      .post('/api/auth/register')
      .send({
        email: `organizer_gh_a_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Người Tổ Chức A',
      });
    assert.equal(regA.status, 201);
    organizerToken = regA.body.data.token;
    organizerUserId = regA.body.data.user.userId;

    // 2. Register Organizer B
    const regB = await request(app)
      .post('/api/auth/register')
      .send({
        email: `organizer_gh_b_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Người Tổ Chức B',
      });
    assert.equal(regB.status, 201);
    organizerBToken = regB.body.data.token;
    organizerBUserId = regB.body.data.user.userId;

    // 3. Register Admin
    const regAdmin = await request(app)
      .post('/api/auth/register')
      .send({
        email: `admin_gh_${Date.now()}@example.com`,
        password: 'AdminPassword123!',
        displayName: 'Quản Trị Viên GH',
      });
    assert.equal(regAdmin.status, 201);
    adminToken = regAdmin.body.data.token;
    adminUserId = regAdmin.body.data.user.userId;

    getDatabase()
      .prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?")
      .run(adminUserId);
  });

  beforeEach(() => {
    mockProvider.aiCalled = false;
    resetAllRateLimiters();
    gameStore.clear();
    roomStore.clear();
  });

  // 1. Guest gọi POST /api/content/ingest bị từ chối
  it('1. Guest calling POST /api/content/ingest is strictly rejected with 403 ACCESS_DENIED', async () => {
    const res = await request(app)
      .post('/api/content/ingest')
      .set('X-Guest-Token', guestToken)
      .attach(
        'files',
        Buffer.from('Tài liệu tấn công của guest nạp lên hệ thống.', 'utf-8'),
        'guest_malicious.txt'
      );
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCESS_DENIED');
    assert.match(res.body.error.message, /khách/i);
  });

  // 2. Guest gọi POST /api/games/generate bị từ chối trước khi AI được thực thi
  it('2. Guest calling POST /api/games/generate is rejected with 403 before AI execution', async () => {
    mockProvider.aiCalled = false;
    const res = await request(app)
      .post('/api/games/generate')
      .set('X-Guest-Token', guestToken)
      .send({
        sourceIds: ['src_dummy_123'],
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 2,
      });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCESS_DENIED');
    assert.equal(mockProvider.aiCalled, false, 'AI generation must NOT be executed for guest callers');
  });

  // Helper function to create a sample published or draft game by Organizer A
  async function createOrganizerGame(isPublic: boolean = false) {
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${organizerToken}`)
      .attach(
        'files',
        Buffer.from('Tài liệu đào tạo an toàn thông tin doanh nghiệp.', 'utf-8'),
        'security_guide.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        sourceIds: [sourceId],
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
      });
    assert.equal(genRes.status, 200);
    const game = genRes.body.data;

    if (isPublic) {
      const pubRes = await request(app)
        .patch(`/api/games/${game.gameId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ questions: game.questions, isPublic: true });
      if (pubRes.status !== 200) {
        console.error('pubRes failed:', pubRes.status, pubRes.body);
      }
      assert.equal(pubRes.status, 200);
      return pubRes.body.data;
    }

    return game;
  }

  // 3. Guest không thể PATCH game dù ownerUserId trùng guest ID
  it('3. Guest cannot PATCH a game even if ownerUserId historically matches guest ID', async () => {
    const orgGame = await createOrganizerGame(false);

    // Attempt PATCH with X-Guest-Token
    const patchRes = await request(app)
      .patch(`/api/games/${orgGame.gameId}`)
      .set('X-Guest-Token', guestToken)
      .send({
        title: 'Tampered Title by Guest',
        questions: orgGame.questions,
      });
    assert.equal(patchRes.status, 403);
    assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');

    // Simulate game created with guest ID in DB
    const guestHash = '999999999999999999999999';
    const fakeGuestId = `guest_${guestHash}`;
    const db = getDatabase();
    db.prepare('UPDATE games SET owner_user_id = ? WHERE game_id = ?').run(fakeGuestId, orgGame.gameId);
    const storeSpec = gameStore.get(orgGame.gameId);
    if (storeSpec) storeSpec.ownerUserId = fakeGuestId;

    // Even if ownerUserId == guestId, Guest is still strictly rejected from writing
    const patchWithMatchingGuest = await request(app)
      .patch(`/api/games/${orgGame.gameId}`)
      .set('X-Guest-Token', guestToken)
      .send({
        title: 'Tampered Title by Matching Guest',
        questions: orgGame.questions,
      });
    assert.equal(patchWithMatchingGuest.status, 403);
    assert.equal(patchWithMatchingGuest.body.error.code, 'ACCESS_DENIED');
  });

  // 4. Guest không thể DELETE game
  it('4. Guest cannot DELETE a game', async () => {
    const orgGame = await createOrganizerGame(false);
    const delRes = await request(app)
      .delete(`/api/games/${orgGame.gameId}`)
      .set('X-Guest-Token', guestToken);
    assert.equal(delRes.status, 403);
    assert.equal(delRes.body.error.code, 'ACCESS_DENIED');
    assert.ok(gameStore.get(orgGame.gameId), 'Game must not be deleted');
  });

  // 5. Guest không thể xuất bản game
  it('5. Guest cannot publish a game (isPublic: true)', async () => {
    const orgGame = await createOrganizerGame(false);
    const pubRes = await request(app)
      .patch(`/api/games/${orgGame.gameId}`)
      .set('X-Guest-Token', guestToken)
      .send({
        questions: orgGame.questions,
        isPublic: true,
      });
    assert.equal(pubRes.status, 403);
    assert.equal(pubRes.body.error.code, 'ACCESS_DENIED');
  });

  // 6. Guest không thể vượt qua kiểm tra bằng cách thay đổi userId, ownerUserId hoặc role trong request body
  it('6. Guest cannot bypass checks by injecting spoofed userId, ownerUserId or role in request body', async () => {
    const orgGame = await createOrganizerGame(false);

    // Ingest with spoofed role & userId in body
    const spoofIngest = await request(app)
      .post('/api/content/ingest')
      .set('X-Guest-Token', guestToken)
      .send({
        urls: ['https://example.com'],
        role: 'ADMIN',
        userId: adminUserId,
        ownerUserId: adminUserId,
      });
    assert.equal(spoofIngest.status, 403);
    assert.equal(spoofIngest.body.error.code, 'ACCESS_DENIED');

    // Generate with spoofed role & userId in body
    const spoofGen = await request(app)
      .post('/api/games/generate')
      .set('X-Guest-Token', guestToken)
      .send({
        sourceIds: ['src_test'],
        gameType: 'MULTIPLE_CHOICE',
        role: 'ADMIN',
        userId: adminUserId,
        ownerUserId: adminUserId,
      });
    assert.equal(spoofGen.status, 403);
    assert.equal(spoofGen.body.error.code, 'ACCESS_DENIED');

    // Patch with spoofed role in body
    const spoofPatch = await request(app)
      .patch(`/api/games/${orgGame.gameId}`)
      .set('X-Guest-Token', guestToken)
      .send({
        title: 'Spoofed Admin Patch',
        questions: orgGame.questions,
        role: 'ADMIN',
        ownerUserId: organizerUserId,
      });
    assert.equal(spoofPatch.status, 403);
    assert.equal(spoofPatch.body.error.code, 'ACCESS_DENIED');
  });

  // 7. Tài khoản người tổ chức hợp lệ vẫn tạo và quản lý game theo quyền hiện có
  it('7. Verified organizer account can ingest, generate, edit, publish and delete their games', async () => {
    const orgGame = await createOrganizerGame(false);
    assert.ok(orgGame.gameId);
    assert.equal(orgGame.ownerUserId, organizerUserId);

    // Edit questions
    const editRes = await request(app)
      .patch(`/api/games/${orgGame.gameId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Tiêu Đề Mới Bởi Người Tổ Chức',
        questions: orgGame.questions,
        isPublic: true,
      });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.data.isPublic, true);

    // Delete own game
    const deleteRes = await request(app)
      .delete(`/api/games/${orgGame.gameId}`)
      .set('Authorization', `Bearer ${organizerToken}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.data.deleted, true);
  });

  // 8. Admin vẫn có quyền quản trị theo chính sách hiện tại
  it('8. Admin retains full administrative management rights over any game', async () => {
    const orgGame = await createOrganizerGame(false);

    // Admin edits Organizer A's game
    const adminPatch = await request(app)
      .patch(`/api/games/${orgGame.gameId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Tiêu Đề Được Sửa Bởi Admin',
        questions: orgGame.questions,
      });
    assert.equal(adminPatch.status, 200);
    assert.equal(adminPatch.body.data.title, 'Tiêu Đề Được Sửa Bởi Admin');

    // Admin deletes Organizer A's game
    const adminDelete = await request(app)
      .delete(`/api/games/${orgGame.gameId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminDelete.status, 200);
    assert.equal(adminDelete.body.data.deleted, true);
  });

  // 9. Người chơi chưa đăng nhập vẫn chơi được game đã xuất bản qua link đơn
  it('9. Unauthenticated and guest players can play a published game via solo play link', async () => {
    const publishedGame = await createOrganizerGame(true);

    // Player with guest token starts solo session
    const guestSessionRes = await request(app)
      .post('/api/games/sessions')
      .set('X-Guest-Token', guestToken)
      .send({
        gameId: publishedGame.gameId,
        publicPlay: true,
      });
    assert.equal(guestSessionRes.status, 200);
    const guestSessionId = guestSessionRes.body.data.sessionId;

    const startRes = await request(app)
      .post(`/api/games/sessions/${guestSessionId}/start`)
      .set('X-Guest-Token', guestToken);
    assert.equal(startRes.status, 200);
    assert.ok(startRes.body.data.question.id);

    // Answer question
    const ansRes = await request(app)
      .post(`/api/games/sessions/${guestSessionId}/answer`)
      .set('X-Guest-Token', guestToken)
      .send({
        questionId: startRes.body.data.question.id,
        answer: 'Hà Nội',
        clientTimestamp: Date.now(),
      });
    assert.equal(ansRes.status, 200);
    assert.equal(ansRes.body.data.isCorrect, true);

    // Completely anonymous player (no token at all) can also start session
    const anonSessionRes = await request(app)
      .post('/api/games/sessions')
      .send({
        gameId: publishedGame.gameId,
        publicPlay: true,
      });
    assert.equal(anonSessionRes.status, 200);
  });

  // 10. Người chơi vẫn tham gia được Multiplayer và gửi đáp án hợp lệ
  it('10. Players can join a multiplayer room, receive questions, and submit valid answers', async () => {
    const publishedGame = await createOrganizerGame(true);

    // Host creates room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        gameId: publishedGame.gameId,
        capacity: 50,
        requirePublished: true,
      });
    assert.equal(roomRes.status, 200);
    const { roomCode, hostToken } = roomRes.body.data;

    // Player joins room via roomService
    const room = roomService.getRoomByCode(roomCode);
    const joinResult = room.addPlayer('Học Sinh A');
    assert.ok(joinResult.player.playerToken);

    // Host starts room
    const firstQ = room.start(hostToken);
    assert.equal(room.state, 'QUESTION_ACTIVE');
    assert.ok(firstQ.id);

    // Player submits answer
    const subResult = room.submitPlayerAnswer(joinResult.player.playerToken, firstQ.id, 'Hà Nội');
    assert.equal(subResult.result.isCorrect, true);
  });

  // 11. Người chơi không thể dùng Player token để tạo hoặc sửa game
  it('11. Multiplayer player token cannot be used to ingest, generate, or patch games', async () => {
    const fakePlayerToken = 'pt_rogue_player_token_999';

    const ingestBlocked = await request(app)
      .post('/api/content/ingest')
      .set('X-Player-Token', fakePlayerToken)
      .send({ urls: ['https://evil.com'] });
    assert.equal(ingestBlocked.status, 403);
    assert.equal(ingestBlocked.body.error.code, 'ACCESS_DENIED');

    const genBlocked = await request(app)
      .post('/api/games/generate')
      .set('X-Player-Token', fakePlayerToken)
      .send({ sourceIds: ['src_dummy'], gameType: 'MULTIPLE_CHOICE' });
    assert.equal(genBlocked.status, 403);
    assert.equal(genBlocked.body.error.code, 'ACCESS_DENIED');
  });

  // 12. Game nháp vẫn không thể truy cập công khai
  it('12. Draft games cannot be accessed via public solo play link or public QR', async () => {
    const draftGame = await createOrganizerGame(false);

    // QR retrieval rejected
    const qrRes = await request(app).get(`/api/games/${draftGame.gameId}/qr`);
    assert.equal(qrRes.status, 403);
    assert.equal(qrRes.body.error.code, 'GAME_NOT_PUBLISHED');

    // Public solo session rejected
    const soloRes = await request(app)
      .post('/api/games/sessions')
      .send({
        gameId: draftGame.gameId,
        publicPlay: true,
      });
    assert.equal(soloRes.status, 403);
    assert.equal(soloRes.body.error.code, 'GAME_NOT_PUBLISHED');
  });

  // 13. Các test ownership/IDOR giữa User A và User B vẫn PASS
  it('13. Cross-user IDOR protection strictly rejects User B from editing or deleting User A games', async () => {
    const orgGameA = await createOrganizerGame(false);

    // User B attempts to patch User A's game -> 403 ACCESS_DENIED
    const patchRes = await request(app)
      .patch(`/api/games/${orgGameA.gameId}`)
      .set('Authorization', `Bearer ${organizerBToken}`)
      .send({
        title: 'Hacked by Organizer B',
        questions: orgGameA.questions,
      });
    assert.equal(patchRes.status, 403);
    assert.equal(patchRes.body.error.code, 'ACCESS_DENIED');

    // User B attempts to delete User A's game -> 403 ACCESS_DENIED
    const delRes = await request(app)
      .delete(`/api/games/${orgGameA.gameId}`)
      .set('Authorization', `Bearer ${organizerBToken}`);
    assert.equal(delRes.status, 403);
    assert.equal(delRes.body.error.code, 'ACCESS_DENIED');
  });
});
