import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { app } from '../src/app.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import {
  AI_MODEL_PRICING_CATALOG,
  calculateAiCallCost,
  getExchangeRateConfig,
} from '../src/config/ai-pricing.config.js';
import { LIMITS } from '../src/config/limits.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { setAdventureAssetImageProvider } from '../src/services/adventure-asset-pack.service.js';
import { AiProviderUsageMetadata, aiObservabilityService } from '../src/services/ai.observability.service.js';
import { AiModelProvider, aiQuestionService } from '../src/services/ai.question.service.js';
import { sourceStore } from '../src/storage/source.store.js';
import { closeDatabase, getDatabase, initDatabase } from '../src/storage/sqlite.db.js';

class ConfigurableMockAiProvider implements AiModelProvider {
  public callCount = 0;
  public shouldFail = false;
  public responsesQueue: any[] = [];
  public usageQueue: Array<AiProviderUsageMetadata | null> = [];
  public defaultUsage: AiProviderUsageMetadata | null = {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    inputTokens: 2000,
    outputTokens: 800,
    cachedTokens: 0,
    thinkingTokens: 0,
    totalTokens: 2800,
    usageReportedByProvider: true,
  };
  private lastUsage: AiProviderUsageMetadata | null = null;

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    this.callCount += 1;
    if (this.usageQueue.length > 0) {
      this.lastUsage = this.usageQueue.shift() ?? null;
    } else {
      this.lastUsage = this.defaultUsage ? { ...this.defaultUsage } : null;
    }

    if (this.shouldFail) {
      throw new Error('Simulated AI provider outage');
    }

    if (this.responsesQueue.length > 0) {
      return this.responsesQueue.shift();
    }

    return [
      {
        id: 'q_mock_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Quy định đội mũ bảo hiểm khi đi xe mô tô là gì?',
        choices: [
          'A. Bắt buộc đội mũ đạt chuẩn và cài quai đúng quy cách',
          'B. Chỉ cần đội khi đi cao tốc',
          'C. Không bắt buộc với người ngồi sau',
          'D. Chỉ đội vào ban đêm',
        ],
        correctAnswer: 'A. Bắt buộc đội mũ đạt chuẩn và cài quai đúng quy cách',
        explanation: 'Theo quy định an toàn giao thông trong tài liệu.',
        difficulty: 'MEDIUM',
      },
      {
        id: 'q_mock_2',
        type: 'QUICK_BUTTON',
        question: 'Tốc độ tối đa khu đông dân cư không dải phân cách cứng là 50 km/h.',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'Theo tài liệu trang 1.',
        difficulty: 'EASY',
      },
    ];
  }

  getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return this.lastUsage;
  }
}

describe('V3 AI Token & Cost Tracking + 4-Sheet Excel Export (All 35 Mandatory Cases)', () => {
  let tempDbPath = '';
  let mockProvider: ConfigurableMockAiProvider;
  let adminToken = '';
  let creatorToken = '';
  let sampleSourceId = '';

  before(async () => {
    closeDatabase();
    tempDbPath = path.join(os.tmpdir(), `v3_ai_cost_test_${Date.now()}_${process.pid}.sqlite`);
    initDatabase(tempDbPath);

    // Ensure no legacy env overrides interfere with multi-model pricing catalog tests
    (LIMITS as any).GEMINI_INPUT_COST_PER_1M_USD = null;
    (LIMITS as any).GEMINI_OUTPUT_COST_PER_1M_USD = null;
    process.env.AI_BILLING_MODE = 'PAID';
    process.env.AI_USD_VND_EXCHANGE_RATE = '25500';

    mockProvider = new ConfigurableMockAiProvider();
    (aiQuestionService as any).provider = mockProvider;

    resetAllRateLimiters();
    gameStore.clear();
    sourceStore.clear();
    sessionStore.clear();
    roomStore.clear();

    // Register Admin & Creator
    const regAdmin = await request(app).post('/api/auth/register').send({
      email: 'cost_admin@example.com',
      password: 'Password123!',
      displayName: 'Quản Trị Ngân Sách AI',
    });
    assert.equal(regAdmin.status, 201);
    adminToken = regAdmin.body.data.token;
    const adminUserId = regAdmin.body.data.user.userId;

    // Promote to ADMIN in SQLite
    getDatabase().prepare(`UPDATE users SET role = 'ADMIN' WHERE user_id = ?`).run(adminUserId);
    // Re-login to refresh session role if needed
    const loginAdmin = await request(app).post('/api/auth/login').send({
      email: 'cost_admin@example.com',
      password: 'Password123!',
    });
    adminToken = loginAdmin.body.data.token;

    const regCreator = await request(app).post('/api/auth/register').send({
      email: 'cost_creator@example.com',
      password: 'Password123!',
      displayName: 'Creator Test',
    });
    assert.equal(regCreator.status, 201);
    creatorToken = regCreator.body.data.token;

    // Ingest a reusable source document
    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set('Authorization', `Bearer ${creatorToken}`)
      .attach(
        'files',
        Buffer.from(
          'Tài liệu đào tạo an toàn giao thông: Người điều khiển xe mô tô bắt buộc đội mũ bảo hiểm đạt chuẩn và cài quai đúng quy cách. Tốc độ tối đa khu đông dân cư là 50 km/h. Chu kỳ thay nhớt là 1.500 - 2.000 km.',
          'utf-8'
        ),
        'an_toan_giao_thong.txt'
      );
    assert.equal(ingestRes.status, 200);
    sampleSourceId = ingestRes.body.data.sources[0].sourceId;
  });

  after(() => {
    setAdventureAssetImageProvider(null);
    closeDatabase();
    try {
      if (tempDbPath && fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    } catch {
      // ignore cleanup error
    }
  });

  it('Tests 1, 5, 6, 7, 8, 9, 10, 11, 12, 13: Single AI call token logging, multi-model pricing, Free vs Paid tier, USD/VND conversion, non-double-counting cached/thinking tokens, missing usageMetadata, and PRICE_UNAVAILABLE', async () => {
    // Clear existing logs for clean math verification
    getDatabase().prepare('DELETE FROM ai_usage_logs').run();

    // Test 1 & Test 5 & Test 8 & Test 9: Single-call game generation on gemini-2.5-flash ($0.30/1M in, $2.50/1M out, 25500 VND/USD)
    mockProvider.defaultUsage = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 100_000, // $0.03
      outputTokens: 20_000, // $0.05
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 120_000,
      usageReportedByProvider: true,
    };

    const genRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Test Đơn Call Flash',
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
      });
    assert.equal(genRes.status, 200);
    const game1Id = genRes.body.data.gameId;

    const report1 = aiObservabilityService.getAdminAiCostReport();
    const game1Log = report1.apiLogs.find((l) => l.gameId === game1Id);
    assert.ok(game1Log, 'Must record AI call for generated game');
    assert.equal(game1Log.inputTokens, 100_000);
    assert.equal(game1Log.outputTokens, 20_000);
    assert.equal(game1Log.totalTokens, 120_000);
    // 100k * $0.30/1M + 20k * $2.50/1M = $0.03 + $0.05 = $0.08 USD
    assert.equal(game1Log.paidEquivalentCostUsd, 0.08);
    assert.equal(game1Log.actualCostUsd, 0.08);
    // $0.08 * 25500 = 2040 VND
    assert.equal(game1Log.paidEquivalentCostVnd, 2040);
    assert.equal(game1Log.actualCostVnd, 2040);

    // Test 6: Different model (gemini-2.5-pro: $1.25/1M in, $10.00/1M out) has distinct pricing!
    const proCalc = calculateAiCallCost({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      status: 'SUCCESS',
      inputTokens: 100_000, // $0.125
      outputTokens: 20_000, // $0.20
      totalTokens: 120_000,
      billingMode: 'PAID',
    });
    assert.equal(proCalc.paidEquivalentCostUsd, 0.325);
    assert.notEqual(proCalc.paidEquivalentCostUsd, game1Log.paidEquivalentCostUsd);

    // Test 7: Free tier vs Paid tier (Actual cost = $0 on FREE tier, while Paid-Tier Equivalent cost is still computed for budgeting!)
    const freeCalc = calculateAiCallCost({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      status: 'SUCCESS',
      inputTokens: 100_000,
      outputTokens: 20_000,
      totalTokens: 120_000,
      billingMode: 'FREE',
    });
    assert.equal(freeCalc.billingMode, 'FREE');
    assert.equal(freeCalc.actualCostUsd, 0);
    assert.equal(freeCalc.actualCostVnd, 0);
    assert.equal(freeCalc.paidEquivalentCostUsd, 0.08);
    assert.equal(freeCalc.paidEquivalentCostVnd, 2040);

    // Test 10 & Test 11: Cached tokens & Thinking tokens without double counting!
    // Suppose promptTokenCount = 100,000 (which includes 40,000 cachedContentTokenCount -> 60,000 non-cached input)
    // candidatesTokenCount = 10,000, thoughtsTokenCount = 10,000 -> totalTokenCount = 120,000
    // Non-cached input: 60k * $0.30/1M = $0.018
    // Cached input: 40k * $0.075/1M = $0.003
    // Billable output (10k + 10k = 20k): 20k * $2.50/1M = $0.050
    // Total Paid Equivalent Cost = $0.018 + $0.003 + $0.050 = $0.071 USD
    const cachedThinkingCalc = calculateAiCallCost({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      status: 'SUCCESS',
      inputTokens: 100_000,
      outputTokens: 10_000,
      cachedTokens: 40_000,
      thinkingTokens: 10_000,
      totalTokens: 120_000,
      billingMode: 'PAID',
    });
    assert.equal(cachedThinkingCalc.nonCachedInputTokens, 60_000);
    assert.equal(cachedThinkingCalc.cachedTokens, 40_000);
    assert.equal(cachedThinkingCalc.billableOutputTokens, 20_000);
    assert.equal(cachedThinkingCalc.totalTokens, 120_000, 'Must not double-add cached or thinking tokens');
    assert.equal(cachedThinkingCalc.paidEquivalentCostUsd, 0.071);

    // Test 12: Missing usageMetadata -> tokens and cost must be null, pricingStatus = USAGE_UNAVAILABLE
    const missingUsageLogId = aiObservabilityService.recordAiCall({
      generationId: 'gen_missing_usage',
      gameId: 'game_missing_usage',
      gameTitleSnapshot: 'Game Thiếu UsageMetadata',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      status: 'SUCCESS',
      latencyMs: 320,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    const reportAfterMissing = aiObservabilityService.getAdminAiCostReport();
    const missingLog = reportAfterMissing.apiLogs.find((l) => l.logId === missingUsageLogId);
    assert.ok(missingLog);
    assert.equal(missingLog.pricingStatus, 'USAGE_UNAVAILABLE');
    assert.equal(missingLog.inputTokens, null);
    assert.equal(missingLog.outputTokens, null);
    assert.equal(missingLog.paidEquivalentCostUsd, null);
    assert.equal(missingLog.actualCostUsd, null);

    // Test 13: Model not in pricing table -> PRICE_UNAVAILABLE, cost is null (never 0)
    const unknownModelLogId = aiObservabilityService.recordAiCall({
      generationId: 'gen_unknown_model',
      gameId: 'game_unknown_model',
      gameTitleSnapshot: 'Game Model Lạ',
      provider: 'gemini',
      model: 'gemini-99.9-ultra-unknown',
      operation: 'GENERATE_QUESTIONS',
      status: 'SUCCESS',
      latencyMs: 410,
      inputTokens: 5000,
      outputTokens: 1500,
      totalTokens: 6500,
    });
    const reportAfterUnknownModel = aiObservabilityService.getAdminAiCostReport();
    const unknownModelLog = reportAfterUnknownModel.apiLogs.find((l) => l.logId === unknownModelLogId);
    assert.ok(unknownModelLog);
    assert.equal(unknownModelLog.pricingStatus, 'PRICE_UNAVAILABLE');
    assert.equal(unknownModelLog.pricingVersion, 'PRICE_UNAVAILABLE');
    assert.equal(unknownModelLog.paidEquivalentCostUsd, null, 'Unknown model cost must be null, never 0');
    assert.equal(unknownModelLog.actualCostUsd, null);
  });

  it('Tests 2, 3, 4: Multi-call game generation (primary + supplemental retry + image generation), failed AI call logging, and preserving logs when a game is unsaved or deleted', async () => {
    getDatabase().prepare('DELETE FROM ai_usage_logs').run();

    // Test 2: Game MIXED triggering primary call + supplemental retry call under the same gameId & generationId
    // Request 2 questions in MIXED (50% MULTIPLE_CHOICE = 1, 50% QUICK_BUTTON = 1).
    // First call returns only MULTIPLE_CHOICE -> triggers supplemental retry call for QUICK_BUTTON!
    mockProvider.responsesQueue = [
      [
        {
          id: 'q_mix_1',
          type: 'MULTIPLE_CHOICE',
          question: 'Chu kỳ thay dầu nhớt xe máy là bao nhiêu km?',
          choices: ['A. 500 km', 'B. 1.500 - 2.000 km', 'C. 5.000 km', 'D. 10.000 km'],
          correctAnswer: 'B. 1.500 - 2.000 km',
          explanation: 'Theo tài liệu.',
          difficulty: 'MEDIUM',
        },
      ],
      [
        {
          id: 'q_mix_2',
          type: 'QUICK_BUTTON',
          question: 'Người lái xe mô tô bắt buộc phải đội mũ bảo hiểm.',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation: 'Theo tài liệu.',
          difficulty: 'EASY',
        },
      ],
    ];
    mockProvider.usageQueue = [
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        inputTokens: 50_000,
        outputTokens: 10_000,
        cachedTokens: 0,
        thinkingTokens: 0,
        totalTokens: 60_000,
        usageReportedByProvider: true,
      },
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        inputTokens: 50_000,
        outputTokens: 10_000,
        cachedTokens: 0,
        thinkingTokens: 0,
        totalTokens: 60_000,
        usageReportedByProvider: true,
      },
    ];

    const mixRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Đi Cảnh Nhiều Request AI',
        gameType: 'ADVENTURE',
        questionCount: 2,
        adventureConfig: {
          questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
          questionDistribution: {
            MULTIPLE_CHOICE: 50,
            QUICK_BUTTON: 50,
            FILL_IN_THE_BLANK: 0,
            CROSSWORD: 0,
          },
        },
      });
    assert.equal(mixRes.status, 200);
    const mixedGameId = mixRes.body.data.gameId;

    const reportMulti = aiObservabilityService.getAdminAiCostReport();
    const mixedGameGroup = reportMulti.byGame.find((g) => g.gameId === mixedGameId);
    assert.ok(mixedGameGroup, 'Must group all AI calls for the multi-call game');
    assert.equal(mixedGameGroup.requestCount, 2, 'Both primary and supplemental retry calls must be logged');
    assert.equal(mixedGameGroup.inputTokens, 100_000);
    assert.equal(mixedGameGroup.outputTokens, 20_000);
    assert.equal(mixedGameGroup.totalTokens, 120_000);
    assert.equal(mixedGameGroup.paidEquivalentCostUsd, 0.08);

    // Test 3: Failed AI call is still logged with status = FAILED
    mockProvider.shouldFail = true;
    mockProvider.usageQueue = [
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        inputTokens: 10_000,
        outputTokens: 0,
        cachedTokens: 0,
        thinkingTokens: 0,
        totalTokens: 10_000,
        usageReportedByProvider: true,
      },
    ];
    const failRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Lỗi AI Provider',
        gameType: 'QUICK_BUTTON',
        questionCount: 1,
      });
    assert.equal(failRes.status, 502);
    mockProvider.shouldFail = false;

    const reportAfterFail = aiObservabilityService.getAdminAiCostReport();
    assert.equal(reportAfterFail.summary.failedRequests, 1);

    // Test 4: Deleting the game from Library does NOT delete its AI cost logs!
    const delRes = await request(app)
      .delete(`/api/admin/games/${encodeURIComponent(mixedGameId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(delRes.status, 200);

    const reportAfterDelete = aiObservabilityService.getAdminAiCostReport();
    const preservedGameGroup = reportAfterDelete.byGame.find((g) => g.gameId === mixedGameId);
    assert.ok(preservedGameGroup, 'Cost history for a deleted game must remain preserved');
    assert.equal(preservedGameGroup.gameTitle, 'Game Đi Cảnh Nhiều Request AI');
    assert.equal(preservedGameGroup.isSavedInLibrary, false);
    assert.equal(preservedGameGroup.paidEquivalentCostUsd, 0.08);
  });

  it('Tests 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27: Average cost per game, 100/1,000/10,000 scaling projections, Admin RBAC, filters, and 4-Sheet Excel Export (.xlsx) with Formula Injection Protection & No Secret Leakage', async () => {
    getDatabase().prepare('DELETE FROM ai_usage_logs').run();

    // Seed 2 clean games + 1 malicious title game to verify exact averages, scaling projections, and Excel sanitization
    // Game A: gemini-2.5-flash, 100k in + 20k out = $0.08 USD (2,040 VND)
    aiObservabilityService.recordAiCall({
      generationId: 'gen_scale_1',
      gameId: 'game_scale_1',
      gameTitleSnapshot: 'Game Đào Tạo Chuẩn A',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'MULTIPLE_CHOICE',
      status: 'SUCCESS',
      latencyMs: 500,
      inputTokens: 100_000,
      outputTokens: 20_000,
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 120_000,
    });

    // Game B (with formula-injection title & multi-call: question + cover image):
    // Call 1: gemini-2.5-flash, 200k in ($0.06) + 40k out ($0.10) = $0.16 USD
    // Call 2: gemini-2.5-flash-image, 0 tokens -> flat image price $0.039 USD
    // Total Game B = $0.199 USD
    aiObservabilityService.recordAiCall({
      generationId: 'gen_scale_2',
      gameId: 'game_scale_2',
      gameTitleSnapshot: '=cmd|\'/C calc\'!A0 Game Đi Cảnh B',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'ADVENTURE',
      status: 'SUCCESS',
      latencyMs: 650,
      inputTokens: 200_000,
      outputTokens: 40_000,
      cachedTokens: 10_000, // 190k non-cached ($0.057) + 10k cached ($0.00075) + 40k out ($0.10) = $0.15775
      thinkingTokens: 5_000, // +5k thinking ($0.0125) -> total Call 1 = $0.17025
      totalTokens: 245_000,
    });
    aiObservabilityService.recordAiCall({
      generationId: 'gen_scale_2',
      gameId: 'game_scale_2',
      gameTitleSnapshot: '=cmd|\'/C calc\'!A0 Game Đi Cảnh B',
      assetSlot: 'COVER',
      provider: 'gemini',
      model: 'gemini-2.5-flash-image',
      operation: 'GENERATE_COVER_IMAGE',
      taskType: 'COVER_IMAGE_GENERATION',
      gameType: 'ADVENTURE',
      status: 'SUCCESS',
      latencyMs: 1200,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });

    // Also add 1 record with USAGE_UNAVAILABLE so we verify it does NOT distort the eligible average!
    aiObservabilityService.recordAiCall({
      generationId: 'gen_unreported',
      gameId: 'game_unreported',
      gameTitleSnapshot: 'Game Không Có Token Usage',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'QUICK_BUTTON',
      status: 'SUCCESS',
      latencyMs: 300,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });

    // Test 17A: Local Demo Mode ON (ADMIN_COST_DEMO_MODE=true in non-production)
    // Allows unauthenticated read-only access to /api/admin/ai-costs and /api/admin/ai-costs/export without login/password
    const prevDemoMode = process.env.ADMIN_COST_DEMO_MODE;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      process.env.ADMIN_COST_DEMO_MODE = 'true';

      const demoCostRes = await request(app).get('/api/admin/ai-costs');
      assert.equal(demoCostRes.status, 200, 'Demo Mode must allow unauthenticated GET /api/admin/ai-costs');
      assert.equal(demoCostRes.body.data.demoMode, true);
      assert.equal(demoCostRes.body.data.summary.totalGameGenerations, 3);

      const demoExcelRes = await request(app)
        .get('/api/admin/ai-costs/export')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      assert.equal(demoExcelRes.status, 200, 'Demo Mode must allow unauthenticated GET /api/admin/ai-costs/export');
      const demoWb = XLSX.read(demoExcelRes.body as Buffer, { type: 'buffer' });
      assert.deepEqual(demoWb.SheetNames, [
        'TỔNG QUAN',
        'CHI PHÍ TỪNG GAME',
        'CHI TIẾT API',
        'BẢNG GIÁ AI',
      ]);

      // Even in Demo Mode, X-Guest-Token & X-Player-Token are rejected, and write/sensitive Admin routes remain protected
      const guestInDemoRes = await request(app)
        .get('/api/admin/ai-costs')
        .set('X-Guest-Token', 'gt_1234567890abcdef1234567890abcdef');
      assert.equal(guestInDemoRes.status, 403);

      const sensitiveUsersInDemoRes = await request(app).get('/api/admin/users');
      assert.equal(sensitiveUsersInDemoRes.status, 401, 'Demo Mode must NOT open /api/admin/users');

      // Test 17B: Production Hard Block (NODE_ENV=production blocks Demo Mode even if ADMIN_COST_DEMO_MODE=true)
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_COST_DEMO_MODE = 'true';

      const prodBlockedRes = await request(app).get('/api/admin/ai-costs');
      assert.equal(
        prodBlockedRes.status,
        401,
        'Public Production must NEVER allow Demo Mode even if ADMIN_COST_DEMO_MODE=true'
      );

      const prodExportBlockedRes = await request(app).get('/api/admin/ai-costs/export');
      assert.equal(prodExportBlockedRes.status, 401);

      // Test 17C: Demo Mode OFF (ADMIN_COST_DEMO_MODE=false) -> reverts to strict Admin RBAC & rejects fake client headers
      process.env.NODE_ENV = 'development';
      process.env.ADMIN_COST_DEMO_MODE = 'false';

      const unauthRes = await request(app).get('/api/admin/ai-costs');
      assert.equal(unauthRes.status, 401);

      const fakeHeaderRes = await request(app)
        .get('/api/admin/ai-costs')
        .set('X-Admin-Demo', 'true')
        .set('X-Admin', 'true')
        .set('X-Role', 'ADMIN');
      assert.equal(
        fakeHeaderRes.status,
        401,
        'Must never trust client-supplied fake Admin or Demo headers'
      );

      const nonAdminRes = await request(app)
        .get('/api/admin/ai-costs')
        .set('Authorization', `Bearer ${creatorToken}`);
      assert.equal(nonAdminRes.status, 403);

      const guestExportRes = await request(app)
        .get('/api/admin/ai-costs/export')
        .set('X-Guest-Token', 'gt_1234567890abcdef1234567890abcdef');
      assert.equal(guestExportRes.status, 403);
    } finally {
      if (prevDemoMode === undefined) {
        delete process.env.ADMIN_COST_DEMO_MODE;
      } else {
        process.env.ADMIN_COST_DEMO_MODE = prevDemoMode;
      }
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }

    // Test 16 & Test 14 & Test 15: Admin accesses GET /api/admin/ai-costs
    const costRes = await request(app)
      .get('/api/admin/ai-costs')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(costRes.status, 200);
    const report = costRes.body.data;

    assert.equal(report.summary.totalGameGenerations, 3);
    assert.equal(report.summary.eligibleGenerationsForAverage, 2, 'Only the 2 games with complete pricing & usage are eligible for average');
    assert.equal(report.summary.totalAiRequests, 4);

    // Game 1 Paid Cost = $0.08
    // Game 2 Paid Cost = $0.17025 + $0.039 = $0.20925
    // Total Paid Cost = $0.28925
    // Average Paid Cost Per Eligible Game = $0.28925 / 2 = $0.144625 USD
    assert.equal(report.summary.paidEquivalentCostUsd, 0.28925);
    assert.equal(report.summary.avgPaidEquivalentCostPerGameUsd, 0.144625);

    // Test 15: Scaling Projections for 100, 1,000, and 10,000 games
    const proj100 = report.scalingProjections.find((p: any) => p.scaleGenerations === 100);
    const proj1000 = report.scalingProjections.find((p: any) => p.scaleGenerations === 1000);
    const proj10000 = report.scalingProjections.find((p: any) => p.scaleGenerations === 10000);
    assert.ok(proj100 && proj1000 && proj10000);
    assert.equal(proj100.projectedPaidEquivalentCostUsd, Number((0.144625 * 100).toFixed(6)));
    assert.equal(proj1000.projectedPaidEquivalentCostUsd, Number((0.144625 * 1000).toFixed(6)));
    assert.equal(proj10000.projectedPaidEquivalentCostUsd, Number((0.144625 * 10000).toFixed(6)));

    // Test 18, 19, 20: Filter by date preset, model, and gameType
    const filterModelRes = await request(app)
      .get('/api/admin/ai-costs?model=gemini-2.5-flash-image')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(filterModelRes.status, 200);
    assert.equal(filterModelRes.body.data.summary.totalAiRequests, 1);
    assert.equal(filterModelRes.body.data.summary.paidEquivalentCostUsd, 0.039);

    const filterGameTypeRes = await request(app)
      .get('/api/admin/ai-costs?gameType=MULTIPLE_CHOICE')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(filterGameTypeRes.status, 200);
    assert.equal(filterGameTypeRes.body.data.summary.totalGameGenerations, 1);
    assert.equal(filterGameTypeRes.body.data.summary.paidEquivalentCostUsd, 0.08);

    const filterTodayRes = await request(app)
      .get('/api/admin/ai-costs?preset=TODAY')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(filterTodayRes.status, 200);
    assert.equal(filterTodayRes.body.data.summary.totalAiRequests, 4);

    // Test 21, 22, 23, 24, 25, 26, 27: Export 4-Sheet Excel (.xlsx) and inspect workbook structure & cells
    const excelRes = await request(app)
      .get('/api/admin/ai-costs/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(excelRes.status, 200);
    assert.match(
      String(excelRes.headers['content-type']),
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );
    assert.match(String(excelRes.headers['content-disposition']), /AI_Game_Cost_Report_\d{4}-\d{2}-\d{2}\.xlsx/);

    const wb = XLSX.read(excelRes.body as Buffer, { type: 'buffer' });
    assert.deepEqual(
      wb.SheetNames,
      ['TỔNG QUAN', 'CHI PHÍ TỪNG GAME', 'CHI TIẾT API', 'BẢNG GIÁ AI'],
      'Excel workbook must contain all 4 mandatory sheets in order'
    );

    const sheetOverview = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['TỔNG QUAN'], { header: 1 });
    const sheetGames = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['CHI PHÍ TỪNG GAME'], { header: 1 });
    const sheetApi = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['CHI TIẾT API'], { header: 1 });
    const sheetPricing = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['BẢNG GIÁ AI'], { header: 1 });

    // Check Sheet 1 (TỔNG QUAN) contains scaling projections 100 / 1.000 / 10.000
    const sheet1Text = JSON.stringify(sheetOverview);
    assert.ok(sheet1Text.includes('100 lượt tạo game'));
    assert.ok(sheet1Text.includes('1.000 lượt tạo game'));
    assert.ok(sheet1Text.includes('10.000 lượt tạo game'));

    // Check Sheet 2 (CHI PHÍ TỪNG GAME) matches UI numbers & has TỔNG CỘNG row
    assert.equal(sheetGames[0][0], 'STT');
    const totalRowSheet2 = sheetGames[sheetGames.length - 1];
    assert.equal(totalRowSheet2[0], 'TỔNG CỘNG');
    assert.equal(totalRowSheet2[14], 0.28925, 'Sheet 2 total Paid Equivalent USD must match UI');

    // Test 26: Formula Injection Protection on malicious game title (`=cmd|'/C calc'!A0 ...`)
    const sheet2Text = JSON.stringify(sheetGames);
    assert.ok(
      sheet2Text.includes("'=cmd|"),
      'Spreadsheet formula injection strings must be neutralized with a leading single quote'
    );

    // Check Sheet 3 (CHI TIẾT API) has all 4 API requests + header + total row
    assert.equal(sheetApi.length, 6); // 1 header + 4 data rows + 1 total row

    // Check Sheet 4 (BẢNG GIÁ AI) has all configured models
    assert.equal(sheetPricing.length, 1 + AI_MODEL_PRICING_CATALOG.length);

    // Test 27: Verify no API keys, bearer tokens, or raw document secrets appear anywhere in Excel
    const allSheetsSerialized = JSON.stringify({
      sheetOverview,
      sheetGames,
      sheetApi,
      sheetPricing,
    });
    assert.ok(!allSheetsSerialized.includes('AIza'), 'Excel must never leak Gemini API keys');
    assert.ok(!allSheetsSerialized.includes(adminToken), 'Excel must never leak auth tokens');

    // Save a sample Excel artifact to scratch for inspection
    const sampleExcelPath = path.join(os.tmpdir(), `AI_Game_Cost_Report_Sample.xlsx`);
    fs.writeFileSync(sampleExcelPath, excelRes.body as Buffer);
    assert.ok(fs.existsSync(sampleExcelPath));
  });

  it('Tests 28, 29, 30, 31, 32, 33, 34, 35: Regression suite (Game creation & library save, Solo PLAY, Multiplayer Room, EXAM per-batch QR, Grant Retake, Adventure 2D asset packs)', async () => {
    // Test 28 & 29 & 30: Create PLAY game, play solo session, create multiplayer room
    const createPlayRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Regression PLAY',
        gameType: 'MULTIPLE_CHOICE',
        sessionMode: 'PLAY',
        questionCount: 2,
        isPublic: true,
      });
    assert.equal(createPlayRes.status, 200);
    const playGameId = createPlayRes.body.data.gameId;

    // Start Solo session
    const startSoloRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: playGameId, playerName: 'Solo Tester' });
    assert.equal(startSoloRes.status, 200);
    assert.ok(startSoloRes.body.data.sessionId);

    // Create Multiplayer room
    const createRoomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ gameId: playGameId });
    assert.ok(createRoomRes.status === 200 || createRoomRes.status === 201);
    assert.ok(createRoomRes.body.data.roomCode);

    // Test 31, 32, 33, 34: Create EXAM game with roster, verify Reports PLAY & EXAM detail, per-batch QR, and Grant Retake
    const createExamRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Regression EXAM',
        gameType: 'MULTIPLE_CHOICE',
        sessionMode: 'EXAM',
        rosterMode: 'PRECONFIGURED',
        requireRoster: true,
        questionCount: 2,
        participants: [
          {
            fullName: 'Nguyễn Văn Thi',
            departmentUnit: 'Kỹ Thuật',
            employeeCode: 'NV001',
          },
        ],
      });
    assert.equal(createExamRes.status, 200);
    const examGameId = createExamRes.body.data.gameId;

    // Fetch Reports detail for PLAY and EXAM
    const playReportRes = await request(app)
      .get(`/api/games/${encodeURIComponent(playGameId)}/reports`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(playReportRes.status, 200);
    assert.equal(playReportRes.body.data.sessionMode, 'PLAY');

    const examReportRes = await request(app)
      .get(`/api/games/${encodeURIComponent(examGameId)}/reports`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(examReportRes.status, 200);
    assert.equal(examReportRes.body.data.sessionMode, 'EXAM');
    const participantId = examReportRes.body.data.rosterParticipants[0].participantId;

    // Open a new EXAM batch & verify per-batch QR
    const openBatchRes = await request(app)
      .post(`/api/games/${encodeURIComponent(examGameId)}/reopen-exam`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ createNewBatch: true, batchName: 'Đợt Thi Kiểm Thử 2' });
    assert.equal(openBatchRes.status, 200);
    const batchId = openBatchRes.body.data.batchId;
    assert.ok(batchId);

    const batchQrRes = await request(app)
      .get(`/api/games/${encodeURIComponent(examGameId)}/batches/${encodeURIComponent(batchId)}/qr`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(batchQrRes.status, 200);
    assert.ok(batchQrRes.body.data.qrDataUrl.startsWith('data:image/png;base64,'));
    assert.ok(batchQrRes.body.data.joinUrl.includes(`batch=${encodeURIComponent(batchId)}`));

    // Grant retake in Reports
    const grantRetakeRes = await request(app)
      .post(
        `/api/games/${encodeURIComponent(examGameId)}/participants/${encodeURIComponent(participantId)}/grant-retake`
      )
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ additionalAttempts: 1 });
    assert.equal(grantRetakeRes.status, 200);
    assert.equal(grantRetakeRes.body.data.participant.allowedAttempts, 2);

    // Test 35: Adventure 2D industry asset pack verification
    const createAdvRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Regression Adventure 2D',
        gameType: 'ADVENTURE',
        industryId: 'MOTORCYCLE_TRAFFIC',
        questionCount: 2,
      });
    assert.equal(createAdvRes.status, 200);
    assert.equal(createAdvRes.body.data.settings.adventureConfig.assetStatus, 'READY');
    assert.ok(createAdvRes.body.data.settings.adventureConfig.assets.background.url);
  });

  it('Browser E2E V2 (Full-width Admin layout, 4 KPIs, 3 time filters, NO Tech Accordion, NO Model AI column, 6-column Library games table, duplicate titles not merged, orphan/unsaved/deleted games excluded, responsive 360/390/768/1024/1440/1920)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_COST_DEMO_MODE = 'true';

    // Prepare realistic Library games + non-library AI logs to verify LIB-01..LIB-06 and COST-01..COST-09:
    // 1) Create a saved Library game with exact 30.000 ₫ total cost:
    //    Rate = 25,500 VND/USD.
    //    Let's create Game Lib 1 ("Game Đào Tạo Hội Nhập V2") via API so it is saved in Library (`games` table):
    const libGame1Res = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Đào Tạo Hội Nhập V2',
        gameType: 'MULTIPLE_CHOICE',
        sessionMode: 'PLAY',
        questionCount: 2,
        isPublic: true,
      });
    assert.equal(libGame1Res.status, 200);
    const libGame1Id = libGame1Res.body.data.gameId;

    // Replace its AI usage logs with a clean 2-request log totaling 30.000 ₫:
    // Using gemini-2.5-flash ($0.30/1M in, $2.50/1M out, rate 25,500):
    // Request 1: 1,000,000 input tokens -> $0.30 * 25,500 = 7,650 ₫
    //            350,588 output tokens -> (0.350588 * 2.50) * 25,500 = 22,350 ₫
    // Total = 7,650 + 22,350 = 30,000 ₫!
    getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id = ?').run(libGame1Id);
    aiObservabilityService.recordAiCall({
      generationId: `gen_v2_lib1`,
      gameId: libGame1Id,
      gameTitleSnapshot: 'Game Đào Tạo Hội Nhập V2',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'MULTIPLE_CHOICE',
      status: 'SUCCESS',
      latencyMs: 420,
      inputTokens: 600_000,
      outputTokens: 200_000,
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 800_000,
    });
    aiObservabilityService.recordAiCall({
      generationId: `gen_v2_lib1`,
      gameId: libGame1Id,
      gameTitleSnapshot: 'Game Đào Tạo Hội Nhập V2',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'CONTENT_PROCESSING',
      gameType: 'MULTIPLE_CHOICE',
      status: 'SUCCESS',
      latencyMs: 380,
      inputTokens: 400_000,
      outputTokens: 150_588,
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 550_588,
    });

    // 2) Create TWO Library games with the EXACT SAME title ("Game Trùng Tên Thư Viện") to verify LIB-05 (never merge by title):
    const dupGameARes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Trùng Tên Thư Viện',
        gameType: 'QUICK_BUTTON',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
    assert.equal(dupGameARes.status, 200);
    const dupGameAId = dupGameARes.body.data.gameId;
    getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id = ?').run(dupGameAId);
    aiObservabilityService.recordAiCall({
      generationId: 'gen_dup_a',
      gameId: dupGameAId,
      gameTitleSnapshot: 'Game Trùng Tên Thư Viện',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'QUICK_BUTTON',
      status: 'SUCCESS',
      latencyMs: 300,
      inputTokens: 120_000,
      outputTokens: 35_000,
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 155_000,
    });

    const dupGameBRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Trùng Tên Thư Viện',
        gameType: 'QUICK_BUTTON',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
    assert.equal(dupGameBRes.status, 200);
    const dupGameBId = dupGameBRes.body.data.gameId;
    getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id = ?').run(dupGameBId);
    aiObservabilityService.recordAiCall({
      generationId: 'gen_dup_b',
      gameId: dupGameBId,
      gameTitleSnapshot: 'Game Trùng Tên Thư Viện',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'QUICK_BUTTON',
      status: 'SUCCESS',
      latencyMs: 310,
      inputTokens: 240_000,
      outputTokens: 70_000,
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 310_000,
    });

    // 3) Create a Library game with missing token usage to verify COST-08 ("Chưa xác định"):
    const unknownUsageGameRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Thiếu Dữ Liệu Token',
        gameType: 'MULTIPLE_CHOICE',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
    assert.equal(unknownUsageGameRes.status, 200);
    const unknownUsageGameId = unknownUsageGameRes.body.data.gameId;
    getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id = ?').run(unknownUsageGameId);
    aiObservabilityService.recordAiCall({
      generationId: 'gen_unknown_lib',
      gameId: unknownUsageGameId,
      gameTitleSnapshot: 'Game Thiếu Dữ Liệu Token',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'MULTIPLE_CHOICE',
      status: 'SUCCESS',
      latencyMs: 250,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });

    // 3b) Create a Library game that mirrors real Production/Local SQLite data:
    //     1 SUCCESS GENERATE_QUESTIONS call on gemini-2.5-flash + 1 FAILED GENERATE_COVER_IMAGE call on gemini-3.1-flash-image (null tokens).
    //     Must display exact Tiền Input, Tiền Output, Tổng cộng and NEVER be poisoned into "Chưa xác định"!
    const realPatternGameRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Thực Tế Có Ảnh Bìa Lỗi',
        gameType: 'ADVENTURE',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
    assert.equal(realPatternGameRes.status, 200);
    const realPatternGameId = realPatternGameRes.body.data.gameId;
    getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id = ?').run(realPatternGameId);
    aiObservabilityService.recordAiCall({
      generationId: 'gen_real_q',
      gameId: realPatternGameId,
      gameTitleSnapshot: 'Game Thực Tế Có Ảnh Bìa Lỗi',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'ADVENTURE',
      status: 'SUCCESS',
      latencyMs: 420,
      inputTokens: 200_000, // 200k * $0.30/1M * 25500 = 1.530 ₫
      outputTokens: 60_000, // 60k * $2.50/1M * 25500 = 3.825 ₫
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 260_000,
    });
    aiObservabilityService.recordAiCall({
      generationId: 'gen_real_img_fail',
      gameId: realPatternGameId,
      gameTitleSnapshot: 'Game Thực Tế Có Ảnh Bìa Lỗi',
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
      operation: 'GENERATE_COVER_IMAGE',
      taskType: 'COVER_IMAGE_GENERATION',
      gameType: 'ADVENTURE',
      status: 'FAILED',
      errorCode: 'GEMINI_IMAGE_ERROR',
      latencyMs: 180,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });

    // 3c) Create a Library game with true 0 tokens (0 ₫ vs Chưa xác định - Section 12 Case 10):
    const zeroTokenGameRes = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceId: sampleSourceId,
        title: 'Game Không Tốn Token',
        gameType: 'QUICK_BUTTON',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
    assert.equal(zeroTokenGameRes.status, 200);
    const zeroTokenGameId = zeroTokenGameRes.body.data.gameId;
    getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id = ?').run(zeroTokenGameId);
    aiObservabilityService.recordAiCall({
      generationId: 'gen_zero_tok',
      gameId: zeroTokenGameId,
      gameTitleSnapshot: 'Game Không Tốn Token',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'GENERATE_QUESTIONS',
      taskType: 'QUESTION_GENERATION',
      gameType: 'QUICK_BUTTON',
      status: 'SUCCESS',
      latencyMs: 100,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
    });

    // 4) Record an orphan AI task (no gameId -> "Tác vụ AI lẻ (...)") to verify LIB-02:
    aiObservabilityService.recordAiCall({
      generationId: null,
      gameId: null,
      gameTitleSnapshot: null,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'EXTRACT_DOCUMENT',
      taskType: 'CONTENT_PROCESSING',
      status: 'SUCCESS',
      latencyMs: 200,
      inputTokens: 50_000,
      outputTokens: 5_000,
      totalTokens: 55_000,
    });

    // 5) Note: `game_scale_1`, `game_scale_2`, `game_unreported` were seeded without rows in `games` table,
    //    so they have `isSavedInLibrary === false` (unsaved/deleted games) and verify LIB-03 & LIB-04!

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;

    const browser = await Browser.launch({ width: 1440, height: 950 });
    const page = await browser.newPage({ width: 1440, height: 950 });

    try {
      // 1. Open Home page on localhost with ZERO auth tokens
      await page.goto(`${baseUrl}/`);
      await sleep(1000);

      // Check Home page layout first (LAYOUT-05: other pages unaffected)
      const homeLayoutCheck = await page.eval(`(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))()`);
      assert.ok(homeLayoutCheck.scrollWidth <= homeLayoutCheck.innerWidth + 1);

      // 2. Verify Sidebar order: Tạo game bằng AI, Trang Chủ, Khám phá, Thư viện, Thống kê, Admin, Nhập mã PIN
      const sidebarItems = await page.eval(`(() => {
        window.__SPA_MARKER__ = 'NO_RELOAD_MARKER_123';
        const aside = document.querySelector('aside.app-layout-left-nav');
        if (!aside) return [];
        const buttons = Array.from(aside.querySelectorAll('#nav-cta-create-game, nav button'));
        return buttons.map((b) => ({
          id: b.id,
          text: (b.textContent || '').trim(),
        }));
      })()`);

      assert.deepEqual(
        sidebarItems.map((i: any) => i.text),
        [
          'Tạo game bằng AI',
          'Trang Chủ',
          'Khám phá',
          'Thư viện',
          'Thống kê',
          'Admin',
          'Nhập mã PIN',
        ],
        'Sidebar must include Admin right below Thống kê and above Nhập mã PIN'
      );

      // 3. UI-01: Click Admin in Sidebar -> client-side navigation to /?tab=admin without page reload
      await page.eval(`(() => {
        const btn = document.querySelector('#nav-item-admin');
        if (btn) btn.click();
      })()`);
      await sleep(1200);

      const desktopState = await page.eval(`(() => {
        const bodyText = document.body.innerText;
        const activeTabEl = document.querySelector('[role="tab"][aria-selected="true"]');
        const adminNavBtn = document.querySelector('#nav-item-admin');
        const sidebarEl = document.querySelector('aside.app-layout-left-nav');
        const mainEl = document.querySelector('main.app-main-content-with-nav');
        const adminContainerEl = document.querySelector('[data-testid="admin-page-container"]');

        const sidebarRect = sidebarEl ? sidebarEl.getBoundingClientRect() : null;
        const mainRect = mainEl ? mainEl.getBoundingClientRect() : null;
        const adminRect = adminContainerEl ? adminContainerEl.getBoundingClientRect() : null;
        const adminComputed = adminContainerEl ? window.getComputedStyle(adminContainerEl) : null;

        const headerTitle = (document.querySelector('[data-testid="ai-cost-header-title"]')?.textContent || '').trim();
        const headerSubtitle = (document.querySelector('[data-testid="ai-cost-header-subtitle"]')?.textContent || '').trim();
        const filterButtons = Array.from(document.querySelectorAll('[data-testid="ai-cost-time-filter-group"] button')).map((b) => ({
          text: (b.textContent || '').trim(),
          pressed: b.getAttribute('aria-pressed'),
        }));
        const exportBtnText = (document.querySelector('[data-testid="admin-export-ai-cost-excel-btn"]')?.textContent || '').trim();
        const kpiCards = Array.from(document.querySelectorAll('[data-testid="ai-cost-kpi-grid"] > div')).map((c) => (c.textContent || '').trim());

        const tableHeading = (document.querySelector('[data-testid="ai-cost-per-game-heading"]')?.textContent || '').trim();
        const tableDescription = (document.querySelector('[data-testid="ai-cost-per-game-description"]')?.textContent || '').trim();
        const tableHeaders = Array.from(document.querySelectorAll('[data-testid="ai-cost-per-game-table"] thead th')).map((th) => (th.textContent || '').trim());
        const gameRows = Array.from(document.querySelectorAll('[data-testid="ai-cost-game-row"]')).map((tr) => ({
          gameId: tr.getAttribute('data-game-id') || '',
          cells: Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim()),
        }));

        const accordionEl = document.querySelector('[data-testid="ai-cost-tech-accordion"]');
        const accordionToggle = document.querySelector('[data-testid="ai-cost-tech-accordion-toggle"]');
        const accordionContent = document.querySelector('[data-testid="ai-cost-tech-accordion-content"]');

        return {
          url: window.location.href,
          spaMarker: window.__SPA_MARKER__,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          sidebarRight: sidebarRect ? sidebarRect.right : 0,
          mainWidth: mainRect ? mainRect.width : 0,
          adminLeft: adminRect ? adminRect.left : 0,
          adminWidth: adminRect ? adminRect.width : 0,
          adminMaxWidth: adminComputed ? adminComputed.maxWidth : '',
          hasBlockedScreen: bodyText.includes('Khu Vực Quản Trị Hệ Thống'),
          hasDemoBadge: bodyText.includes('Chế độ Demo Local'),
          activeTabText: (activeTabEl?.textContent || '').trim(),
          adminNavFontWeight: adminNavBtn ? window.getComputedStyle(adminNavBtn).fontWeight : '',
          headerTitle,
          headerSubtitle,
          filterButtons,
          exportBtnText,
          kpiCount: kpiCards.length,
          kpiCards,
          tableHeading,
          tableDescription,
          tableHeaders,
          gameRows,
          hasTechAccordion: Boolean(accordionEl || accordionToggle || accordionContent),
          hasTechHeadingText: bodyText.includes('Thông tin kỹ thuật (token, giá model, chi tiết API)'),
        };
      })()`);

      assert.equal(desktopState.spaMarker, 'NO_RELOAD_MARKER_123', 'Must navigate client-side without full page reload');
      assert.ok(desktopState.url.endsWith('/?tab=admin'), 'URL must update to /?tab=admin');
      assert.equal(desktopState.hasBlockedScreen, false);
      assert.equal(desktopState.hasDemoBadge, true);
      assert.equal(desktopState.activeTabText, 'Chi phí sử dụng AI');
      assert.equal(desktopState.adminNavFontWeight, '800');

      // LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04: Full width right of Sidebar, no 1100px cap, no overlap, no horizontal scroll
      assert.equal(desktopState.adminMaxWidth, 'none', 'LAYOUT-02: Admin container must not have max-width: 1100px');
      assert.ok(
        desktopState.adminWidth >= desktopState.mainWidth - 2 && desktopState.adminWidth > 1180,
        `LAYOUT-01: Admin container must fill full width right of Sidebar (adminWidth=${desktopState.adminWidth}, mainWidth=${desktopState.mainWidth})`
      );
      assert.ok(
        desktopState.adminLeft >= desktopState.sidebarRight - 1,
        `LAYOUT-03: Admin container must not overlap Sidebar (adminLeft=${desktopState.adminLeft}, sidebarRight=${desktopState.sidebarRight})`
      );
      assert.ok(
        desktopState.scrollWidth <= desktopState.innerWidth + 1,
        `LAYOUT-04: Must not cause horizontal page scroll (scrollWidth=${desktopState.scrollWidth}, innerWidth=${desktopState.innerWidth})`
      );

      // UI-02, UI-03, UI-04: 4 KPIs, 3 time filters, Export Excel button
      assert.equal(desktopState.headerTitle, 'Chi phí sử dụng AI');
      assert.equal(desktopState.headerSubtitle, 'Theo dõi chi phí tạo game');
      assert.deepEqual(desktopState.filterButtons, [
        { text: '7 ngày', pressed: 'false' },
        { text: 'Tháng này', pressed: 'true' },
        { text: 'Tất cả', pressed: 'false' },
      ]);
      assert.equal(desktopState.exportBtnText, 'Xuất Excel');
      assert.equal(desktopState.kpiCount, 4);
      assert.ok(desktopState.kpiCards[0].includes('Game đã tạo'));
      assert.ok(desktopState.kpiCards[1].includes('Tổng chi phí AI quy đổi'));
      assert.ok(desktopState.kpiCards[1].includes('₫'));
      assert.ok(desktopState.kpiCards[2].includes('Trung bình / game'));
      assert.ok(desktopState.kpiCards[2].includes('₫'));
      assert.ok(desktopState.kpiCards[3].includes('Token đã dùng'));

      // UI-05: Section "Thông tin kỹ thuật" is completely deleted
      assert.equal(desktopState.hasTechAccordion, false, 'UI-05: Tech accordion DOM elements must be completely removed');
      assert.equal(desktopState.hasTechHeadingText, false, 'UI-05: Tech accordion text must not appear on screen');

      // UI-06 & COST-01: Table has strictly 6 columns and NO "Model AI" column
      assert.equal(desktopState.tableHeading, 'Chi phí các game trong Thư viện');
      assert.equal(desktopState.tableDescription, 'Chi tiết token và chi phí AI của từng game đã lưu.');
      assert.deepEqual(
        desktopState.tableHeaders,
        ['Tên game', 'Token Input', 'Token Output', 'Tiền Input', 'Tiền Output', 'Tổng cộng'],
        'COST-01 & UI-06: Table must have strictly 6 columns without Model AI'
      );
      assert.ok(!desktopState.tableHeaders.includes('Model AI'));

      // LIB-01, LIB-02, LIB-03, LIB-04: Only saved Library games appear in the table
      const rowTitles = desktopState.gameRows.map((r: any) => r.cells[0]);
      assert.ok(rowTitles.includes('Game Đào Tạo Hội Nhập V2'), 'LIB-01: Saved Library game must appear');
      assert.ok(!rowTitles.some((t: string) => t.includes('Tác vụ AI lẻ')), 'LIB-02: Orphan AI tasks must NOT appear');
      assert.ok(!rowTitles.includes('Game Đào Tạo Chuẩn A'), 'LIB-03: Unsaved game must NOT appear');
      assert.ok(!rowTitles.includes('Game Đi Cảnh Nhiều Request AI'), 'LIB-04: Deleted game must NOT appear');

      // LIB-05: Duplicate-titled games in Library must NOT be merged into 1 row
      const dupRows = desktopState.gameRows.filter((r: any) => r.cells[0] === 'Game Trùng Tên Thư Viện');
      assert.equal(dupRows.length, 2, 'LIB-05: Two saved games with the same title must render as 2 separate rows');
      assert.notEqual(dupRows[0].gameId, dupRows[1].gameId, 'LIB-05: Each row must link to its distinct gameId');

      // COST-02..COST-07 & COST-09: Verify exact token & VND cost columns for multi-request Library game ("Game Đào Tạo Hội Nhập V2")
      const lib1Row = desktopState.gameRows.find((r: any) => r.gameId === libGame1Id);
      assert.ok(lib1Row, 'Must find Game Đào Tạo Hội Nhập V2 row by gameId');
      assert.deepEqual(
        lib1Row.cells,
        [
          'Game Đào Tạo Hội Nhập V2',
          '1.000.000', // Token Input (600k + 400k)
          '350.588',   // Token Output (200k + 150,588)
          '7.650 ₫',   // Tiền Input
          '22.350 ₫',  // Tiền Output
          '30.000 ₫',  // Tổng cộng
        ],
        'COST-02..COST-07: Multi-request Library game must aggregate Input/Output tokens and VND costs accurately'
      );

      // Verify duplicate Game A (120.000 in -> 918 ₫, 35.000 out -> 2.231 ₫, Tổng cộng -> 3.149 ₫)
      const dupRowA = desktopState.gameRows.find((r: any) => r.gameId === dupGameAId);
      assert.ok(dupRowA);
      assert.deepEqual(dupRowA.cells, [
        'Game Trùng Tên Thư Viện',
        '120.000',
        '35.000',
        '918 ₫',
        '2.231 ₫',
        '3.149 ₫',
      ]);

      // COST-08: Verify Library game with missing token usage shows "Chưa xác định" and never fake 0 ₫
      const unknownRow = desktopState.gameRows.find((r: any) => r.gameId === unknownUsageGameId);
      assert.ok(unknownRow);
      assert.deepEqual(
        unknownRow.cells,
        [
          'Game Thiếu Dữ Liệu Token',
          'Chưa xác định',
          'Chưa xác định',
          'Chưa xác định',
          'Chưa xác định',
          'Chưa xác định',
        ],
        'COST-08: Missing usage/pricing must show Chưa xác định instead of 0 ₫'
      );

      // Section 12 Case 2: Game with 1 SUCCESS question generation + 1 FAILED cover image call (gemini-3.1-flash-image, null tokens)
      // must display exact Tiền Input (1.530 ₫), Tiền Output (3.825 ₫), Tổng cộng (5.355 ₫) and NEVER "Chưa xác định"
      const realPatternRow = desktopState.gameRows.find((r: any) => r.gameId === realPatternGameId);
      assert.ok(realPatternRow, 'Must find Game Thực Tế Có Ảnh Bìa Lỗi row');
      assert.deepEqual(
        realPatternRow.cells,
        [
          'Game Thực Tế Có Ảnh Bìa Lỗi',
          '200.000',
          '60.000',
          '1.530 ₫',
          '3.825 ₫',
          '5.355 ₫',
        ],
        'Failed auxiliary image request with null tokens must not poison Tiền Input / Tiền Output into Chưa xác định'
      );

      // Section 12 Case 10: Game with true 0 tokens must display "0 ₫" and NOT "Chưa xác định"
      const zeroTokenRow = desktopState.gameRows.find((r: any) => r.gameId === zeroTokenGameId);
      assert.ok(zeroTokenRow, 'Must find Game Không Tốn Token row');
      assert.deepEqual(
        zeroTokenRow.cells,
        [
          'Game Không Tốn Token',
          '0',
          '0',
          '0 ₫',
          '0 ₫',
          '0 ₫',
        ],
        'True zero-token game must display 0 ₫ instead of Chưa xác định'
      );

      const artifactDir = 'C:\\Users\\QUOC SIEU\\.gemini\\antigravity\\brain\\83ff8c51-8136-444f-904b-1284fcdde2fb';
      if (fs.existsSync(artifactDir)) {
        const desktopBuf = await page.screenshot({ fullPage: false });
        fs.writeFileSync(
          path.join(artifactDir, 'v3_redesigned_ai_cost_v2_desktop_1440x900.png'),
          desktopBuf
        );
      }

      // UI-03: Test switching filters (7 ngày -> Tất cả -> Tháng này)
      await page.eval(`(() => {
        const btn7d = document.querySelector('[data-testid="cost-preset-last_7_days"]');
        if (btn7d) btn7d.click();
      })()`);
      await sleep(600);
      const filter7dPressed = await page.eval(`document.querySelector('[data-testid="cost-preset-last_7_days"]')?.getAttribute('aria-pressed')`);
      assert.equal(filter7dPressed, 'true');

      await page.eval(`(() => {
        const btnAll = document.querySelector('[data-testid="cost-preset-all"]');
        if (btnAll) btnAll.click();
      })()`);
      await sleep(600);
      const filterAllPressed = await page.eval(`document.querySelector('[data-testid="cost-preset-all"]')?.getAttribute('aria-pressed')`);
      assert.equal(filterAllPressed, 'true');

      // LAYOUT-06: Test all 6 mandatory viewports (1920px, 1440px, 1024px, 768px, 390px, 360px)
      for (const vp of [
        { width: 1920, height: 1080, isMobile: false },
        { width: 1440, height: 900, isMobile: false },
        { width: 1024, height: 768, isMobile: false },
        { width: 768, height: 1024, isMobile: true },
        { width: 390, height: 844, isMobile: true },
        { width: 360, height: 800, isMobile: true },
      ]) {
        await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile, hasTouch: vp.isMobile });
        await sleep(350);
        const vpCheck = await page.eval(`(() => {
          const adminEl = document.querySelector('[data-testid="admin-page-container"]');
          const mainEl = document.querySelector('main.app-main-content-with-nav');
          const adminRect = adminEl ? adminEl.getBoundingClientRect() : null;
          const mainRect = mainEl ? mainEl.getBoundingClientRect() : null;
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            adminWidth: adminRect ? adminRect.width : 0,
            mainWidth: mainRect ? mainRect.width : 0,
            hasKpiGrid: Boolean(document.querySelector('[data-testid="ai-cost-kpi-grid"]')),
            hasTable: Boolean(document.querySelector('[data-testid="ai-cost-per-game-table"]')),
            hasExportBtn: Boolean(document.querySelector('[data-testid="admin-export-ai-cost-excel-btn"]')),
            hasTechAccordion: Boolean(document.querySelector('[data-testid="ai-cost-tech-accordion"]')),
          };
        })()`);
        assert.ok(
          vpCheck.scrollWidth <= vpCheck.innerWidth + 1,
          `Viewport ${vp.width}x${vp.height} must not overflow horizontally (scrollWidth=${vpCheck.scrollWidth}, innerWidth=${vpCheck.innerWidth})`
        );
        assert.ok(
          vpCheck.adminWidth >= vpCheck.mainWidth - 2,
          `Viewport ${vp.width}x${vp.height} Admin container must fill main content width (adminWidth=${vpCheck.adminWidth}, mainWidth=${vpCheck.mainWidth})`
        );
        assert.equal(vpCheck.hasKpiGrid, true);
        assert.equal(vpCheck.hasTable, true);
        assert.equal(vpCheck.hasExportBtn, true);
        assert.equal(vpCheck.hasTechAccordion, false);

        if (vp.width === 1920 && fs.existsSync(artifactDir)) {
          const wideBuf = await page.screenshot({ fullPage: false });
          fs.writeFileSync(
            path.join(artifactDir, 'v3_redesigned_ai_cost_v2_desktop_1920x1080.png'),
            wideBuf
          );
        }
        if (vp.width === 390 && fs.existsSync(artifactDir)) {
          const mobileBuf = await page.screenshot({ fullPage: false });
          fs.writeFileSync(
            path.join(artifactDir, 'v3_redesigned_ai_cost_v2_mobile_390x844.png'),
            mobileBuf
          );
        }
      }

      // LIB-06: Verify Empty State when no Library games have AI cost data in the period
      getDatabase().prepare('DELETE FROM ai_usage_logs WHERE game_id IS NOT NULL').run();
      await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
      await page.eval(`(() => {
        const btnThisMonth = document.querySelector('[data-testid="cost-preset-this_month"]');
        if (btnThisMonth) btnThisMonth.click();
      })()`);
      await sleep(700);
      const emptyStateText = await page.eval(
        `(document.querySelector('[data-testid="ai-cost-per-game-empty"]')?.textContent || '').trim()`
      );
      assert.equal(
        emptyStateText,
        'Chưa có game nào trong Thư viện có dữ liệu chi phí AI ở khoảng thời gian này.',
        'LIB-06: Empty state must display exact message when no Library games exist in the selected period'
      );

      // =========================================================================
      // BROWSER E2E VERIFICATION FOR TASK A: DELETE ALL GAMES WITHOUT LOGIN
      // (Section 11 Cases 1, 2, 3, 4, 5, 11)
      // =========================================================================
      resetAllRateLimiters();
      const unauthIngestRes = await request(app)
        .post('/api/content/ingest')
        .attach(
          'files',
          Buffer.from(
            'Tài liệu đào tạo không đăng nhập: Quy tắc an toàn lao động và phòng cháy chữa cháy tại nơi làm việc.',
            'utf-8'
          ),
          'unauth_doc.txt'
        );
      assert.equal(unauthIngestRes.status, 200);
      const unauthSourceId = unauthIngestRes.body.data.sources[0].sourceId;

      // Create 2 unauthenticated Creator games (no Authorization header)
      const unauthGame1Res = await request(app).post('/api/games/generate').send({
        sourceId: unauthSourceId,
        title: 'Game Không Đăng Nhập 1',
        gameType: 'MULTIPLE_CHOICE',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
      assert.equal(unauthGame1Res.status, 200);
      const unauthGame1Id = unauthGame1Res.body.data.gameId;

      const unauthGame2Res = await request(app).post('/api/games/generate').send({
        sourceId: unauthSourceId,
        title: 'Game Không Đăng Nhập 2',
        gameType: 'QUICK_BUTTON',
        sessionMode: 'PLAY',
        questionCount: 2,
      });
      assert.equal(unauthGame2Res.status, 200);
      const unauthGame2Id = unauthGame2Res.body.data.gameId;

      // Navigate to Thư viện (/?tab=library) without any login/auth token
      await page.goto(`${baseUrl}/?tab=library`);
      await sleep(1200);

      const libBeforeDelete = await page.eval(`(() => {
        const btn = document.querySelector('[data-testid="library-delete-all-btn"]');
        const bodyText = document.body.innerText;
        return {
          hasBtn: Boolean(btn),
          disabled: btn ? btn.hasAttribute('disabled') : true,
          hasGame1: bodyText.includes('Game Không Đăng Nhập 1'),
          hasGame2: bodyText.includes('Game Không Đăng Nhập 2'),
        };
      })()`);
      assert.equal(libBeforeDelete.hasBtn, true, 'Delete All button must exist in Library without login');
      assert.equal(libBeforeDelete.disabled, false, 'Delete All button must be enabled when unowned games exist');
      assert.equal(libBeforeDelete.hasGame1, true);
      assert.equal(libBeforeDelete.hasGame2, true);

      // Case 1: Click "Xóa tất cả" -> Confirmation modal opens
      await page.eval(`document.querySelector('[data-testid="library-delete-all-btn"]')?.click()`);
      await sleep(400);

      const modalState = await page.eval(`(() => {
        const modal = document.querySelector('[data-testid="delete-all-confirm-modal"]');
        const countEl = document.querySelector('[data-testid="delete-all-game-count"]');
        const cancelBtn = document.querySelector('[data-testid="cancel-delete-all-btn"]');
        const confirmBtn = document.querySelector('[data-testid="confirm-delete-all-btn"]');
        return {
          isOpen: Boolean(modal),
          modalText: modal ? modal.innerText : '',
          countText: countEl ? (countEl.textContent || '').trim() : '',
          cancelText: cancelBtn ? (cancelBtn.textContent || '').trim() : '',
          confirmText: confirmBtn ? (confirmBtn.textContent || '').trim() : '',
        };
      })()`);
      assert.equal(modalState.isOpen, true, 'Case 1: Confirmation modal must appear on click');
      assert.equal(modalState.countText, '2 bộ câu hỏi', 'Modal must show exact game count in current Library scope');
      assert.ok(modalState.modalText.includes('không thể hoàn tác'), 'Modal must warn that deletion cannot be undone');
      assert.equal(modalState.cancelText, 'Hủy');
      assert.equal(modalState.confirmText, 'Xác nhận xóa tất cả');

      if (fs.existsSync(artifactDir)) {
        const modalBuf = await page.screenshot({ fullPage: false });
        fs.writeFileSync(
          path.join(artifactDir, 'v3_library_delete_all_modal_no_login.png'),
          modalBuf
        );
      }

      // Case 2: Click "Hủy" -> Modal closes and NO games are deleted
      await page.eval(`document.querySelector('[data-testid="cancel-delete-all-btn"]')?.click()`);
      await sleep(400);
      const afterCancel = await page.eval(`(() => ({
        isOpen: Boolean(document.querySelector('[data-testid="delete-all-confirm-modal"]')),
        hasGame1: document.body.innerText.includes('Game Không Đăng Nhập 1'),
        hasGame2: document.body.innerText.includes('Game Không Đăng Nhập 2'),
      }))()`);
      assert.equal(afterCancel.isOpen, false, 'Case 2: Modal must close after clicking Hủy');
      assert.equal(afterCancel.hasGame1, true, 'Case 2: Games must remain intact after cancel');
      assert.equal(afterCancel.hasGame2, true);

      // Case 3: Click "Xóa tất cả" -> Click "Xác nhận xóa tất cả" -> Games deleted immediately without F5
      await page.eval(`document.querySelector('[data-testid="library-delete-all-btn"]')?.click()`);
      await sleep(300);
      await page.eval(`document.querySelector('[data-testid="confirm-delete-all-btn"]')?.click()`);
      await sleep(1000);

      const afterConfirm = await page.eval(`(() => {
        const btn = document.querySelector('[data-testid="library-delete-all-btn"]');
        const bodyText = document.body.innerText;
        return {
          isOpen: Boolean(document.querySelector('[data-testid="delete-all-confirm-modal"]')),
          btnDisabled: btn ? btn.hasAttribute('disabled') : false,
          hasGame1: bodyText.includes('Game Không Đăng Nhập 1'),
          hasGame2: bodyText.includes('Game Không Đăng Nhập 2'),
          hasUnauthorizedError: bodyText.includes('Vui lòng đăng nhập') || bodyText.includes('UNAUTHORIZED'),
        };
      })()`);
      assert.equal(afterConfirm.isOpen, false);
      assert.equal(afterConfirm.hasUnauthorizedError, false, 'Case 3: Must NOT require login to delete all');
      assert.equal(afterConfirm.hasGame1, false, 'Case 3: Game 1 must be removed immediately from UI');
      assert.equal(afterConfirm.hasGame2, false, 'Case 3: Game 2 must be removed immediately from UI');
      assert.equal(afterConfirm.btnDisabled, true, 'Case 5: Delete All button must be disabled when Library is empty');
      assert.equal(gameStore.get(unauthGame1Id), undefined);
      assert.equal(gameStore.get(unauthGame2Id), undefined);

      // Case 11: Verify authenticated User's games (libGame1Id, dupGameAId, dupGameBId) were NEVER deleted by the unauthenticated Creator!
      assert.ok(gameStore.get(libGame1Id), 'Case 11: Authenticated user game must remain untouched');

      // Case 4: Refresh page -> Deleted games do NOT reappear
      await page.goto(`${baseUrl}/?tab=library`);
      await sleep(1000);
      const afterRefresh = await page.eval(`(() => {
        const btn = document.querySelector('[data-testid="library-delete-all-btn"]');
        const bodyText = document.body.innerText;
        return {
          btnDisabled: btn ? btn.hasAttribute('disabled') : false,
          hasGame1: bodyText.includes('Game Không Đăng Nhập 1'),
          hasGame2: bodyText.includes('Game Không Đăng Nhập 2'),
        };
      })()`);
      assert.equal(afterRefresh.hasGame1, false, 'Case 4: Game 1 must not reappear after refresh');
      assert.equal(afterRefresh.hasGame2, false, 'Case 4: Game 2 must not reappear after refresh');
      assert.equal(afterRefresh.btnDisabled, true, 'Case 5: Delete All button remains disabled on empty Library');

      // =========================================================================
      // HOTFIX VERIFICATION: ADMIN SIDEBAR & PAGE IN PRODUCTION BUILD + NODE_ENV=production
      // =========================================================================
      const prevNodeEnvProdCheck = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await page.goto(`${baseUrl}/`);
        await sleep(900);

        const prodSidebarState = await page.eval(`(() => {
          const aside = document.querySelector('aside.app-layout-left-nav');
          const buttons = aside ? Array.from(aside.querySelectorAll('#nav-cta-create-game, nav button')) : [];
          return {
            items: buttons.map((b) => (b.textContent || '').trim()),
            hasAdminBtn: Boolean(document.querySelector('#nav-item-admin')),
          };
        })()`);
        assert.equal(prodSidebarState.hasAdminBtn, true, 'Admin item must appear in Sidebar on Production build');
        assert.deepEqual(prodSidebarState.items, [
          'Tạo game bằng AI',
          'Trang Chủ',
          'Khám phá',
          'Thư viện',
          'Thống kê',
          'Admin',
          'Nhập mã PIN',
        ]);

        // Click Admin in Sidebar -> opens Chi phí sử dụng AI V2 and does not redirect or show blocked screen
        await page.eval(`document.querySelector('#nav-item-admin')?.click()`);
        await sleep(900);

        const prodAdminPageState = await page.eval(`(() => ({
          url: window.location.href,
          hasCostPanel: Boolean(document.querySelector('[data-testid="admin-ai-cost-panel"]')),
          headerTitle: (document.querySelector('[data-testid="ai-cost-header-title"]')?.textContent || '').trim(),
          hasBlockedScreen: document.body.innerText.includes('Khu Vực Quản Trị Hệ Thống'),
        }))()`);
        assert.ok(prodAdminPageState.url.endsWith('/?tab=admin'), 'Must stay on /?tab=admin without redirecting away');
        assert.equal(prodAdminPageState.hasBlockedScreen, false, 'Must not show blocked screen when clicking Admin');
        assert.equal(prodAdminPageState.hasCostPanel, true, 'Must render V2 AI Cost dashboard panel');
        assert.equal(prodAdminPageState.headerTitle, 'Chi phí sử dụng AI');
      } finally {
        process.env.NODE_ENV = prevNodeEnvProdCheck;
      }
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
