import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import supertest from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
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

const ARTIFACT_DIR = 'C:\\Users\\QUOC SIEU\\.gemini\\antigravity\\brain\\83ff8c51-8136-444f-904b-1284fcdde2fb';

const DEFAULT_SOURCE_REF = {
  sourceId: 'src_v3_test',
  sourceType: 'TXT' as const,
  sourceLocation: 'manual.txt',
};

const DEFAULT_SOURCE_SUMMARY = {
  sourceCount: 1,
  sources: [
    {
      sourceId: 'src_v3_test',
      sourceType: 'TXT' as const,
      sourceName: 'manual.txt',
      sourceLocation: 'manual.txt',
    },
  ],
};

describe('V3 ANSWER FEEDBACK & EXAM MODES VERIFICATION', () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let baseUrl: string;

  let creatorToken: string;
  let creatorUser: any;
  let otherUserToken: string;
  let otherUser: any;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_game_v3_exam_feedback_'));
    tempDbPath = path.join(tempDir, 'test_v3_exam_feedback.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();

    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const regCreator = authService.register({
      email: 'creator_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Creator BTC V3',
    });
    creatorToken = regCreator.token;
    creatorUser = regCreator.user;

    const regOther = authService.register({
      email: 'other_user_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Other Viewer User',
    });
    otherUserToken = regOther.token;
    otherUser = regOther.user;
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

  it('1. PLAY Mode Answer Feedback: correct, wrong, timeout (0 pts + correct answer), and explanation across MULTIPLE_CHOICE, QUICK_BUTTON, FILL_IN_THE_BLANK, CROSSWORD, PUZZLE, SLIDER', async () => {
    const playMultiTypeSpec: GameSpecification = {
      gameId: 'game_v3_play_multitype',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Bộ đề Chơi (PLAY) Đa Dạng Câu Hỏi',
      description: 'Kiểm thử phản hồi đáp án chế độ PLAY cho mọi loại câu hỏi',
      gameType: 'MIXED',
      questions: [
        {
          id: 'q1_mc_expl',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: Thủ đô của Việt Nam là gì?',
          choices: ['A. Hà Nội', 'B. Đà Nẵng', 'C. TP.HCM', 'D. Cần Thơ'],
          correctAnswer: 'A. Hà Nội',
          explanation: 'Hà Nội là thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q2_tf_no_expl',
          type: 'QUICK_BUTTON',
          question: 'Câu 2: Trái Đất quay quanh Mặt Trời?',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation: '', // empty explanation -> should NOT fabricate fake text
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q3_fill_blank',
          type: 'FILL_IN_THE_BLANK',
          question: 'Câu 3: Ngôn ngữ lập trình chạy trên trình duyệt phổ biến nhất là ___',
          choices: [],
          correctAnswer: 'JavaScript',
          explanation: 'JavaScript là ngôn ngữ kịch bản chuẩn trên trình duyệt web.',
          difficulty: 'MEDIUM',
          points: 150,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q4_crossword',
          type: 'CROSSWORD',
          question: 'Câu 4: Giải ô chữ từ khóa công nghệ',
          choices: [],
          correctAnswer: 'AI',
          crosswordAnswer: 'AI',
          explanation: 'AI là viết tắt của Artificial Intelligence.',
          difficulty: 'MEDIUM',
          points: 120,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q5_puzzle',
          type: 'PUZZLE',
          question: 'Câu 5: Ghép mảnh quy trình CI/CD đúng thứ tự',
          choices: ['Build', 'Test', 'Deploy'],
          correctAnswer: 'Build -> Test -> Deploy',
          explanation: 'Quy trình chuẩn là Build -> Test -> Deploy.',
          difficulty: 'MEDIUM',
          points: 150,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q6_slider',
          type: 'SLIDER',
          question: 'Câu 6: Năm thành lập nước Việt Nam Dân chủ Cộng hòa?',
          choices: [],
          correctAnswer: '1945',
          sliderConfig: {
            min: 1900,
            max: 2000,
            step: 1,
            correctValue: 1945,
            toleranceExact: 0,
            toleranceNear: 5,
          },
          explanation: 'Ngày 2/9/1945 Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập.',
          difficulty: 'MEDIUM',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
      settings: {
        questionCount: 6,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'PLAY',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(playMultiTypeSpec, Date.now(), creatorUser.userId, true);

    // Create PLAY session
    const createRes = await supertest(app)
      .post('/api/games/sessions')
      .send({ gameId: playMultiTypeSpec.gameId, playerName: 'Player PlayTest', publicPlay: true })
      .expect(200);

    const sessionId = createRes.body.data.sessionId;
    const pToken = createRes.body.data.lockToken;
    assert.ok(sessionId);
    assert.ok(pToken);

    // Start session -> Q1 active
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // Q1 (MULTIPLE_CHOICE): Answer CORRECT
    const q1Res = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q1_mc_expl', answer: 'A. Hà Nội' })
      .expect(200);
    assert.equal(q1Res.body.data.isCorrect, true);
    assert.equal(q1Res.body.data.correctAnswer, 'A. Hà Nội');
    assert.equal(
      q1Res.body.data.explanation,
      'Hà Nội là thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.'
    );
    assert.ok(q1Res.body.data.pointsEarned >= 100);

    // Advance to Q2 (QUICK_BUTTON / TRUE_FALSE, empty explanation)
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // Q2: Answer WRONG -> should return isCorrect=false, correctAnswer='Đúng', explanation='' (no fake explanation)
    const q2Res = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q2_tf_no_expl', answer: 'Sai' })
      .expect(200);
    assert.equal(q2Res.body.data.isCorrect, false);
    assert.equal(q2Res.body.data.pointsEarned, 0);
    assert.equal(q2Res.body.data.correctAnswer, 'Đúng');
    assert.equal(q2Res.body.data.explanation, '');

    // Advance to Q3 (FILL_IN_THE_BLANK)
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // Q3: Timeout (no answer submitted) -> 0 points + reveals correctAnswer + explanation
    const q3TimeoutRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/timeout`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q3_fill_blank' })
      .expect(200);
    assert.equal(q3TimeoutRes.body.data.timedOut, true);
    assert.equal(q3TimeoutRes.body.data.isCorrect, false);
    assert.equal(q3TimeoutRes.body.data.pointsEarned, 0);
    assert.equal(q3TimeoutRes.body.data.correctAnswer, 'JavaScript');
    assert.equal(
      q3TimeoutRes.body.data.explanation,
      'JavaScript là ngôn ngữ kịch bản chuẩn trên trình duyệt web.'
    );

    // Advance to Q4 (CROSSWORD)
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    const q4Res = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q4_crossword', answer: 'AI' })
      .expect(200);
    assert.equal(q4Res.body.data.isCorrect, true);
    assert.equal(q4Res.body.data.correctAnswer, 'AI');

    // Advance to Q5 (PUZZLE)
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    const q5Res = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q5_puzzle', answer: 'Build -> Deploy -> Test' })
      .expect(200);
    assert.equal(q5Res.body.data.isCorrect, false);
    assert.equal(q5Res.body.data.correctAnswer, 'Build -> Test -> Deploy');

    // Advance to Q6 (SLIDER)
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    const q6Res = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q6_slider', answer: '1945' })
      .expect(200);
    assert.equal(q6Res.body.data.isCorrect, true);
    assert.equal(q6Res.body.data.correctAnswer, '1945');

    // Finish session -> PLAY mode hides post-game correct answers & explanations while preserving score summary
    const finishRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(finishRes.body.data.finished, true);
    assert.equal(finishRes.body.data.result.canRevealAnswers, false);
    assert.equal(finishRes.body.data.result.questionResults.length, 6);
    for (const qr of finishRes.body.data.result.questionResults) {
      assert.equal(qr.correctAnswer, undefined);
      assert.equal(qr.explanation, undefined);
    }
  });

  it('2. EXAM Mode Policy 1 (IMMEDIATE - Hiển thị đáp án sau mỗi câu): reveals right/wrong + correctAnswer + explanation immediately after locking answer or timeout, prevents re-answering', async () => {
    const examImmediateSpec: GameSpecification = {
      gameId: 'game_v3_exam_immediate',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Kỳ Thi Chính Thức - Hiển Thị Đáp Án Sau Mỗi Câu',
      description: 'Cấu hình EXAM + IMMEDIATE',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: 'imm_q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: HTTP status code nào biểu thị Created?',
          choices: ['200', '201', '204', '400'],
          correctAnswer: '201',
          explanation: '201 Created biểu thị tài nguyên mới đã được khởi tạo thành công.',
          difficulty: 'MEDIUM',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'imm_q2',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 2: Cổng mặc định của HTTPS là gì?',
          choices: ['80', '443', '8080', '22'],
          correctAnswer: '443',
          explanation: 'HTTPS mặc định sử dụng cổng TCP 443.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'EXAM',
        examAnswerRevealPolicy: 'IMMEDIATE',
        answersPublished: false,
        examStatus: 'OPEN',
        rosterMode: 'PRECONFIGURED',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(examImmediateSpec, Date.now(), creatorUser.userId, true);
    const immRoster = persistenceRepo.upsertParticipants(examImmediateSpec.gameId, [
      {
        fullName: 'Thí Sinh Immediate',
        departmentUnit: 'Phòng QA',
        employeeCode: 'IMM01',
        allowedAttempts: 2,
      },
    ]);
    const immParticipantId = immRoster[0].participantId;

    // Before answering, GET /api/games/:gameId for public viewer MUST NOT leak correctAnswer
    const publicGameGet = await supertest(app)
      .get(`/api/games/${examImmediateSpec.gameId}`)
      .expect(200);
    assert.equal(publicGameGet.body.data.questions[0].correctAnswer, '');

    // Create & Start EXAM session
    const createRes = await supertest(app)
      .post('/api/games/sessions')
      .send({
        gameId: examImmediateSpec.gameId,
        participantId: immParticipantId,
        playerName: 'Thí Sinh Immediate',
        publicPlay: true,
      })
      .expect(200);
    const sessionId = createRes.body.data.sessionId;
    const pToken = createRes.body.data.lockToken;

    const startRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    // Current question must not include correctAnswer before locking answer
    assert.equal(startRes.body.data.question.correctAnswer, undefined);

    // Submit answer for Q1 -> IMMEDIATE policy must reveal right/wrong, correctAnswer, and explanation right away
    const ans1 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'imm_q1', answer: '200' })
      .expect(200);
    assert.equal(ans1.body.data.examAnswerRevealPolicy, 'IMMEDIATE');
    assert.equal(ans1.body.data.isCorrect, false);
    assert.equal(ans1.body.data.correctAnswer, '201');
    assert.equal(
      ans1.body.data.explanation,
      '201 Created biểu thị tài nguyên mới đã được khởi tạo thành công.'
    );

    // Attempting to re-answer Q1 after seeing the answer must fail (400 INVALID_STATE_TRANSITION / already answered)
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'imm_q1', answer: '201' })
      .expect(400);

    // Advance to Q2 and trigger timeout -> IMMEDIATE policy reveals Q2 answer on timeout
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    const timeout2 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/timeout`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'imm_q2' })
      .expect(200);
    assert.equal(timeout2.body.data.timedOut, true);
    assert.equal(timeout2.body.data.correctAnswer, '443');
    assert.equal(timeout2.body.data.explanation, 'HTTPS mặc định sử dụng cổng TCP 443.');

    // Finish session -> result has canRevealAnswers=true
    const finishRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(finishRes.body.data.finished, true);
    assert.equal(finishRes.body.data.result.canRevealAnswers, true);
    assert.equal(finishRes.body.data.result.questionResults[0].correctAnswer, '201');
    assert.equal(finishRes.body.data.result.questionResults[1].correctAnswer, '443');
  });

  it('3. EXAM Mode Policy 2 (AFTER_SUBMIT - Hiển thị đáp án sau khi nộp bài): hides answers while playing, reveals immediately upon submitting/finishing without waiting for creator publish', async () => {
    const examAfterSubmitSpec: GameSpecification = {
      gameId: 'game_v3_exam_after_submit',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Kỳ Thi Chính Thức - Hiển Thị Đáp Án Sau Khi Nộp Bài',
      description: 'Cấu hình EXAM + AFTER_SUBMIT',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: 'sub_q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: SQL viết tắt của từ gì?',
          choices: [
            'Structured Query Language',
            'Simple Query Language',
            'System Query Logic',
            'Standard Question Language',
          ],
          correctAnswer: 'Structured Query Language',
          explanation: 'SQL là ngôn ngữ truy vấn có cấu trúc (Structured Query Language).',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'sub_q2',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 2: Chỉ mục (Index) trong CSDL giúp tăng tốc thao tác nào nhất?',
          choices: ['SELECT / Truy vấn', 'INSERT', 'DROP TABLE', 'TRUNCATE'],
          correctAnswer: 'SELECT / Truy vấn',
          explanation: 'Index giúp tối ưu tốc độ tìm kiếm và truy vấn SELECT.',
          difficulty: 'MEDIUM',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'EXAM',
        examAnswerRevealPolicy: 'AFTER_SUBMIT',
        answersPublished: false,
        examStatus: 'OPEN',
        rosterMode: 'PRECONFIGURED',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(examAfterSubmitSpec, Date.now(), creatorUser.userId, true);
    const subRoster = persistenceRepo.upsertParticipants(examAfterSubmitSpec.gameId, [
      {
        fullName: 'Thí Sinh After Submit API',
        departmentUnit: 'Phòng CSDL',
        employeeCode: 'SUB01',
        allowedAttempts: 2,
      },
      {
        fullName: 'Thí Sinh After Submit Browser',
        departmentUnit: 'Phòng CSDL',
        employeeCode: 'SUB02',
        allowedAttempts: 2,
      },
    ]);
    const subParticipantId = subRoster[0].participantId;

    // Create & Start EXAM session
    const createRes = await supertest(app)
      .post('/api/games/sessions')
      .send({
        gameId: examAfterSubmitSpec.gameId,
        participantId: subParticipantId,
        playerName: 'Thí Sinh After Submit API',
        publicPlay: true,
      })
      .expect(200);
    const sessionId = createRes.body.data.sessionId;
    const pToken = createRes.body.data.lockToken;

    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // Answer Q1 -> MUST BE REDACTED during the exam
    const ans1 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'sub_q1', answer: 'Structured Query Language' })
      .expect(200);
    assert.equal(ans1.body.data.examAnswerRecorded, true);
    assert.equal(ans1.body.data.examAnswerRevealPolicy, 'AFTER_SUBMIT');
    assert.equal(ans1.body.data.isCorrect, undefined);
    assert.equal(ans1.body.data.correctAnswer, undefined);
    assert.equal(ans1.body.data.explanation, undefined);

    // Trying to call GET /result before finishing the exam MUST return 400 INVALID_GAME_STATE / GAME_NOT_FINISHED
    const prematureResult = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('X-Participant-Token', pToken)
      .expect(400);
    assert.ok(
      ['INVALID_GAME_STATE', 'GAME_NOT_FINISHED'].includes(prematureResult.body.error.code)
    );

    // Advance to Q2 and answer wrong -> still redacted during the exam
    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    const ans2 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'sub_q2', answer: 'INSERT' })
      .expect(200);
    assert.equal(ans2.body.data.examAnswerRecorded, true);
    assert.equal(ans2.body.data.isCorrect, undefined);
    assert.equal(ans2.body.data.correctAnswer, undefined);

    // Submit/Finish the exam (POST /next on last question) -> IMMEDIATELY reveals full answers & explanations!
    const finishRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(finishRes.body.data.finished, true);
    assert.equal(finishRes.body.data.result.examAnswerRevealPolicy, 'AFTER_SUBMIT');
    assert.equal(finishRes.body.data.result.canRevealAnswers, true);
    assert.equal(finishRes.body.data.result.questionResults.length, 2);
    assert.equal(finishRes.body.data.result.questionResults[0].isCorrect, true);
    assert.equal(
      finishRes.body.data.result.questionResults[0].correctAnswer,
      'Structured Query Language'
    );
    assert.equal(
      finishRes.body.data.result.questionResults[0].explanation,
      'SQL là ngôn ngữ truy vấn có cấu trúc (Structured Query Language).'
    );
    assert.equal(finishRes.body.data.result.questionResults[1].isCorrect, false);
    assert.equal(finishRes.body.data.result.questionResults[1].correctAnswer, 'SELECT / Truy vấn');

    // GET /result with participantToken also returns full answers
    const getResultRes = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(getResultRes.body.data.canRevealAnswers, true);
    assert.equal(
      getResultRes.body.data.questionResults[0].correctAnswer,
      'Structured Query Language'
    );

    // Another candidate with wrong token cannot read this candidate's session (403 ACCESS_DENIED)
    await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('X-Participant-Token', 'wrong_token_123')
      .expect(403);
  });

  it('4. EXAM Mode Policy 3 (AFTER_PUBLISH) & Legacy EXAM Default: hides answers during exam AND after submit until creator publishes answers, plus Historical Session Snapshot protection', async () => {
    // Omit examAnswerRevealPolicy to verify legacy EXAM games default safely to AFTER_PUBLISH
    const examLegacyAfterPublishSpec: GameSpecification = {
      gameId: 'game_v3_exam_after_publish',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Kỳ Thi Chính Thức - Chỉ Hiển Thị Khi Người Tạo Công Bố',
      description: 'Cấu hình EXAM mặc định AFTER_PUBLISH',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: 'pub_q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: Giao thức nào hoạt động ở tầng Transport trong mô hình OSI?',
          choices: ['TCP', 'IP', 'HTTP', 'ARP'],
          correctAnswer: 'TCP',
          explanation: 'TCP và UDP là hai giao thức chính ở tầng Transport (Layer 4).',
          difficulty: 'MEDIUM',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'SPEED_BONUS',
        sessionMode: 'EXAM',
        answersPublished: false,
        examStatus: 'OPEN',
        rosterMode: 'PRECONFIGURED',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(examLegacyAfterPublishSpec, Date.now(), creatorUser.userId, true);
    const pubRoster = persistenceRepo.upsertParticipants(examLegacyAfterPublishSpec.gameId, [
      {
        fullName: 'Thí Sinh After Publish',
        departmentUnit: 'Phòng Hạ Tầng',
        employeeCode: 'PUB01',
        allowedAttempts: 2,
      },
    ]);
    const pubParticipantId = pubRoster[0].participantId;

    const createRes = await supertest(app)
      .post('/api/games/sessions')
      .send({
        gameId: examLegacyAfterPublishSpec.gameId,
        participantId: pubParticipantId,
        playerName: 'Thí Sinh After Publish',
        publicPlay: true,
      })
      .expect(200);
    const sessionId = createRes.body.data.sessionId;
    const pToken = createRes.body.data.lockToken;

    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // Answer Q1 -> redacted
    const ans1 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'pub_q1', answer: 'TCP' })
      .expect(200);
    assert.equal(ans1.body.data.examAnswerRecorded, true);
    assert.equal(ans1.body.data.examAnswerRevealPolicy, 'AFTER_PUBLISH');
    assert.equal(ans1.body.data.correctAnswer, undefined);

    // Finish session -> STILL redacted because policy is AFTER_PUBLISH and answersPublished is false
    const finishRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(finishRes.body.data.finished, true);
    assert.equal(finishRes.body.data.result.examAnswerRevealPolicy, 'AFTER_PUBLISH');
    assert.equal(finishRes.body.data.result.canRevealAnswers, false);
    assert.equal(
      finishRes.body.data.result.questionResults[0].correctAnswer,
      '[Đáp án sẽ được công bố sau khi kết thúc kỳ thi]'
    );
    assert.equal(finishRes.body.data.result.questionResults[0].isCorrect, null);

    // Historical Session Snapshot Protection:
    // Even if creator later edits the game to PLAY mode without publishing answers, the earlier EXAM session snapshot remains AFTER_PUBLISH until answersPublished is true
    await supertest(app)
      .patch(`/api/games/${examLegacyAfterPublishSpec.gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: examLegacyAfterPublishSpec.questions,
        settings: { sessionMode: 'PLAY' },
      })
      .expect(200);

    const checkStillRedacted = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(checkStillRedacted.body.data.sessionMode, 'EXAM');
    assert.equal(checkStillRedacted.body.data.examAnswerRevealPolicy, 'AFTER_PUBLISH');
    assert.equal(checkStillRedacted.body.data.canRevealAnswers, false);

    // Switch back to EXAM and creator publishes answers -> now candidate can see full answers!
    await supertest(app)
      .patch(`/api/games/${examLegacyAfterPublishSpec.gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: examLegacyAfterPublishSpec.questions,
        settings: { sessionMode: 'EXAM', examAnswerRevealPolicy: 'AFTER_PUBLISH' },
      })
      .expect(200);

    await supertest(app)
      .post(`/api/games/${examLegacyAfterPublishSpec.gameId}/publish-answers`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ published: true })
      .expect(200);

    const checkPublished = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(checkPublished.body.data.canRevealAnswers, true);
    assert.equal(checkPublished.body.data.questionResults[0].correctAnswer, 'TCP');
    assert.equal(checkPublished.body.data.questionResults[0].isCorrect, true);
    assert.equal(
      checkPublished.body.data.questionResults[0].explanation,
      'TCP và UDP là hai giao thức chính ở tầng Transport (Layer 4).'
    );
  });

  it('5. Discover & Library sessionMode badges, Library Edit Mode switching, and Clone (Sao chép) all 8 criteria + EXAM_ANSWERS_LOCKED security guard', async () => {
    // 1) Verify GET /api/games?scope=public returns persisted sessionMode ('PLAY' | 'EXAM')
    const listRes = await supertest(app).get('/api/games?scope=public').expect(200);
    const gamesList: any[] = listRes.body.data.games;
    const playGameItem = gamesList.find((g) => g.gameId === 'game_v3_play_multitype');
    const examImmediateItem = gamesList.find((g) => g.gameId === 'game_v3_exam_immediate');
    assert.ok(playGameItem, 'PLAY game must be in list');
    assert.equal(playGameItem.sessionMode, 'PLAY');
    assert.ok(examImmediateItem, 'EXAM game must be in list');
    assert.equal(examImmediateItem.sessionMode, 'EXAM');

    // 2) Security guard on Clone: Non-owner trying to clone an unpublished-answers EXAM game is blocked with 403 EXAM_ANSWERS_LOCKED
    const blockedClone = await supertest(app)
      .post('/api/games/game_v3_exam_immediate/duplicate')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .expect(403);
    assert.equal(blockedClone.body.error.code, 'EXAM_ANSWERS_LOCKED');

    // 3) Owner cloning their own EXAM game succeeds and resets answersPublished=false & examStatus='OPEN'
    const ownerCloneExam = await supertest(app)
      .post('/api/games/game_v3_exam_after_publish/duplicate')
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(201);
    assert.notEqual(ownerCloneExam.body.data.gameId, 'game_v3_exam_after_publish');
    assert.equal(ownerCloneExam.body.data.ownerUserId, creatorUser.userId);
    assert.equal(ownerCloneExam.body.data.isPublic, false);
    assert.equal(ownerCloneExam.body.data.settings.sessionMode, 'EXAM');
    assert.equal(ownerCloneExam.body.data.settings.answersPublished, false);
    assert.equal(ownerCloneExam.body.data.settings.examStatus, 'OPEN');

    // 4) Other user cloning a public PLAY game from Discover: verify all 8 Clone criteria
    const clonePlayRes = await supertest(app)
      .post('/api/games/game_v3_play_multitype/duplicate')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .expect(201);
    const clonedGame = clonePlayRes.body.data;
    // Criterion 1 & 3: New gameId, owned by the user who clicked Clone, saved as draft (isPublic=false)
    assert.notEqual(clonedGame.gameId, 'game_v3_play_multitype');
    assert.equal(clonedGame.ownerUserId, otherUser.userId);
    assert.equal(clonedGame.isPublic, false);
    // Criterion 2: Preserves questions, choices, correctAnswer, explanation, points, timeLimitSeconds, gameType, sessionMode
    assert.equal(clonedGame.gameType, 'MIXED');
    assert.equal(clonedGame.questions.length, 6);
    assert.equal(clonedGame.questions[0].question, 'Câu 1: Thủ đô của Việt Nam là gì?');
    assert.equal(clonedGame.questions[0].correctAnswer, 'A. Hà Nội');
    assert.equal(
      clonedGame.questions[0].explanation,
      'Hà Nội là thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.'
    );
    assert.equal(clonedGame.settings.sessionMode, 'PLAY');

    // Criterion 5 & 6: Appears in otherUser's Library and can be edited (switching PLAY -> EXAM + AFTER_SUBMIT) without affecting original game
    const myLibRes = await supertest(app)
      .get('/api/games?scope=mine')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .expect(200);
    assert.ok(myLibRes.body.data.games.some((g: any) => g.gameId === clonedGame.gameId));

    const updatedQuestions = clonedGame.questions.map((q: any, idx: number) =>
      idx === 0 ? { ...q, question: 'Câu 1 (Bản sao đã chỉnh sửa): Thủ đô Việt Nam?' } : q
    );
    const editCloneRes = await supertest(app)
      .patch(`/api/games/${clonedGame.gameId}`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({
        title: 'Bản Sao Chuyển Sang Chế Độ THI',
        questions: updatedQuestions,
        settings: {
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_SUBMIT',
        },
      })
      .expect(200);
    assert.equal(editCloneRes.body.data.settings.sessionMode, 'EXAM');
    assert.equal(editCloneRes.body.data.settings.examAnswerRevealPolicy, 'AFTER_SUBMIT');

    // Criterion 7 & 8: Original game is completely untouched and has no copied session history/leaderboard
    const origGameRes = await supertest(app)
      .get('/api/games/game_v3_play_multitype?mode=manage')
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);
    assert.equal(origGameRes.body.data.title, 'Bộ đề Chơi (PLAY) Đa Dạng Câu Hỏi');
    assert.equal(origGameRes.body.data.settings.sessionMode, 'PLAY');
    assert.equal(origGameRes.body.data.questions[0].question, 'Câu 1: Thủ đô của Việt Nam là gì?');
  });

  it('6. Real Browser E2E (1440x900, 390x844, 360x800): Create Game EXAM 3 policies, Discover/Library badges & Edit mode, Clone flow, Solo PLAY green/red feedback & Solo EXAM AFTER_SUBMIT review', async () => {
    const browser = await Browser.launch({ width: 1440, height: 900 });
    const page = await browser.newPage({ width: 1440, height: 900 });
    try {
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.goto(`${baseUrl}/`, { settleMs: 600 });
      await page.eval(`
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(creatorToken)});
      `);

      // A. Verify Create Game (/?tab=demo) shows CHƠI / THI and the 3 EXAM reveal policy options when THI is selected
      await page.goto(`${baseUrl}/?tab=demo`, { settleMs: 900 });
      await page.eval(`
        (() => {
          const modeSelect = document.querySelector('[data-testid="session-mode-select"]');
          if (modeSelect) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(modeSelect, 'EXAM');
            modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await sleep(400);

      const createPolicyCheck = await page.eval(`
        (() => {
          const sel = document.querySelector('[data-testid="exam-answer-reveal-policy-select"]');
          if (!sel) return { exists: false, options: [] };
          const options = Array.from(sel.querySelectorAll('option')).map((o) => ({
            value: o.value,
            label: (o.textContent || '').trim(),
          }));
          return { exists: true, value: sel.value, options };
        })()
      `);
      assert.equal(
        createPolicyCheck.exists,
        true,
        'Create page must render exam-answer-reveal-policy-select when THI is active'
      );
      assert.deepEqual(
        createPolicyCheck.options.map((o: any) => o.value),
        ['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_PUBLISH']
      );
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_mode_create_exam_policy.png'),
        await page.screenshot()
      );

      // B. Verify Discover (/?tab=discover) & Library (/?tab=library) show CHƠI / THI badges
      await page.goto(`${baseUrl}/?tab=discover`, { settleMs: 900 });
      const discoverBadges = await page.eval(`
        (() => {
          const playBadge = document.querySelector('[data-testid="discover-mode-badge-game_v3_play_multitype"]');
          const examBadge = document.querySelector('[data-testid="discover-mode-badge-game_v3_exam_immediate"]');
          const cloneBtn = document.querySelector('[data-testid="discover-card-duplicate-btn-game_v3_play_multitype"]');
          return {
            playBadgeText: playBadge ? playBadge.textContent.trim() : null,
            examBadgeText: examBadge ? examBadge.textContent.trim() : null,
            hasCloneBtn: Boolean(cloneBtn),
          };
        })()
      `);
      assert.ok(
        discoverBadges.playBadgeText?.includes('CHƠI'),
        `Discover PLAY card must show CHƠI badge, got ${discoverBadges.playBadgeText}`
      );
      assert.ok(
        discoverBadges.examBadgeText?.includes('THI'),
        `Discover EXAM card must show THI badge, got ${discoverBadges.examBadgeText}`
      );
      assert.equal(discoverBadges.hasCloneBtn, true, 'Discover card must have Sao chép button');

      await page.goto(`${baseUrl}/?tab=library`, { settleMs: 900 });
      const libraryBadges = await page.eval(`
        (() => {
          const playBadge = document.querySelector('[data-testid="library-mode-badge-game_v3_play_multitype"]');
          const examBadge = document.querySelector('[data-testid="library-mode-badge-game_v3_exam_immediate"]');
          return {
            playBadgeText: playBadge ? playBadge.textContent.trim() : null,
            examBadgeText: examBadge ? examBadge.textContent.trim() : null,
          };
        })()
      `);
      assert.ok(
        libraryBadges.playBadgeText?.includes('CHƠI'),
        `Library PLAY card must show CHƠI badge, got ${libraryBadges.playBadgeText}`
      );
      assert.ok(
        libraryBadges.examBadgeText?.includes('THI'),
        `Library EXAM card must show THI badge, got ${libraryBadges.examBadgeText}`
      );
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_mode_discover_library_badges.png'),
        await page.screenshot()
      );

      // C. Verify Solo PLAY mode green/red choice highlighting & explanation in real browser
      await page.goto(`${baseUrl}/?play=game_v3_play_multitype`, { settleMs: 900 });

      // Enter free-text player name and click start
      await page.eval(`
        (() => {
          const nameInput = document.querySelector('[data-testid="solo-free-name-input"]');
          if (nameInput) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(nameInput, 'Người Chơi Browser E2E');
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const startBtn = document.querySelector('[data-testid="solo-free-start-btn"]');
          if (startBtn) startBtn.click();
        })()
      `);
      await sleep(800);

      // Select wrong choice (index 1: 'B. Đà Nẵng') -> submits immediately
      await page.eval(`
        (() => {
          const wrongChoice = document.querySelector('[data-testid="solo-choice-btn-1"]');
          if (wrongChoice) wrongChoice.click();
        })()
      `);
      await sleep(700);

      const playFeedbackDom = await page.eval(`
        (() => {
          const feedbackBox = document.querySelector('[data-testid="solo-question-feedback"]');
          const correctOpt = document.querySelector('[data-testid="solo-choice-feedback-correct-0"]');
          const wrongOpt = document.querySelector('[data-testid="solo-choice-feedback-wrong-1"]');
          const expl = document.querySelector('[data-testid="solo-feedback-explanation"]');
          return {
            hasFeedbackBox: Boolean(feedbackBox),
            feedbackText: feedbackBox ? feedbackBox.textContent : '',
            correctOptState: correctOpt ? correctOpt.getAttribute('data-feedback-state') : null,
            wrongOptState: wrongOpt ? wrongOpt.getAttribute('data-feedback-state') : null,
            explanationText: expl ? expl.textContent : null,
          };
        })()
      `);
      assert.equal(playFeedbackDom.hasFeedbackBox, true);
      assert.equal(
        playFeedbackDom.correctOptState,
        'correct',
        'Correct choice must have data-feedback-state="correct" (green)'
      );
      assert.equal(
        playFeedbackDom.wrongOptState,
        'wrong',
        'Selected wrong choice must have data-feedback-state="wrong" (red)'
      );
      assert.ok(
        playFeedbackDom.explanationText?.includes('Hà Nội là thủ đô'),
        'Explanation must be displayed when non-empty'
      );
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_mode_play_feedback_highlight.png'),
        await page.screenshot()
      );

      // D. Verify Solo EXAM mode with AFTER_SUBMIT policy in real browser:
      // Redacted during question, then full per-question review rendered immediately after submitting!
      await page.goto(`${baseUrl}/?play=game_v3_exam_after_submit`, { settleMs: 900 });

      // Select 'Thí Sinh After Submit Browser' from roster gate and confirm identity
      await page.eval(`
        (() => {
          const availableBtns = Array.from(
            document.querySelectorAll('[data-testid^="roster-participant-option-"]')
          ).filter((b) => !b.disabled);
          const targetBtn =
            availableBtns.find((b) => (b.textContent || '').includes('Browser')) ||
            availableBtns[availableBtns.length - 1];
          if (targetBtn) targetBtn.click();
        })()
      `);
      await sleep(250);
      await page.eval(`
        (() => {
          const confirmBtn = document.querySelector('[data-testid="confirm-participant-identity-btn"]');
          if (confirmBtn) confirmBtn.click();
        })()
      `);
      await sleep(800);

      // Q1: choose option 0 -> submits immediately
      await page.eval(`
        (() => {
          const btn0 = document.querySelector('[data-testid="solo-choice-btn-0"]');
          if (btn0) btn0.click();
        })()
      `);
      await sleep(500);

      // During exam, AFTER_SUBMIT must show neutral recorded state and NOT reveal correct/wrong choice highlights
      const duringExamDom = await page.eval(`
        (() => {
          const fb = document.querySelector('[data-testid="solo-question-feedback"]');
          const grid = document.querySelector('[data-testid="solo-feedback-choices-grid"]');
          return {
            text: fb ? fb.textContent : '',
            hasChoicesHighlightGrid: Boolean(grid),
          };
        })()
      `);
      assert.ok(
        duringExamDom.text.includes('Đã ghi nhận câu trả lời'),
        `Expected neutral exam message during AFTER_SUBMIT, got "${duringExamDom.text}"`
      );
      assert.equal(duringExamDom.hasChoicesHighlightGrid, false);

      // Click Next to go to Q2 (or wait if auto-advanced)
      await page.eval(`
        (() => {
          const nextBtn = document.querySelector('[data-testid="solo-next-question-btn"]');
          if (nextBtn) nextBtn.click();
        })()
      `);
      await sleep(600);

      // Q2: choose option 1 (wrong) -> submits immediately
      await page.eval(`
        (() => {
          const btn1 = document.querySelector('[data-testid="solo-choice-btn-1"]');
          if (btn1) btn1.click();
        })()
      `);
      await sleep(500);

      // Click Finish ("Tiếp Tục — Xem Kết Quả")
      await page.eval(`
        (() => {
          const finishBtn = document.querySelector('[data-testid="solo-next-question-btn"]');
          if (finishBtn) finishBtn.click();
        })()
      `);
      await sleep(900);

      const afterSubmitReviewDom = await page.eval(`
        (() => {
          const reviewSection = document.querySelector('[data-testid="solo-result-question-review"]');
          const item0 = document.querySelector('[data-testid="solo-result-review-item-0"]');
          const item1 = document.querySelector('[data-testid="solo-result-review-item-1"]');
          return {
            hasReviewSection: Boolean(reviewSection),
            reviewText: reviewSection ? reviewSection.textContent : '',
            hasItem0: Boolean(item0),
            hasItem1: Boolean(item1),
          };
        })()
      `);
      assert.equal(
        afterSubmitReviewDom.hasReviewSection,
        true,
        'AFTER_SUBMIT must render solo-result-question-review immediately after finishing'
      );
      assert.equal(afterSubmitReviewDom.hasItem0, true);
      assert.equal(afterSubmitReviewDom.hasItem1, true);
      assert.ok(afterSubmitReviewDom.reviewText.includes('Structured Query Language'));
      assert.ok(afterSubmitReviewDom.reviewText.includes('SELECT / Truy vấn'));
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_mode_exam_after_submit_review.png'),
        await page.screenshot()
      );

      // E. Mobile responsiveness checks at 390x844 and 360x800
      for (const vp of [
        { width: 390, height: 844, file: 'v3_mode_mobile_390x844.png' },
        { width: 360, height: 800, file: 'v3_mode_mobile_360x800.png' },
      ]) {
        await page.setViewport({ width: vp.width, height: vp.height, mobile: true });
        await sleep(400);
        const overflowCheck = await page.eval(`
          (() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          }))()
        `);
        assert.ok(
          overflowCheck.scrollWidth <= overflowCheck.innerWidth + 2,
          `Mobile viewport ${vp.width}x${vp.height} must not overflow horizontally (${overflowCheck.scrollWidth} > ${overflowCheck.innerWidth})`
        );
        fs.writeFileSync(path.join(ARTIFACT_DIR, vp.file), await page.screenshot());
      }
    } finally {
      await browser.close();
    }
  });
});
