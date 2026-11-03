import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import supertest from 'supertest';
import * as XLSX from 'xlsx';
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
  sourceId: 'src_v3_roster_test',
  sourceType: 'TXT' as const,
  sourceLocation: 'manual.txt',
};

const DEFAULT_SOURCE_SUMMARY = {
  sourceCount: 1,
  sources: [
    {
      sourceId: 'src_v3_roster_test',
      sourceType: 'TXT' as const,
      sourceName: 'manual.txt',
      sourceLocation: 'manual.txt',
    },
  ],
};

function buildBaseGameSpec(overrides: Partial<GameSpecification> & { gameId: string }): GameSpecification {
  return {
    gameId: overrides.gameId,
    title: overrides.title || 'Game Kiểm Tra Roster Thư Viện',
    description: overrides.description || 'Bộ câu hỏi kiểm thử quản lý thí sinh trong Thư viện -> Sửa game',
    gameType: overrides.gameType || 'MIXED',
    isPublic: overrides.isPublic ?? true,
    ownerUserId: overrides.ownerUserId ?? null,
    settings: {
      questionCount: 2,
      timePerQuestion: 20,
      scoringMode: 'STANDARD',
      sessionMode: 'PLAY',
      examAnswerRevealPolicy: 'AFTER_PUBLISH',
      answersPublished: false,
      ...(overrides.settings || {}),
    },
    sourceSummary: DEFAULT_SOURCE_SUMMARY,
    generatedAt: new Date().toISOString(),
    questions: overrides.questions || [
      {
        id: `${overrides.gameId}_q1`,
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 1: Giao thức nào dùng cho kết nối bảo mật HTTPS?',
        choices: ['TLS/SSL', 'FTP', 'Telnet', 'SNMP'],
        correctAnswer: 'TLS/SSL',
        explanation: 'HTTPS mã hóa kênh truyền bằng TLS/SSL.',
        difficulty: 'EASY',
        points: 100,
        timeLimitSeconds: 20,
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: `${overrides.gameId}_q2`,
        type: 'QUICK_BUTTON',
        question: 'Câu 2: SQLite hỗ trợ khoá ngoại (Foreign Key)?',
        choices: ['Đúng', 'Sai'],
        correctAnswer: 'Đúng',
        explanation: 'SQLite hỗ trợ đầy đủ Foreign Key khi bật PRAGMA foreign_keys = ON.',
        difficulty: 'EASY',
        points: 100,
        timeLimitSeconds: 20,
        sourceReference: DEFAULT_SOURCE_REF,
      },
    ],
  };
}

describe('V3 LIBRARY EDIT EXAM ROSTER MANAGEMENT (12 FUNCTIONAL CASES + E2E)', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_game_v3_lib_roster_'));
    tempDbPath = path.join(tempDir, 'test_v3_lib_roster.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();

    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const regCreator = authService.register({
      email: 'creator_roster_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Creator Library Roster V3',
    });
    creatorToken = regCreator.token;
    creatorUser = regCreator.user;

    const regOther = authService.register({
      email: 'other_roster_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Other Outsider User',
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
      // ignore temp cleanup errors
    }
  });

  it('Case 1 & Case 2: Chuyển CHƠI -> THI khi danh sách trống (Lưu thành công) & Chặn mở kỳ thi khi danh sách trống (0 thí sinh)', async () => {
    const gameId = 'game_v3_case1_play_to_exam_empty';
    const initialSpec = buildBaseGameSpec({
      gameId,
      title: 'Case 1: Game Chơi Chuyển Sang Thi Khi Trống Danh Sách',
      ownerUserId: creatorUser.userId,
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'PLAY',
      },
    });
    gameStore.save(initialSpec, Date.now(), creatorUser.userId, true);

    // 1. Switch PLAY -> EXAM via PATCH/PUT /api/games/:gameId while participant list is empty
    const updateRes = await supertest(baseUrl)
      .patch(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        title: initialSpec.title,
        description: initialSpec.description,
        isPublic: true,
        settings: {
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_PUBLISH',
        },
        questions: initialSpec.questions,
      });

    assert.equal(updateRes.status, 200, 'Saving EXAM mode with empty roster must succeed');
    assert.equal(updateRes.body.data.settings.sessionMode, 'EXAM');

    const rosterCheck = persistenceRepo.listParticipants(gameId);
    assert.equal(rosterCheck.total, 0, 'Roster must remain 0 (no fake participants created)');

    // 2. Verify opening exam in Solo Session, Solo QR, Multiplayer Room, and Reopen Exam is blocked (400 EXAM_ROSTER_REQUIRED)
    const soloSessionRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({
        gameId,
        playerName: 'Người Lạ Không Có Trong Danh Sách',
      });
    assert.equal(soloSessionRes.status, 400);
    assert.equal(soloSessionRes.body.error.code, 'EXAM_ROSTER_REQUIRED');

    const soloQrRes = await supertest(baseUrl)
      .get(`/api/games/${gameId}/qr`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(soloQrRes.status, 400);
    assert.equal(soloQrRes.body.error.code, 'EXAM_ROSTER_REQUIRED');

    const createRoomRes = await supertest(baseUrl)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ gameId });
    assert.equal(createRoomRes.status, 400);
    assert.equal(createRoomRes.body.error.code, 'EXAM_ROSTER_REQUIRED');

    const reopenRes = await supertest(baseUrl)
      .post(`/api/games/${gameId}/reopen-exam`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({});
    assert.equal(reopenRes.status, 400);
    assert.equal(reopenRes.body.error.code, 'EXAM_ROSTER_REQUIRED');
  });

  it('Case 3, Case 6, Case 7 & Case 11: Thêm thí sinh thủ công trong Thư viện -> Lưu -> Mở kỳ thi hợp lệ & Kiểm tra đủ 3 chế độ hiển thị đáp án (IMMEDIATE / AFTER_SUBMIT / AFTER_PUBLISH)', async () => {
    const gameId = 'game_v3_case1_play_to_exam_empty';

    // Non-owner cannot add participants (403)
    const outsiderAddRes = await supertest(baseUrl)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({
        participants: [{ fullName: 'Hacker Tự Thêm Tên', departmentUnit: 'External' }],
        replaceAll: false,
      });
    assert.equal(outsiderAddRes.status, 403, 'Non-owner must not be able to add participants');

    // Creator adds 3 valid participants manually
    const addRes = await supertest(baseUrl)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        participants: [
          { fullName: 'Nguyễn Minh Quân', departmentUnit: 'Phòng An Ninh Mạng', employeeCode: 'SEC01' },
          { fullName: 'Trần Hoàng Yến', departmentUnit: 'Phòng Kiểm Toán', employeeCode: 'AUD02' },
          { fullName: 'Lê Bảo Châu', departmentUnit: 'Phòng Pháp Chế', employeeCode: 'LEG03' },
        ],
        replaceAll: false,
        rosterMode: 'PRECONFIGURED',
      });
    assert.equal(addRes.status, 200);
    assert.equal(addRes.body.data.total, 3);
    const participants = addRes.body.data.participants;
    const pt1 = participants.find((p: any) => p.employeeCode === 'SEC01');
    const pt2 = participants.find((p: any) => p.employeeCode === 'AUD02');
    const pt3 = participants.find((p: any) => p.employeeCode === 'LEG03');
    assert.ok(pt1 && pt2 && pt3);

    // Reloading participant list in Library Edit returns the saved 3 participants
    const reloadRes = await supertest(baseUrl)
      .get(`/api/games/${gameId}/participants?mode=admin`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(reloadRes.status, 200);
    assert.equal(reloadRes.body.data.total, 3);

    // Non-owner cannot request mode=admin on participant list (403)
    const outsiderAdminListRes = await supertest(baseUrl)
      .get(`/api/games/${gameId}/participants?mode=admin`)
      .set('Authorization', `Bearer ${otherUserToken}`);
    assert.equal(outsiderAdminListRes.status, 403);

    // Case 6: Outsider not in roster cannot join exam (missing participantId -> 400 PARTICIPANT_REQUIRED; fake participantId -> 404 PARTICIPANT_NOT_FOUND)
    const noPtSession = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: 'Người Ngoài Không Có Mã' });
    assert.equal(noPtSession.status, 400);
    assert.equal(noPtSession.body.error.code, 'PARTICIPANT_REQUIRED');

    const fakePtSession = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: 'Người Ngoài Giả Mạo', participantId: 'pt_non_existent_999' });
    assert.equal(fakePtSession.status, 404);
    assert.equal(fakePtSession.body.error.code, 'PARTICIPANT_NOT_FOUND');

    // Now Solo QR and Multiplayer room creation succeed because valid roster >= 1
    const qrOkRes = await supertest(baseUrl)
      .get(`/api/games/${gameId}/qr`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(qrOkRes.status, 200);

    // Case 11A: Policy = IMMEDIATE (pt1 takes exam -> immediate feedback per question)
    const existingSpec = gameStore.get(gameId)!;
    await supertest(baseUrl)
      .patch(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: existingSpec.questions,
        settings: {
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'IMMEDIATE',
        },
      })
      .expect(200);

    const s1Create = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: pt1.fullName, participantId: pt1.participantId, publicPlay: true })
      .expect(200);
    const s1Id = s1Create.body.data.sessionId;
    const s1Token = s1Create.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/start`)
      .set('X-Participant-Token', s1Token)
      .expect(200);

    const s1Q1 = await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/answer`)
      .set('X-Participant-Token', s1Token)
      .send({ questionId: `${gameId}_q1`, answer: 'TLS/SSL' })
      .expect(200);
    assert.equal(s1Q1.body.data.isCorrect, true, 'IMMEDIATE policy must reveal isCorrect immediately');
    assert.equal(s1Q1.body.data.correctAnswer, 'TLS/SSL');

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/next`)
      .set('X-Participant-Token', s1Token)
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/answer`)
      .set('X-Participant-Token', s1Token)
      .send({ questionId: `${gameId}_q2`, answer: 'Đúng' })
      .expect(200);

    const s1Finish = await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/next`)
      .set('X-Participant-Token', s1Token)
      .expect(200);
    assert.equal(s1Finish.body.data.finished, true);
    assert.equal(s1Finish.body.data.result.canRevealAnswers, true);

    // Case 11B: Policy = AFTER_SUBMIT (pt2 takes exam -> redacted during questions, revealed immediately upon submission)
    await supertest(baseUrl)
      .patch(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: existingSpec.questions,
        settings: {
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_SUBMIT',
        },
      })
      .expect(200);

    const s2Create = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: pt2.fullName, participantId: pt2.participantId, publicPlay: true })
      .expect(200);
    const s2Id = s2Create.body.data.sessionId;
    const s2Token = s2Create.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/start`)
      .set('X-Participant-Token', s2Token)
      .expect(200);

    const s2Q1 = await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/answer`)
      .set('X-Participant-Token', s2Token)
      .send({ questionId: `${gameId}_q1`, answer: 'FTP' })
      .expect(200);
    assert.equal(s2Q1.body.data.examAnswerRecorded, true);
    assert.equal(s2Q1.body.data.correctAnswer, undefined, 'AFTER_SUBMIT must redact correctAnswer during exam');

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/next`)
      .set('X-Participant-Token', s2Token)
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/answer`)
      .set('X-Participant-Token', s2Token)
      .send({ questionId: `${gameId}_q2`, answer: 'Đúng' })
      .expect(200);

    const s2Finish = await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/next`)
      .set('X-Participant-Token', s2Token)
      .expect(200);
    assert.equal(s2Finish.body.data.finished, true);
    assert.equal(s2Finish.body.data.result.canRevealAnswers, true, 'AFTER_SUBMIT must unlock review immediately after finishing');
    assert.equal(s2Finish.body.data.result.questionResults[0].correctAnswer, 'TLS/SSL');

    // Case 11C: Policy = AFTER_PUBLISH (pt3 takes exam -> redacted during questions AND after submit until creator publishes)
    await supertest(baseUrl)
      .patch(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: existingSpec.questions,
        settings: {
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_PUBLISH',
        },
      })
      .expect(200);

    const s3Create = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: pt3.fullName, participantId: pt3.participantId, publicPlay: true })
      .expect(200);
    const s3Id = s3Create.body.data.sessionId;
    const s3Token = s3Create.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s3Id}/start`)
      .set('X-Participant-Token', s3Token)
      .expect(200);

    const s3Q1 = await supertest(baseUrl)
      .post(`/api/games/sessions/${s3Id}/answer`)
      .set('X-Participant-Token', s3Token)
      .send({ questionId: `${gameId}_q1`, answer: 'TLS/SSL' })
      .expect(200);
    assert.equal(s3Q1.body.data.examAnswerRecorded, true);
    assert.equal(s3Q1.body.data.correctAnswer, undefined);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s3Id}/next`)
      .set('X-Participant-Token', s3Token)
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s3Id}/answer`)
      .set('X-Participant-Token', s3Token)
      .send({ questionId: `${gameId}_q2`, answer: 'Đúng' })
      .expect(200);

    const s3Finish = await supertest(baseUrl)
      .post(`/api/games/sessions/${s3Id}/next`)
      .set('X-Participant-Token', s3Token)
      .expect(200);
    assert.equal(s3Finish.body.data.finished, true);
    assert.equal(s3Finish.body.data.result.canRevealAnswers, false, 'AFTER_PUBLISH must hide answers before creator publishes');
    assert.notEqual(s3Finish.body.data.result.questionResults[0].correctAnswer, 'TLS/SSL');
    assert.equal(
      s3Finish.body.data.result.questionResults[0].correctAnswer,
      '[Đáp án sẽ được công bố sau khi kết thúc kỳ thi]'
    );

    // Publish results -> now participant can see the real answer
    await supertest(baseUrl)
      .post(`/api/games/${gameId}/publish-answers`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);

    const s3ResultAfterPublish = await supertest(baseUrl)
      .get(`/api/games/sessions/${s3Id}/result`)
      .set('X-Participant-Token', s3Token)
      .expect(200);
    assert.equal(s3ResultAfterPublish.body.data.canRevealAnswers, true);
    assert.equal(s3ResultAfterPublish.body.data.questionResults[0].correctAnswer, 'TLS/SSL');
  });

  it('Case 4 & Case 5: Import danh sách từ CSV & XLSX (>= 100 thí sinh), cảnh báo trùng tên/dòng lỗi, và import lặp lại không tạo bản trùng hoặc reset lượt thi', async () => {
    const gameId = 'game_v3_case4_5_import_100';
    const spec = buildBaseGameSpec({
      gameId,
      title: 'Case 4 & 5: Import 100 Thí Sinh CSV/XLSX Trong Thư Viện',
      ownerUserId: creatorUser.userId,
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'EXAM',
      },
    });
    gameStore.save(spec, Date.now(), creatorUser.userId, true);

    // 1. Test CSV preview with duplicate names and invalid rows (missing name)
    const csvSample = [
      'Họ tên,Đơn vị,Mã NV',
      'Phạm Quốc Bảo,Phòng Kỹ Thuật,NV001',
      'Phạm Quốc Bảo,Phòng Kinh Doanh,NV002',
      ',Phòng Không Tên,NV_ERR',
      'Đặng Thu Thảo,Phòng Nhân Sự,NV003',
    ].join('\n');

    const csvParseRes = await supertest(baseUrl)
      .post('/api/games/participants/parse')
      .send({ rawText: csvSample, fileName: 'roster_preview.csv' });
    assert.equal(csvParseRes.status, 200);
    assert.equal(csvParseRes.body.data.validCount, 3, 'Should parse 3 valid participants');
    assert.equal(csvParseRes.body.data.duplicateCount, 1, 'Should detect 1 duplicate fullName group');
    assert.ok(csvParseRes.body.data.duplicateNames.includes('Phạm Quốc Bảo'));
    assert.equal(csvParseRes.body.data.invalidRows.length, 1, 'Should report 1 invalid row missing fullName');

    // 2. Generate an XLSX file in memory with 105 participants (including 2 duplicate names in different departments)
    const rows: Array<Record<string, string>> = [];
    for (let i = 1; i <= 105; i++) {
      rows.push({
        'Họ và tên': i === 105 ? 'Thí Sinh số 1' : `Thí Sinh số ${i}`,
        'Đơn vị': `Khối Vận Hành ${(i % 5) + 1}`,
        'Mã NV': `EMP_${String(i).padStart(3, '0')}`,
      });
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'DanhSachThiSinh');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const xlsxParseRes = await supertest(baseUrl)
      .post('/api/games/participants/parse')
      .attach('file', xlsxBuffer, 'danh_sach_105_thi_sinh.xlsx');
    assert.equal(xlsxParseRes.status, 200);
    assert.equal(xlsxParseRes.body.data.validCount, 105);
    assert.equal(xlsxParseRes.body.data.duplicateCount, 1);

    // 3. Upsert all 105 participants into the game via Library Edit endpoint
    const upsert105Res = await supertest(baseUrl)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        participants: xlsxParseRes.body.data.participants,
        replaceAll: false,
        rosterMode: 'PRECONFIGURED',
      });
    assert.equal(upsert105Res.status, 200);
    assert.equal(upsert105Res.body.data.total, 105);

    // Let participant EMP_001 complete 1 exam attempt
    const emp001 = upsert105Res.body.data.participants.find((p: any) => p.employeeCode === 'EMP_001');
    assert.ok(emp001);
    const sStart = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: emp001.fullName, participantId: emp001.participantId, publicPlay: true })
      .expect(200);
    const sId = sStart.body.data.sessionId;
    const sTok = sStart.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sId}/start`)
      .set('X-Participant-Token', sTok)
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sId}/answer`)
      .set('X-Participant-Token', sTok)
      .send({ questionId: `${gameId}_q1`, answer: 'TLS/SSL' })
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sId}/next`)
      .set('X-Participant-Token', sTok)
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sId}/answer`)
      .set('X-Participant-Token', sTok)
      .send({ questionId: `${gameId}_q2`, answer: 'Đúng' })
      .expect(200);

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sId}/next`)
      .set('X-Participant-Token', sTok)
      .expect(200);

    // 4. Re-import the exact same 105-row list -> must NOT duplicate records and must NOT reset EMP_001's usedAttempts
    const reimportRes = await supertest(baseUrl)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        participants: xlsxParseRes.body.data.participants,
        replaceAll: false,
        rosterMode: 'PRECONFIGURED',
      });
    assert.equal(reimportRes.status, 200);
    assert.equal(reimportRes.body.data.total, 105, 'Repeated import must not create duplicate participant rows');
    const emp001After = reimportRes.body.data.participants.find((p: any) => p.employeeCode === 'EMP_001');
    assert.equal(emp001After.participantId, emp001.participantId);
    assert.equal(emp001After.usedAttempts, 1, 'Repeated import must preserve usedAttempts');
    assert.equal(emp001After.status, 'COMPLETED', 'Repeated import must preserve COMPLETED status');
  });

  it('Case 8, Case 9 & Case 10: Xóa thí sinh chưa thi (Thành công), Chặn xóa thí sinh đã có lượt thi (409 PARTICIPANT_HAS_ATTEMPTS), và Chuyển THI -> CHƠI -> THI bảo toàn danh sách + lịch sử', async () => {
    const gameId = 'game_v3_case4_5_import_100';
    const existingSpec = gameStore.get(gameId)!;
    const listBefore = persistenceRepo.listParticipants(gameId, { limit: 200 }).participants;
    const attemptedPt = listBefore.find((p) => p.employeeCode === 'EMP_001')!;
    const unattemptedPt = listBefore.find((p) => p.employeeCode === 'EMP_105')!;
    assert.ok(attemptedPt && unattemptedPt);

    // Case 8: Delete unattempted participant -> succeeds (200) and decrements count to 104
    const delUnattemptedRes = await supertest(baseUrl)
      .delete(`/api/games/${gameId}/participants/${unattemptedPt.participantId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(delUnattemptedRes.status, 200);
    assert.equal(persistenceRepo.listParticipants(gameId, { limit: 200 }).total, 104);

    // Unattempted deleted participant can no longer join exam
    const joinDeletedRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: unattemptedPt.fullName, participantId: unattemptedPt.participantId });
    assert.equal(joinDeletedRes.status, 404);
    assert.equal(joinDeletedRes.body.error.code, 'PARTICIPANT_NOT_FOUND');

    // Case 9: Delete attempted participant -> blocked with 409 PARTICIPANT_HAS_ATTEMPTS
    const delAttemptedRes = await supertest(baseUrl)
      .delete(`/api/games/${gameId}/participants/${attemptedPt.participantId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    assert.equal(delAttemptedRes.status, 409);
    assert.equal(delAttemptedRes.body.error.code, 'PARTICIPANT_HAS_ATTEMPTS');

    // Attempted participant cannot retake without creator granting retake (403 ATTEMPT_LIMIT_REACHED)
    const retakeBlockedRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .send({ gameId, playerName: attemptedPt.fullName, participantId: attemptedPt.participantId });
    assert.equal(retakeBlockedRes.status, 403);
    assert.equal(retakeBlockedRes.body.error.code, 'ATTEMPT_LIMIT_REACHED');

    // Case 10: Switch THI -> CHƠI -> save, then CHƠI -> THI -> save
    const switchToPlayRes = await supertest(baseUrl)
      .patch(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: existingSpec.questions,
        settings: {
          sessionMode: 'PLAY',
        },
      });
    assert.equal(switchToPlayRes.status, 200);
    assert.equal(switchToPlayRes.body.data.settings.sessionMode, 'PLAY');

    const switchBackToExamRes = await supertest(baseUrl)
      .patch(`/api/games/${gameId}`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        questions: existingSpec.questions,
        settings: {
          sessionMode: 'EXAM',
          examAnswerRevealPolicy: 'AFTER_PUBLISH',
        },
      });
    assert.equal(switchBackToExamRes.status, 200);
    assert.equal(switchBackToExamRes.body.data.settings.sessionMode, 'EXAM');

    // Verify all 104 participants and EMP_001's exam attempt history are 100% preserved
    const afterToggleRoster = persistenceRepo.listParticipants(gameId, { limit: 200 });
    assert.equal(afterToggleRoster.total, 104, 'Switching EXAM -> PLAY -> EXAM must preserve saved participant roster');
    const emp001Preserved = afterToggleRoster.participants.find((p) => p.employeeCode === 'EMP_001');
    assert.ok(emp001Preserved);
    assert.equal(emp001Preserved.usedAttempts, 1);
    assert.equal(emp001Preserved.status, 'COMPLETED');
  });

  it('Case 12: Sao chép (Clone) game THI sang Thư viện cá nhân KHÔNG sao chép danh sách thí sinh hoặc lịch sử thi của game gốc', async () => {
    const sourceGameId = 'game_v3_case4_5_import_100';

    // Publish answers on source exam so another user can clone it
    await supertest(baseUrl)
      .post(`/api/games/${sourceGameId}/publish-answers`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({});

    const dupRes = await supertest(baseUrl)
      .post(`/api/games/${sourceGameId}/duplicate`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({});
    assert.equal(dupRes.status, 201);
    const clonedSpec: GameSpecification = dupRes.body.data;
    assert.notEqual(clonedSpec.gameId, sourceGameId);
    assert.equal(clonedSpec.ownerUserId, otherUser.userId);
    assert.equal(clonedSpec.isPublic, false, 'Cloned game must start as draft');
    assert.equal(clonedSpec.settings?.sessionMode, 'EXAM');

    // Cloned game's participant roster must be empty (0) and have no exam attempts
    const clonedRoster = persistenceRepo.listParticipants(clonedSpec.gameId);
    assert.equal(clonedRoster.total, 0, 'Cloned game must NOT copy original participant roster');

    // Opening exam on cloned game (even by its new owner) is blocked until the new owner adds their own roster
    const clonedStartBlocked = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ gameId: clonedSpec.gameId, playerName: 'Thí Sinh Mới' });
    assert.equal(clonedStartBlocked.status, 400);
    assert.equal(clonedStartBlocked.body.error.code, 'EXAM_ROSTER_REQUIRED');

    // Original game's roster (104 participants) remains untouched
    assert.equal(persistenceRepo.listParticipants(sourceGameId, { limit: 200 }).total, 104);
  });

  it('Real Browser E2E Verification: Thư viện -> Sửa game -> Chuyển CHƠI sang THI -> Lưu khi danh sách trống -> Chặn mở thi -> Thêm/Sửa/Xóa thí sinh -> Mở kỳ thi & Responsive (1440x900, 390x844, 360x800)', async () => {
    const browserGameId = 'game_v3_browser_lib_roster';
    const spec = buildBaseGameSpec({
      gameId: browserGameId,
      title: 'Browser E2E: Quản Lý Thí Sinh Trong Thư Viện',
      ownerUserId: creatorUser.userId,
      isPublic: true,
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'PLAY',
      },
    });
    gameStore.save(spec, Date.now(), creatorUser.userId, true);

    const browser = await Browser.launch({ width: 1440, height: 900 });
    try {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.setViewport({ width: 1440, height: 900, mobile: false });

      // 1. Authenticate as creator in browser sessionStorage and open Library (?tab=library)
      await page.goto(`${baseUrl}/`, { settleMs: 600 });
      await page.eval(`
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(creatorToken)});
      `);
      await page.goto(`${baseUrl}/?tab=library`, { settleMs: 1100 });

      // 2. Wait for our PLAY game card to render, click "Chi tiết", then wait for "Sửa" and click to enter Library Edit Mode
      for (let attempt = 0; attempt < 20; attempt++) {
        const clickedDetail = await page.eval(`
          (() => {
            const detailBtn = document.querySelector('[data-testid="library-card-detail-btn-${browserGameId}"]');
            if (detailBtn) {
              detailBtn.click();
              return true;
            }
            return false;
          })()
        `);
        if (clickedDetail) break;
        await sleep(250);
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        const clickedEdit = await page.eval(`
          (() => {
            const editBtn = document.querySelector('[data-testid="library-detail-edit-game-btn"]');
            if (editBtn) {
              editBtn.click();
              return true;
            }
            return false;
          })()
        `);
        if (clickedEdit) break;
        await sleep(250);
      }
      await sleep(500);

      // Verify PLAY mode in Library Edit does NOT show the exam roster section and config column expands full width
      const playEditCheck = await page.eval(`
        (() => {
          const grid = document.querySelector('[data-testid="library-edit-workspace-grid"]');
          const configCol = document.querySelector('[data-testid="library-edit-config-column"]');
          return {
            modeSelectVal: document.querySelector('[data-testid="library-edit-session-mode-select"]')?.value || null,
            hasRosterSection: Boolean(document.querySelector('[data-testid="library-edit-exam-roster-section"]')),
            gridWidth: grid ? grid.getBoundingClientRect().width : 0,
            configWidth: configCol ? configCol.getBoundingClientRect().width : 0,
          };
        })()
      `);
      assert.equal(playEditCheck.modeSelectVal, 'PLAY');
      assert.equal(playEditCheck.hasRosterSection, false, 'PLAY mode in Library Edit must not show exam roster section');
      assert.ok(
        Math.abs(playEditCheck.gridWidth - playEditCheck.configWidth) < 10,
        `In PLAY mode, config column (${playEditCheck.configWidth}px) must expand across full workspace grid (${playEditCheck.gridWidth}px)`
      );

      // 3. Switch mode from PLAY -> EXAM in Library Edit
      await page.eval(`
        (() => {
          const sel = document.querySelector('[data-testid="library-edit-session-mode-select"]');
          if (sel) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, 'EXAM');
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await sleep(600);

      const examEditEmptyCheck = await page.eval(`
        (() => {
          const configCol = document.querySelector('[data-testid="library-edit-config-column"]');
          const rosterCol = document.querySelector('[data-testid="library-edit-exam-roster-section"]');
          const configRect = configCol ? configCol.getBoundingClientRect() : null;
          const rosterRect = rosterCol ? rosterCol.getBoundingClientRect() : null;
          return {
            hasRosterSection: Boolean(rosterCol),
            badgeText: document.querySelector('[data-testid="library-edit-roster-count-badge"]')?.textContent?.trim() || '',
            hasEmptyNotice: Boolean(document.querySelector('[data-testid="library-edit-empty-roster-notice"]')),
            hasManualPanelOpen: Boolean(document.querySelector('[data-testid="library-roster-manual-panel"]')),
            hasBulkPanelOpen: Boolean(document.querySelector('[data-testid="library-roster-bulk-panel"]')),
            hasToggleManualBtn: Boolean(document.querySelector('[data-testid="library-roster-toggle-manual-btn"]')),
            hasToggleBulkBtn: Boolean(document.querySelector('[data-testid="library-roster-toggle-bulk-btn"]')),
            isTwoColumnSideBySide: Boolean(configRect && rosterRect && rosterRect.left >= configRect.right - 5),
          };
        })()
      `);
      assert.equal(examEditEmptyCheck.hasRosterSection, true, 'Switching to EXAM must show library-edit-exam-roster-section');
      assert.ok(examEditEmptyCheck.badgeText.includes('0 thí sinh hợp lệ'));
      assert.equal(examEditEmptyCheck.hasEmptyNotice, true);
      assert.equal(examEditEmptyCheck.hasManualPanelOpen, false, 'Default state must not show manual entry panel');
      assert.equal(examEditEmptyCheck.hasBulkPanelOpen, false, 'Default state must not show bulk import panel');
      assert.equal(examEditEmptyCheck.hasToggleManualBtn, true, 'Default state must show Thêm thí sinh button');
      assert.equal(examEditEmptyCheck.hasToggleBulkBtn, true, 'Default state must show Nhập danh sách button');
      assert.equal(examEditEmptyCheck.isTwoColumnSideBySide, true, 'Desktop 1440x900 must place Roster column to the right of Config column');

      // Test switching EXAM -> PLAY -> EXAM to verify clean layout collapse and restore
      await page.eval(`
        (() => {
          const sel = document.querySelector('[data-testid="library-edit-session-mode-select"]');
          if (sel) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, 'PLAY');
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await sleep(300);
      const switchedBackPlay = await page.eval(`Boolean(document.querySelector('[data-testid="library-edit-exam-roster-section"]'))`);
      assert.equal(switchedBackPlay, false, 'Switching EXAM -> PLAY must hide right roster column');

      await page.eval(`
        (() => {
          const sel = document.querySelector('[data-testid="library-edit-session-mode-select"]');
          if (sel) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, 'EXAM');
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await sleep(400);

      // 4. Save game in EXAM mode while participant roster is empty
      await page.eval(`
        (() => {
          const saveBtn = document.querySelector('[data-testid="library-edit-save-btn"]');
          if (saveBtn) saveBtn.click();
        })()
      `);
      await sleep(900);

      const savedEmptyDetailCheck = await page.eval(`
        (() => {
          const warningEl = document.querySelector('[data-testid="detail-exam-empty-roster-warning"]');
          const modeBadge = document.querySelector('[data-testid="detail-game-mode-badge"]');
          const rosterBadge = document.querySelector('[data-testid="detail-exam-roster-count-badge"]');
          return {
            modeBadgeText: modeBadge ? modeBadge.textContent.trim() : '',
            rosterBadgeText: rosterBadge ? rosterBadge.textContent.trim() : '',
            warningText: warningEl ? warningEl.textContent : '',
          };
        })()
      `);
      assert.equal(savedEmptyDetailCheck.modeBadgeText, 'THI');
      assert.equal(savedEmptyDetailCheck.rosterBadgeText, 'Thí sinh: 0');
      assert.ok(
        savedEmptyDetailCheck.warningText.includes('Đã lưu chế độ Thi. Bạn cần thêm danh sách thí sinh trước khi mở kỳ thi.'),
        `Expected empty roster save warning, got "${savedEmptyDetailCheck.warningText}"`
      );

      // 5. Click "Mở game" while roster is empty -> GameModeSelectionModal blocks Solo & Multiplayer exam opening, while keeping Playtest available
      await page.eval(`
        (() => {
          const openBtn = document.querySelector('[data-testid="explore-detail-open-game-btn"]');
          if (openBtn) openBtn.click();
        })()
      `);
      await sleep(700);

      const modalBlockedCheck = await page.eval(`
        (() => {
          const warn = document.querySelector('[data-testid="mode-modal-exam-empty-roster-warning"]');
          const openEditorBtn = document.querySelector('[data-testid="mode-modal-open-roster-editor-btn"]');
          return {
            hasWarn: Boolean(warn),
            warnText: warn ? warn.textContent : '',
            hasOpenEditorBtn: Boolean(openEditorBtn),
          };
        })()
      `);
      assert.equal(modalBlockedCheck.hasWarn, true, 'GameModeSelectionModal must show empty roster warning');
      assert.ok(modalBlockedCheck.warnText.includes('Bạn cần thêm danh sách thí sinh trước khi mở kỳ thi.'));
      assert.equal(modalBlockedCheck.hasOpenEditorBtn, true);

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_exam_empty_roster_blocked.png'),
        await page.screenshot()
      );

      // Click "+ Bổ sung danh sách thí sinh ngay" inside the modal -> jumps directly into Library Edit mode
      await page.eval(`
        (() => {
          const btn = document.querySelector('[data-testid="mode-modal-open-roster-editor-btn"]');
          if (btn) btn.click();
        })()
      `);
      await sleep(800);

      // 6. Open "Thêm thí sinh" manual panel, verify draft preservation when collapsing & reopening, then add 1 participant
      await page.eval(`
        (() => {
          const btn = document.querySelector('[data-testid="library-roster-toggle-manual-btn"]');
          if (btn) btn.click();
        })()
      `);
      await sleep(250);

      await page.eval(`
        (() => {
          const setVal = (sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          setVal('[data-testid="library-roster-quick-name-input"]', 'Vũ Hoàng Nam');
          setVal('[data-testid="library-roster-quick-dept-input"]', 'Phòng Công Nghệ');
          setVal('[data-testid="library-roster-quick-code-input"]', 'DEV01');
        })()
      `);
      await sleep(200);

      // Collapse manual panel and reopen to verify draft inputs are NOT lost (Check #8)
      await page.eval(`
        (() => {
          const cancelBtn = document.querySelector('[data-testid="library-roster-cancel-manual-btn"]');
          if (cancelBtn) cancelBtn.click();
        })()
      `);
      await sleep(200);
      const panelCollapsedCheck = await page.eval(`Boolean(document.querySelector('[data-testid="library-roster-manual-panel"]'))`);
      assert.equal(panelCollapsedCheck, false, 'Clicking Thu gọn must collapse manual panel');

      await page.eval(`
        (() => {
          const btn = document.querySelector('[data-testid="library-roster-toggle-manual-btn"]');
          if (btn) btn.click();
        })()
      `);
      await sleep(250);

      const preservedDraftCheck = await page.eval(`
        (() => ({
          nameVal: document.querySelector('[data-testid="library-roster-quick-name-input"]')?.value || '',
          deptVal: document.querySelector('[data-testid="library-roster-quick-dept-input"]')?.value || '',
          codeVal: document.querySelector('[data-testid="library-roster-quick-code-input"]')?.value || '',
        }))()
      `);
      assert.equal(preservedDraftCheck.nameVal, 'Vũ Hoàng Nam', 'Closing and reopening manual panel must preserve draft name');
      assert.equal(preservedDraftCheck.deptVal, 'Phòng Công Nghệ');
      assert.equal(preservedDraftCheck.codeVal, 'DEV01');

      // Capture screenshot with Manual Panel open
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_edit_manual_panel_open_1440x900.png'),
        await page.screenshot()
      );

      // Submit manual participant
      await page.eval(`
        (() => {
          const addBtn = document.querySelector('[data-testid="library-roster-add-single-btn"]');
          if (addBtn) addBtn.click();
        })()
      `);
      await sleep(800);

      // Open "Nhập danh sách" bulk panel -> verify Dán nhanh & Excel/CSV subtabs
      await page.eval(`
        (() => {
          const btn = document.querySelector('[data-testid="library-roster-toggle-bulk-btn"]');
          if (btn) btn.click();
        })()
      `);
      await sleep(250);

      // Check Excel / CSV subtab renders file input, then switch back to Dán nhanh
      await page.eval(`
        (() => {
          const fileTab = document.querySelector('[data-testid="library-roster-subtab-file"]');
          if (fileTab) fileTab.click();
        })()
      `);
      await sleep(200);
      const hasFileInputInBulkTab = await page.eval(`Boolean(document.querySelector('[data-testid="library-roster-file-input"]'))`);
      assert.equal(hasFileInputInBulkTab, true, 'Excel / CSV subtab must render file upload input');

      await page.eval(`
        (() => {
          const pasteTab = document.querySelector('[data-testid="library-roster-subtab-paste"]');
          if (pasteTab) pasteTab.click();
        })()
      `);
      await sleep(200);

      // Paste 2 new valid rows + 1 duplicate row ("Vũ Hoàng Nam") to verify bulk paste + duplicate warning (Check #4 & #6)
      await page.eval(`
        (() => {
          const el = document.querySelector('[data-testid="library-roster-bulk-textarea"]');
          if (el) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(el, 'Ngô Thanh Vân | Phòng Đào Tạo | HR01\\nBùi Tiến Dũng | Phòng Vận Hành | OPS02\\nVũ Hoàng Nam | Phòng Công Nghệ | DEV01');
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
      `);
      await sleep(250);

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_edit_bulk_panel_open_1440x900.png'),
        await page.screenshot()
      );

      await page.eval(`
        (() => {
          const bulkBtn = document.querySelector('[data-testid="library-roster-add-bulk-btn"]');
          if (bulkBtn) bulkBtn.click();
        })()
      `);
      await sleep(900);

      // Collapse bulk panel so we see the clean default state with 3 saved participants
      await page.eval(`
        (() => {
          const cancelBtn = document.querySelector('[data-testid="library-roster-cancel-bulk-btn"]');
          if (cancelBtn) cancelBtn.click();
        })()
      `);
      await sleep(250);

      const afterAddDom = await page.eval(`
        (() => {
          const badge = document.querySelector('[data-testid="library-edit-roster-count-badge"]');
          const rows = document.querySelectorAll('[data-testid^="library-roster-row-"]');
          const notice = document.querySelector('[data-testid="library-roster-action-notice"]');
          return {
            badgeText: badge ? badge.textContent.trim() : '',
            rowCount: rows.length,
            noticeText: notice ? notice.textContent.trim() : '',
          };
        })()
      `);
      assert.equal(afterAddDom.rowCount, 3, 'Must render 3 saved participant rows in Library Edit');
      assert.ok(afterAddDom.badgeText.includes('3 thí sinh hợp lệ'));
      assert.ok(afterAddDom.noticeText.includes('bỏ qua 1 dòng trùng tên'), `Expected duplicate warning in notice, got "${afterAddDom.noticeText}"`);

      // Capture Light Theme 1440x900 screenshot and verify no dark grey box in Light Theme
      await page.eval(`document.documentElement.setAttribute('data-theme', 'light')`);
      await sleep(300);
      const lightThemeColorCheck = await page.eval(`
        (() => {
          const card = document.querySelector('[data-testid="library-edit-exam-roster-section"]');
          const bg = card ? window.getComputedStyle(card).backgroundColor : '';
          return { bg };
        })()
      `);
      assert.equal(lightThemeColorCheck.bg, 'rgb(255, 255, 255)', 'In Light Theme, roster card must use clean white var(--bg-card) background');

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_edit_roster_populated_1440x900.png'),
        await page.screenshot()
      );
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_edit_light_1440x900.png'),
        await page.screenshot()
      );

      // Capture Dark Theme 1440x900 screenshot and verify Dark Theme surface token
      await page.eval(`document.documentElement.setAttribute('data-theme', 'dark')`);
      await sleep(300);
      const darkThemeColorCheck = await page.eval(`
        (() => {
          const card = document.querySelector('[data-testid="library-edit-exam-roster-section"]');
          const bg = card ? window.getComputedStyle(card).backgroundColor : '';
          return { bg };
        })()
      `);
      assert.equal(darkThemeColorCheck.bg, 'rgb(21, 27, 46)', 'In Dark Theme, roster card must use var(--bg-card) #151b2e');

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_edit_dark_1440x900.png'),
        await page.screenshot()
      );

      // Restore Light Theme for remaining checks
      await page.eval(`document.documentElement.setAttribute('data-theme', 'light')`);
      await sleep(250);

      // 7. Save edits and verify warning is gone and "Thí sinh: 3" badge is shown
      await page.eval(`
        (() => {
          const saveBtn = document.querySelector('[data-testid="library-edit-save-btn"]');
          if (saveBtn) saveBtn.click();
        })()
      `);
      let afterSaveWithRoster = { hasEmptyWarning: true, rosterBadgeText: '' };
      for (let attempt = 0; attempt < 20; attempt++) {
        await sleep(250);
        afterSaveWithRoster = await page.eval(`
          (() => ({
            hasEmptyWarning: Boolean(document.querySelector('[data-testid="detail-exam-empty-roster-warning"]')),
            rosterBadgeText: document.querySelector('[data-testid="detail-exam-roster-count-badge"]')?.textContent?.trim() || '',
          }))()
        `);
        if (afterSaveWithRoster.rosterBadgeText === 'Thí sinh: 3') break;
      }
      assert.equal(afterSaveWithRoster.hasEmptyWarning, false, 'Empty roster warning must disappear once participants exist');
      assert.equal(afterSaveWithRoster.rosterBadgeText, 'Thí sinh: 3');

      // 8. Re-enter Edit mode to verify responsive layout across all 5 required viewports:
      // Desktop 1440x900 (2-col), Laptop 1366x768 (2-col), Tablet 768x1024 (1-col), Mobile 390x844 (1-col), Mobile 360x800 (1-col)
      await page.eval(`
        (() => {
          const editBtn = document.querySelector('[data-testid="library-detail-edit-game-btn"]');
          if (editBtn) editBtn.click();
        })()
      `);
      await sleep(700);

      for (const vp of [
        { width: 1440, height: 900, mobile: false, expectTwoCol: true, file: 'v3_library_edit_1440x900.png' },
        { width: 1366, height: 768, mobile: false, expectTwoCol: true, file: 'v3_library_edit_1366x768.png' },
        { width: 768, height: 1024, mobile: true, expectTwoCol: false, file: 'v3_library_edit_768x1024.png' },
        { width: 390, height: 844, mobile: true, expectTwoCol: false, file: 'v3_library_edit_roster_390x844.png' },
        { width: 360, height: 800, mobile: true, expectTwoCol: false, file: 'v3_library_edit_roster_360x800.png' },
      ]) {
        await page.setViewport({ width: vp.width, height: vp.height, mobile: vp.mobile });
        await sleep(400);
        const layoutCheck = await page.eval(`
          (() => {
            const configCol = document.querySelector('[data-testid="library-edit-config-column"]');
            const rosterCol = document.querySelector('[data-testid="library-edit-exam-roster-section"]');
            const cRect = configCol ? configCol.getBoundingClientRect() : null;
            const rRect = rosterCol ? rosterCol.getBoundingClientRect() : null;
            return {
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              isTwoCol: Boolean(cRect && rRect && rRect.left >= cRect.right - 8),
              isStacked: Boolean(cRect && rRect && rRect.top >= cRect.bottom - 8),
            };
          })()
        `);
        assert.ok(
          layoutCheck.scrollWidth <= layoutCheck.innerWidth + 2,
          `Viewport ${vp.width}x${vp.height} must not overflow horizontally (${layoutCheck.scrollWidth} > ${layoutCheck.innerWidth})`
        );
        if (vp.expectTwoCol) {
          assert.equal(layoutCheck.isTwoCol, true, `Viewport ${vp.width}x${vp.height} must render 2 columns side-by-side`);
        } else {
          assert.equal(layoutCheck.isStacked, true, `Viewport ${vp.width}x${vp.height} must stack 1 column (Config on top, Roster below)`);
        }
        fs.writeFileSync(path.join(ARTIFACT_DIR, vp.file), await page.screenshot());
      }

      // 9. Verify Create Game (?tab=demo) synchronized roster UI, collapsible panels, search, expand/collapse >5 rows, Light/Dark theme, and 5 viewports
      await page.setViewport({ width: 1440, height: 900, mobile: false });
      await page.goto(`${baseUrl}/?tab=demo`, { settleMs: 900 });
      await page.eval(`document.documentElement.setAttribute('data-theme', 'light')`);
      await sleep(250);

      // Default PLAY mode -> switch to EXAM mode and check default collapsed state
      const createRosterDefault = await page.eval(`
        (async () => {
          const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          const sessionSelect = document.querySelector('[data-testid="session-mode-select"]');
          const modeDescBefore = document.querySelector('[data-testid="creator-roster-mode-desc"]')?.textContent?.trim() || '';
          selectSetter.call(sessionSelect, 'EXAM');
          sessionSelect.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 120));
          const rosterCard = document.querySelector('[data-testid="creator-roster-section"]');
          const cardBg = rosterCard ? window.getComputedStyle(rosterCard).backgroundColor : '';
          return {
            modeDescBefore,
            modeDescExam: document.querySelector('[data-testid="creator-roster-mode-desc"]')?.textContent?.trim() || '',
            hasRosterCard: Boolean(rosterCard),
            cardBg,
            hasManualPanelOpenByDefault: Boolean(document.querySelector('[data-testid="creator-roster-manual-panel"]')),
            hasBulkPanelOpenByDefault: Boolean(document.querySelector('[data-testid="creator-roster-bulk-panel"]')),
            hasEmptyNotice: Boolean(document.querySelector('[data-testid="creator-roster-exam-required-error"]')),
            hasManualToggleBtn: Boolean(document.querySelector('[data-testid="roster-tab-manual"]')),
            hasBulkToggleBtn: Boolean(document.querySelector('[data-testid="roster-tab-import"]')),
          };
        })()
      `);
      assert.equal(createRosterDefault.modeDescBefore, 'Tùy chọn — có thể để trống');
      assert.equal(createRosterDefault.modeDescExam, 'Bắt buộc — cần có danh sách thí sinh');
      assert.equal(createRosterDefault.hasRosterCard, true, 'Create Game EXAM mode must show roster card');
      assert.equal(createRosterDefault.cardBg, 'rgb(255, 255, 255)', 'Create Game roster card must use var(--bg-card) white in Light Theme');
      assert.equal(createRosterDefault.hasManualPanelOpenByDefault, false, 'Manual form must be collapsed by default on Create Game');
      assert.equal(createRosterDefault.hasBulkPanelOpenByDefault, false, 'Bulk import panel must be collapsed by default on Create Game');
      assert.equal(createRosterDefault.hasEmptyNotice, true, 'Empty roster notice must be visible in EXAM mode');
      assert.equal(createRosterDefault.hasManualToggleBtn, true);
      assert.equal(createRosterDefault.hasBulkToggleBtn, true);

      // Test manual add + draft preservation on collapse/reopen on Create Game
      await page.eval(`
        (() => {
          const btn = document.querySelector('[data-testid="roster-tab-manual"]');
          if (btn) btn.click();
        })()
      `);
      await sleep(200);
      await page.eval(`
        (() => {
          const setVal = (sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          setVal('[data-testid="roster-single-name-input"]', 'Đặng Quốc Bảo');
          setVal('[data-testid="roster-single-dept-input"]', 'Phòng Sản Xuất');
          setVal('[data-testid="roster-single-code-input"]', 'SX01');
        })()
      `);
      await sleep(150);

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_create_game_roster_manual_open_1440x900.png'),
        await page.screenshot()
      );

      // Collapse and reopen manual panel -> verify draft is preserved
      await page.eval(`document.querySelector('[data-testid="creator-roster-cancel-manual-btn"]')?.click()`);
      await sleep(150);
      await page.eval(`document.querySelector('[data-testid="roster-tab-manual"]')?.click()`);
      await sleep(150);
      const createManualDraftPreserved = await page.eval(`
        (() => ({
          name: document.querySelector('[data-testid="roster-single-name-input"]')?.value || '',
          dept: document.querySelector('[data-testid="roster-single-dept-input"]')?.value || '',
          code: document.querySelector('[data-testid="roster-single-code-input"]')?.value || '',
        }))()
      `);
      assert.equal(createManualDraftPreserved.name, 'Đặng Quốc Bảo');
      assert.equal(createManualDraftPreserved.dept, 'Phòng Sản Xuất');
      assert.equal(createManualDraftPreserved.code, 'SX01');

      // Confirm manual add
      await page.eval(`document.querySelector('[data-testid="roster-add-single-btn"]')?.click()`);
      await sleep(200);

      // Open Bulk panel -> Dán nhanh 6 more participants (including 1 duplicate + 1 invalid row) to test >5 summary list, search, and expand/collapse
      await page.eval(`document.querySelector('[data-testid="roster-tab-import"]')?.click()`);
      await sleep(200);
      await page.eval(`
        (() => {
          const ta = document.querySelector('[data-testid="creator-roster-manual-textarea"]');
          if (!ta) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(
            ta,
            [
              'Đặng Quốc Bảo | Phòng Sản Xuất | SX01',
              'Nguyễn Thị Mai | Phòng Kế Toán | KT01',
              ' Nguyễn Thị Mai | Phòng Nhân Sự | NS02',
              'Trần Văn Hùng | Phòng Kỹ Thuật | KT02',
              'Lê Thị Lan | Phòng Kinh Doanh | KD01',
              'Phạm Minh Tuấn | Phòng R&D | RD01',
              'Hoàng Gia Huy | Phòng Pháp Chế | PC01',
              '12345',
            ].join('\\n')
          );
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      await sleep(250);

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_create_game_roster_bulk_open_1440x900.png'),
        await page.screenshot()
      );

      // Collapse bulk panel to inspect default compact view with 7 valid participants (showing 5 by default)
      await page.eval(`document.querySelector('[data-testid="creator-roster-cancel-bulk-btn"]')?.click()`);
      await sleep(200);

      const createSummaryCheck = await page.eval(`
        (() => {
          const visibleRows = document.querySelectorAll('[data-testid^="creator-roster-row-"]').length;
          const badgeText = document.querySelector('[data-testid="roster-valid-count-badge"]')?.textContent?.trim() || '';
          const expandBtnText = document.querySelector('[data-testid="creator-roster-expand-list-btn"]')?.textContent?.trim() || '';
          const hasDupWarn = Boolean(document.querySelector('[data-testid="roster-duplicate-warning"]'));
          const hasInvalidErr = Boolean(document.querySelector('[data-testid="roster-invalid-lines-error"]'));
          return { visibleRows, badgeText, expandBtnText, hasDupWarn, hasInvalidErr };
        })()
      `);
      assert.equal(createSummaryCheck.badgeText, 'Hợp lệ: 7 người');
      assert.equal(createSummaryCheck.visibleRows, 5, 'Create Game roster list must show max 5 participants by default');
      assert.ok(createSummaryCheck.expandBtnText.includes('Xem tất cả (7)'));
      assert.equal(createSummaryCheck.hasDupWarn, true, 'Duplicate name warning must be shown');
      assert.equal(createSummaryCheck.hasInvalidErr, true, 'Invalid row warning must be shown');

      // Expand to see all 7, then collapse back to 5
      await page.eval(`document.querySelector('[data-testid="creator-roster-expand-list-btn"]')?.click()`);
      await sleep(150);
      const expandedRowCount = await page.eval(`document.querySelectorAll('[data-testid^="creator-roster-row-"]').length`);
      assert.equal(expandedRowCount, 7, 'Clicking Xem tất cả must reveal all 7 participants');
      await page.eval(`document.querySelector('[data-testid="creator-roster-expand-list-btn"]')?.click()`);
      await sleep(150);

      // Search filter check
      await page.eval(`
        (() => {
          const searchEl = document.querySelector('[data-testid="creator-roster-search-input"]');
          if (!searchEl) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(searchEl, 'Pháp Chế');
          searchEl.dispatchEvent(new Event('input', { bubbles: true }));
        })()
      `);
      await sleep(150);
      const searchMatchCount = await page.eval(`document.querySelectorAll('[data-testid^="creator-roster-row-"]').length`);
      assert.equal(searchMatchCount, 1, 'Searching "Pháp Chế" must filter down to 1 matching participant');
      await page.eval(`
        (() => {
          const searchEl = document.querySelector('[data-testid="creator-roster-search-input"]');
          if (!searchEl) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(searchEl, '');
          searchEl.dispatchEvent(new Event('input', { bubbles: true }));
        })()
      `);
      await sleep(150);

      // Capture Light & Dark Theme screenshots of Create Game roster card
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_create_game_roster_light_1440x900.png'),
        await page.screenshot()
      );
      await page.eval(`document.documentElement.setAttribute('data-theme', 'dark')`);
      await sleep(250);
      const createDarkCardBg = await page.eval(`
        (() => {
          const card = document.querySelector('[data-testid="creator-roster-section"]');
          return card ? window.getComputedStyle(card).backgroundColor : '';
        })()
      `);
      assert.equal(createDarkCardBg, 'rgb(21, 27, 46)', 'In Dark Theme, Create Game roster card must use var(--bg-card) #151b2e');
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_create_game_roster_dark_1440x900.png'),
        await page.screenshot()
      );
      await page.eval(`document.documentElement.setAttribute('data-theme', 'light')`);
      await sleep(200);

      // Verify Create Game across all 5 viewports (no horizontal overflow, roster preserved)
      for (const vp of [
        { width: 1440, height: 900, mobile: false },
        { width: 1366, height: 768, mobile: false },
        { width: 768, height: 1024, mobile: true },
        { width: 390, height: 844, mobile: true, file: 'v3_create_game_roster_390x844.png' },
        { width: 360, height: 800, mobile: true, file: 'v3_create_game_roster_360x800.png' },
      ]) {
        await page.setViewport({ width: vp.width, height: vp.height, mobile: vp.mobile });
        await sleep(300);
        const vpCheck = await page.eval(`
          (() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            badgeText: document.querySelector('[data-testid="roster-valid-count-badge"]')?.textContent?.trim() || '',
          }))()
        `);
        assert.ok(
          vpCheck.scrollWidth <= vpCheck.innerWidth + 2,
          `Create Game at ${vp.width}x${vp.height} must not overflow horizontally (${vpCheck.scrollWidth} > ${vpCheck.innerWidth})`
        );
        assert.equal(vpCheck.badgeText, 'Hợp lệ: 7 người');
        if (vp.file) {
          fs.writeFileSync(path.join(ARTIFACT_DIR, vp.file), await page.screenshot());
        }
      }
    } finally {
      await browser.close();
    }
  });
});
