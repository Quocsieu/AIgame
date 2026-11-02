import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as XLSX from 'xlsx';

import { createApp } from '../src/app.js';
import { GameAudioConfigSchema, GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { initDatabase } from '../src/storage/sqlite.db.js';
import {
  SFX_CUE_CATALOG,
  SOUND_PACK_CATALOG,
  mapSoundPackToPresetId,
  resolveSoundPackDefinition,
} from '../frontend/src/services/audio.js';

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
          this.consoleErrors.push(text);
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
    await sleep(300);
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
    this.debugPort = 19500 + Math.floor(Math.random() * 400);
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-acceptance-e2e-'));
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

function createFiveQuestionExamSpec(
  gameId: string,
  overrides: Partial<GameSpecification['settings']> = {}
): GameSpecification {
  return {
    gameId,
    title: `Kỳ Thi Nghiệm Thu V3 (${gameId})`,
    description:
      'Đề thi nghiệm thu V3 kiểm thử bắt buộc danh sách thí sinh và BTC kết thúc đợt thi tự động nộp bài.',
    gameType: 'QUIZ',
    isPublic: true,
    settings: {
      questionCount: 5,
      timePerQuestion: 30,
      scoringMode: 'STANDARD',
      sessionMode: 'EXAM',
      timerMode: 'PER_QUESTION',
      passThresholdPercent: 60,
      officialAttemptPolicy: 'LATEST_ATTEMPT',
      rosterMode: 'PRECONFIGURED',
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
        id: 'q1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 1: Giao thức chuẩn dùng cho kết nối thời gian thực hai chiều là gì?',
        choices: ['WebSocket', 'FTP', 'SMTP', 'SNMP'],
        correctAnswer: 'WebSocket',
        explanation: 'WebSocket cung cấp kênh truyền song công trên một kết nối TCP.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 'src_v3_test', sourceType: 'TXT', sourceLocation: 'v3_test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q2',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 2: Mã trạng thái HTTP nào biểu thị yêu cầu bị từ chối do quyền truy cập (Forbidden)?',
        choices: ['403', '200', '301', '502'],
        correctAnswer: '403',
        explanation: 'HTTP 403 Forbidden biểu thị máy chủ từ chối thực hiện yêu cầu.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 'src_v3_test', sourceType: 'TXT', sourceLocation: 'v3_test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q3',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 3: Trong chế độ Thi (EXAM), đáp án đúng được hiển thị khi nào?',
        choices: [
          'Sau khi BTC bấm Công bố đáp án',
          'Ngay sau câu 1',
          'Trước khi thi',
          'Khi bấm nút gợi ý',
        ],
        correctAnswer: 'Sau khi BTC bấm Công bố đáp án',
        explanation: 'Đáp án đúng được giữ bí mật cho tới khi BTC chủ động công bố.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 'src_v3_test', sourceType: 'TXT', sourceLocation: 'v3_test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q4',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 4: Chuẩn hóa chuỗi tiếng Việt để bỏ dấu dùng phương thức nào trong JavaScript?',
        choices: ['normalize("NFD")', 'toFixed(2)', 'padStart(5)', 'charCodeAt(0)'],
        correctAnswer: 'normalize("NFD")',
        explanation: 'normalize("NFD") tách ký tự cơ sở và dấu thanh để lọc dấu.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 'src_v3_test', sourceType: 'TXT', sourceLocation: 'v3_test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q5',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 5: Khi BTC bấm Kết thúc đợt thi, bài đang làm dở sẽ được xử lý thế nào?',
        choices: [
          'Tự động thu và chấm phần đã làm',
          'Xóa trắng toàn bộ bài',
          'Tặng điểm tối đa',
          'Bắt làm lại từ đầu',
        ],
        correctAnswer: 'Tự động thu và chấm phần đã làm',
        explanation: 'Hệ thống tự động nộp bài và chấm điểm trung thực các câu đã trả lời.',
        difficulty: 'MEDIUM',
        sourceReference: { sourceId: 'src_v3_test', sourceType: 'TXT', sourceLocation: 'v3_test.txt' },
        timeLimitSeconds: 30,
      },
    ],
  };
}

async function runV3ComprehensiveAcceptanceTests() {
  console.log('================================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ NGHIỆM THU TOÀN DIỆN AI GAME PLATFORM V3 (STAGE 1 -> STAGE 6)');
  console.log('================================================================================\n');

  initDatabase(':memory:');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '..');

  // ===========================================================================
  // STAGE 1: SOUND PACKS, REAL WAV ASSETS, MANIFEST & SOUND MANAGER UNIT TESTS
  // ===========================================================================
  console.log('--- [STAGE 1] Kiểm thử Bộ Âm Thanh Chủ Đề (Sound Packs) & Tệp WAV Thật ---');

  const expectedPacks = ['ARCADE_FUN', 'CLASSROOM_QUIZ', 'ADVENTURE_QUEST', 'CORPORATE_TRAINING'] as const;
  const expectedCues = ['correct', 'wrong', 'timeout', 'countdown', 'start', 'finish', 'top3'] as const;

  const publicManifestPath = path.join(projectRoot, 'public', 'audio', 'packs', 'manifest.json');
  const frontendManifestPath = path.join(projectRoot, 'frontend', 'public', 'audio', 'packs', 'manifest.json');
  assert.ok(fs.existsSync(publicManifestPath), 'public/audio/packs/manifest.json phải tồn tại');
  assert.ok(fs.existsSync(frontendManifestPath), 'frontend/public/audio/packs/manifest.json phải tồn tại');

  const manifestData = JSON.parse(fs.readFileSync(publicManifestPath, 'utf-8'));
  assert.ok(
    String(manifestData.license || '').startsWith('CC0-1.0'),
    'Manifest phải khai báo rõ license CC0-1.0'
  );
  assert.equal(SOUND_PACK_CATALOG.length, 4, 'SOUND_PACK_CATALOG phải có đủ 4 bộ âm thanh chủ đề');
  assert.equal(SFX_CUE_CATALOG.length, 7, 'SFX_CUE_CATALOG phải có đủ 7 hiệu ứng âm thanh');

  let verifiedWavFilesCount = 0;
  for (const packId of expectedPacks) {
    const resolved = resolveSoundPackDefinition({ soundPackId: packId });
    assert.equal(resolved.packId, packId);
    const mappedPreset = mapSoundPackToPresetId(packId);
    assert.ok(mappedPreset !== 'NONE', `Pack ${packId} phải ánh xạ sang preset hợp lệ`);

    for (const cue of expectedCues) {
      const wavPath = path.join(projectRoot, 'public', 'audio', 'packs', packId.toLowerCase(), `${cue}.wav`);
      assert.ok(fs.existsSync(wavPath), `File WAV phải tồn tại: ${wavPath}`);
      const buf = fs.readFileSync(wavPath);
      assert.ok(
        buf.length > 4000,
        `File WAV ${packId}/${cue}.wav phải có dữ liệu âm thanh thực (>4KB), nhận ${buf.length}B`
      );
      assert.equal(buf.subarray(0, 4).toString('ascii'), 'RIFF', `Header RIFF hợp lệ cho ${packId}/${cue}.wav`);
      assert.equal(buf.subarray(8, 12).toString('ascii'), 'WAVE', `Header WAVE hợp lệ cho ${packId}/${cue}.wav`);
      verifiedWavFilesCount++;
    }
  }
  assert.equal(verifiedWavFilesCount, 28, 'Phải xác minh đủ 28 tệp WAV thật (4 packs x 7 cues)');

  // Kiểm thử contract schema với các trường V3 mới
  const parsedV3AudioCfg = GameAudioConfigSchema.parse({
    enabled: true,
    soundPackId: 'ARCADE_FUN',
    presetId: 'ENERGETIC_ARENA',
    bgmEnabled: true,
    sfxEnabled: true,
    countdownSoundEnabled: true,
    countdownTriggerSeconds: 5,
    volume: 75,
    customSfxOverrides: {
      correct: {
        url: '/uploads/audio/custom_correct.wav',
        name: 'custom_correct.wav',
        mimeType: 'audio/wav',
      },
    },
  });
  assert.equal(parsedV3AudioCfg.soundPackId, 'ARCADE_FUN');
  assert.equal(parsedV3AudioCfg.customSfxOverrides?.correct?.url, '/uploads/audio/custom_correct.wav');
  console.log('✓ [STAGE 1] Đã xác minh 4 bộ âm thanh chủ đề, 28 tệp WAV thật (RIFF/WAVE) và schema V3!');

  // ===========================================================================
  // KHỞI ĐỘNG SERVER TÍCH HỢP THẬT (HTTP + WEBSOCKET + SQLITE)
  // ===========================================================================
  const app = createApp();
  const server = http.createServer(app);
  const wsServer = new MultiplayerWebSocketServer();
  wsServer.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const btcEmail = `btc.v3.${Date.now()}@matbao.ws`;
    const btcAuth = await authService.register({
      email: btcEmail,
      displayName: 'BTC Nghiệm Thu V3',
      password: 'Password123!',
    });
    const btcHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${btcAuth.token}`,
    };

    // Kiểm tra truy cập HTTP tới các tệp WAV của từng bộ âm thanh
    for (const packId of expectedPacks) {
      const res = await fetch(`${baseUrl}/audio/packs/${packId.toLowerCase()}/correct.wav`);
      assert.equal(res.status, 200, `GET /audio/packs/${packId.toLowerCase()}/correct.wav phải trả về 200`);
    }

    // =========================================================================
    // STAGE 2: MULTIPLAYER JOIN — ROSTER API & ACCENT-INSENSITIVE FILTERING
    // =========================================================================
    console.log('\n--- [STAGE 2] Kiểm thử Danh sách người chơi Chơi nhóm (Trùng tên, Không dấu, Bảo mật) ---');
    const mpGameId = `game_v3_mp_${Date.now()}`;
    const mpSpec = createFiveQuestionExamSpec(mpGameId, {
      sessionMode: 'PLAY',
      rosterMode: 'PRECONFIGURED',
    });
    gameStore.save(mpSpec, Date.now(), btcAuth.user.userId, true);

    const mpRosterImportRes = await fetch(`${baseUrl}/api/games/${mpGameId}/participants`, {
      method: 'POST',
      headers: btcHeaders,
      body: JSON.stringify({
        replaceAll: true,
        rosterMode: 'PRECONFIGURED',
        participants: [
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kinh doanh' },
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kỹ thuật' },
          { fullName: 'Trần Thị Bích', departmentUnit: 'Phòng Nhân sự' },
          { fullName: 'Lê Hoàng Cường', departmentUnit: 'Ban Giám đốc' },
        ],
      }),
    });
    assert.equal(mpRosterImportRes.status, 200);

    const publicParticipantsRes = await fetch(`${baseUrl}/api/games/${mpGameId}/participants`);
    assert.equal(publicParticipantsRes.status, 200);
    const publicParticipantsJson = (await publicParticipantsRes.json()) as any;
    const publicParticipants = publicParticipantsJson.data.participants as any[];
    assert.equal(publicParticipants.length, 4);
    for (const p of publicParticipants) {
      assert.equal(typeof p.participantId, 'string');
      assert.equal(typeof p.fullName, 'string');
      assert.equal(typeof p.status, 'string');
      assert.equal(p.activeLockToken, undefined, 'API công khai không được làm lộ activeLockToken');
    }
    console.log(
      '✓ [STAGE 2] API danh sách người chơi trả đầy đủ trạng thái, phân biệt trùng tên và ẩn thông tin nhạy cảm!'
    );

    // =========================================================================
    // STAGE 3: SOLO PLAY — WITH ROSTER (HIGHEST_SCORE + REPLAY) & WITHOUT ROSTER
    // =========================================================================
    console.log('\n--- [STAGE 3] Kiểm thử Chơi Cá Nhân (Có danh sách & Không có danh sách) ---');

    // 3A. Chơi cá nhân CÓ danh sách + chính sách HIGHEST_SCORE + Chơi lại
    const soloRosterGameId = `game_v3_solo_roster_${Date.now()}`;
    const soloRosterSpec = createFiveQuestionExamSpec(soloRosterGameId, {
      questionCount: 2,
      sessionMode: 'PLAY',
      rosterMode: 'PRECONFIGURED',
      officialAttemptPolicy: 'HIGHEST_SCORE',
    });
    soloRosterSpec.questions = soloRosterSpec.questions.slice(0, 2);
    gameStore.save(soloRosterSpec, Date.now(), btcAuth.user.userId, true);

    const importedSoloRoster = persistenceRepo.upsertParticipants(
      soloRosterGameId,
      [{ fullName: 'Phạm Quốc Bảo', departmentUnit: 'Khối Công nghệ' }],
      true
    );
    const baoParticipant = importedSoloRoster[0];

    const runSoloAttempt = async (
      gameId: string,
      participantId: string | undefined,
      displayName: string,
      correctAnswersCount: number
    ) => {
      const createRes = await fetch(`${baseUrl}/api/games/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          participantId,
          displayName,
          departmentUnit: 'Khối Công nghệ',
        }),
      });
      assert.equal(createRes.status, 200);
      const createData = ((await createRes.json()) as any).data;
      const sid = createData.sessionId;

      const startRes = await fetch(`${baseUrl}/api/games/sessions/${sid}/start`, {
        method: 'POST',
      });
      assert.equal(startRes.status, 200);

      // Câu 1
      await fetch(`${baseUrl}/api/games/sessions/${sid}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: 'q1',
          answer: correctAnswersCount >= 1 ? 'WebSocket' : 'FTP',
        }),
      });
      await fetch(`${baseUrl}/api/games/sessions/${sid}/next`, {
        method: 'POST',
      });
      // Câu 2
      await fetch(`${baseUrl}/api/games/sessions/${sid}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: 'q2',
          answer: correctAnswersCount >= 2 ? '403' : '200',
        }),
      });
      const finishNextRes = await fetch(`${baseUrl}/api/games/sessions/${sid}/next`, {
        method: 'POST',
      });
      assert.equal(finishNextRes.status, 200);
    };

    // Lượt 1: Đúng 1/2 (100đ) -> Lượt 2: Đúng 2/2 (200đ) -> Lượt 3: Đúng 0/2 (0đ)
    await runSoloAttempt(soloRosterGameId, baoParticipant.participantId, baoParticipant.fullName, 1);
    await runSoloAttempt(soloRosterGameId, baoParticipant.participantId, baoParticipant.fullName, 2);
    await runSoloAttempt(soloRosterGameId, baoParticipant.participantId, baoParticipant.fullName, 0);

    const baoUpdated = persistenceRepo.getParticipantById(soloRosterGameId, baoParticipant.participantId);
    assert.ok(baoUpdated);
    assert.equal(baoUpdated.usedAttempts, 3, 'Phải ghi nhận đủ 3 lượt chơi của Phạm Quốc Bảo');
    assert.equal(
      baoUpdated.bestScore,
      200,
      `Chính sách HIGHEST_SCORE phải giữ điểm cao nhất là 200 sau khi lượt 3 đạt 0 điểm (nhận: ${baoUpdated.bestScore})`
    );
    const baoScoreboard = persistenceRepo.getGameScoreboard(soloRosterGameId);
    assert.equal(baoScoreboard.entries[0].score, 200, 'Bảng điểm chính thức phải lấy HIGHEST_SCORE = 200');
    const baoAttemptsHistory = persistenceRepo.listParticipantAttempts(
      soloRosterGameId,
      baoParticipant.participantId
    );
    assert.equal(baoAttemptsHistory.length, 3, 'Lịch sử game_participant_attempts phải lưu đủ 3 lượt');
    console.log(
      '✓ [STAGE 3A] Chơi cá nhân CÓ danh sách: cho phép chơi lại nhiều lần và bảo toàn điểm cao nhất (HIGHEST_SCORE = 200)!'
    );

    // 3B. Chơi cá nhân KHÔNG có danh sách (Free-text Name Gate)
    const soloFreeGameId = `game_v3_solo_free_${Date.now()}`;
    const soloFreeSpec = createFiveQuestionExamSpec(soloFreeGameId, {
      questionCount: 2,
      sessionMode: 'PLAY',
      rosterMode: 'FREE_TEXT',
    });
    soloFreeSpec.questions = soloFreeSpec.questions.slice(0, 2);
    gameStore.save(soloFreeSpec, Date.now(), btcAuth.user.userId, true);

    // Không được vào câu 1 nếu thiếu tên hoặc tên chỉ có khoảng trắng
    const emptyNameRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: soloFreeGameId, displayName: '   ' }),
    });
    assert.equal(emptyNameRes.status, 400, 'Chơi cá nhân không danh sách phải chặn tên rỗng/khoảng trắng');
    const emptyNameJson = (await emptyNameRes.json()) as any;
    assert.equal(emptyNameJson.error.code, 'PLAYER_NAME_REQUIRED');

    // Nhập tên hợp lệ -> chơi -> hoàn thành
    await runSoloAttempt(soloFreeGameId, undefined, 'Lê Minh Tự Do', 2);

    const rosterRowsInFreeGame = persistenceRepo.listParticipants(soloFreeGameId).participants;
    assert.equal(
      rosterRowsInFreeGame.length,
      0,
      'Chơi tự do không danh sách TUYỆT ĐỐI KHÔNG được tự tạo dòng giả trong game_participants'
    );
    const freeAttempts = persistenceRepo.listParticipantAttempts(soloFreeGameId);
    assert.equal(freeAttempts.length, 1, 'Lượt chơi tự do phải được lưu vào game_participant_attempts');
    assert.equal(freeAttempts[0].participantId, null, 'participantId của lượt chơi tự do phải là null');
    assert.equal(freeAttempts[0].displayName, 'Lê Minh Tự Do');
    assert.equal(freeAttempts[0].score, 200);
    console.log(
      '✓ [STAGE 3B] Chơi cá nhân KHÔNG danh sách: chặn tên rỗng, lưu kết quả chuẩn với participantId=null và không tạo dòng giả trong roster!'
    );

    // =========================================================================
    // STAGE 4: SOLO EXAM — MANDATORY ROSTER & EXAM WINDOW ENFORCEMENT
    // =========================================================================
    console.log('\n--- [STAGE 4] Kiểm thử Thi Cá Nhân (Bắt buộc Danh sách Thí sinh & Khung giờ đóng/mở) ---');

    const examNoRosterGameId = `game_v3_exam_noroster_${Date.now()}`;
    const examNoRosterSpec = createFiveQuestionExamSpec(examNoRosterGameId);
    gameStore.save(examNoRosterSpec, Date.now(), btcAuth.user.userId, true);

    // 4A. Chặn bắt đầu bài thi khi chưa có danh sách thí sinh
    const noRosterAttemptRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: examNoRosterGameId, displayName: 'Thí sinh Tự Ý Vào Thi' }),
    });
    assert.equal(noRosterAttemptRes.status, 400);
    const noRosterAttemptJson = (await noRosterAttemptRes.json()) as any;
    assert.equal(
      noRosterAttemptJson.error.code,
      'EXAM_ROSTER_REQUIRED',
      'Đợt thi chưa có danh sách thí sinh phải trả lỗi EXAM_ROSTER_REQUIRED'
    );

    // Sau khi import danh sách thí sinh, nếu gọi API không truyền participantId -> phải bị chặn 400 PARTICIPANT_REQUIRED
    persistenceRepo.upsertParticipants(
      examNoRosterGameId,
      [{ fullName: 'Đặng Thu Hà', departmentUnit: 'Phòng Kế toán' }],
      true
    );
    const missingPidRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: examNoRosterGameId, displayName: 'Đặng Thu Hà' }),
    });
    assert.equal(missingPidRes.status, 400);
    const missingPidJson = (await missingPidRes.json()) as any;
    assert.equal(missingPidJson.error.code, 'PARTICIPANT_REQUIRED');

    // Truyền participantId giả mạo -> phải bị chặn 404 PARTICIPANT_NOT_FOUND
    const fakePidRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: examNoRosterGameId,
        displayName: 'Đặng Thu Hà',
        participantId: 'fake_pid_999999',
      }),
    });
    assert.equal(fakePidRes.status, 404);
    assert.equal(((await fakePidRes.json()) as any).error.code, 'PARTICIPANT_NOT_FOUND');

    // 4B. Kiểm tra khung giờ mở / đóng bài thi (examOpenAt / examCloseAt)
    const futureOpenGameId = `game_v3_exam_future_${Date.now()}`;
    const futureOpenSpec = createFiveQuestionExamSpec(futureOpenGameId, {
      examOpenAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    gameStore.save(futureOpenSpec, Date.now(), btcAuth.user.userId, true);
    const futureRoster = persistenceRepo.upsertParticipants(
      futureOpenGameId,
      [{ fullName: 'Vũ Minh Quân', departmentUnit: 'Phòng Pháp chế' }],
      true
    );
    const futureRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: futureOpenGameId,
        displayName: 'Vũ Minh Quân',
        participantId: futureRoster[0].participantId,
      }),
    });
    assert.equal(futureRes.status, 403);
    assert.equal(((await futureRes.json()) as any).error.code, 'EXAM_NOT_OPEN_YET');
    console.log(
      '✓ [STAGE 4] Thi cá nhân bắt buộc danh sách thí sinh (EXAM_ROSTER_REQUIRED, PARTICIPANT_REQUIRED) và kiểm soát khung giờ mở/đóng chuẩn xác!'
    );

    // =========================================================================
    // STAGE 5: BTC CLOSE EXAM & AUTO-SUBMIT ACROSS 4 CANDIDATE STATES
    // =========================================================================
    console.log('\n--- [STAGE 5] Kiểm thử BTC Kết thúc đợt thi & Tự động thu bài (4 Trạng thái Thí sinh) ---');

    const closeExamGameId = `game_v3_close_exam_${Date.now()}`;
    const closeExamSpec = createFiveQuestionExamSpec(closeExamGameId);
    gameStore.save(closeExamSpec, Date.now(), btcAuth.user.userId, true);

    const fiveCandidates = persistenceRepo.upsertParticipants(
      closeExamGameId,
      [
        { fullName: 'Thí sinh A (Đã nộp đủ 5/5)', departmentUnit: 'Đội 1' },
        { fullName: 'Thí sinh B (Đang làm dở 3/5)', departmentUnit: 'Đội 2' },
        { fullName: 'Thí sinh C (Mới vào làm 0/5)', departmentUnit: 'Đội 3' },
        { fullName: 'Thí sinh D (Chưa vào thi)', departmentUnit: 'Đội 4' },
        { fullName: 'Thí sinh E (Vào sau khi đóng)', departmentUnit: 'Đội 5' },
      ],
      true
    );

    const [candA, candB, candC, candD, candE] = fiveCandidates;
    const correctMap: Record<string, string> = {
      q1: 'WebSocket',
      q2: '403',
      q3: 'Sau khi BTC bấm Công bố đáp án',
      q4: 'normalize("NFD")',
      q5: 'Tự động thu và chấm phần đã làm',
    };

    // 1. Thí sinh A hoàn thành 5/5 câu đúng trước khi BTC kết thúc đợt thi
    const createARes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: closeExamGameId,
        displayName: candA.fullName,
        participantId: candA.participantId,
      }),
    });
    assert.equal(createARes.status, 200);
    const sidA = ((await createARes.json()) as any).data.sessionId;
    await fetch(`${baseUrl}/api/games/sessions/${sidA}/start`, { method: 'POST' });
    for (const qId of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      await fetch(`${baseUrl}/api/games/sessions/${sidA}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: qId, answer: correctMap[qId] }),
      });
      await fetch(`${baseUrl}/api/games/sessions/${sidA}/next`, { method: 'POST' });
    }

    // 2. Thí sinh B trả lời đúng 3/5 câu (q1, q2, q3) và đang dừng ở câu q4 khi BTC kết thúc đợt thi
    const createBRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: closeExamGameId,
        displayName: candB.fullName,
        participantId: candB.participantId,
      }),
    });
    assert.equal(createBRes.status, 200);
    const sidB = ((await createBRes.json()) as any).data.sessionId;
    await fetch(`${baseUrl}/api/games/sessions/${sidB}/start`, { method: 'POST' });
    for (const qId of ['q1', 'q2', 'q3']) {
      await fetch(`${baseUrl}/api/games/sessions/${sidB}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: qId, answer: correctMap[qId] }),
      });
      await fetch(`${baseUrl}/api/games/sessions/${sidB}/next`, { method: 'POST' });
    }

    // 3. Thí sinh C mới vào thi, chưa trả lời câu nào (0/5)
    const createCRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: closeExamGameId,
        displayName: candC.fullName,
        participantId: candC.participantId,
      }),
    });
    assert.equal(createCRes.status, 200);
    const sidC = ((await createCRes.json()) as any).data.sessionId;
    await fetch(`${baseUrl}/api/games/sessions/${sidC}/start`, { method: 'POST' });

    // 4. Thí sinh D không bắt đầu bài thi

    // Kiểm tra bảo mật: người dùng không có token BTC gọi close-exam -> bị chặn 401/403
    const unauthCloseRes = await fetch(`${baseUrl}/api/games/${closeExamGameId}/close-exam`, {
      method: 'POST',
    });
    assert.ok(
      unauthCloseRes.status === 401 || unauthCloseRes.status === 403,
      `Người dùng không xác thực không được phép đóng đợt thi (nhận: ${unauthCloseRes.status})`
    );

    // BTC bấm "Kết thúc đợt thi & Thu bài"
    const btcCloseRes = await fetch(`${baseUrl}/api/games/${closeExamGameId}/close-exam`, {
      method: 'POST',
      headers: btcHeaders,
    });
    assert.equal(btcCloseRes.status, 200);
    const btcCloseData = ((await btcCloseRes.json()) as any).data;
    assert.equal(btcCloseData.examStatus, 'CLOSED');
    assert.equal(btcCloseData.alreadyClosed, false);
    assert.equal(
      btcCloseData.autoSubmittedSoloCount,
      2,
      'Phải tự động thu bài của đúng 2 phiên đang làm dở (Thí sinh B và C)'
    );
    assert.equal(
      btcCloseData.answersPublished,
      false,
      'Kết thúc đợt thi KHÔNG được tự động công bố đáp án khi BTC chưa bấm Công bố'
    );

    // Kiểm tra trạng thái chi tiết của từng thí sinh trên Bảng điểm BTC
    const scoreboardRes = await fetch(`${baseUrl}/api/games/${closeExamGameId}/scoreboard`, {
      headers: btcHeaders,
    });
    assert.equal(scoreboardRes.status, 200);
    const scoreboardData = ((await scoreboardRes.json()) as any).data;
    const partMap = new Map<string, any>(
      scoreboardData.entries.map((p: any) => [p.participantId, p])
    );

    const afterA = partMap.get(candA.participantId)!;
    assert.equal(afterA.status, 'COMPLETED');
    assert.equal(afterA.score, 500, 'Thí sinh A đã nộp trước phải giữ nguyên 500 điểm');
    assert.equal(afterA.correctAnswers, 5);
    assert.equal(afterA.isPassed, true);

    const afterB = partMap.get(candB.participantId)!;
    assert.equal(afterB.status, 'COMPLETED', 'Thí sinh B đang làm dở 3/5 phải được chuyển sang COMPLETED');
    assert.equal(afterB.score, 300, 'Thí sinh B làm đúng 3/5 câu phải được chấm đúng 300 điểm');
    assert.equal(afterB.correctAnswers, 3);
    assert.equal(afterB.accuracyPercent, 60);
    assert.equal(afterB.isPassed, true, 'Thí sinh B đạt 60% (>= ngưỡng 60%) phải được đánh giá ĐẠT');

    const attemptsB = persistenceRepo.listParticipantAttempts(closeExamGameId, candB.participantId);
    assert.equal(attemptsB.length, 1);
    assert.equal(attemptsB[0].state, 'FINISHED');
    assert.equal(attemptsB[0].score, 300);

    const afterC = partMap.get(candC.participantId)!;
    assert.equal(afterC.status, 'COMPLETED', 'Thí sinh C mới vào làm 0/5 câu cũng phải được tự động thu bài');
    assert.equal(afterC.score, 0, 'Thí sinh C chưa trả lời câu nào đạt 0 điểm');
    assert.equal(afterC.correctAnswers, 0);
    assert.equal(afterC.isPassed, false);

    const afterD = partMap.get(candD.participantId)!;
    assert.equal(afterD.status, 'PENDING', 'Thí sinh D chưa từng bắt đầu thi phải giữ trạng thái PENDING');
    assert.equal(afterD.usedAttempts, 0, 'Không được tạo attempt giả cho Thí sinh D chưa vào thi');

    // Thí sinh B cố gửi đáp án trễ cho câu q4 sau khi đợt thi đã kết thúc -> phải bị chặn 403 EXAM_CLOSED
    const lateAnswerBRes = await fetch(`${baseUrl}/api/games/sessions/${sidB}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: 'q4', answer: 'normalize("NFD")' }),
    });
    assert.equal(lateAnswerBRes.status, 403, 'Gửi đáp án trễ sau khi đóng đợt thi phải bị chặn 403');
    assert.equal(((await lateAnswerBRes.json()) as any).error.code, 'EXAM_CLOSED');

    // Thí sinh E cố vào thi sau khi đợt thi đã kết thúc -> phải bị chặn 403 EXAM_CLOSED
    const lateStartERes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: closeExamGameId,
        displayName: candE.fullName,
        participantId: candE.participantId,
      }),
    });
    assert.equal(lateStartERes.status, 403, 'Vào thi mới sau khi đóng đợt thi phải bị chặn 403');
    assert.equal(((await lateStartERes.json()) as any).error.code, 'EXAM_CLOSED');

    // Gọi close-exam lần thứ 2 -> Idempotent, không tạo bản ghi trùng
    const secondCloseRes = await fetch(`${baseUrl}/api/games/${closeExamGameId}/close-exam`, {
      method: 'POST',
      headers: btcHeaders,
    });
    assert.equal(secondCloseRes.status, 200);
    assert.equal(((await secondCloseRes.json()) as any).data.alreadyClosed, true);
    assert.equal(persistenceRepo.listParticipantAttempts(closeExamGameId, candB.participantId).length, 1);

    // BTC bấm "Công bố đáp án" sau khi đã kết thúc đợt thi
    const publishRes = await fetch(`${baseUrl}/api/games/${closeExamGameId}/publish-answers`, {
      method: 'POST',
      headers: btcHeaders,
    });
    assert.equal(publishRes.status, 200);

    // 5B. Kiểm tra khôi phục & thu bài phiên mồ côi trong SQLite (mô phỏng server restart khi thí sinh đang IN_PROGRESS)
    const orphanExamGameId = `game_v3_orphan_exam_${Date.now()}`;
    const orphanExamSpec = createFiveQuestionExamSpec(orphanExamGameId);
    gameStore.save(orphanExamSpec, Date.now(), btcAuth.user.userId, true);
    const [orphanCand] = persistenceRepo.upsertParticipants(
      orphanExamGameId,
      [{ fullName: 'Thí sinh Phiên Mồ Côi (Server Restart)', departmentUnit: 'Đội Hạ tầng' }],
      true
    );
    persistenceRepo.recordParticipantAttemptStart({
      gameId: orphanExamGameId,
      participantId: orphanCand.participantId,
      sessionId: `orphan_sess_${Date.now()}`,
      deliveryMode: 'SOLO',
      sessionMode: 'EXAM',
      displayName: orphanCand.fullName,
      departmentUnit: orphanCand.departmentUnit,
      employeeCode: '',
      lockToken: `lock_orphan_${Date.now()}`,
      totalQuestions: 5,
      maxPossibleScore: 500,
    });
    const orphanCloseRes = await fetch(`${baseUrl}/api/games/${orphanExamGameId}/close-exam`, {
      method: 'POST',
      headers: btcHeaders,
    });
    assert.equal(orphanCloseRes.status, 200);
    const orphanCloseData = ((await orphanCloseRes.json()) as any).data;
    assert.equal(orphanCloseData.dbFinalizedCount, 1, 'Phải tự động chốt 1 phiên IN_PROGRESS mồ côi trong SQLite');
    const orphanAfter = persistenceRepo.getParticipantById(orphanExamGameId, orphanCand.participantId)!;
    assert.equal(orphanAfter.status, 'COMPLETED');
    assert.equal(orphanAfter.usedAttempts, 1);

    console.log(
      '✓ [STAGE 5] Quy trình BTC kết thúc đợt thi, tự động nộp bài 4 trạng thái & chốt phiên mồ côi SQLite hoạt động chính xác 100%!'
    );

    // =========================================================================
    // STAGE 6A: 100-PLAYER CONCURRENT LOAD TEST WITH LIVE EXAM CLOSE AUTO-SUBMIT
    // =========================================================================
    console.log('\n--- [STAGE 6A] Kiểm thử Chịu tải 100 Thí sinh Đồng thời & Đóng đợt thi Trực tiếp ---');

    const loadGameId = `game_v3_load100_${Date.now()}`;
    const loadSpec = createFiveQuestionExamSpec(loadGameId, {
      questionCount: 4,
    });
    loadSpec.questions = loadSpec.questions.slice(0, 4);
    gameStore.save(loadSpec, Date.now(), btcAuth.user.userId, true);

    const loadRosterInput = Array.from({ length: 100 }, (_, i) => ({
      fullName: `Thí sinh Chịu Tải ${String(i + 1).padStart(3, '0')}`,
      departmentUnit: `Đơn vị ${(i % 5) + 1}`,
    }));
    const loadParticipants = persistenceRepo.upsertParticipants(loadGameId, loadRosterInput, true);
    assert.equal(loadParticipants.length, 100);

    const latenciesMs: number[] = [];
    let http500Count = 0;

    const timedFetch = async (url: string, init?: RequestInit) => {
      const t0 = performance.now();
      const res = await fetch(url, init);
      latenciesMs.push(performance.now() - t0);
      if (res.status >= 500) http500Count++;
      return res;
    };

    const activeSessionIds: string[] = [];
    const batchSize = 10;
    for (let batchStart = 0; batchStart < loadParticipants.length; batchStart += batchSize) {
      const batch = loadParticipants.slice(batchStart, batchStart + batchSize);
      await Promise.all(
        batch.map(async (p, localIdx) => {
          const idx = batchStart + localIdx;
          const sRes = await timedFetch(`${baseUrl}/api/games/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gameId: loadGameId,
              displayName: p.fullName,
              participantId: p.participantId,
              departmentUnit: p.departmentUnit,
            }),
          });
          assert.equal(sRes.status, 200);
          const sid = ((await sRes.json()) as any).data.sessionId;
          await timedFetch(`${baseUrl}/api/games/sessions/${sid}/start`, { method: 'POST' });

          if (idx < 40) {
            for (const qId of ['q1', 'q2', 'q3', 'q4']) {
              await timedFetch(`${baseUrl}/api/games/sessions/${sid}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questionId: qId, answer: correctMap[qId] }),
              });
              await timedFetch(`${baseUrl}/api/games/sessions/${sid}/next`, { method: 'POST' });
            }
          } else if (idx < 80) {
            activeSessionIds.push(sid);
            for (const qId of ['q1', 'q2']) {
              await timedFetch(`${baseUrl}/api/games/sessions/${sid}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questionId: qId, answer: correctMap[qId] }),
              });
              await timedFetch(`${baseUrl}/api/games/sessions/${sid}/next`, { method: 'POST' });
            }
          } else {
            activeSessionIds.push(sid);
          }
        })
      );
    }

    const [closeLoadRes] = await Promise.all([
      timedFetch(`${baseUrl}/api/games/${loadGameId}/close-exam`, {
        method: 'POST',
        headers: btcHeaders,
      }),
      ...activeSessionIds.slice(0, 20).map((sid) =>
        timedFetch(`${baseUrl}/api/games/sessions/${sid}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: 'q3', answer: correctMap.q3 }),
        })
      ),
    ]);

    assert.equal(closeLoadRes.status, 200);
    assert.equal(http500Count, 0, 'Tuyệt đối không có lỗi 500 dưới tải 100 thí sinh đồng thời');

    const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
    const p50 = Number(sortedLatencies[Math.floor(sortedLatencies.length * 0.5)].toFixed(2));
    const p95 = Number(sortedLatencies[Math.floor(sortedLatencies.length * 0.95)].toFixed(2));
    const p99 = Number(sortedLatencies[Math.floor(sortedLatencies.length * 0.99)].toFixed(2));

    const allLoadParticipantsAfter = persistenceRepo.listParticipants(loadGameId, { limit: 200 }).participants;
    const completedCount = allLoadParticipantsAfter.filter((p) => p.status === 'COMPLETED').length;
    const inProgressParticles = allLoadParticipantsAfter.filter((p) => p.status === 'IN_PROGRESS').length;
    const allLoadAttempts = persistenceRepo.listParticipantAttempts(loadGameId);
    const inProgressRemaining = allLoadAttempts.filter((a) => a.state === 'IN_PROGRESS').length;

    assert.equal(completedCount, 100, 'Cả 100 thí sinh phải ở trạng thái COMPLETED sau khi đóng đợt thi');
    assert.equal(inProgressParticles, 0, 'Không còn thí sinh nào bị kẹt trạng thái IN_PROGRESS');
    assert.equal(inProgressRemaining, 0, 'Không còn bản ghi attempt nào bị kẹt trạng thái IN_PROGRESS');
    assert.equal(allLoadAttempts.length, 100, 'Đúng 100 bản ghi kết quả (không trùng lặp, không thiếu)');
    assert.ok(p95 < 400, `Độ trễ p95 phải < 400ms (thực tế: ${p95}ms)`);
    console.log(
      `✓ [STAGE 6A] Load Test 100 thí sinh PASS: 100/100 hoàn tất, 0 lỗi 500, p50=${p50}ms, p95=${p95}ms, p99=${p99}ms!`
    );

    // =========================================================================
    // STAGE 6B: REAL CHROMIUM BROWSER E2E (DESKTOP 1440x900 & MOBILE 390x844)
    // =========================================================================
    console.log('\n--- [STAGE 6B] Kiểm thử Trình duyệt Chromium Thật (Desktop 1440x900 & Mobile 390x844) ---');

    const browser = await Browser.launch(1440, 900);
    try {
      const page = await browser.newPage(1440, 900);

      // 1. Kiểm thử UI Bộ âm thanh chủ đề hợp nhất (V3 Sound Pack) & Phần Danh sách người tham gia (Creator Roster) trên DemoPage
      await page.goto(`${baseUrl}/?tab=demo`);
      await page.eval(`(() => {
        localStorage.removeItem('ai_game_audio_muted_v2');
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(btcAuth.token)});
        sessionStorage.setItem('ai_game_creator_current_session_v1', JSON.stringify({
          spec: ${JSON.stringify(closeExamSpec)},
          saveStatus: 'saved',
          savedForLater: true,
          customGameTitle: ${JSON.stringify(closeExamSpec.title)}
        }));
      })()`);
      await page.goto(`${baseUrl}/?tab=demo`);
      await sleep(750);

      const soundPackUiCheck = await page.eval(`(async () => {
        const legacyPresetSelect = document.querySelector('[data-testid="audio-preset-select"]');
        const soundPackSections = document.querySelectorAll('[data-testid="v3-sound-pack-section"]');
        const packSelect = document.querySelector('[data-testid="sound-pack-select"]');
        const sfxPanel = document.querySelector('[data-testid="sfx-cue-preview-panel"]');
        const previewBtn = document.querySelector('[data-testid="audio-preview-btn"]');
        const stopPreviewBtn = document.querySelector('[data-testid="audio-stop-preview-btn"]');
        const sessionSelect = document.querySelector('[data-testid="session-mode-select"]');
        const rosterSection = document.querySelector('[data-testid="creator-roster-section"]');
        const soundSection = document.querySelector('[data-testid="v3-sound-pack-section"]');
        const submitBtn = document.querySelector('[data-testid="create-game-submit-btn"]');
        const sm = window.__aiGameSoundManager;
        if (!packSelect || !sfxPanel || !sm || !previewBtn || !stopPreviewBtn || !sessionSelect || !rosterSection || !soundSection || !submitBtn) {
          return { ok: false };
        }

        // Kiểm tra thứ tự vị trí từ trên xuống dưới trong cột phải:
        // 5. Chế độ Vận hành -> 6. Danh sách người tham gia -> 7. Bộ âm thanh chủ đề -> Nút Tạo Game Bằng AI
        const sessionTop = sessionSelect.getBoundingClientRect().top;
        const rosterTop = rosterSection.getBoundingClientRect().top;
        const soundTop = soundSection.getBoundingClientRect().top;
        const submitTop = submitBtn.getBoundingClientRect().top;
        const isOrderCorrect = sessionTop < rosterTop && rosterTop < soundTop && soundTop < submitTop;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(packSelect, 'CORPORATE_TRAINING');
        packSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        const packAfterCorporate = packSelect.value;

        setter.call(packSelect, 'ARCADE_FUN');
        packSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));

        // Bấm Nghe thử bộ âm thanh rồi bấm nút Dừng riêng biệt
        previewBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const isPlayingAfterPreview = sm.getDiagnostics().isPreviewing;
        stopPreviewBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const isPlayingAfterStop = sm.getDiagnostics().isPreviewing;

        const btnCorrect = document.querySelector('[data-testid="preview-sfx-cue-correct"]');
        const btnTop3 = document.querySelector('[data-testid="preview-sfx-cue-top3"]');
        if (btnCorrect) btnCorrect.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterCorrect = sm.getDiagnostics();

        if (btnTop3) btnTop3.click();
        await new Promise((r) => setTimeout(r, 120));
        const afterTop3 = sm.getDiagnostics();

        return {
          ok: true,
          hasLegacyPresetSelect: Boolean(legacyPresetSelect),
          soundPackSectionsCount: soundPackSections.length,
          isOrderCorrect,
          packValue: packSelect.value,
          packAfterCorporate,
          isPlayingAfterPreview,
          isPlayingAfterStop,
          cueButtonsCount: document.querySelectorAll('[data-testid^="preview-sfx-cue-"]').length,
          overrideInputsCount: document.querySelectorAll('[data-testid^="upload-sfx-override-"]').length,
          afterCorrectSfx: afterCorrect.lastSfxPlayed,
          afterTop3Sfx: afterTop3.lastSfxPlayed,
          horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        };
      })()`);

      assert.equal(
        soundPackUiCheck.ok,
        true,
        'Bảng điều khiển Bộ âm thanh chủ đề V3 và Danh sách người tham gia phải hiển thị trên Trang Tạo Game'
      );
      assert.equal(
        soundPackUiCheck.hasLegacyPresetSelect,
        false,
        'Không còn cụm giao diện âm thanh V2 bị trùng phía trên (audio-preset-select đã xóa)'
      );
      assert.equal(
        soundPackUiCheck.soundPackSectionsCount,
        1,
        'Chỉ có duy nhất 1 khu vực Bộ âm thanh chủ đề (SFX + BGM)'
      );
      assert.equal(
        soundPackUiCheck.isOrderCorrect,
        true,
        'Thứ tự cột phải bắt buộc: Chế độ Vận hành -> Danh sách người tham gia -> Bộ âm thanh chủ đề -> Nút Tạo Game Bằng AI'
      );
      assert.equal(soundPackUiCheck.packAfterCorporate, 'CORPORATE_TRAINING');
      assert.equal(soundPackUiCheck.packValue, 'ARCADE_FUN');
      assert.equal(soundPackUiCheck.isPlayingAfterPreview, true, 'Nút Nghe thử bộ âm thanh phải phát được');
      assert.equal(soundPackUiCheck.isPlayingAfterStop, false, 'Nút Dừng phải dừng phát nghe thử ngay lập tức');
      assert.equal(soundPackUiCheck.cueButtonsCount, 7, 'Phải có đủ 7 nút nghe thử từng hiệu ứng âm thanh');
      assert.equal(soundPackUiCheck.overrideInputsCount, 7, 'Phải có đủ 7 nút tải lên ghi đè từng hiệu ứng âm thanh');
      assert.equal(soundPackUiCheck.afterCorrectSfx, 'correct');
      assert.equal(soundPackUiCheck.afterTop3Sfx, 'top3');
      assert.equal(soundPackUiCheck.horizontalOverflowPx, 0, 'Desktop 1440x900 không được tràn ngang');

      // 1B. Kiểm thử chi tiết Phần Danh sách người tham gia (Creator Roster) trên cột phải Trang Tạo Game + API Parse XLSX/CSV
      const rosterCreatorFlowCheck = await page.eval(`(async () => {
        const sessionSelect = document.querySelector('[data-testid="session-mode-select"]');
        const modeDesc = document.querySelector('[data-testid="creator-roster-mode-desc"]');
        const validBadge = document.querySelector('[data-testid="roster-valid-count-badge"]');
        const clearBtn = document.querySelector('[data-testid="creator-roster-clear-btn"]');
        const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

        // Khi mở lại closeExamSpec đã lưu (có 5 thí sinh): danh sách phải tự động khôi phục 5 người
        const initialLoadedCountText = validBadge ? validBadge.textContent.trim() : '';

        // Xóa danh sách khi đang ở chế độ EXAM -> phải hiển thị cảnh báo bắt buộc danh sách thí sinh
        if (clearBtn) clearBtn.click();
        await new Promise((r) => setTimeout(r, 60));
        const examDescText = modeDesc ? modeDesc.textContent.trim() : '';
        const hasExamRequiredWarning = Boolean(
          document.querySelector('[data-testid="creator-roster-exam-required-error"]')
        );

        // Đổi sang chế độ PLAY -> phụ đề đổi sang "Tùy chọn — có thể để trống" và ẩn cảnh báo bắt buộc EXAM
        selectSetter.call(sessionSelect, 'PLAY');
        sessionSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        const playDescText = modeDesc ? modeDesc.textContent.trim() : '';
        const examWarningInPlayMode = Boolean(
          document.querySelector('[data-testid="creator-roster-exam-required-error"]')
        );

        // Nhập thủ công nhiều dòng (có 2 người trùng tên, 1 dòng trống, 1 dòng lỗi "12345")
        const textarea = document.querySelector('[data-testid="creator-roster-manual-textarea"]');
        textareaSetter.call(
          textarea,
          'Nguyễn Văn An | Phòng Kỹ Thuật | NV01\\n\\nNguyễn Văn An | Phòng Kinh Doanh | NV02\\n12345\\nTrần Thị Bình | Phòng Nhân Sự'
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));

        // Thêm 1 người bằng ô nhập nhanh
        const singleNameInput = document.querySelector('[data-testid="roster-single-name-input"]');
        const singleDeptInput = document.querySelector('[data-testid="roster-single-dept-input"]');
        const addSingleBtn = document.querySelector('[data-testid="roster-add-single-btn"]');
        inputSetter.call(singleNameInput, 'Lê Hoàng Cường');
        singleNameInput.dispatchEvent(new Event('input', { bubbles: true }));
        inputSetter.call(singleDeptInput, 'Phòng Đào Tạo');
        singleDeptInput.dispatchEvent(new Event('input', { bubbles: true }));
        addSingleBtn.click();
        await new Promise((r) => setTimeout(r, 80));

        const hasDupWarning = Boolean(document.querySelector('[data-testid="roster-duplicate-warning"]'));
        const hasInvalidError = Boolean(document.querySelector('[data-testid="roster-invalid-lines-error"]'));
        const rowsBeforeTabSwitch = document.querySelectorAll('[data-testid^="creator-roster-row-"]').length;

        // Chuyển qua tab Import Excel/CSV rồi quay lại tab Nhập thủ công -> không làm mất dữ liệu đã nhập
        const tabImport = document.querySelector('[data-testid="roster-tab-import"]');
        const tabManual = document.querySelector('[data-testid="roster-tab-manual"]');
        tabImport.click();
        await new Promise((r) => setTimeout(r, 60));
        tabManual.click();
        await new Promise((r) => setTimeout(r, 60));
        const rowsAfterTabSwitch = document.querySelectorAll('[data-testid^="creator-roster-row-"]').length;

        // Đổi sound pack -> không làm mất roster
        const packSelect = document.querySelector('[data-testid="sound-pack-select"]');
        selectSetter.call(packSelect, 'ADVENTURE_QUEST');
        packSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        const rowsAfterSoundPackSwitch = document.querySelectorAll('[data-testid^="creator-roster-row-"]').length;

        return {
          initialLoadedCountText,
          examDescText,
          hasExamRequiredWarning,
          playDescText,
          examWarningInPlayMode,
          hasDupWarning,
          hasInvalidError,
          rowsBeforeTabSwitch,
          rowsAfterTabSwitch,
          rowsAfterSoundPackSwitch,
        };
      })()`);

      assert.equal(
        rosterCreatorFlowCheck.initialLoadedCountText,
        'Hợp lệ: 5 người',
        'Khi mở lại game đã lưu có 5 thí sinh, mục Danh sách người tham gia phải tự khôi phục đúng 5 người'
      );
      assert.equal(
        rosterCreatorFlowCheck.examDescText,
        'Bắt buộc — cần có danh sách thí sinh',
        'Chế độ EXAM phải hiển thị phụ đề Bắt buộc — cần có danh sách thí sinh'
      );
      assert.equal(
        rosterCreatorFlowCheck.hasExamRequiredWarning,
        true,
        'Chế độ EXAM khi danh sách trống phải hiển thị cảnh báo bắt buộc danh sách thí sinh'
      );
      assert.equal(
        rosterCreatorFlowCheck.playDescText,
        'Tùy chọn — có thể để trống',
        'Chế độ PLAY phải hiển thị phụ đề Tùy chọn — có thể để trống'
      );
      assert.equal(rosterCreatorFlowCheck.examWarningInPlayMode, false);
      assert.equal(
        rosterCreatorFlowCheck.hasDupWarning,
        true,
        'Phải cảnh báo trùng tên nhưng vẫn giữ nguyên 2 người trùng tên riêng biệt'
      );
      assert.equal(
        rosterCreatorFlowCheck.hasInvalidError,
        true,
        'Phải báo dòng không hợp lệ ("12345" không chứa chữ cái)'
      );
      assert.equal(
        rosterCreatorFlowCheck.rowsBeforeTabSwitch,
        4,
        'Phải có đúng 4 người hợp lệ (2 người tên Nguyễn Văn An + Trần Thị Bình + Lê Hoàng Cường)'
      );
      assert.equal(
        rosterCreatorFlowCheck.rowsAfterTabSwitch,
        4,
        'Chuyển đổi qua lại giữa Nhập thủ công và Import Excel/CSV không được làm mất dữ liệu'
      );
      assert.equal(
        rosterCreatorFlowCheck.rowsAfterSoundPackSwitch,
        4,
        'Đổi sound pack không được làm mất danh sách người tham gia'
      );

      // Kiểm thử API Parse XLSX & CSV và chặn backend khi lưu EXAM mode với danh sách trống
      const xlsxLib: typeof XLSX = (XLSX as any).default ?? XLSX;
      const wb = xlsxLib.utils.book_new();
      const ws = xlsxLib.utils.aoa_to_sheet([
        ['Họ và tên', 'Đơn vị', 'Mã NV'],
        ['Phạm Quốc Bảo', 'Khối Công nghệ', 'NV101'],
        ['Phạm Quốc Bảo', 'Khối Kinh doanh', 'NV102'],
        ['Đặng Thu Thảo', 'Khối Tài chính', 'NV103'],
        ['123', 'Lỗi tên ngắn', 'NV104'],
      ]);
      xlsxLib.utils.book_append_sheet(wb, ws, 'DanhSach');
      const xlsxBuf = xlsxLib.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const xlsxForm = new FormData();
      xlsxForm.append(
        'file',
        new Blob([xlsxBuf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'danh_sach_thi_sinh.xlsx'
      );
      const parseXlsxRes = await fetch(`${baseUrl}/api/games/participants/parse`, {
        method: 'POST',
        headers: {
          Authorization: btcHeaders.Authorization,
        },
        body: xlsxForm,
      });
      assert.equal(parseXlsxRes.status, 200);
      const parseXlsxData = ((await parseXlsxRes.json()) as any).data;
      assert.equal(parseXlsxData.validCount, 3, 'Parse XLSX phải trích xuất đúng 3 người hợp lệ (giữ cả 2 người trùng tên)');
      assert.equal(parseXlsxData.duplicateCount, 1, 'Parse XLSX phải phát hiện 1 dòng trùng tên');
      assert.equal(parseXlsxData.invalidRows.length, 1, 'Parse XLSX phải phát hiện 1 dòng không hợp lệ');

      // Kiểm tra chặn Backend khi lưu đề thi EXAM với requireRoster=true và participants=[]
      const emptyExamPatchRes = await fetch(`${baseUrl}/api/games/${closeExamSpec.gameId}/questions`, {
        method: 'PATCH',
        headers: { ...btcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: closeExamSpec.title,
          questions: closeExamSpec.questions,
          settings: { ...closeExamSpec.settings, sessionMode: 'EXAM' },
          participants: [],
          requireRoster: true,
        }),
      });
      assert.equal(
        emptyExamPatchRes.status,
        400,
        'Backend phải chặn 400 EXAM_ROSTER_REQUIRED khi lưu đề thi EXAM với danh sách thí sinh trống'
      );
      assert.equal(((await emptyExamPatchRes.json()) as any).error.code, 'EXAM_ROSTER_REQUIRED');

      console.log(
        '✓ [E2E.1] Giao diện Bộ âm thanh chủ đề V3 hợp nhất & Danh sách người tham gia (Manual + CSV/XLSX + Validation PLAY/EXAM) hoạt động chuẩn xác!'
      );

      // 2. Kiểm thử Luồng Chơi cá nhân KHÔNG có danh sách (Free-text Name Gate) trên Trình duyệt
      await page.goto(`${baseUrl}/?play=${encodeURIComponent(soloFreeGameId)}`);
      await sleep(700);
      const freeNameGateCheck = await page.eval(`(async () => {
        const gate = document.querySelector('[data-testid="solo-free-name-gate"]');
        const startBtn = document.querySelector('[data-testid="solo-free-start-btn"]');
        const input = document.querySelector('[data-testid="solo-free-name-input"]');
        if (!gate || !startBtn || !input) return { hasGate: false };

        // Bấm Bắt đầu khi chưa nhập tên -> phải hiển thị lỗi solo-free-name-error và chưa vào Câu 1
        startBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const blockedWhenEmpty = Boolean(document.querySelector('[data-testid="solo-free-name-error"]'));

        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputSetter.call(input, 'Nguyễn Hoàng Nam');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        startBtn.click();
        await new Promise((r) => setTimeout(r, 500));
        const qButtonsCount = document.querySelectorAll('button.k-btn').length;
        return {
          hasGate: true,
          blockedWhenEmpty,
          qButtonsCount,
        };
      })()`);
      assert.equal(
        freeNameGateCheck.hasGate,
        true,
        'Phải hiển thị màn nhập tên trước khi vào Câu 1 khi chơi tự do không danh sách'
      );
      assert.equal(freeNameGateCheck.blockedWhenEmpty, true, 'Phải chặn và báo lỗi khi chưa nhập tên');
      assert.ok(freeNameGateCheck.qButtonsCount >= 2, 'Sau khi nhập tên hợp lệ và bấm Bắt đầu phải vào màn hình câu hỏi');
      console.log(
        '✓ [E2E.2] Luồng Chơi cá nhân không danh sách (Free-Text Name Gate) trên trình duyệt hoạt động chuẩn xác!'
      );

      // 3. Kiểm thử Luồng Thi cá nhân chưa có danh sách -> Hiển thị thông báo chặn rõ ràng
      const examEmptyRosterUiId = `game_v3_ui_empty_exam_${Date.now()}`;
      const examEmptySpec = createFiveQuestionExamSpec(examEmptyRosterUiId);
      gameStore.save(examEmptySpec, Date.now(), btcAuth.user.userId, true);

      await page.goto(`${baseUrl}/?play=${encodeURIComponent(examEmptyRosterUiId)}`);
      await sleep(700);
      const hasNoRosterErrorBlock = await page.eval(
        `Boolean(document.querySelector('[data-testid="solo-exam-no-roster-error"]'))`
      );
      assert.equal(
        hasNoRosterErrorBlock,
        true,
        'Đợt thi chưa có danh sách thí sinh phải hiển thị thông báo chặn solo-exam-no-roster-error'
      );
      console.log('✓ [E2E.3] Luồng Thi cá nhân chưa có danh sách hiển thị thông báo chặn rõ ràng trên trình duyệt!');

      // 4. Kiểm thử Tìm kiếm tiếng Việt không dấu + trùng tên + điều hướng bàn phím + BTC đóng đợt thi trực tiếp
      const liveCloseUiGameId = `game_v3_ui_liveclose_${Date.now()}`;
      const liveCloseSpec = createFiveQuestionExamSpec(liveCloseUiGameId);
      gameStore.save(liveCloseSpec, Date.now(), btcAuth.user.userId, true);
      persistenceRepo.upsertParticipants(
        liveCloseUiGameId,
        [
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kinh doanh' },
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kỹ thuật' },
          { fullName: 'Phạm Thị Mai', departmentUnit: 'Phòng Đào tạo' },
        ],
        true
      );

      await page.goto(`${baseUrl}/?play=${encodeURIComponent(liveCloseUiGameId)}`);
      await sleep(700);

      const rosterSearchAndStartCheck = await page.eval(`(async () => {
        const searchInput = document.querySelector('[data-testid="roster-search-input"]');
        if (!searchInput) return { ok: false, reason: 'missing searchInput' };

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(searchInput, 'nguyen van an');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));

        const dupBadges = document.querySelectorAll('[data-testid^="solo-duplicate-badge-"]');
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));

        const startBtn = document.querySelector('[data-testid="confirm-participant-identity-btn"]');
        if (startBtn) startBtn.click();
        await new Promise((r) => setTimeout(r, 600));

        const q1Btn = Array.from(document.querySelectorAll('button.k-btn')).find((b) =>
          b.textContent.includes('WebSocket')
        );
        if (q1Btn) q1Btn.click();
        await new Promise((r) => setTimeout(r, 400));

        return {
          ok: true,
          dupBadgesCount: dupBadges.length,
        };
      })()`);

      assert.equal(rosterSearchAndStartCheck.ok, true);
      assert.equal(
        rosterSearchAndStartCheck.dupBadgesCount,
        2,
        'Gõ không dấu "nguyen van an" phải hiển thị 2 thí sinh trùng tên kèm huy hiệu phân biệt đơn vị'
      );

      // Trong lúc thí sinh đang ở Câu 2, BTC gọi API đóng đợt thi -> Giao diện thí sinh tự động chuyển về màn hình Kết quả kèm thông báo đã thu bài!
      await fetch(`${baseUrl}/api/games/${liveCloseUiGameId}/close-exam`, {
        method: 'POST',
        headers: btcHeaders,
      });

      let autoSubmittedBannerVisible = false;
      for (let i = 0; i < 20; i++) {
        await sleep(300);
        autoSubmittedBannerVisible = await page.eval(
          `Boolean(document.querySelector('[data-testid="solo-exam-closed-banner"]'))`
        );
        if (autoSubmittedBannerVisible) break;
      }
      assert.equal(
        autoSubmittedBannerVisible,
        true,
        'Khi BTC kết thúc đợt thi, màn hình thí sinh đang làm bài phải tự động thu bài và hiển thị solo-exam-closed-banner'
      );
      console.log(
        '✓ [E2E.4] Tìm kiếm không dấu, phân biệt trùng tên, điều hướng bàn phím và tự động thu bài trực tiếp trên trình duyệt hoạt động chuẩn xác!'
      );

      // 5. Kiểm tra Responsive Mobile 390x844
      await page.setViewport(390, 844, true);
      await sleep(300);
      const mobileOverflowPx = await page.eval(
        `Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`
      );
      assert.equal(mobileOverflowPx, 0, `Mobile 390x844 không được tràn ngang (nhận: ${mobileOverflowPx}px)`);

      assert.equal(
        page.consoleErrors.length,
        0,
        `Không được có console.error trên trình duyệt (nhận: ${JSON.stringify(page.consoleErrors)})`
      );
      assert.equal(
        page.pageErrors.length,
        0,
        `Không được có uncaught page error trên trình duyệt (nhận: ${JSON.stringify(page.pageErrors)})`
      );
      console.log(
        '✓ [E2E.5] Kiểm tra Responsive Desktop 1440x900 & Mobile 390x844 (0px overflow, 0 console error, 0 page error) hoàn tất!'
      );

      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n================================================================================');
  console.log('✅ TOÀN BỘ KIỂM THỬ NGHIỆM THU AI GAME PLATFORM V3 ĐỀU PASS 100%!');
  console.log('================================================================================');
}

runV3ComprehensiveAcceptanceTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ KIỂM THỬ V3 THẤT BẠI:', err);
    process.exit(1);
  });
