import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import supertest from 'supertest';
import { WebSocket } from 'ws';
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
  sourceId: 'src_v3_play_hide_answers',
  sourceType: 'TXT' as const,
  sourceLocation: 'play_hide_answers.txt',
};

const DEFAULT_SOURCE_SUMMARY = {
  sourceCount: 1,
  sources: [
    {
      sourceId: 'src_v3_play_hide_answers',
      sourceType: 'TXT' as const,
      sourceName: 'play_hide_answers.txt',
      sourceLocation: 'play_hide_answers.txt',
    },
  ],
};

describe('V3 PLAY MODE — HIDE POST-GAME CORRECT ANSWERS (12 TEST CASES + REAL BROWSER E2E)', () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let baseUrl = '';
  let wsBaseUrl = '';

  let creatorToken = '';
  let creatorUser: { userId: string; email: string; displayName: string };
  let playerToken = '';
  let playerUser: { userId: string; email: string; displayName: string };

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_game_v3_play_hide_'));
    tempDbPath = path.join(tempDir, 'test_v3_play_hide_answers.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();

    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsBaseUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const cReg = authService.register({
      email: 'creator.play.hide@matbao.test',
      password: 'Password123!',
      displayName: 'Creator Play Hide',
    });
    creatorToken = cReg.token;
    creatorUser = cReg.user;

    const pReg = authService.register({
      email: 'player.play.hide@matbao.test',
      password: 'Password123!',
      displayName: 'Player Play Hide',
    });
    playerToken = pReg.token;
    playerUser = pReg.user;
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
      // ignore
    }
  });

  it('TC1, TC2, TC3, TC4, TC7, TC8: PLAY in-game feedback (correct, wrong, timeout) preserved, and completed PLAY summary/refresh/history hides correctAnswer & explanation', async () => {
    const playGameSpec: GameSpecification = {
      gameId: 'game_play_hide_tc1_tc4',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Game Chơi Thử Nghiệm Ẩn Đáp Án Cuối Trận',
      description: 'Kiểm tra TC1, TC2, TC3, TC4, TC7, TC8',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: 'q1_mc',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 1: Thủ đô của Nhật Bản là gì?',
          choices: ['Osaka', 'Tokyo', 'Kyoto', 'Nagoya'],
          correctAnswer: 'Tokyo',
          explanation: 'Tokyo là thủ đô chính thức của Nhật Bản.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q2_mc',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 2: Giao thức truyền siêu văn bản bảo mật là gì?',
          choices: ['HTTP', 'FTP', 'HTTPS', 'SMTP'],
          correctAnswer: 'HTTPS',
          explanation: 'HTTPS mã hóa kết nối bằng TLS/SSL.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'q3_mc',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu 3: Hệ quản trị cơ sở dữ liệu nhúng gọn nhẹ?',
          choices: ['SQLite', 'Oracle', 'DB2', 'Informix'],
          correctAnswer: 'SQLite',
          explanation: 'SQLite lưu toàn bộ dữ liệu trong một file duy nhất.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 20,
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
      settings: {
        questionCount: 3,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'PLAY',
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(playGameSpec, Date.now(), creatorUser.userId, true);

    const createRes = await supertest(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        gameId: playGameSpec.gameId,
        playerName: 'Người Chơi TC1-4',
        departmentUnit: 'Phòng Kỹ Thuật',
        publicPlay: true,
      })
      .expect(200);

    const sessionId = createRes.body.data.sessionId;
    const pToken = createRes.body.data.lockToken;

    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // TC1: PLAY trả lời đúng -> giữ phản hồi xanh, có correctAnswer & explanation trong lượt chơi
    const ans1 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q1_mc', answer: 'Tokyo' })
      .expect(200);
    assert.equal(ans1.body.data.isCorrect, true);
    assert.equal(ans1.body.data.pointsEarned, 100);
    assert.equal(ans1.body.data.correctAnswer, 'Tokyo');
    assert.equal(ans1.body.data.explanation, 'Tokyo là thủ đô chính thức của Nhật Bản.');

    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // TC2: PLAY trả lời sai -> giữ phản hồi đỏ/xanh, có correctAnswer & explanation trong lượt chơi
    const ans2 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q2_mc', answer: 'HTTP' })
      .expect(200);
    assert.equal(ans2.body.data.isCorrect, false);
    assert.equal(ans2.body.data.pointsEarned, 0);
    assert.equal(ans2.body.data.correctAnswer, 'HTTPS');
    assert.equal(ans2.body.data.explanation, 'HTTPS mã hóa kết nối bằng TLS/SSL.');

    await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);

    // TC3: PLAY hết giờ -> giữ hành vi hiện tại trong lượt chơi
    const timeout3 = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/timeout`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .send({ questionId: 'q3_mc' })
      .expect(200);
    assert.equal(timeout3.body.data.isCorrect, false);
    assert.equal(timeout3.body.data.pointsEarned, 0);
    assert.equal(timeout3.body.data.timedOut, true);
    assert.equal(timeout3.body.data.correctAnswer, 'SQLite');
    assert.equal(timeout3.body.data.explanation, 'SQLite lưu toàn bộ dữ liệu trong một file duy nhất.');

    // TC4: PLAY hoàn thành -> tổng kết có điểm (100), đúng (1), sai (2), KHÔNG có đáp án đúng và giải thích
    const finishRes = await supertest(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(finishRes.body.data.finished, true);
    const finResult = finishRes.body.data.result;
    assert.equal(finResult.sessionMode, 'PLAY');
    assert.equal(finResult.canRevealAnswers, false);
    assert.equal(finResult.score, 100);
    assert.equal(finResult.correctCount, 1);
    assert.equal(finResult.wrongCount, 2);
    assert.equal(finResult.totalQuestions, 3);
    for (const qr of finResult.questionResults) {
      assert.equal(qr.correctAnswer, undefined, 'Post-game PLAY result must not include correctAnswer');
      assert.equal(qr.explanation, undefined, 'Post-game PLAY result must not include explanation');
    }

    // TC7 (API level): Refresh / GET /:sessionId/result -> không hiện lại đáp án đúng
    const getRes = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(getRes.body.data.sessionMode, 'PLAY');
    assert.equal(getRes.body.data.canRevealAnswers, false);
    assert.equal(getRes.body.data.score, 100);
    assert.equal(getRes.body.data.correctCount, 1);
    assert.equal(getRes.body.data.wrongCount, 2);
    for (const qr of getRes.body.data.questionResults) {
      assert.equal(qr.correctAnswer, undefined, 'GET /result in PLAY mode must not expose correctAnswer');
      assert.equal(qr.explanation, undefined, 'GET /result in PLAY mode must not expose explanation');
    }

    // Also test SQLite persisted fallback when session is evicted from in-memory sessionStore
    sessionStore.delete(sessionId);
    const getPersistedRes = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    assert.equal(getPersistedRes.body.data.sessionMode, 'PLAY');
    assert.equal(getPersistedRes.body.data.canRevealAnswers, false);
    assert.equal(getPersistedRes.body.data.score, 100);
    for (const qr of getPersistedRes.body.data.questionResults) {
      assert.equal(qr.correctAnswer, undefined, 'Persisted GET /result in PLAY mode must not expose correctAnswer');
      assert.equal(qr.explanation, undefined, 'Persisted GET /result in PLAY mode must not expose explanation');
    }

    // TC8: Mở lịch sử phiên PLAY (GET /api/history/sessions & GET /api/analytics/learning) -> không lộ đáp án đúng cho người chơi
    const histRes = await supertest(app)
      .get('/api/history/sessions')
      .set('Authorization', `Bearer ${playerToken}`)
      .expect(200);
    const mySessions = Array.isArray(histRes.body.data)
      ? histRes.body.data
      : histRes.body.data.sessions || [];
    const foundSession = mySessions.find((s: any) => s.sessionId === sessionId);
    assert.ok(foundSession, 'Player session should be recorded in history');
    for (const qr of foundSession.questionResults || []) {
      assert.equal(qr.correctAnswer, undefined, 'History session record in PLAY mode must not expose correctAnswer');
      assert.equal(qr.explanation, undefined, 'History session record in PLAY mode must not expose explanation');
    }

    // Also verify player exporting their own PLAY session does not leak correctAnswer/explanation
    const expJsonRes = await supertest(app)
      .get(`/api/games/sessions/${sessionId}/export?format=json`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken)
      .expect(200);
    const expJson = JSON.parse(expJsonRes.text);
    for (const qr of expJson.questionResults || []) {
      assert.equal(qr.correctAnswer, '');
      assert.equal(qr.explanation, '');
    }
  });

  it('TC5 & TC6: PLAY kết thúc giữa chừng & Creator kết thúc phiên từ Thư viện -> tổng kết không có đáp án đúng', async () => {
    // TC5: Session ended midway -> result shows score summary without correct answers
    const s5Create = await supertest(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${playerToken}`)
      .send({
        gameId: 'game_play_hide_tc1_tc4',
        playerName: 'Người Chơi Giữa Chừng TC5',
        publicPlay: true,
      })
      .expect(200);
    const sid5 = s5Create.body.data.sessionId;
    const pToken5 = s5Create.body.data.lockToken;

    await supertest(app)
      .post(`/api/games/sessions/${sid5}/start`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken5)
      .expect(200);

    // Answer Q1 only
    await supertest(app)
      .post(`/api/games/sessions/${sid5}/answer`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken5)
      .send({ questionId: 'q1_mc', answer: 'Tokyo' })
      .expect(200);

    // End session midway
    const end5 = await supertest(app)
      .post(`/api/games/sessions/${sid5}/end`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);
    assert.equal(end5.body.data.session.state, 'ABANDONED');
    assert.equal(end5.body.data.session.correctAnswer, undefined);

    // Fetch result of midway-ended PLAY session -> returns summary score without correctAnswer/explanation
    const res5 = await supertest(app)
      .get(`/api/games/sessions/${sid5}/result`)
      .set('Authorization', `Bearer ${playerToken}`)
      .set('X-Participant-Token', pToken5)
      .expect(200);
    assert.equal(res5.body.data.canRevealAnswers, false);
    assert.equal(res5.body.data.score, 100);
    for (const qr of res5.body.data.questionResults || []) {
      assert.equal(qr.correctAnswer, undefined);
      assert.equal(qr.explanation, undefined);
    }

    // TC6: Creator ends anonymous/guest PLAY session from Library while player is midway
    const s6Create = await supertest(app)
      .post('/api/games/sessions')
      .send({
        gameId: 'game_play_hide_tc1_tc4',
        playerName: 'Người Chơi Bị Creator Đóng TC6',
        publicPlay: true,
      })
      .expect(200);
    const sid6 = s6Create.body.data.sessionId;
    const pToken6 = s6Create.body.data.lockToken;

    await supertest(app)
      .post(`/api/games/sessions/${sid6}/start`)
      .set('X-Participant-Token', pToken6)
      .expect(200);

    await supertest(app)
      .post(`/api/games/sessions/${sid6}/answer`)
      .set('X-Participant-Token', pToken6)
      .send({ questionId: 'q1_mc', answer: 'Tokyo' })
      .expect(200);
    await supertest(app)
      .post(`/api/games/sessions/${sid6}/next`)
      .set('X-Participant-Token', pToken6)
      .expect(200);

    // Creator ends session from Library using Bearer token (no participant lockToken needed)
    const creatorEndRes = await supertest(app)
      .post(`/api/games/sessions/${sid6}/end`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);
    assert.equal(creatorEndRes.body.data.session.state, 'ABANDONED');

    // Player fetches result after Creator ended session -> no correct answers leaked
    const res6 = await supertest(app)
      .get(`/api/games/sessions/${sid6}/result`)
      .set('X-Participant-Token', pToken6)
      .expect(200);
    assert.equal(res6.body.data.canRevealAnswers, false);
    assert.equal(res6.body.data.score, 100);
    for (const qr of res6.body.data.questionResults || []) {
      assert.equal(qr.correctAnswer, undefined);
      assert.equal(qr.explanation, undefined);
    }
  });

  it('TC9 & TC12: EXAM với cả 3 chính sách công bố đáp án giữ nguyên hành vi; Creator vẫn quản lý và sửa đáp án của game mình tạo như cũ', async () => {
    const policies = ['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_PUBLISH'] as const;

    for (const policy of policies) {
      const examGameId = `game_exam_policy_${policy.toLowerCase()}`;
      const examSpec: GameSpecification = {
        gameId: examGameId,
        ownerUserId: creatorUser.userId,
        isPublic: true,
        title: `Đề Thi ${policy}`,
        description: `Kiểm tra chính sách ${policy}`,
        gameType: 'MULTIPLE_CHOICE',
        questions: [
          {
            id: 'ex_q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi kỳ thi: 2 + 2 bằng mấy?',
            choices: ['3', '4', '5', '6'],
            correctAnswer: '4',
            explanation: '2 cộng 2 bằng 4.',
            difficulty: 'EASY',
            points: 100,
            timeLimitSeconds: 20,
            sourceReference: DEFAULT_SOURCE_REF,
          },
        ],
        settings: {
          questionCount: 1,
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: policy,
          rosterMode: 'PRECONFIGURED',
        },
        sourceSummary: DEFAULT_SOURCE_SUMMARY,
        generatedAt: new Date().toISOString(),
      };
      gameStore.save(examSpec, Date.now(), creatorUser.userId, true);

      // Seed roster participants for EXAM mode
      const imported = persistenceRepo.upsertParticipants(examGameId, [
        { fullName: `Thí Sinh ${policy}`, departmentUnit: 'Khối Thi', employeeCode: `EX1_${policy}`, allowedAttempts: 2 },
        { fullName: `Thí Sinh Browser ${policy}`, departmentUnit: 'Khối Thi', employeeCode: `EX2_${policy}`, allowedAttempts: 2 },
      ]);
      const participantId = imported[0].participantId;

      const createExam = await supertest(app)
        .post('/api/games/sessions')
        .send({
          gameId: examGameId,
          participantId,
          playerName: `Thí Sinh ${policy}`,
          departmentUnit: 'Khối Thi',
          publicPlay: true,
        })
        .expect(200);
      const exSid = createExam.body.data.sessionId;
      const exToken = createExam.body.data.lockToken;

      await supertest(app)
        .post(`/api/games/sessions/${exSid}/start`)
        .set('X-Participant-Token', exToken)
        .expect(200);

      const ansExam = await supertest(app)
        .post(`/api/games/sessions/${exSid}/answer`)
        .set('X-Participant-Token', exToken)
        .send({ questionId: 'ex_q1', answer: '4' })
        .expect(200);

      if (policy === 'IMMEDIATE') {
        assert.equal(ansExam.body.data.examAnswerRevealPolicy, 'IMMEDIATE');
        assert.equal(ansExam.body.data.isCorrect, true);
        assert.equal(ansExam.body.data.correctAnswer, '4');
      } else {
        assert.equal(ansExam.body.data.examAnswerRecorded, true);
        assert.equal(ansExam.body.data.correctAnswer, undefined);
      }

      const finExam = await supertest(app)
        .post(`/api/games/sessions/${exSid}/next`)
        .set('X-Participant-Token', exToken)
        .expect(200);
      assert.equal(finExam.body.data.finished, true);

      if (policy === 'IMMEDIATE' || policy === 'AFTER_SUBMIT') {
        assert.equal(finExam.body.data.result.canRevealAnswers, true);
        assert.equal(finExam.body.data.result.questionResults[0].correctAnswer, '4');
      } else {
        assert.equal(finExam.body.data.result.canRevealAnswers, false);
        assert.notEqual(finExam.body.data.result.questionResults[0].correctAnswer, '4');
      }
    }

    // TC12: Creator views and edits answers of their own PLAY game via GET /api/games/:gameId & PATCH /api/games/:gameId
    const creatorGetGame = await supertest(app)
      .get('/api/games/game_play_hide_tc1_tc4?mode=manage')
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);
    assert.equal(creatorGetGame.body.data.questions[0].correctAnswer, 'Tokyo');

    const updatedQuestions = [...creatorGetGame.body.data.questions];
    updatedQuestions[0] = {
      ...updatedQuestions[0],
      explanation: 'Tokyo là thủ đô và trung tâm kinh tế của Nhật Bản.',
    };

    const patchRes = await supertest(app)
      .patch('/api/games/game_play_hide_tc1_tc4')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ questions: updatedQuestions })
      .expect(200);
    assert.equal(
      patchRes.body.data.questions[0].explanation,
      'Tokyo là thủ đô và trung tâm kinh tế của Nhật Bản.'
    );
  });

  it('TC10: Multiplayer PLAY -> giữ phản hồi đúng/sai trong mỗi câu nhưng KHÔNG lộ danh sách đáp án đúng ở tổng kết sau khi kết thúc', async () => {
    const createRoomRes = await supertest(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        gameId: 'game_play_hide_tc1_tc4',
      })
      .expect(200);
    const roomCode = createRoomRes.body.data.roomCode;
    const hostToken = createRoomRes.body.data.hostToken;

    const hostWs = new WebSocket(wsBaseUrl);
    const playerWs = new WebSocket(wsBaseUrl);

    const playerMessages: any[] = [];
    playerWs.on('message', (raw) => {
      try {
        playerMessages.push(JSON.parse(String(raw)));
      } catch {
        // ignore
      }
    });

    await Promise.all([
      new Promise<void>((resolve) => hostWs.once('open', () => resolve())),
      new Promise<void>((resolve) => playerWs.once('open', () => resolve())),
    ]);

    hostWs.send(JSON.stringify({ type: 'host.join', roomCode, hostToken }));
    playerWs.send(
      JSON.stringify({
        type: 'player.join',
        roomCode,
        displayName: 'Multiplayer Player 1',
        departmentUnit: 'Phòng Sản Xuất',
      })
    );

    await new Promise((r) => setTimeout(r, 150));

    // Start Q1
    hostWs.send(JSON.stringify({ type: 'host.start' }));
    await new Promise((r) => setTimeout(r, 150));

    // Player answers Q1
    playerWs.send(
      JSON.stringify({
        type: 'player.answer',
        questionId: 'q1_mc',
        answer: 'Tokyo',
      })
    );
    await new Promise((r) => setTimeout(r, 150));

    // Since only 1 player is in the room, answering auto-reveals Q1 (`question.revealed`)
    const revealMsg = playerMessages.find((m) => m.type === 'question.revealed');
    assert.ok(revealMsg, 'Multiplayer PLAY must still emit question.revealed during gameplay');
    assert.equal(revealMsg.correctAnswer, 'Tokyo');

    // Advance Q2 -> Player answers Q2 -> Advance Q3 -> Player answers Q3 -> Advance to Finish
    hostWs.send(JSON.stringify({ type: 'host.next' }));
    await new Promise((r) => setTimeout(r, 120));
    playerWs.send(JSON.stringify({ type: 'player.answer', questionId: 'q2_mc', answer: 'HTTPS' }));
    await new Promise((r) => setTimeout(r, 120));

    hostWs.send(JSON.stringify({ type: 'host.next' }));
    await new Promise((r) => setTimeout(r, 120));
    playerWs.send(JSON.stringify({ type: 'player.answer', questionId: 'q3_mc', answer: 'SQLite' }));
    await new Promise((r) => setTimeout(r, 120));

    hostWs.send(JSON.stringify({ type: 'host.next' }));
    await new Promise((r) => setTimeout(r, 200));

    const finishMsg = playerMessages.find((m) => m.type === 'game.finished');
    assert.ok(finishMsg, 'Multiplayer room must emit game.finished');
    assert.equal(finishMsg.sessionMode, 'PLAY');
    assert.ok(Array.isArray(finishMsg.leaderboard), 'Must include leaderboard in PLAY finish');
    assert.equal(
      finishMsg.questions,
      undefined,
      'Multiplayer PLAY game.finished must NOT leak questions/correctAnswers list to players'
    );

    hostWs.close();
    playerWs.close();
  });

  it('Real Browser E2E (TC1–TC7, TC9, TC11): Solo PLAY, Creator End Midway, Refresh Result, Adventure 2D PLAY, and EXAM AFTER_SUBMIT in Chromium', async () => {
    const oneQPlaySpec: GameSpecification = {
      gameId: 'game_solo_play_browser_1q',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      title: 'Game Chơi Đơn 1 Câu Browser',
      description: 'Kiểm thử ẩn đáp án sau khi kết thúc chế độ CHƠI',
      gameType: 'MULTIPLE_CHOICE',
      questions: [
        {
          id: 'b_q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Thành phố cảng lớn của miền Bắc Việt Nam?',
          choices: ['Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Nha Trang'],
          correctAnswer: 'Hải Phòng',
          explanation: 'Hải Phòng là thành phố cảng quan trọng nhất miền Bắc.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 30,
          sourceReference: DEFAULT_SOURCE_REF,
        },
        {
          id: 'b_q2',
          type: 'MULTIPLE_CHOICE',
          question: 'Sông nào chảy qua thủ đô Hà Nội?',
          choices: ['Sông Hồng', 'Sông Hương', 'Sông Hàn', 'Sông Tiền'],
          correctAnswer: 'Sông Hồng',
          explanation: 'Sông Hồng là dòng sông chính chảy qua thủ đô Hà Nội.',
          difficulty: 'EASY',
          points: 100,
          timeLimitSeconds: 30,
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
      settings: {
        questionCount: 2,
        timePerQuestion: 30,
        scoringMode: 'STANDARD',
        sessionMode: 'PLAY',
        autoAdvanceDelayMs: 60000,
      },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
    };
    gameStore.save(oneQPlaySpec, Date.now(), creatorUser.userId, true);

    const browser = await Browser.launch({ width: 1440, height: 900 });
    const page = await browser.newPage({ width: 1440, height: 900 });
    try {
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.goto(`${baseUrl}/`, { settleMs: 600 });
      await page.eval(`
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(creatorToken)});
      `);

      // 1. Solo PLAY in Browser: Check in-game feedback (TC1/TC2) -> Finish (TC4) -> Refresh (TC7)
      await page.eval(`
        sessionStorage.setItem('solo_roster_identity_${oneQPlaySpec.gameId}', JSON.stringify({ playerName: 'Người Chơi Browser TC4', departmentUnit: 'Khối Kỹ Thuật' }));
      `);
      await page.goto(`${baseUrl}/?play=${oneQPlaySpec.gameId}`, { settleMs: 1200 });

      // Wait until solo-choice-btn-0 is rendered
      for (let i = 0; i < 20; i++) {
        const ready = await page.eval(`Boolean(document.querySelector('[data-testid="solo-choice-btn-0"]'))`);
        if (ready) break;
        await sleep(200);
      }

      // Click wrong choice index 0 ('Đà Nẵng') -> in-game feedback highlights wrong=red, correct=green ('Hải Phòng')
      await page.eval(`
        (() => {
          const btn0 = document.querySelector('[data-testid="solo-choice-btn-0"]');
          if (btn0) btn0.click();
        })()
      `);
      for (let i = 0; i < 20; i++) {
        const hasFb = await page.eval(`Boolean(document.querySelector('[data-testid="solo-question-feedback"]'))`);
        if (hasFb) break;
        await sleep(200);
      }

      const inGameDom = await page.eval(`
        (() => {
          const feedbackBox = document.querySelector('[data-testid="solo-question-feedback"]');
          const correctOpt = document.querySelector('[data-testid="solo-choice-feedback-correct-1"]');
          const wrongOpt = document.querySelector('[data-testid="solo-choice-feedback-wrong-0"]');
          const expl = document.querySelector('[data-testid="solo-feedback-explanation"]');
          return {
            hasFeedbackBox: Boolean(feedbackBox),
            correctState: correctOpt ? correctOpt.getAttribute('data-feedback-state') : null,
            wrongState: wrongOpt ? wrongOpt.getAttribute('data-feedback-state') : null,
            explanationText: expl ? expl.textContent : '',
            debugBody: document.body.innerText.slice(0, 600),
          };
        })()
      `);
      if (!inGameDom.hasFeedbackBox) {
        console.error('DEBUG inGameDom:', inGameDom);
      }
      assert.equal(inGameDom.hasFeedbackBox, true, 'In-game PLAY feedback must appear');
      assert.equal(inGameDom.correctState, 'correct', 'Correct choice must be highlighted green during turn');
      assert.equal(inGameDom.wrongState, 'wrong', 'Wrong choice must be highlighted red during turn');
      assert.ok(inGameDom.explanationText.includes('thành phố cảng quan trọng nhất miền Bắc'));

      // Click Next to go to Q2, answer Q2, then click Finish to enter PLAY summary screen
      await page.eval(`
        (() => {
          const nextBtn = document.querySelector('[data-testid="solo-next-question-btn"]');
          if (nextBtn) nextBtn.click();
        })()
      `);
      await sleep(700);
      await page.eval(`
        (() => {
          const btn0 = document.querySelector('[data-testid="solo-choice-btn-0"]');
          if (btn0) btn0.click();
        })()
      `);
      await sleep(700);
      await page.eval(`
        (() => {
          const nextBtn = document.querySelector('[data-testid="solo-next-question-btn"]');
          if (nextBtn) nextBtn.click();
        })()
      `);
      await sleep(900);

      const playFinishDom = await page.eval(`
        (() => {
          const reviewSection = document.querySelector('[data-testid="solo-result-question-review"]');
          const pendingBanner = document.querySelector('[data-testid="solo-result-answers-pending-publish"]');
          const replayBtn = document.querySelector('[data-testid="solo-replay-btn"]');
          const scoreRatio = document.querySelector('[data-testid="solo-result-score-ratio"]');
          const correctRatio = document.querySelector('[data-testid="solo-result-correct-ratio"]');
          const bodyText = document.body.innerText || '';
          return {
            hasReviewSection: Boolean(reviewSection),
            hasPendingBanner: Boolean(pendingBanner),
            hasReplayBtn: Boolean(replayBtn),
            containsCorrectAnswer: bodyText.includes('Hải Phòng'),
            containsExplanation: bodyText.includes('thành phố cảng quan trọng nhất miền Bắc'),
            containsScoreSummary: Boolean(scoreRatio && correctRatio),
          };
        })()
      `);
      assert.equal(playFinishDom.hasReplayBtn, true, 'Must reach PLAY finish screen');
      assert.equal(playFinishDom.hasReviewSection, false, 'PLAY finish screen must NOT render solo-result-question-review');
      assert.equal(playFinishDom.hasPendingBanner, false, 'PLAY finish screen must NOT render EXAM pending banner');
      assert.equal(playFinishDom.containsCorrectAnswer, false, 'PLAY finish screen DOM must NOT contain correctAnswer');
      assert.equal(playFinishDom.containsExplanation, false, 'PLAY finish screen DOM must NOT contain explanation');
      assert.equal(playFinishDom.containsScoreSummary, true, 'PLAY finish screen must display total score and correct count');

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_play_finish_hidden_answers_1440x900.png'),
        Buffer.from(await page.screenshot({ format: 'png' }), 'base64')
      );

      // 2. Creator ends PLAY session from Library while player is on Q1 -> Player transitions to summary without answers (TC6 Browser)
      await page.eval(`
        (() => {
          const replayBtn = document.querySelector('[data-testid="solo-replay-btn"]');
          if (replayBtn) replayBtn.click();
        })()
      `);
      await sleep(800);

      const activeSavedSessionId = await page.eval(`
        sessionStorage.getItem('active_solo_session_${oneQPlaySpec.gameId}')
      `);
      assert.ok(activeSavedSessionId, 'Active session ID must be stored in sessionStorage');

      // Creator ends session from Library via API
      await supertest(app)
        .post(`/api/games/sessions/${activeSavedSessionId}/end`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .expect(200);

      // Player clicks choice 0 -> catches abandoned session and displays summary without answers
      await page.eval(`
        (() => {
          const btn0 = document.querySelector('[data-testid="solo-choice-btn-0"]');
          if (btn0) btn0.click();
        })()
      `);
      await sleep(900);

      const afterCreatorEndDom = await page.eval(`
        (() => {
          const reviewSection = document.querySelector('[data-testid="solo-result-question-review"]');
          const bodyText = document.body.innerText || '';
          return {
            hasReviewSection: Boolean(reviewSection),
            containsCorrectAnswer: bodyText.includes('Hải Phòng'),
            containsExplanation: bodyText.includes('thành phố cảng quan trọng nhất miền Bắc'),
          };
        })()
      `);
      assert.equal(afterCreatorEndDom.hasReviewSection, false, 'Midway ended PLAY summary must not show review section');
      assert.equal(afterCreatorEndDom.containsCorrectAnswer, false, 'Midway ended PLAY summary must not leak correctAnswer');
      assert.equal(afterCreatorEndDom.containsExplanation, false, 'Midway ended PLAY summary must not leak explanation');

      // 3. EXAM AFTER_SUBMIT in Browser -> still shows solo-result-question-review (TC9 Browser)
      await page.goto(`${baseUrl}/?play=game_exam_policy_after_submit`, { settleMs: 900 });
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

      await page.eval(`
        (() => {
          const btn1 = document.querySelector('[data-testid="solo-choice-btn-1"]');
          if (btn1) btn1.click();
        })()
      `);
      await sleep(500);
      await page.eval(`
        (() => {
          const finishBtn = document.querySelector('[data-testid="solo-next-question-btn"]');
          if (finishBtn) finishBtn.click();
        })()
      `);
      await sleep(900);

      const examReviewDom = await page.eval(`
        (() => {
          const reviewSection = document.querySelector('[data-testid="solo-result-question-review"]');
          return {
            hasReviewSection: Boolean(reviewSection),
            text: reviewSection ? reviewSection.textContent : '',
          };
        })()
      `);
      assert.equal(examReviewDom.hasReviewSection, true, 'EXAM AFTER_SUBMIT must still render solo-result-question-review');
      assert.ok(examReviewDom.text.includes('2 cộng 2 bằng 4.'));
    } finally {
      await browser.close();
    }
  });
});
