import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/storage/sqlite.db.js';
import { aiQuestionService, AiModelProvider } from '../src/services/ai.question.service.js';
import { AiProviderUsageMetadata } from '../src/services/ai.observability.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';

class Checkpoint3MockAiProvider implements AiModelProvider {
  public mockQuestions: any[] = [];
  public mockTitle = 'Checkpoint 3 AI Game';

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    return {
      title: this.mockTitle,
      description: 'Bộ câu hỏi tạo tự động cho kiểm thử Checkpoint 3.',
      questions: this.mockQuestions,
    };
  }

  getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 240,
      outputTokens: 160,
      totalTokens: 400,
      usageReportedByProvider: true,
    };
  }
}

describe('CHECKPOINT 3 — Shared Game Library, Search/Filter/Pagination, Edit, Single-Player Link/QR & Multiplayer Room', () => {
  let tempDir: string;
  let tempDbPath: string;
  let mockProvider: Checkpoint3MockAiProvider;
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-cp3-test-'));
    tempDbPath = path.join(tempDir, 'cp3_test.sqlite');
    initDatabase(tempDbPath);

    mockProvider = new Checkpoint3MockAiProvider();
    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();

    const userARes = await request(app).post('/api/auth/register').send({
      email: 'organizer_a_cp3@example.com',
      password: 'Password123!',
      displayName: 'Organizer A',
    });
    assert.equal(userARes.status, 201);
    userAToken = userARes.body.data.token;

    const userBRes = await request(app).post('/api/auth/register').send({
      email: 'organizer_b_cp3@example.com',
      password: 'Password123!',
      displayName: 'Organizer B',
    });
    assert.equal(userBRes.status, 201);
    userBToken = userBRes.body.data.token;

    const adminRes = await request(app).post('/api/auth/register').send({
      email: 'admin_cp3@example.com',
      password: 'Password123!',
      displayName: 'System Admin CP3',
    });
    assert.equal(adminRes.status, 201);
    adminToken = adminRes.body.data.token;
    const adminUserId = adminRes.body.data.user.userId;

    // Promote admin account to ADMIN role in SQLite
    getDatabase()
      .prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?")
      .run(adminUserId);
  });

  after(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup lock on Windows
    }
  });

  async function createSampleDraftGame(
    token: string,
    title: string,
    gameType: 'MULTIPLE_CHOICE' | 'QUICK_BUTTON' | 'FILL_IN_THE_BLANK' = 'MULTIPLE_CHOICE'
  ) {
    resetAllRateLimiters();
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${token}`)
      .attach(
        'files',
        Buffer.from(
          `Tài liệu đào tạo "${title}": Hệ thống AI Game Platform hỗ trợ đào tạo nhân sự, sự kiện hội thảo và tương tác thương hiệu.`,
          'utf-8'
        ),
        'training.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    mockProvider.mockTitle = title;
    if (gameType === 'QUICK_BUTTON') {
      mockProvider.mockQuestions = [
        {
          id: 'q_qb_1',
          type: 'QUICK_BUTTON',
          question: 'Câu 1: Hệ thống hỗ trợ mã QR cho người tham gia đúng hay sai?',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation: 'Hỗ trợ đầy đủ mã QR chơi đơn và phòng chơi trực tiếp.',
          difficulty: 'EASY',
        },
        {
          id: 'q_qb_2',
          type: 'QUICK_BUTTON',
          question: 'Câu 2: Người chơi khách có quyền xóa game của người tổ chức không?',
          choices: ['Có', 'Không'],
          correctAnswer: 'Không',
          explanation: 'Người chơi chỉ có quyền tham gia trả lời câu hỏi.',
          difficulty: 'MEDIUM',
        },
      ];
    } else if (gameType === 'FILL_IN_THE_BLANK') {
      mockProvider.mockQuestions = [
        {
          id: 'q_fib_1',
          type: 'FILL_IN_THE_BLANK',
          question: 'Điền từ còn thiếu: Hệ thống hỗ trợ tạo game bằng ___ tự động.',
          correctAnswer: 'AI',
          acceptedAlternatives: ['Trí tuệ nhân tạo'],
          explanation: 'Tạo game bằng AI.',
          difficulty: 'EASY',
        },
        {
          id: 'q_fib_2',
          type: 'FILL_IN_THE_BLANK',
          question: 'Điền từ còn thiếu: Người tham gia quét mã ___ để vào chơi.',
          correctAnswer: 'QR',
          explanation: 'Quét mã QR để tham gia nhanh.',
          difficulty: 'EASY',
        },
      ];
    } else {
      mockProvider.mockQuestions = [
        {
          id: 'q_mc_1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: Nền tảng phục vụ trường hợp sử dụng nào sau đây?',
          choices: ['Đào tạo doanh nghiệp', 'Chỉ chơi offline', 'Chỉ lưu ảnh', 'Không hỗ trợ web'],
          correctAnswer: 'Đào tạo doanh nghiệp',
          explanation: 'Phục vụ giáo dục, đào tạo doanh nghiệp, sự kiện và bán lẻ.',
          difficulty: 'EASY',
        },
        {
          id: 'q_mc_2',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 2: Trạng thái mặc định sau khi AI sinh câu hỏi là gì?',
          choices: ['Bản nháp', 'Đã xóa', 'Đang khóa', 'Tự hủy'],
          correctAnswer: 'Bản nháp',
          explanation: 'Game mới tạo ở trạng thái bản nháp cho đến khi xuất bản.',
          difficulty: 'MEDIUM',
        },
      ];
    }

    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceId,
        gameType,
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
      });
    assert.equal(genRes.status, 200);
    return genRes.body.data;
  }

  it('1. Supports shared game library across authorized accounts, search, status/type filters, pagination, and editing', async () => {
    const game1 = await createSampleDraftGame(
      userAToken,
      'Đào tạo Hội nhập Nhân sự Mới',
      'MULTIPLE_CHOICE'
    );
    const game2 = await createSampleDraftGame(
      userAToken,
      'Kiểm tra An toàn Bảo mật 2026',
      'QUICK_BUTTON'
    );
    const game3 = await createSampleDraftGame(
      userBToken,
      'Sự kiện Ra mắt Sản phẩm Cloud',
      'FILL_IN_THE_BLANK'
    );

    // Publish game1 (User A) and game3 (User B); keep game2 as DRAFT
    const pub1 = await request(app)
      .patch(`/api/games/${game1.gameId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        title: 'Đào tạo Hội nhập Nhân sự Mới',
        questions: game1.questions,
        isPublic: true,
      });
    assert.equal(pub1.status, 200);

    const pub3 = await request(app)
      .patch(`/api/games/${game3.gameId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        title: 'Sự kiện Ra mắt Sản phẩm Cloud',
        questions: game3.questions,
        isPublic: true,
      });
    assert.equal(pub3.status, 200);

    // Admin sees all 3 games (2 published + 1 draft across all users)
    const adminListRes = await request(app)
      .get('/api/games?scope=manage&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminListRes.status, 200);
    assert.equal(adminListRes.body.data.total, 3);
    assert.equal(adminListRes.body.data.games.length, 3);

    // User A sees own 2 games (1 published + 1 draft) + User B's published game = 3 games in shared library
    const userAListRes = await request(app)
      .get('/api/games?scope=manage&limit=10')
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(userAListRes.status, 200);
    assert.equal(userAListRes.body.data.total, 3);

    // Filter by status=PUBLISHED (returns 2 games)
    const publishedRes = await request(app)
      .get('/api/games?scope=manage&status=PUBLISHED')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(publishedRes.status, 200);
    assert.equal(publishedRes.body.data.total, 2);
    assert.equal(
      publishedRes.body.data.games.every((g: any) => g.isPublic === true),
      true
    );

    // Filter by status=DRAFT (returns 1 game: game2)
    const draftRes = await request(app)
      .get('/api/games?scope=manage&status=DRAFT')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(draftRes.status, 200);
    assert.equal(draftRes.body.data.total, 1);
    assert.equal(draftRes.body.data.games[0].gameId, game2.gameId);
    assert.equal(draftRes.body.data.games[0].isPublic, false);

    // Filter by gameType=QUICK_BUTTON
    const quickBtnRes = await request(app)
      .get('/api/games?scope=manage&gameType=QUICK_BUTTON')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(quickBtnRes.status, 200);
    assert.equal(quickBtnRes.body.data.total, 1);
    assert.equal(quickBtnRes.body.data.games[0].gameId, game2.gameId);

    // Search by keyword
    const searchRes = await request(app)
      .get(`/api/games?scope=manage&search=${encodeURIComponent('Sản phẩm Cloud')}`)
      .set('Authorization', `Bearer ${userAToken}`);
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.data.total, 1);
    assert.equal(searchRes.body.data.games[0].gameId, game3.gameId);

    // Pagination: limit=2, offset=0 -> hasMore=true; offset=2 -> hasMore=false
    const page1Res = await request(app)
      .get('/api/games?scope=manage&limit=2&offset=0')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(page1Res.status, 200);
    assert.equal(page1Res.body.data.games.length, 2);
    assert.equal(page1Res.body.data.total, 3);
    assert.equal(page1Res.body.data.hasMore, true);

    const page2Res = await request(app)
      .get('/api/games?scope=manage&limit=2&offset=2')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(page2Res.status, 200);
    assert.equal(page2Res.body.data.games.length, 1);
    assert.equal(page2Res.body.data.total, 3);
    assert.equal(page2Res.body.data.hasMore, false);

    // Admin edits User A's draft game2 in the shared library, reorders questions, updates settings & publishes
    const reversedQuestions = [...game2.questions].reverse();
    const editByAdminRes = await request(app)
      .patch(`/api/games/${game2.gameId}/questions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Kiểm tra An toàn Bảo mật 2026 (Admin Xuất Bản)',
        description: 'Mô tả cập nhật từ kho game dùng chung',
        questions: reversedQuestions,
        settings: {
          timePerQuestion: 25,
          scoringMode: 'STREAK',
        },
        isPublic: true,
      });
    assert.equal(editByAdminRes.status, 200);
    assert.equal(editByAdminRes.body.data.title, 'Kiểm tra An toàn Bảo mật 2026 (Admin Xuất Bản)');
    assert.equal(editByAdminRes.body.data.isPublic, true);
    assert.equal(editByAdminRes.body.data.settings.timePerQuestion, 25);
    assert.equal(editByAdminRes.body.data.settings.scoringMode, 'STREAK');
    assert.equal(editByAdminRes.body.data.questions[0].id, reversedQuestions[0].id);
  });

  it('2. Generates Single-Player Link/QR only for published games and supports concurrent independent solo sessions', async () => {
    const draftGame = await createSampleDraftGame(
      userAToken,
      'Trò chơi Tương tác Thương hiệu tại Showroom',
      'MULTIPLE_CHOICE'
    );

    // 1. Draft game cannot generate Single-Player QR (403 GAME_NOT_PUBLISHED)
    const qrDraftRes = await request(app).get(`/api/games/${draftGame.gameId}/qr`);
    assert.equal(qrDraftRes.status, 403);
    assert.equal(qrDraftRes.body.error.code, 'GAME_NOT_PUBLISHED');

    // 2. Non-existent game returns 404 GAME_NOT_FOUND
    const qrNotFoundRes = await request(app).get('/api/games/game_non_existent_999/qr');
    assert.equal(qrNotFoundRes.status, 404);
    assert.equal(qrNotFoundRes.body.error.code, 'GAME_NOT_FOUND');

    // 3. Publish the game
    const publishRes = await request(app)
      .patch(`/api/games/${draftGame.gameId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        questions: draftGame.questions,
        isPublic: true,
      });
    assert.equal(publishRes.status, 200);

    // 4. Published game returns valid playUrl and PNG QR Data URL
    const qrPubRes = await request(app).get(`/api/games/${draftGame.gameId}/qr`);
    assert.equal(qrPubRes.status, 200);
    assert.equal(qrPubRes.body.data.gameId, draftGame.gameId);
    assert.equal(
      qrPubRes.body.data.playUrl.includes(`/?play=${encodeURIComponent(draftGame.gameId)}`),
      true
    );
    assert.match(qrPubRes.body.data.qrDataUrl, /^data:image\/png;base64,/);

    // 5. Two independent players open the solo play link concurrently and play without interfering
    const guestToken1 = 'gt_11111111111111111111111111111111';
    const guestToken2 = 'gt_22222222222222222222222222222222';

    const sessionARes = await request(app)
      .post('/api/games/sessions')
      .set('X-Guest-Token', guestToken1)
      .send({
        gameId: draftGame.gameId,
        publicPlay: true,
      });
    assert.equal(sessionARes.status, 200);
    const sessionAId = sessionARes.body.data.sessionId;

    const sessionBRes = await request(app)
      .post('/api/games/sessions')
      .set('X-Guest-Token', guestToken2)
      .send({
        gameId: draftGame.gameId,
        publicPlay: true,
      });
    assert.equal(sessionBRes.status, 200);
    const sessionBId = sessionBRes.body.data.sessionId;
    assert.notEqual(sessionAId, sessionBId);

    // Start both solo sessions
    const startA = await request(app)
      .post(`/api/games/sessions/${sessionAId}/start`)
      .set('X-Guest-Token', guestToken1);
    assert.equal(startA.status, 200);

    const startB = await request(app)
      .post(`/api/games/sessions/${sessionBId}/start`)
      .set('X-Guest-Token', guestToken2);
    assert.equal(startB.status, 200);

    const firstQuestion = draftGame.questions[0];
    const wrongChoice =
      firstQuestion.choices.find((c: string) => c !== firstQuestion.correctAnswer) || 'Chỉ chơi offline';

    // Player 1 answers correctly, Player 2 answers wrongly
    const ansA = await request(app)
      .post(`/api/games/sessions/${sessionAId}/answer`)
      .set('X-Guest-Token', guestToken1)
      .send({
        questionId: firstQuestion.id,
        answer: firstQuestion.correctAnswer,
      });
    assert.equal(ansA.status, 200);
    assert.equal(ansA.body.data.isCorrect, true);
    assert.equal(ansA.body.data.pointsEarned > 0, true);

    const ansB = await request(app)
      .post(`/api/games/sessions/${sessionBId}/answer`)
      .set('X-Guest-Token', guestToken2)
      .send({
        questionId: firstQuestion.id,
        answer: wrongChoice,
      });
    assert.equal(ansB.status, 200);
    assert.equal(ansB.body.data.isCorrect, false);
    assert.equal(ansB.body.data.pointsEarned, 0);
  });

  it('3. Allows opening a Multiplayer room from a published game, generates room QR, and blocks draft games or player tokens', async () => {
    const game = await createSampleDraftGame(
      userAToken,
      'Đấu trường Hội thảo Công nghệ 2026',
      'MULTIPLE_CHOICE'
    );

    // 1. Cannot open a public multiplayer room from a draft game when requirePublished=true
    const draftRoomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        gameId: game.gameId,
        requirePublished: true,
      });
    assert.equal(draftRoomRes.status, 403);
    assert.equal(draftRoomRes.body.error.code, 'GAME_NOT_PUBLISHED');

    // 2. Player client cannot create a room
    const playerRoomRes = await request(app)
      .post('/api/rooms')
      .set('X-Player-Token', 'player_tok_unauthorized')
      .send({
        gameId: game.gameId,
      });
    assert.equal(playerRoomRes.status, 403);
    assert.equal(playerRoomRes.body.error.code, 'ACCESS_DENIED');

    // 3. Publish the game and open a Multiplayer room
    const pubRes = await request(app)
      .patch(`/api/games/${game.gameId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        questions: game.questions,
        isPublic: true,
      });
    assert.equal(pubRes.status, 200);

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        gameId: game.gameId,
        requirePublished: true,
      });
    assert.equal(roomRes.status, 200);
    assert.equal(roomRes.body.data.roomCode.length, 6);
    assert.equal(Boolean(roomRes.body.data.hostToken), true);

    const roomCode = roomRes.body.data.roomCode;

    // 4. Fetch room QR code and join URL
    const roomQrRes = await request(app).get(`/api/rooms/${roomCode}/qr`);
    assert.equal(roomQrRes.status, 200);
    assert.equal(roomQrRes.body.data.roomCode, roomCode);
    assert.equal(roomQrRes.body.data.joinUrl.includes(`room=${roomCode}`), true);
    assert.match(roomQrRes.body.data.qrDataUrl, /^data:image\/png;base64,/);
  });
});
