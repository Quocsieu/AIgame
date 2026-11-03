import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import WebSocket from 'ws';
import * as XLSX from 'xlsx';

import { createApp } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import {
  ensurePlayableAdventureAssetsWithFallback,
  generateRuntimeAdventureAssetsForGame,
  inspectImageBuffer,
  provisionAdventureAssetsForGame,
  resolveDefaultFallbackSlotAsset,
} from '../src/services/adventure-asset-pack.service.js';
import { exportService } from '../src/services/export.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import {
  applyPresetToAdventureConfig,
  buildDefaultAdventureConfig,
} from '../frontend/src/config/adventureThemes.js';

function findChromeBinary(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Could not find Chrome/Edge binary for headless CDP E2E test');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class CdpPage {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  public consoleErrors: string[] = [];
  public pageErrors: string[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        if (msg.params?.type === 'error') {
          const text = (msg.params.args || [])
            .map((a: any) => a.value ?? a.description ?? '')
            .join(' ');
          // Ignore intentional 404 image fallback test logs from network resource loading
          if (!text.includes('404') && !text.includes('Failed to load resource')) {
            this.consoleErrors.push(text);
          }
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.pageErrors.push(
          msg.params?.exceptionDetails?.text ||
            msg.params?.exceptionDetails?.exception?.description ||
            'Unknown page exception'
        );
      }
    });
  }

  public send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  public async init(width = 1440, height = 900) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
    await this.setViewport(width, height);
  }

  public async setViewport(width: number, height: number, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
  }

  public async goto(url: string) {
    await this.send('Page.navigate', { url });
    await sleep(600);
    for (let i = 0; i < 30; i++) {
      const state = await this.eval('document.readyState');
      if (state === 'complete') break;
      await sleep(100);
    }
    await sleep(400);
  }

  public async eval<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        `Eval error: ${
          res.exceptionDetails.exception?.description || res.exceptionDetails.text
        }`
      );
    }
    return res?.result?.value as T;
  }

  public async close() {
    try {
      this.ws.close();
    } catch {}
  }
}

class Browser {
  private proc!: ChildProcess;
  private debugPort!: number;
  private userDataDir!: string;

  public static async launch(width = 1440, height = 900): Promise<Browser> {
    const b = new Browser();
    await b.start(width, height);
    return b;
  }

  private async start(width: number, height: number) {
    const bin = findChromeBinary();
    this.debugPort = 19100 + Math.floor(Math.random() * 400);
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-hist-adv-e2e-'));
    this.proc = spawn(
      bin,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        `--window-size=${width},${height}`,
        `--remote-debugging-port=${this.debugPort}`,
        `--user-data-dir=${this.userDataDir}`,
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/version`);
        if (res.ok) return;
      } catch {}
      await sleep(150);
    }
    throw new Error('Failed to connect to headless Chrome debugging port');
  }

  public async newPage(width = 1440, height = 900): Promise<CdpPage> {
    const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/new?about:blank`, {
      method: 'PUT',
    });
    const info = (await res.json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err) => reject(err));
    });
    const page = new CdpPage(ws);
    await page.init(width, height);
    return page;
  }

  public async close() {
    try {
      this.proc.kill();
    } catch {}
    await sleep(200);
    try {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Generates a valid synthetic PNG buffer (with valid PNG signature, IHDR width/height, and padding >= 1024 bytes)
 * for deterministic unit/integration testing without calling external AI APIs.
 */
function createValidSyntheticPngBuffer(width = 512, height = 512, byteLength = 2048): Buffer {
  const buf = Buffer.alloc(Math.max(byteLength, 1024), 0x42);
  // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  pngHeader.copy(buf, 0);
  // IHDR length = 13
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function createSampleQuizSpec(
  gameId: string,
  title: string,
  overrides: Partial<GameSpecification['settings']> = {}
): GameSpecification {
  return {
    gameId,
    title,
    description: `Bài kiểm tra lịch sử và xuất báo cáo (${gameId})`,
    gameType: 'QUIZ',
    isPublic: true,
    settings: {
      questionCount: 2,
      timePerQuestion: 30,
      scoringMode: 'STANDARD',
      sessionMode: 'PLAY',
      timerMode: 'PER_QUESTION',
      passThresholdPercent: 50,
      officialAttemptPolicy: 'LATEST_ATTEMPT',
      rosterMode: 'FREE_TEXT',
      answersPublished: false,
      examStatus: 'OPEN',
      audioConfig: {
        enabled: true,
        soundPackId: 'CORPORATE_TRAINING',
        presetId: 'CORPORATE_CALM',
        bgmEnabled: true,
        sfxEnabled: true,
        countdownSoundEnabled: true,
        countdownTriggerSeconds: 5,
        volume: 70,
      },
      ...overrides,
    },
    questions: [
      {
        id: `${gameId}_q1`,
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 1: Đâu là giao thức truyền siêu văn bản an toàn?',
        choices: ['HTTPS', 'FTP', 'Telnet', 'GOPHER'],
        correctAnswer: 'HTTPS',
        explanation: 'HTTPS mã hóa kết nối bằng TLS/SSL.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 'src_test', sourceType: 'TXT', sourceLocation: 'test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: `${gameId}_q2`,
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 2: Cổng mặc định của HTTPS là bao nhiêu?',
        choices: ['443', '80', '21', '25'],
        correctAnswer: '443',
        explanation: 'HTTPS sử dụng cổng TCP 443 mặc định.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 'src_test', sourceType: 'TXT', sourceLocation: 'test.txt' },
        timeLimitSeconds: 30,
      },
    ],
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_test',
          sourceType: 'TXT',
          sourceName: 'test.txt',
          sourceLocation: 'test.txt',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

async function runAllTests() {
  console.log('================================================================================');
  console.log('BẮT ĐẦU KIỂM THỬ NGHIỆM THU V3: LỊCH SỬ CHƠI/THI + ADVENTURE 2D BANANA FALLBACK');
  console.log('================================================================================\n');

  const app = createApp();
  const server = http.createServer(app);
  const wsServer = new MultiplayerWebSocketServer(server);
  void wsServer;

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // =========================================================================
    // PHẦN 5.1 — UNIT TESTS
    // =========================================================================
    console.log('--- [5.1] UNIT TESTS: Custom Industry Mapping, Asset Validator, Per-Slot Fallback & Formula Injection ---');

    // 5.1.1 Custom industry config mapping must NOT overwrite CUSTOM with preset's EDUCATION_GENERAL
    const baseCustomCfg = {
      ...buildDefaultAdventureConfig(),
      industryId: 'CUSTOM' as const,
      industryLabel: 'Nông nghiệp Công nghệ cao & Thủy canh',
    };
    const afterPresetCfg = applyPresetToAdventureConfig(baseCustomCfg, 'theme_custom_adaptive');
    assert.equal(
      afterPresetCfg.industryId,
      'CUSTOM',
      'applyPresetToAdventureConfig phải giữ nguyên industryId === CUSTOM khi người dùng chọn ngành tùy chỉnh'
    );
    assert.equal(
      afterPresetCfg.industryLabel,
      'Nông nghiệp Công nghệ cao & Thủy canh',
      'applyPresetToAdventureConfig phải giữ nguyên industryLabel của ngành tùy chỉnh'
    );
    console.log('  ✓ [Unit 1] applyPresetToAdventureConfig bảo toàn industryId="CUSTOM" và industryLabel');

    // 5.1.2 Asset Validator (valid PNG vs corrupt/empty buffer)
    const validPng = createValidSyntheticPngBuffer(512, 512, 2048);
    const validCheck = inspectImageBuffer(validPng, 'image/png');
    assert.equal(validCheck.valid, true, 'Buffer PNG hợp lệ >= 1024 bytes phải pass inspectImageBuffer');
    assert.equal(validCheck.width, 512);
    assert.equal(validCheck.height, 512);

    const corruptCheck = inspectImageBuffer(Buffer.from('not-an-image-buffer'), 'image/png');
    assert.equal(corruptCheck.valid, false, 'Buffer hỏng phải bị từ chối bởi inspectImageBuffer');
    console.log('  ✓ [Unit 2] inspectImageBuffer kiểm tra chính xác định dạng, kích thước và dung lượng ảnh');

    // 5.1.3 Per-slot Fallback Resolver for each slot
    for (const slot of ['background', 'character', 'obstacle'] as const) {
      const fallbackAsset = resolveDefaultFallbackSlotAsset(slot, 'CUSTOM', process.cwd(), 'theme_custom_adaptive');
      assert.ok(fallbackAsset.url.startsWith('/adventure-assets/'), `Fallback slot ${slot} phải có url hợp lệ`);
      assert.equal(fallbackAsset.verified, true, `Fallback slot ${slot} phải có verified=true`);
      assert.equal(
        fallbackAsset.source,
        'ANTIGRAVITY_BANANA_PACK',
        `Fallback slot ${slot} phải đánh dấu source ANTIGRAVITY_BANANA_PACK`
      );
    }
    console.log('  ✓ [Unit 3] resolveDefaultFallbackSlotAsset trả về asset mặc định hợp lệ cho từng slot (background, character, obstacle)');

    // 5.1.4 Formula Injection Sanitization in CSV and Excel exports
    const maliciousDetail = {
      historyId: 'solo:test_formula',
      gameId: 'game_formula',
      gameTitle: '=CMD|\' /C calc\'!A0',
      gameType: 'QUIZ',
      scoringMode: 'STANDARD' as const,
      sessionMode: 'EXAM' as const,
      deliveryMode: 'SOLO' as const,
      status: 'COMPLETED' as const,
      submittedReason: 'MANUAL_SUBMIT',
      roomId: null,
      roomCode: null,
      sessionId: 'sess_formula',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      durationMs: 12000,
      totalQuestions: 1,
      maxPossibleScore: 100,
      officialAttemptPolicy: 'LATEST_ATTEMPT' as const,
      passThresholdPercent: 50,
      answersPublished: false,
      participantCount: 1,
      completedCount: 1,
      passedCount: 1,
      failedCount: 0,
      averageScore: 100,
      highestScore: 100,
      averageAccuracy: 100,
      participants: [
        {
          rank: 1,
          participantId: 'p_malicious',
          fullName: '=HYPERLINK("http://evil.example","Click")',
          departmentUnit: '+SUM(10,20)',
          employeeCode: '@ADMIN_INJECT',
          score: 100,
          maxPossibleScore: 100,
          correctAnswers: 1,
          wrongAnswers: 0,
          totalQuestions: 1,
          accuracyPercent: 100,
          durationMs: 12000,
          isPassed: true,
          attemptNumber: 1,
          usedAttempts: 1,
          allowedAttempts: 1,
          status: 'COMPLETED' as const,
          submittedReason: 'MANUAL_SUBMIT',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      ],
      questionBreakdown: [
        {
          questionIndex: 1,
          questionId: 'q1',
          questionText: '-1+1=0',
          playerAnswer: '=1+1',
          isCorrect: true,
          pointsEarned: 100,
          responseTimeMs: 3000,
          timedOut: false,
          correctAnswer: null,
          explanation: null,
        },
      ],
    };

    const csvPayload = exportService.exportPlayExamHistoryDetail(maliciousDetail, 'csv');
    const csvString = Buffer.isBuffer(csvPayload.body)
      ? csvPayload.body.toString('utf8')
      : String(csvPayload.body);
    assert.ok(csvString.startsWith('\uFEFF'), 'CSV phải có UTF-8 BOM để mở tiếng Việt đúng trong Excel');
    assert.ok(
      csvString.includes("'=HYPERLINK") && csvString.includes("'+SUM(10,20)") && csvString.includes("'@ADMIN_INJECT"),
      'CSV phải vô hiệu hóa công thức độc hại (=, +, -, @) bằng dấu nháy đơn đầu chuỗi'
    );

    const xlsxPayload = exportService.exportPlayExamHistoryDetail(maliciousDetail, 'xlsx');
    const workbook = XLSX.read(xlsxPayload.body, { type: 'buffer' });
    assert.ok(workbook.SheetNames.includes('Ket Qua Phien'), 'File XLSX phải có sheet Ket Qua Phien');
    assert.ok(workbook.SheetNames.includes('Thong Tin Phien'), 'File XLSX phải có sheet Thong Tin Phien');
    assert.ok(workbook.SheetNames.includes('Chi Tiet Cau Hoi'), 'File XLSX phải có sheet Chi Tiet Cau Hoi');
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets['Ket Qua Phien']);
    assert.equal(sheetRows.length, 1);
    assert.ok(
      String(sheetRows[0]['Họ và tên']).startsWith("'=HYPERLINK"),
      'XLSX phải sanitize công thức ở cột Họ và tên'
    );
    assert.ok(
      String(sheetRows[0]['Phòng ban / Đơn vị']).startsWith("'+SUM"),
      'XLSX phải sanitize công thức ở cột Phòng ban / Đơn vị'
    );
    console.log('  ✓ [Unit 4] Xuất CSV (UTF-8 BOM) & XLSX (3 sheets) hoạt động chuẩn và chống CSV/Excel Formula Injection');

    // =========================================================================
    // PHẦN 5.2 & 5.6 — INTEGRATION & SECURITY TESTS: 4 LUỒNG CHƠI/THI + LỊCH SỬ + EXPORT
    // =========================================================================
    console.log('\n--- [5.2 & 5.6] INTEGRATION & SECURITY TESTS: 4 Luồng Chơi/Thi + Lịch sử + Phân quyền ---');

    // Tạo Creator A và Creator B
    const regA = await request(app)
      .post('/api/auth/register')
      .send({
        email: `creator_a_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Creator A (BTC)',
      });
    assert.equal(regA.status, 201);
    const tokenA = regA.body.data.token as string;
    const userIdA = regA.body.data.user.userId as string;
    const headerA = { Authorization: `Bearer ${tokenA}` };

    const regB = await request(app)
      .post('/api/auth/register')
      .send({
        email: `creator_b_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Creator B',
      });
    assert.equal(regB.status, 201);
    const tokenB = regB.body.data.token as string;
    const headerB = { Authorization: `Bearer ${tokenB}` };

    // --- Luồng 1: Chơi cá nhân KHÔNG có danh sách (Solo PLAY, rosterMode = FREE_TEXT) ---
    const soloPlayNoRosterId = `game_solo_play_noroster_${Date.now()}`;
    const soloPlayNoRosterSpec = createSampleQuizSpec(soloPlayNoRosterId, 'Game Chơi Cá Nhân Tự Do', {
      sessionMode: 'PLAY',
      rosterMode: 'FREE_TEXT',
    });
    gameStore.save(soloPlayNoRosterSpec, Date.now(), userIdA, true);

    // Chơi 2 lần trên cùng 1 game để kiểm tra không bị ghi đè lịch sử (Case 6)
    for (let run = 1; run <= 2; run++) {
      const startRes = await request(app)
        .post('/api/games/sessions')
        .send({
          gameId: soloPlayNoRosterId,
          playerName: `Người chơi Tự do Lần ${run}`,
        });
      assert.equal(startRes.status, 200);
      const sessionId = startRes.body.data.sessionId as string;
      const lockToken = startRes.body.data.lockToken as string;

      await request(app)
        .post(`/api/games/sessions/${sessionId}/start`)
        .set('X-Participant-Token', lockToken)
        .send({});
      await request(app)
        .post(`/api/games/sessions/${sessionId}/answer`)
        .set('X-Participant-Token', lockToken)
        .send({ questionId: `${soloPlayNoRosterId}_q1`, answer: 'HTTPS' });
      await request(app)
        .post(`/api/games/sessions/${sessionId}/next`)
        .set('X-Participant-Token', lockToken)
        .send({});
      await request(app)
        .post(`/api/games/sessions/${sessionId}/answer`)
        .set('X-Participant-Token', lockToken)
        .send({ questionId: `${soloPlayNoRosterId}_q2`, answer: run === 1 ? '443' : '80' });
      const finRes = await request(app)
        .post(`/api/games/sessions/${sessionId}/next`)
        .set('X-Participant-Token', lockToken)
        .send({});
      assert.equal(finRes.status, 200);
      assert.equal(finRes.body.data.finished, true);
    }
    console.log('  ✓ [Integration 1 & 6] Chơi cá nhân không danh sách (2 lượt liên tiếp) hoàn tất và lưu lịch sử riêng biệt');

    // --- Luồng 2: Chơi cá nhân CÓ danh sách (Solo PLAY, rosterMode = PRECONFIGURED) ---
    const soloPlayRosterId = `game_solo_play_roster_${Date.now()}`;
    const soloPlayRosterSpec = createSampleQuizSpec(soloPlayRosterId, 'Game Chơi Cá Nhân Có Danh Sách', {
      sessionMode: 'PLAY',
      rosterMode: 'PRECONFIGURED',
    });
    gameStore.save(soloPlayRosterSpec, Date.now(), userIdA, true);
    const rosterPlayParticipants = persistenceRepo.upsertParticipants(
      soloPlayRosterId,
      [{ fullName: 'Trần Văn Nam', departmentUnit: 'Phòng Kinh Doanh', employeeCode: 'NV01' }],
      true
    );
    const pNam = rosterPlayParticipants[0];

    const startPlayRosterRes = await request(app)
      .post('/api/games/sessions')
      .send({
        gameId: soloPlayRosterId,
        participantId: pNam.participantId,
        playerName: pNam.fullName,
      });
    assert.equal(startPlayRosterRes.status, 200);
    const sessPlayRosterId = startPlayRosterRes.body.data.sessionId as string;
    const playRosterToken = startPlayRosterRes.body.data.lockToken as string;
    await request(app)
      .post(`/api/games/sessions/${sessPlayRosterId}/start`)
      .set('X-Participant-Token', playRosterToken)
      .send({});
    await request(app)
      .post(`/api/games/sessions/${sessPlayRosterId}/answer`)
      .set('X-Participant-Token', playRosterToken)
      .send({ questionId: `${soloPlayRosterId}_q1`, answer: 'HTTPS' });
    await request(app)
      .post(`/api/games/sessions/${sessPlayRosterId}/next`)
      .set('X-Participant-Token', playRosterToken)
      .send({});
    await request(app)
      .post(`/api/games/sessions/${sessPlayRosterId}/answer`)
      .set('X-Participant-Token', playRosterToken)
      .send({ questionId: `${soloPlayRosterId}_q2`, answer: '443' });
    const finPlayRoster = await request(app)
      .post(`/api/games/sessions/${sessPlayRosterId}/next`)
      .set('X-Participant-Token', playRosterToken)
      .send({});
    assert.equal(finPlayRoster.status, 200);
    assert.equal(finPlayRoster.body.data.finished, true);
    console.log('  ✓ [Integration 2] Chơi cá nhân có danh sách hoàn tất và lưu lịch sử');

    // --- Luồng 3: Thi cá nhân CÓ danh sách (Solo EXAM, rosterMode = PRECONFIGURED) + BTC kết thúc đợt thi ---
    const soloExamId = `game_solo_exam_${Date.now()}`;
    const soloExamSpec = createSampleQuizSpec(soloExamId, 'Đề Thi Cá Nhân Bảo Mật', {
      sessionMode: 'EXAM',
      rosterMode: 'PRECONFIGURED',
      answersPublished: false,
      passThresholdPercent: 50,
    });
    gameStore.save(soloExamSpec, Date.now(), userIdA, true);
    const examParticipants = persistenceRepo.upsertParticipants(
      soloExamId,
      [
        { fullName: 'Lê Thị Hoa', departmentUnit: 'Khối Kỹ Thuật', employeeCode: 'TS01' },
        { fullName: 'Phạm Minh Tuấn', departmentUnit: 'Khối Vận Hành', employeeCode: 'TS02' },
      ],
      true
    );
    const pHoa = examParticipants[0];
    const pTuan = examParticipants[1];

    // Thí sinh Hoa làm xong và nộp thủ công
    const startHoa = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: soloExamId, participantId: pHoa.participantId, playerName: pHoa.fullName });
    assert.equal(startHoa.status, 200);
    const sessHoaId = startHoa.body.data.sessionId as string;
    const hoaToken = startHoa.body.data.lockToken as string;
    await request(app)
      .post(`/api/games/sessions/${sessHoaId}/start`)
      .set('X-Participant-Token', hoaToken)
      .send({});
    await request(app)
      .post(`/api/games/sessions/${sessHoaId}/answer`)
      .set('X-Participant-Token', hoaToken)
      .send({ questionId: `${soloExamId}_q1`, answer: 'HTTPS' });
    await request(app)
      .post(`/api/games/sessions/${sessHoaId}/next`)
      .set('X-Participant-Token', hoaToken)
      .send({});
    await request(app)
      .post(`/api/games/sessions/${sessHoaId}/answer`)
      .set('X-Participant-Token', hoaToken)
      .send({ questionId: `${soloExamId}_q2`, answer: '443' });
    await request(app)
      .post(`/api/games/sessions/${sessHoaId}/next`)
      .set('X-Participant-Token', hoaToken)
      .send({});

    // Thí sinh Tuấn đang làm dở câu 1 thì BTC bấm "Kết thúc đợt thi"
    const startTuan = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: soloExamId, participantId: pTuan.participantId, playerName: pTuan.fullName });
    assert.equal(startTuan.status, 200);
    const sessTuanId = startTuan.body.data.sessionId as string;
    const tuanToken = startTuan.body.data.lockToken as string;
    await request(app)
      .post(`/api/games/sessions/${sessTuanId}/start`)
      .set('X-Participant-Token', tuanToken)
      .send({});
    await request(app)
      .post(`/api/games/sessions/${sessTuanId}/answer`)
      .set('X-Participant-Token', tuanToken)
      .send({ questionId: `${soloExamId}_q1`, answer: 'HTTPS' });

    const closeExamRes = await request(app)
      .post(`/api/games/${soloExamId}/close-exam`)
      .set(headerA)
      .send({});
    assert.equal(closeExamRes.status, 200, 'BTC đóng đợt thi cá nhân phải thành công');
    console.log('  ✓ [Integration 3] Thi cá nhân (nộp thủ công + BTC kết thúc đợt thi tự động nộp) lưu đầy đủ vào lịch sử');

    // --- Luồng 4: Chơi nhóm (Multiplayer PLAY) ---
    const multiPlayGameId = `game_multi_play_${Date.now()}`;
    const multiPlaySpec = createSampleQuizSpec(multiPlayGameId, 'Game Chơi Nhóm Sôi Động', {
      sessionMode: 'PLAY',
      rosterMode: 'FREE_TEXT',
    });
    gameStore.save(multiPlaySpec, Date.now(), userIdA, true);

    const createPlayRoomRes = await request(app)
      .post('/api/rooms')
      .set(headerA)
      .send({ gameId: multiPlayGameId });
    assert.equal(createPlayRoomRes.status, 200);
    const playRoomId = createPlayRoomRes.body.data.roomId as string;
    const playRoomCode = createPlayRoomRes.body.data.roomCode as string;
    const playHostToken = createPlayRoomRes.body.data.hostToken as string;

    const playRoom = roomService.getRoomByCode(playRoomCode);
    const joinedPlay = playRoom.addPlayer('Nguyễn Văn Hùng');
    const playPlayerToken = joinedPlay.player.playerToken;

    playRoom.start(playHostToken);
    playRoom.submitPlayerAnswer(playPlayerToken, `${multiPlayGameId}_q1`, 'HTTPS');
    playRoom.revealQuestion();
    playRoom.nextQuestion(playHostToken);
    playRoom.submitPlayerAnswer(playPlayerToken, `${multiPlayGameId}_q2`, '443');
    playRoom.revealQuestion();
    const finishPlayRoom = playRoom.nextQuestion(playHostToken);
    assert.equal(finishPlayRoom.finished, true);
    console.log('  ✓ [Integration 4] Chơi nhóm (Multiplayer PLAY) hoàn tất và lưu lịch sử phòng');

    // --- Luồng 5: Thi nhóm (Multiplayer EXAM) + BTC kết thúc đợt thi ---
    const multiExamGameId = `game_multi_exam_${Date.now()}`;
    const multiExamSpec = createSampleQuizSpec(multiExamGameId, 'Kỳ Thi Nhóm Sát Hạch Định Kỳ', {
      sessionMode: 'EXAM',
      rosterMode: 'PRECONFIGURED',
      answersPublished: false,
      passThresholdPercent: 50,
    });
    gameStore.save(multiExamSpec, Date.now(), userIdA, true);
    const multiExamRoster = persistenceRepo.upsertParticipants(
      multiExamGameId,
      [{ fullName: 'Đặng Quốc Bảo', departmentUnit: 'Phòng An Ninh Mạng', employeeCode: 'AN01' }],
      true
    );
    const pBao = multiExamRoster[0];

    const createExamRoomRes = await request(app)
      .post('/api/rooms')
      .set(headerA)
      .send({ gameId: multiExamGameId });
    assert.equal(createExamRoomRes.status, 200);
    const examRoomId = createExamRoomRes.body.data.roomId as string;
    const examRoomCode = createExamRoomRes.body.data.roomCode as string;
    const examHostToken = createExamRoomRes.body.data.hostToken as string;

    const examRoom = roomService.getRoomByCode(examRoomCode);
    const joinedExam = examRoom.addPlayer(pBao.fullName, undefined, {
      participantId: pBao.participantId,
      departmentUnit: pBao.departmentUnit,
    });
    const examPlayerToken = joinedExam.player.playerToken;

    examRoom.start(examHostToken);
    examRoom.submitPlayerAnswer(examPlayerToken, `${multiExamGameId}_q1`, 'HTTPS');

    // BTC kết thúc đợt thi cho game Thi nhóm
    const endExamRoomRes = await request(app)
      .post(`/api/games/${multiExamGameId}/close-exam`)
      .set(headerA)
      .send({});
    assert.equal(endExamRoomRes.status, 200, 'BTC kết thúc phòng thi nhóm phải trả về 200');
    console.log('  ✓ [Integration 5] Thi nhóm (Multiplayer EXAM) BTC kết thúc đợt thi tự động thu bài và lưu lịch sử');

    // --- Kiểm tra API Danh sách Lịch sử Chơi / Thi (/api/history/activities) ---
    const listAllRes = await request(app).get('/api/history/activities').set(headerA);
    assert.equal(listAllRes.status, 200);
    const allItems = listAllRes.body.data.items as any[];
    assert.ok(allItems.length >= 6, `Phải có ít nhất 6 bản ghi lịch sử, thực tế: ${allItems.length}`);

    // Kiểm tra 2 lượt chơi của cùng 1 game đều tồn tại riêng biệt
    const soloNoRosterRuns = allItems.filter((item) => item.gameId === soloPlayNoRosterId);
    assert.equal(
      soloNoRosterRuns.length,
      2,
      'Chơi 2 lần trên cùng 1 game phải tạo 2 bản ghi lịch sử riêng biệt, không ghi đè'
    );

    // Kiểm tra bộ lọc sessionMode = EXAM
    const listExamRes = await request(app)
      .get('/api/history/activities?sessionMode=EXAM')
      .set(headerA);
    assert.equal(listExamRes.status, 200);
    assert.ok(
      listExamRes.body.data.items.every((i: any) => i.sessionMode === 'EXAM'),
      'Bộ lọc sessionMode=EXAM chỉ được trả về các phiên Thi'
    );

    // Kiểm tra bộ lọc deliveryMode = MULTIPLAYER
    const listMultiRes = await request(app)
      .get('/api/history/activities?deliveryMode=MULTIPLAYER')
      .set(headerA);
    assert.equal(listMultiRes.status, 200);
    assert.ok(
      listMultiRes.body.data.items.every((i: any) => i.deliveryMode === 'MULTIPLAYER'),
      'Bộ lọc deliveryMode=MULTIPLAYER chỉ được trả về các phiên Nhóm'
    );

    // Kiểm tra tìm kiếm theo tên game
    const searchRes = await request(app)
      .get(`/api/history/activities?search=${encodeURIComponent('Kỳ Thi Nhóm Sát Hạch')}`)
      .set(headerA);
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.data.items.length, 1);
    assert.equal(searchRes.body.data.items[0].gameId, multiExamGameId);
    console.log('  ✓ [Integration 7] API /api/history/activities lọc Chơi/Thi, Cá nhân/Nhóm và tìm kiếm chính xác');

    // --- Kiểm tra Xem chi tiết & Bảo mật đáp án đề thi chưa mở ---
    const soloExamHistoryId = `solo:${sessTuanId}`;
    const detailSoloExamRes = await request(app)
      .get(`/api/history/activities/${encodeURIComponent(soloExamHistoryId)}`)
      .set(headerA);
    assert.equal(detailSoloExamRes.status, 200);
    const detailSoloExam = detailSoloExamRes.body.data;
    assert.equal(detailSoloExam.sessionMode, 'EXAM');
    assert.equal(detailSoloExam.submittedReason, 'EXAM_CLOSED_BY_HOST');
    assert.equal(detailSoloExam.answersPublished, false);
    assert.ok(
      detailSoloExam.questionBreakdown.every(
        (q: any) => q.correctAnswer === null && q.explanation === null
      ),
      'Khi chế độ Thi chưa công bố đáp án (answersPublished=false), chi tiết câu hỏi KHÔNG ĐƯỢC lộ correctAnswer/explanation'
    );

    // Xuất CSV & XLSX cho cả phiên Cá nhân và phiên Nhóm
    for (const hId of [soloExamHistoryId, `room:${examRoomId}`, `room:${playRoomId}`, `solo:${sessPlayRosterId}`]) {
      const csvExportRes = await request(app)
        .get(`/api/history/activities/${encodeURIComponent(hId)}/export?format=csv`)
        .set(headerA);
      assert.equal(csvExportRes.status, 200, `Xuất CSV cho ${hId} phải thành công`);
      assert.ok(
        String(csvExportRes.headers['content-type']).includes('text/csv'),
        'Content-Type của CSV phải là text/csv'
      );
      assert.ok(csvExportRes.text.length > 50, 'Nội dung CSV không được rỗng');

      const xlsxExportRes = await request(app)
        .get(`/api/history/activities/${encodeURIComponent(hId)}/export?format=xlsx`)
        .set(headerA)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      assert.equal(xlsxExportRes.status, 200, `Xuất XLSX cho ${hId} phải thành công`);
      const wb = XLSX.read(xlsxExportRes.body as Buffer, { type: 'buffer' });
      assert.ok(wb.SheetNames.includes('Ket Qua Phien'), `XLSX của ${hId} phải có sheet Ket Qua Phien`);
    }
    console.log('  ✓ [Integration 8] Xem chi tiết & Xuất CSV/XLSX cho cả 4 chế độ thành công và bảo mật đáp án Thi');

    // --- Kiểm tra Security (5.6): Chặn Player Token & Chặn IDOR giữa Creator B và Creator A ---
    const playerTokenAttackRes = await request(app)
      .get('/api/history/activities')
      .set('X-Player-Token', playPlayerToken);
    assert.equal(playerTokenAttackRes.status, 403, 'Player token gọi danh sách lịch sử phải bị chặn 403');

    const idorDetailRes = await request(app)
      .get(`/api/history/activities/${encodeURIComponent(soloExamHistoryId)}`)
      .set(headerB);
    assert.equal(idorDetailRes.status, 403, 'Creator B xem chi tiết lịch sử của Creator A phải bị chặn 403 (chống IDOR)');

    const idorExportRes = await request(app)
      .get(`/api/history/activities/${encodeURIComponent(`room:${examRoomId}`)}/export?format=xlsx`)
      .set(headerB);
    assert.equal(idorExportRes.status, 403, 'Creator B xuất file lịch sử của Creator A phải bị chặn 403 (chống IDOR)');
    console.log('  ✓ [Security 5.6] Chặn hoàn toàn Player token (403) và chặn IDOR giữa các Creator (403)');

    // =========================================================================
    // PHẦN 5.3 — ADVENTURE 2D + BANANA ASSET RELIABILITY & PER-SLOT FALLBACK TESTS
    // =========================================================================
    console.log('\n--- [5.3] ADVENTURE 2D + BANANA CUSTOM INDUSTRY & PER-SLOT FALLBACK TESTS (MOCKED, NO REAL AI CALLS) ---');

    const buildCustomAdvSpec = (gameId: string, title: string): GameSpecification => ({
      ...createSampleQuizSpec(gameId, title),
      gameType: 'ADVENTURE',
      settings: {
        ...createSampleQuizSpec(gameId, title).settings,
        adventureConfig: {
          ...buildDefaultAdventureConfig(),
          industryId: 'CUSTOM' as const,
          industryLabel: 'Hàng không Vũ trụ & Vệ tinh',
          themePresetId: 'theme_custom_adaptive',
          subEnvironment: 'Trạm Điều Khiển Vệ Tinh Quỹ Đạo',
        },
      },
    });

    // Case 5.3.1: Ngành tùy chỉnh -> Banana trả 3 ảnh hợp lệ -> Game mở & chơi bình thường
    const gameAdvAllOkId = `game_adv_all_ok_${Date.now()}`;
    const allOkProvider = {
      async generateImage() {
        return {
          base64Data: createValidSyntheticPngBuffer(512, 512, 2048).toString('base64'),
          mimeType: 'image/png' as const,
          model: 'gemini-2.5-flash-image',
        };
      },
    };
    const resAllOk = await provisionAdventureAssetsForGame(
      buildCustomAdvSpec(gameAdvAllOkId, 'Adventure Vũ Trụ Tùy Chỉnh'),
      { imageProvider: allOkProvider, forceRegenerate: true }
    );
    assert.equal(resAllOk.assetStatus, 'READY');
    const cfgAllOk = resAllOk.specification.settings.adventureConfig!;
    assert.equal(cfgAllOk.assets!.background.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(cfgAllOk.assets!.character.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(cfgAllOk.assets!.obstacle.source, 'GEMINI_BANANA_RUNTIME');
    console.log('  ✓ [Adventure 5.3.1] Ngành CUSTOM khi Banana tạo đủ 3 ảnh hợp lệ -> cả 3 slot đều GEMINI_BANANA_RUNTIME & READY');

    // Case 5.3.2: Banana lỗi ở BACKGROUND -> chỉ BACKGROUND fallback về default pack, giữ CHARACTER & OBSTACLE của Banana
    const gameAdvFailBgId = `game_adv_fail_bg_${Date.now()}`;
    let callIdxBg = 0;
    const failBgProvider = {
      async generateImage() {
        callIdxBg++;
        if (callIdxBg === 1) {
          throw new Error('Simulated Banana timeout on BACKGROUND slot');
        }
        return {
          base64Data: createValidSyntheticPngBuffer(512, 512, 2048).toString('base64'),
          mimeType: 'image/png' as const,
          model: 'gemini-2.5-flash-image',
        };
      },
    };
    const resFailBg = await provisionAdventureAssetsForGame(
      buildCustomAdvSpec(gameAdvFailBgId, 'Adventure Lỗi Background'),
      { imageProvider: failBgProvider, forceRegenerate: true }
    );
    assert.equal(resFailBg.assetStatus, 'READY', 'Khi lỗi 1 slot, trạng thái chung vẫn phải READY nhờ per-slot fallback');
    const cfgFailBg = resFailBg.specification.settings.adventureConfig!;
    assert.equal(
      cfgFailBg.assets!.background.source,
      'ANTIGRAVITY_BANANA_PACK',
      'Slot BACKGROUND lỗi phải tự động fallback về ANTIGRAVITY_BANANA_PACK'
    );
    assert.equal(
      cfgFailBg.assets!.character.source,
      'GEMINI_BANANA_RUNTIME',
      'Slot CHARACTER thành công phải được giữ nguyên GEMINI_BANANA_RUNTIME'
    );
    assert.equal(
      cfgFailBg.assets!.obstacle.source,
      'GEMINI_BANANA_RUNTIME',
      'Slot OBSTACLE thành công phải được giữ nguyên GEMINI_BANANA_RUNTIME'
    );
    console.log('  ✓ [Adventure 5.3.2] Banana lỗi BACKGROUND -> BACKGROUND fallback mặc định, giữ nguyên CHARACTER & OBSTACLE của Banana');

    // Case 5.3.3: Banana lỗi ở CHARACTER -> chỉ CHARACTER fallback về default pack
    const gameAdvFailCharId = `game_adv_fail_char_${Date.now()}`;
    let callIdxChar = 0;
    const failCharProvider = {
      async generateImage() {
        callIdxChar++;
        if (callIdxChar === 2) {
          throw new Error('Simulated Banana failure on CHARACTER slot');
        }
        return {
          base64Data: createValidSyntheticPngBuffer(512, 512, 2048).toString('base64'),
          mimeType: 'image/png' as const,
          model: 'gemini-2.5-flash-image',
        };
      },
    };
    const resFailChar = await provisionAdventureAssetsForGame(
      buildCustomAdvSpec(gameAdvFailCharId, 'Adventure Lỗi Character'),
      { imageProvider: failCharProvider, forceRegenerate: true }
    );
    assert.equal(resFailChar.assetStatus, 'READY');
    const cfgFailChar = resFailChar.specification.settings.adventureConfig!;
    assert.equal(cfgFailChar.assets!.background.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(cfgFailChar.assets!.character.source, 'ANTIGRAVITY_BANANA_PACK');
    assert.equal(cfgFailChar.assets!.obstacle.source, 'GEMINI_BANANA_RUNTIME');
    console.log('  ✓ [Adventure 5.3.3] Banana lỗi CHARACTER -> CHARACTER fallback mặc định, giữ nguyên BACKGROUND & OBSTACLE');

    // Case 5.3.4: Banana lỗi ở OBSTACLE (trả về ảnh hỏng / corrupt buffer) -> OBSTACLE bị từ chối và fallback mặc định
    const gameAdvFailObsId = `game_adv_fail_obs_${Date.now()}`;
    let callIdxObs = 0;
    const failObsProvider = {
      async generateImage() {
        callIdxObs++;
        if (callIdxObs === 3) {
          return {
            base64Data: Buffer.from('corrupt-image-bytes').toString('base64'),
            mimeType: 'image/png' as const,
            model: 'gemini-2.5-flash-image',
          };
        }
        return {
          base64Data: createValidSyntheticPngBuffer(512, 512, 2048).toString('base64'),
          mimeType: 'image/png' as const,
          model: 'gemini-2.5-flash-image',
        };
      },
    };
    const resFailObs = await provisionAdventureAssetsForGame(
      buildCustomAdvSpec(gameAdvFailObsId, 'Adventure Lỗi Obstacle'),
      { imageProvider: failObsProvider, forceRegenerate: true }
    );
    assert.equal(resFailObs.assetStatus, 'READY');
    const cfgFailObs = resFailObs.specification.settings.adventureConfig!;
    assert.equal(cfgFailObs.assets!.background.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(cfgFailObs.assets!.character.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(cfgFailObs.assets!.obstacle.source, 'ANTIGRAVITY_BANANA_PACK');
    console.log('  ✓ [Adventure 5.3.4 & 5.3.7] Banana trả ảnh hỏng ở OBSTACLE -> bị từ chối và fallback mặc định');

    // Case 5.3.5: Banana lỗi cả 3 ảnh -> cả 3 fallback mặc định, game vẫn mở & chơi bình thường
    const gameAdvFailAllId = `game_adv_fail_all_${Date.now()}`;
    const failAllProvider = {
      async generateImage(): Promise<any> {
        throw new Error('Banana API completely unavailable');
      },
    };
    const resFailAll = await provisionAdventureAssetsForGame(
      buildCustomAdvSpec(gameAdvFailAllId, 'Adventure Lỗi Toàn Bộ'),
      { imageProvider: failAllProvider, forceRegenerate: true }
    );
    assert.equal(resFailAll.assetStatus, 'READY');
    const cfgFailAll = resFailAll.specification.settings.adventureConfig!;
    assert.equal(cfgFailAll.assets!.background.source, 'ANTIGRAVITY_BANANA_PACK');
    assert.equal(cfgFailAll.assets!.character.source, 'ANTIGRAVITY_BANANA_PACK');
    assert.equal(cfgFailAll.assets!.obstacle.source, 'ANTIGRAVITY_BANANA_PACK');
    console.log('  ✓ [Adventure 5.3.5] Banana lỗi cả 3 ảnh -> cả 3 fallback về gói mặc định, assetStatus=READY');

    // Case 5.3.6: File asset bị xóa trên đĩa sau khi tạo game -> GET /api/games/:gameId tự động sửa slot hỏng mà không gọi lại Banana
    gameStore.save(resAllOk.specification, Date.now(), userIdA, true);

    // Xóa file ảnh character của gameAdvAllOkId trên đĩa để mô phỏng lỗi 404 sau khi tạo game
    const charDiskPath = path.resolve(process.cwd(), cfgAllOk.assets!.character.relativePath);
    if (fs.existsSync(charDiskPath)) {
      fs.unlinkSync(charDiskPath);
    }

    const getAdvGameRes = await request(app).get(`/api/games/${gameAdvAllOkId}`).set(headerA);
    assert.equal(getAdvGameRes.status, 200);
    const returnedAdvCfg = getAdvGameRes.body.data.settings.adventureConfig;
    assert.equal(returnedAdvCfg.assetStatus, 'READY');
    assert.equal(
      returnedAdvCfg.assets.background.source,
      'GEMINI_BANANA_RUNTIME',
      'File background còn trên đĩa phải giữ nguyên GEMINI_BANANA_RUNTIME'
    );
    assert.equal(
      returnedAdvCfg.assets.character.source,
      'ANTIGRAVITY_BANANA_PACK',
      'File character bị xóa trên đĩa phải tự động fallback sang ANTIGRAVITY_BANANA_PACK khi mở game'
    );
    assert.equal(
      returnedAdvCfg.assets.obstacle.source,
      'GEMINI_BANANA_RUNTIME',
      'File obstacle còn trên đĩa phải giữ nguyên GEMINI_BANANA_RUNTIME'
    );
    console.log('  ✓ [Adventure 5.3.6] Khi 1 file ảnh bị xóa trên đĩa sau khi tạo, GET /api/games/:gameId tự fallback đúng slot đó mà không gọi lại Banana');

    // Cleanup temporary generated runtime test directory for gameAdvAllOkId / gameAdvFail*
    for (const gid of [gameAdvAllOkId, gameAdvFailBgId, gameAdvFailCharId, gameAdvFailObsId, gameAdvFailAllId]) {
      const dir = path.resolve(process.cwd(), 'public', 'adventure-assets', 'games', gid);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    // =========================================================================
    // PHẦN 5.4 & 5.5 — BROWSER E2E TESTS (1440x900 DESKTOP & 390x844 MOBILE)
    // =========================================================================
    console.log('\n--- [5.4 & 5.5] BROWSER E2E TESTS (1440×900 Desktop & 390×844 Mobile) ---');

    // Tạo một game Adventure 2D ngành CUSTOM có 1 slot URL giả định bị 404 để test trực tiếp trình duyệt thật tự động fallback trên Canvas
    const e2eAdvBrokenUrlGameId = `game_adv_e2e_fallback_${Date.now()}`;
    const validRepairedRes = ensurePlayableAdventureAssetsWithFallback(resFailAll.specification, process.cwd());
    const validRepairedCfg = validRepairedRes.specification.settings.adventureConfig!;
    const e2eAdvSpec: GameSpecification = {
      ...createSampleQuizSpec(e2eAdvBrokenUrlGameId, 'Hành Trình Vũ Trụ 2D (Custom Fallback)'),
      gameType: 'ADVENTURE',
      settings: {
        ...createSampleQuizSpec(e2eAdvBrokenUrlGameId, 'Hành Trình Vũ Trụ 2D (Custom Fallback)').settings,
        adventureConfig: {
          ...validRepairedCfg,
          industryId: 'CUSTOM',
          industryLabel: 'Kỹ thuật Hàng không Vũ trụ',
          assetStatus: 'READY',
          assets: {
            ...validRepairedCfg.assets!,
            // Giả lập URL ảnh obstacle bị 404 ngay trên trình duyệt để kiểm tra loadSlotWithFallback của AdventureGameEngine
            obstacle: {
              ...validRepairedCfg.assets!.obstacle,
              url: '/adventure-assets/games/non-existent-broken-obstacle-404.png',
            },
          },
        },
      },
    };
    gameStore.save(e2eAdvSpec, Date.now(), userIdA, true);

    const browser = await Browser.launch(1440, 900);
    try {
      const page = await browser.newPage(1440, 900);

      // Đăng nhập Creator A trên trình duyệt bằng cách bơm token vào sessionStorage
      await page.goto(`${baseUrl}/`);
      await page.eval(`
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(tokenA)});
      `);
      await page.goto(`${baseUrl}/?tab=reports`);
      await sleep(900);

      // 1. Kiểm tra khu vực Danh sách Game trong Thư viện & Quản lý Lượt Chơi / Thi trên trang Thống kê (Desktop 1440x900)
      const historySectionInfo = await page.eval(`(() => {
        const sec = document.querySelector('[data-testid="reports-v2-game-hub"]');
        const table = document.querySelector('[data-testid="reports-games-table"]');
        const rows = document.querySelectorAll('[data-testid^="reports-game-row-"]');
        const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
        return {
          hasSection: !!sec,
          hasTable: !!table,
          rowCount: rows.length,
          overflow,
        };
      })()`);
      assert.equal(historySectionInfo.hasSection, true, 'Trang Thống kê phải hiển thị khu vực Danh sách Game trong Thư viện & Quản lý Lượt Chơi / Thi');
      assert.equal(historySectionInfo.hasTable, true, 'Bảng Danh sách Game trong Thư viện phải hiển thị dữ liệu');
      assert.ok(historySectionInfo.rowCount >= 2, `Bảng Danh sách Game phải hiển thị các game đã tạo (thực tế: ${historySectionInfo.rowCount})`);
      assert.equal(historySectionInfo.overflow, false, 'Trang Thống kê ở Desktop 1440x900 không được tràn ngang');
      console.log(`  ✓ [E2E Case A - Desktop 1440×900] Trang Thống kê hiển thị bảng Danh sách Game (${historySectionInfo.rowCount} game), không tràn ngang`);

      // 2. Bấm "Xem chi tiết" trên dòng đầu tiên để chuyển sang Màn hình chi tiết game riêng biệt và kiểm tra nút Xuất CSV / Xuất Excel
      await page.eval(`(() => {
        const btn = document.querySelector('[data-testid^="reports-game-detail-btn-"]');
        if (btn) btn.click();
      })()`);
      await sleep(700);

      const modalInfo = await page.eval(`(() => {
        const detailScreen = document.querySelector('[data-testid="reports-game-detail-screen"]');
        const gameDetail = document.querySelector('[data-testid="reports-v2-game-detail"]');
        const csvBtn = document.querySelector('[data-testid="detail-export-csv-btn"]');
        const xlsxBtn = document.querySelector('[data-testid="detail-export-xlsx-btn"]');
        return {
          hasModal: !!detailScreen,
          hasParticipantsTable: !!gameDetail,
          hasCsvBtn: !!csvBtn,
          hasXlsxBtn: !!xlsxBtn,
        };
      })()`);
      assert.equal(modalInfo.hasModal, true, 'Bấm Xem chi tiết phải mở màn hình chi tiết game riêng biệt');
      assert.equal(modalInfo.hasParticipantsTable, true, 'Màn hình chi tiết phải hiển thị báo cáo chi tiết của game');
      assert.equal(modalInfo.hasCsvBtn, true, 'Màn hình chi tiết phải có nút Xuất CSV');
      assert.equal(modalInfo.hasXlsxBtn, true, 'Màn hình chi tiết phải có nút Xuất Excel (.xlsx)');

      // Bấm thử nút Xuất CSV và quay lại Thống kê
      await page.eval(`(() => {
        const csvBtn = document.querySelector('[data-testid="detail-export-csv-btn"]');
        if (csvBtn) csvBtn.click();
      })()`);
      await sleep(400);
      await page.eval(`(() => {
        const closeBtn = document.querySelector('[data-testid="back-to-reports-overview-btn"]');
        if (closeBtn) closeBtn.click();
      })()`);
      await sleep(300);
      console.log('  ✓ [E2E Case A & B] Mở Màn hình Xem chi tiết game & bấm Xuất CSV / Excel + Quay lại Thống kê hoạt động mượt mà');

      // 3. Kiểm tra responsive Mobile 390×844 trên trang Thống kê
      await page.setViewport(390, 844, true);
      await sleep(400);
      const mobileReportsOverflow = await page.eval(`
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
      `);
      assert.equal(mobileReportsOverflow, false, 'Trang Thống kê ở Mobile 390×844 không được tràn ngang');
      console.log('  ✓ [E2E Mobile 390×844] Trang Thống kê và bảng Lịch sử Chơi / Thi tương thích hoàn toàn ở viewport 390×844');

      // 4. Kiểm tra E2E Case C: Mở và chơi hoàn chỉnh game Adventure 2D ngành tùy chỉnh có asset fallback
      await page.setViewport(1440, 900, false);
      await page.goto(`${baseUrl}/?play=${encodeURIComponent(e2eAdvBrokenUrlGameId)}`);
      await sleep(1200);

      // Điền tên người chơi nếu có màn hình nhập tên trước khi vào Adventure 2D
      await page.eval(`(() => {
        const nameInput = document.querySelector('input[type="text"]');
        if (nameInput) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          nativeInputValueSetter?.call(nameInput, 'Phi Hành Gia E2E');
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        const startSessionBtn = buttons.find(b =>
          b.textContent && (b.textContent.includes('Bắt đầu') || b.textContent.includes('Vào chơi') || b.textContent.includes('Tiếp tục'))
        );
        if (startSessionBtn) startSessionBtn.click();
      })()`);
      await sleep(1000);

      const advScreenCheck = await page.eval(`(() => {
        const bodyText = document.body.innerText || '';
        const hasAssetError = bodyText.includes('Không thể tải tài nguyên') || bodyText.includes('Không thể khởi chạy màn chơi Adventure 2D');
        const canvas = document.querySelector('[data-testid="adventure-canvas"]') || document.querySelector('canvas');
        const startJourneyBtn = document.querySelector('[data-testid="start-adventure-btn"]');
        return {
          hasAssetError,
          hasCanvas: !!canvas,
          hasStartJourneyBtn: !!startJourneyBtn,
        };
      })()`);
      assert.equal(
        advScreenCheck.hasAssetError,
        false,
        'Adventure 2D ngành tùy chỉnh KHÔNG ĐƯỢC báo lỗi "Không thể tải tài nguyên" ngay cả khi URL ảnh bị lỗi'
      );
      assert.equal(advScreenCheck.hasCanvas, true, 'Canvas của Adventure 2D phải được render thành công');

      if (advScreenCheck.hasStartJourneyBtn) {
        await page.eval(`document.querySelector('[data-testid="start-adventure-btn"]')?.click()`);
        await sleep(500);
      }

      // Kiểm tra Mobile 390×844 trên màn hình Adventure 2D
      await page.setViewport(390, 844, true);
      await sleep(400);
      const advMobileCheck = await page.eval(`(() => {
        const canvas = document.querySelector('[data-testid="adventure-canvas"]') || document.querySelector('canvas');
        const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
        return { hasCanvas: !!canvas, overflow };
      })()`);
      assert.equal(advMobileCheck.hasCanvas, true);
      assert.equal(advMobileCheck.overflow, false, 'Màn chơi Adventure 2D ở Mobile 390×844 không được tràn ngang');

      assert.equal(
        page.pageErrors.length,
        0,
        `Không được có page exception trên trình duyệt: ${page.pageErrors.join('; ')}`
      );
      console.log('  ✓ [E2E Case C - 1440×900 & 390×844] Adventure 2D ngành tùy chỉnh tự động fallback mượt mà, render Canvas và vào màn chơi không lỗi');

      await page.close();
    } finally {
      await browser.close();
    }

    console.log('\n================================================================================');
    console.log('✅ TẤT CẢ KIỂM THỬ UNIT, INTEGRATION, SECURITY VÀ BROWSER E2E ĐỀU PASS 100%!');
    console.log('================================================================================');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runAllTests().catch((err) => {
  console.error('❌ KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});
