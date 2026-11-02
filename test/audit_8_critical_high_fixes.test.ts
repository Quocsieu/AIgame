import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { app } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/storage/sqlite.db.js';
import { sourceStore } from '../src/storage/source.store.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { GameSpecificationSchema } from '../src/contracts/game.contract.js';

function saveTestGameSpec(
  rawSpec: {
    gameId: string;
    title: string;
    gameType: string;
    isPublic: boolean;
    settings: Record<string, any>;
    questions: Array<Record<string, any>>;
  },
  ownerUserId: string | null
) {
  const parsed = GameSpecificationSchema.parse({
    gameId: rawSpec.gameId,
    title: rawSpec.title,
    description: 'Regression test game specification',
    gameType: rawSpec.gameType,
    isPublic: rawSpec.isPublic,
    ownerUserId,
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_aud_test',
          sourceName: 'Tài liệu kiểm thử AUD',
          sourceType: 'TXT',
          sourceLocation: 'Mục 1',
        },
      ],
    },
    settings: {
      questionCount: rawSpec.questions.length,
      timePerQuestion: 20,
      scoringMode: 'STANDARD',
      sessionMode: 'PLAY',
      ...rawSpec.settings,
    },
    questions: rawSpec.questions.map((q) => ({
      difficulty: 'MEDIUM',
      explanation: 'Giải thích mặc định',
      sourceReference: {
        sourceId: 'src_aud_test',
        sourceType: 'TXT',
        sourceLocation: 'Mục 1',
      },
      ...q,
    })),
    generatedAt: new Date().toISOString(),
  });
  gameStore.save(parsed, Date.now(), ownerUserId, rawSpec.isPublic);
  return parsed;
}

describe('FINAL ACCEPTANCE AUDIT — Regression Suite for 8 Critical & High Priority Issues (AUD-001..006, AUD-013, AUD-016)', () => {
  let tempDir: string;
  let tempDbPath: string;
  let creatorAToken: string;
  let creatorAUserId: string;
  let creatorBToken: string;
  let creatorBUserId: string;
  let playerToken: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-aud8-test-'));
    tempDbPath = path.join(tempDir, 'test_platform.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();
    sourceStore.clear();
    gameStore.clear();
    sessionStore.clear();
    roomStore.clear();

    const regA = await request(app).post('/api/auth/register').send({
      email: 'creator_a_aud@example.com',
      password: 'Password123!',
      displayName: 'BTC Creator A',
    });
    assert.equal(regA.status, 201);
    creatorAToken = regA.body.data.token;
    creatorAUserId = regA.body.data.user.userId;

    const regB = await request(app).post('/api/auth/register').send({
      email: 'creator_b_aud@example.com',
      password: 'Password123!',
      displayName: 'BTC Creator B',
    });
    assert.equal(regB.status, 201);
    creatorBToken = regB.body.data.token;
    creatorBUserId = regB.body.data.user.userId;

    const regPlayer = await request(app).post('/api/auth/register').send({
      email: 'player_aud@example.com',
      password: 'Password123!',
      displayName: 'Player User',
      role: 'PLAYER',
    });
    assert.equal(regPlayer.status, 201);
    playerToken = regPlayer.body.data.token;
  });

  after(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it('AUD-001: Blocks unauthenticated, PLAYER, and cross-tenant access to /api/history/* and /api/games/:gameId/history, and never leaks legacy owner_user_id IS NULL records', async () => {
    resetAllRateLimiters();

    const gameId = 'aud001_game_1';
    saveTestGameSpec(
      {
        gameId,
        title: 'Game Bảo Mật Lịch Sử AUD-001',
        gameType: 'QUIZ',
        isPublic: true,
        settings: {
          questionCount: 2,
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'PLAY',
        },
        questions: [
          {
            id: 'q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu 1?',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
          },
          {
            id: 'q2',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu 2?',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswer: 'B',
          },
        ],
      },
      creatorAUserId
    );

    // Play a solo session as Creator A so history exists
    const sessRes = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ gameId });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ questionId: 'q1', answer: 'A' });
    await request(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ questionId: 'q2', answer: 'B' });
    await request(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${creatorAToken}`);

    // Play an anonymous session on an unowned legacy game (owner_user_id IS NULL) to verify it is never leaked in /api/history/sessions
    const legacyGameId = 'aud001_legacy_unowned_game';
    saveTestGameSpec(
      {
        gameId: legacyGameId,
        title: 'Game Legacy Không Chủ Sở Hữu',
        gameType: 'QUIZ',
        isPublic: true,
        settings: {
          questionCount: 1,
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'PLAY',
        },
        questions: [
          {
            id: 'lq1',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu legacy?',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
          },
        ],
      },
      null
    );
    const anonSessRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: legacyGameId, playerName: 'Khách Vãng Lai' });
    assert.equal(anonSessRes.status, 200);
    const anonSessionId = anonSessRes.body.data.sessionId;
    await request(app).post(`/api/games/sessions/${anonSessionId}/start`);
    await request(app)
      .post(`/api/games/sessions/${anonSessionId}/answer`)
      .send({ questionId: 'lq1', answer: 'A' });
    await request(app).post(`/api/games/sessions/${anonSessionId}/next`);

    // 1. Anonymous caller gets 401 on all history endpoints
    const anonEndpoints = [
      '/api/history/sessions',
      '/api/history/rooms',
      '/api/history/sources',
      '/api/history/activities',
      `/api/history/activities/solo:${sessionId}`,
      `/api/history/activities/solo:${sessionId}/export?format=csv`,
      `/api/games/${gameId}/history`,
    ];
    for (const ep of anonEndpoints) {
      const res = await request(app).get(ep);
      assert.equal(res.status, 401, `Expected 401 for anonymous GET ${ep}, got ${res.status}`);
    }

    // 2. Guest or Player token caller gets 403 on history endpoints
    const guestToken = 'gt_0123456789abcdef0123456789abcdef';
    const guestHistoryRes = await request(app)
      .get('/api/history/activities')
      .set('X-Guest-Token', guestToken);
    assert.equal(guestHistoryRes.status, 403);

    const playerHistoryRes = await request(app)
      .get('/api/history/activities')
      .set('X-Player-Token', 'ptok_room_player_123');
    assert.equal(playerHistoryRes.status, 403);

    const playerGameHistoryRes = await request(app)
      .get(`/api/games/${gameId}/history`)
      .set('X-Guest-Token', guestToken);
    assert.equal(playerGameHistoryRes.status, 403);

    // 3. Creator B cannot see Creator A's history or legacy NULL history
    const creatorBSessions = await request(app)
      .get('/api/history/sessions')
      .set('Authorization', `Bearer ${creatorBToken}`);
    assert.equal(creatorBSessions.status, 200);
    assert.equal(creatorBSessions.body.data.length, 0);

    const creatorBActivities = await request(app)
      .get('/api/history/activities')
      .set('Authorization', `Bearer ${creatorBToken}`);
    assert.equal(creatorBActivities.status, 200);
    assert.equal(creatorBActivities.body.data.items.length, 0);

    const creatorBDetail = await request(app)
      .get(`/api/history/activities/solo:${sessionId}`)
      .set('Authorization', `Bearer ${creatorBToken}`);
    assert.equal(creatorBDetail.status, 403);

    const creatorBGameHistory = await request(app)
      .get(`/api/games/${gameId}/history`)
      .set('Authorization', `Bearer ${creatorBToken}`);
    assert.equal(creatorBGameHistory.status, 403);

    // 4. Creator A sees their own session, and even Creator A does NOT get leaked owner_user_id IS NULL rows in /api/history/sessions
    const creatorASessions = await request(app)
      .get('/api/history/sessions')
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(creatorASessions.status, 200);
    assert.equal(
      creatorASessions.body.data.some((s: any) => s.sessionId === anonSessionId),
      false,
      'Must not leak owner_user_id IS NULL sessions in /api/history/sessions to non-admin users'
    );
  });

  it('AUD-002 & AUD-004: Redacts EXAM answers/isCorrect/pointsEarned across all endpoints before publish-answers, blocks export, and enforces X-Participant-Token against IDOR', async () => {
    resetAllRateLimiters();

    const examGameId = 'aud002_exam_game';
    saveTestGameSpec(
      {
        gameId: examGameId,
        title: 'Kỳ Thi Bảo Mật Đáp Án AUD-002',
        gameType: 'QUIZ',
        isPublic: true,
        settings: {
          questionCount: 2,
          timePerQuestion: 30,
          scoringMode: 'STANDARD',
          sessionMode: 'EXAM',
          answersPublished: false,
          rosterMode: 'PRECONFIGURED',
        },
        questions: [
          {
            id: 'exam_q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Thủ đô Việt Nam là gì?',
            choices: ['Hà Nội', 'Đà Nẵng', 'Huế', 'Cần Thơ'],
            correctAnswer: 'Hà Nội',
            explanation: 'Hà Nội là thủ đô của Việt Nam.',
          },
          {
            id: 'exam_q2',
            type: 'MULTIPLE_CHOICE',
            question: '2 + 2 bằng mấy?',
            choices: ['3', '4', '5', '6'],
            correctAnswer: '4',
            explanation: '2 cộng 2 bằng 4.',
          },
        ],
      },
      creatorAUserId
    );

    // Add 2 participants to roster
    const rosterRes = await request(app)
      .post(`/api/games/${examGameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        participants: [
          { fullName: 'Trần Thị Thí Sinh 1', departmentUnit: 'Phòng Kế Toán', employeeCode: 'NV001' },
          { fullName: 'Lê Văn Thí Sinh 2', departmentUnit: 'Phòng IT', employeeCode: 'NV002' },
        ],
      });
    assert.equal(rosterRes.status, 200);
    const p1 = rosterRes.body.data.participants.find((p: any) => p.employeeCode === 'NV001');
    const p2 = rosterRes.body.data.participants.find((p: any) => p.employeeCode === 'NV002');
    assert.ok(p1 && p2);

    // Participant 1 claims their slot and starts an EXAM session
    const createSess1 = await request(app).post('/api/games/sessions').send({
      gameId: examGameId,
      participantId: p1.participantId,
      participantName: p1.fullName,
      departmentUnit: p1.departmentUnit,
    });
    assert.equal(createSess1.status, 200);
    const sessionId1 = createSess1.body.data.sessionId;
    const p1LockToken = createSess1.body.data.lockToken;
    assert.ok(p1LockToken, 'Expected lockToken for roster participant');

    // AUD-004 check 1: Anonymous caller WITHOUT X-Participant-Token cannot start, read, answer, or advance sessionId1
    const noTokenStart = await request(app).post(`/api/games/sessions/${sessionId1}/start`);
    assert.equal(noTokenStart.status, 401);

    // AUD-004 check 2: Caller with wrong X-Participant-Token gets 403 ACCESS_DENIED
    const wrongTokenStart = await request(app)
      .post(`/api/games/sessions/${sessionId1}/start`)
      .set('X-Participant-Token', 'forged-wrong-token-12345');
    assert.equal(wrongTokenStart.status, 403);

    // AUD-004 check 3: Participant 2 creates their own session (sessionId2) and tries to use p2LockToken to read/control sessionId1 -> 403 ACCESS_DENIED
    const createSess2 = await request(app).post('/api/games/sessions').send({
      gameId: examGameId,
      participantId: p2.participantId,
      participantName: p2.fullName,
      departmentUnit: p2.departmentUnit,
    });
    assert.equal(createSess2.status, 200);
    const p2LockToken = createSess2.body.data.lockToken;
    assert.ok(p2LockToken && p2LockToken !== p1LockToken);

    const crossSessionStart = await request(app)
      .post(`/api/games/sessions/${sessionId1}/start`)
      .set('X-Participant-Token', p2LockToken);
    assert.equal(crossSessionStart.status, 403);

    const crossSessionRead = await request(app)
      .get(`/api/games/sessions/${sessionId1}`)
      .set('X-Participant-Token', p2LockToken);
    assert.equal(crossSessionRead.status, 403);

    // Legitimate Participant 1 starts and answers with X-Participant-Token
    const okStart = await request(app)
      .post(`/api/games/sessions/${sessionId1}/start`)
      .set('X-Participant-Token', p1LockToken);
    assert.equal(okStart.status, 200);

    // Submit answer to Question 1
    const ans1 = await request(app)
      .post(`/api/games/sessions/${sessionId1}/answer`)
      .set('X-Participant-Token', p1LockToken)
      .send({ questionId: 'exam_q1', answer: 'Hà Nội' });
    assert.equal(ans1.status, 200);
    // AUD-002 check: During unpublished EXAM, /answer must NOT leak correctAnswer, explanation, isCorrect, or pointsEarned
    assert.equal(ans1.body.data.correctAnswer, undefined);
    assert.equal(ans1.body.data.explanation, undefined);
    assert.equal(ans1.body.data.isCorrect ?? null, null);
    assert.equal(ans1.body.data.pointsEarned ?? null, null);

    await request(app)
      .post(`/api/games/sessions/${sessionId1}/next`)
      .set('X-Participant-Token', p1LockToken);

    const ans2 = await request(app)
      .post(`/api/games/sessions/${sessionId1}/answer`)
      .set('X-Participant-Token', p1LockToken)
      .send({ questionId: 'exam_q2', answer: '3' });
    assert.equal(ans2.status, 200);
    assert.equal(ans2.body.data.isCorrect ?? null, null);
    assert.equal(ans2.body.data.pointsEarned ?? null, null);

    const finishNext = await request(app)
      .post(`/api/games/sessions/${sessionId1}/next`)
      .set('X-Participant-Token', p1LockToken);
    assert.equal(finishNext.status, 200);
    assert.equal(finishNext.body.data.finished, true);

    // Check /result with X-Participant-Token while answersPublished = false
    const resUnpublished = await request(app)
      .get(`/api/games/sessions/${sessionId1}/result`)
      .set('X-Participant-Token', p1LockToken);
    assert.equal(resUnpublished.status, 200);
    assert.equal(resUnpublished.body.data.answersPublished, false);
    assert.equal(resUnpublished.body.data.canRevealAnswers, false);
    for (const qr of resUnpublished.body.data.questionResults) {
      assert.ok(
        qr.correctAnswer === undefined ||
          qr.correctAnswer === '[Đáp án sẽ được công bố sau khi kết thúc kỳ thi]'
      );
      assert.notEqual(qr.correctAnswer, 'Hà Nội');
      assert.notEqual(qr.correctAnswer, '4');
      assert.equal(qr.explanation, undefined);
      assert.equal(qr.isCorrect, null);
      assert.equal(qr.pointsEarned, null);
    }

    // Check /export is blocked (403 EXAM_ANSWERS_LOCKED) while answersPublished = false
    const exportLocked = await request(app)
      .get(`/api/games/sessions/${sessionId1}/export?format=csv`)
      .set('X-Participant-Token', p1LockToken);
    assert.equal(exportLocked.status, 403);
    assert.equal(exportLocked.body.error.code, 'EXAM_ANSWERS_LOCKED');

    // Even Creator A viewing /api/history/activities/:historyId or /scoreboard before publish-answers sees redacted per-question answers
    const creatorHistDetailBefore = await request(app)
      .get(`/api/history/activities/solo:${sessionId1}`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(creatorHistDetailBefore.status, 200);
    assert.ok(Array.isArray(creatorHistDetailBefore.body.data.questionBreakdown));
    for (const qRow of creatorHistDetailBefore.body.data.questionBreakdown) {
      assert.equal(qRow.correctAnswer, null);
      assert.equal(qRow.explanation, null);
      assert.equal(qRow.isCorrect, null);
      assert.equal(qRow.pointsEarned, null);
    }

    const scoreboardBefore = await request(app)
      .get(`/api/games/${examGameId}/scoreboard`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(scoreboardBefore.status, 200);
    const entryBefore = scoreboardBefore.body.data.entries.find((e: any) => e.employeeCode === 'NV001');
    assert.ok(entryBefore);
    const attemptBefore = entryBefore.attemptHistory[0];
    assert.ok(attemptBefore);
    for (const ansItem of attemptBefore.answers) {
      assert.equal(ansItem.correctAnswer, null);
      assert.equal(ansItem.explanation, null);
      assert.equal(ansItem.isCorrect, null);
      assert.equal(ansItem.pointsEarned, null);
    }

    // Now Creator A closes the exam and publishes answers
    const closeExamRes = await request(app)
      .post(`/api/games/${examGameId}/close-exam`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(closeExamRes.status, 200);

    const publishRes = await request(app)
      .post(`/api/games/${examGameId}/publish-answers`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ published: true });
    assert.equal(publishRes.status, 200);

    // After publish-answers, /result reveals full answers, isCorrect, pointsEarned, and /export succeeds!
    const resPublished = await request(app)
      .get(`/api/games/sessions/${sessionId1}/result`)
      .set('X-Participant-Token', p1LockToken);
    assert.equal(resPublished.status, 200);
    assert.equal(resPublished.body.data.answersPublished, true);
    assert.equal(resPublished.body.data.canRevealAnswers, true);
    assert.equal(resPublished.body.data.questionResults[0].correctAnswer, 'Hà Nội');
    assert.equal(resPublished.body.data.questionResults[0].isCorrect, true);
    assert.equal(resPublished.body.data.questionResults[0].pointsEarned, 100);
    assert.equal(resPublished.body.data.questionResults[1].correctAnswer, '4');
    assert.equal(resPublished.body.data.questionResults[1].isCorrect, false);
    assert.equal(resPublished.body.data.questionResults[1].pointsEarned, 0);

    const exportUnlocked = await request(app)
      .get(`/api/games/sessions/${sessionId1}/export?format=csv`)
      .set('X-Participant-Token', p1LockToken);
    assert.equal(exportUnlocked.status, 200);
  });

  it('AUD-003: Preserves completed attempts, scoreboard ranks, and ATTEMPT_LIMIT_REACHED lock when deleting/re-adding or replacing roster, and never merges same-name participants', async () => {
    resetAllRateLimiters();

    const gameId = 'aud003_roster_game';
    saveTestGameSpec(
      {
        gameId,
        title: 'Kỳ Thi Toàn Vẹn Roster AUD-003',
        gameType: 'QUIZ',
        isPublic: true,
        settings: {
          questionCount: 1,
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'EXAM',
          rosterMode: 'PRECONFIGURED',
        },
        questions: [
          {
            id: 'r_q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi kiểm tra roster?',
            choices: ['Đúng', 'Sai', 'Không rõ', 'Tất cả'],
            correctAnswer: 'Đúng',
          },
        ],
      },
      creatorAUserId
    );

    // 1. Add two participants with the EXACT SAME NAME ("Nguyễn Văn An") in different departments/employee codes
    const addRes = await request(app)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        participants: [
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kinh Doanh', employeeCode: 'KD01' },
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kỹ Thuật', employeeCode: 'KT02' },
          { fullName: 'Phạm Thị Bình', departmentUnit: 'Phòng Nhân Sự', employeeCode: 'NS03' },
        ],
      });
    assert.equal(addRes.status, 200);
    assert.equal(addRes.body.data.participants.length, 3, 'Must keep both Nguyễn Văn An rows separate');

    const anKD = addRes.body.data.participants.find((p: any) => p.employeeCode === 'KD01');
    const anKT = addRes.body.data.participants.find((p: any) => p.employeeCode === 'KT02');
    assert.ok(anKD && anKT);
    assert.notEqual(anKD.participantId, anKT.participantId);

    // 2. An (KD01) completes their 1 allowed attempt
    const sessCreate = await request(app).post('/api/games/sessions').send({
      gameId,
      participantId: anKD.participantId,
      participantName: anKD.fullName,
      departmentUnit: anKD.departmentUnit,
    });
    assert.equal(sessCreate.status, 200);
    const sessId = sessCreate.body.data.sessionId;
    const lockToken = sessCreate.body.data.lockToken;

    await request(app)
      .post(`/api/games/sessions/${sessId}/start`)
      .set('X-Participant-Token', lockToken);
    await request(app)
      .post(`/api/games/sessions/${sessId}/answer`)
      .set('X-Participant-Token', lockToken)
      .send({ questionId: 'r_q1', answer: 'Đúng' });
    await request(app)
      .post(`/api/games/sessions/${sessId}/next`)
      .set('X-Participant-Token', lockToken);

    // Verify An (KD01) is blocked from a second attempt
    const retry1 = await request(app).post('/api/games/sessions').send({
      gameId,
      participantId: anKD.participantId,
      participantName: anKD.fullName,
      departmentUnit: anKD.departmentUnit,
    });
    assert.equal(retry1.status, 403);
    assert.equal(retry1.body.error.code, 'ATTEMPT_LIMIT_REACHED');

    // 3. Creator tries to delete An (KD01) who already completed an attempt -> blocked with 409 PARTICIPANT_HAS_ATTEMPTS!
    const delRes = await request(app)
      .delete(`/api/games/${gameId}/participants/${anKD.participantId}`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(delRes.status, 409);
    assert.equal(delRes.body.error.code, 'PARTICIPANT_HAS_ATTEMPTS');

    // Scoreboard and participantId remain completely intact
    const sbAfterDeleteAttempt = await request(app)
      .get(`/api/games/${gameId}/scoreboard`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(sbAfterDeleteAttempt.status, 200);
    assert.equal(sbAfterDeleteAttempt.body.data.totals.completedCount, 1);

    // Deleting a PENDING participant with 0 attempts (Phạm Thị Bình) succeeds (200 OK)
    const pendingBinh = addRes.body.data.participants.find((p: any) => p.employeeCode === 'NS03');
    assert.ok(pendingBinh);
    const delPendingRes = await request(app)
      .delete(`/api/games/${gameId}/participants/${pendingBinh.participantId}`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(delPendingRes.status, 200);

    // Clear all participants (DELETE /api/games/:gameId/participants) removes remaining PENDING participants while protecting An (KD01)
    const clearRes = await request(app)
      .delete(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(clearRes.status, 200);

    const listAfterClear = await request(app)
      .get(`/api/games/${gameId}/participants?mode=manage`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(listAfterClear.status, 200);
    assert.equal(listAfterClear.body.data.participants.length, 1);
    assert.equal(listAfterClear.body.data.participants[0].participantId, anKD.participantId);
    assert.equal(listAfterClear.body.data.participants[0].usedAttempts, 1);
    assert.equal(listAfterClear.body.data.participants[0].status, 'COMPLETED');

    // Attempt to re-add An (KD01) or take exam again -> preserves existing participantId and still blocked by ATTEMPT_LIMIT_REACHED!
    const reAddRes = await request(app)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        participants: [
          { fullName: 'Nguyễn Văn An', departmentUnit: 'Phòng Kinh Doanh', employeeCode: 'KD01' },
        ],
      });
    assert.equal(reAddRes.status, 200);
    const reAddedAnKD = reAddRes.body.data.participants.find((p: any) => p.employeeCode === 'KD01');
    assert.ok(reAddedAnKD);
    assert.equal(reAddedAnKD.participantId, anKD.participantId, 'Participant ID must remain unchanged');
    assert.equal(reAddedAnKD.usedAttempts, 1, 'Participant must retain usedAttempts = 1');
    assert.equal(reAddedAnKD.status, 'COMPLETED', 'Participant must retain COMPLETED status');

    const retryAfterReAdd = await request(app).post('/api/games/sessions').send({
      gameId,
      participantId: reAddedAnKD.participantId,
      participantName: reAddedAnKD.fullName,
      departmentUnit: reAddedAnKD.departmentUnit,
    });
    assert.equal(retryAfterReAdd.status, 403);
    assert.equal(retryAfterReAdd.body.error.code, 'ATTEMPT_LIMIT_REACHED');

    // 4. Replacing roster (replaceAll = true) protects participants who already have attempts (reAddedAnKD) while replacing PENDING ones
    const replaceRes = await request(app)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        replaceAll: true,
        participants: [
          { fullName: 'Hoàng Văn Mới', departmentUnit: 'Phòng Pháp Chế', employeeCode: 'PC09' },
        ],
      });
    assert.equal(replaceRes.status, 200);
    const stillHasAnKD = replaceRes.body.data.participants.find((p: any) => p.employeeCode === 'KD01');
    const hasNewParticipant = replaceRes.body.data.participants.find((p: any) => p.employeeCode === 'PC09');
    assert.ok(stillHasAnKD, 'replaceAll must protect participant who already completed an exam attempt');
    assert.ok(hasNewParticipant, 'replaceAll must insert new participant');

    // 5. Legitimate grant-retake unlocks 1 additional attempt while keeping historical attempt
    const grantRes = await request(app)
      .post(`/api/games/${gameId}/participants/${stillHasAnKD.participantId}/grant-retake`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(grantRes.status, 200);
    assert.equal(grantRes.body.data.participant.allowedAttempts, 2);

    // 6. Active IN_PROGRESS participant cannot be deleted (409 PARTICIPANT_IN_PROGRESS)
    const activeSessRes = await request(app).post('/api/games/sessions').send({
      gameId,
      participantId: hasNewParticipant.participantId,
      participantName: hasNewParticipant.fullName,
      departmentUnit: hasNewParticipant.departmentUnit,
    });
    assert.equal(activeSessRes.status, 200);

    const delActiveRes = await request(app)
      .delete(`/api/games/${gameId}/participants/${hasNewParticipant.participantId}`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(delActiveRes.status, 409);
    assert.equal(delActiveRes.body.error.code, 'PARTICIPANT_IN_PROGRESS');
  });

  it('AUD-005 & AUD-016: Parses Excel (.xlsx), CSV, and text roster files with row diagnostics, flags duplicate names without merging, and rejects invalid/corrupted files with 400', async () => {
    resetAllRateLimiters();

    // 1. Build a real .xlsx buffer containing valid rows, duplicate names, and an invalid empty-name row
    const sheetRows = [
      ['Họ và tên', 'Đơn vị / Phòng ban', 'Mã nhân viên', 'Ghi chú'],
      ['Nguyễn Văn An', 'Phòng Kinh Doanh', 'NV101', 'Trưởng nhóm'],
      ['Nguyễn Văn An', 'Phòng Kỹ Thuật', 'NV102', 'Cùng tên khác phòng'],
      ['', 'Phòng Hành Chính', 'NV103', 'Dòng lỗi thiếu họ tên'],
      ['@!#$%', 'Phòng IT', 'NV104', 'Dòng lỗi ký tự đặc biệt'],
      ['Trần Thị Bích', 'Phòng Nhân Sự', 'NV101', 'Trùng mã NV101'],
    ];
    const xlsxLib: typeof XLSX = (XLSX as any).default ?? XLSX;
    const wb = xlsxLib.utils.book_new();
    const ws = xlsxLib.utils.aoa_to_sheet(sheetRows);
    xlsxLib.utils.book_append_sheet(wb, ws, 'DanhSachThiSinh');
    const xlsxBuffer: Buffer = xlsxLib.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const parseXlsxRes = await request(app)
      .post('/api/games/participants/parse')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        fileName: 'danh_sach_thi_sinh.xlsx',
        fileBase64: xlsxBuffer.toString('base64'),
      });
    assert.equal(parseXlsxRes.status, 200);
    const diag = parseXlsxRes.body.data;
    assert.equal(diag.validCount, 3, 'Should parse 3 valid participants (including both Nguyễn Văn An rows)');
    assert.equal(diag.invalidCount, 2, 'Should flag 2 invalid rows (empty name and symbol-only name)');
    assert.equal(diag.duplicateNameCount, 1, 'Should flag 1 duplicate name warning');
    assert.equal(diag.duplicateCodeCount, 1, 'Should flag 1 duplicate employeeCode warning');
    assert.equal(diag.invalidRows[0].rowNumber, 4);
    assert.equal(diag.invalidRows[1].rowNumber, 5);

    // 2. Reject unsupported file extensions (.pdf / .exe) with 400 UNSUPPORTED_ROSTER_FILE
    const badExtRes = await request(app)
      .post('/api/games/participants/parse')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        fileName: 'malicious.pdf',
        fileBase64: Buffer.from('%PDF-1.5 fake pdf content').toString('base64'),
      });
    assert.equal(badExtRes.status, 400);
    assert.equal(badExtRes.body.error.code, 'UNSUPPORTED_ROSTER_FILE');

    // 3. Reject corrupted binary masquerading as .xlsx with 400 CORRUPTED_ROSTER_FILE
    const badBinaryRes = await request(app)
      .post('/api/games/participants/parse')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        fileName: 'corrupted.xlsx',
        fileBase64: Buffer.from('NOT_A_VALID_ZIP_OR_OLE2_HEADER_1234567890').toString('base64'),
      });
    assert.equal(badBinaryRes.status, 400);
    assert.equal(badBinaryRes.body.error.code, 'CORRUPTED_ROSTER_FILE');

    // 4. Parse 100 valid Vietnamese UTF-8 CSV participants accurately
    const csvLines = ['Họ và tên,Đơn vị,Mã nhân viên'];
    for (let i = 1; i <= 100; i++) {
      csvLines.push(`Học Viên Thứ ${i},Khối Đào Tạo ${((i - 1) % 5) + 1},HV${String(i).padStart(3, '0')}`);
    }
    const parse100Res = await request(app)
      .post('/api/games/participants/parse')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        fileName: 'danh_sach_100_hoc_vien.csv',
        fileBase64: Buffer.from('\uFEFF' + csvLines.join('\n'), 'utf-8').toString('base64'),
      });
    assert.equal(parse100Res.status, 200);
    assert.equal(parse100Res.body.data.validCount, 100);
    assert.equal(parse100Res.body.data.invalidCount, 0);
  });

  it('AUD-006 & AUD-013: Persists custom per-question points (10-1000) in SQLite, computes accurate scores & maxPossibleScore in Solo and Multiplayer, and preserves Draft status', async () => {
    resetAllRateLimiters();

    const gameId = 'aud013_points_game';
    saveTestGameSpec(
      {
        gameId,
        title: 'Game Điểm Từng Câu & Nháp AUD-006 AUD-013',
        gameType: 'QUIZ',
        isPublic: false,
        settings: {
          questionCount: 3,
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'PLAY',
        },
        questions: [
          {
            id: 'pts_q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi 250 điểm?',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
            points: 250,
            timeLimitSeconds: 15,
          },
          {
            id: 'pts_q2',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi 350 điểm?',
            choices: ['C', 'D', 'E', 'F'],
            correctAnswer: 'D',
            points: 350,
            timeLimitSeconds: 25,
          },
          {
            id: 'pts_q3',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi mặc định 100 điểm?',
            choices: ['X', 'Y', 'Z', 'W'],
            correctAnswer: 'X',
          },
        ],
      },
      creatorAUserId
    );

    // Reload from SQLite after clearing in-memory gameStore cache to prove SQLite persistence of `points`
    gameStore.clear();
    const getGameRes = await request(app)
      .get(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(getGameRes.status, 200);
    assert.equal(getGameRes.body.data.isPublic, false, 'Game must remain a draft (isPublic = false)');
    assert.equal(getGameRes.body.data.questions[0].points, 250);
    assert.equal(getGameRes.body.data.questions[0].timeLimitSeconds, 15);
    assert.equal(getGameRes.body.data.questions[1].points, 350);
    assert.equal(getGameRes.body.data.questions[1].timeLimitSeconds, 25);
    assert.equal(getGameRes.body.data.questions[2].points, undefined);

    // Update questions via PATCH /api/games/:gameId/questions and verify custom points update cleanly without publishing draft
    const patchQRes = await request(app)
      .patch(`/api/games/${gameId}/questions`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        questions: [
          {
            ...getGameRes.body.data.questions[0],
            points: 300,
          },
          getGameRes.body.data.questions[1],
          getGameRes.body.data.questions[2],
        ],
      });
    assert.equal(patchQRes.status, 200);
    assert.equal(patchQRes.body.data.isPublic, false, 'Editing questions must not auto-publish a draft game');
    assert.equal(patchQRes.body.data.questions[0].points, 300);

    // Play a Solo session as Creator A and verify scoring uses 300 + 350 + 100 = 750 maxPossibleScore
    const sessCreate = await request(app)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ gameId });
    assert.equal(sessCreate.status, 200);
    const sessionId = sessCreate.body.data.sessionId;

    await request(app)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${creatorAToken}`);

    // Q1 correct -> +300 points
    const ans1 = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ questionId: 'pts_q1', answer: 'A' });
    assert.equal(ans1.status, 200);
    assert.equal(ans1.body.data.isCorrect, true);
    assert.equal(ans1.body.data.pointsEarned, 300);

    await request(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${creatorAToken}`);

    // Q2 correct -> +350 points
    const ans2 = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ questionId: 'pts_q2', answer: 'D' });
    assert.equal(ans2.status, 200);
    assert.equal(ans2.body.data.isCorrect, true);
    assert.equal(ans2.body.data.pointsEarned, 350);

    await request(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${creatorAToken}`);

    // Q3 wrong -> +0 points
    const ans3 = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ questionId: 'pts_q3', answer: 'Y' });
    assert.equal(ans3.status, 200);
    assert.equal(ans3.body.data.isCorrect, false);
    assert.equal(ans3.body.data.pointsEarned, 0);

    await request(app)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('Authorization', `Bearer ${creatorAToken}`);

    const finalRes = await request(app)
      .get(`/api/games/sessions/${sessionId}/result`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(finalRes.status, 200);
    assert.equal(finalRes.body.data.score, 650, 'Total score should be 300 + 350 = 650');
    assert.equal(
      finalRes.body.data.maxPossibleScore,
      750,
      'maxPossibleScore should be 300 + 350 + 100 = 750'
    );

    // Reject invalid points (< 10 or > 1000) on backend
    const invalidPointsRes = await request(app)
      .patch(`/api/games/${gameId}/questions`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        questions: [
          {
            ...getGameRes.body.data.questions[0],
            points: -50,
          },
          getGameRes.body.data.questions[1],
          getGameRes.body.data.questions[2],
        ],
      });
    assert.equal(invalidPointsRes.status, 400);
    assert.equal(invalidPointsRes.body.error.code, 'INVALID_REQUEST');

    // Public play on Draft game (isPublic = false) is rejected until published
    const publicPlayOnDraft = await request(app)
      .post('/api/games/sessions')
      .send({ gameId, publicPlay: true, playerName: 'Người chơi công khai' });
    assert.equal(publicPlayOnDraft.status, 403);
    assert.equal(publicPlayOnDraft.body.error.code, 'GAME_NOT_PUBLISHED');

    // Verify Multiplayer room also uses custom per-question points (300 + 350 + 100 = 750)
    const roomCreateRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ gameId });
    assert.equal(roomCreateRes.status, 200);
    const { roomCode, hostToken } = roomCreateRes.body.data;
    const room = roomService.getRoomByCode(roomCode);
    const { player } = room.addPlayer('Player Điểm Riêng');
    room.start(hostToken);
    room.submitPlayerAnswer(player.playerToken, 'pts_q1', 'A');
    room.revealQuestion(hostToken);
    room.nextQuestion(hostToken);
    room.submitPlayerAnswer(player.playerToken, 'pts_q2', 'D');
    room.revealQuestion(hostToken);
    room.nextQuestion(hostToken);
    room.submitPlayerAnswer(player.playerToken, 'pts_q3', 'X');
    room.revealQuestion(hostToken);
    room.nextQuestion(hostToken);
    assert.equal(room.state, 'FINISHED');
    const lb = room.getLeaderboard();
    assert.equal(lb[0].score, 750, 'Multiplayer score should sum 300 + 350 + 100 = 750');
  });
});
