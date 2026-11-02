import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import supertest from 'supertest';
import * as XLSX from 'xlsx';
import { app } from '../src/app.js';
import { LIMITS } from '../src/config/limits.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { provisionAdventureAssetsForGame } from '../src/services/adventure-asset-pack.service.js';
import { AiImageService, ImageGenerationProvider } from '../src/services/ai.image.service.js';
import { aiObservabilityService } from '../src/services/ai.observability.service.js';
import { AiModelProvider, AiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { sourceStore } from '../src/storage/source.store.js';
import { closeDatabase, getDatabase, initDatabase } from '../src/storage/sqlite.db.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const ARTIFACT_DIR = 'C:\\Users\\QUOC SIEU\\.gemini\\antigravity\\brain\\83ff8c51-8136-444f-904b-1284fcdde2fb';

// Deterministic 64x64 valid PNG buffer (> 512 bytes for Adventure asset inspection)
function createDeterministicPngBuffer(): Buffer {
  // Valid PNG signature + IHDR (64x64) + IDAT + IEND padded safely above 600 bytes
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(64, 0); // width 64
  ihdrData.writeUInt32BE(64, 4); // height 64
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrCrc = Buffer.alloc(4);

  const idatPayload = Buffer.alloc(600, 0x42);
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(idatPayload.length, 0);
  const idatType = Buffer.from('IDAT', 'ascii');
  const idatCrc = Buffer.alloc(4);

  const iendLen = Buffer.alloc(4);
  const iendType = Buffer.from('IEND', 'ascii');
  const iendCrc = Buffer.alloc(4);

  return Buffer.concat([
    sig,
    ihdrLen,
    ihdrType,
    ihdrData,
    ihdrCrc,
    idatLen,
    idatType,
    idatPayload,
    idatCrc,
    iendLen,
    iendType,
    iendCrc,
  ]);
}

describe('FINAL P2/P3 BUG FIXES VERIFICATION (AUD-007 .. AUD-015)', () => {
  let tempDbPath: string;
  let tempDir: string;
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let baseUrl: string;

  let adminToken: string;
  let adminUser: any;
  let hostRoomCode: string;
  let hostToken: string;
  let adventureRedGameId: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_game_p2_p3_fix_'));
    tempDbPath = path.join(tempDir, 'test_p2_p3.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();

    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Register & promote Admin user
    const reg = authService.register({
      email: 'admin_p2p3@matbao.ws',
      password: 'Password123!',
      displayName: 'Admin P2 P3 Verification',
    });
    const db = getDatabase();
    db.prepare(`UPDATE users SET role = 'ADMIN' WHERE user_id = ?`).run(reg.user.userId);
    const login = authService.login({
      email: 'admin_p2p3@matbao.ws',
      password: 'Password123!',
    });
    adminToken = login.token;
    adminUser = login.user;

    // Seed long-title game for HostPage mobile overflow check (AUD-007)
    const longTitleSpec: GameSpecification = {
      gameId: 'game_p2_long_host',
      ownerUserId: adminUser.userId,
      isPublic: true,
      title:
        'SUPERLONGUNBREAKABLEGAMETITLE_KIEM_TRA_TRAN_MAN_HINH_MOBILE_360X800_VA_390X844_HOST_PANEL',
      description: 'Kiểm thử responsive trên màn hình dọc nhỏ 360x800 và 390x844',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: 'q_host_1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu hỏi kiểm tra hiển thị bảng điều khiển Host trên thiết bị di động?',
          choices: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
          correctAnswer: 'Phương án A',
          explanation: 'Giải thích câu 1.',
          difficulty: 'MEDIUM',
          timeLimitSeconds: 20,
          points: 1000,
          sourceReference: {
            sourceId: 'src_p2',
            sourceType: 'TXT',
            sourceLocation: 'manual.txt',
          },
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'EXAM',
        rosterMode: 'PRECONFIGURED',
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_p2',
            sourceType: 'TXT',
            sourceName: 'manual.txt',
            sourceLocation: 'manual.txt',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(longTitleSpec);

    persistenceRepo.upsertParticipants(longTitleSpec.gameId, [
      {
        fullName: 'Nguyễn Văn Thí Sinh Một',
        departmentUnit: 'Phòng Kỹ Thuật Phần Mềm Điện Toán Đám Mây',
        employeeCode: 'NV001',
        allowedAttempts: 1,
      },
    ]);

    const createdRoom = roomService.createRoom(longTitleSpec, 50, adminUser.userId);
    hostRoomCode = createdRoom.roomCode;
    hostToken = createdRoom.hostToken;

    // Seed Adventure game with bright red accentHex (#EF4444 in MOTORCYCLE_TRAFFIC) to test Light Mode & WCAG button contrast (AUD-009)
    const advSeedProvider: AiModelProvider = {
      generateJson: async () => ({
        title: 'Hành Trình An Toàn Giao Thông Light Mode',
        questions: [
          {
            id: 'q_adv_1',
            type: 'MULTIPLE_CHOICE',
            question: 'Khi gặp đèn tín hiệu giao thông chuyển sang màu đỏ, người lái xe phải làm gì?',
            choices: [
              'Dừng lại trước vạch dừng quy định',
              'Tăng tốc vượt qua ngã tư',
              'Bấm còi liên tục để đi tiếp',
              'Đi lên vỉa hè',
            ],
            correctAnswer: 'Dừng lại trước vạch dừng quy định',
            explanation: 'Phải dừng trước vạch dừng khi đèn đỏ.',
            difficulty: 'MEDIUM',
          },
        ],
      }),
    };
    const advSeedService = new AiQuestionService(advSeedProvider);
    const generatedAdvSpec = await advSeedService.generateGame(
      [
        {
          sourceId: 'src_p2_adv',
          sourceType: 'TXT',
          sourceName: 'traffic.txt',
          sourceLocation: 'traffic.txt',
          title: 'Luật Giao Thông Đường Bộ',
          text: 'Tài liệu đào tạo lái xe mô tô an toàn và xử lý tình huống giao thông.',
          sections: [],
          extractedItems: [],
          metadata: { wordCount: 20, charCount: 100 },
        },
      ],
      {
        title: 'Hành Trình An Toàn Giao Thông Light Mode',
        gameType: 'ADVENTURE',
        industryId: 'MOTORCYCLE_TRAFFIC',
        questionCount: 1,
        difficulty: 'MEDIUM',
        timePerQuestion: 30,
        scoringMode: 'SPEED_BONUS',
      },
      { userId: adminUser.userId, skipObservabilityLog: true }
    );
    const provisionedAdv = await provisionAdventureAssetsForGame(generatedAdvSpec);
    adventureRedGameId = provisionedAdv.specification.gameId;
    gameStore.save(
      { ...provisionedAdv.specification, isPublic: true },
      Date.now(),
      adminUser.userId,
      true
    );
  });

  after(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    sourceStore.clear();
    gameStore.clear();
    sessionStore.clear();
    roomStore.clear();
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it('AUD-014 & AUD-015: AI Usage Observability records game_id, asset_slot, distinct operations, null-safe tokens/cost, and exports CSV/XLSX', async () => {
    const pngBase64 = createDeterministicPngBuffer().toString('base64');

    // 1. Question generation records GENERATE_QUESTIONS + game_id
    const mockQuestionProvider: AiModelProvider = {
      generateJson: async () => ({
        title: 'Game Kiểm Thử AI Log',
        questions: [
          {
            id: 'q1',
            type: 'MULTIPLE_CHOICE',
            question: '=SUM(1,2) Câu hỏi kiểm thử chống Formula Injection trong log?',
            choices: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'],
            correctAnswer: 'Đáp án A',
            explanation: 'Giải thích hợp lệ.',
            difficulty: 'EASY',
          },
        ],
      }),
      getLastUsageMetadata: () => ({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        inputTokens: 1200,
        outputTokens: 400,
        totalTokens: 1600,
        usageReportedByProvider: true,
      }),
    };

    const customQuestionService = new AiQuestionService(mockQuestionProvider);
    const generatedSpec = await customQuestionService.generateGame(
      [
        {
          sourceId: 'src_ai_obs',
          sourceType: 'TXT',
          sourceName: 'obs.txt',
          sourceLocation: 'obs.txt',
          title: 'Tài liệu AI Observability',
          text: 'Nội dung tài liệu kiểm thử ghi nhận log AI và gameId.',
          sections: [],
          extractedItems: [],
          metadata: { wordCount: 20, charCount: 100 },
        },
      ],
      {
        title: '=CMD|"/C calc"!A0 Game AI Observability',
        gameType: 'MULTIPLE_CHOICE',
        questionCount: 1,
        difficulty: 'EASY',
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
      },
      { userId: adminUser.userId }
    );
    gameStore.save(generatedSpec);

    // 2. Cover image generation records GENERATE_COVER_IMAGE + game_id + asset_slot='COVER' (with null tokens)
    const mockCoverProvider: ImageGenerationProvider = {
      generateImage: async () => ({
        mimeType: 'image/png',
        base64Data: pngBase64,
        usageMetadata: {
          provider: 'gemini',
          model: 'gemini-2.5-flash-image',
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          usageReportedByProvider: false,
        },
      }),
      getLastUsageMetadata: () => null,
    };

    const customImageService = new AiImageService(mockCoverProvider, path.join(tempDir, 'covers'));
    const coverRes = await customImageService.generateCoverForGame(generatedSpec, {
      userId: adminUser.userId,
      forceRegenerate: true,
    });
    assert.equal(coverRes.generated, true);

    // 3. Adventure sprite generation (CUSTOM industry) records GENERATE_ADVENTURE_SPRITE + game_id + asset_slot
    const customAdvSpec: GameSpecification = {
      ...generatedSpec,
      gameId: `game_adv_sprite_${Date.now()}`,
      title: 'Adventure Custom Sprite Test',
      gameType: 'ADVENTURE',
      settings: {
        ...generatedSpec.settings,
        adventureConfig: {
          version: 2,
          industryId: 'CUSTOM',
          industryLabel: 'Ngành Vũ Trụ Học',
          aiDetectedIndustry: false,
          themePresetId: 'IT_CYBER_CITY',
          subEnvironment: 'Trạm Không Gian',
          environmentTitle: 'Trạm Quỹ Đạo',
          environmentSubtitle: 'Khám phá không gian',
          gameplayArchetype: 'ENDLESS_RUNNER',
          controlScheme: 'JUMP_DUCK',
          questionTriggerMode: 'ON_OBSTACLE_HIT',
          decorStyle: 'CYBER_GRID',
          avatarId: 'ASTRONAUT',
          avatarLabel: 'Phi Hành Gia',
          palette: {
            skyTopHex: '#090D16',
            skyBottomHex: '#1E293B',
            groundHex: '#0F172A',
            accentHex: '#38BDF8',
          },
          obstacleTypes: ['Thiên thạch'],
          interactiveObjects: ['Vệ tinh'],
          questionTypes: ['MULTIPLE_CHOICE'],
          totalCheckpoints: 1,
          lives: 3,
          speedMultiplier: 1,
        } as any,
      },
    };
    gameStore.save(customAdvSpec);

    const spriteRes = await provisionAdventureAssetsForGame(customAdvSpec, {
      baseDir: tempDir,
      userId: adminUser.userId,
      imageProvider: mockCoverProvider,
      forceRegenerate: true,
    });
    assert.equal(spriteRes.verified, true);

    // 4. Verify GET /api/admin/ai-logs returns game_id, game_title, asset_slot, and distinct operations
    const logsRes = await supertest(app)
      .get('/api/admin/ai-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(logsRes.status, 200);
    const allLogs: any[] = logsRes.body.data.logs;
    assert.ok(allLogs.length >= 5, 'Should have question + cover + 3 adventure sprite logs');

    const questionLog = allLogs.find(
      (l) => l.game_id === generatedSpec.gameId && l.operation === 'GENERATE_QUESTIONS'
    );
    assert.ok(questionLog, 'Must record GENERATE_QUESTIONS with game_id');
    assert.equal(questionLog.input_tokens, 1200);
    assert.equal(questionLog.output_tokens, 400);
    assert.equal(questionLog.total_tokens, 1600);

    const coverLog = allLogs.find(
      (l) => l.game_id === generatedSpec.gameId && l.operation === 'GENERATE_COVER_IMAGE'
    );
    assert.ok(coverLog, 'Must record GENERATE_COVER_IMAGE with game_id');
    assert.equal(coverLog.asset_slot, 'COVER');
    assert.equal(coverLog.input_tokens, null, 'Unreported input_tokens must remain null');
    assert.equal(coverLog.total_tokens, null, 'Unreported total_tokens must remain null');
    assert.equal(coverLog.estimated_cost_usd, null, 'Cost without tokens must remain null');

    const spriteLogs = allLogs.filter(
      (l) => l.game_id === customAdvSpec.gameId && l.operation === 'GENERATE_ADVENTURE_SPRITE'
    );
    assert.equal(spriteLogs.length, 3, 'Must record 3 GENERATE_ADVENTURE_SPRITE logs for BACKGROUND, CHARACTER, OBSTACLE');
    const recordedSlots = new Set(spriteLogs.map((l) => l.asset_slot));
    assert.ok(recordedSlots.has('BACKGROUND'));
    assert.ok(recordedSlots.has('CHARACTER'));
    assert.ok(recordedSlots.has('OBSTACLE'));

    // 5. Verify filtering on GET /api/admin/ai-logs
    const filterSpriteRes = await supertest(app)
      .get('/api/admin/ai-logs')
      .query({ operation: 'GENERATE_ADVENTURE_SPRITE', gameId: customAdvSpec.gameId })
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(filterSpriteRes.status, 200);
    assert.equal(filterSpriteRes.body.data.logs.length, 3);

    // 6. Verify RBAC on /api/admin/ai-logs/export (401 for unauthenticated, 403 for non-admin USER)
    const unauthExport = await supertest(app).get('/api/admin/ai-logs/export?format=csv');
    assert.equal(unauthExport.status, 401);

    const normalUser = authService.register({
      email: 'regular_user_p2@matbao.ws',
      password: 'Password123!',
      displayName: 'Regular User',
    });
    const forbiddenExport = await supertest(app)
      .get('/api/admin/ai-logs/export?format=csv')
      .set('Authorization', `Bearer ${normalUser.token}`);
    assert.equal(forbiddenExport.status, 403);

    // 7. Verify CSV export has UTF-8 BOM, 'Chưa xác định' for null tokens/cost, and neutralizes formula injection
    const csvExportRes = await supertest(app)
      .get('/api/admin/ai-logs/export?format=csv')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(csvExportRes.status, 200);
    assert.match(String(csvExportRes.headers['content-type']), /text\/csv/i);
    const csvText = csvExportRes.text;
    assert.equal(csvText.charCodeAt(0), 0xfeff, 'CSV export must start with UTF-8 BOM');
    assert.ok(csvText.includes('GENERATE_QUESTIONS'), 'CSV must include GENERATE_QUESTIONS');
    assert.ok(csvText.includes('GENERATE_COVER_IMAGE'), 'CSV must include GENERATE_COVER_IMAGE');
    assert.ok(csvText.includes('GENERATE_ADVENTURE_SPRITE'), 'CSV must include GENERATE_ADVENTURE_SPRITE');
    assert.ok(csvText.includes('Chưa xác định'), 'CSV must render null tokens/cost as Chưa xác định, not 0');
    assert.ok(
      csvText.includes('"\'=CMD|""/C calc""!A0 Game AI Observability"'),
      'CSV must prefix dangerous = formula cells with single quote'
    );

    // 8. Verify XLSX export is a valid workbook with 'Chưa xác định' for null tokens/cost
    const xlsxExportRes = await supertest(app)
      .get('/api/admin/ai-logs/export?format=xlsx')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(xlsxExportRes.status, 200);
    assert.match(
      String(xlsxExportRes.headers['content-type']),
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i
    );
    const wb = XLSX.read(xlsxExportRes.body as Buffer, { type: 'buffer' });
    assert.ok(wb.SheetNames.includes('Nhat Ky AI Usage'));
    const sheetRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Nhat Ky AI Usage'], { header: 1 });
    assert.ok(sheetRows.length >= 6);
    const flatCells = sheetRows.flat().map(String);
    assert.ok(flatCells.includes('Chưa xác định'));
    assert.ok(flatCells.some((c) => c.startsWith("'=CMD")));

    // 9. Verify computeEstimatedCostUsd returns null when pricing is not configured
    const origInCost = LIMITS.GEMINI_INPUT_COST_PER_1M_USD;
    const origOutCost = LIMITS.GEMINI_OUTPUT_COST_PER_1M_USD;
    try {
      (LIMITS as any).GEMINI_INPUT_COST_PER_1M_USD = null;
      (LIMITS as any).GEMINI_OUTPUT_COST_PER_1M_USD = null;
      assert.equal(aiObservabilityService.computeEstimatedCostUsd(1000, 500), null);
    } finally {
      (LIMITS as any).GEMINI_INPUT_COST_PER_1M_USD = origInCost;
      (LIMITS as any).GEMINI_OUTPUT_COST_PER_1M_USD = origOutCost;
    }
  });

  it('Browser E2E (AUD-007, AUD-008, AUD-009, AUD-010, AUD-011, AUD-015): 5 viewports responsive check, Light/Dark Adventure modal contrast, Reports deduplicated requests, and touch targets >= 44px', async () => {
    const browser = await Browser.launch({ width: 1440, height: 900 });
    const page = await browser.newPage({ width: 1440, height: 900 });

    try {
      const viewports = [
        { width: 1440, height: 900, isMobile: false },
        { width: 1366, height: 768, isMobile: false },
        { width: 768, height: 1024, isMobile: true },
        { width: 390, height: 844, isMobile: true },
        { width: 360, height: 800, isMobile: true },
      ];

      // Seed auth & host session in localStorage / sessionStorage
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.goto(baseUrl, { settleMs: 600 });
      await page.eval(`
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(adminToken)});
        sessionStorage.setItem('active_host_room', ${JSON.stringify(hostRoomCode)});
        sessionStorage.setItem('active_host_token', ${JSON.stringify(hostToken)});
      `);

      // =====================================================================
      // 1. Verify /host across all 5 viewports (AUD-007 & AUD-011)
      // =====================================================================
      for (const vp of viewports) {
        await page.setViewport({ width: vp.width, height: vp.height, mobile: vp.isMobile });
        await page.goto(
          `${baseUrl}/?tab=host&room=${encodeURIComponent(hostRoomCode)}&token=${encodeURIComponent(hostToken)}`,
          { settleMs: 900 }
        );

        const hostMetrics = await page.eval(`(() => {
          const doc = document.documentElement;
          const h1Texts = Array.from(document.querySelectorAll('h1')).map(h => h.innerText || '').join(' | ');
          const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const smallButtons = buttons.filter(b => Math.round(b.getBoundingClientRect().height) < 44).map(b => ({
            text: (b.innerText || '').trim(),
            height: Math.round(b.getBoundingClientRect().height),
          }));
          return {
            innerWidth: window.innerWidth,
            scrollWidth: doc.scrollWidth,
            h1Text: h1Texts,
            bodyPreview: (document.body.innerText || '').slice(0, 300),
            smallButtons,
          };
        })()`);

        assert.ok(
          hostMetrics.scrollWidth <= hostMetrics.innerWidth,
          `/host at ${vp.width}x${vp.height} must not overflow horizontally (scrollWidth=${hostMetrics.scrollWidth}, innerWidth=${hostMetrics.innerWidth})`
        );
        assert.ok(
          hostMetrics.h1Text.includes('SUPERLONGUNBREAKABLEGAMETITLE') || hostMetrics.bodyPreview.includes('SUPERLONGUNBREAKABLEGAMETITLE'),
          `/host must render the room title on ${vp.width}x${vp.height}, got h1="${hostMetrics.h1Text}", body="${hostMetrics.bodyPreview}"`
        );
        if (vp.isMobile) {
          assert.equal(
            hostMetrics.smallButtons.length,
            0,
            `/host on mobile ${vp.width}x${vp.height} must have all visible buttons >= 44px height, found: ${JSON.stringify(hostMetrics.smallButtons)}`
          );
        }

        if (vp.width === 390 && vp.height === 844) {
          const shot = await page.screenshot();
          fs.writeFileSync(path.join(ARTIFACT_DIR, 'p2_after_host_390x844.png'), shot);
        }
        if (vp.width === 360 && vp.height === 800) {
          const shot = await page.screenshot();
          fs.writeFileSync(path.join(ARTIFACT_DIR, 'p2_after_host_360x800.png'), shot);
        }
      }

      // =====================================================================
      // 2. Verify /reports API deduplication (AUD-010) & 5 viewports (AUD-008 & AUD-011)
      // =====================================================================
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.goto(`${baseUrl}/`, { settleMs: 400 });

      // Install fetch interceptor before navigating inside SPA to /reports
      await page.eval(`
        window.__reportsApiCalls = [];
        const origFetch = window.fetch;
        window.fetch = function(input, init) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.includes('/api/analytics/') || url.includes('/api/history/')) {
            window.__reportsApiCalls.push(url);
          }
          return origFetch.apply(this, arguments);
        };
        window.history.pushState({}, '', '/?tab=reports');
        window.dispatchEvent(new PopStateEvent('popstate'));
      `);
      await sleep(1000);

      const reportsApiCalls: string[] = await page.eval(`window.__reportsApiCalls || []`);
      const learningCalls = reportsApiCalls.filter((u) => u.includes('/api/analytics/learning'));
      const sessionCalls = reportsApiCalls.filter((u) => u.includes('/api/history/sessions'));
      const activityCalls = reportsApiCalls.filter((u) => u.includes('/api/history/activities'));

      assert.equal(
        learningCalls.length,
        1,
        `/reports mount must call /api/analytics/learning exactly once, got ${learningCalls.length}: ${JSON.stringify(reportsApiCalls)}`
      );
      assert.equal(
        sessionCalls.length,
        0,
        `/reports mount must not make redundant /api/history/sessions call, got ${sessionCalls.length}`
      );
      assert.equal(
        activityCalls.length,
        1,
        `/reports mount must call /api/history/activities exactly once, got ${activityCalls.length}`
      );

      for (const vp of viewports) {
        await page.setViewport({ width: vp.width, height: vp.height, mobile: vp.isMobile });
        await sleep(450);

        const reportsMetrics = await page.eval(`(() => {
          const doc = document.documentElement;
          const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const smallButtons = buttons.filter(b => Math.round(b.getBoundingClientRect().height) < 44).map(b => ({
            text: (b.innerText || '').trim(),
            height: Math.round(b.getBoundingClientRect().height),
          }));
          return {
            innerWidth: window.innerWidth,
            scrollWidth: doc.scrollWidth,
            smallButtons,
          };
        })()`);

        assert.ok(
          reportsMetrics.scrollWidth <= reportsMetrics.innerWidth,
          `/reports at ${vp.width}x${vp.height} must not overflow horizontally (scrollWidth=${reportsMetrics.scrollWidth}, innerWidth=${reportsMetrics.innerWidth})`
        );
        if (vp.isMobile) {
          assert.equal(
            reportsMetrics.smallButtons.length,
            0,
            `/reports on mobile ${vp.width}x${vp.height} must have all visible buttons >= 44px height, found: ${JSON.stringify(reportsMetrics.smallButtons)}`
          );
        }

        if (vp.width === 390 && vp.height === 844) {
          const shot = await page.screenshot();
          fs.writeFileSync(path.join(ARTIFACT_DIR, 'p2_after_reports_390x844.png'), shot);
        }
        if (vp.width === 360 && vp.height === 800) {
          const shot = await page.screenshot();
          fs.writeFileSync(path.join(ARTIFACT_DIR, 'p2_after_reports_360x800.png'), shot);
        }
      }

      // =====================================================================
      // 3. Verify Adventure 2D Light Mode & Button Contrast (AUD-009 & AUD-011)
      // =====================================================================
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.eval(`
        localStorage.setItem('app_theme', 'light');
        document.documentElement.setAttribute('data-theme', 'light');
      `);
      await page.goto(`${baseUrl}/?play=${encodeURIComponent(adventureRedGameId)}`, { settleMs: 900 });

      for (let w = 0; w < 16; w++) {
        const ready = await page.eval(`(() => {
          document.documentElement.setAttribute('data-theme', 'light');
          const nameInput = document.querySelector('[data-testid="solo-free-name-input"]');
          const startGateBtn = document.querySelector('[data-testid="solo-free-start-btn"]');
          if (nameInput && startGateBtn) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(nameInput, 'Người chơi Light Mode');
            else nameInput.value = 'Người chơi Light Mode';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            startGateBtn.click();
            return false;
          }
          return Boolean(document.querySelector('[data-testid="scene-pregame-briefing"]'));
        })()`);
        if (ready) break;
        await sleep(250);
      }

      await sleep(300);
      const advLightCheck = await page.eval(`(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        const briefing = document.querySelector('[data-testid="scene-pregame-briefing"]');
        const startBtn =
          document.querySelector('[data-testid="start-adventure-btn"]') ||
          document.querySelector('[data-testid="adventure-start-run-btn"]') ||
          (briefing ? briefing.querySelector('button') : null);
        const briefingCard = briefing ? briefing.firstElementChild : null;
        const cardStyle = briefingCard ? window.getComputedStyle(briefingCard) : null;
        const btnStyle = startBtn ? window.getComputedStyle(startBtn) : null;
        const btnRect = startBtn ? startBtn.getBoundingClientRect() : null;
        return {
          hasBriefing: Boolean(briefing),
          cardBg: cardStyle ? cardStyle.backgroundColor : null,
          cardColor: cardStyle ? cardStyle.color : null,
          btnBg: btnStyle ? btnStyle.backgroundColor : null,
          btnColor: btnStyle ? btnStyle.color : null,
          btnHeight: btnRect ? Math.round(btnRect.height) : 0,
        };
      })()`);

      assert.equal(advLightCheck.hasBriefing, true, 'Adventure briefing modal must be visible');
      assert.equal(
        advLightCheck.cardBg,
        'rgb(255, 255, 255)',
        `Adventure briefing modal in Light Mode must use white surface (#ffffff), got ${advLightCheck.cardBg}`
      );
      assert.equal(
        advLightCheck.btnColor,
        'rgb(255, 255, 255)',
        `Adventure primary CTA on #EF4444 accent must use high-contrast white text (#ffffff), got ${advLightCheck.btnColor}`
      );
      assert.ok(advLightCheck.btnHeight >= 44, 'Adventure CTA button must be >= 44px height');

      const advShot = await page.screenshot();
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'p2_after_adventure_light_modal.png'), advShot);

      // =====================================================================
      // 4. Verify Admin AI Usage & Export UI (AUD-014 & AUD-015)
      // =====================================================================
      await page.goto(`${baseUrl}/?tab=admin`, { settleMs: 800 });
      await page.eval(`(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        const opsTab = tabs.find(t => /Vận Hành & AI/i.test(t.innerText || ''));
        if (opsTab) opsTab.click();
      })()`);
      await sleep(900);

      const adminAiCheck = await page.eval(`(() => {
        const csvBtn = document.querySelector('[data-testid="admin-export-ai-csv"]');
        const xlsxBtn = document.querySelector('[data-testid="admin-export-ai-xlsx"]');
        const bodyText = document.body.innerText || '';
        return {
          hasCsvBtn: Boolean(csvBtn),
          hasXlsxBtn: Boolean(xlsxBtn),
          hasGenerateQuestions: bodyText.includes('GENERATE_QUESTIONS'),
          hasGenerateCover: bodyText.includes('GENERATE_COVER_IMAGE'),
          hasGenerateSprite: bodyText.includes('GENERATE_ADVENTURE_SPRITE'),
          hasUnknownLabel: bodyText.includes('Chưa xác định'),
        };
      })()`);

      assert.equal(adminAiCheck.hasCsvBtn, true, 'Admin AI tab must render Xuất CSV button');
      assert.equal(adminAiCheck.hasXlsxBtn, true, 'Admin AI tab must render Xuất Excel (.xlsx) button');
      assert.equal(adminAiCheck.hasGenerateQuestions, true, 'Admin AI table must display GENERATE_QUESTIONS');
      assert.equal(adminAiCheck.hasGenerateCover, true, 'Admin AI table must display GENERATE_COVER_IMAGE');
      assert.equal(adminAiCheck.hasGenerateSprite, true, 'Admin AI table must display GENERATE_ADVENTURE_SPRITE');
      assert.equal(adminAiCheck.hasUnknownLabel, true, 'Admin AI table must display Chưa xác định for null tokens/cost');

      const adminShot = await page.screenshot();
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'p2_after_admin_ai_usage_export.png'), adminShot);
    } finally {
      await page.close().catch(() => {});
      await browser.close();
    }
  });
});
