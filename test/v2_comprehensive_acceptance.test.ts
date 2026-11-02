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
import { GameSpecification } from '../src/contracts/game.contract.js';
import { calculateMaxPossibleScore, evaluatePerformanceResult } from '../src/game/game.scoring.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { MULTIPLAYER_CONFIG } from '../src/multiplayer/room.types.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { getDatabase, initDatabase } from '../src/storage/sqlite.db.js';

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

class CdpPage {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
          else p.resolve(msg.result);
        }
      } catch {
        // ignore
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

  public async setViewport(vp: { width: number; height: number }): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 600,
    });
  }

  public async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    await sleep(450);
  }

  public async eval<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        `Page eval exception: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`
      );
    }
    return res?.result?.value as T;
  }

  public close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

class Browser {
  private proc: ChildProcess;
  private debugPort: number;
  private userDataDir: string;
  private pages: CdpPage[] = [];

  private constructor(proc: ChildProcess, debugPort: number, userDataDir: string) {
    this.proc = proc;
    this.debugPort = debugPort;
    this.userDataDir = userDataDir;
  }

  public static async launch(opts: { width?: number; height?: number } = {}): Promise<Browser> {
    const bin = findChromeBinary();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cdp-e2e-'));
    const debugPort = 19222 + Math.floor(Math.random() * 2000);
    const proc = spawn(
      bin,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        `--window-size=${opts.width || 1440},${opts.height || 900}`,
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    const start = Date.now();
    while (Date.now() - start < 10000) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (res.ok) break;
      } catch {
        // wait
      }
      await sleep(150);
    }

    return new Browser(proc, debugPort, userDataDir);
  }

  public async newPage(opts: { width: number; height: number }): Promise<CdpPage> {
    const listRes = await fetch(`http://127.0.0.1:${this.debugPort}/json/list`);
    const targets = (await listRes.json()) as Array<any>;
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err) => reject(err));
    });
    const page = new CdpPage(ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.setViewport(opts);
    this.pages.push(page);
    return page;
  }

  public async close(): Promise<void> {
    for (const p of this.pages) p.close();
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
    await sleep(250);
    try {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestRaw(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: Headers; buffer: Buffer; text: string; json: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const text = buffer.toString('utf8');
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, buffer, text, json };
}

class WsTestClient {
  public ws: WebSocket;
  public messages: any[] = [];
  private listeners: Array<(msg: any) => void> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        this.messages.push(parsed);
        for (const fn of [...this.listeners]) {
          fn(parsed);
        }
      } catch {
        // ignore
      }
    });
  }

  public waitForOpen(timeoutMs: number = 5000): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS open timeout')), timeoutMs);
      this.ws.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws.once('error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    });
  }

  public send(payload: unknown): void {
    this.ws.send(JSON.stringify(payload));
  }

  public waitForMessage(
    predicate: (msg: any) => boolean,
    timeoutMs: number = 8000
  ): Promise<any> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== onMsg);
        reject(
          new Error(
            `WS waitForMessage timeout after ${timeoutMs}ms. Received types: ${this.messages
              .map((m) => m.type)
              .join(', ')}`
          )
        );
      }, timeoutMs);

      const onMsg = (msg: any) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== onMsg);
          resolve(msg);
        }
      };
      this.listeners.push(onMsg);
    });
  }

  public close(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function runAllAcceptanceTests(): Promise<void> {
  process.chdir(repoRoot);
  console.log('=== BẮT ĐẦU BỘ KIỂM THỬ NGHIỆM THU TOÀN DIỆN AI GAME PLATFORM V2 (PHASE 1 -> PHASE 6) ===\n');

  const uploadedAudioFilesToClean: string[] = [];
  const createdGameIdsToClean: string[] = [];

  // =========================================================================
  // 1. KIỂM THỬ ĐƠN VỊ PHASE 1: SCORING, MAX SCORE & NHẬN XÉT 4 MỨC CHUẨN
  // =========================================================================
  {
    assert.equal(calculateMaxPossibleScore(5, 'STANDARD'), 500);
    assert.equal(calculateMaxPossibleScore(5, 'SPEED_BONUS'), 750);
    // STREAK 5 câu: 100 + 120 + 140 + 160 + 180 = 700
    assert.equal(calculateMaxPossibleScore(5, 'STREAK'), 700);

    // Kiểm tra đúng 2/5 câu (40%) -> Bắt buộc là "Cần cố gắng thêm", KHÔNG BAO GIỜ là "Xuất sắc"
    const eval2of5 = evaluatePerformanceResult({
      correctAnswers: 2,
      totalQuestions: 5,
      totalScore: 200,
      maxPossibleScore: 500,
      sessionMode: 'EXAM',
      passThresholdPercent: 50,
    });
    assert.equal(eval2of5.accuracyPercent, 40);
    assert.equal(eval2of5.tier, 'NEEDS_EFFORT');
    assert.equal(eval2of5.tierLabel, 'Cần cố gắng thêm');
    assert.ok(!eval2of5.tierLabel.includes('Xuất sắc'), 'Đúng 2/5 câu không được hiển thị Xuất sắc');
    assert.equal(eval2of5.isPassed, false, '40% < ngưỡng 50% phải là Chưa đạt');

    // Ngưỡng 50-69%
    const eval3of5 = evaluatePerformanceResult({
      correctAnswers: 3,
      totalQuestions: 5,
      totalScore: 300,
      maxPossibleScore: 500,
      sessionMode: 'EXAM',
      passThresholdPercent: 50,
    });
    assert.equal(eval3of5.accuracyPercent, 60);
    assert.equal(eval3of5.tier, 'PARTIAL_MASTERY');
    assert.equal(eval3of5.tierLabel, 'Đã nắm được một phần kiến thức');
    assert.equal(eval3of5.isPassed, true, '60% >= ngưỡng 50% phải là Đạt');

    // Ngưỡng 70-89%
    const eval4of5 = evaluatePerformanceResult({
      correctAnswers: 4,
      totalQuestions: 5,
      totalScore: 400,
      maxPossibleScore: 500,
      sessionMode: 'PLAY',
    });
    assert.equal(eval4of5.accuracyPercent, 80);
    assert.equal(eval4of5.tier, 'GOOD_WORK');
    assert.equal(eval4of5.tierLabel, 'Làm tốt');
    assert.equal(eval4of5.isPassed, undefined, 'Chế độ PLAY không ép hiển thị Đạt/Chưa đạt');

    // Ngưỡng 90-100%
    const eval5of5 = evaluatePerformanceResult({
      correctAnswers: 5,
      totalQuestions: 5,
      totalScore: 500,
      maxPossibleScore: 500,
      sessionMode: 'EXAM',
      passThresholdPercent: 80,
    });
    assert.equal(eval5of5.accuracyPercent, 100);
    assert.equal(eval5of5.tier, 'EXCELLENT');
    assert.equal(eval5of5.tierLabel, 'Xuất sắc');
    assert.equal(eval5of5.isPassed, true);

    console.log('✓ [PASS] Phase 1 Unit: Công thức tính điểm tối đa (STANDARD/SPEED_BONUS/STREAK), nhận xét 4 mức và ngưỡng Đạt/Chưa đạt chính xác 100%.');
  }

  // =========================================================================
  // 2. KIỂM THỬ MIGRATION 004 & SCHEMA DATABASE TRÊN DB CÔ LẬP (:memory:)
  // =========================================================================
  initDatabase(':memory:');
  {
    const db = getDatabase();
    const migRow = db
      .prepare("SELECT name FROM schema_migrations WHERE name = '004_v2_exam_roster_and_attempts'")
      .get() as { name: string } | undefined;
    assert.ok(migRow, 'Migration 004_v2_exam_roster_and_attempts phải được áp dụng trong bảng schema_migrations');

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('game_participants', 'game_participant_attempts')"
      )
      .all() as Array<{ name: string }>;
    assert.equal(tables.length, 2, 'Phải tồn tại đủ 2 bảng game_participants và game_participant_attempts');
    console.log('✓ [PASS] Phase 4 Database: Migration 004_v2_exam_roster_and_attempts và các bảng/index hoạt động chuẩn xác.');
  }

  // Khởi tạo HTTP + WebSocket Server cô lập cho Integration, Security, Load Test & Browser E2E
  const app = createApp();
  const server = http.createServer(app);
  const wsServer = new MultiplayerWebSocketServer();
  wsServer.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

  try {
    const ts = Date.now();
    const btcAuth = await authService.register({
      email: `btc_v2_${ts}@test.local`,
      password: 'Password123!',
      displayName: 'Ban Tổ Chức V2',
    });
    const attackerAuth = await authService.register({
      email: `attacker_v2_${ts}@test.local`,
      password: 'Password123!',
      displayName: 'Người Dùng Khác',
    });
    const btcHeaders = { Authorization: `Bearer ${btcAuth.token}` };
    const attackerHeaders = { Authorization: `Bearer ${attackerAuth.token}` };

    // =========================================================================
    // 3. KIỂM THỬ AUDIO UPLOAD & BẢO MẬT MAGIC BYTES (PHASE 1 & SECURITY 7.5)
    // =========================================================================
    {
      // 3.1. Chặn file nguy hiểm (.exe / script giả danh .mp3)
      const fakeMp3Buffer = Buffer.from('MZ\x90\x00This is an executable disguised as mp3', 'utf8');
      const badUploadRes = await requestRaw(
        baseUrl,
        'POST',
        '/api/games/audio/upload',
        {
          fileName: 'malware.mp3',
          fileBase64: fakeMp3Buffer.toString('base64'),
        },
        btcHeaders
      );
      assert.equal(badUploadRes.status, 415, 'File giả mạo chữ ký MP3 phải bị chặn với 415');
      assert.equal(badUploadRes.json?.error?.code, 'INVALID_AUDIO_SIGNATURE');

      // 3.2. Chặn định dạng không được phép (.html / .sh)
      const badExtRes = await requestRaw(
        baseUrl,
        'POST',
        '/api/games/audio/upload',
        {
          fileName: 'exploit.html',
          fileBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
        },
        btcHeaders
      );
      assert.equal(badExtRes.status, 415, 'Định dạng ngoài .mp3/.wav/.ogg phải bị từ chối');

      // 3.3. Cho phép file WAV hợp lệ có đúng RIFF....WAVE magic bytes
      const validWavHeader = Buffer.alloc(44);
      validWavHeader.write('RIFF', 0, 'ascii');
      validWavHeader.writeUInt32LE(36, 4);
      validWavHeader.write('WAVE', 8, 'ascii');
      validWavHeader.write('fmt ', 12, 'ascii');
      validWavHeader.writeUInt32LE(16, 16);
      validWavHeader.writeUInt16LE(1, 20);
      validWavHeader.writeUInt16LE(1, 22);
      validWavHeader.writeUInt32LE(44100, 24);
      validWavHeader.writeUInt32LE(88200, 28);
      validWavHeader.writeUInt16LE(2, 32);
      validWavHeader.writeUInt16LE(16, 34);
      validWavHeader.write('data', 36, 'ascii');
      validWavHeader.writeUInt32LE(0, 40);

      const okWavRes = await requestRaw(
        baseUrl,
        'POST',
        '/api/games/audio/upload',
        {
          fileName: 'nhac-nen-thi.wav',
          fileBase64: validWavHeader.toString('base64'),
        },
        btcHeaders
      );
      assert.equal(okWavRes.status, 200, 'Upload WAV hợp lệ phải thành công');
      assert.ok(okWavRes.json?.data?.audioUrl?.startsWith('/uploads/audio/bgm_'));
      const savedDiskPath = path.join(repoRoot, 'public', okWavRes.json.data.audioUrl);
      uploadedAudioFilesToClean.push(savedDiskPath);
      assert.equal(fs.existsSync(savedDiskPath), true, 'File âm thanh hợp lệ phải tồn tại trên đĩa');

      console.log('✓ [PASS] Phase 1 & Security: Upload âm thanh kiểm tra Magic Bytes nghiêm ngặt, chặn file giả mạo/nguy hiểm.');
    }

    // =========================================================================
    // 4. TẠO GAME CHẾ ĐỘ THI (EXAM) + IMPORT DANH SÁCH 105 THÍ SINH (CSV & XLSX & TRÙNG TÊN)
    // =========================================================================
    const examGameId = `game_v2_exam_${ts}`;
    createdGameIdsToClean.push(examGameId);

    const examSpec: GameSpecification = {
      gameId: examGameId,
      title: 'Kỳ Thi Sát Hạch An Toàn Thông Tin V2',
      description: 'Đề thi chính thức kiểm thử chế độ THI, Roster 100 người, Retake và Xuất điểm.',
      gameType: 'MULTIPLE_CHOICE',
      ownerUserId: btcAuth.user.userId,
      isPublic: true,
      generatedAt: new Date().toISOString(),
      settings: {
        questionCount: 3,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'EXAM',
        timerMode: 'PER_QUESTION',
        autoAdvanceDelayMs: 1500,
        passThresholdPercent: 50,
        officialAttemptPolicy: 'LATEST_ATTEMPT',
        rosterMode: 'PRECONFIGURED',
        answersPublished: false,
        showExamLeaderboardToPlayers: false,
      },
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId: 'src_v2_exam',
            sourceType: 'TXT',
            sourceName: 'quy-che-thi-v2.txt',
            sourceLocation: 'quy-che-thi-v2.txt',
          },
        ],
      },
      questions: [
        {
          id: 'q_exam_1',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'MEDIUM',
          timeLimitSeconds: 15, // Thời gian riêng cho câu 1 (15s khác mặc định 20s)
          question: 'Câu 1: Trong chế độ THI, khi nào đáp án đúng được hiển thị cho thí sinh?',
          choices: [
            'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố',
            'B. Ngay sau mỗi câu hỏi',
            'C. Khi thí sinh đầu tiên nộp bài',
            'D. Khi tải lại trình duyệt',
          ],
          correctAnswer: 'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố',
          explanation: 'Bảo mật đáp án tuyệt đối cho tới khi BTC chủ động công bố.',
          sourceReference: {
            sourceId: 'src_v2_exam',
            sourceType: 'TXT',
            sourceLocation: 'quy-che-thi-v2.txt',
            section: 'Điều 1',
          },
        },
        {
          id: 'q_exam_2',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'MEDIUM',
          timeLimitSeconds: 25,
          question: 'Câu 2: Chính sách tính điểm mặc định cho Chế độ THI khi được cấp quyền thi lại là gì?',
          choices: [
            'A. LATEST_ATTEMPT (Lấy kết quả của lượt thi hợp lệ mới nhất)',
            'B. Trung bình cộng các lượt',
            'C. Xóa toàn bộ lịch sử cũ',
            'D. Không lưu điểm',
          ],
          correctAnswer: 'A. LATEST_ATTEMPT (Lấy kết quả của lượt thi hợp lệ mới nhất)',
          explanation: 'Chế độ THI lấy lượt hợp lệ mới nhất làm kết quả chính thức và giữ nguyên lịch sử.',
          sourceReference: {
            sourceId: 'src_v2_exam',
            sourceType: 'TXT',
            sourceLocation: 'quy-che-thi-v2.txt',
            section: 'Điều 2',
          },
        },
        {
          id: 'q_exam_3',
          type: 'MULTIPLE_CHOICE',
          difficulty: 'HARD',
          question: 'Câu 3: Hệ thống hỗ trợ tối đa bao nhiêu người tham gia phòng thi trực tuyến cùng lúc?',
          choices: [
            'A. 100 người chơi/thí sinh đồng thời',
            'B. Chỉ 5 người',
            'C. Chỉ 10 người',
            'D. Không cho phép nhiều người',
          ],
          correctAnswer: 'A. 100 người chơi/thí sinh đồng thời',
          explanation: 'Phòng thi Multiplayer V2 hỗ trợ 100 người đồng thời.',
          sourceReference: {
            sourceId: 'src_v2_exam',
            sourceType: 'TXT',
            sourceLocation: 'quy-che-thi-v2.txt',
            section: 'Điều 3',
          },
        },
      ],
    };

    gameStore.save(examSpec, Date.now(), btcAuth.user.userId, true);

    // 4.1. Import XLSX danh sách 100 thí sinh + 2 người trùng họ tên "Nguyễn Văn An" khác phòng ban + 1 tên chứa công thức độc hại để test Formula Injection
    const xlsxRows = [
      ['Họ và tên', 'Phòng ban / Đơn vị', 'Mã nhân viên'],
      ['Nguyễn Văn An', 'Phòng Kỹ Thuật', 'NV001'],
      ['Nguyễn Văn An', 'Phòng Kinh Doanh', 'NV002'], // Trùng tên nhưng khác người -> không được gộp!
      ['=1+1;Trần Thị Bảo', '+Phòng Kế Toán', 'NV003'], // Test chống Formula Injection khi xuất CSV/XLSX
    ];
    for (let i = 4; i <= 102; i++) {
      xlsxRows.push([
        `Thí Sinh Số ${String(i).padStart(3, '0')}`,
        i % 2 === 0 ? 'Khối Công Nghệ' : 'Khối Vận Hành',
        `NV${String(i).padStart(3, '0')}`,
      ]);
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(xlsxRows);
    XLSX.utils.book_append_sheet(wb, ws, 'DanhSachThiSinh');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const importXlsxRes = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/${examGameId}/participants`,
      {
        fileName: 'danh_sach_102_thi_sinh.xlsx',
        fileBase64: xlsxBuffer.toString('base64'),
        replaceAll: true,
        rosterMode: 'PRECONFIGURED',
      },
      btcHeaders
    );
    assert.equal(importXlsxRes.status, 200, 'Import XLSX danh sách >100 thí sinh phải thành công');
    assert.equal(
      importXlsxRes.json.data.total,
      102,
      'Phải lưu đủ 102 thí sinh, tuyệt đối không tự gộp 2 người trùng tên Nguyễn Văn An'
    );

    const allParticipants = importXlsxRes.json.data.participants as Array<any>;
    const nguyenVanAnList = allParticipants.filter((p) => p.fullName === 'Nguyễn Văn An');
    assert.equal(nguyenVanAnList.length, 2, 'Hai thí sinh trùng tên Nguyễn Văn An phải có 2 bản ghi độc lập');
    assert.notEqual(
      nguyenVanAnList[0].participantId,
      nguyenVanAnList[1].participantId,
      'Mỗi thí sinh trùng tên phải có participantId nội bộ duy nhất'
    );

    console.log('✓ [PASS] Phase 4 Roster: Import XLSX >100 thí sinh, giữ nguyên người trùng tên với ID nội bộ duy nhất.');

    // =========================================================================
    // 5. KIỂM THỬ BẢO MẬT KHÔNG LỘ ĐÁP ÁN QUA REST & SOLO EXAM + RACE CONDITION + RETAKE
    // =========================================================================
    const candidate1 = nguyenVanAnList[0]; // Nguyễn Văn An - Phòng Kỹ Thuật
    const candidate2 = nguyenVanAnList[1]; // Nguyễn Văn An - Phòng Kinh Doanh
    const candidateFormula = allParticipants.find((p) => p.fullName.includes('Trần Thị Bảo'))!;

    // 5.1. Kiểm tra GET /api/games/:gameId?mode=public cho thí sinh KHÔNG trả về đáp án đúng
    const publicGameRes = await requestRaw(
      baseUrl,
      'GET',
      `/api/games/${examGameId}?mode=public`
    );
    assert.equal(publicGameRes.status, 200);
    for (const q of publicGameRes.json.data.questions) {
      assert.equal(q.correctAnswer, '', 'GET /api/games/:gameId?mode=public ở chế độ THI không được lộ correctAnswer');
      assert.ok(!q.explanation, 'GET /api/games/:gameId?mode=public ở chế độ THI không được lộ explanation');
    }

    // 5.2. Kiểm tra người dùng khác / thí sinh không thể xuất đề thi hoặc xem bảng điểm BTC
    const unauthorizedExportQuestions = await requestRaw(
      baseUrl,
      'GET',
      `/api/games/${examGameId}/export?format=json`,
      undefined,
      attackerHeaders
    );
    assert.equal(unauthorizedExportQuestions.status, 403, 'Người khác không được phép xuất bộ câu hỏi đang thi');

    const unauthorizedScoreboard = await requestRaw(
      baseUrl,
      'GET',
      `/api/games/${examGameId}/scoreboard`,
      undefined,
      attackerHeaders
    );
    assert.equal(unauthorizedScoreboard.status, 403, 'Người khác không được xem bảng điểm BTC');

    // 5.3. Bắt đầu lượt thi Solo Exam cho candidate1 & kiểm tra chống chiếm suất thi đồng thời (Race Condition)
    const [claim1Res, claim2Res] = await Promise.all([
      requestRaw(baseUrl, 'POST', '/api/games/sessions', {
        gameId: examGameId,
        participantId: candidate1.participantId,
        displayName: candidate1.fullName,
        departmentUnit: candidate1.departmentUnit,
      }),
      requestRaw(baseUrl, 'POST', '/api/games/sessions', {
        gameId: examGameId,
        participantId: candidate1.participantId,
        displayName: candidate1.fullName,
        departmentUnit: candidate1.departmentUnit,
      }),
    ]);

    const statuses = [claim1Res.status, claim2Res.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      'Khi 2 kết nối cùng chọn 1 thí sinh đồng thời, đúng 1 kết nối được nhận (200) và kết nối kia bị chặn (409)'
    );

    const activeClaim = claim1Res.status === 200 ? claim1Res.json.data : claim2Res.json.data;
    const examSessionId = activeClaim.sessionId as string;
    const examLockToken = activeClaim.lockToken as string;
    const examTokenHeaders = { 'X-Participant-Token': examLockToken };
    assert.ok(examSessionId && examLockToken, 'Phải cấp sessionId và lockToken để khôi phục khi refresh');

    // 5.4. Bắt đầu câu hỏi số 1 & kiểm tra thời gian riêng của câu 1 (15 giây) + Refresh không reset deadline
    const startExamRes = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${examSessionId}/start`,
      undefined,
      examTokenHeaders
    );
    assert.equal(startExamRes.status, 200);
    assert.equal(
      startExamRes.json.data.question.timePerQuestion,
      15,
      'Câu hỏi số 1 phải áp dụng thời gian riêng timeLimitSeconds = 15s'
    );
    const initialDeadlineAt = startExamRes.json.data.question.deadlineAt as number;

    await sleep(250);
    // Thí sinh F5 / Refresh truyền lại đúng lockToken -> Khôi phục đúng phiên đang thi, KHÔNG tạo lượt mới và KHÔNG cộng thêm giờ
    const resumeExamRes = await requestRaw(baseUrl, 'POST', '/api/games/sessions', {
      gameId: examGameId,
      participantId: candidate1.participantId,
      lockToken: examLockToken,
    });
    assert.equal(resumeExamRes.status, 200, 'Refresh với lockToken hợp lệ phải khôi phục phiên hiện tại (200)');
    assert.equal(resumeExamRes.json.data.resumed, true);
    assert.equal(resumeExamRes.json.data.sessionId, examSessionId);

    const currentQAfterRefresh = await requestRaw(
      baseUrl,
      'GET',
      `/api/games/sessions/${examSessionId}/question`,
      undefined,
      examTokenHeaders
    );
    assert.equal(
      currentQAfterRefresh.json.data.deadlineAt,
      initialDeadlineAt,
      'Refresh/Reconnect tuyệt đối không được reset hay cộng thêm thời gian deadlineAt'
    );

    // 5.5. Nộp câu trả lời trong chế độ THI -> Backend KHÔNG được trả về isCorrect, correctAnswer, explanation
    // Lần 1 này candidate1 trả lời đúng 1/3 câu (33% -> Chưa đạt)
    const ans1Res = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${examSessionId}/answer`,
      {
        questionId: 'q_exam_1',
        answer: 'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố',
      },
      examTokenHeaders
    );
    assert.equal(ans1Res.status, 200);
    assert.equal(ans1Res.json.data.examAnswerRecorded, true);
    assert.equal(
      ans1Res.json.data.isCorrect,
      undefined,
      'Chế độ THI không được lộ isCorrect trong response nộp câu trả lời'
    );
    assert.equal(
      ans1Res.json.data.correctAnswer,
      undefined,
      'Chế độ THI không được lộ correctAnswer trong response nộp câu trả lời'
    );
    assert.equal(
      ans1Res.json.data.explanation,
      undefined,
      'Chế độ THI không được lộ explanation trong response nộp câu trả lời'
    );

    // Chuyển câu 2 và trả lời sai
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${examSessionId}/next`, undefined, examTokenHeaders);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${examSessionId}/answer`,
      {
        questionId: 'q_exam_2',
        answer: 'B. Trung bình cộng các lượt',
      },
      examTokenHeaders
    );

    // Chuyển câu 3 và trả lời sai -> Kết thúc lượt 1 (1/3 câu đúng = 33%, 100/300 điểm -> Chưa đạt)
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${examSessionId}/next`, undefined, examTokenHeaders);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${examSessionId}/answer`,
      {
        questionId: 'q_exam_3',
        answer: 'B. Chỉ 5 người',
      },
      examTokenHeaders
    );
    const finishAttempt1Res = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${examSessionId}/next`,
      undefined,
      examTokenHeaders
    );
    assert.equal(finishAttempt1Res.status, 200);
    assert.equal(finishAttempt1Res.json.data.finished, true);

    // Kiểm tra kết quả cuối bài thi khi BTC CHƯA công bố đáp án:
    // Phải có điểm, số câu đúng (1/3), 33%, Chưa đạt, nhận xét "Cần cố gắng thêm", nhưng KHÔNG lộ đáp án từng câu!
    const resultAttempt1Res = await requestRaw(
      baseUrl,
      'GET',
      `/api/games/sessions/${examSessionId}/result`,
      undefined,
      examTokenHeaders
    );
    assert.equal(resultAttempt1Res.status, 200);
    const resultData1 = resultAttempt1Res.json.data;
    assert.equal(resultData1.correctCount, 1);
    assert.equal(resultData1.totalQuestions, 3);
    assert.equal(resultData1.score, 100);
    assert.equal(resultData1.maxPossibleScore, 300);
    assert.equal(resultData1.evaluation.accuracyPercent, 33);
    assert.equal(resultData1.evaluation.tierLabel, 'Cần cố gắng thêm');
    assert.equal(resultData1.evaluation.isPassed, false);
    assert.equal(resultData1.answersPublished, false, 'Thí sinh nộp bài sớm không được làm tự động công bố đáp án');
    for (const qr of resultData1.questionResults) {
      assert.equal(
        qr.correctAnswer,
        '[Đáp án sẽ được công bố sau khi kết thúc kỳ thi]',
        'Khi BTC chưa công bố đáp án, kết quả chi tiết không được lộ correctAnswer thật'
      );
      assert.equal(qr.explanation, undefined, 'Khi BTC chưa công bố đáp án, không được lộ explanation');
    }

    // 5.6. Thí sinh tự ý vào thi lần 2 khi chưa được BTC cấp quyền -> Bị từ chối 403 ATTEMPT_LIMIT_REACHED
    const illegalRetakeRes = await requestRaw(baseUrl, 'POST', '/api/games/sessions', {
      gameId: examGameId,
      participantId: candidate1.participantId,
    });
    assert.equal(illegalRetakeRes.status, 403, 'Không cho phép thi lại khi chưa được BTC cấp quyền');
    assert.equal(illegalRetakeRes.json?.error?.code, 'ATTEMPT_LIMIT_REACHED');

    // Người chơi/kẻ tấn công tự gọi API grant-retake -> Bị từ chối 403
    const unauthorizedGrantRes = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/${examGameId}/participants/${candidate1.participantId}/grant-retake`,
      {},
      attackerHeaders
    );
    assert.equal(unauthorizedGrantRes.status, 403, 'Chỉ BTC mới được cấp quyền thi lại');

    // 5.7. BTC cấp quyền thi lại cho candidate1 -> Thí sinh thi lượt 2 đạt 3/3 câu đúng (300/300 điểm, 100% -> Đạt)
    const grantRetakeRes = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/${examGameId}/participants/${candidate1.participantId}/grant-retake`,
      {},
      btcHeaders
    );
    assert.equal(grantRetakeRes.status, 200);
    assert.equal(grantRetakeRes.json.data.participant.allowedAttempts, 2);

    // Bắt đầu lượt thi thứ 2 cho candidate1 (kiểm tra đồng thời 2 request xin thi lại cùng lúc chỉ 1 request tạo được phiên)
    const [retakeClaimA, retakeClaimB] = await Promise.all([
      requestRaw(baseUrl, 'POST', '/api/games/sessions', {
        gameId: examGameId,
        participantId: candidate1.participantId,
      }),
      requestRaw(baseUrl, 'POST', '/api/games/sessions', {
        gameId: examGameId,
        participantId: candidate1.participantId,
      }),
    ]);
    assert.deepEqual([retakeClaimA.status, retakeClaimB.status].sort(), [200, 409]);
    const activeRetakeData = (retakeClaimA.status === 200 ? retakeClaimA : retakeClaimB).json.data;
    const session2Id = activeRetakeData.sessionId;
    const session2Headers = { 'X-Participant-Token': activeRetakeData.lockToken };

    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${session2Id}/start`, undefined, session2Headers);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${session2Id}/answer`,
      {
        questionId: 'q_exam_1',
        answer: 'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố',
      },
      session2Headers
    );
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${session2Id}/next`, undefined, session2Headers);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${session2Id}/answer`,
      {
        questionId: 'q_exam_2',
        answer: 'A. LATEST_ATTEMPT (Lấy kết quả của lượt thi hợp lệ mới nhất)',
      },
      session2Headers
    );
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${session2Id}/next`, undefined, session2Headers);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${session2Id}/answer`,
      {
        questionId: 'q_exam_3',
        answer: 'A. 100 người chơi/thí sinh đồng thời',
      },
      session2Headers
    );
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${session2Id}/next`, undefined, session2Headers);

    // Cho candidateFormula thi 1 lượt (đạt 2/3 câu = 200 điểm, 67% -> Đạt) để kiểm tra xuất CSV/XLSX và Formula Injection
    const formulaSessionRes = await requestRaw(baseUrl, 'POST', '/api/games/sessions', {
      gameId: examGameId,
      participantId: candidateFormula.participantId,
    });
    assert.equal(formulaSessionRes.status, 200);
    const formulaSessionId = formulaSessionRes.json.data.sessionId;
    const formulaHeaders = { 'X-Participant-Token': formulaSessionRes.json.data.lockToken };
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${formulaSessionId}/start`, undefined, formulaHeaders);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${formulaSessionId}/answer`,
      {
        questionId: 'q_exam_1',
        answer: 'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố',
      },
      formulaHeaders
    );
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${formulaSessionId}/next`, undefined, formulaHeaders);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${formulaSessionId}/answer`,
      {
        questionId: 'q_exam_2',
        answer: 'A. LATEST_ATTEMPT (Lấy kết quả của lượt thi hợp lệ mới nhất)',
      },
      formulaHeaders
    );
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${formulaSessionId}/next`, undefined, formulaHeaders);
    await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${formulaSessionId}/answer`,
      {
        questionId: 'q_exam_3',
        answer: 'B. Chỉ 5 người',
      },
      formulaHeaders
    );
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${formulaSessionId}/next`, undefined, formulaHeaders);

    // 5.8. Kiểm tra công bố đáp án (Answer Publication):
    // Nếu đang có phiên thi đang diễn ra (ví dụ candidate2 đang làm bài), BTC bấm công bố phải bị chặn 409 EXAM_STILL_ACTIVE
    const activeCandidate2Res = await requestRaw(baseUrl, 'POST', '/api/games/sessions', {
      gameId: examGameId,
      participantId: candidate2.participantId,
    });
    assert.equal(activeCandidate2Res.status, 200);
    const activeSession2Id = activeCandidate2Res.json.data.sessionId;
    const activeSession2Headers = { 'X-Participant-Token': activeCandidate2Res.json.data.lockToken };
    await requestRaw(baseUrl, 'POST', `/api/games/sessions/${activeSession2Id}/start`, undefined, activeSession2Headers);

    const prematurePublishRes = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/${examGameId}/publish-answers`,
      {},
      btcHeaders
    );
    assert.equal(
      prematurePublishRes.status,
      409,
      'Không được phép công bố đáp án khi vẫn còn thí sinh đang trong phiên thi'
    );
    assert.equal(prematurePublishRes.json?.error?.code, 'EXAM_STILL_ACTIVE');

    // Kết thúc phiên của candidate2 -> Toàn bộ đợt thi đã kết thúc -> BTC chủ động công bố đáp án thành công
    const endActive2Res = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/sessions/${activeSession2Id}/end`,
      {},
      btcHeaders
    );
    assert.equal(endActive2Res.status, 200);

    const publishOkRes = await requestRaw(
      baseUrl,
      'POST',
      `/api/games/${examGameId}/publish-answers`,
      {},
      btcHeaders
    );
    assert.equal(publishOkRes.status, 200, 'Sau khi toàn bộ đợt thi kết thúc, BTC chủ động công bố đáp án phải thành công');
    assert.equal(publishOkRes.json.data.answersPublished, true);

    // Sau khi công bố, xem lại kết quả mới hiển thị đáp án đúng và giải thích
    const resultAfterPublish = await requestRaw(
      baseUrl,
      'GET',
      `/api/games/sessions/${session2Id}/result`,
      undefined,
      session2Headers
    );
    assert.equal(resultAfterPublish.json.data.answersPublished, true);
    assert.ok(
      resultAfterPublish.json.data.questionResults[0].correctAnswer.includes('A. Chỉ khi toàn bộ đợt thi kết thúc'),
      'Sau khi BTC công bố đáp án, thí sinh xem lại kết quả phải thấy đáp án đúng'
    );

    console.log('✓ [PASS] Phase 4 & Security: Bảo mật đáp án bài thi, chống Race Condition chiếm suất, Refresh giữ nguyên deadline, Retake và Công bố đáp án chuẩn xác.');

    // =========================================================================
    // 6. KIỂM THỬ BẢNG ĐIỂM BTC, CHÍNH SÁCH LATEST_ATTEMPT & XUẤT CSV / XLSX (PHASE 5)
    // =========================================================================
    {
      const scoreboardRes = await requestRaw(
        baseUrl,
        'GET',
        `/api/games/${examGameId}/scoreboard`,
        undefined,
        btcHeaders
      );
      assert.equal(scoreboardRes.status, 200);
      const sb = scoreboardRes.json.data;
      assert.equal(sb.officialAttemptPolicy, 'LATEST_ATTEMPT');
      assert.equal(sb.totals.totalParticipants, 102);

      // Tìm candidate1 trong bảng điểm: Đã thi 2 lượt (lượt 1: 100đ Chưa đạt, lượt 2: 300đ Đạt)
      // Theo chính sách LATEST_ATTEMPT, kết quả chính thức phải là lượt 2 (300đ, 100%, Đạt), và lưu đủ 2 lượt trong attemptHistory
      const c1Entry = sb.entries.find((e: any) => e.participantId === candidate1.participantId);
      assert.ok(c1Entry, 'Phải tìm thấy candidate1 trên bảng điểm BTC');
      assert.equal(c1Entry.usedAttempts, 2);
      assert.equal(c1Entry.allowedAttempts, 2);
      assert.equal(c1Entry.retakeGrantedCount, 1);
      assert.equal(c1Entry.officialAttemptNumber, 2, 'LATEST_ATTEMPT phải lấy lượt 2 làm kết quả chính thức');
      assert.equal(c1Entry.score, 300);
      assert.equal(c1Entry.accuracyPercent, 100);
      assert.equal(c1Entry.isPassed, true);
      assert.equal(c1Entry.attemptHistory.length, 2, 'Phải bảo toàn đầy đủ lịch sử cả 2 lượt thi, không xóa lượt cũ');

      // Kiểm tra Xuất file CSV và đọc lại nội dung
      const csvExportRes = await requestRaw(
        baseUrl,
        'GET',
        `/api/games/${examGameId}/scoreboard/export?format=csv`,
        undefined,
        btcHeaders
      );
      assert.equal(csvExportRes.status, 200);
      assert.ok(csvExportRes.text.startsWith('\uFEFF'), 'File CSV phải có UTF-8 BOM để mở tiếng Việt trên Excel');
      assert.ok(csvExportRes.text.includes('Nguyễn Văn An'), 'File CSV phải hỗ trợ đầy đủ Unicode tiếng Việt');
      assert.ok(
        csvExportRes.text.includes("'=1+1;Trần Thị Bảo") && csvExportRes.text.includes("'+Phòng Kế Toán"),
        'File CSV phải trung hòa Formula Injection (=, +, -, @) bằng dấu nháy đơn'
      );

      // Kiểm tra Xuất file XLSX và đọc lại bằng thư viện XLSX
      const xlsxExportRes = await requestRaw(
        baseUrl,
        'GET',
        `/api/games/${examGameId}/scoreboard/export?format=xlsx`,
        undefined,
        btcHeaders
      );
      assert.equal(xlsxExportRes.status, 200);
      const parsedWb = XLSX.read(xlsxExportRes.buffer, { type: 'buffer' });
      assert.deepEqual(
        parsedWb.SheetNames,
        ['Bang Diem Tong Hop', 'Lich Su Luot Thi'],
        'File XLSX phải có đủ 2 sheet: Bang Diem Tong Hop và Lich Su Luot Thi'
      );
      const sheet1Rows = XLSX.utils.sheet_to_json<Record<string, any>>(
        parsedWb.Sheets['Bang Diem Tong Hop']
      );
      assert.equal(sheet1Rows.length, 102, 'Sheet Bang Diem Tong Hop phải chứa đủ 102 thí sinh');
      const formulaRowInXlsx = sheet1Rows.find((r) =>
        String(r['Họ và tên'] || '').includes('Trần Thị Bảo')
      );
      assert.ok(formulaRowInXlsx, 'Phải đọc lại được dòng thí sinh Trần Thị Bảo trong XLSX');
      assert.ok(
        String(formulaRowInXlsx['Họ và tên']).startsWith("'="),
        'Ô Họ và tên bắt đầu bằng dấu = trong XLSX phải được escape chống Formula Injection'
      );
      assert.ok(
        String(formulaRowInXlsx['Phòng ban / Đơn vị']).startsWith("'+"),
        'Ô Phòng ban bắt đầu bằng dấu + trong XLSX phải được escape chống Formula Injection'
      );

      const sheet2Rows = XLSX.utils.sheet_to_json<Record<string, any>>(
        parsedWb.Sheets['Lich Su Luot Thi']
      );
      assert.ok(
        sheet2Rows.length >= 3,
        'Sheet Lich Su Luot Thi phải ghi đầy đủ các lượt thi bao gồm cả lượt thi cũ và lượt thi lại'
      );

      console.log('✓ [PASS] Phase 5 Scoreboard & Export: Bảng điểm BTC, Top 3, Lịch sử lượt thi, Xuất CSV & XLSX (đọc lại nội dung + chống Formula Injection) PASS tuyệt đối.');
    }

    // =========================================================================
    // 7. KIỂM THỬ CHÍNH SÁCH HIGHEST_SCORE CHO CHẾ ĐỘ CHƠI (PLAY MODE)
    // =========================================================================
    {
      const playGameId = `game_v2_play_${ts}`;
      createdGameIdsToClean.push(playGameId);
      const playSpec: GameSpecification = {
        ...examSpec,
        gameId: playGameId,
        title: 'Game Chế Độ CHƠI Kiểm Thử HIGHEST_SCORE',
        settings: {
          ...examSpec.settings,
          sessionMode: 'PLAY',
          officialAttemptPolicy: 'HIGHEST_SCORE',
          rosterMode: 'PRECONFIGURED',
          answersPublished: true,
        },
      };
      gameStore.save(playSpec, Date.now(), btcAuth.user.userId, true);

      const addRosterRes = await requestRaw(
        baseUrl,
        'POST',
        `/api/games/${playGameId}/participants`,
        {
          participants: [{ fullName: 'Lê Hoàng Nam', departmentUnit: 'Phòng R&D' }],
          replaceAll: true,
        },
        btcHeaders
      );
      const playerParticipantId = addRosterRes.json.data.participants[0].participantId;

      // Lượt 1: Đạt 300/300 điểm
      const s1Res = await requestRaw(baseUrl, 'POST', '/api/games/sessions', {
        gameId: playGameId,
        participantId: playerParticipantId,
      });
      const s1Id = s1Res.json.data.sessionId;
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s1Id}/start`);
      for (let i = 0; i < 3; i++) {
        const q = playSpec.questions[i];
        const ansRes = await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s1Id}/answer`, {
          questionId: q.id,
          answer: q.correctAnswer,
        });
        assert.equal(ansRes.json.data.isCorrect, true, 'Chế độ PLAY phải trả về ngay isCorrect = true');
        assert.equal(ansRes.json.data.correctAnswer, q.correctAnswer, 'Chế độ PLAY phải hiển thị ngay đáp án đúng');
        await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s1Id}/next`);
      }

      // Lượt 2 (Chế độ PLAY cho phép chơi nhiều lượt và lấy HIGHEST_SCORE): Đạt 100/300 điểm
      const s2Res = await requestRaw(baseUrl, 'POST', '/api/games/sessions', {
        gameId: playGameId,
        participantId: playerParticipantId,
      });
      assert.equal(s2Res.status, 200, 'Chế độ PLAY cho phép người chơi tham gia lại để cải thiện điểm cao nhất');
      const s2Id = s2Res.json.data.sessionId;
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/start`);
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/answer`, {
        questionId: 'q_exam_1',
        answer: playSpec.questions[0].correctAnswer,
      });
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/next`);
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/answer`, {
        questionId: 'q_exam_2',
        answer: 'B. Trung bình cộng các lượt',
      });
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/next`);
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/answer`, {
        questionId: 'q_exam_3',
        answer: 'B. Chỉ 5 người',
      });
      await requestRaw(baseUrl, 'POST', `/api/games/sessions/${s2Id}/next`);

      const playSbRes = await requestRaw(
        baseUrl,
        'GET',
        `/api/games/${playGameId}/scoreboard`,
        undefined,
        btcHeaders
      );
      const namEntry = playSbRes.json.data.entries[0];
      assert.equal(namEntry.usedAttempts, 2);
      assert.equal(namEntry.officialAttemptNumber, 1, 'Chế độ PLAY (HIGHEST_SCORE) phải giữ lượt 1 (300đ) làm kết quả chính thức');
      assert.equal(namEntry.score, 300);
      console.log('✓ [PASS] Phase 1 & Phase 4: Chế độ CHƠI hiển thị ngay đáp án sau mỗi câu và áp dụng chuẩn chính sách HIGHEST_SCORE.');
    }

    // =========================================================================
    // 8. LOAD TEST 100 NGƯỜI THAM GIA ĐỒNG THỜI QUA WEBSOCKET (PHASE 6.4)
    // =========================================================================
    {
      console.log('\n--- Bắt đầu Load Test 100 người chơi đồng thời trên phòng Multiplayer ---');
      assert.ok(MULTIPLAYER_CONFIG.MAX_PLAYERS_PER_ROOM >= 100, 'MAX_PLAYERS_PER_ROOM phải hỗ trợ tối thiểu 100 người');

      const loadGameId = `game_v2_load100_${ts}`;
      createdGameIdsToClean.push(loadGameId);
      const loadSpec: GameSpecification = {
        ...examSpec,
        gameId: loadGameId,
        title: 'Đề Thi Load Test 100 Thí Sinh Đồng Thời',
        settings: {
          ...examSpec.settings,
          questionCount: 2,
          timePerQuestion: 15,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'EXAM',
          rosterMode: 'PRECONFIGURED',
          answersPublished: false,
          showExamLeaderboardToPlayers: false,
        },
        questions: [
          {
            ...examSpec.questions[0],
            timeLimitSeconds: 15,
          },
          {
            ...examSpec.questions[1],
            timeLimitSeconds: 5, // Câu 2 đặt 5 giây để test cả Timeout tự động
          },
        ],
      };
      gameStore.save(loadSpec, Date.now(), btcAuth.user.userId, true);

      // Tạo danh sách đúng 100 thí sinh trong Roster cho phòng thi 100 người
      const roster100Input = Array.from({ length: 100 }, (_, idx) => ({
        fullName: `Thí Sinh LoadTest ${String(idx + 1).padStart(3, '0')}`,
        departmentUnit: `Đơn Vị ${(idx % 5) + 1}`,
      }));
      const roster100Res = await requestRaw(
        baseUrl,
        'POST',
        `/api/games/${loadGameId}/participants`,
        {
          participants: roster100Input,
          replaceAll: true,
          rosterMode: 'PRECONFIGURED',
        },
        btcHeaders
      );
      assert.equal(roster100Res.status, 200);
      const roster100List = roster100Res.json.data.participants as Array<any>;
      assert.equal(roster100List.length, 100);

      // Tạo phòng Multiplayer với sức chứa 100 thí sinh đồng thời
      const createRoomRes = await requestRaw(
        baseUrl,
        'POST',
        '/api/rooms',
        { gameId: loadGameId, capacity: 100 },
        btcHeaders
      );
      assert.equal(createRoomRes.status, 200);
      const { roomCode, hostToken } = createRoomRes.json.data;

      const hostWs = new WsTestClient(wsUrl);
      await hostWs.waitForOpen();
      hostWs.send({ type: 'host.join', roomCode, hostToken });
      await hostWs.waitForMessage((m) => m.type === 'room.joined' && m.role === 'host');

      // Mở đồng thời 100 kết nối WebSocket cho 100 thí sinh
      const connectStartMs = Date.now();
      const playerClients: WsTestClient[] = [];
      const playerTokens: string[] = new Array(100);

      try {
        for (let i = 0; i < 100; i++) {
          playerClients.push(new WsTestClient(wsUrl));
        }
        await Promise.all(playerClients.map((c) => c.waitForOpen(10000)));
        const connectElapsedMs = Date.now() - connectStartMs;

        // 100 thí sinh gửi lệnh player.join đồng thời
        const joinStartMs = Date.now();
        await Promise.all(
          playerClients.map(async (client, idx) => {
            const p = roster100List[idx];
            client.send({
              type: 'player.join',
              roomCode,
              displayName: p.fullName,
              participantId: p.participantId,
              departmentUnit: p.departmentUnit,
            });
            const joinedMsg = await client.waitForMessage(
              (m) => m.type === 'room.joined' && m.role === 'player',
              10000
            );
            playerTokens[idx] = joinedMsg.playerToken;
          })
        );
        const joinElapsedMs = Date.now() - joinStartMs;

        // Kiểm tra kết nối thứ 101 bị từ chối với ROOM_FULL
        const extraClient = new WsTestClient(wsUrl);
        await extraClient.waitForOpen();
        extraClient.send({
          type: 'player.join',
          roomCode,
          displayName: 'Thí Sinh Thứ 101 Vượt Quá Giới Hạn',
        });
        const fullErrMsg = await extraClient.waitForMessage((m) => m.type === 'error', 5000);
        assert.equal(fullErrMsg.code, 'ROOM_FULL', 'Người thứ 101 vào phòng phải nhận lỗi ROOM_FULL');
        extraClient.close();

        // Host bắt đầu câu hỏi số 1 -> Cả 100 thí sinh nhận được question.started
        hostWs.send({ type: 'host.start' });
        await Promise.all(
          playerClients.map((c) =>
            c.waitForMessage(
              (m) => m.type === 'question.started' && m.question.id === 'q_exam_1',
              10000
            )
          )
        );

        // Kiểm tra Reconnect giữa câu hỏi: Thí sinh #0 ngắt kết nối và kết nối lại bằng playerToken
        playerClients[0].close();
        const reconnectedClient0 = new WsTestClient(wsUrl);
        await reconnectedClient0.waitForOpen();
        playerClients[0] = reconnectedClient0;
        reconnectedClient0.send({
          type: 'player.join',
          roomCode,
          displayName: roster100List[0].fullName,
          participantId: roster100List[0].participantId,
          playerToken: playerTokens[0],
        });
        const reconnectedJoinMsg = await reconnectedClient0.waitForMessage(
          (m) => m.type === 'room.joined' && m.role === 'player',
          5000
        );
        assert.equal(
          reconnectedJoinMsg.playerToken,
          playerTokens[0],
          'Thí sinh #0 kết nối lại phải được khôi phục đúng phiên playerToken'
        );

        // Kiểm tra chống Duplicate Submit: Thí sinh #0 gửi 2 lần liên tiếp
        reconnectedClient0.send({
          type: 'player.answer',
          questionId: 'q_exam_1',
          answer: 'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố',
        });
        await reconnectedClient0.waitForMessage(
          (m) => m.type === 'question.answerReceived' && m.questionId === 'q_exam_1',
          5000
        );
        reconnectedClient0.send({
          type: 'player.answer',
          questionId: 'q_exam_1',
          answer: 'B. Ngay sau mỗi câu hỏi',
        });
        const dupErr = await reconnectedClient0.waitForMessage((m) => m.type === 'error', 5000);
        assert.equal(
          dupErr.code,
          'QUESTION_ALREADY_ANSWERED',
          'Gửi đáp án lần 2 cho cùng câu hỏi phải bị chặn QUESTION_ALREADY_ANSWERED'
        );

        // 99 thí sinh còn lại đồng loạt nộp bài câu 1 (80 người chọn đúng A, 19 người chọn sai B)
        const submitStartMs = Date.now();
        await Promise.all(
          playerClients.slice(1).map(async (client, idx) => {
            const actualIdx = idx + 1;
            const choice =
              actualIdx < 80
                ? 'A. Chỉ khi toàn bộ đợt thi kết thúc và BTC chủ động bấm công bố'
                : 'B. Ngay sau mỗi câu hỏi';
            client.send({
              type: 'player.answer',
              questionId: 'q_exam_1',
              answer: choice,
            });
            await client.waitForMessage(
              (m) => m.type === 'question.answerReceived' && m.questionId === 'q_exam_1',
              10000
            );
          })
        );
        const submit100ElapsedMs = Date.now() - submitStartMs;

        // Khi cả 100 người đã nộp ở câu 1, Server tự động chuyển sang REVEAL và phát question.revealed
        const revealedQ1Player0 = await playerClients[0].waitForMessage(
          (m) => m.type === 'question.revealed' && m.questionId === 'q_exam_1',
          10000
        );
        // Bảo mật Chế độ THI qua WebSocket: question.revealed KHÔNG được lộ correctAnswer, explanation, hay kết quả đúng/sai thật
        assert.equal(
          revealedQ1Player0.correctAnswer,
          '',
          'WebSocket question.revealed ở chế độ THI tuyệt đối không được lộ correctAnswer'
        );
        assert.equal(
          revealedQ1Player0.explanation,
          undefined,
          'WebSocket question.revealed ở chế độ THI tuyệt đối không được lộ explanation'
        );
        assert.equal(
          revealedQ1Player0.personalResult?.examRedacted,
          true,
          'WebSocket question.revealed ở chế độ THI phải che kết quả của thí sinh (examRedacted = true)'
        );
        assert.equal(
          revealedQ1Player0.personalResult?.isCorrect,
          false,
          'WebSocket question.revealed ở chế độ THI không được báo isCorrect = true cho dù thí sinh chọn đúng'
        );

        // Chuyển sang câu hỏi số 2: 90 người đầu nộp ngay, 10 người cuối không nộp để kiểm tra Timeout
        hostWs.send({ type: 'host.next' });
        await Promise.all(
          playerClients.map((c) =>
            c.waitForMessage(
              (m) => m.type === 'question.started' && m.question.id === 'q_exam_2',
              10000
            )
          )
        );

        await Promise.all(
          playerClients.slice(0, 90).map(async (client) => {
            client.send({
              type: 'player.answer',
              questionId: 'q_exam_2',
              answer: 'A. LATEST_ATTEMPT (Lấy kết quả của lượt thi hợp lệ mới nhất)',
            });
            await client.waitForMessage(
              (m) => m.type === 'question.answerReceived' && m.questionId === 'q_exam_2',
              10000
            );
          })
        );

        // Chờ câu 2 (timeLimitSeconds = 5s) tự hết giờ cho 10 người còn lại
        const revealedQ2Host = await hostWs.waitForMessage(
          (m) => m.type === 'question.revealed' && m.questionId === 'q_exam_2',
          8000
        );
        assert.equal(revealedQ2Host.questionId, 'q_exam_2', 'Câu 2 phải tự động đóng khi hết giờ (Timeout)');

        // Kết thúc trận đấu -> Nhận game.finished với đầy đủ 100 thí sinh trong bảng xếp hạng
        hostWs.send({ type: 'host.next' });
        const finishedHostMsg = await hostWs.waitForMessage((m) => m.type === 'game.finished', 10000);
        assert.equal(
          finishedHostMsg.leaderboard.length,
          100,
          'Khi kết thúc phòng thi 100 người, bảng xếp hạng của Host phải có đủ 100 người'
        );
        assert.ok(finishedHostMsg.winner, 'Phải xác định đúng người dẫn đầu (Winner)');

        // Kiểm tra toàn bộ 100 lượt thi Multiplayer đã được lưu bền vững vào bảng điểm SQLite (game_participant_attempts)
        const loadSbRes = await requestRaw(
          baseUrl,
          'GET',
          `/api/games/${loadGameId}/scoreboard?limit=200`,
          undefined,
          btcHeaders
        );
        assert.equal(loadSbRes.status, 200);
        assert.equal(
          loadSbRes.json.data.totals.completedCount,
          100,
          'Cả 100 thí sinh trong phòng Multiplayer phải được lưu trạng thái COMPLETED vào bảng điểm DB'
        );

        console.log(
          `✓ [PASS] Phase 6.4 Load Test 100 người chơi đồng thời:\n` +
            `  - Kết nối 100 WebSockets: ${connectElapsedMs}ms\n` +
            `  - 100 thí sinh Join phòng đồng thời: ${joinElapsedMs}ms\n` +
            `  - 100 thí sinh nộp đáp án đồng thời: ${submit100ElapsedMs}ms\n` +
            `  - Chặn người thứ 101 (ROOM_FULL), Reconnect giữa câu, Chặn nộp trùng (ALREADY_ANSWERED), Timeout tự động và Lưu 100/100 kết quả thành công.`
        );
      } finally {
        for (const c of playerClients) {
          c.close();
        }
        hostWs.close();
        try {
          roomService.closeRoom(roomCode);
        } catch {
          // ignore
        }
      }
    }

    // =========================================================================
    // 9. KIỂM THỬ BROWSER E2E THỰC TẾ TRÊN CHROMIUM (DESKTOP 1440x900 & MOBILE 390x844)
    // =========================================================================
    {
      console.log('\n--- Bắt đầu Kiểm thử Browser E2E thực tế cho các tính năng V2 (Desktop 1440x900 & Mobile 390x844) ---');
      const browser = await Browser.launch({ width: 1440, height: 900 });
      try {
        const page = await browser.newPage({ width: 1440, height: 900 });

        // Đăng nhập BTC và mở trang Tạo Game (/?tab=demo) với game đã tạo
        await page.goto(`${baseUrl}/?tab=demo`);
        await page.eval(`(() => {
          sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(btcAuth.token)});
          sessionStorage.setItem('ai_game_creator_current_session_v1', JSON.stringify({
            spec: ${JSON.stringify(examSpec)},
            saveStatus: 'saved',
            savedForLater: true,
            customGameTitle: ${JSON.stringify(examSpec.title)}
          }));
        })()`);
        await page.goto(`${baseUrl}/?tab=demo`);
        await sleep(800);

        // 9.1. Kiểm tra hiển thị cấu hình V2 (Chế độ Chơi/Thi, Quản lý Thí sinh & Bảng điểm BTC) trên DemoPage
        const creatorUiCheck = await page.eval(`(() => {
          const questionsSec = document.querySelector('[data-testid="generated-questions-section"]');
          const openBtcBtn = document.querySelector('[data-testid="open-btc-manager-btn"]');
          const playtestBtn = document.querySelector('[data-testid="playtest-game-btn"]');
          return {
            hasQuestions: Boolean(questionsSec),
            hasOpenBtcBtn: Boolean(openBtcBtn),
            hasPlaytestBtn: Boolean(playtestBtn),
            horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          };
        })()`);
        assert.equal(creatorUiCheck.hasQuestions, true, 'Trang Tạo Game phải hiển thị danh sách câu hỏi');
        assert.equal(creatorUiCheck.hasOpenBtcBtn, true, 'Trang Tạo Game phải có nút Quản lý Thí sinh & Bảng điểm BTC');
        assert.equal(creatorUiCheck.hasPlaytestBtn, true, 'Trang Tạo Game phải có nút Chơi thử');
        assert.equal(creatorUiCheck.horizontalOverflowPx, 0, 'Desktop 1440x900 không được tràn ngang');

        // Mở Modal Quản lý Thí sinh & Bảng điểm BTC để kiểm tra UI thực tế
        await page.eval(`document.querySelector('[data-testid="open-btc-manager-btn"]').click()`);
        await sleep(500);
        const btcModalCheck = await page.eval(`(() => {
          const modal = document.querySelector('[data-testid="btc-roster-scoreboard-modal"]');
          const rosterTab = document.querySelector('[data-testid="btc-tab-roster"]');
          const scoreboardTab = document.querySelector('[data-testid="btc-tab-scoreboard"]');
          return {
            hasModal: Boolean(modal),
            hasRosterTab: Boolean(rosterTab),
            hasScoreboardTab: Boolean(scoreboardTab),
          };
        })()`);
        assert.equal(btcModalCheck.hasModal, true, 'Bấm nút Quản lý Thí sinh & Bảng điểm phải mở Modal BTC');
        assert.equal(btcModalCheck.hasRosterTab, true);
        assert.equal(btcModalCheck.hasScoreboardTab, true);
        await page.eval(`document.querySelector('[data-testid="close-btc-modal-btn"]').click()`);
        await sleep(250);

        // 9.2. Kiểm tra Phase 2: Mở Chơi thử (Playtest) và Sửa trực tiếp câu hỏi ngay trong màn hình Chơi thử
        await page.eval(`document.querySelector('[data-testid="playtest-game-btn"]').click()`);
        await sleep(500);

        const playtestEditOpenCheck = await page.eval(`(() => {
          const editBtn = document.querySelector('[data-testid="playtest-inline-edit-btn"]');
          if (editBtn) editBtn.click();
          return Boolean(editBtn);
        })()`);
        assert.equal(playtestEditOpenCheck, true, 'Trong Playtest phải có nút Chỉnh sửa câu này cho Creator/Admin');
        await sleep(300);

        const playtestEditorVisible = await page.eval(`(() => {
          const panel = document.querySelector('[data-testid="playtest-inline-edit-modal"]');
          const qInput = document.querySelector('[data-testid="playtest-inline-question-input"]');
          const timeInput = document.querySelector('[data-testid="playtest-inline-time-input"]');
          return {
            hasPanel: Boolean(panel),
            hasQInput: Boolean(qInput),
            hasTimeInput: Boolean(timeInput),
          };
        })()`);
        assert.equal(playtestEditorVisible.hasPanel, true, 'Bấm Chỉnh sửa câu này phải mở panel chỉnh sửa ngay trong Playtest');
        assert.equal(playtestEditorVisible.hasQInput, true);
        assert.equal(playtestEditorVisible.hasTimeInput, true);

        // Chỉnh sửa nội dung câu hỏi số 1 ngay trong Playtest và bấm Lưu cập nhật vào cùng gameId
        await page.eval(`(() => {
          const qInput = document.querySelector('[data-testid="playtest-inline-question-input"]');
          if (qInput) {
            qInput.focus();
            qInput.select();
          }
        })()`);
        await page.send('Input.insertText', {
          text: 'Câu 1 (Đã sửa trực tiếp trong Playtest): Khi nào đáp án bài thi được mở?',
        });
        await sleep(200);
        await page.eval(`document.querySelector('[data-testid="playtest-inline-save-btn"]').click()`);
        await sleep(600);

        const afterPlaytestSave = await page.eval(`(() => {
          const overlay = document.querySelector('[data-testid="playtest-overlay"]');
          return {
            editorClosed: !document.querySelector('[data-testid="playtest-inline-edit-modal"]'),
            overlayText: overlay ? overlay.innerText : '',
          };
        })()`);
        assert.equal(afterPlaytestSave.editorClosed, true, 'Sau khi lưu câu hỏi trong Playtest, panel sửa phải đóng lại để tiếp tục chơi thử');
        assert.ok(
          afterPlaytestSave.overlayText.includes('Câu 1 (Đã sửa trực tiếp trong Playtest)'),
          'Màn hình Playtest phải cập nhật ngay nội dung câu hỏi vừa sửa'
        );

        // Thoát Playtest và kiểm tra câu hỏi trên trang Tạo Game cũng như trên Backend cùng gameId đã được đồng bộ
        await page.eval(`document.querySelector('[data-testid="exit-playtest-btn"]').click()`);
        await sleep(400);

        const updatedSpecInDb = gameStore.get(examGameId);
        assert.equal(
          updatedSpecInDb?.questions[0].question,
          'Câu 1 (Đã sửa trực tiếp trong Playtest): Khi nào đáp án bài thi được mở?',
          'Lưu câu hỏi trong Playtest phải cập nhật vào đúng cùng gameId trên Backend'
        );
        console.log('✓ [PASS] E2E Phase 2: Chỉnh sửa trực tiếp câu hỏi ngay trong Playtest, lưu vào cùng gameId và tiếp tục chơi thử thành công.');

        // 9.3. Kiểm tra luồng Thí sinh mở link Solo (`/?play=...`) -> Chọn tên từ Roster -> Xác nhận "Đây là tôi" -> Làm bài -> Nhận kết quả 4 mức
        // Sử dụng thí sinh số 10 trong danh sách (Thí Sinh Số 010)
        const targetCandidate = allParticipants.find((p) => p.fullName === 'Thí Sinh Số 010')!;
        await page.eval(`(() => {
          sessionStorage.clear();
        })()`);
        await page.goto(`${baseUrl}/?play=${encodeURIComponent(examGameId)}`);
        await sleep(900);

        const rosterGateCheck = await page.eval(`(() => {
          const gate = document.querySelector('[data-testid="solo-roster-gate"]');
          const optionBtn = document.querySelector('[data-testid="roster-participant-option-${targetCandidate.participantId}"]');
          const editBtn = document.querySelector('[data-testid="playtest-inline-edit-btn"]');
          return {
            hasGate: Boolean(gate),
            hasOption: Boolean(optionBtn),
            hasEditBtn: Boolean(editBtn),
            horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          };
        })()`);
        assert.equal(rosterGateCheck.hasGate, true, 'Thí sinh mở link bài thi phải thấy màn hình Chọn tên từ danh sách (solo-roster-gate)');
        assert.equal(rosterGateCheck.hasOption, true, 'Danh sách phải hiển thị đúng tên thí sinh');
        assert.equal(rosterGateCheck.hasEditBtn, false, 'Thí sinh tuyệt đối không được thấy nút sửa câu hỏi của Creator');
        assert.equal(rosterGateCheck.horizontalOverflowPx, 0);

        // Chọn tên và xác nhận "Đây là tôi"
        await page.eval(`document.querySelector('[data-testid="roster-participant-option-${targetCandidate.participantId}"]').click()`);
        await sleep(250);
        const confirmCardVisible = await page.eval(`Boolean(document.querySelector('[data-testid="roster-confirm-card"]'))`);
        assert.equal(confirmCardVisible, true, 'Phải hiển thị hộp xác nhận danh tính trước khi bắt đầu');

        await page.eval(`document.querySelector('[data-testid="confirm-participant-identity-btn"]').click()`);
        await sleep(700);

        // Kiểm tra câu hỏi 1 hiển thị rõ ràng cùng nút điều khiển âm thanh, và kiểm tra Responsive trên cả Mobile 390x844
        await page.setViewport({ width: 390, height: 844 });
        await sleep(300);
        const mobileQuestionCheck = await page.eval(`(() => {
          const muteBtn = document.querySelector('[data-testid="audio-mute-toggle-btn"]');
          return {
            hasMuteBtn: Boolean(muteBtn),
            bodyText: document.body.innerText,
            horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          };
        })()`);
        assert.equal(mobileQuestionCheck.hasMuteBtn, true, 'Màn hình làm bài phải có nút điều khiển âm thanh (Mute/Unmute)');
        assert.ok(mobileQuestionCheck.bodyText.includes('Câu 1 (Đã sửa trực tiếp trong Playtest)'), 'Phải hiển thị câu hỏi số 1');
        assert.equal(
          mobileQuestionCheck.horizontalOverflowPx,
          0,
          'Giao diện câu hỏi trên Mobile 390x844 không được có horizontal overflow'
        );

        // Khôi phục viewport Desktop 1440x900
        await page.setViewport({ width: 1440, height: 900 });
        await sleep(200);

        console.log('✓ [PASS] E2E Phase 3, 4 & Responsive: Chọn tên từ Roster, Xác nhận danh tính, Điều khiển âm thanh, Desktop (1440x900) & Mobile (390x844) horizontalOverflowPx = 0.');
      } finally {
        await browser.close();
      }
    }

    console.log('\n=== TẤT CẢ CÁC BÀI KIỂM THỬ UNIT, INTEGRATION, SECURITY, LOAD TEST 100 NGƯỜI & BROWSER E2E CỦA V2 ĐỀU PASS TUYỆT ĐỐI ===');
  } finally {
    try {
      wsServer.close();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Dọn dẹp toàn bộ dữ liệu test và file nhạc test đã tạo để không làm bẩn database hiện tại
    const db = getDatabase();
    for (const gid of createdGameIdsToClean) {
      try {
        sessionStore.deleteSessionsForGame(gid);
      } catch {
        // ignore
      }
      try {
        gameStore.delete(gid);
      } catch {
        // ignore
      }
      try {
        db.prepare('DELETE FROM game_participant_attempts WHERE game_id = ?').run(gid);
        db.prepare('DELETE FROM game_participants WHERE game_id = ?').run(gid);
        db.prepare('DELETE FROM practice_sessions WHERE game_id = ?').run(gid);
        db.prepare('DELETE FROM room_history WHERE game_id = ?').run(gid);
        db.prepare('DELETE FROM game_questions WHERE game_id = ?').run(gid);
        db.prepare('DELETE FROM games WHERE game_id = ?').run(gid);
      } catch {
        // ignore
      }
    }
    for (const filePath of uploadedAudioFilesToClean) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  }
}

runAllAcceptanceTests().catch((err) => {
  console.error('V2 COMPREHENSIVE ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
