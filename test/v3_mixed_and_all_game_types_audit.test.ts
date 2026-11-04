import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/storage/sqlite.db.js';
import { sourceStore } from '../src/storage/source.store.js';
import { aiQuestionService, AiModelProvider, calculateMixedTypeCounts } from '../src/services/ai.question.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { CanonicalDocument } from '../src/contracts/source.contract.js';
import { CreatableGameTypeEnum } from '../src/contracts/game.contract.js';
import { INDUSTRY_CATALOG } from '../src/contracts/adventure.contract.js';
import { AppError } from '../src/utils/errors.js';

class AuditMockAiProvider implements AiModelProvider {
  public lastPrompt = '';
  public callCount = 0;
  public mode: 'AUTO' | 'MALFORMED' | 'SHORTFALL' | 'RATE_LIMIT_429' | 'CUSTOM' = 'AUTO';
  public customResponses: any[] = [];

  async generateJson(prompt: string, _systemInstruction: string): Promise<any> {
    this.lastPrompt = prompt;
    this.callCount += 1;

    if (this.mode === 'RATE_LIMIT_429') {
      throw new AppError(
        'AI_RATE_LIMIT',
        '429 Too Many Requests: Resource has been exhausted (e.g. check quota).',
        429
      );
    }

    if (this.mode === 'MALFORMED') {
      return { broken: 'not_an_array_of_questions' };
    }

    if (this.mode === 'CUSTOM') {
      const next = this.customResponses.shift() ?? [];
      return next;
    }

    // Topic generation prompt check
    if (prompt.includes('Generate a comprehensive, factual Vietnamese reference document')) {
      return {
        title: 'Tài liệu tham khảo An toàn thông tin',
        sections: [
          {
            heading: 'Quy chuẩn bảo mật',
            content: 'Xác thực hai lớp MFA, giao thức TLS 1.3, hệ thống tường lửa FIREWALL bảo vệ mạng nội bộ.',
          },
        ],
      };
    }

    const isAdventure = prompt.includes('CRITICAL RULES FOR ADVENTURE GAME MODE');
    const isMixed = prompt.includes('CRITICAL RULES FOR MIXED GAME MODE');
    const countMatch = prompt.match(/REQUEST:\s*Generate\s+(\d+)\s+questions\s+of\s+type\s+"([A-Z_]+)"/);
    const totalCount = countMatch ? Number(countMatch[1]) : 5;
    const requestedType = countMatch ? countMatch[2] : 'MULTIPLE_CHOICE';

    const makeMC = (idx: number) => ({
      id: `q_mc_${this.callCount}_${idx}`,
      type: 'MULTIPLE_CHOICE',
      question: `Câu hỏi trắc nghiệm kiểm thử số ${this.callCount}_${idx}: Quy định an toàn nào bắt buộc áp dụng?`,
      choices: [
        `A. Phương án chuẩn xác số ${idx}`,
        `B. Phương án nhiễu B số ${idx}`,
        `C. Phương án nhiễu C số ${idx}`,
        `D. Phương án nhiễu D số ${idx}`,
      ],
      correctAnswer: `A. Phương án chuẩn xác số ${idx}`,
      explanation: `Giải thích chi tiết cho câu trắc nghiệm số ${idx}.`,
      difficulty: 'MEDIUM',
    });

    const makeQB = (idx: number) => ({
      id: `q_qb_${this.callCount}_${idx}`,
      type: 'QUICK_BUTTON',
      question: `Nhận định Đúng/Sai kiểm thử số ${this.callCount}_${idx}: Mọi nhân sự đều phải xác thực hai lớp?`,
      choices: ['Đúng', 'Sai'],
      correctAnswer: idx % 2 === 0 ? 'Đúng' : 'Sai',
      explanation: `Giải thích chi tiết cho nhận định số ${idx}.`,
      difficulty: 'EASY',
    });

    const makeFIB = (idx: number) => ({
      id: `q_fib_${this.callCount}_${idx}`,
      type: 'FILL_IN_THE_BLANK',
      question: `Điền thuật ngữ viết tắt số ${this.callCount}_${idx}: Giao thức bảo mật tầng giao vận là ___?`,
      correctAnswer: `TLS${idx}`,
      acceptedAlternatives: [`SSL${idx}`],
      explanation: `Giải thích chi tiết cho câu điền từ số ${idx}.`,
      difficulty: 'MEDIUM',
    });

    const makeCW = (idx: number) => ({
      id: `q_cw_${this.callCount}_${idx}`,
      type: 'CROSSWORD',
      question: `Từ khóa ô chữ số ${this.callCount}_${idx}: Hệ thống tường lửa bảo vệ mạng nội bộ?`,
      crosswordClue: `Từ khóa ô chữ số ${this.callCount}_${idx}: Hệ thống tường lửa bảo vệ mạng nội bộ?`,
      crosswordAnswer: `FIREWALL${idx}`,
      correctAnswer: `FIREWALL${idx}`,
      explanation: `Giải thích từ khóa ô chữ số ${idx}.`,
      difficulty: 'MEDIUM',
    });

    const makePZ = (idx: number) => ({
      id: `q_pz_${this.callCount}_${idx}`,
      type: 'PUZZLE',
      question: `Sắp xếp quy trình xử lý sự cố số ${this.callCount}_${idx} theo đúng thứ tự:`,
      choices: [`Bước 1 (${idx})`, `Bước 2 (${idx})`, `Bước 3 (${idx})`, `Bước 4 (${idx})`],
      correctAnswer: `Bước 1 (${idx}) | Bước 2 (${idx}) | Bước 3 (${idx}) | Bước 4 (${idx})`,
      explanation: `Giải thích trình tự các bước số ${idx}.`,
      difficulty: 'MEDIUM',
    });

    const makeSL = (idx: number) => ({
      id: `q_sl_${this.callCount}_${idx}`,
      type: 'SLIDER',
      question: `Chỉ số định lượng kiểm thử số ${this.callCount}_${idx}: Tỷ lệ đạt chuẩn tối thiểu là bao nhiêu %?`,
      sliderConfig: {
        min: 0,
        max: 100,
        step: 5,
        correctValue: 80,
        tolerance: 5,
        unit: '%',
      },
      correctAnswer: '80',
      explanation: `Giải thích thông số định lượng số ${idx}.`,
      difficulty: 'MEDIUM',
    });

    if (isMixed || isAdventure) {
      const questions: any[] = [];
      const parseLineCount = (typeKey: string): number => {
        const rx = new RegExp(`\\+\\s*${typeKey}\\b[^:\\n]*:\\s*(\\d+)\\s*câu`);
        const m = prompt.match(rx);
        return m ? Number(m[1]) : 0;
      };

      const mcCount = parseLineCount('MULTIPLE_CHOICE') + parseLineCount('QUIZ');
      const qbCount = parseLineCount('QUICK_BUTTON') + parseLineCount('TRUE_FALSE');
      const fibCount = parseLineCount('FILL_IN_THE_BLANK') + parseLineCount('TYPE_ANSWER');
      const cwCount = parseLineCount('CROSSWORD');
      const pzCount = parseLineCount('PUZZLE');
      const slCount = parseLineCount('SLIDER');

      let seq = 1;
      for (let i = 0; i < mcCount; i++) questions.push(makeMC(seq++));
      for (let i = 0; i < qbCount; i++) questions.push(makeQB(seq++));
      for (let i = 0; i < fibCount; i++) questions.push(makeFIB(seq++));
      for (let i = 0; i < cwCount; i++) questions.push(makeCW(seq++));
      for (let i = 0; i < pzCount; i++) questions.push(makePZ(seq++));
      for (let i = 0; i < slCount; i++) questions.push(makeSL(seq++));

      if (this.mode === 'SHORTFALL' && questions.length > 2) {
        questions.pop();
      }

      if (isAdventure) {
        return {
          adventureProposal: {
            industryId: 'IT_TECHNOLOGY',
            themePresetId: 'theme_it_cyberlab',
            gameplayArchetype: 'CYBER_DEFENSE_CONSOLE_SIM',
            environmentTitle: 'Trung tâm điều hành SOC',
            environmentSubtitle: 'Phòng thủ hạ tầng đám mây doanh nghiệp',
            learningObjective: 'Nắm vững quy trình bảo mật và xử lý sự cố mạng',
            winConditionSummary: 'Vượt qua tất cả các chướng ngại vật bảo mật',
            interactiveObjects: ['Tường lửa', 'Cổng xác thực', 'Máy chủ dữ liệu'],
            aiReasoning: 'Nội dung phù hợp với mô phỏng phòng thủ mạng',
          },
          questions,
        };
      }

      return questions;
    }

    const singleQuestions: any[] = [];
    for (let i = 1; i <= totalCount; i++) {
      if (requestedType === 'MULTIPLE_CHOICE' || requestedType === 'QUIZ') {
        const q = makeMC(i);
        q.type = requestedType;
        singleQuestions.push(q);
      } else if (requestedType === 'QUICK_BUTTON' || requestedType === 'TRUE_FALSE') {
        const q = makeQB(i);
        q.type = requestedType;
        singleQuestions.push(q);
      } else if (requestedType === 'FILL_IN_THE_BLANK' || requestedType === 'TYPE_ANSWER') {
        const q = makeFIB(i);
        q.type = requestedType;
        singleQuestions.push(q);
      } else if (requestedType === 'CROSSWORD') {
        singleQuestions.push(makeCW(i));
      } else if (requestedType === 'PUZZLE') {
        singleQuestions.push(makePZ(i));
      } else if (requestedType === 'SLIDER') {
        singleQuestions.push(makeSL(i));
      }
    }
    return singleQuestions;
  }
}

describe('V3 Audit: MIXED Game Creation & All Supported Game Types (End-to-End Matrix)', () => {
  let tempDir: string;
  let tempDbPath: string;
  const mockProvider = new AuditMockAiProvider();

  const registerSource = (id: string, sourceType: CanonicalDocument['sourceType'], location: string) => {
    const contentText = [
      'Tài liệu đào tạo quy chuẩn an toàn thông tin, vận hành kỹ thuật và dịch vụ khách hàng.',
      'Quy định bảo mật yêu cầu xác thực đa yếu tố (MFA), mã hóa TLS, hệ thống tường lửa FIREWALL.',
      'Quy trình chuẩn gồm 4 bước: Bước 1 Tiếp nhận | Bước 2 Phân tích | Bước 3 Xử lý | Bước 4 Nghiệm thu.',
      'Tỷ lệ tuân thủ SLA tối thiểu đạt 80% trên toàn hệ thống.',
    ].join('\n');
    const doc: CanonicalDocument = {
      sourceId: id,
      sourceType,
      sourceName: location,
      sourceLocation: location,
      title: `Tài liệu nguồn ${id}`,
      text: contentText,
      sections: [
        {
          title: 'Quy chuẩn vận hành',
          content: contentText,
          provenance: {
            sourceId: id,
            sourceType,
            sourceLocation: location,
          },
        },
      ],
      extractedItems: [],
      metadata: {
        originalSize: contentText.length,
        characterCount: contentText.length,
        extractedAt: new Date().toISOString(),
      },
      diagnostics: [],
    };
    sourceStore.save(doc);
    return id;
  };

  let topicSourceId = '';
  let websiteSourceId = '';
  let pdfSourceId = '';
  let docxSourceId = '';
  let txtSourceId = '';

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-v3-mixed-audit-'));
    tempDbPath = path.join(tempDir, 'test_v3_mixed_audit.sqlite');
    initDatabase(tempDbPath);

    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();

    topicSourceId = registerSource('src_audit_topic', 'TXT', 'topic:An toàn thông tin doanh nghiệp');
    websiteSourceId = registerSource('src_audit_website', 'WEBSITE', 'https://example.com/training');
    pdfSourceId = registerSource('src_audit_pdf', 'PDF', 'training-guide.pdf');
    docxSourceId = registerSource('src_audit_docx', 'DOCX', 'process-manual.docx');
    txtSourceId = registerSource('src_audit_txt', 'TXT', 'quick-notes.txt');
  });

  after(() => {
    resetAllRateLimiters();
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on Windows
    }
  });

  beforeEach(() => {
    resetAllRateLimiters();
    mockProvider.mode = 'AUTO';
    mockProvider.customResponses = [];
    mockProvider.callCount = 0;
  });

  it('Verify CreatableGameTypeEnum includes all 8 UI game types + 3 canonical aliases', () => {
    const expectedTypes = [
      'MULTIPLE_CHOICE',
      'QUICK_BUTTON',
      'FILL_IN_THE_BLANK',
      'CROSSWORD',
      'PUZZLE',
      'SLIDER',
      'MIXED',
      'ADVENTURE',
      'QUIZ',
      'TRUE_FALSE',
      'TYPE_ANSWER',
    ];
    for (const gt of expectedTypes) {
      assert.ok(
        CreatableGameTypeEnum.options.includes(gt as any),
        `CreatableGameTypeEnum must include ${gt}`
      );
    }
  });

  it('MIXED-01, MIXED-02, MIXED-03: Create MIXED game with 5, 10, and 20 questions from Topic', async () => {
    for (const qCount of [5, 10, 20]) {
      resetAllRateLimiters();
      const expectedDist = calculateMixedTypeCounts(qCount);

      const res = await request(app).post('/api/games/generate').send({
        sourceId: topicSourceId,
        gameType: 'MIXED',
        questionCount: qCount,
        difficulty: 'MEDIUM',
        title: `Game MIXED ${qCount} câu`,
      });

      assert.equal(res.status, 200, `MIXED ${qCount} questions failed with status ${res.status}`);
      assert.equal(res.body.success, true);
      const game = res.body.data;
      assert.equal(game.gameType, 'MIXED');
      assert.equal(game.questions.length, qCount);

      const actualCounts: Record<string, number> = {
        MULTIPLE_CHOICE: 0,
        QUICK_BUTTON: 0,
        FILL_IN_THE_BLANK: 0,
        CROSSWORD: 0,
      };
      for (const q of game.questions) {
        assert.notEqual(q.type, 'MIXED', 'Individual question type must not be MIXED');
        actualCounts[q.type] = (actualCounts[q.type] || 0) + 1;
      }
      assert.deepEqual(actualCounts, expectedDist);
    }
  });

  it('MIXED-04: Create MIXED game with custom percentage ratio (60% MC, 40% QB, 0% FIB, 0% CW)', async () => {
    const customDist = {
      MULTIPLE_CHOICE: 60,
      QUICK_BUTTON: 40,
      FILL_IN_THE_BLANK: 0,
      CROSSWORD: 0,
    };
    const res = await request(app).post('/api/games/generate').send({
      sourceId: topicSourceId,
      gameType: 'MIXED',
      questionCount: 10,
      mixedDistribution: customDist,
      difficulty: 'MEDIUM',
    });

    assert.equal(res.status, 200);
    const game = res.body.data;
    assert.equal(game.questions.length, 10);
    assert.deepEqual(game.settings?.mixedDistribution, customDist);

    const mcQuestions = game.questions.filter((q: any) => q.type === 'MULTIPLE_CHOICE');
    const qbQuestions = game.questions.filter((q: any) => q.type === 'QUICK_BUTTON');
    const fibQuestions = game.questions.filter((q: any) => q.type === 'FILL_IN_THE_BLANK');
    const cwQuestions = game.questions.filter((q: any) => q.type === 'CROSSWORD');

    assert.equal(mcQuestions.length, 6);
    assert.equal(qbQuestions.length, 4);
    assert.equal(fibQuestions.length, 0);
    assert.equal(cwQuestions.length, 0);
  });

  it('MIXED-05 & MIXED-06: Create MIXED game from URL (WEBSITE) and File uploads (PDF, DOCX, TXT)', async () => {
    for (const [label, srcId] of [
      ['URL (WEBSITE)', websiteSourceId],
      ['File PDF', pdfSourceId],
      ['File DOCX', docxSourceId],
      ['File TXT', txtSourceId],
    ] as const) {
      resetAllRateLimiters();
      const res = await request(app).post('/api/games/generate').send({
        sourceId: srcId,
        gameType: 'MIXED',
        questionCount: 5,
        difficulty: 'EASY',
        title: `MIXED from ${label}`,
      });
      assert.equal(res.status, 200, `Failed to create MIXED from ${label}`);
      assert.equal(res.body.data.gameType, 'MIXED');
      assert.equal(res.body.data.questions.length, 5);
    }
  });

  it('MIXED-07, MIXED-08, MIXED-09: Save MIXED game to Library, Re-open, and Play Solo through all question types', async () => {
    const createRes = await request(app).post('/api/games/generate').send({
      sourceId: topicSourceId,
      gameType: 'MIXED',
      questionCount: 5,
      difficulty: 'MEDIUM',
      title: 'Game MIXED Thực Chiến',
    });
    assert.equal(createRes.status, 200);
    const createdGame = createRes.body.data;
    const gameId = createdGame.gameId;

    // MIXED-07: Save to Library via PATCH /api/games/:id/questions
    const saveRes = await request(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: 'Game MIXED Đã Lưu Thư Viện',
        description: 'Mô tả game hỗn hợp đã lưu',
        questions: createdGame.questions,
        settings: {
          ...createdGame.settings,
          timePerQuestion: 25,
        },
        isPublic: true,
      });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.data.title, 'Game MIXED Đã Lưu Thư Viện');
    assert.equal(saveRes.body.data.isPublic, true);

    // MIXED-08: Re-open from Library via GET /api/games/:id
    const getRes = await request(app).get(`/api/games/${gameId}`);
    assert.equal(getRes.status, 200);
    const reopenedGame = getRes.body.data;
    assert.equal(reopenedGame.gameType, 'MIXED');
    assert.equal(reopenedGame.questions.length, 5);

    // MIXED-09: Play Solo from question 1 to finish
    const sessionRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId });
    assert.equal(sessionRes.status, 200);
    const sessionId = sessionRes.body.data.sessionId;
    await request(app).post(`/api/games/sessions/${sessionId}/start`);

    for (const q of reopenedGame.questions) {
      const ansRes = await request(app)
        .post(`/api/games/sessions/${sessionId}/answer`)
        .send({
          questionId: q.id,
          answer: q.correctAnswer,
        });
      assert.equal(ansRes.status, 200, `Solo answer failed for question type ${q.type}`);
      assert.equal(ansRes.body.data.isCorrect, true, `Expected correct evaluation for ${q.type}`);
      await request(app).post(`/api/games/sessions/${sessionId}/next`);
    }

    const summaryRes = await request(app).get(`/api/games/sessions/${sessionId}/result`);
    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.body.data.correctCount, 5);
  });

  it('MIXED-10: Cleanly handles AI malformed JSON, shortfall recovery without duplicating, and 429 rate-limit error', async () => {
    // 1. Malformed JSON -> 422 AI_VALIDATION_ERROR
    mockProvider.mode = 'MALFORMED';
    const malformedRes = await request(app).post('/api/games/generate').send({
      sourceId: topicSourceId,
      gameType: 'MIXED',
      questionCount: 5,
    });
    assert.equal(malformedRes.status, 422);
    assert.equal(malformedRes.body.error.code, 'AI_VALIDATION_ERROR');

    // 2. 429 rate limit -> 429 AI_RATE_LIMIT
    resetAllRateLimiters();
    mockProvider.mode = 'RATE_LIMIT_429';
    const rateLimitRes = await request(app).post('/api/games/generate').send({
      sourceId: topicSourceId,
      gameType: 'MIXED',
      questionCount: 5,
    });
    assert.equal(rateLimitRes.status, 429);
    assert.equal(rateLimitRes.body.error.code, 'AI_RATE_LIMIT');

    // 3. Shortfall recovery via supplemental call + answer normalization
    resetAllRateLimiters();
    mockProvider.mode = 'CUSTOM';
    mockProvider.customResponses = [
      // Initial batch missing 1 CROSSWORD question (4 of 5) and having MC answer as "A" + CW answer with hyphen
      [
        {
          id: 'q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu MC 1: Giao thức nào dùng cổng 443?',
          choices: ['A. HTTPS', 'B. HTTP', 'C. FTP', 'D. Telnet'],
          correctAnswer: 'A',
        },
        {
          id: 'q2',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu MC 2: Phương thức xác thực mạnh nhất là gì?',
          choices: ['A. MFA', 'B. PIN', 'C. SMS', 'D. Không mật khẩu'],
          correctAnswer: 'MFA',
        },
        {
          id: 'q3',
          type: 'QUICK_BUTTON',
          question: 'Câu QB 1: Mật khẩu cần tối thiểu 8 ký tự?',
          choices: ['A. Đúng', 'B. Sai'],
          correctAnswer: 'A. Đúng.',
        },
        {
          id: 'q4',
          type: 'FILL_IN_THE_BLANK',
          question: 'Câu FIB 1: Tường lửa tiếng Anh là ___?',
          correctAnswer: 'Firewall',
        },
      ],
      // Supplemental batch providing the missing CROSSWORD question
      [
        {
          id: 'q5',
          type: 'CROSSWORD',
          question: 'Câu CW 1: Mạng không dây cục bộ viết tắt là gì?',
          crosswordClue: 'Mạng không dây cục bộ viết tắt là gì?',
          crosswordAnswer: 'WI-FI',
          correctAnswer: 'WI-FI',
        },
      ],
    ];

    const recoveryRes = await request(app).post('/api/games/generate').send({
      sourceId: topicSourceId,
      gameType: 'MIXED',
      questionCount: 5,
    });
    assert.equal(recoveryRes.status, 200);
    const recoveredQuestions = recoveryRes.body.data.questions;
    assert.equal(recoveredQuestions.length, 5);
    assert.equal(recoveredQuestions[0].correctAnswer, 'A. HTTPS');
    assert.equal(recoveredQuestions[1].correctAnswer, 'A. MFA');
    assert.equal(recoveredQuestions[2].correctAnswer, 'Đúng');
    assert.equal(recoveredQuestions[4].correctAnswer, 'WIFI');
  });

  it('TYPE-01 to TYPE-08: End-to-End audit of all 8 game types (Generate -> Save -> Re-open -> Solo Play)', async () => {
    const gameTypeMatrix: Array<{
      code: string;
      gameType: string;
      extraPayload?: Record<string, any>;
    }> = [
      { code: 'TYPE-01', gameType: 'MULTIPLE_CHOICE' },
      { code: 'TYPE-02', gameType: 'QUICK_BUTTON' },
      { code: 'TYPE-03', gameType: 'FILL_IN_THE_BLANK' },
      { code: 'TYPE-04', gameType: 'CROSSWORD' },
      { code: 'TYPE-05', gameType: 'PUZZLE' },
      { code: 'TYPE-06', gameType: 'SLIDER' },
      { code: 'TYPE-07', gameType: 'MIXED' },
      ...INDUSTRY_CATALOG.slice(0, 3).map((ind, idx) => ({
        code: `TYPE-08-${idx + 1}`,
        gameType: 'ADVENTURE',
        extraPayload: {
          adventureConfig: {
            industryId: ind.industryId,
            themePresetId: ind.defaultThemePresetId,
            questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'CROSSWORD'],
          },
        },
      })),
    ];

    for (const entry of gameTypeMatrix) {
      resetAllRateLimiters();
      const genRes = await request(app)
        .post('/api/games/generate')
        .send({
          sourceId: topicSourceId,
          gameType: entry.gameType,
          questionCount: 4,
          difficulty: 'MEDIUM',
          title: `Audit ${entry.code} (${entry.gameType})`,
          ...(entry.extraPayload || {}),
        });

      assert.equal(
        genRes.status,
        200,
        `${entry.code} (${entry.gameType}) failed generation: ${JSON.stringify(genRes.body)}`
      );
      const spec = genRes.body.data;
      assert.equal(spec.questions.length, 4);

      // Save to Library
      const patchRes = await request(app)
        .patch(`/api/games/${spec.gameId}/questions`)
        .send({
          title: `${spec.title} - Saved`,
          questions: spec.questions,
          settings: spec.settings,
          isPublic: true,
        });
      assert.equal(patchRes.status, 200, `${entry.code} failed save to Library`);

      // Re-open from Library
      const openRes = await request(app).get(`/api/games/${spec.gameId}`);
      assert.equal(openRes.status, 200, `${entry.code} failed re-open from Library`);
      assert.equal(openRes.body.data.questions.length, 4);

      // Solo Play
      const sessionRes = await request(app)
        .post('/api/games/sessions')
        .send({ gameId: spec.gameId });
      assert.equal(sessionRes.status, 200, `${entry.code} failed session start`);
      const sessionId = sessionRes.body.data.sessionId;
      await request(app).post(`/api/games/sessions/${sessionId}/start`);

      for (const q of openRes.body.data.questions) {
        const ansRes = await request(app)
          .post(`/api/games/sessions/${sessionId}/answer`)
          .send({
            questionId: q.id,
            answer: q.correctAnswer,
          });
        assert.equal(ansRes.status, 200, `${entry.code} failed answer submission on ${q.type}`);
        assert.equal(
          ansRes.body.data.isCorrect,
          true,
          `${entry.code} expected correct answer for ${q.type} (submitted: ${q.correctAnswer})`
        );
        await request(app).post(`/api/games/sessions/${sessionId}/next`);
      }

      const resultRes = await request(app).get(`/api/games/sessions/${sessionId}/result`);
      assert.equal(resultRes.status, 200);
      assert.equal(resultRes.body.data.correctCount, 4);
    }
  });
});
