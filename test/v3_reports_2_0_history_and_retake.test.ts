import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';

import { createApp } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { closeDatabase, getDatabase } from '../src/storage/sqlite.db.js';

const ARTIFACT_DIR =
  'C:\\Users\\QUOC SIEU\\.gemini\\antigravity\\brain\\83ff8c51-8136-444f-904b-1284fcdde2fb';

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
  public server5xxErrors: string[] = [];

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
          if (!text.includes('favicon.ico') && !text.includes('Failed to load resource')) {
            this.consoleErrors.push(text);
          }
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.pageErrors.push(
          msg.params?.exceptionDetails?.text ||
            msg.params?.exceptionDetails?.exception?.description ||
            'Unknown page exception'
        );
      } else if (msg.method === 'Network.responseReceived') {
        const status = msg.params?.response?.status ?? 0;
        const url = msg.params?.response?.url ?? '';
        if (status >= 500) {
          this.server5xxErrors.push(`${status} ${url}`);
        }
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
    await this.send('Network.enable');
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
    for (let i = 0; i < 40; i++) {
      const state = await this.eval('document.readyState');
      if (state === 'complete') break;
      await sleep(100);
    }
    await sleep(500);
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

  public async waitForSelector(selector: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.eval<boolean>(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`
      );
      if (exists) return;
      await sleep(120);
    }
    throw new Error(`Timed out waiting for selector: ${selector}`);
  }

  public async clickSelector(selector: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.click();
    })()`);
    await sleep(300);
  }

  public async scrollToSelector(selector: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.scrollIntoView({ block: 'start', inline: 'nearest' });
    })()`);
    await sleep(250);
  }

  public async screenshot(outputPath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buf);
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
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-reports-2-0-e2e-'));
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

function createSampleQuizSpec(
  gameId: string,
  title: string,
  overrides: Partial<GameSpecification['settings']> = {}
): GameSpecification {
  return {
    gameId,
    title,
    description: `Mô tả kiểm thử cho ${title}`,
    gameType: 'QUIZ',
    settings: {
      questionCount: 5,
      timeLimitSeconds: 150,
      pointsPerQuestion: 200,
      scoringMode: 'FIXED',
      sessionMode: 'PLAY',
      rosterMode: 'FREE_TEXT',
      maxAttemptsPerParticipant: 1,
      officialAttemptPolicy: 'HIGHEST_SCORE',
      passThresholdPercent: 60,
      examAnswerRevealPolicy: 'NEVER',
      answersPublished: false,
      examStatus: 'OPEN',
      examClosedAt: null,
      requireDepartmentUnit: false,
      soundSettings: {
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
        question: 'Câu 1: Thủ đô của Việt Nam là gì?',
        choices: ['Hà Nội', 'Đà Nẵng', 'TP.HCM', 'Huế'],
        correctAnswer: 'Hà Nội',
        explanation: 'Hà Nội là thủ đô của nước CHXHCN Việt Nam.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 'src_test', sourceType: 'TXT', sourceLocation: 'test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q2',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 2: 5 x 5 bằng bao nhiêu?',
        choices: ['20', '25', '30', '35'],
        correctAnswer: '25',
        explanation: '5 nhân 5 bằng 25.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 'src_test', sourceType: 'TXT', sourceLocation: 'test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q3',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 3: HTTP viết tắt của từ gì?',
        choices: [
          'HyperText Transfer Protocol',
          'High Transfer Text Process',
          'Hyperlink Text Tool',
          'Host Transfer Protocol',
        ],
        correctAnswer: 'HyperText Transfer Protocol',
        explanation: 'HTTP là giao thức truyền tải siêu văn bản.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 'src_test', sourceType: 'TXT', sourceLocation: 'test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q4',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 4: SQLite lưu dữ liệu ở đâu?',
        choices: ['Một file cục bộ hoặc bộ nhớ', 'Chỉ trên đám mây', 'Trong CSS', 'Trong HTML'],
        correctAnswer: 'Một file cục bộ hoặc bộ nhớ',
        explanation: 'SQLite là cơ sở dữ liệu nhúng lưu trong một tệp đơn hoặc RAM.',
        difficulty: 'EASY',
        sourceReference: { sourceId: 'src_test', sourceType: 'TXT', sourceLocation: 'test.txt' },
        timeLimitSeconds: 30,
      },
      {
        id: 'q5',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 5: Mã trạng thái HTTP thành công chuẩn là?',
        choices: ['200', '404', '500', '403'],
        correctAnswer: '200',
        explanation: 'HTTP 200 OK biểu thị thành công.',
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

describe('V3 Reports 2.0 — History, Leaderboard, Exam Batches, Retake Granting & Reopen Exam (36 Cases + Browser E2E)', () => {
  let tempDir: string;
  let dbFilePath: string;
  let serverInstance: http.Server;
  let baseUrl: string;
  let browser: Browser | null = null;

  const correctAnswersMap: Record<string, string> = {
    q1: 'Hà Nội',
    q2: '25',
    q3: 'HyperText Transfer Protocol',
    q4: 'Một file cục bộ hoặc bộ nhớ',
    q5: '200',
  };
  const wrongAnswersMap: Record<string, string> = {
    q1: 'Đà Nẵng',
    q2: '20',
    q3: 'Host Transfer Protocol',
    q4: 'Trong CSS',
    q5: '404',
  };

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-v3-reports-2-0-'));
    dbFilePath = path.join(tempDir, 'reports_2_0_test.sqlite');
    process.env.SQLITE_DB_PATH = dbFilePath;
    closeDatabase();
    getDatabase(dbFilePath);

    const app = createApp();
    serverInstance = http.createServer(app);
    await new Promise<void>((resolve) => {
      serverInstance.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = serverInstance.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (serverInstance) {
      await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
    }
    closeDatabase();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function apiFetch(
    endpoint: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: any;
    } = {}
  ) {
    const headers: Record<string, string> = {
      'X-Creator-Library': '1',
      ...(options.headers || {}),
    };
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  /**
   * Helper to run a complete Solo session (or abandon it) using /api/games/sessions
   */
  async function runSoloAttempt(params: {
    gameId: string;
    participantId?: string;
    playerName: string;
    departmentUnit?: string;
    correctCount: number;
    abandonAfterStart?: boolean;
  }) {
    const createRes = await apiFetch('/api/games/sessions', {
      method: 'POST',
      body: {
        gameId: params.gameId,
        participantId: params.participantId,
        playerName: params.playerName,
        departmentUnit: params.departmentUnit,
      },
    });
    if (createRes.status !== 200) {
      return createRes;
    }
    const sessionId = createRes.json.data.sessionId as string;
    const lockToken = createRes.json.data.lockToken as string;
    const tokenHeaders = { 'X-Participant-Token': lockToken };

    await apiFetch(`/api/games/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: tokenHeaders,
      body: {},
    });

    if (params.abandonAfterStart) {
      const abRes = await apiFetch(`/api/games/sessions/${sessionId}/abandon`, {
        method: 'POST',
        body: {},
      });
      return { status: abRes.status, json: abRes.json, sessionId, lockToken };
    }

    const qIds = ['q1', 'q2', 'q3', 'q4', 'q5'];
    for (let i = 0; i < qIds.length; i++) {
      const qId = qIds[i];
      const ans = i < params.correctCount ? correctAnswersMap[qId] : wrongAnswersMap[qId];
      await apiFetch(`/api/games/sessions/${sessionId}/answer`, {
        method: 'POST',
        headers: tokenHeaders,
        body: { questionId: qId, answer: ans },
      });
      await apiFetch(`/api/games/sessions/${sessionId}/next`, {
        method: 'POST',
        headers: tokenHeaders,
        body: {},
      });
    }
    return { status: 200, json: createRes.json, sessionId, lockToken };
  }

  let creatorBToken = '';
  let playGameOldId = '';
  let playGameNewId = '';
  let playGameEmptyId = '';
  let examGameId = '';
  let participant1Id = '';
  let participant2Id = '';
  let participant3Id = '';
  let playParticipantAId = '';
  let playParticipantDup1Id = '';
  let playParticipantDup2Id = '';

  // =========================================================================
  // 12.1. Tổng quan Reports (Cases 1 – 6)
  // =========================================================================
  it('Cases 1-6: Reports Overview loads without login, shows Library PLAY & EXAM games, sorts by latest activity, and handles empty history games', async () => {
    // 1. Create empty PLAY game
    playGameEmptyId = `game_play_empty_${Date.now()}`;
    const emptySpec = createSampleQuizSpec(playGameEmptyId, 'Game PLAY Chưa Có Lượt Chơi', {
      sessionMode: 'PLAY',
      rosterMode: 'FREE_TEXT',
    });
    gameStore.save(emptySpec, Date.now() - 30000, null, true);

    // 2. Create PLAY game with preconfigured roster
    playGameOldId = `game_play_roster_${Date.now()}`;
    const play1Spec = createSampleQuizSpec(playGameOldId, 'Game PLAY Đua Top Kiến Thức', {
      sessionMode: 'PLAY',
      rosterMode: 'PRECONFIGURED',
      maxAttemptsPerParticipant: 2,
    });
    gameStore.save(play1Spec, Date.now() - 20000, null, true);
    const playParts = persistenceRepo.upsertParticipants(
      playGameOldId,
      [
        {
          fullName: 'Nguyễn Văn An',
          departmentUnit: 'Phòng Kỹ Thuật',
          employeeCode: 'NV001',
          allowedAttempts: 2,
        },
        {
          fullName: 'Trần Minh Tâm',
          departmentUnit: 'Chi nhánh Hà Nội',
          employeeCode: 'NV002',
          allowedAttempts: 2,
        },
        {
          fullName: 'Trần Minh Tâm',
          departmentUnit: 'Chi nhánh Sài Gòn',
          employeeCode: 'NV003',
          allowedAttempts: 2,
        },
      ],
      true
    );
    playParticipantAId = playParts.find((p) => p.employeeCode === 'NV001')!.participantId;
    playParticipantDup1Id = playParts.find((p) => p.employeeCode === 'NV002')!.participantId;
    playParticipantDup2Id = playParts.find((p) => p.employeeCode === 'NV003')!.participantId;

    // 3. Create EXAM game with preconfigured roster (allowedAttempts = 1, passThresholdPercent = 60)
    examGameId = `game_exam_q4_${Date.now()}`;
    const examSpec = createSampleQuizSpec(
      examGameId,
      'Kỳ Thi Sát Hạch An Toàn Thông Tin Q4',
      {
        sessionMode: 'EXAM',
        rosterMode: 'PRECONFIGURED',
        maxAttemptsPerParticipant: 1,
        passThresholdPercent: 60,
        officialAttemptPolicy: 'HIGHEST_SCORE',
        examAnswerRevealPolicy: 'NEVER',
      }
    );
    gameStore.save(examSpec, Date.now() - 10000, null, true);
    const examParts = persistenceRepo.upsertParticipants(
      examGameId,
      [
        {
          fullName: 'Lê Hoàng Nam',
          departmentUnit: 'Khối Công Nghệ',
          employeeCode: 'EX001',
          allowedAttempts: 1,
        },
        {
          fullName: 'Phạm Thu Hà',
          departmentUnit: 'Khối Vận Hành',
          employeeCode: 'EX002',
          allowedAttempts: 1,
        },
        {
          fullName: 'Đỗ Quốc Bảo',
          departmentUnit: 'Khối Tài Chính',
          employeeCode: 'EX003',
          allowedAttempts: 1,
        },
      ],
      true
    );
    participant1Id = examParts.find((p) => p.employeeCode === 'EX001')!.participantId;
    participant2Id = examParts.find((p) => p.employeeCode === 'EX002')!.participantId;
    participant3Id = examParts.find((p) => p.employeeCode === 'EX003')!.participantId;

    // 4. Create second PLAY game (FREE_TEXT)
    playGameNewId = `game_play_free_${Date.now()}`;
    const play2Spec = createSampleQuizSpec(playGameNewId, 'Game PLAY Giao Lưu Tự Do', {
      sessionMode: 'PLAY',
      rosterMode: 'FREE_TEXT',
    });
    gameStore.save(play2Spec, Date.now() - 5000, null, true);

    // Case 1 & 2: Unauthenticated Creator opens Reports Overview -> sees all 4 games (PLAY & EXAM)
    const overviewRes1 = await apiFetch('/api/games/reports/overview');
    assert.equal(overviewRes1.status, 200);
    assert.equal(overviewRes1.json.data.summary.totalGames, 4);
    assert.equal(overviewRes1.json.data.summary.playGamesCount, 3);
    assert.equal(overviewRes1.json.data.summary.examGamesCount, 1);

    // Case 6: Game without history displays lastActivityAt === null & totalAttempts === 0
    const emptyItem = overviewRes1.json.data.games.find(
      (g: any) => g.gameId === playGameEmptyId
    );
    assert.ok(emptyItem);
    assert.equal(emptyItem.totalAttempts, 0);
    assert.equal(emptyItem.lastActivityAt, null);

    // Case 4: Play a session on playGameOldId (3/5 correct = 600 pts) -> playGameOldId moves to top!
    const play1Run = await runSoloAttempt({
      gameId: playGameOldId,
      participantId: playParticipantAId,
      playerName: 'Nguyễn Văn An',
      correctCount: 3,
    });
    assert.equal(play1Run.status, 200);

    const overviewAfterPlay = await apiFetch('/api/games/reports/overview');
    assert.equal(overviewAfterPlay.status, 200);
    assert.equal(overviewAfterPlay.json.data.games[0].gameId, playGameOldId);

    // Wait 20ms then submit an EXAM attempt on examGameId (2/5 correct = 400 pts -> FAILED) -> Case 3 & 5: examGameId moves to #1!
    await sleep(20);
    const exam1Run = await runSoloAttempt({
      gameId: examGameId,
      participantId: participant1Id,
      playerName: 'Lê Hoàng Nam',
      correctCount: 2,
    });
    assert.equal(exam1Run.status, 200);

    const overviewAfterExam = await apiFetch('/api/games/reports/overview');
    assert.equal(overviewAfterExam.status, 200);
    assert.equal(overviewAfterExam.json.data.games[0].gameId, examGameId);
    assert.equal(overviewAfterExam.json.data.games[1].gameId, playGameOldId);
  });

  // =========================================================================
  // 12.2. Chế độ PLAY (Cases 7 – 14)
  // =========================================================================
  it('Cases 7-14: PLAY mode Leaderboard uses HIGHEST_SCORE (no cumulative summing), deterministic tie-breaker, keeps duplicate names with distinct IDs separate, records every play attempt, hides correctAnswer in PLAY history, and supports granting PLAY retakes', async () => {
    // Player A (Nguyễn Văn An) plays a 2nd attempt and gets 1000 pts (5/5 correct)
    const playA2 = await runSoloAttempt({
      gameId: playGameOldId,
      participantId: playParticipantAId,
      playerName: 'Nguyễn Văn An',
      correctCount: 5,
    });
    assert.equal(playA2.status, 200);

    // Duplicate name Player 1 (Trần Minh Tâm - NV002) gets 800 pts (4/5 correct)
    const playDup1 = await runSoloAttempt({
      gameId: playGameOldId,
      participantId: playParticipantDup1Id,
      playerName: 'Trần Minh Tâm',
      correctCount: 4,
    });
    assert.equal(playDup1.status, 200);

    // Duplicate name Player 2 (Trần Minh Tâm - NV003) ALSO gets 800 pts (4/5 correct)
    const playDup2 = await runSoloAttempt({
      gameId: playGameOldId,
      participantId: playParticipantDup2Id,
      playerName: 'Trần Minh Tâm',
      correctCount: 4,
    });
    assert.equal(playDup2.status, 200);

    const playReportRes = await apiFetch(`/api/games/${playGameOldId}/reports`);
    assert.equal(playReportRes.status, 200);
    const playReport = playReportRes.json.data;

    // Case 7 & 8: Leaderboard shows Top 1, Top 2, Top 3; Player A appears ONCE with highestScore = 500 (NOT 300 + 500 = 800)
    assert.equal(playReport.playLeaderboard.rule, 'HIGHEST_SCORE');
    assert.equal(playReport.playLeaderboard.entries.length, 3);
    const rank1 = playReport.playLeaderboard.entries[0];
    assert.equal(rank1.rank, 1);
    assert.equal(rank1.participantId, playParticipantAId);
    assert.equal(rank1.highestScore, 500);
    assert.equal(rank1.attemptsCount, 2);

    // Case 9 & 10: Two players named "Trần Minh Tâm" with distinct participantIds are NOT merged, and tie-break deterministically
    const rank2 = playReport.playLeaderboard.entries[1];
    const rank3 = playReport.playLeaderboard.entries[2];
    assert.equal(rank2.fullName, 'Trần Minh Tâm');
    assert.equal(rank3.fullName, 'Trần Minh Tâm');
    assert.notEqual(rank2.participantId, rank3.participantId);
    assert.equal(rank2.highestScore, 400);
    assert.equal(rank3.highestScore, 400);
    assert.ok(rank2.durationMs <= rank3.durationMs);

    // Case 11 & 12: Per-play attempt history records all 4 plays with score, correct/wrong answers, duration, status
    assert.equal(playReport.playAttemptsHistory.length, 4);
    for (const att of playReport.playAttemptsHistory) {
      assert.equal(typeof att.score, 'number');
      assert.equal(typeof att.correctAnswers, 'number');
      assert.equal(typeof att.wrongAnswers, 'number');
      assert.equal(att.correctAnswers + att.wrongAnswers, att.totalQuestions);
      // Case 14: PLAY history never reveals correctAnswer or explanation
      for (const q of att.questionBreakdown || []) {
        assert.equal(q.correctAnswer, null);
        assert.equal(q.explanation, null);
      }
    }

    const firstPlayHistoryId = playReport.playAttemptsHistory[0].historyId;
    if (firstPlayHistoryId) {
      const hDetail = await apiFetch(`/api/history/activities/${firstPlayHistoryId}`);
      assert.equal(hDetail.status, 200);
      assert.equal(hDetail.json.data.answersPublished, false);
      for (const q of hDetail.json.data.questionBreakdown || []) {
        assert.equal(q.correctAnswer, null);
        assert.equal(q.explanation, null);
      }
    }

    // Case 13: Grant extra PLAY attempt to playParticipantAId (used 2/2 -> becomes 2/3)
    const grantPlayRes = await apiFetch(
      `/api/games/${playGameOldId}/participants/${playParticipantAId}/grant-retake`,
      {
        method: 'POST',
        body: { additionalAttempts: 1 },
      }
    );
    assert.equal(grantPlayRes.status, 200);
    assert.equal(grantPlayRes.json.data.participant.usedAttempts, 2);
    assert.equal(grantPlayRes.json.data.participant.allowedAttempts, 3);
  });

  // =========================================================================
  // 12.3 & 12.4. Chế độ EXAM & Cấp thêm lượt thi (Cases 15 – 29)
  // =========================================================================
  it('Cases 15-29: EXAM mode batches, pass/fail rules, PENDING/ABANDONED states, granting retake attempts (+1 and +N), idempotency, preserving history, and live IN_PROGRESS safety', async () => {
    // Participant 2 (Phạm Thu Hà) starts an exam and abandons it
    const p2Abandon = await runSoloAttempt({
      gameId: examGameId,
      participantId: participant2Id,
      playerName: 'Phạm Thu Hà',
      correctCount: 0,
      abandonAfterStart: true,
    });
    assert.equal(p2Abandon.status, 200);

    // Participant 3 (Đỗ Quốc Bảo) has NOT taken the exam at all -> status = PENDING ('Chưa thi')
    const examReport1 = await apiFetch(`/api/games/${examGameId}/reports`);
    assert.equal(examReport1.status, 200);
    const r1 = examReport1.json.data;

    // Case 15 & 16: Batch 1 ('Đợt 1') exists with full metrics
    assert.ok(r1.examBatches.length >= 1);
    const batch1 = r1.examBatches[0];
    assert.ok(batch1.batchName.includes('Đợt 1'));
    assert.equal(batch1.totalParticipants, 3);
    assert.equal(batch1.completedCount, 1);
    assert.equal(batch1.abandonedCount, 1);
    assert.equal(batch1.pendingCount, 1);
    assert.equal(batch1.passedCount, 0);
    assert.equal(batch1.failedCount, 1);

    const p1Row = batch1.participants.find((p: any) => p.participantId === participant1Id);
    const p2Row = batch1.participants.find((p: any) => p.participantId === participant2Id);
    const p3Row = batch1.participants.find((p: any) => p.participantId === participant3Id);

    // Case 17 & 18: Participant 1 scored 200 (2/5 = 40% < 60%) -> isPassed = false
    assert.equal(p1Row.status, 'COMPLETED');
    assert.equal(p1Row.isPassed, false);
    assert.equal(p1Row.score, 200);
    assert.equal(p1Row.usedAttempts, 1);
    assert.equal(p1Row.allowedAttempts, 1);

    // Case 20: Abandoned is NOT marked COMPLETED
    assert.equal(p2Row.status, 'ABANDONED');

    // Case 19: Pending ('Chưa thi') has isPassed === null (NOT false)
    assert.equal(p3Row.status, 'PENDING');
    assert.equal(p3Row.isPassed, null);
    assert.equal(p3Row.score, null);

    // Case 22: Participant 1 has used 1/1 attempts -> trying to start 2nd attempt before grant is rejected (403)
    const blockedStart = await apiFetch('/api/games/sessions', {
      method: 'POST',
      body: {
        gameId: examGameId,
        participantId: participant1Id,
        playerName: 'Lê Hoàng Nam',
      },
    });
    assert.equal(blockedStart.status, 403);

    // Case 23 & 29: Creator grants +1 attempt from Reports with idempotency requestId (double call only increments once!)
    const idemKey = 'idem_grant_p1_attempt2';
    const [grant1, grant1Dup] = await Promise.all([
      apiFetch(`/api/games/${examGameId}/participants/${participant1Id}/grant-retake`, {
        method: 'POST',
        body: { additionalAttempts: 1, requestId: idemKey },
      }),
      apiFetch(`/api/games/${examGameId}/participants/${participant1Id}/grant-retake`, {
        method: 'POST',
        body: { additionalAttempts: 1, requestId: idemKey },
      }),
    ]);
    assert.equal(grant1.status, 200);
    assert.equal(grant1Dup.status, 200);
    assert.equal(grant1.json.data.participant.allowedAttempts, 2);
    assert.equal(grant1Dup.json.data.participant.allowedAttempts, 2);

    // Case 26: Participant 3 still has allowedAttempts === 1
    const afterGrantPList = await apiFetch(`/api/games/${examGameId}/participants`);
    const p3After = (afterGrantPList.json.data.participants as any[]).find(
      (p) => p.participantId === participant3Id
    );
    assert.equal(p3After.allowedAttempts, 1);

    // Case 28: Invalid additionalAttempts (0, -1, 'abc', 99) returns 400
    for (const badVal of [0, -1, 'abc', 99]) {
      const badRes = await apiFetch(
        `/api/games/${examGameId}/participants/${participant1Id}/grant-retake`,
        {
          method: 'POST',
          body: { additionalAttempts: badVal },
        }
      );
      assert.equal(badRes.status, 400);
    }

    // Case 24: Granting +2 attempts to Participant 2 increases allowedAttempts by 2 (from 1 to 3)
    const grantP2 = await apiFetch(
      `/api/games/${examGameId}/participants/${participant2Id}/grant-retake`,
      {
        method: 'POST',
        body: { additionalAttempts: 2 },
      }
    );
    assert.equal(grantP2.status, 200);
    assert.equal(grantP2.json.data.participant.allowedAttempts, 3);

    // Case 21 & 25: Participant 1 takes Attempt 2 and scores 400 pts (4/5 = 80% >= 60% -> PASSED). Attempt 1 (200 pts) is preserved!
    const p1Attempt2 = await runSoloAttempt({
      gameId: examGameId,
      participantId: participant1Id,
      playerName: 'Lê Hoàng Nam',
      correctCount: 4,
    });
    assert.equal(p1Attempt2.status, 200);

    const examReport2 = await apiFetch(`/api/games/${examGameId}/reports`);
    assert.equal(examReport2.status, 200);
    const p1AfterAttempt2 = examReport2.json.data.examBatches[0].participants.find(
      (p: any) => p.participantId === participant1Id
    );
    assert.equal(p1AfterAttempt2.usedAttempts, 2);
    assert.equal(p1AfterAttempt2.allowedAttempts, 2);
    assert.equal(p1AfterAttempt2.score, 400);
    assert.equal(p1AfterAttempt2.isPassed, true);
    assert.equal(p1AfterAttempt2.attempts.length, 2);
    assert.equal(p1AfterAttempt2.attempts[0].attemptNumber, 1);
    assert.equal(p1AfterAttempt2.attempts[0].score, 200);
    assert.equal(p1AfterAttempt2.attempts[0].isPassed, false);
    assert.equal(p1AfterAttempt2.attempts[1].attemptNumber, 2);
    assert.equal(p1AfterAttempt2.attempts[1].score, 400);
    assert.equal(p1AfterAttempt2.attempts[1].isPassed, true);

    // Case 27: Granting extra attempt while a participant is currently IN_PROGRESS does NOT break their active session
    const startP3Live = await apiFetch('/api/games/sessions', {
      method: 'POST',
      body: {
        gameId: examGameId,
        participantId: participant3Id,
        playerName: 'Đỗ Quốc Bảo',
      },
    });
    assert.equal(startP3Live.status, 200);
    const liveSessionP3 = startP3Live.json.data.sessionId as string;
    const liveLockP3 = startP3Live.json.data.lockToken as string;
    await apiFetch(`/api/games/sessions/${liveSessionP3}/start`, {
      method: 'POST',
      headers: { 'X-Participant-Token': liveLockP3 },
      body: {},
    });

    const grantLiveP3 = await apiFetch(
      `/api/games/${examGameId}/participants/${participant3Id}/grant-retake`,
      {
        method: 'POST',
        body: { additionalAttempts: 1, preserveActiveSession: true },
      }
    );
    assert.equal(grantLiveP3.status, 200);
    assert.equal(grantLiveP3.json.data.participant.allowedAttempts, 2);
    assert.equal(grantLiveP3.json.data.participant.activeSessionId, liveSessionP3);

    // P3 can still submit answers and finish their live session without error!
    for (const qId of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      const ansRes = await apiFetch(`/api/games/sessions/${liveSessionP3}/answer`, {
        method: 'POST',
        headers: { 'X-Participant-Token': liveLockP3 },
        body: { questionId: qId, answer: correctAnswersMap[qId] },
      });
      assert.equal(ansRes.status, 200);
      const nextRes = await apiFetch(`/api/games/sessions/${liveSessionP3}/next`, {
        method: 'POST',
        headers: { 'X-Participant-Token': liveLockP3 },
        body: {},
      });
      assert.equal(nextRes.status, 200);
    }
  });

  // =========================================================================
  // 12.5. Mở lại đợt thi (Cases 30 – 32)
  // =========================================================================
  it('Cases 30-32: Closing and reopening an exam batch preserves old history, does not auto-reset or auto-grant everyone, and allows eligible participants to take the exam via valid link/PIN', async () => {
    const closeRes = await apiFetch(`/api/games/${examGameId}/close-exam`, {
      method: 'POST',
      body: {},
    });
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.json.data.examStatus, 'CLOSED');

    const reopenRes = await apiFetch(`/api/games/${examGameId}/reopen-exam`, {
      method: 'POST',
      body: { createNewBatch: true },
    });
    assert.equal(reopenRes.status, 200);
    assert.equal(reopenRes.json.data.examStatus, 'OPEN');
    assert.ok(reopenRes.json.data.soloExamUrl.includes(`/?play=${examGameId}`));

    const reportAfterReopen = await apiFetch(`/api/games/${examGameId}/reports`);
    assert.equal(reportAfterReopen.status, 200);
    const rReopen = reportAfterReopen.json.data;
    assert.ok(rReopen.examBatches.length >= 2);
    const p1Overall = rReopen.examOverallBatch.participants.find(
      (p: any) => p.participantId === participant1Id
    );
    assert.equal(p1Overall.usedAttempts, 2);
    assert.equal(p1Overall.allowedAttempts, 2);
    assert.equal(p1Overall.attempts.length, 2);

    // Participant 2 (who was granted 3 attempts earlier and used 1) can join and complete in Batch 2!
    const p2Batch2 = await runSoloAttempt({
      gameId: examGameId,
      participantId: participant2Id,
      playerName: 'Phạm Thu Hà',
      correctCount: 5,
    });
    assert.equal(p2Batch2.status, 200);

    const reportAfterBatch2 = await apiFetch(`/api/games/${examGameId}/reports`);
    assert.equal(reportAfterBatch2.status, 200);
    assert.equal(reportAfterBatch2.json.data.examBatches.length, 2);
    assert.equal(reportAfterBatch2.json.data.examBatches[0].batchName, 'Đợt 1');
    assert.equal(reportAfterBatch2.json.data.examBatches[1].batchName, 'Đợt 2');
    assert.equal(reportAfterBatch2.json.data.examBatches[1].completedCount, 1);
  });

  // =========================================================================
  // 12.6. Phân quyền (Cases 33 – 36)
  // =========================================================================
  it('Cases 33-36: Creator can view Reports & grant retakes; other Creator, Guest, and Player tokens are strictly rejected with 403', async () => {
    const regB = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: {
        email: `creator_b_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Creator B Khác Chủ Sở Hữu',
      },
    });
    assert.equal(regB.status, 201);
    creatorBToken = regB.json.data.token;

    const regA = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: {
        email: `creator_a_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: 'Creator A Chủ Sở Hữu',
      },
    });
    assert.equal(regA.status, 201);
    const creatorAToken = regA.json.data.token;
    const creatorAId = regA.json.data.user.userId;

    // Update ownerUserId in both SQLite and in-memory gameStore
    const existingSpec = gameStore.get(examGameId);
    if (existingSpec) {
      gameStore.save(existingSpec, Date.now() - 10000, creatorAId, true);
    }
    getDatabase().prepare(`UPDATE games SET owner_user_id = ? WHERE game_id = ?`).run(
      creatorAId,
      examGameId
    );

    const creatorAReport = await apiFetch(`/api/games/${examGameId}/reports`, {
      headers: { Authorization: `Bearer ${creatorAToken}` },
    });
    assert.equal(creatorAReport.status, 200);

    const creatorBReport = await apiFetch(`/api/games/${examGameId}/reports`, {
      headers: { Authorization: `Bearer ${creatorBToken}` },
    });
    assert.equal(creatorBReport.status, 403);

    const creatorBGrant = await apiFetch(
      `/api/games/${examGameId}/participants/${participant1Id}/grant-retake`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${creatorBToken}` },
        body: { additionalAttempts: 1 },
      }
    );
    assert.equal(creatorBGrant.status, 403);

    const creatorBReopen = await apiFetch(`/api/games/${examGameId}/reopen-exam`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creatorBToken}` },
      body: {},
    });
    assert.equal(creatorBReopen.status, 403);

    const guestOverview = await apiFetch('/api/games/reports/overview', {
      headers: { 'X-Guest-Token': 'gt_0123456789abcdef0123456789abcdef' },
    });
    assert.equal(guestOverview.status, 403);

    const playerDetail = await apiFetch(`/api/games/${examGameId}/reports`, {
      headers: { 'X-Player-Token': 'player_tok_123' },
    });
    assert.equal(playerDetail.status, 403);

    const guestGrant = await apiFetch(
      `/api/games/${examGameId}/participants/${participant1Id}/grant-retake`,
      {
        method: 'POST',
        headers: { 'X-Guest-Token': 'gt_0123456789abcdef0123456789abcdef' },
        body: { additionalAttempts: 1 },
      }
    );
    assert.equal(guestGrant.status, 403);

    const playerReopen = await apiFetch(`/api/games/${examGameId}/reopen-exam`, {
      method: 'POST',
      headers: { 'X-Player-Token': 'player_tok_123' },
      body: {},
    });
    assert.equal(playerReopen.status, 403);

    if (existingSpec) {
      gameStore.save(existingSpec, Date.now() - 10000, null, true);
    }
    getDatabase().prepare(`UPDATE games SET owner_user_id = NULL WHERE game_id = ?`).run(
      examGameId
    );
  });

  // =========================================================================
  // 13. KIỂM THỬ TRÌNH DUYỆT THẬT (CHROMIUM E2E, 5 VIEWPORTS, LIGHT/DARK, 8 SCREENSHOTS)
  // =========================================================================
  it('Section 13: Real Chromium E2E journey across 5 viewports and Light/Dark themes with 0 console/page/5xx errors and 8 visual proof screenshots', async () => {
    browser = await Browser.launch(1440, 900);
    const page = await browser.newPage(1440, 900);

    await page.goto(`${baseUrl}/?tab=reports`);

    await page.waitForSelector('[data-testid="reports-v2-game-hub"]');
    await page.waitForSelector('[data-testid="reports-games-table"]');

    // 1. Screenshot: v3_reports_overview_latest_activity_1440x900.png
    await page.scrollToSelector('[data-testid="reports-v2-game-hub"]');
    await page.screenshot(
      path.join(ARTIFACT_DIR, 'v3_reports_overview_latest_activity_1440x900.png')
    );

    // Click Xem chi tiết on PLAY game (playGameOldId)
    await page.clickSelector(`[data-testid="reports-game-detail-btn-${playGameOldId}"]`);
    await page.waitForSelector('[data-testid="reports-play-detail-view"]');
    await page.waitForSelector('[data-testid="reports-play-leaderboard-table"]');

    // 2. Screenshot: v3_reports_play_leaderboard_1440x900.png
    await page.scrollToSelector('[data-testid="reports-play-leaderboard"]');
    await page.screenshot(path.join(ARTIFACT_DIR, 'v3_reports_play_leaderboard_1440x900.png'));

    // 3. Screenshot: v3_reports_play_attempt_history_1440x900.png
    await page.scrollToSelector('[data-testid="reports-play-attempts-history"]');
    await page.screenshot(path.join(ARTIFACT_DIR, 'v3_reports_play_attempt_history_1440x900.png'));

    // Click Xem chi tiết on EXAM game (examGameId)
    await page.clickSelector(`[data-testid="reports-game-detail-btn-${examGameId}"]`);
    await page.waitForSelector('[data-testid="reports-exam-detail-view"]');
    await page.waitForSelector('[data-testid="reports-exam-batches-list"]');

    // 4. Screenshot: v3_reports_exam_batches_1440x900.png
    await page.scrollToSelector('[data-testid="reports-exam-batches-list"]');
    await page.screenshot(path.join(ARTIFACT_DIR, 'v3_reports_exam_batches_1440x900.png'));

    // Select ALL batches to show full participant results
    const hasAllBatchBtn = await page.eval<boolean>(
      `Boolean(document.querySelector('[data-testid="select-exam-batch-ALL"]'))`
    );
    if (hasAllBatchBtn) {
      await page.clickSelector('[data-testid="select-exam-batch-ALL"]');
    }

    // 5. Screenshot: v3_reports_exam_batch_detail_1440x900.png
    await page.scrollToSelector('[data-testid="reports-exam-batch-detail"]');
    await page.screenshot(path.join(ARTIFACT_DIR, 'v3_reports_exam_batch_detail_1440x900.png'));

    // Open Grant Retake modal for Participant 1
    await page.clickSelector(`[data-testid="grant-retake-btn-${participant1Id}"]`);
    await page.waitForSelector('[data-testid="grant-retake-modal"]');

    // 6. Screenshot: v3_reports_grant_retake_modal_1440x900.png
    await sleep(250);
    await page.screenshot(path.join(ARTIFACT_DIR, 'v3_reports_grant_retake_modal_1440x900.png'));

    // Confirm granting +1 attempt in UI
    await page.clickSelector('[data-testid="confirm-grant-retake-btn"]');
    await page.waitForSelector('[data-testid="reports-action-notice"]');

    // Open Participant 1 multi-attempt history modal (Lần 1, Lần 2)
    await page.clickSelector(`[data-testid="view-participant-attempts-btn-${participant1Id}"]`);
    await page.waitForSelector('[data-testid="participant-attempts-modal"]');

    // 7. Screenshot: v3_reports_after_retake_attempts_history_1440x900.png
    await sleep(250);
    await page.screenshot(
      path.join(ARTIFACT_DIR, 'v3_reports_after_retake_attempts_history_1440x900.png')
    );

    // Close modal
    await page.clickSelector('[data-testid="close-participant-attempts-modal"]');

    // Check Light & Dark themes + all 5 mandatory viewports (1440x900, 1366x768, 768x1024, 390x844, 360x800)
    const viewports = [
      { width: 1440, height: 900, mobile: false },
      { width: 1366, height: 768, mobile: false },
      { width: 768, height: 1024, mobile: true },
      { width: 390, height: 844, mobile: true },
      { width: 360, height: 800, mobile: true },
    ];

    for (const theme of ['dark', 'light'] as const) {
      await page.eval(`document.documentElement.setAttribute('data-theme', '${theme}')`);

      for (const vp of viewports) {
        await page.setViewport(vp.width, vp.height, vp.mobile);
        await sleep(200);

        const overflowCheck = await page.eval<{
          scrollWidth: number;
          innerWidth: number;
          overflowPx: number;
        }>(`(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            innerWidth: window.innerWidth,
            overflowPx: doc.scrollWidth - window.innerWidth,
          };
        })()`);

        assert.ok(
          overflowCheck.overflowPx <= 1,
          `Horizontal overflow detected at ${vp.width}x${vp.height} (${theme}): scrollWidth=${overflowCheck.scrollWidth}, innerWidth=${overflowCheck.innerWidth}`
        );

        if (theme === 'dark' && vp.width === 390 && vp.height === 844) {
          // 8. Screenshot: v3_reports_mobile_390x844.png
          await page.screenshot(path.join(ARTIFACT_DIR, 'v3_reports_mobile_390x844.png'));
        }
      }
    }

    assert.deepEqual(
      page.consoleErrors,
      [],
      `Unexpected console.error: ${page.consoleErrors.join('; ')}`
    );
    assert.deepEqual(page.pageErrors, [], `Unexpected pageerror: ${page.pageErrors.join('; ')}`);
    assert.deepEqual(
      page.server5xxErrors,
      [],
      `Unexpected 5xx responses: ${page.server5xxErrors.join('; ')}`
    );

    await page.close();
  });
});
