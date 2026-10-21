import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app.js';
import { LIMITS } from '../src/config/limits.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/storage/sqlite.db.js';
import { sourceStore } from '../src/storage/source.store.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { aiQuestionService, AiModelProvider, calculateMixedTypeCounts } from '../src/services/ai.question.service.js';
import { AiProviderUsageMetadata } from '../src/services/ai.observability.service.js';
import { quotaService } from '../src/services/quota.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';

class Phase34MockAiProvider implements AiModelProvider {
  public mockQuestions: any[] = [];
  public mockTitle = 'Phase 3 & 4 Test Game';
  public mockUsageMetadata: AiProviderUsageMetadata | null = {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    inputTokens: 400,
    outputTokens: 200,
    totalTokens: 600,
    usageReportedByProvider: true,
  };

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    return {
      title: this.mockTitle,
      description: 'Generated for Phase 3 & 4 automated tests.',
      questions: this.mockQuestions,
    };
  }

  getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return this.mockUsageMetadata;
  }
}

/**
 * Helper to create, start, and play a single-player practice session via HTTP API.
 */
async function playPracticeSessionViaApi(options: {
  gameId: string;
  answers: Array<{ questionId: string; answer: string }>;
  token?: string;
}): Promise<string> {
  const createReq = request(app).post('/api/games/sessions').send({ gameId: options.gameId });
  if (options.token) createReq.set('Authorization', `Bearer ${options.token}`);
  const createRes = await createReq;
  assert.equal(createRes.status, 200);
  const sessionId = createRes.body.data.sessionId;

  const startReq = request(app).post(`/api/games/sessions/${sessionId}/start`);
  if (options.token) startReq.set('Authorization', `Bearer ${options.token}`);
  const startRes = await startReq;
  assert.equal(startRes.status, 200);

  for (const item of options.answers) {
    const ansReq = request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({ questionId: item.questionId, answer: item.answer });
    if (options.token) ansReq.set('Authorization', `Bearer ${options.token}`);
    const ansRes = await ansReq;
    assert.equal(ansRes.status, 200);

    const nextReq = request(app).post(`/api/games/sessions/${sessionId}/next`);
    if (options.token) nextReq.set('Authorization', `Bearer ${options.token}`);
    const nextRes = await nextReq;
    assert.equal(nextRes.status, 200);
  }

  return sessionId;
}

describe('PHASE 3 & PHASE 4 — Persistence, Export, AI Observability, Auth, Quotas, Mixed Modes & Learning Analytics', () => {
  let tempDir: string;
  let tempDbPath: string;
  let mockProvider: Phase34MockAiProvider;
  const origInputCost = LIMITS.GEMINI_INPUT_COST_PER_1M_USD;
  const origOutputCost = LIMITS.GEMINI_OUTPUT_COST_PER_1M_USD;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-p34-test-'));
    tempDbPath = path.join(tempDir, 'test_platform.sqlite');
    initDatabase(tempDbPath);

    mockProvider = new Phase34MockAiProvider();
    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();
  });

  after(() => {
    quotaService.resetOverrides();
    (LIMITS as any).GEMINI_INPUT_COST_PER_1M_USD = origInputCost;
    (LIMITS as any).GEMINI_OUTPUT_COST_PER_1M_USD = origOutputCost;
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows file locks
    }
  });

  it('Batch 1: SQLite Persistence survives full in-memory store wipe & DB reconnect (Server Restart Simulation)', async () => {
    // 1. Ingest a large text file (> 5,000 chars) to verify bounded excerpt storage
    const longParagraph = 'Kiến thức bảo dưỡng động cơ đốt trong và hệ thống làm mát tiêu chuẩn kỹ thuật. ';
    const largeTextBuffer = Buffer.from(longParagraph.repeat(120), 'utf-8');

    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .attach('files', largeTextBuffer, 'engine_manual.txt');

    assert.equal(ingestRes.status, 200);
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    // Verify sources table stores bounded excerpt (<= 2,000 chars), not raw oversized text
    const db = getDatabase();
    const rawSourceRow = db.prepare(`SELECT text_excerpt, character_count FROM sources WHERE source_id = ?`).get(sourceId) as any;
    assert.ok(rawSourceRow, 'Source metadata must be persisted in SQLite');
    assert.ok(rawSourceRow.character_count > 5000, 'Original character_count should reflect full document length');
    assert.ok(rawSourceRow.text_excerpt.length <= 2000, 'Persisted text_excerpt must be bounded to <= 2000 chars');

    // 2. Generate a game
    mockProvider.mockTitle = 'Bảo Dưỡng Động Cơ Toàn Diện';
    mockProvider.mockQuestions = [
      {
        id: 'q_persist_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Bao lâu nên kiểm tra nước làm mát động cơ?',
        choices: ['Mỗi 10.000 km', 'Mỗi 50.000 km', 'Không cần kiểm tra', 'Mỗi 100.000 km'],
        correctAnswer: 'Mỗi 10.000 km',
        explanation: 'Kiểm tra định kỳ mỗi 10.000 km giúp tránh quá nhiệt.',
        difficulty: 'EASY',
      },
      {
        id: 'q_persist_2',
        type: 'CROSSWORD',
        question: 'Bộ phận giúp giải nhiệt nước làm mát gọi là gì?',
        correctAnswer: 'KÉT NƯỚC',
        explanation: 'Két nước (radiator) giải nhiệt cho dung dịch làm mát.',
        difficulty: 'MEDIUM',
      },
    ];

    const genRes = await request(app)
      .post('/api/games/generate')
      .send({
        sourceId,
        gameType: 'MIXED',
        scoringMode: 'SPEED_BONUS',
        questionCount: 2,
      });

    assert.equal(genRes.status, 200);
    const gameId = genRes.body.data.gameId;
    const questions = genRes.body.data.questions;
    assert.equal(questions.length, 2);

    // 3. Edit questions via PATCH /api/games/:id/questions and verify persistence
    const updatedQuestions = [
      {
        ...questions[0],
        question: 'Chu kỳ kiểm tra nước làm mát tiêu chuẩn là bao nhiêu km?',
      },
      questions[1],
    ];

    const patchRes = await request(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: 'Bảo Dưỡng Động Cơ (Đã Chỉnh Sửa)',
        questions: updatedQuestions,
      });

    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.data.title, 'Bảo Dưỡng Động Cơ (Đã Chỉnh Sửa)');

    // 4. Play and complete a single-player practice session
    const sessionId = await playPracticeSessionViaApi({
      gameId,
      answers: [
        { questionId: updatedQuestions[0].id, answer: 'Mỗi 10.000 km' },
        { questionId: updatedQuestions[1].id, answer: 'ket nuoc' },
      ],
    });

    // 5. Play and complete a multiplayer room
    const createRoomRes = await request(app)
      .post('/api/rooms')
      .send({ gameId });
    assert.equal(createRoomRes.status, 200);
    const roomCode = createRoomRes.body.data.roomCode;
    const hostToken = createRoomRes.body.data.hostToken;

    const room = roomService.getRoomByCode(roomCode);
    const { player } = room.addPlayer('Player Lan');
    room.start(hostToken);
    room.submitPlayerAnswer(player.playerToken, updatedQuestions[0].id, 'Mỗi 10.000 km');
    room.revealQuestion(hostToken);
    room.nextQuestion(hostToken);
    room.submitPlayerAnswer(player.playerToken, updatedQuestions[1].id, 'KÉT NƯỚC');
    room.revealQuestion(hostToken);
    room.nextQuestion(hostToken);
    assert.equal(room.state, 'FINISHED');

    // 6. SIMULATE SERVER RESTART: Clear all in-memory stores and close/re-open SQLite DB
    sourceStore.clear();
    gameStore.clear();
    sessionStore.clear();
    roomStore.clear();
    closeDatabase();
    initDatabase(tempDbPath);

    // 7. Verify all persisted entities are recovered from SQLite after restart
    const listGamesAfterRestart = await request(app).get('/api/games');
    assert.equal(listGamesAfterRestart.status, 200);
    assert.ok(
      listGamesAfterRestart.body.data.games.some(
        (g: any) => g.gameId === gameId && g.title === 'Bảo Dưỡng Động Cơ (Đã Chỉnh Sửa)'
      ),
      'Saved game must be listed after server restart'
    );

    const getGameAfterRestart = await request(app).get(`/api/games/${gameId}`);
    assert.equal(getGameAfterRestart.status, 200);
    assert.equal(
      getGameAfterRestart.body.data.questions[0].question,
      'Chu kỳ kiểm tra nước làm mát tiêu chuẩn là bao nhiêu km?'
    );

    const getSessionResultAfterRestart = await request(app).get(`/api/games/sessions/${sessionId}/result`);
    assert.equal(getSessionResultAfterRestart.status, 200);
    assert.equal(getSessionResultAfterRestart.body.data.correctAnswers, 2);

    const listSessionsAfterRestart = await request(app).get('/api/history/sessions');
    assert.equal(listSessionsAfterRestart.status, 200);
    assert.ok(listSessionsAfterRestart.body.data.some((s: any) => s.sessionId === sessionId));

    const getRoomHistoryAfterRestart = await request(app).get(`/api/games/${gameId}/history`);
    assert.equal(getRoomHistoryAfterRestart.status, 200);
    assert.equal(getRoomHistoryAfterRestart.body.data.roomHistory.length, 1);
    assert.equal(getRoomHistoryAfterRestart.body.data.roomHistory[0].roomCode, roomCode);
    assert.equal(getRoomHistoryAfterRestart.body.data.roomHistory[0].leaderboard[0].displayName, 'Player Lan');
  });

  it('Batch 2: CSV & JSON Export with UTF-8 BOM, Vietnamese diacritics, and CSV Formula Injection Protection', async () => {
    resetAllRateLimiters();

    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .attach('files', Buffer.from('Tài liệu kiểm thử bảo mật xuất dữ liệu CSV và công thức độc hại.', 'utf-8'), 'security_export.txt');
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    mockProvider.mockTitle = 'Kiểm Thử Xuất File Tiếng Việt';
    mockProvider.mockQuestions = [
      {
        id: 'q_csv_1',
        type: 'FILL_IN_THE_BLANK',
        question: '=cmd|\' /C calc\'!A0 Câu hỏi có ký tự nguy hiểm ở đầu ___?',
        correctAnswer: '+SUM(1,1)',
        explanation: '  =IMPORTXML("http://internal/secret") Giải thích có khoảng trắng dẫn đầu trước dấu bằng',
        difficulty: 'MEDIUM',
      },
    ];

    const genRes = await request(app)
      .post('/api/games/generate')
      .send({
        sourceId,
        gameType: 'FILL_IN_THE_BLANK',
        questionCount: 1,
      });
    assert.equal(genRes.status, 200);
    const gameId = genRes.body.data.gameId;
    const questionId = genRes.body.data.questions[0].id;

    // 1. Export Game as JSON
    const jsonExportRes = await request(app).get(`/api/games/${gameId}/export?format=json`);
    assert.equal(jsonExportRes.status, 200);
    assert.match(jsonExportRes.headers['content-type'], /application\/json/);
    const exportedJson = JSON.parse(jsonExportRes.text);
    assert.equal(exportedJson.gameId, gameId);
    assert.equal(exportedJson.questions.length, 1);

    // 2. Export Game as CSV and verify UTF-8 BOM + Formula neutralization
    const csvExportRes = await request(app).get(`/api/games/${gameId}/export?format=csv`);
    assert.equal(csvExportRes.status, 200);
    assert.match(csvExportRes.headers['content-type'], /text\/csv/);
    const csvText = csvExportRes.text;

    assert.ok(csvText.startsWith('\uFEFF'), 'CSV export must start with UTF-8 BOM for Excel compatibility');
    assert.ok(csvText.includes("'=cmd|' /C calc'!A0"), 'Formula starting with = must be prefixed with single quote');
    assert.ok(csvText.includes("'+SUM(1,1)"), 'Formula starting with + must be prefixed with single quote');
    assert.ok(csvText.includes("'  =IMPORTXML"), 'Formula with leading whitespace followed by = must be prefixed with single quote');

    // 3. Start & finish a session with formula-like answer, then export session CSV & JSON
    const sessionId = await playPracticeSessionViaApi({
      gameId,
      answers: [{ questionId, answer: '=HYPERLINK("http://evil.test")' }],
    });

    const sessionCsvRes = await request(app).get(`/api/games/sessions/${sessionId}/export?format=csv`);
    assert.equal(sessionCsvRes.status, 200);
    assert.ok(sessionCsvRes.text.startsWith('\uFEFF'));
    assert.ok(sessionCsvRes.text.includes("'=HYPERLINK"), 'Submitted answer starting with = must be neutralized');

    const sessionJsonRes = await request(app).get(`/api/games/sessions/${sessionId}/export?format=json`);
    assert.equal(sessionJsonRes.status, 200);
    const sessionExportData = JSON.parse(sessionJsonRes.text);
    assert.equal(sessionExportData.sessionId, sessionId);
  });

  it('Batch 3: AI Observability separates reported vs unknown tokens, avoids logging secrets/prompts, and passes Benchmark', async () => {
    resetAllRateLimiters();
    (LIMITS as any).GEMINI_INPUT_COST_PER_1M_USD = 1.0;
    (LIMITS as any).GEMINI_OUTPUT_COST_PER_1M_USD = 2.0;

    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .attach('files', Buffer.from('SENSITIVE_DOCUMENT_SECRET_MARKER_99999 Nội dung đào tạo nội bộ.', 'utf-8'), 'secret_doc.txt');
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    // 1. Call with provider-reported usageMetadata
    mockProvider.mockUsageMetadata = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      usageReportedByProvider: true,
    };
    mockProvider.mockQuestions = [
      {
        id: 'q_obs_1',
        type: 'QUICK_BUTTON',
        question: 'Đào tạo nội bộ có quan trọng không?',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'Rất quan trọng.',
        difficulty: 'EASY',
      },
    ];

    const genWithTokens = await request(app)
      .post('/api/games/generate')
      .send({ sourceId, gameType: 'QUICK_BUTTON', questionCount: 1 });
    assert.equal(genWithTokens.status, 200);

    // 2. Call WITHOUT usageMetadata (provider does not report tokens)
    mockProvider.mockUsageMetadata = null;
    const genWithoutTokens = await request(app)
      .post('/api/games/generate')
      .send({ sourceId, gameType: 'QUICK_BUTTON', questionCount: 1 });
    assert.equal(genWithoutTokens.status, 200);

    // 3. Inspect GET /api/observability/ai
    const obsRes = await request(app).get('/api/observability/ai');
    assert.equal(obsRes.status, 200);
    const obsData = obsRes.body.data;

    assert.ok(obsData.totals.callsWithReportedTokens >= 1);
    assert.ok(obsData.totals.callsWithUnknownTokens >= 1);

    const logWithoutTokens = obsData.recentLogs[0];
    assert.equal(logWithoutTokens.inputTokens, null, 'Unreported inputTokens must be null, never fabricated');
    assert.equal(logWithoutTokens.outputTokens, null, 'Unreported outputTokens must be null, never fabricated');
    assert.equal(logWithoutTokens.estimatedCostUsd, null, 'Cost must be null when tokens are unreported');

    const logWithTokens = obsData.recentLogs[1];
    assert.equal(logWithTokens.inputTokens, 1000);
    assert.equal(logWithTokens.outputTokens, 500);
    assert.equal(logWithTokens.totalTokens, 1500);
    assert.ok(logWithTokens.estimatedCostUsd > 0, 'Cost should be computed when both tokens and pricing exist');

    // Verify no raw prompt or document secret marker is stored in ai_usage_logs
    const serializedObs = JSON.stringify(obsRes.body);
    assert.ok(!serializedObs.includes('SENSITIVE_DOCUMENT_SECRET_MARKER_99999'), 'Observability logs must never leak raw source text or prompts');

    // 4. Run Deterministic AI Quality Benchmark via POST /api/observability/ai/benchmark
    const benchRes = await request(app).post('/api/observability/ai/benchmark');
    assert.equal(benchRes.status, 200);
    assert.equal(benchRes.body.data.totalCases, 3);
    assert.equal(benchRes.body.data.passedCases, 3);

    // Restore mock usage metadata for remaining tests
    mockProvider.mockUsageMetadata = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
      usageReportedByProvider: true,
    };
  });

  it('Batch 4: Account Registration, Scrypt Password Hashing, Login/Logout & Cross-User Access Control (User A vs User B)', async () => {
    resetAllRateLimiters();

    // 1. Register User A
    const regARes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'userA@example.com',
        password: 'StrongPassword123!',
        displayName: 'Nguyễn Văn A',
      });
    assert.equal(regARes.status, 201);
    const tokenA = regARes.body.data.token;
    const userIdA = regARes.body.data.user.userId;

    // Verify password is stored with scrypt$ salt$hash in SQLite
    const db = getDatabase();
    const userRow = db.prepare(`SELECT password_hash FROM users WHERE user_id = ?`).get(userIdA) as any;
    assert.ok(userRow.password_hash.startsWith('scrypt$'), 'Password must be hashed with scrypt and random salt');
    assert.ok(!userRow.password_hash.includes('StrongPassword123!'), 'Plaintext password must never be stored');

    // 2. Duplicate registration returns 409
    const dupRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'USERA@example.com',
        password: 'AnotherPassword123!',
        displayName: 'Duplicate A',
      });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.body.error.code, 'REGISTRATION_FAILED');

    // 3. Invalid login password returns 401
    const badLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'userA@example.com', password: 'WrongPassword999' });
    assert.equal(badLoginRes.status, 401);

    // 4. Register User B
    const regBRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'userB@example.com',
        password: 'StrongPassword456!',
        displayName: 'Trần Thị B',
      });
    assert.equal(regBRes.status, 201);
    const tokenB = regBRes.body.data.token;

    // 5. User A ingests content, generates a private game, and starts a private practice session
    const ingestARes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('files', Buffer.from('Tài liệu riêng tư của User A về chiến lược sản phẩm.', 'utf-8'), 'userA_private.txt');
    assert.equal(ingestARes.status, 200);
    const sourceIdA = ingestARes.body.data.sources[0].sourceId;

    // User B cannot generate a game from User A's private sourceId
    const crossSourceGenRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ sourceId: sourceIdA, gameType: 'MULTIPLE_CHOICE', questionCount: 1 });
    assert.equal(crossSourceGenRes.status, 403);
    assert.equal(crossSourceGenRes.body.error.code, 'ACCESS_DENIED');

    mockProvider.mockTitle = 'Game Riêng Tư Của User A';
    mockProvider.mockQuestions = [
      {
        id: 'q_auth_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Chiến lược sản phẩm của User A là gì?',
        choices: ['Tập trung chất lượng', 'Giảm chất lượng', 'Bỏ qua khách hàng', 'Không làm gì'],
        correctAnswer: 'Tập trung chất lượng',
        explanation: 'Chất lượng là trọng tâm.',
        difficulty: 'EASY',
      },
    ];

    const gameARes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sourceId: sourceIdA, gameType: 'MULTIPLE_CHOICE', questionCount: 1, topicFocus: 'Chiến lược sản phẩm' });
    assert.equal(gameARes.status, 200);
    const gameIdA = gameARes.body.data.gameId;
    const questionIdA = gameARes.body.data.questions[0].id;

    const sessionIdA = await playPracticeSessionViaApi({
      gameId: gameIdA,
      answers: [{ questionId: questionIdA, answer: 'Tập trung chất lượng' }],
      token: tokenA,
    });

    // 6. Verify User B (and anonymous users) receive 403 ACCESS_DENIED on User A's resources
    const bGetGame = await request(app).get(`/api/games/${gameIdA}`).set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bGetGame.status, 403);

    const anonGetGame = await request(app).get(`/api/games/${gameIdA}`);
    assert.equal(anonGetGame.status, 403);

    const bPatchGame = await request(app)
      .patch(`/api/games/${gameIdA}/questions`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ questions: gameARes.body.data.questions });
    assert.equal(bPatchGame.status, 403);

    const bExportGame = await request(app).get(`/api/games/${gameIdA}/export?format=csv`).set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bExportGame.status, 403);

    const bHistoryGame = await request(app).get(`/api/games/${gameIdA}/history`).set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bHistoryGame.status, 403);

    const bSessionResult = await request(app).get(`/api/games/sessions/${sessionIdA}/result`).set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bSessionResult.status, 403);

    const bSessionExport = await request(app).get(`/api/games/sessions/${sessionIdA}/export?format=json`).set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bSessionExport.status, 403);

    // Verify User B's list endpoints do not include User A's private game or session
    const bListGames = await request(app).get('/api/games').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bListGames.status, 200);
    assert.ok(!bListGames.body.data.games.some((g: any) => g.gameId === gameIdA));

    const bListSessions = await request(app).get('/api/history/sessions').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(bListSessions.status, 200);
    assert.ok(!bListSessions.body.data.some((s: any) => s.sessionId === sessionIdA));

    // 7. Verify logout invalidates token
    const loginAgainRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'userA@example.com', password: 'StrongPassword123!' });
    const tempTokenA = loginAgainRes.body.data.token;

    const meBeforeLogout = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tempTokenA}`);
    assert.equal(meBeforeLogout.status, 200);

    const logoutRes = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${tempTokenA}`);
    assert.equal(logoutRes.status, 200);

    const meAfterLogout = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tempTokenA}`);
    assert.equal(meAfterLogout.status, 401);
  });

  it('Batch 5: Usage Quotas enforce daily ingestion, generation, active session & active room limits atomically under concurrency', async () => {
    resetAllRateLimiters();

    const regQuotaUser = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'quota_tester@example.com',
        password: 'QuotaPassword123!',
        displayName: 'Quota Tester',
      });
    assert.equal(regQuotaUser.status, 201);
    const tokenQ = regQuotaUser.body.data.token;

    mockProvider.mockQuestions = [
      {
        id: 'q_quota_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu hỏi kiểm thử hạn mức sử dụng?',
        choices: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'],
        correctAnswer: 'Đáp án A',
        explanation: 'Giải thích kiểm thử.',
        difficulty: 'EASY',
      },
    ];

    // Configure strict quota limits for test
    quotaService.configure({
      DAILY_INGESTIONS: 2,
      DAILY_GAME_GENERATIONS: 1,
      MAX_ACTIVE_SESSIONS: 1,
      MAX_ACTIVE_ROOMS: 1,
    });

    resetAllRateLimiters();

    // 1. Fire 4 concurrent ingestion requests with limit = 2
    const concurrentIngests = await Promise.all(
      [1, 2, 3, 4].map(idx =>
        request(app)
          .post('/api/content/ingest')
          .set('Authorization', `Bearer ${tokenQ}`)
          .attach('files', Buffer.from(`Tài liệu kiểm thử quota số ${idx} với nội dung hợp lệ.`, 'utf-8'), `doc_${idx}.txt`)
      )
    );

    const succeededIngests = concurrentIngests.filter(r => r.status === 200);
    const quotaExceededIngests = concurrentIngests.filter(r => r.status === 429 && r.body?.error?.code === 'QUOTA_EXCEEDED');
    assert.equal(succeededIngests.length, 2, 'Exactly 2 ingestions must succeed under atomic quota limit = 2');
    assert.equal(quotaExceededIngests.length, 2, 'Remaining 2 concurrent ingestions must return 429 QUOTA_EXCEEDED');

    const validSourceId = succeededIngests[0].body.data.sources[0].sourceId;

    // 2. Fire 3 concurrent game generation requests with limit = 1
    const concurrentGens = await Promise.all(
      [1, 2, 3].map(() =>
        request(app)
          .post('/api/games/generate')
          .set('Authorization', `Bearer ${tokenQ}`)
          .send({ sourceId: validSourceId, gameType: 'MULTIPLE_CHOICE', questionCount: 1 })
      )
    );

    const succeededGens = concurrentGens.filter(r => r.status === 200);
    const quotaExceededGens = concurrentGens.filter(r => r.status === 429 && r.body?.error?.code === 'QUOTA_EXCEEDED');
    assert.equal(succeededGens.length, 1, 'Exactly 1 game generation must succeed under atomic quota limit = 1');
    assert.equal(quotaExceededGens.length, 2, 'Remaining 2 concurrent game generations must return 429 QUOTA_EXCEEDED');

    const gameIdQ = succeededGens[0].body.data.gameId;

    // 3. Enforce MAX_ACTIVE_SESSIONS = 1
    const s1Res = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${tokenQ}`)
      .send({ gameId: gameIdQ });
    assert.equal(s1Res.status, 200);

    const s2Res = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${tokenQ}`)
      .send({ gameId: gameIdQ });
    assert.equal(s2Res.status, 429);
    assert.equal(s2Res.body.error.code, 'QUOTA_EXCEEDED');
    assert.equal(s2Res.body.error.details.quotaKey, 'MAX_ACTIVE_SESSIONS');

    // 4. Enforce MAX_ACTIVE_ROOMS = 1
    const r1Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${tokenQ}`)
      .send({ gameId: gameIdQ });
    assert.equal(r1Res.status, 200);

    const r2Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${tokenQ}`)
      .send({ gameId: gameIdQ });
    assert.equal(r2Res.status, 429);
    assert.equal(r2Res.body.error.code, 'QUOTA_EXCEEDED');
    assert.equal(r2Res.body.error.details.quotaKey, 'MAX_ACTIVE_ROOMS');

    quotaService.resetOverrides();
  });

  it('Batch 6: Mixed Game Modes (MIXED) supports all 4 question types across AI Generation, Editor, Single-Player & Multiplayer', async () => {
    resetAllRateLimiters();

    // 1. Verify Largest Remainder Method rounding algorithm for question distribution
    const counts5 = calculateMixedTypeCounts(5, {
      MULTIPLE_CHOICE: 40,
      QUICK_BUTTON: 20,
      FILL_IN_THE_BLANK: 20,
      CROSSWORD: 20,
    });
    assert.deepEqual(counts5, {
      MULTIPLE_CHOICE: 2,
      QUICK_BUTTON: 1,
      FILL_IN_THE_BLANK: 1,
      CROSSWORD: 1,
    });
    assert.equal(counts5.MULTIPLE_CHOICE + counts5.QUICK_BUTTON + counts5.FILL_IN_THE_BLANK + counts5.CROSSWORD, 5);

    const counts7 = calculateMixedTypeCounts(7, {
      MULTIPLE_CHOICE: 40,
      QUICK_BUTTON: 20,
      FILL_IN_THE_BLANK: 20,
      CROSSWORD: 20,
    });
    assert.deepEqual(counts7, {
      MULTIPLE_CHOICE: 3,
      QUICK_BUTTON: 2,
      FILL_IN_THE_BLANK: 1,
      CROSSWORD: 1,
    });
    assert.equal(counts7.MULTIPLE_CHOICE + counts7.QUICK_BUTTON + counts7.FILL_IN_THE_BLANK + counts7.CROSSWORD, 7);

    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .attach('files', Buffer.from('Tài liệu tổng hợp về mạng máy tính: giao thức HTTP, cổng 443 HTTPS, địa chỉ IP và tường lửa.', 'utf-8'), 'networking.txt');
    const sourceId = ingestRes.body.data.sources[0].sourceId;

    // 2. Verify invalid distribution (sum != 100%) is rejected with 400 VALIDATION_ERROR and friendly message
    const invalidDistRes = await request(app)
      .post('/api/games/generate')
      .send({
        sourceId,
        gameType: 'MIXED',
        questionCount: 4,
        mixedDistribution: {
          MULTIPLE_CHOICE: 50,
          QUICK_BUTTON: 20,
          FILL_IN_THE_BLANK: 20,
          CROSSWORD: 0, // Sum = 90%
        },
      });
    assert.equal(invalidDistRes.status, 400);
    assert.equal(invalidDistRes.body.error.code, 'INVALID_REQUEST');
    assert.match(invalidDistRes.body.error.message, /100%/);

    mockProvider.mockTitle = 'Thử Thách Mạng Máy Tính Hỗn Hợp (MIXED)';
    mockProvider.mockQuestions = [
      {
        id: 'q_mix_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Cổng mặc định của giao thức HTTPS là gì?',
        choices: ['80', '443', '22', '8080'],
        correctAnswer: '443',
        explanation: 'HTTPS hoạt động mặc định trên cổng 443.',
        difficulty: 'EASY',
      },
      {
        id: 'q_mix_2',
        type: 'FILL_IN_THE_BLANK',
        question: 'Giao thức truyền tải siêu văn bản không mã hóa viết tắt là ___?',
        correctAnswer: 'HTTP',
        explanation: 'HTTP là HyperText Transfer Protocol.',
        difficulty: 'EASY',
      },
      {
        id: 'q_mix_3',
        type: 'QUICK_BUTTON',
        question: 'Tường lửa (Firewall) giúp kiểm soát lưu lượng mạng ra vào đúng hay sai?',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'Tường lửa lọc các gói tin theo quy tắc bảo mật.',
        difficulty: 'MEDIUM',
      },
      {
        id: 'q_mix_4',
        type: 'CROSSWORD',
        question: 'Hệ thống phân giải tên miền sang địa chỉ IP viết tắt là gì?',
        correctAnswer: 'DNS',
        explanation: 'Domain Name System (DNS).',
        difficulty: 'MEDIUM',
      },
    ];

    const genRes = await request(app)
      .post('/api/games/generate')
      .send({
        sourceId,
        gameType: 'MIXED',
        questionCount: 4,
      });
    assert.equal(genRes.status, 200);
    const mixedGame = genRes.body.data;
    assert.equal(mixedGame.gameType, 'MIXED');
    assert.deepEqual(
      mixedGame.questions.map((q: any) => q.type),
      ['MULTIPLE_CHOICE', 'FILL_IN_THE_BLANK', 'QUICK_BUTTON', 'CROSSWORD']
    );

    // Play through all 4 question types in Single-Player Practice
    const answers = ['443', 'http', 'Đúng', 'dns'];
    const sessionId = await playPracticeSessionViaApi({
      gameId: mixedGame.gameId,
      answers: mixedGame.questions.map((q: any, idx: number) => ({
        questionId: q.id,
        answer: answers[idx],
      })),
    });

    const finalRes = await request(app).get(`/api/games/sessions/${sessionId}/result`);
    assert.equal(finalRes.status, 200);
    assert.equal(finalRes.body.data.correctCount, 4);

    // Play through all 4 question types in Multiplayer Room
    const roomRes = await request(app)
      .post('/api/rooms')
      .send({ gameId: mixedGame.gameId });
    assert.equal(roomRes.status, 200);
    const { roomCode, hostToken } = roomRes.body.data;

    const room = roomService.getRoomByCode(roomCode);
    const { player } = room.addPlayer('Multiplayer Mixed');
    room.start(hostToken);

    for (let i = 0; i < answers.length; i++) {
      const subRes = room.submitPlayerAnswer(player.playerToken, mixedGame.questions[i].id, answers[i]);
      assert.equal(subRes.result.isCorrect, true);
      room.revealQuestion(hostToken);
      room.nextQuestion(hostToken);
    }
    assert.equal(room.state, 'FINISHED');
    assert.equal(player.correctCount, 4);
  });

  it('Batch 7: Learning Analytics distinguishes empty state (hasData=false, null accuracy) from 0% accuracy and scopes by user', async () => {
    resetAllRateLimiters();

    // 1. Register fresh User C with zero completed sessions
    const regCRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'learnerC@example.com',
        password: 'LearnerPassword123!',
        displayName: 'Học Viên C',
      });
    assert.equal(regCRes.status, 201);
    const tokenC = regCRes.body.data.token;

    // Verify empty state returns hasData: false and overallAccuracyPercent: null (NOT 0%)
    const emptyAnalyticsRes = await request(app)
      .get('/api/analytics/learning')
      .set('Authorization', `Bearer ${tokenC}`);
    assert.equal(emptyAnalyticsRes.status, 200);
    assert.equal(emptyAnalyticsRes.body.data.hasData, false);
    assert.equal(emptyAnalyticsRes.body.data.overview.completedPracticeSessions, 0);
    assert.equal(emptyAnalyticsRes.body.data.overview.overallAccuracyPercent, null);
    assert.equal(emptyAnalyticsRes.body.data.overview.averageScorePerSession, null);

    // 2. User C creates a game and completes a session with 0 correct answers (true 0% accuracy)
    const ingestC = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${tokenC}`)
      .attach('files', Buffer.from('Kiến thức vật lý lượng tử cơ bản và nguyên lý bất định.', 'utf-8'), 'physics.txt');
    const sourceIdC = ingestC.body.data.sources[0].sourceId;

    mockProvider.mockTitle = 'Vật Lý Lượng Tử';
    mockProvider.mockQuestions = [
      {
        id: 'q_learn_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Ai phát biểu nguyên lý bất định?',
        choices: ['Heisenberg', 'Newton', 'Galileo', 'Faraday'],
        correctAnswer: 'Heisenberg',
        explanation: 'Werner Heisenberg phát biểu nguyên lý bất định năm 1927.',
        difficulty: 'MEDIUM',
      },
    ];

    const gameCRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({
        sourceId: sourceIdC,
        title: 'Vật Lý Lượng Tử',
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
        topicFocus: 'Vật lý lượng tử',
      });
    const gameIdC = gameCRes.body.data.gameId;
    const questionIdC = gameCRes.body.data.questions[0].id;

    // Session 1: 0/1 correct -> 0% accuracy
    await playPracticeSessionViaApi({
      gameId: gameIdC,
      answers: [{ questionId: questionIdC, answer: 'Newton' }],
      token: tokenC,
    });

    const zeroAccuracyRes = await request(app)
      .get('/api/analytics/learning')
      .set('Authorization', `Bearer ${tokenC}`);
    assert.equal(zeroAccuracyRes.status, 200);
    assert.equal(zeroAccuracyRes.body.data.hasData, true);
    assert.equal(zeroAccuracyRes.body.data.overview.completedPracticeSessions, 1);
    assert.equal(zeroAccuracyRes.body.data.overview.overallAccuracyPercent, 0, 'True 0/1 accuracy must be 0%, distinct from null');

    // Session 2: 1/1 correct -> overall 1/2 = 50% accuracy
    await playPracticeSessionViaApi({
      gameId: gameIdC,
      answers: [{ questionId: questionIdC, answer: 'Heisenberg' }],
      token: tokenC,
    });

    const improvedAnalyticsRes = await request(app)
      .get('/api/analytics/learning')
      .set('Authorization', `Bearer ${tokenC}`);
    assert.equal(improvedAnalyticsRes.status, 200);
    const analytics = improvedAnalyticsRes.body.data;
    assert.equal(analytics.hasData, true);
    assert.equal(analytics.overview.completedPracticeSessions, 2);
    assert.equal(analytics.overview.totalQuestionsAnswered, 2);
    assert.equal(analytics.overview.totalCorrectAnswers, 1);
    assert.equal(analytics.overview.overallAccuracyPercent, 50);
    assert.equal(analytics.progressOverTime.length, 1); // Both sessions on same date bucket
    assert.equal(analytics.byGameType.length, 1);
    assert.equal(analytics.byGameType[0].gameType, 'MULTIPLE_CHOICE');
    assert.equal(analytics.byGameTopic[0].gameTitle, 'Vật Lý Lượng Tử');
  });

  it('UI Simplification & Guest Mode: X-Guest-Token isolates guest question sets, supports search/filter, and enforces safe DELETE /api/games/:gameId', async () => {
    resetAllRateLimiters();

    const guestTokenA = 'gt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const guestTokenB = 'gt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    // 1. Guest A attempts to ingest content -> strictly rejected with 403 ACCESS_DENIED
    const ingestARes = await request(app)
      .post('/api/content/ingest')
      .set('X-Guest-Token', guestTokenA)
      .attach('files', Buffer.from('Tài liệu lịch sử Việt Nam của Khách A về chiến thắng Bạch Đằng.', 'utf-8'), 'guest_a_history.txt');
    assert.equal(ingestARes.status, 403);
    assert.equal(ingestARes.body.error.code, 'ACCESS_DENIED');

    // 2. Guest A attempts to generate a game -> strictly rejected with 403 ACCESS_DENIED before AI runs
    const genARes = await request(app)
      .post('/api/games/generate')
      .set('X-Guest-Token', guestTokenA)
      .send({
        sourceId: 'src_any',
        title: 'Bộ Câu Hỏi Lịch Sử Bạch Đằng',
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
      });
    assert.equal(genARes.status, 403);
    assert.equal(genARes.body.error.code, 'ACCESS_DENIED');

    // 3. Register a verified organizer account to create a sample game for isolation tests
    const regOrganizer = await request(app)
      .post('/api/auth/register')
      .send({
        email: `organizer_batch8_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Người Tổ Chức B8',
      });
    assert.equal(regOrganizer.status, 201);
    const organizerToken = regOrganizer.body.data.token;

    const ingestOrgRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${organizerToken}`)
      .attach('files', Buffer.from('Tài liệu lịch sử Việt Nam về chiến thắng Bạch Đằng năm 938.', 'utf-8'), 'history_bach_dang.txt');
    assert.equal(ingestOrgRes.status, 200);
    const sourceIdOrg = ingestOrgRes.body.data.sources[0].sourceId;

    mockProvider.mockTitle = 'Bộ Câu Hỏi Lịch Sử Bạch Đằng';
    mockProvider.mockQuestions = [
      {
        id: 'q_batch8_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Ai chỉ huy trận Bạch Đằng năm 938?',
        choices: ['Ngô Quyền', 'Lý Thường Kiệt', 'Trần Hưng Đạo', 'Lê Lợi'],
        correctAnswer: 'Ngô Quyền',
        explanation: 'Ngô Quyền đánh bại quân Nam Hán năm 938.',
        difficulty: 'EASY',
      },
    ];

    const genOrgRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        sourceId: sourceIdOrg,
        title: 'Bộ Câu Hỏi Lịch Sử Bạch Đằng',
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
      });
    assert.equal(genOrgRes.status, 200);
    const gameIdA = genOrgRes.body.data.gameId;

    // 4. Guest cannot see Organizer draft game in list, detail, edit, export, or delete
    const listBRes = await request(app)
      .get('/api/games')
      .set('X-Guest-Token', guestTokenB);
    assert.equal(listBRes.status, 200);
    assert.ok(!listBRes.body.data.games.some((g: any) => g.gameId === gameIdA));

    const getBRes = await request(app)
      .get(`/api/games/${gameIdA}`)
      .set('X-Guest-Token', guestTokenB);
    assert.equal(getBRes.status, 403);

    const patchBRes = await request(app)
      .patch(`/api/games/${gameIdA}/questions`)
      .set('X-Guest-Token', guestTokenB)
      .send({ questions: genOrgRes.body.data.questions });
    assert.equal(patchBRes.status, 403);

    const exportBRes = await request(app)
      .get(`/api/games/${gameIdA}/export?format=json`)
      .set('X-Guest-Token', guestTokenB);
    assert.equal(exportBRes.status, 403);

    const deleteBRes = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('X-Guest-Token', guestTokenB);
    assert.equal(deleteBRes.status, 403);

    // 4b. Missing token (no Authorization, no X-Guest-Token) also cannot access Organizer draft game
    assert.equal((await request(app).get(`/api/games/${gameIdA}`)).status, 403);
    assert.equal(
      (await request(app).patch(`/api/games/${gameIdA}/questions`).send({ questions: genOrgRes.body.data.questions })).status,
      403
    );
    assert.equal((await request(app).get(`/api/games/${gameIdA}/export?format=json`)).status, 403);
    assert.equal((await request(app).delete(`/api/games/${gameIdA}`)).status, 403);

    // 4c. Invalid X-Guest-Token format is rejected with 400 INVALID_GUEST_TOKEN
    const badGuestTokenRes = await request(app)
      .get('/api/games')
      .set('X-Guest-Token', 'invalid_token_not_hex');
    assert.equal(badGuestTokenRes.status, 400);
    assert.equal(badGuestTokenRes.body.error.code, 'INVALID_GUEST_TOKEN');

    // 5. Organizer can edit and export their question set
    const updatedQuestions = [
      {
        ...genOrgRes.body.data.questions[0],
        question: 'Vị tướng nào đã chỉ huy chiến thắng Bạch Đằng năm 938?',
      },
    ];
    const patchOrgRes = await request(app)
      .patch(`/api/games/${gameIdA}/questions`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ questions: updatedQuestions });
    assert.equal(patchOrgRes.status, 200);
    assert.equal(patchOrgRes.body.data.questions[0].question, 'Vị tướng nào đã chỉ huy chiến thắng Bạch Đằng năm 938?');

    const exportOrgRes = await request(app)
      .get(`/api/games/${gameIdA}/export?format=csv`)
      .set('Authorization', `Bearer ${organizerToken}`);
    assert.equal(exportOrgRes.status, 200);
    assert.ok(exportOrgRes.text.includes('Ngô Quyền'));

    // 6. Cannot delete a game while an active room is using it (409 GAME_IN_USE)
    const activeRoomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ gameId: gameIdA });
    assert.equal(activeRoomRes.status, 200);
    const activeRoomCode = activeRoomRes.body.data.roomCode;
    const activeHostToken = activeRoomRes.body.data.hostToken;

    const conflictDeleteRes = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('Authorization', `Bearer ${organizerToken}`);
    assert.equal(conflictDeleteRes.status, 409);
    assert.equal(conflictDeleteRes.body.error.code, 'GAME_IN_USE');

    // Finish the active room so the game is no longer in use
    const roomInstance = roomService.getRoomByCode(activeRoomCode);
    roomInstance.addPlayer('Tester');
    roomInstance.start(activeHostToken);
    roomInstance.revealQuestion(activeHostToken);
    roomInstance.nextQuestion(activeHostToken);
    assert.equal(roomInstance.state, 'FINISHED');

    // 7. Organizer deletes the question set and verifies removal from memory and SQLite
    const deleteOrgRes = await request(app)
      .delete(`/api/games/${gameIdA}`)
      .set('Authorization', `Bearer ${organizerToken}`);
    assert.equal(deleteOrgRes.status, 200);
    assert.equal(deleteOrgRes.body.data.deleted, true);

    const getAfterDeleteRes = await request(app)
      .get(`/api/games/${gameIdA}`)
      .set('Authorization', `Bearer ${organizerToken}`);
    assert.equal(getAfterDeleteRes.status, 404);

    assert.equal(gameStore.get(gameIdA), undefined);
    const dbRow = getDatabase()?.prepare('SELECT game_id FROM games WHERE game_id = ?').get(gameIdA);
    assert.equal(dbRow, undefined);
  });
});



