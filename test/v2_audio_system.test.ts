import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { createApp } from '../src/app.js';
import { GameAudioConfigSchema, GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { authService } from '../src/services/auth.service.js';
import { initDatabase } from '../src/storage/sqlite.db.js';
import {
  DEFAULT_AUDIO_CONFIG,
  normalizeVolumeToPercent,
  soundManager,
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
        const details = msg.params?.exceptionDetails;
        this.pageErrors.push(details?.exception?.description || details?.text || 'Unknown exception');
      }
    });
  }

  async send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    await sleep(600);
  }

  async eval<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        `Runtime.evaluate exception: ${
          res.exceptionDetails.exception?.description || res.exceptionDetails.text
        }`
      );
    }
    return res?.result?.value as T;
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {}
  }
}

class Browser {
  private proc: ChildProcess;
  private debugPort: number;
  private userDataDir: string;

  private constructor(proc: ChildProcess, debugPort: number, userDataDir: string) {
    this.proc = proc;
    this.debugPort = debugPort;
    this.userDataDir = userDataDir;
  }

  static async launch(opts: { width: number; height: number }): Promise<Browser> {
    const chromeBin = findChromeBinary();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-audio-e2e-'));
    const debugPort = 9550 + Math.floor(Math.random() * 300);

    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${opts.width},${opts.height}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ];

    const proc = spawn(chromeBin, args, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (res.ok) return new Browser(proc, debugPort, userDataDir);
      } catch {}
      await sleep(150);
    }
    proc.kill();
    throw new Error('Failed to connect to headless Chromium CDP');
  }

  async newPage(viewport: { width: number; height: number }): Promise<CdpPage> {
    const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/new?about:blank`, {
      method: 'PUT',
    });
    const target = (await res.json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const page = new CdpPage(ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 768,
    });
    return page;
  }

  async close(): Promise<void> {
    try {
      this.proc.kill();
    } catch {}
    await sleep(200);
    try {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

function createValidWavBuffer(durationMs = 200): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34); // 8-bit
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    buf[44 + i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  }
  return buf;
}

async function runAudioSystemVerification() {
  console.log('=========================================================================');
  console.log('  AI GAME PLATFORM V2 — AUDIO SYSTEM AUDIT & AUTOMATED VERIFICATION');
  console.log('=========================================================================\n');

  // =========================================================================
  // PHASE D1: UNIT TESTS FOR GameAudioManager & Volume Normalization
  // =========================================================================
  console.log('--- [D1] Chạy Unit Tests cho GameAudioManager & Web Audio Lifecycle ---');
  {
    // 1. Kiểm tra normalizeVolumeToPercent với cả thang 0..1 và 0..100
    assert.equal(normalizeVolumeToPercent(0.5), 50, '0.5 phải được quy đổi thành 50% (không được làm tròn thành 1%)');
    assert.equal(normalizeVolumeToPercent(0.7), 70, '0.7 phải được quy đổi thành 70%');
    assert.equal(normalizeVolumeToPercent(1), 100, '1.0 phải được quy đổi thành 100%');
    assert.equal(normalizeVolumeToPercent(75), 75, '75 (thang 0..100) phải giữ nguyên 75%');
    assert.equal(normalizeVolumeToPercent(0), 0, '0 phải bằng 0%');
    assert.equal(normalizeVolumeToPercent(NaN, 65), 65, 'NaN phải trả về fallback');

    // 2. Kiểm tra GameAudioConfigSchema chấp nhận cả volume 0..1 và 0..100
    const parsedFloat = GameAudioConfigSchema.parse({ volume: 0.5, countdownSoundEnabled: false });
    assert.equal(parsedFloat.volume, 0.5);
    assert.equal(parsedFloat.countdownSoundEnabled, false);
    const parsedPercent = GameAudioConfigSchema.parse({ volume: 80 });
    assert.equal(parsedPercent.volume, 0.8);

    // 3. Mock Web Audio API & HTMLAudioElement trên môi trường Node để unit test đầy đủ lifecycle
    let mockCtxInstances = 0;
    let mockOscillatorsCreated = 0;
    let mockOscillatorsStopped = 0;
    let mockGainValues: number[] = [];
    let mockAudioPlayShouldRejectWith: string | null = null;

    class MockOscillator {
      public type: string = 'sine';
      public onended: (() => void) | null = null;
      public frequency = { setValueAtTime: (_f: number, _t: number) => {} };
      connect() {}
      disconnect() {}
      start() {
        mockOscillatorsCreated++;
      }
      stop() {
        mockOscillatorsStopped++;
        if (this.onended) this.onended();
      }
    }

    class MockGain {
      public gain = {
        setValueAtTime: (_v: number, _t: number) => {},
        linearRampToValueAtTime: (v: number, _t: number) => {
          mockGainValues.push(v);
        },
        exponentialRampToValueAtTime: (_v: number, _t: number) => {},
      };
      connect() {}
      disconnect() {}
    }

    class MockAudioContext {
      public state: string = 'suspended';
      public currentTime: number = 0;
      public destination = {};
      constructor() {
        mockCtxInstances++;
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      createOscillator() {
        return new MockOscillator();
      }
      createGain() {
        return new MockGain();
      }
    }

    class MockHTMLAudioElement {
      public src: string;
      public loop: boolean = false;
      public volume: number = 1;
      public muted: boolean = false;
      public paused: boolean = true;
      public currentTime: number = 0;
      public onerror: (() => void) | null = null;
      constructor(src?: string) {
        this.src = src || '';
      }
      play() {
        if (mockAudioPlayShouldRejectWith) {
          const err = new Error(mockAudioPlayShouldRejectWith);
          err.name = mockAudioPlayShouldRejectWith;
          return Promise.reject(err);
        }
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
      removeAttribute() {
        this.src = '';
      }
      load() {}
    }

    const origWindow = (globalThis as any).window;
    const origAudio = (globalThis as any).Audio;
    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      addEventListener: () => {},
    };
    (globalThis as any).Audio = MockHTMLAudioElement;

    try {
      // Test previewAudio với volume = 0.5 (trường hợp từng gây lỗi gainVal = 0.0006 <= 0.001)
      const started = soundManager.playPreview({
        ...DEFAULT_AUDIO_CONFIG,
        presetId: 'ENERGETIC_ARENA',
        volume: 0.5,
      });
      assert.equal(started, true, 'playPreview phải trả về true cho preset ENERGETIC_ARENA');
      const diag1 = soundManager.getDiagnostics();
      assert.equal(diag1.contextState, 'running', 'AudioContext phải được resume sang running');
      assert.equal(diag1.volume, 50, 'volume 0.5 phải được chuẩn hóa thành 50%');
      assert.equal(diag1.isPreviewing, true);
      assert.equal(diag1.isPlayingBgm, true);
      assert.ok(diag1.lastGainValue >= 0.05, `Gain thực tế phải đủ nghe (> 0.05), nhận được: ${diag1.lastGainValue}`);
      assert.ok(mockOscillatorsCreated >= 1, 'Phải khởi tạo và start ít nhất 1 OscillatorNode ngay khi bấm Nghe thử');
      assert.equal(mockCtxInstances, 1, 'Chỉ được khởi tạo đúng 1 AudioContext duy nhất');

      // Test đổi preset khi đang preview -> chuyển sang EXAM_FOCUS mà không tạo thêm AudioContext
      soundManager.playPreview({
        ...DEFAULT_AUDIO_CONFIG,
        presetId: 'EXAM_FOCUS',
        volume: 0.7,
      });
      const diag2 = soundManager.getDiagnostics();
      assert.equal(diag2.activePresetId, 'EXAM_FOCUS');
      assert.equal(diag2.lastToneFrequency, 220, 'EXAM_FOCUS phải phát nốt đầu tiên 220Hz');
      assert.equal(mockCtxInstances, 1, 'Đổi preset không được tạo AudioContext mới');

      // Test CUSTOM preset khi chưa có customAudioUrl -> phải báo lỗi và không phát nhầm ENERGETIC_ARENA
      let customMissingErr: string | null = null;
      const customStarted = soundManager.playPreview(
        {
          ...DEFAULT_AUDIO_CONFIG,
          presetId: 'CUSTOM',
          customAudioUrl: null,
        },
        {
          onError: (msg) => {
            customMissingErr = msg;
          },
        }
      );
      assert.equal(customStarted, false, 'CUSTOM không có URL phải trả về false');
      assert.ok(customMissingErr && customMissingErr.includes('tải lên'), 'Phải trả về thông báo lỗi rõ ràng khi thiếu file CUSTOM');
      assert.equal(soundManager.getIsPreviewing(), false);

      // Test Browser Autoplay Rejection (NotAllowedError) với HTMLAudioElement
      mockAudioPlayShouldRejectWith = 'NotAllowedError';
      let autoplayErr: string | null = null;
      soundManager.playPreview(
        {
          ...DEFAULT_AUDIO_CONFIG,
          presetId: 'CUSTOM',
          customAudioUrl: '/uploads/audio/test.wav',
        },
        {
          onError: (msg) => {
            autoplayErr = msg;
          },
        }
      );
      await sleep(30);
      assert.ok(autoplayErr && autoplayErr.includes('chặn phát âm thanh'), 'Phải bắt được NotAllowedError và thông báo cho người dùng');
      assert.equal(soundManager.getIsPreviewing(), false, 'Khi bị chặn autoplay phải tắt trạng thái đang preview');
      mockAudioPlayShouldRejectWith = null;

      // Test Mute / Unmute & Volume
      soundManager.setVolume(0.8);
      assert.equal(soundManager.getVolume(), 80);
      soundManager.setMuted(true);
      assert.equal(soundManager.isMuted(), true);
      soundManager.setMuted(false);
      assert.equal(soundManager.isMuted(), false);

      // Test Countdown Tick synchronization (chỉ phát mỗi giây 1 lần trong ngưỡng countdownTriggerSeconds)
      soundManager.configure({
        enabled: true,
        countdownSoundEnabled: true,
        countdownTriggerSeconds: 5,
        sfxEnabled: true,
        volume: 0.7,
      });
      soundManager.resetCountdownTracker();
      const oscBeforeCountdown = mockOscillatorsCreated;
      soundManager.checkCountdownTick(6); // Ngoài ngưỡng 5s -> không kêu
      assert.equal(mockOscillatorsCreated, oscBeforeCountdown, 'Không được kêu countdown ở giây thứ 6 khi ngưỡng là 5s');
      soundManager.checkCountdownTick(5); // Giây 5 -> kêu 1 lần
      assert.equal(mockOscillatorsCreated, oscBeforeCountdown + 1, 'Phải kêu đúng 1 lần ở giây thứ 5');
      soundManager.checkCountdownTick(5); // Gọi trùng giây 5 -> không kêu lại
      assert.equal(mockOscillatorsCreated, oscBeforeCountdown + 1, 'Không được kêu trùng trong cùng giây thứ 5');
      soundManager.checkCountdownTick(2); // Giây 2 -> kêu âm cao 880Hz
      assert.equal(soundManager.getDiagnostics().lastToneFrequency, 880, '2 giây cuối phải phát tần số cảnh báo 880Hz');

      // Test phân biệt rõ 5 loại SFX (correct, wrong, timeout, recorded, finish)
      soundManager.playSfx('correct');
      assert.equal(soundManager.getDiagnostics().lastSfxPlayed, 'correct');
      soundManager.playSfx('wrong');
      assert.equal(soundManager.getDiagnostics().lastSfxPlayed, 'wrong');
      soundManager.playSfx('timeout');
      assert.equal(soundManager.getDiagnostics().lastSfxPlayed, 'timeout');
      soundManager.playSfx('recorded');
      assert.equal(soundManager.getDiagnostics().lastSfxPlayed, 'recorded');
      soundManager.playSfx('finish');
      assert.equal(soundManager.getDiagnostics().lastSfxPlayed, 'finish');

      soundManager.stopAll();
      assert.equal(soundManager.getIsPlaying(), false);
      assert.equal(soundManager.getIsPreviewing(), false);
      console.log('✓ [D1] Toàn bộ 11 hạng mục Unit Test cho GameAudioManager đều PASS!');
    } finally {
      soundManager.stopAll();
      (globalThis as any).window = origWindow;
      (globalThis as any).Audio = origAudio;
    }
  }

  // =========================================================================
  // PHASE D2 & D3: INTEGRATION TESTS & REAL CHROMIUM BROWSER E2E
  // =========================================================================
  initDatabase();
  const app = createApp();
  const server = http.createServer(app);
  new MultiplayerWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '..');
  const uploadedAudioFilesToClean: string[] = [];

  try {
    console.log('\n--- [D2] Chạy Integration Tests cho Endpoint Upload Audio & Lưu Cấu hình Audio ---');
    const btcEmail = `btc_audio_${Date.now()}@matbao.test`;
    const btcAuth = await authService.register({
      email: btcEmail,
      password: 'Password123!',
      displayName: 'BTC Audio Tester',
    });
    const btcHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${btcAuth.token}`,
    };

    // D2.1. Chặn Guest (X-Guest-Token), Player (X-Player-Token) và Bearer Token không hợp lệ upload audio
    const guestUploadRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guest-Token': 'gt_0123456789abcdef0123456789abcdef',
      },
      body: JSON.stringify({
        fileName: 'guest.wav',
        fileBase64: createValidWavBuffer(100).toString('base64'),
      }),
    });
    assert.equal(guestUploadRes.status, 403, `Guest token upload phải bị chặn 403 (nhận: ${guestUploadRes.status})`);

    const playerUploadRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Token': 'pt_player_12345',
      },
      body: JSON.stringify({
        fileName: 'player.wav',
        fileBase64: createValidWavBuffer(100).toString('base64'),
      }),
    });
    assert.equal(playerUploadRes.status, 403, `Player token upload phải bị chặn 403 (nhận: ${playerUploadRes.status})`);

    const invalidAuthUploadRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid_or_expired_token_123',
      },
      body: JSON.stringify({
        fileName: 'unauth.wav',
        fileBase64: createValidWavBuffer(100).toString('base64'),
      }),
    });
    assert.equal(invalidAuthUploadRes.status, 401, `Bearer token không hợp lệ phải bị chặn 401 (nhận: ${invalidAuthUploadRes.status})`);

    // D2.2. Chặn file giả mạo Magic Bytes (.mp3 nhưng nội dung text)
    const spoofRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: btcHeaders,
      body: JSON.stringify({
        fileName: 'fake_song.mp3',
        fileBase64: Buffer.from('NOT_AN_AUDIO_FILE_HEADER_1234567890').toString('base64'),
      }),
    });
    assert.equal(spoofRes.status, 415, 'File giả mạo chữ ký phải bị từ chối với HTTP 415');
    const spoofJson = (await spoofRes.json()) as any;
    assert.equal(spoofJson?.error?.code, 'INVALID_AUDIO_SIGNATURE');

    // D2.3. Chặn định dạng không hỗ trợ (.exe)
    const badExtRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: btcHeaders,
      body: JSON.stringify({
        fileName: 'malware.exe',
        fileBase64: createValidWavBuffer(100).toString('base64'),
      }),
    });
    assert.equal(badExtRes.status, 415, 'Định dạng .exe phải bị từ chối với HTTP 415');

    // D2.4. Chặn file vượt quá 10 MB
    const oversizedBuf = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x52);
    const formOversized = new FormData();
    formOversized.append('file', new Blob([oversizedBuf], { type: 'audio/wav' }), 'oversized.wav');
    const overRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${btcAuth.token}` },
      body: formOversized,
    });
    assert.equal(overRes.status, 413, 'File > 10MB phải bị chặn với HTTP 413');

    // D2.5. Upload hợp lệ file WAV có Magic Bytes chuẩn + Kiểm tra chống Path Traversal + Tải lại file
    const validWavBuf = createValidWavBuffer(250);
    const okUploadRes = await fetch(`${baseUrl}/api/games/audio/upload`, {
      method: 'POST',
      headers: btcHeaders,
      body: JSON.stringify({
        fileName: '../../traversal_attempt_bgm.wav',
        fileBase64: validWavBuf.toString('base64'),
      }),
    });
    assert.equal(okUploadRes.status, 200, 'Upload WAV hợp lệ phải trả về 200 OK');
    const okUploadJson = (await okUploadRes.json()) as any;
    const uploadedAudioUrl: string = okUploadJson?.data?.audioUrl;
    assert.ok(
      uploadedAudioUrl?.startsWith('/uploads/audio/bgm_') && uploadedAudioUrl.endsWith('.wav'),
      `URL trả về phải nằm an toàn trong /uploads/audio/bgm_*.wav, nhận: ${uploadedAudioUrl}`
    );
    assert.ok(!uploadedAudioUrl.includes('..'), 'URL không được chứa path traversal');
    const savedDiskPath = path.join(repoRoot, 'public', uploadedAudioUrl);
    uploadedAudioFilesToClean.push(savedDiskPath);

    // Kiểm tra trình duyệt có thể tải và phát lại file từ URL trả về
    const playbackFetchRes = await fetch(`${baseUrl}${uploadedAudioUrl}`);
    assert.equal(playbackFetchRes.status, 200, 'File audio đã upload phải truy cập được qua HTTP GET');
    const fetchedBytes = Buffer.from(await playbackFetchRes.arrayBuffer());
    assert.equal(fetchedBytes.length, validWavBuf.length, 'Dung lượng file tải về phải khớp 100%');
    console.log('✓ [D2] Toàn bộ kiểm thử Integration cho POST /api/games/audio/upload đều PASS!');

    // Tạo một game mẫu để kiểm thử trên trình duyệt thật (Playtest, Solo, Exam)
    const testGameId = `game_audio_e2e_${Date.now()}`;
    const sampleSpec: GameSpecification = {
      gameId: testGameId,
      title: 'Kiểm thử Hệ thống Âm thanh V2',
      description: 'Đề kiểm thử tự động âm thanh Nghe thử, Playtest, Solo và Chế độ Thi',
      gameType: 'QUIZ',
      isPublic: true,
      settings: {
        questionCount: 2,
        timePerQuestion: 6,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'EXAM',
        timerMode: 'PER_QUESTION',
        passThresholdPercent: 50,
        officialAttemptPolicy: 'LATEST_ATTEMPT',
        rosterMode: 'FREE_TEXT',
        answersPublished: false,
        audioConfig: {
          enabled: true,
          presetId: 'ENERGETIC_ARENA',
          volume: 0.7,
          countdownSoundEnabled: true,
          countdownTriggerSeconds: 5,
          sfxEnabled: true,
        },
      },
      questions: [
        {
          id: 'q_audio_1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: Web Audio API sử dụng đối tượng nào để tạo sóng âm tổng hợp?',
          choices: ['OscillatorNode', 'CanvasRenderingContext2D', 'XMLHttpRequest', 'IntersectionObserver'],
          correctAnswer: 'OscillatorNode',
          explanation: 'OscillatorNode tạo tín hiệu dao động sóng âm theo tần số.',
          timeLimitSeconds: 6,
        },
        {
          id: 'q_audio_2',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 2: Trong Chế độ Thi chưa công bố đáp án, âm thanh khi nộp bài là gì?',
          choices: ['Âm báo trung tính (recorded)', 'Âm báo đúng', 'Âm báo sai', 'Pháo hoa chiến thắng'],
          correctAnswer: 'Âm báo trung tính (recorded)',
          explanation: 'Chế độ Thi phát âm báo trung tính để không làm lộ đáp án đúng/sai.',
          timeLimitSeconds: 6,
        },
      ],
    };
    gameStore.save(sampleSpec, Date.now(), btcAuth.user.userId, true);

    // =========================================================================
    // PHASE D3: REAL CHROMIUM BROWSER E2E (DESKTOP 1440x900 & MOBILE 390x844)
    // =========================================================================
    console.log('\n--- [D3] Chạy Kiểm thử Browser E2E trên Chromium thật (Desktop 1440x900 & Mobile 390x844) ---');
    const browser = await Browser.launch({ width: 1440, height: 900 });
    try {
      const page = await browser.newPage({ width: 1440, height: 900 });

      // Thiết lập session BTC và mở Trang Tạo Game (/?tab=demo)
      await page.goto(`${baseUrl}/?tab=demo`);
      await page.eval(`(() => {
        localStorage.removeItem('ai_game_audio_muted_v2');
        localStorage.removeItem('ai_game_audio_volume_v2');
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(btcAuth.token)});
        sessionStorage.setItem('ai_game_creator_current_session_v1', JSON.stringify({
          spec: ${JSON.stringify(sampleSpec)},
          saveStatus: 'saved',
          savedForLater: true,
          customGameTitle: ${JSON.stringify(sampleSpec.title)}
        }));
      })()`);
      await page.goto(`${baseUrl}/?tab=demo`);
      await sleep(700);

      // 1. Click "Nghe thử" lần đầu trên Desktop 1440x900
      const firstClickResult = await page.eval(`(async () => {
        const btn = document.querySelector('[data-testid="audio-preview-btn"]');
        const beforeText = btn ? btn.textContent.trim() : '';
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 80));
        const afterText = btn ? btn.textContent.trim() : '';
        const sm = window.__aiGameSoundManager;
        return {
          beforeText,
          afterText,
          ariaPressed: btn ? btn.getAttribute('aria-pressed') : null,
          diag: sm ? sm.getDiagnostics() : null,
        };
      })()`);

      assert.equal(firstClickResult.beforeText, '🔊 Nghe thử', 'Trạng thái ban đầu của nút phải là 🔊 Nghe thử');
      assert.equal(firstClickResult.afterText, '⏹ Dừng nghe', 'Sau khi click lần đầu phải đổi sang ⏹ Dừng nghe');
      assert.equal(firstClickResult.ariaPressed, 'true');
      assert.ok(firstClickResult.diag, 'window.__aiGameSoundManager phải tồn tại');
      assert.equal(firstClickResult.diag.isPreviewing, true, 'isPreviewing phải bằng true');
      assert.equal(firstClickResult.diag.isPlayingBgm, true, 'isPlayingBgm phải bằng true');
      assert.ok(
        firstClickResult.diag.oscillatorsStartedCount >= 1,
        `Phải tạo và phát ít nhất 1 OscillatorNode khi bấm Nghe thử (nhận: ${firstClickResult.diag.oscillatorsStartedCount})`
      );
      assert.ok(
        firstClickResult.diag.lastGainValue > 0.05,
        `Gain phát thực tế phải > 0.05 (trước khi sửa là 0.0006 bị chặn), nhận: ${firstClickResult.diag.lastGainValue}`
      );
      console.log(
        `✓ [D3.1] Click "Nghe thử" lần đầu thành công: AudioContext=${firstClickResult.diag.contextState}, oscillatorsStarted=${firstClickResult.diag.oscillatorsStartedCount}, gain=${firstClickResult.diag.lastGainValue}, freq=${firstClickResult.diag.lastToneFrequency}Hz`
      );

      // 2. Đổi sang từng preset khi đang Nghe thử -> phải tự động chuyển sang preset mới, không chồng âm thanh
      const presetSwitchResult = await page.eval(`(async () => {
        const select = document.querySelector('[data-testid="audio-preset-select"]');
        const sm = window.__aiGameSoundManager;
        const nativeSelectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        const switchPreset = async (val) => {
          nativeSelectSetter.call(select, val);
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 60));
          return sm.getDiagnostics();
        };
        const examDiag = await switchPreset('EXAM_FOCUS');
        const advDiag = await switchPreset('ADVENTURE_QUEST');
        const corpDiag = await switchPreset('CORPORATE_CALM');
        return { examDiag, advDiag, corpDiag };
      })()`);

      assert.equal(presetSwitchResult.examDiag.activePresetId, 'EXAM_FOCUS');
      assert.equal(presetSwitchResult.examDiag.lastToneFrequency, 220, 'EXAM_FOCUS phải phát 220Hz');
      assert.equal(presetSwitchResult.advDiag.activePresetId, 'ADVENTURE_QUEST');
      assert.equal(presetSwitchResult.advDiag.lastToneFrequency, 293.66, 'ADVENTURE_QUEST phải phát 293.66Hz');
      assert.equal(presetSwitchResult.corpDiag.activePresetId, 'CORPORATE_CALM');
      assert.equal(presetSwitchResult.corpDiag.lastToneFrequency, 261.63, 'CORPORATE_CALM phải phát 261.63Hz');
      console.log('✓ [D3.2] Đổi preset trực tiếp khi đang Nghe thử hoạt động chính xác cho mọi preset');

      // 3. Click liên tiếp 5 lần vào nút Nghe thử / Dừng nghe -> không bị chồng âm thanh hoặc lệch state
      const rapidClicksResult = await page.eval(`(async () => {
        const btn = document.querySelector('[data-testid="audio-preview-btn"]');
        const sm = window.__aiGameSoundManager;
        for (let i = 0; i < 5; i++) {
          btn.click();
          await new Promise((r) => setTimeout(r, 30));
        }
        await new Promise((r) => setTimeout(r, 50));
        return {
          btnText: btn.textContent.trim(),
          diag: sm.getDiagnostics(),
        };
      })()`);
      // Đang phát (true) -> 5 lần click (lẻ) -> phải dừng (false)
      assert.equal(rapidClicksResult.diag.isPreviewing, false, 'Sau số lần click lẻ từ trạng thái đang phát, preview phải dừng hoàn toàn');
      assert.equal(rapidClicksResult.btnText, '🔊 Nghe thử');

      // Bấm lại để bật preview và kiểm tra Mute/Unmute + Volume slider ngay trên Trang Tạo Game
      const creatorMuteVolResult = await page.eval(`(async () => {
        const previewBtn = document.querySelector('[data-testid="audio-preview-btn"]');
        const muteBtn = document.querySelector('[data-testid="creator-audio-mute-btn"]');
        const volSlider = document.querySelector('[data-testid="creator-audio-volume-slider"]');
        const sm = window.__aiGameSoundManager;

        previewBtn.click(); // Bật lại preview
        await new Promise((r) => setTimeout(r, 40));
        muteBtn.click(); // Mute
        await new Promise((r) => setTimeout(r, 40));
        const mutedState = sm.getDiagnostics().muted;
        muteBtn.click(); // Unmute
        await new Promise((r) => setTimeout(r, 40));
        const unmutedState = sm.getDiagnostics().muted;

        // Đổi volume slider sang 85%
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(volSlider, '85');
        volSlider.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const volAfterSlider = sm.getDiagnostics().volume;

        return { mutedState, unmutedState, volAfterSlider };
      })()`);
      assert.equal(creatorMuteVolResult.mutedState, true, 'Nút Mute trên Trang Tạo Game phải tắt tiếng');
      assert.equal(creatorMuteVolResult.unmutedState, false, 'Bấm lại nút Mute phải bật tiếng trở lại');
      assert.equal(creatorMuteVolResult.volAfterSlider, 85, 'Thanh trượt âm lượng phải cập nhật volume = 85%');
      console.log('✓ [D3.3] Click liên tiếp, Mute/Unmute và Volume slider trên Trang Tạo Game hoạt động chính xác');

      // 4. Chuyển từ Trang Tạo Game (đang phát Nghe thử) sang Playtest -> Preview phải tự dừng và BGM Playtest chạy
      await page.eval(`document.querySelector('[data-testid="playtest-game-btn"]').click()`);
      await sleep(500);
      const playtestAudioCheck = await page.eval(`(() => {
        const sm = window.__aiGameSoundManager;
        const previewBtn = document.querySelector('[data-testid="audio-preview-btn"]');
        return {
          diag: sm.getDiagnostics(),
          creatorPreviewBtnText: previewBtn ? previewBtn.textContent.trim() : '',
          hasPlaytestOverlay: Boolean(document.querySelector('[data-testid="playtest-overlay"]')),
        };
      })()`);
      assert.equal(playtestAudioCheck.hasPlaytestOverlay, true);
      assert.equal(playtestAudioCheck.diag.isPreviewing, false, 'Khi mở Playtest, chế độ isPreviewing phải tắt');
      assert.equal(playtestAudioCheck.diag.isPlayingBgm, true, 'Nhạc nền phiên Playtest phải đang chạy');
      assert.equal(playtestAudioCheck.creatorPreviewBtnText, '🔊 Nghe thử', 'Nút Nghe thử bên dưới phải về trạng thái 🔊 Nghe thử');

      // Mở trình sửa câu hỏi trực tiếp trong Playtest -> kiểm tra timer tạm dừng -> lưu & đóng lại -> thoát Playtest
      await page.eval(`document.querySelector('[data-testid="playtest-inline-edit-btn"]').click()`);
      await sleep(300);
      const editorOpen = await page.eval(`Boolean(document.querySelector('[data-testid="playtest-inline-edit-modal"]'))`);
      assert.equal(editorOpen, true);
      await page.eval(`document.querySelector('[data-testid="playtest-inline-save-btn"]').click()`);
      await sleep(400);
      await page.eval(`document.querySelector('[data-testid="exit-playtest-btn"]').click()`);
      await sleep(300);
      const afterExitPlaytest = await page.eval(`window.__aiGameSoundManager.getDiagnostics()`);
      assert.equal(afterExitPlaytest.isPlayingBgm, false, 'Khi thoát Playtest, toàn bộ nhạc nền phải dừng sạch');
      console.log('✓ [D3.4] Chuyển sang Playtest, tạm dừng khi mở Inline Editor và dọn dẹp âm thanh khi thoát hoạt động chuẩn xác');

      // 5. Kiểm tra Chế độ Thi (Exam Mode) trong SoloPlayer: Không lộ đáp án đúng/sai qua âm thanh!
      await page.goto(`${baseUrl}/?play=${encodeURIComponent(testGameId)}`);
      await sleep(900);
      // Câu 1: Chọn đáp án SAI ('XMLHttpRequest') -> trong Exam Mode chưa công bố đáp án, chỉ được phát 'recorded' (không được phát 'wrong')!
      const examQ1Audio = await page.eval(`(async () => {
        const buttons = Array.from(document.querySelectorAll('button.k-btn'));
        const wrongBtn = buttons.find((b) => b.textContent.includes('XMLHttpRequest'));
        if (wrongBtn) wrongBtn.click();
        await new Promise((r) => setTimeout(r, 350));
        return window.__aiGameSoundManager.getDiagnostics();
      })()`);
      assert.equal(
        examQ1Audio.lastSfxPlayed,
        'recorded',
        `Trong Chế độ Thi chưa công bố đáp án, chọn đáp án sai chỉ được phát âm trung tính 'recorded', nhận: ${examQ1Audio.lastSfxPlayed}`
      );

      // Chờ tự động chuyển sang Câu 2 sau 1.5s trong Exam Mode và chọn đáp án ĐÚNG -> vẫn chỉ được phát 'recorded'!
      await sleep(1700);
      const examQ2Audio = await page.eval(`(async () => {
        const buttons = Array.from(document.querySelectorAll('button.k-btn'));
        const rightBtn = buttons.find((b) => b.textContent.includes('recorded'));
        if (rightBtn) rightBtn.click();
        await new Promise((r) => setTimeout(r, 350));
        return window.__aiGameSoundManager.getDiagnostics();
      })()`);
      assert.equal(
        examQ2Audio.lastSfxPlayed,
        'recorded',
        `Trong Chế độ Thi chưa công bố đáp án, chọn đáp án đúng cũng chỉ được phát âm trung tính 'recorded', nhận: ${examQ2Audio.lastSfxPlayed}`
      );

      // Chờ kết thúc bài thi sau 1.5s -> nhạc nền dừng và phát âm thanh hoàn thành 'finish'
      await sleep(1800);
      const examFinishAudio = await page.eval(`window.__aiGameSoundManager.getDiagnostics()`);
      assert.equal(examFinishAudio.isPlayingBgm, false, 'Kết thúc bài thi phải dừng nhạc nền');
      assert.equal(examFinishAudio.lastSfxPlayed, 'finish', 'Kết thúc bài thi phải phát âm hiệu hoàn thành');
      console.log('✓ [D3.5] Chế độ Thi (Exam Mode) bảo mật tuyệt đối âm thanh (chỉ phát "recorded", tự chuyển câu sau 1.5s, phát "finish" khi hoàn tất)');

      // 6. Kiểm tra Mobile Viewport 390x844 trên Chromium
      const mobilePage = await browser.newPage({ width: 390, height: 844 });
      await mobilePage.goto(`${baseUrl}/?tab=demo`);
      await sleep(700);
      const mobileCheck = await mobilePage.eval(`(() => {
        const btn = document.querySelector('[data-testid="audio-preview-btn"]');
        if (btn) btn.click();
        const sm = window.__aiGameSoundManager;
        const diag = sm ? sm.getDiagnostics() : null;
        if (btn) btn.click(); // Dừng lại
        return {
          overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          diag,
        };
      })()`);
      assert.equal(mobileCheck.overflowPx, 0, 'Giao diện Mobile 390x844 không được tràn ngang');
      assert.equal(mobileCheck.diag.isPreviewing, true, 'Nút Nghe thử trên Mobile 390x844 phải hoạt động bình thường');
      assert.ok(mobileCheck.diag.oscillatorsStartedCount >= 1);
      assert.equal(page.consoleErrors.length, 0, `Không được có lỗi Console trên Desktop: ${page.consoleErrors.join('; ')}`);
      assert.equal(page.pageErrors.length, 0, `Không được có lỗi Runtime/Promise trên Desktop: ${page.pageErrors.join('; ')}`);
      assert.equal(mobilePage.consoleErrors.length, 0, `Không được có lỗi Console trên Mobile: ${mobilePage.consoleErrors.join('; ')}`);
      console.log('✓ [D3.6] Mobile 390x844 E2E PASS, 0 lỗi Console, 0 lỗi Promise rejection, 0px tràn ngang!');

      await mobilePage.close();
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    for (const f of uploadedAudioFilesToClean) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
    server.close();
  }

  console.log('\n=========================================================================');
  console.log('  ALL V2 AUDIO SYSTEM UNIT, INTEGRATION & CHROMIUM E2E TESTS PASSED!');
  console.log('=========================================================================');
  process.exit(0);
}

runAudioSystemVerification().catch((err) => {
  console.error('AUDIO SYSTEM VERIFICATION FAILED:', err);
  process.exit(1);
});
