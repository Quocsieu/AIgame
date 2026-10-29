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
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { aiQuestionService, AiModelProvider } from '../src/services/ai.question.service.js';
import {
  GameQuestionSchema,
  SliderQuestionConfigSchema,
  formatCanonicalPuzzleAnswer,
} from '../src/contracts/game.contract.js';
import { getHandler } from '../src/game/handlers/index.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';

class RefactorMockAiProvider implements AiModelProvider {
  public mockQuestions: any[] = [];
  public mockTitle = 'Traditional Game Types Refactor Test';

  async generateJson(_prompt: string, _systemInstruction: string): Promise<any> {
    return {
      title: this.mockTitle,
      description: 'Generated for traditional game types refactor tests.',
      questions: this.mockQuestions,
    };
  }
}

describe('TRADITIONAL GAME TYPES REFACTOR — 5 Canonical Formats (Quiz, True/False, Type Answer, Puzzle, Slider)', () => {
  let tempDir: string;
  let tempDbPath: string;
  let mockProvider: RefactorMockAiProvider;
  const sourceId = 'src_refactor_1';

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-refactor-test-'));
    tempDbPath = path.join(tempDir, 'test_refactor.sqlite');
    initDatabase(tempDbPath);

    mockProvider = new RefactorMockAiProvider();
    aiQuestionService.setProvider(mockProvider);
    resetAllRateLimiters();

    sourceStore.save({
      sourceId,
      sourceType: 'TXT',
      sourceName: 'refactor_doc.txt',
      sourceLocation: 'refactor_doc.txt',
      title: 'Tài liệu Kỹ thuật Mạng & Hệ điều hành',
      sections: [
        {
          title: 'Mô hình TCP/IP',
          content:
            'Quy trình bắt tay 3 bước TCP gồm SYN, SYN-ACK và ACK. Giao thức HTTPS bảo mật bằng TLS trên cổng 443. Hệ thống tên miền viết tắt là DNS.',
          provenance: {
            sourceId,
            sourceType: 'TXT',
            sourceLocation: 'refactor_doc.txt',
          },
        },
      ],
      text: 'Quy trình bắt tay 3 bước TCP gồm SYN, SYN-ACK và ACK. Giao thức HTTPS bảo mật bằng TLS trên cổng 443. Hệ thống tên miền viết tắt là DNS.',
      extractedItems: [],
      metadata: {
        originalSize: 200,
        characterCount: 150,
        extractedAt: new Date().toISOString(),
      },
      diagnostics: [],
    });
  });

  after(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows temp file lock
    }
  });

  it('1 & 2. Quiz (QUIZ / MULTIPLE_CHOICE): creates valid Quiz game and rejects missing/duplicate choices or mismatched correctAnswer', async () => {
    resetAllRateLimiters();

    mockProvider.mockQuestions = [
      {
        id: 'q_quiz_1',
        type: 'QUIZ',
        question: 'Cổng mặc định của giao thức HTTPS là bao nhiêu?',
        choices: ['443', '80', '21', '25'],
        correctAnswer: '443',
        explanation: 'HTTPS hoạt động trên cổng 443.',
        difficulty: 'EASY',
      },
    ];

    const res = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'QUIZ',
      questionCount: 1,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.gameType, 'QUIZ');
    assert.equal(res.body.data.questions[0].type, 'QUIZ');
    assert.deepEqual(res.body.data.questions[0].choices, ['443', '80', '21', '25']);

    // Schema rejects < 4 choices
    const missingChoices = GameQuestionSchema.safeParse({
      id: 'q_bad_1',
      type: 'QUIZ',
      question: 'Câu hỏi thiếu lựa chọn?',
      choices: ['A', 'B'],
      correctAnswer: 'A',
      difficulty: 'EASY',
    });
    assert.equal(missingChoices.success, false);

    // Schema rejects duplicate choices
    const dupChoices = GameQuestionSchema.safeParse({
      id: 'q_bad_2',
      type: 'QUIZ',
      question: 'Câu hỏi bị trùng lựa chọn?',
      choices: ['443', '443', '80', '22'],
      correctAnswer: '443',
      difficulty: 'EASY',
    });
    assert.equal(dupChoices.success, false);

    // Schema rejects correctAnswer not in choices
    const mismatchAnswer = GameQuestionSchema.safeParse({
      id: 'q_bad_3',
      type: 'QUIZ',
      question: 'Câu hỏi có đáp án ngoài choices?',
      choices: ['443', '80', '21', '25'],
      correctAnswer: '8443',
      difficulty: 'EASY',
    });
    assert.equal(mismatchAnswer.success, false);
  });

  it('3 & 4. True/False (TRUE_FALSE / QUICK_BUTTON): creates valid True/False game, grades binary polarity, and rejects non-binary choices/answers', async () => {
    resetAllRateLimiters();

    mockProvider.mockQuestions = [
      {
        id: 'q_tf_1',
        type: 'TRUE_FALSE',
        question: 'Giao thức HTTPS sử dụng TLS để mã hóa dữ liệu truyền tải.',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'HTTPS là HTTP over TLS.',
        difficulty: 'EASY',
      },
    ];

    const res = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'TRUE_FALSE',
      questionCount: 1,
    });

    assert.equal(res.status, 200);
    const q = res.body.data.questions[0];
    assert.equal(q.type, 'TRUE_FALSE');
    assert.deepEqual(q.choices, ['Đúng', 'Sai']);
    assert.equal(q.correctAnswer, 'Đúng');

    // Handler accepts both Vietnamese "Đúng" and English "True" for TRUE polarity
    const tfHandler = getHandler('TRUE_FALSE');
    assert.equal(tfHandler.validateAnswer(q, 'Đúng').isCorrect, true);
    assert.equal(tfHandler.validateAnswer(q, 'true').isCorrect, true);
    assert.equal(tfHandler.validateAnswer(q, 'Sai').isCorrect, false);
    assert.equal(tfHandler.validateAnswer(q, 'Maybe').isCorrect, false);

    // Schema rejects True/False with non-binary choices or answer outside True/False
    const invalidTfChoices = GameQuestionSchema.safeParse({
      id: 'q_tf_bad_1',
      type: 'TRUE_FALSE',
      question: 'Câu hỏi sai định dạng True/False?',
      choices: ['Phương án A', 'Phương án B'],
      correctAnswer: 'Phương án A',
      difficulty: 'EASY',
    });
    assert.equal(invalidTfChoices.success, false);

    const invalidTfAnswer = GameQuestionSchema.safeParse({
      id: 'q_tf_bad_2',
      type: 'TRUE_FALSE',
      question: 'Câu hỏi có đáp án ngoài True/False?',
      choices: ['Đúng', 'Sai'],
      correctAnswer: 'Có thể',
      difficulty: 'EASY',
    });
    assert.equal(invalidTfAnswer.success, false);
  });

  it('5. Type Answer (TYPE_ANSWER / FILL_IN_THE_BLANK): creates valid Type Answer game without choices and grades normalized + acceptedAlternatives', async () => {
    resetAllRateLimiters();

    mockProvider.mockQuestions = [
      {
        id: 'q_ta_1',
        type: 'TYPE_ANSWER',
        question: 'Hệ thống phân giải tên miền sang địa chỉ IP viết tắt là gì?',
        choices: ['Sẽ bị loại bỏ tự động'], // AI service strips choices for TYPE_ANSWER
        correctAnswer: 'DNS',
        acceptedAlternatives: ['Domain Name System'],
        explanation: 'DNS là Domain Name System.',
        difficulty: 'MEDIUM',
      },
    ];

    const res = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'TYPE_ANSWER',
      questionCount: 1,
    });

    assert.equal(res.status, 200);
    const q = res.body.data.questions[0];
    assert.equal(q.type, 'TYPE_ANSWER');
    assert.equal(q.choices, undefined);
    assert.equal(q.correctAnswer, 'DNS');

    const taHandler = getHandler('TYPE_ANSWER');
    // Case-insensitive + whitespace trimming
    assert.equal(taHandler.validateAnswer(q, '  dns  ').isCorrect, true);
    // Accepted alternative
    assert.equal(taHandler.validateAnswer(q, 'domain name system').isCorrect, true);
    // Wrong answer
    assert.equal(taHandler.validateAnswer(q, 'DHCP').isCorrect, false);
    // Empty answer
    assert.equal(taHandler.validateAnswer(q, '   ').isCorrect, false);

    // Schema rejects TYPE_ANSWER if choices array is explicitly present
    const badTypeAnswer = GameQuestionSchema.safeParse({
      id: 'q_ta_bad',
      type: 'TYPE_ANSWER',
      question: 'Câu hỏi nhập đáp án nhưng lại truyền choices?',
      choices: ['DNS', 'DHCP'],
      correctAnswer: 'DNS',
      difficulty: 'EASY',
    });
    assert.equal(badTypeAnswer.success, false);
  });

  it('6 & 7. Puzzle (PUZZLE): creates valid Puzzle game, shuffles client choices to prevent order leak, and grades exact sequence vs wrong/partial/duplicate order', async () => {
    resetAllRateLimiters();

    const canonicalItems = ['Bước 1: Gửi gói SYN', 'Bước 2: Nhận gói SYN-ACK', 'Bước 3: Gửi gói ACK', 'Bước 4: Thiết lập kết nối'];
    mockProvider.mockQuestions = [
      {
        id: 'q_pz_1',
        type: 'PUZZLE',
        question: 'Sắp xếp quy trình bắt tay 3 bước TCP và thiết lập kết nối theo đúng thứ tự:',
        choices: canonicalItems,
        correctAnswer: formatCanonicalPuzzleAnswer(canonicalItems),
        explanation: 'TCP 3-way handshake gồm SYN -> SYN-ACK -> ACK -> Connected.',
        difficulty: 'MEDIUM',
      },
    ];

    const res = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'PUZZLE',
      questionCount: 1,
    });

    assert.equal(res.status, 200);
    const gameId = res.body.data.gameId;
    const q = res.body.data.questions[0];
    assert.equal(q.type, 'PUZZLE');
    assert.deepEqual(q.choices, canonicalItems);

    // Verify client session question shuffles choices so it does NOT leak the canonical answer order
    const createSessRes = await request(app).post('/api/games/sessions').send({ gameId });
    assert.equal(createSessRes.status, 200);
    const sessionId = createSessRes.body.data.sessionId;
    const startSessRes = await request(app).post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(startSessRes.status, 200);

    const clientChoices: string[] = startSessRes.body.data.question.choices;
    assert.equal(clientChoices.length, canonicalItems.length);
    assert.notDeepEqual(
      clientChoices,
      canonicalItems,
      'Client PUZZLE choices must be shuffled and not identical to canonical answer order'
    );

    const pzHandler = getHandler('PUZZLE');
    // Exact order matches -> correct
    assert.equal(
      pzHandler.validateAnswer(q, formatCanonicalPuzzleAnswer(canonicalItems)).isCorrect,
      true
    );
    // JSON array string format also supported
    assert.equal(
      pzHandler.validateAnswer(q, JSON.stringify(canonicalItems)).isCorrect,
      true
    );
    // Swapped 1 position -> wrong
    const swapped = [canonicalItems[0], canonicalItems[2], canonicalItems[1], canonicalItems[3]];
    assert.equal(
      pzHandler.validateAnswer(q, formatCanonicalPuzzleAnswer(swapped)).isCorrect,
      false
    );
    // Missing item -> wrong
    assert.equal(
      pzHandler.validateAnswer(q, formatCanonicalPuzzleAnswer(canonicalItems.slice(0, 3))).isCorrect,
      false
    );
    // Duplicate item -> wrong
    const duplicated = [canonicalItems[0], canonicalItems[0], canonicalItems[2], canonicalItems[3]];
    assert.equal(
      pzHandler.validateAnswer(q, formatCanonicalPuzzleAnswer(duplicated)).isCorrect,
      false
    );

    // Schema rejects Puzzle with < 3 items
    const tooFewPuzzle = GameQuestionSchema.safeParse({
      id: 'q_pz_bad_1',
      type: 'PUZZLE',
      question: 'Sắp xếp 2 mục?',
      choices: ['Mục 1', 'Mục 2'],
      correctAnswer: 'Mục 1 | Mục 2',
      difficulty: 'EASY',
    });
    assert.equal(tooFewPuzzle.success, false);
  });

  it('8. Slider (SLIDER): creates valid Slider game, sanitizes client sliderConfig, rejects invalid/missing sliderConfig without fabricating defaults, and grades boundary/middle/tolerance/duplicate submissions', async () => {
    resetAllRateLimiters();

    mockProvider.mockQuestions = [
      {
        id: 'q_sl_1',
        type: 'SLIDER',
        question: 'Cổng mặc định của giao thức HTTPS là bao nhiêu?',
        sliderConfig: {
          min: 0,
          max: 1000,
          step: 1,
          correctValue: 443,
          tolerance: 2,
          unit: 'port',
        },
        correctAnswer: '443',
        explanation: 'HTTPS sử dụng cổng chuẩn 443.',
        difficulty: 'EASY',
      },
    ];

    const res = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'SLIDER',
      questionCount: 1,
    });

    assert.equal(res.status, 200);
    const gameId = res.body.data.gameId;
    const q = res.body.data.questions[0];
    assert.equal(q.type, 'SLIDER');
    assert.deepEqual(q.sliderConfig, {
      min: 0,
      max: 1000,
      step: 1,
      correctValue: 443,
      tolerance: 2,
      unit: 'port',
    });
    assert.equal(q.correctAnswer, '443');

    // Verify client session question includes sanitized sliderConfig (min, max, step, unit) and EXCLUDES correctValue & tolerance
    const sessCreate = await request(app).post('/api/games/sessions').send({ gameId });
    assert.equal(sessCreate.status, 200);
    const sessionId = sessCreate.body.data.sessionId;
    const sessStart = await request(app).post(`/api/games/sessions/${sessionId}/start`);
    assert.equal(sessStart.status, 200);
    const clientQ = sessStart.body.data.question;
    assert.deepEqual(clientQ.sliderConfig, {
      min: 0,
      max: 1000,
      step: 1,
      unit: 'port',
    });
    assert.equal('correctValue' in clientQ.sliderConfig, false);
    assert.equal('tolerance' in clientQ.sliderConfig, false);

    // Submit answer within tolerance in Solo session and verify duplicate submission is rejected
    const ansRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({ questionId: 'q_sl_1', answer: '445' }); // |445 - 443| = 2 <= tolerance 2
    assert.equal(ansRes.status, 200);
    assert.equal(ansRes.body.data.isCorrect, true);

    const dupAnsRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({ questionId: 'q_sl_1', answer: '443' });
    assert.equal(dupAnsRes.status, 400, 'Duplicate submission on already answered question must be rejected');

    // Handler tests: min boundary, max boundary, middle, exact, within tolerance, outside tolerance, out-of-range, empty
    const sliderHandler = getHandler('SLIDER');
    assert.equal(sliderHandler.validateAnswer(q, '443').isCorrect, true); // exact middle value
    assert.equal(sliderHandler.validateAnswer(q, '441').isCorrect, true); // within tolerance (-2)
    assert.equal(sliderHandler.validateAnswer(q, '445').isCorrect, true); // within tolerance (+2)
    assert.equal(sliderHandler.validateAnswer(q, '440').isCorrect, false); // outside tolerance (-3)
    assert.equal(sliderHandler.validateAnswer(q, '0').isCorrect, false); // min boundary (valid range, wrong value)
    assert.equal(sliderHandler.validateAnswer(q, '1000').isCorrect, false); // max boundary (valid range, wrong value)
    assert.equal(sliderHandler.validateAnswer(q, '-1').isCorrect, false); // out of range < min
    assert.equal(sliderHandler.validateAnswer(q, '1001').isCorrect, false); // out of range > max
    assert.equal(sliderHandler.validateAnswer(q, '').isCorrect, false); // unoperated / empty

    // Test min & max as correctValue boundaries
    const minBoundaryQ = GameQuestionSchema.parse({
      ...q,
      id: 'q_sl_min',
      sliderConfig: { min: 0, max: 100, step: 5, correctValue: 0, tolerance: 0, unit: '%' },
      correctAnswer: '0',
    });
    assert.equal(sliderHandler.validateAnswer(minBoundaryQ, '0').isCorrect, true);
    assert.equal(sliderHandler.validateAnswer(minBoundaryQ, '5').isCorrect, false);

    const maxBoundaryQ = GameQuestionSchema.parse({
      ...q,
      id: 'q_sl_max',
      sliderConfig: { min: 0, max: 100, step: 5, correctValue: 100, tolerance: 0, unit: '%' },
      correctAnswer: '100',
    });
    assert.equal(sliderHandler.validateAnswer(maxBoundaryQ, '100').isCorrect, true);
    assert.equal(sliderHandler.validateAnswer(maxBoundaryQ, '95').isCorrect, false);

    // Reject invalid sliderConfigs: min >= max, correctValue outside [min, max], step <= 0, step > max - min, unaligned step, tolerance >= max - min
    assert.equal(
      SliderQuestionConfigSchema.safeParse({ min: 100, max: 50, step: 1, correctValue: 75, tolerance: 0 }).success,
      false
    );
    assert.equal(
      SliderQuestionConfigSchema.safeParse({ min: 0, max: 100, step: 1, correctValue: 120, tolerance: 0 }).success,
      false
    );
    assert.equal(
      SliderQuestionConfigSchema.safeParse({ min: 0, max: 100, step: 0, correctValue: 50, tolerance: 0 }).success,
      false
    );
    assert.equal(
      SliderQuestionConfigSchema.safeParse({ min: 0, max: 10, step: 20, correctValue: 0, tolerance: 0 }).success,
      false
    );
    assert.equal(
      SliderQuestionConfigSchema.safeParse({ min: 0, max: 100, step: 10, correctValue: 25, tolerance: 0 }).success,
      false,
      'correctValue not aligned with min + k * step must be rejected'
    );
    assert.equal(
      SliderQuestionConfigSchema.safeParse({ min: 0, max: 100, step: 1, correctValue: 50, tolerance: 100 }).success,
      false,
      'tolerance >= (max - min) must be rejected'
    );

    // AI generation must reject missing sliderConfig (never fabricate default min/max/step/correctValue)
    mockProvider.mockQuestions = [
      {
        id: 'q_sl_missing_cfg',
        type: 'SLIDER',
        question: 'Câu hỏi thiếu sliderConfig?',
        correctAnswer: '50',
        difficulty: 'EASY',
      },
    ];
    const badAiRes = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'SLIDER',
      questionCount: 1,
    });
    assert.equal(badAiRes.status, 422);
    assert.equal(badAiRes.body.error.code, 'AI_QUESTION_VALIDATION_FAILED');
  });

  it('9. Rejects removed legacy formats (CROSSWORD, MIXED) and out-of-scope formats (PIN_ANSWER) on POST /api/games/generate with 400', async () => {
    resetAllRateLimiters();

    for (const disallowedType of ['CROSSWORD', 'MIXED', 'PIN_ANSWER', 'UNKNOWN_TYPE']) {
      const res = await request(app).post('/api/games/generate').send({
        sourceId,
        gameType: disallowedType,
        questionCount: 1,
      });
      assert.equal(res.status, 400, `Expected 400 for disallowed creation gameType=${disallowedType}`);
      assert.equal(res.body.error.code, 'INVALID_REQUEST');
    }
  });

  it('10 & 12. Supports editing (PATCH /api/games/:id/questions) and Solo + Multiplayer gameplay across all 5 canonical formats (QUIZ, TRUE_FALSE, TYPE_ANSWER, PUZZLE, SLIDER)', async () => {
    resetAllRateLimiters();

    mockProvider.mockQuestions = [
      {
        id: 'q_init_1',
        type: 'QUIZ',
        question: 'Câu hỏi khởi tạo?',
        choices: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
        difficulty: 'EASY',
      },
    ];

    const genRes = await request(app).post('/api/games/generate').send({
      sourceId,
      gameType: 'ADVENTURE',
      questionCount: 1,
    });
    assert.equal(genRes.status, 200);
    const gameId = genRes.body.data.gameId;

    const defaultSourceRef = {
      sourceId,
      sourceType: 'TXT' as const,
      sourceLocation: 'refactor_doc.txt',
    };

    // Edit question set to include all 5 traditional formats
    const editedQuestions = [
      {
        id: 'q_edit_quiz',
        type: 'QUIZ',
        question: 'Cổng chuẩn của HTTPS là gì?',
        choices: ['443', '80', '22', '21'],
        correctAnswer: '443',
        explanation: 'Cổng 443.',
        difficulty: 'EASY',
        sourceReference: defaultSourceRef,
      },
      {
        id: 'q_edit_tf',
        type: 'TRUE_FALSE',
        question: 'DNS dùng để phân giải tên miền sang IP.',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'Chính xác.',
        difficulty: 'EASY',
        sourceReference: defaultSourceRef,
      },
      {
        id: 'q_edit_ta',
        type: 'TYPE_ANSWER',
        question: 'Nhập tên viết tắt của giao thức truyền siêu văn bản bảo mật:',
        correctAnswer: 'HTTPS',
        explanation: 'HyperText Transfer Protocol Secure.',
        difficulty: 'MEDIUM',
        sourceReference: defaultSourceRef,
      },
      {
        id: 'q_edit_pz',
        type: 'PUZZLE',
        question: 'Sắp xếp 3 bước bắt tay TCP:',
        choices: ['Gửi SYN', 'Nhận SYN-ACK', 'Gửi ACK'],
        correctAnswer: 'Gửi SYN | Nhận SYN-ACK | Gửi ACK',
        explanation: 'SYN -> SYN-ACK -> ACK.',
        difficulty: 'MEDIUM',
        sourceReference: defaultSourceRef,
      },
      {
        id: 'q_edit_sl',
        type: 'SLIDER',
        question: 'Số bước trong quy trình bắt tay TCP (3-way handshake) là bao nhiêu?',
        sliderConfig: {
          min: 1,
          max: 10,
          step: 1,
          correctValue: 3,
          tolerance: 0,
          unit: 'bước',
        },
        correctAnswer: '3',
        explanation: 'Quy trình bắt tay TCP gồm 3 bước.',
        difficulty: 'EASY',
        sourceReference: defaultSourceRef,
      },
    ];

    const patchRes = await request(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: 'Bộ Câu Hỏi 5 Dạng Truyền Thống',
        questions: editedQuestions,
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.data.questions.length, 5);

    // Play Solo Session across all 5 formats
    const sessRes = await request(app).post('/api/games/sessions').send({ gameId });
    const sessionId = sessRes.body.data.sessionId;
    await request(app).post(`/api/games/sessions/${sessionId}/start`);

    const soloAnswers = [
      { questionId: 'q_edit_quiz', answer: '443' },
      { questionId: 'q_edit_tf', answer: 'Đúng' },
      { questionId: 'q_edit_ta', answer: 'https' },
      { questionId: 'q_edit_pz', answer: 'Gửi SYN | Nhận SYN-ACK | Gửi ACK' },
      { questionId: 'q_edit_sl', answer: '3' },
    ];

    for (const item of soloAnswers) {
      const ansRes = await request(app)
        .post(`/api/games/sessions/${sessionId}/answer`)
        .send(item);
      assert.equal(ansRes.status, 200);
      assert.equal(ansRes.body.data.isCorrect, true);
      await request(app).post(`/api/games/sessions/${sessionId}/next`);
    }

    const soloResult = await request(app).get(`/api/games/sessions/${sessionId}/result`);
    assert.equal(soloResult.status, 200);
    assert.equal(soloResult.body.data.correctCount, 5);

    // Play Multiplayer Room across all 5 formats
    const roomRes = await request(app).post('/api/rooms').send({ gameId });
    assert.equal(roomRes.status, 200);
    const { roomCode, hostToken } = roomRes.body.data;
    const room = roomService.getRoomByCode(roomCode);
    const { player } = room.addPlayer('Player 5 Modes');
    room.start(hostToken);

    for (const item of soloAnswers) {
      const sanitizedQ = room.getSanitizedCurrentQuestion();
      if (sanitizedQ.type === 'SLIDER') {
        assert.deepEqual(sanitizedQ.sliderConfig, { min: 1, max: 10, step: 1, unit: 'bước' });
        assert.equal('correctValue' in (sanitizedQ.sliderConfig || {}), false);
      }
      const sub = room.submitPlayerAnswer(player.playerToken, item.questionId, item.answer);
      assert.equal(sub.result.isCorrect, true);
      // Verify duplicate answer in multiplayer room is rejected
      assert.throws(() => {
        room.submitPlayerAnswer(player.playerToken, item.questionId, item.answer);
      });
      room.revealQuestion(hostToken);
      room.nextQuestion(hostToken);
    }
    assert.equal(room.state, 'FINISHED');
    assert.equal(player.correctCount, 5);
  });

  it('11. Preserves SQLite backward compatibility for legacy saved games (CROSSWORD, MIXED, MULTIPLE_CHOICE, QUICK_BUTTON, FILL_IN_THE_BLANK)', async () => {
    resetAllRateLimiters();

    const legacyCrosswordGame = {
      gameId: 'game_legacy_cw_sqlite',
      title: 'Ô Chữ Mạng Máy Tính Cũ',
      description: 'Saved legacy CROSSWORD game in SQLite',
      isPublic: true,
      gameType: 'CROSSWORD' as const,
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'STANDARD' as const,
      },
      questions: [
        {
          id: 'q_leg_cw_1',
          type: 'CROSSWORD' as const,
          question: 'Hệ thống phân giải tên miền (3 chữ cái)?',
          crosswordClue: 'Hệ thống phân giải tên miền',
          crosswordAnswer: 'DNS',
          correctAnswer: 'DNS',
          explanation: 'Domain Name System.',
          difficulty: 'EASY' as const,
          sourceReference: {
            sourceId,
            sourceType: 'TXT' as const,
            sourceLocation: 'refactor_doc.txt',
          },
        },
      ],
      sourceSummary: {
        sourceCount: 1,
        sources: [
          {
            sourceId,
            sourceType: 'TXT' as const,
            sourceName: 'refactor_doc.txt',
            sourceLocation: 'refactor_doc.txt',
          },
        ],
      },
      generatedAt: new Date().toISOString(),
    };

    gameStore.save(legacyCrosswordGame);

    // Simulate server restart to verify SQLite reload of legacy CROSSWORD game
    gameStore.clear();
    sessionStore.clear();
    roomStore.clear();
    closeDatabase();
    initDatabase(tempDbPath);

    const getRes = await request(app).get(`/api/games/${legacyCrosswordGame.gameId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.gameType, 'CROSSWORD');

    // Play legacy CROSSWORD game in Solo mode
    const sessRes = await request(app).post('/api/games/sessions').send({ gameId: legacyCrosswordGame.gameId });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;
    await request(app).post(`/api/games/sessions/${sessionId}/start`);
    const ansRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({ questionId: 'q_leg_cw_1', answer: 'dns' });
    assert.equal(ansRes.status, 200);
    assert.equal(ansRes.body.data.isCorrect, true);
  });
});

