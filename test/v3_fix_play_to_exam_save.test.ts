import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import supertest from 'supertest';
import { app } from '../src/app.js';
import { GameQuestion, GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { sourceStore } from '../src/storage/source.store.js';
import { closeDatabase, initDatabase } from '../src/storage/sqlite.db.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const DEFAULT_SOURCE_REF = {
  sourceId: 'src_play_to_exam_fix',
  sourceType: 'TXT' as const,
  sourceLocation: 'manual.txt',
};

const DEFAULT_SOURCE_SUMMARY = {
  sourceCount: 1,
  sources: [
    {
      sourceId: 'src_play_to_exam_fix',
      sourceType: 'TXT' as const,
      sourceName: 'manual.txt',
      sourceLocation: 'manual.txt',
    },
  ],
};

function buildFiveMultipleChoiceQuestions(): GameQuestion[] {
  return [
    {
      id: 'q_mc_1',
      type: 'MULTIPLE_CHOICE',
      question: 'Câu 1: Thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam là thành phố nào?',
      choices: ['A. Hà Nội', 'B. Đà Nẵng', 'C. TP. Hồ Chí Minh', 'D. Cần Thơ'],
      correctAnswer: 'A. Hà Nội',
      explanation: 'Hà Nội là thủ đô của Việt Nam.',
      difficulty: 'EASY',
      points: 100,
      timeLimitSeconds: 20,
      sourceReference: DEFAULT_SOURCE_REF,
    },
    {
      id: 'q_mc_2',
      type: 'MULTIPLE_CHOICE',
      question: 'Câu 2: Giao thức mạng nào hoạt động mặc định trên cổng 443?',
      choices: ['A. HTTP', 'B. HTTPS', 'C. FTP', 'D. Telnet'],
      correctAnswer: 'B. HTTPS',
      explanation: 'HTTPS hoạt động mặc định ở cổng 443 với mã hóa TLS.',
      difficulty: 'EASY',
      points: 100,
      timeLimitSeconds: 20,
      sourceReference: DEFAULT_SOURCE_REF,
    },
    {
      id: 'q_mc_3',
      type: 'MULTIPLE_CHOICE',
      question: 'Câu 3: Cấu trúc dữ liệu nào hoạt động theo nguyên tắc LIFO (Vào sau - Ra trước)?',
      choices: ['A. Queue', 'B. Linked List', 'C. Stack', 'D. Binary Tree'],
      correctAnswer: 'C. Stack',
      explanation: 'Stack (Ngăn xếp) hoạt động theo nguyên tắc Last-In First-Out.',
      difficulty: 'MEDIUM',
      points: 100,
      timeLimitSeconds: 20,
      sourceReference: DEFAULT_SOURCE_REF,
    },
    {
      id: 'q_mc_4',
      type: 'MULTIPLE_CHOICE',
      question: 'Câu 4: Mã trạng thái HTTP nào biểu thị lỗi không tìm thấy tài nguyên?',
      choices: ['A. 200 OK', 'B. 301 Moved', 'C. 500 Server Error', 'D. 404 Not Found'],
      correctAnswer: 'D. 404 Not Found',
      explanation: '404 Not Found biểu thị tài nguyên yêu cầu không tồn tại trên máy chủ.',
      difficulty: 'EASY',
      points: 100,
      timeLimitSeconds: 20,
      sourceReference: DEFAULT_SOURCE_REF,
    },
    {
      id: 'q_mc_5',
      type: 'MULTIPLE_CHOICE',
      question: 'Câu 5: Từ khóa nào trong TypeScript dùng để khai báo biến hằng số không thể gán lại?',
      choices: ['A. var', 'B. const', 'C. let', 'D. static'],
      correctAnswer: 'B. const',
      explanation: 'Từ khóa const dùng để khai báo hằng số không thể gán lại tham chiếu.',
      difficulty: 'EASY',
      points: 100,
      timeLimitSeconds: 20,
      sourceReference: DEFAULT_SOURCE_REF,
    },
  ];
}

describe('V3 FIX PLAY -> EXAM SAVE & ANSWER PRESERVATION (16 MANDATORY CASES + E2E)', () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let baseUrl: string;
  let creatorToken: string;
  let creatorUser: any;
  let otherUserToken: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_game_v3_play_to_exam_'));
    tempDbPath = path.join(tempDir, 'test_v3_play_to_exam.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();

    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const regCreator = authService.register({
      email: 'creator_play_exam@matbao.ws',
      password: 'Password123!',
      displayName: 'Creator Play->Exam',
    });
    creatorToken = regCreator.token;
    creatorUser = regCreator.user;

    const regOther = authService.register({
      email: 'other_play_exam@matbao.ws',
      password: 'Password123!',
      displayName: 'Other User',
    });
    otherUserToken = regOther.token;
  });

  after(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    gameStore.clear();
    sessionStore.clear();
    roomStore.clear();
    sourceStore.clear();
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error on Windows
    }
  });

  it('Cases 1–10 & 16: PLAY -> EXAM -> PLAY -> EXAM transitions, difficulty/timePerQuestion/single-question edits, reload, and 5/5 MULTIPLE_CHOICE answer preservation (both unowned local V3 game and owned game)', async () => {
    const gameId = 'game_v3_5mc_play_to_exam';
    const initialQuestions = buildFiveMultipleChoiceQuestions();
    const expectedAnswers = initialQuestions.map((q) => q.correctAnswer);

    // Create unowned local Creator game (ownerUserId: null, matching V3 browser Creator flow)
    const spec: GameSpecification = {
      gameId,
      ownerUserId: null,
      isPublic: true,
      title: 'Bộ đề 5 câu Trắc nghiệm Chuyển PLAY sang EXAM',
      description: 'Kiểm thử chuyển đổi PLAY <-> EXAM không mất đáp án đúng',
      gameType: 'MULTIPLE_CHOICE',
      questions: initialQuestions,
      settings: {
        questionCount: 5,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'PLAY',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(spec, Date.now(), null, true);

    // Case #2: PLAY -> PLAY -> Lưu
    const playToPlayRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: spec.questions,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'PLAY',
        },
        isPublic: true,
      });
    assert.equal(playToPlayRes.status, 200, 'Case #2: PLAY -> PLAY -> Lưu phải thành công (200)');
    assert.equal(playToPlayRes.body.data.settings.sessionMode, 'PLAY');
    assert.deepEqual(
      playToPlayRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers
    );

    // Case #1 & #16: PLAY -> EXAM -> Lưu (chưa có thí sinh vẫn lưu thành công, không mất đáp án)
    const playToExamRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: playToPlayRes.body.data.questions,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_PUBLISH',
          rosterMode: 'PRECONFIGURED',
        },
        isPublic: true,
      });
    assert.equal(playToExamRes.status, 200, 'Case #1 & #16: PLAY -> EXAM -> Lưu phải thành công (200)');
    assert.equal(playToExamRes.body.data.settings.sessionMode, 'EXAM');
    assert.deepEqual(
      playToExamRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers,
      'Case #1 & #10: 5/5 câu MULTIPLE_CHOICE phải giữ nguyên đáp án đúng'
    );

    // Case #16 verification: Opening exam session or QR while roster is empty is still blocked with EXAM_ROSTER_REQUIRED
    const startExamWithoutRosterRes = await supertest(app)
      .post('/api/games/sessions')
      .send({ gameId, playerName: 'Thí sinh tự do' });
    assert.equal(startExamWithoutRosterRes.status, 400);
    assert.equal(startExamWithoutRosterRes.body.error.code, 'EXAM_ROSTER_REQUIRED');

    // Case #9: Tải lại trang chỉnh sửa sau khi lưu (GET /api/games/:gameId?mode=manage) -> Đáp án vẫn chính xác!
    const manageReloadRes = await supertest(app).get(`/api/games/${gameId}?mode=manage`);
    assert.equal(manageReloadRes.status, 200);
    assert.deepEqual(
      manageReloadRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers,
      'Case #9: GET /api/games/:gameId?mode=manage phải trả về đủ 5/5 correctAnswer cho Creator'
    );

    // Case #4: EXAM -> EXAM -> Lưu (using questions loaded from ?mode=manage)
    const examToExamRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: manageReloadRes.body.data.questions,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_SUBMIT',
          rosterMode: 'PRECONFIGURED',
        },
        isPublic: true,
      });
    assert.equal(examToExamRes.status, 200, 'Case #4: EXAM -> EXAM -> Lưu phải thành công (200)');
    assert.equal(examToExamRes.body.data.settings.sessionMode, 'EXAM');
    assert.equal(examToExamRes.body.data.settings.examAnswerRevealPolicy, 'AFTER_SUBMIT');
    assert.deepEqual(
      examToExamRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers
    );

    // Case #10 Defense-in-depth: Even if a client accidentally submits questions from a redacted payload (correctAnswer: "")
    // while switching PLAY <-> EXAM or saving settings, backend reconciles against authoritative DB questions!
    const publicFetchRes = await supertest(app).get(`/api/games/${gameId}?mode=public`);
    assert.equal(publicFetchRes.status, 200);
    assert.deepEqual(
      publicFetchRes.body.data.questions.map((q: any) => q.correctAnswer),
      ['', '', '', '', ''],
      'Public fetch must redact answers'
    );

    const saveFromRedactedPayloadRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: publicFetchRes.body.data.questions, // all 5 have correctAnswer: ""
        settings: {
          timePerQuestion: 25,
          scoringMode: 'STANDARD',
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_PUBLISH',
        },
        isPublic: true,
      });
    assert.equal(
      saveFromRedactedPayloadRes.status,
      200,
      'Case #10: Saving when client payload had redacted correctAnswer: "" must preserve stored valid answers instead of failing with 400'
    );
    assert.deepEqual(
      saveFromRedactedPayloadRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers,
      'All 5 original correctAnswers (A, B, C, D, B) must be preserved without fabricating choices[0]'
    );

    // Case #3 & #5: EXAM -> PLAY -> Lưu, then PLAY -> EXAM -> PLAY
    const examToPlayRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: saveFromRedactedPayloadRes.body.data.questions,
        settings: {
          timePerQuestion: 25,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'PLAY',
        },
        isPublic: true,
      });
    assert.equal(examToPlayRes.status, 200, 'Case #3 & #5: EXAM -> PLAY -> Lưu phải thành công (200)');
    assert.equal(examToPlayRes.body.data.settings.sessionMode, 'PLAY');
    assert.deepEqual(
      examToPlayRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers
    );

    // Case #6: Sửa độ khó (difficulty) rồi lưu -> Không mất đáp án
    const difficultyModifiedQuestions = examToPlayRes.body.data.questions.map((q: any) => ({
      ...q,
      difficulty: 'HARD',
    }));
    const saveDiffRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: difficultyModifiedQuestions,
        settings: {
          timePerQuestion: 25,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'EXAM',
        },
        isPublic: true,
      });
    assert.equal(saveDiffRes.status, 200, 'Case #6: Sửa độ khó rồi lưu phải thành công');
    assert.ok(saveDiffRes.body.data.questions.every((q: any) => q.difficulty === 'HARD'));
    assert.deepEqual(
      saveDiffRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers
    );

    // Case #7: Sửa thời gian mỗi câu (timePerQuestion) rồi lưu -> Không mất đáp án
    const saveTimeRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: saveDiffRes.body.data.questions,
        settings: {
          timePerQuestion: 45,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'EXAM',
        },
        isPublic: true,
      });
    assert.equal(saveTimeRes.status, 200, 'Case #7: Sửa timePerQuestion rồi lưu phải thành công');
    assert.equal(saveTimeRes.body.data.settings.timePerQuestion, 45);
    assert.deepEqual(
      saveTimeRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers
    );

    // Case #8: Sửa 1 câu hỏi rồi lưu -> Các câu khác giữ nguyên
    const oneQuestionEdited = saveTimeRes.body.data.questions.map((q: any, idx: number) =>
      idx === 2
        ? {
            ...q,
            question: 'Câu 3 (Đã cập nhật): Cấu trúc dữ liệu LIFO là gì?',
            correctAnswer: 'C. Stack',
          }
        : q
    );
    const saveOneQRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: oneQuestionEdited,
        settings: {
          timePerQuestion: 45,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'EXAM',
        },
        isPublic: true,
      });
    assert.equal(saveOneQRes.status, 200, 'Case #8: Sửa 1 câu hỏi rồi lưu phải thành công');
    assert.equal(
      saveOneQRes.body.data.questions[2].question,
      'Câu 3 (Đã cập nhật): Cấu trúc dữ liệu LIFO là gì?'
    );
    assert.deepEqual(
      saveOneQRes.body.data.questions.map((q: any) => q.correctAnswer),
      expectedAnswers
    );
  });

  it('Case #11: Multi-question-type game (MULTIPLE_CHOICE, QUICK_BUTTON, FILL_IN_THE_BLANK, CROSSWORD, PUZZLE, SLIDER) switches PLAY -> EXAM -> PLAY without any answer loss', async () => {
    const gameId = 'game_v3_multitype_play_to_exam';
    const multiQuestions: GameQuestion[] = [
      {
        id: 'mt_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 1 MC: Ngôn ngữ nào có kiểu tĩnh?',
        choices: ['TypeScript', 'HTML', 'CSS', 'JSON'],
        correctAnswer: 'TypeScript',
        explanation: 'TypeScript bổ sung kiểu tĩnh cho JavaScript.',
        difficulty: 'EASY',
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: 'mt_2',
        type: 'QUICK_BUTTON',
        question: 'Câu 2 TF: SQLite là cơ sở dữ liệu nhúng?',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'SQLite hoạt động trực tiếp trên tệp dữ liệu nhúng.',
        difficulty: 'EASY',
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: 'mt_3',
        type: 'FILL_IN_THE_BLANK',
        question: 'Câu 3 Điền khuyết: Viết tắt của Giao thức truyền tải siêu văn bản là ___',
        correctAnswer: 'HTTP',
        acceptedAlternatives: ['http', 'HyperText Transfer Protocol'],
        explanation: 'HTTP là HyperText Transfer Protocol.',
        difficulty: 'MEDIUM',
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: 'mt_4',
        type: 'CROSSWORD',
        question: 'Câu 4 Ô chữ: Tên dịch vụ lưu trữ mã nguồn phổ biến nhất (6 chữ cái)',
        correctAnswer: 'GITHUB',
        crosswordAnswer: 'GITHUB',
        explanation: 'GitHub là nền tảng lưu trữ mã nguồn Git.',
        difficulty: 'MEDIUM',
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: 'mt_5',
        type: 'PUZZLE',
        question: 'Câu 5 Sắp xếp: Trình tự 3 bước TDD',
        choices: ['Red', 'Green', 'Refactor'],
        correctAnswer: 'Red | Green | Refactor',
        explanation: 'Chu trình TDD gồm Red -> Green -> Refactor.',
        difficulty: 'HARD',
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: 'mt_6',
        type: 'SLIDER',
        question: 'Câu 6 Thanh trượt: Cổng mặc định của HTTP là bao nhiêu?',
        sliderConfig: {
          min: 1,
          max: 100,
          step: 1,
          correctValue: 80,
          tolerance: 0,
          unit: 'port',
        },
        correctAnswer: '80',
        explanation: 'HTTP sử dụng cổng 80 mặc định.',
        difficulty: 'EASY',
        sourceReference: DEFAULT_SOURCE_REF,
      },
    ];

    const spec: GameSpecification = {
      gameId,
      ownerUserId: null,
      isPublic: true,
      title: 'Bộ đề Đa Dạng Câu Hỏi Chuyển PLAY sang EXAM',
      description: 'Kiểm thử 6 dạng câu hỏi chuyển PLAY <-> EXAM',
      gameType: 'ADVENTURE',
      questions: multiQuestions,
      settings: {
        questionCount: 6,
        timePerQuestion: 25,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'PLAY',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(spec, Date.now(), null, true);

    const patchExamRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        title: spec.title,
        description: spec.description,
        questions: spec.questions,
        settings: {
          timePerQuestion: 25,
          scoringMode: 'SPEED_BONUS',
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_PUBLISH',
        },
        isPublic: true,
      });
    assert.equal(patchExamRes.status, 200);
    assert.equal(patchExamRes.body.data.settings.sessionMode, 'EXAM');

    // Fetch via ?mode=manage and verify all 6 types kept their exact answers
    const manageRes = await supertest(app).get(`/api/games/${gameId}?mode=manage`);
    assert.equal(manageRes.status, 200);
    assert.deepEqual(
      manageRes.body.data.questions.map((q: any) => q.correctAnswer),
      ['TypeScript', 'Đúng', 'HTTP', 'GITHUB', 'Red | Green | Refactor', '80']
    );
    assert.equal(manageRes.body.data.questions[5].sliderConfig.correctValue, 80);
  });

  it('Cases #12, #13, #14, #15 & Validation Integrity: EXAM 3 reveal policies, PLAY finish hides answers, Creator sees/edits answers, Guest/Player blocked from answers, and genuinely invalid questions still fail validation', async () => {
    const gameId = 'game_v3_policies_and_security';
    const questions = buildFiveMultipleChoiceQuestions();
    const spec: GameSpecification = {
      gameId,
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Bộ đề Kiểm thử Chính sách & Bảo mật',
      description: 'Kiểm thử Cases 12, 13, 14, 15',
      gameType: 'MULTIPLE_CHOICE',
      questions,
      settings: {
        questionCount: 5,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'EXAM',
        examAnswerRevealPolicy: 'IMMEDIATE',
        rosterMode: 'PRECONFIGURED',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(spec, Date.now(), creatorUser.userId, true);
    persistenceRepo.upsertParticipants(
      gameId,
      [{ fullName: 'Nguyễn Văn Thí Sinh', departmentUnit: 'Phòng QA', employeeCode: 'QA01' }],
      true
    );

    // Case #12: Switch between all 3 EXAM reveal policies (IMMEDIATE, AFTER_SUBMIT, AFTER_PUBLISH)
    for (const policy of ['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_PUBLISH'] as const) {
      const resPolicy = await supertest(app)
        .patch(`/api/games/${gameId}/questions`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          title: spec.title,
          description: spec.description,
          questions,
          settings: {
            timePerQuestion: 20,
            scoringMode: 'STANDARD',
            sessionMode: 'EXAM',
            examAnswerRevealPolicy: policy,
          },
          isPublic: true,
        });
      assert.equal(resPolicy.status, 200, `Case #12: Policy ${policy} save must succeed`);
      assert.equal(resPolicy.body.data.settings.examAnswerRevealPolicy, policy);
    }

    // Case #14: Creator fetches game in manage mode -> sees and edits answers
    const creatorManageRes = await supertest(app)
      .get(`/api/games/${gameId}?mode=manage`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(creatorManageRes.status, 200);
    assert.equal(creatorManageRes.body.data.questions[0].correctAnswer, 'A. Hà Nội');

    // Case #15: Guest / Player / Public viewer cannot see secret answers or call ?mode=manage
    const publicViewRes = await supertest(app).get(`/api/games/${gameId}?mode=public`);
    assert.equal(publicViewRes.status, 200);
    for (const q of publicViewRes.body.data.questions) {
      assert.equal(q.correctAnswer, '', 'Case #15: Public view must not leak correctAnswer');
      assert.equal(q.explanation, '', 'Case #15: Public view must not leak explanation');
    }

    const guestManageAttempt = await supertest(app)
      .get(`/api/games/${gameId}?mode=manage`)
      .set('X-Guest-Token', 'gt_1234567890abcdef1234567890abcdef');
    assert.equal(guestManageAttempt.status, 403, 'Case #15: Guest token must be blocked from ?mode=manage');

    const playerManageAttempt = await supertest(app)
      .get(`/api/games/${gameId}?mode=manage`)
      .set('X-Player-Token', 'pt_player_token_xyz');
    assert.equal(playerManageAttempt.status, 403, 'Case #15: Player token must be blocked from ?mode=manage');

    const otherUserManageAttempt = await supertest(app)
      .get(`/api/games/${gameId}?mode=manage`)
      .set('Authorization', `Bearer ${otherUserToken}`);
    assert.equal(otherUserManageAttempt.status, 403, 'Case #15: Non-owner user must be blocked from ?mode=manage');

    // Validation Integrity: Genuinely invalid new question with empty correctAnswer must STILL fail with 400!
    const invalidNewQuestionRes = await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: spec.title,
        questions: [
          ...questions,
          {
            id: 'q_brand_new_invalid',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu 6 mới nhưng quên chọn đáp án đúng?',
            choices: ['Lựa chọn 1', 'Lựa chọn 2', 'Lựa chọn 3', 'Lựa chọn 4'],
            correctAnswer: '',
            explanation: '',
            difficulty: 'EASY',
            sourceReference: DEFAULT_SOURCE_REF,
          },
        ],
      });
    assert.equal(
      invalidNewQuestionRes.status,
      400,
      'Validation must still reject a genuinely invalid new question with empty correctAnswer'
    );

    // Case #13: Switch to PLAY, complete a PLAY session, and verify post-game summary still hides correct answers
    await supertest(app)
      .patch(`/api/games/${gameId}/questions`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: spec.title,
        questions,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'PLAY',
        },
        isPublic: true,
      });

    const playSessRes = await supertest(app)
      .post('/api/games/sessions')
      .send({ gameId, playerName: 'Người chơi PLAY' });
    assert.equal(playSessRes.status, 200);
    const playSessionId = playSessRes.body.data.sessionId;
    await supertest(app).post(`/api/games/sessions/${playSessionId}/start`).send({});

    for (const q of questions) {
      const ansRes = await supertest(app)
        .post(`/api/games/sessions/${playSessionId}/answer`)
        .send({ questionId: q.id, answer: q.correctAnswer, responseTimeMs: 1200 });
      assert.equal(ansRes.status, 200);
      // During gameplay, immediate feedback still works
      assert.equal(ansRes.body.data.correctAnswer, q.correctAnswer);
      await supertest(app).post(`/api/games/sessions/${playSessionId}/next`).send({});
    }

    const playResultRes = await supertest(app).get(`/api/games/sessions/${playSessionId}/result`);
    assert.equal(playResultRes.status, 200);
    assert.equal(playResultRes.body.data.canRevealAnswers, false, 'Case #13: PLAY result must hide answers');
    for (const qr of playResultRes.body.data.questionResults) {
      assert.equal(qr.correctAnswer, undefined, 'Case #13: PLAY result must not include correctAnswer');
      assert.equal(qr.explanation, undefined, 'Case #13: PLAY result must not include explanation');
    }
  });

  it('Browser E2E (Chromium): Thư viện -> Chỉnh sửa game -> Đổi CHƠI (PLAY) sang THI (EXAM) -> Lưu Thay Đổi -> Không báo lỗi validation và bảo toàn 5/5 đáp án đúng', async () => {
    const e2eGameId = 'game_v3_e2e_play_to_exam_5mc';
    const initialQuestions = buildFiveMultipleChoiceQuestions();
    const expectedAnswers = initialQuestions.map((q) => q.correctAnswer);

    const e2eSpec: GameSpecification = {
      gameId: e2eGameId,
      ownerUserId: null, // Real V3 local Creator game in SQLite
      isPublic: true,
      title: 'E2E Game 5 Câu Chuyển PLAY Sang EXAM',
      description: 'Kiểm thử trình duyệt chuyển PLAY sang EXAM và bấm Lưu Thay Đổi',
      gameType: 'MULTIPLE_CHOICE',
      questions: initialQuestions,
      settings: {
        questionCount: 5,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'PLAY',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(e2eSpec, Date.now(), null, true);

    const browser = await Browser.launch({ width: 1440, height: 900 });
    const page = await browser.newPage({ width: 1440, height: 900 });
    try {
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.goto(`${baseUrl}/?tab=library`, { settleMs: 900 });

      // 1. Click "Chi tiết" on e2eGameId card, then click "Sửa" (library-detail-edit-game-btn)
      const clickedDetail = await page.eval(`(() => {
        const detailBtn =
          document.querySelector('[data-testid="library-card-detail-btn-${e2eGameId}"]') ||
          document.querySelector('[data-testid="library-row-detail-btn-${e2eGameId}"]');
        if (detailBtn) {
          detailBtn.click();
          return true;
        }
        return false;
      })()`);
      assert.equal(clickedDetail, true, 'Phải bấm được nút Chi tiết game trong Thư viện');
      await sleep(800);

      const clickedEdit = await page.eval(`(() => {
        const editBtn = document.querySelector('[data-testid="library-detail-edit-game-btn"]');
        if (editBtn) {
          editBtn.click();
          return true;
        }
        return false;
      })()`);
      assert.equal(clickedEdit, true, 'Phải bấm được nút Sửa game trong Thư viện');
      await sleep(600);

      // 2. Switch mode from CHƠI (PLAY) -> THI (EXAM) and click Lưu Thay Đổi
      const switchedToExam = await page.eval(`(() => {
        const modeSelect = document.querySelector('[data-testid="library-edit-session-mode-select"]');
        if (!modeSelect) return { ok: false, reason: 'missing library-edit-session-mode-select' };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(modeSelect, 'EXAM');
        modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`);
      assert.equal(switchedToExam.ok, true);
      await sleep(300);

      await page.eval(`(() => {
        const saveBtn = document.querySelector('[data-testid="library-edit-save-btn"]');
        if (saveBtn) saveBtn.click();
      })()`);
      await sleep(900);

      // Verify no validation error toast appeared and DB updated to EXAM with all 5 answers intact
      const bodyTextAfterPlayToExam = await page.eval(`document.body.innerText`);
      assert.equal(
        bodyTextAfterPlayToExam.includes('Question validation failed'),
        false,
        'Không được xuất hiện lỗi Question validation failed khi chuyển PLAY -> EXAM và bấm Lưu'
      );

      const storedAfterPlayToExam = gameStore.get(e2eGameId);
      assert.ok(storedAfterPlayToExam);
      assert.equal(storedAfterPlayToExam.settings.sessionMode, 'EXAM');
      assert.deepEqual(
        storedAfterPlayToExam.questions.map((q) => q.correctAnswer),
        expectedAnswers,
        'Sau khi lưu PLAY -> EXAM trên UI, 5/5 câu hỏi trong DB phải giữ nguyên đáp án đúng'
      );

      // 3. Reload page, re-open Thư viện -> Chi tiết -> Sửa on the EXAM game, and save again (EXAM -> EXAM -> Lưu)
      await page.goto(`${baseUrl}/?tab=library`, { settleMs: 900 });

      await page.eval(`(() => {
        const detailBtn =
          document.querySelector('[data-testid="library-card-detail-btn-${e2eGameId}"]') ||
          document.querySelector('[data-testid="library-row-detail-btn-${e2eGameId}"]');
        if (detailBtn) detailBtn.click();
      })()`);
      await sleep(800);

      await page.eval(`(() => {
        const editBtn = document.querySelector('[data-testid="library-detail-edit-game-btn"]');
        if (editBtn) editBtn.click();
      })()`);
      await sleep(600);

      // Verify the 5 <select> elements for "Đáp án đúng" in the question editor have the exact 5 original answers selected
      const selectedValuesInEditor = await page.eval(`(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects
          .filter((s) => Array.from(s.options).some((opt) => opt.value.startsWith('A. ')))
          .map((s) => s.value);
      })()`);
      assert.deepEqual(
        selectedValuesInEditor,
        expectedAnswers,
        'Khi mở lại màn hình Chỉnh sửa game ở chế độ EXAM, cả 5 ô chọn đáp án đúng phải hiển thị đúng đáp án gốc (A, B, C, D, B)'
      );

      // Click Lưu Thay Đổi on EXAM -> EXAM
      await page.eval(`(() => {
        const saveBtn = document.querySelector('[data-testid="library-edit-save-btn"]');
        if (saveBtn) saveBtn.click();
      })()`);
      await sleep(900);

      const bodyTextAfterExamToExam = await page.eval(`document.body.innerText`);
      assert.equal(
        bodyTextAfterExamToExam.includes('Question validation failed'),
        false,
        'Không được xuất hiện lỗi Question validation failed khi lưu lại game EXAM'
      );
      const storedAfterExamToExam = gameStore.get(e2eGameId);
      assert.ok(storedAfterExamToExam);
      assert.deepEqual(
        storedAfterExamToExam.questions.map((q) => q.correctAnswer),
        expectedAnswers
      );
    } finally {
      await browser.close();
    }
  });
});

