import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/storage/sqlite.db.js';
import { sourceStore } from '../src/storage/source.store.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { aiQuestionService, AiModelProvider } from '../src/services/ai.question.service.js';
import { AiProviderUsageMetadata } from '../src/services/ai.observability.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';

class Checkpoint2MockAiProvider implements AiModelProvider {
  public mockQuestions: any[] = [];
  public mockTitle = 'Checkpoint 2 AI Game';

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    return {
      title: this.mockTitle,
      description: 'Bộ câu hỏi tạo tự động cho kiểm thử Checkpoint 2.',
      questions: this.mockQuestions,
    };
  }

  getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 250,
      outputTokens: 150,
      totalTokens: 400,
      usageReportedByProvider: true,
    };
  }
}

describe('CHECKPOINT 2 — 5-Step Game Creation Wizard, Question Editing/Reordering, Draft vs Publish & Authorization', () => {
  let tempDir: string;
  let tempDbPath: string;
  let mockProvider: Checkpoint2MockAiProvider;
  let creatorToken: string;
  let otherUserToken: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-cp2-test-'));
    tempDbPath = path.join(tempDir, 'cp2_test.sqlite');
    initDatabase(tempDbPath);

    mockProvider = new Checkpoint2MockAiProvider();
    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();

    const creatorRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'creator_cp2@example.com',
        password: 'CreatorPassword123!',
        displayName: 'Người Tổ Chức CP2',
      });
    assert.equal(creatorRes.status, 201);
    creatorToken = creatorRes.body.data.token;

    const otherRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'other_cp2@example.com',
        password: 'OtherPassword123!',
        displayName: 'Người Dùng Khác CP2',
      });
    assert.equal(otherRes.status, 201);
    otherUserToken = otherRes.body.data.token;
  });

  after(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock cleanup errors
    }
  });

  it('1. Rejects invalid source ingestion and invalid gameType during creation flow', async () => {
    resetAllRateLimiters();

    // Empty ingest request (no URLs, no files) -> 400
    const emptyIngest = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(emptyIngest.status, 400);

    // Unsupported file type (.exe) -> 415 UNSUPPORTED_FILE_TYPE
    const badFileIngest = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${creatorToken}`)
      .attach('files', Buffer.from('binary-content', 'utf-8'), 'malware.exe');
    assert.equal(badFileIngest.status, 415);

    // Valid source ingestion
    const validIngest = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${creatorToken}`)
      .attach(
        'files',
        Buffer.from('Tài liệu đào tạo quy trình an toàn thông tin doanh nghiệp và bảo mật mật khẩu.', 'utf-8'),
        'security_training.txt'
      );
    assert.equal(validIngest.status, 200);
    const sourceId = validIngest.body.data.sources[0].sourceId;

    // Invalid gameType -> 400 INVALID_REQUEST
    const badGameTypeRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId,
        gameType: 'UNSUPPORTED_MODE',
        questionCount: 2,
      });
    assert.equal(badGameTypeRes.status, 400);
    assert.equal(badGameTypeRes.body.error.code, 'INVALID_REQUEST');
  });

  it('2. Generates game as unpublished draft (isPublic=false), supports full editing/reordering/settings update, and blocks public access before publish', async () => {
    resetAllRateLimiters();

    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${creatorToken}`)
      .attach(
        'files',
        Buffer.from('Kiến thức sản phẩm dịch vụ bảo dưỡng xe định kỳ tại đại lý chính hãng.', 'utf-8'),
        'service_guide.txt'
      );
    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    mockProvider.mockTitle = 'Kiến Thức Dịch Vụ Bảo Dưỡng';
    mockProvider.mockQuestions = [
      {
        id: 'q_cp2_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 1: Chu kỳ bảo dưỡng cấp nhỏ là bao nhiêu km?',
        choices: ['A. 5.000 km', 'B. 25.000 km', 'C. 60.000 km', 'D. 100.000 km'],
        correctAnswer: 'A. 5.000 km',
        explanation: 'Bảo dưỡng cấp nhỏ thực hiện mỗi 5.000 km.',
        difficulty: 'EASY',
      },
      {
        id: 'q_cp2_2',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 2: Dầu phanh nên được kiểm tra khi nào?',
        choices: ['A. Mỗi kỳ bảo dưỡng', 'B. Sau 10 năm', 'C. Không cần kiểm tra', 'D. Khi lốp mòn'],
        correctAnswer: 'A. Mỗi kỳ bảo dưỡng',
        explanation: 'Dầu phanh cần kiểm tra định kỳ mỗi lần bảo dưỡng.',
        difficulty: 'MEDIUM',
      },
    ];

    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId,
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
      });
    assert.equal(genRes.status, 200);
    const game = genRes.body.data;
    assert.equal(game.isPublic, false, 'Newly generated game must default to unpublished draft (isPublic=false)');

    // Public library (scope=public) must NOT include unpublished draft game
    const publicListDraft = await request(app).get('/api/games?scope=public');
    assert.equal(publicListDraft.status, 200);
    assert.ok(
      !publicListDraft.body.data.games.some((g: any) => g.gameId === game.gameId),
      'Unpublished draft must not appear in public game scope'
    );

    // Public mode GET /api/games/:gameId?mode=public must reject unpublished draft with 403 GAME_NOT_PUBLISHED
    const publicGetDraft = await request(app).get(`/api/games/${game.gameId}?mode=public`);
    assert.equal(publicGetDraft.status, 403);
    assert.equal(publicGetDraft.body.error.code, 'GAME_NOT_PUBLISHED');

    // Public solo play session (publicPlay=true) must reject unpublished draft with 403 GAME_NOT_PUBLISHED
    const publicPlayDraft = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: game.gameId, publicPlay: true });
    assert.equal(publicPlayDraft.status, 403);
    assert.equal(publicPlayDraft.body.error.code, 'GAME_NOT_PUBLISHED');

    // Step 4: Preview & Edit — reorder questions (q_cp2_2 first, q_cp2_1 second), add a 3rd question, update title/description/settings, and save as draft (isPublic=false)
    const reorderedAndAddedQuestions = [
      {
        ...game.questions[1],
        question: 'Câu 1 (Đã đảo thứ tự): Khi nào cần kiểm tra dầu phanh?',
      },
      game.questions[0],
      {
        id: 'q_cp2_3',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 3 (Mới thêm): Bộ phận nào lọc bụi bẩn cho buồng đốt?',
        choices: ['A. Lọc gió động cơ', 'B. Cần gạt mưa', 'C. Gương chiếu hậu', 'D. Còi xe'],
        correctAnswer: 'A. Lọc gió động cơ',
        explanation: 'Lọc gió động cơ ngăn bụi vào buồng đốt.',
        difficulty: 'EASY',
        sourceReference: game.questions[0].sourceReference,
      },
    ];

    const saveDraftRes = await request(app)
      .patch(`/api/games/${game.gameId}/questions`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Kiến Thức Bảo Dưỡng (Bản Nháp Đã Sửa)',
        description: 'Mô tả đã cập nhật ở Bước 4.',
        questions: reorderedAndAddedQuestions,
        settings: {
          timePerQuestion: 35,
          scoringMode: 'SPEED_BONUS',
        },
        isPublic: false,
      });
    assert.equal(saveDraftRes.status, 200);
    assert.equal(saveDraftRes.body.data.isPublic, false);
    assert.equal(saveDraftRes.body.data.title, 'Kiến Thức Bảo Dưỡng (Bản Nháp Đã Sửa)');
    assert.equal(saveDraftRes.body.data.description, 'Mô tả đã cập nhật ở Bước 4.');
    assert.equal(saveDraftRes.body.data.settings.timePerQuestion, 35);
    assert.equal(saveDraftRes.body.data.settings.scoringMode, 'SPEED_BONUS');
    assert.equal(saveDraftRes.body.data.questions.length, 3);
    assert.deepEqual(
      saveDraftRes.body.data.questions.map((q: any) => q.id),
      ['q_cp2_2', 'q_cp2_1', 'q_cp2_3']
    );

    // Step 5: Publish the game (isPublic = true)
    const publishRes = await request(app)
      .patch(`/api/games/${game.gameId}/questions`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: 'Kiến Thức Bảo Dưỡng (Chính Thức)',
        questions: reorderedAndAddedQuestions,
        isPublic: true,
      });
    assert.equal(publishRes.status, 200);
    assert.equal(publishRes.body.data.isPublic, true);

    // Simulate server restart / reload from SQLite DB
    sourceStore.clear();
    gameStore.clear();
    sessionStore.clear();
    closeDatabase();
    initDatabase(tempDbPath);

    // Verify reloaded game from DB preserves exact question order, settings, and published state
    const reloadedRes = await request(app).get(`/api/games/${game.gameId}?mode=public`);
    assert.equal(reloadedRes.status, 200);
    assert.equal(reloadedRes.body.data.isPublic, true);
    assert.equal(reloadedRes.body.data.title, 'Kiến Thức Bảo Dưỡng (Chính Thức)');
    assert.equal(reloadedRes.body.data.settings.timePerQuestion, 35);
    assert.equal(reloadedRes.body.data.settings.scoringMode, 'SPEED_BONUS');
    assert.deepEqual(
      reloadedRes.body.data.questions.map((q: any) => q.id),
      ['q_cp2_2', 'q_cp2_1', 'q_cp2_3']
    );

    // Verify published game now appears in public scope and can start public solo session
    const publicListAfter = await request(app).get('/api/games?scope=public');
    assert.equal(publicListAfter.status, 200);
    assert.ok(publicListAfter.body.data.games.some((g: any) => g.gameId === game.gameId));

    const publicPlayAfter = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: game.gameId, publicPlay: true });
    assert.equal(publicPlayAfter.status, 200);
  });

  it('3. Blocks unauthorized callers (Player client, other User, Guest, Anonymous) from editing, publishing, or deleting creator games', async () => {
    resetAllRateLimiters();

    const listRes = await request(app)
      .get('/api/games')
      .set('Authorization', `Bearer ${creatorToken}`);
    const publishedGame = listRes.body.data.games[0];
    assert.ok(publishedGame);

    const detailRes = await request(app)
      .get(`/api/games/${publishedGame.gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    const questions = detailRes.body.data.questions;

    // 1. Player client (with X-Player-Token) cannot generate, edit, or delete games
    const playerGen = await request(app)
      .post('/api/games/generate')
      .set('X-Player-Token', 'pt_player_12345')
      .send({ sourceId: 'src_any', gameType: 'MULTIPLE_CHOICE', questionCount: 1 });
    assert.equal(playerGen.status, 403);

    const playerPatch = await request(app)
      .patch(`/api/games/${publishedGame.gameId}/questions`)
      .set('X-Player-Token', 'pt_player_12345')
      .send({ title: 'Hacked by Player', questions });
    assert.equal(playerPatch.status, 403);

    // 2. Other authenticated user (otherUserToken) cannot edit, unpublish, or delete even when game isPublic=true
    const otherPatch = await request(app)
      .patch(`/api/games/${publishedGame.gameId}/questions`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ title: 'Hacked by Other User', questions, isPublic: false });
    assert.equal(otherPatch.status, 403);

    const otherDelete = await request(app)
      .delete(`/api/games/${publishedGame.gameId}`)
      .set('Authorization', `Bearer ${otherUserToken}`);
    assert.equal(otherDelete.status, 403);

    // 3. Guest token cannot edit or delete creator's published game
    const guestPatch = await request(app)
      .patch(`/api/games/${publishedGame.gameId}/questions`)
      .set('X-Guest-Token', 'gt_11111111111111111111111111111111')
      .send({ title: 'Hacked by Guest', questions });
    assert.equal(guestPatch.status, 403);

    // 4. Anonymous request cannot edit or delete creator's published game
    const anonPatch = await request(app)
      .patch(`/api/games/${publishedGame.gameId}/questions`)
      .send({ title: 'Hacked by Anon', questions });
    assert.equal(anonPatch.status, 403);
  });
});

