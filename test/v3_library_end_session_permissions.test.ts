import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import supertest from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { roomService } from '../src/multiplayer/room.service.js';
import { MultiplayerWebSocketServer } from '../src/multiplayer/room.websocket.js';
import { authService } from '../src/services/auth.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { closeDatabase, getDatabase, initDatabase } from '../src/storage/sqlite.db.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const ARTIFACT_DIR = 'C:\\Users\\QUOC SIEU\\.gemini\\antigravity\\brain\\83ff8c51-8136-444f-904b-1284fcdde2fb';

const GUEST_TOKEN_A = 'gt_11111111111111111111111111111111';
const GUEST_TOKEN_B = 'gt_22222222222222222222222222222222';
const GUEST_TOKEN_C = 'gt_33333333333333333333333333333333';
const GUEST_TOKEN_D = 'gt_44444444444444444444444444444444';
const GUEST_TOKEN_E = 'gt_55555555555555555555555555555555';
const GUEST_TOKEN_F = 'gt_66666666666666666666666666666666';

const DEFAULT_SOURCE_REF = {
  sourceId: 'src_v3_end_session_perm',
  sourceType: 'TXT' as const,
  sourceLocation: 'manual.txt',
};

const DEFAULT_SOURCE_SUMMARY = {
  sourceCount: 1,
  sources: [
    {
      sourceId: 'src_v3_end_session_perm',
      sourceType: 'TXT' as const,
      sourceName: 'manual.txt',
      sourceLocation: 'manual.txt',
    },
  ],
};

function buildGameSpec(overrides: Partial<GameSpecification> & { gameId: string }): GameSpecification {
  return {
    gameId: overrides.gameId,
    title: overrides.title || `Game Quản Lý Phiên ${overrides.gameId}`,
    description: overrides.description || 'Bộ câu hỏi kiểm thử quyền kết thúc phiên chơi trong Thư viện',
    gameType: overrides.gameType || 'MULTIPLE_CHOICE',
    isPublic: overrides.isPublic ?? true,
    ownerUserId: overrides.ownerUserId !== undefined ? overrides.ownerUserId : null,
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
        question: 'Câu 1: Thủ đô của Việt Nam là gì?',
        choices: ['Hà Nội', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Cần Thơ'],
        correctAnswer: 'Hà Nội',
        explanation: 'Hà Nội là thủ đô của Việt Nam.',
        difficulty: 'EASY',
        points: 100,
        timeLimitSeconds: 20,
        sourceReference: DEFAULT_SOURCE_REF,
      },
      {
        id: `${overrides.gameId}_q2`,
        type: 'MULTIPLE_CHOICE',
        question: 'Câu 2: Giao thức bảo mật web tiêu chuẩn là gì?',
        choices: ['HTTPS', 'HTTP', 'FTP', 'Telnet'],
        correctAnswer: 'HTTPS',
        explanation: 'HTTPS mã hóa kết nối bằng TLS/SSL.',
        difficulty: 'EASY',
        points: 100,
        timeLimitSeconds: 20,
        sourceReference: DEFAULT_SOURCE_REF,
      },
    ],
  };
}

describe('V3 LIBRARY END SESSION & CLOSE ROOM PERMISSIONS (6 ACCESS CONTROL + 10 FUNCTIONAL + BROWSER E2E)', () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: http.Server;
  let wsServer: MultiplayerWebSocketServer;
  let baseUrl: string;

  let creatorAToken: string;
  let creatorAUser: any;
  let creatorBToken: string;
  let creatorBUser: any;
  let playerUserToken: string;
  let playerUser: any;
  let adminToken: string;
  let adminUser: any;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_game_v3_end_session_'));
    tempDbPath = path.join(tempDir, 'test_v3_end_session.sqlite');
    initDatabase(tempDbPath);
    resetAllRateLimiters();

    server = http.createServer(app);
    wsServer = new MultiplayerWebSocketServer();
    wsServer.attach(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const regAdmin = authService.register({
      email: 'admin_end_session_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'System Admin V3',
    });
    adminToken = regAdmin.token;
    adminUser = regAdmin.user;
    if (adminUser.role !== 'ADMIN') {
      getDatabase().prepare("UPDATE users SET role = 'ADMIN' WHERE user_id = ?").run(adminUser.userId);
      adminUser.role = 'ADMIN';
    }

    const regCreatorA = authService.register({
      email: 'creator_a_end_session_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Creator A (Chủ sở hữu Game A)',
    });
    creatorAToken = regCreatorA.token;
    creatorAUser = regCreatorA.user;
    assert.equal(creatorAUser.role, 'USER', 'Creator A must have standard USER role, not ADMIN');

    const regCreatorB = authService.register({
      email: 'creator_b_end_session_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Creator B (Chủ sở hữu Game B)',
    });
    creatorBToken = regCreatorB.token;
    creatorBUser = regCreatorB.user;
    assert.equal(creatorBUser.role, 'USER', 'Creator B must have standard USER role, not ADMIN');

    const regPlayerUser = authService.register({
      email: 'player_user_end_session_v3@matbao.ws',
      password: 'Password123!',
      displayName: 'Player User',
    });
    playerUserToken = regPlayerUser.token;
    playerUser = regPlayerUser.user;
  });

  after(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    gameStore.clear();
    sessionStore.clear();
    roomStore.clear();
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error on Windows
    }
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  // =========================================================================
  // NHÓM KIỂM THỬ PHÂN QUYỀN (6 CASES BẮT BUỘC)
  // =========================================================================

  it('Access Control Case 1: Creator A kết thúc phiên của Game A (kể cả game của Creator A có Bearer token và game local trên trình duyệt) -> 200 OK', async () => {
    // 1A: Authenticated Creator A owns Game A
    const gameAId = `game_a_ac1_${Date.now()}`;
    const specA = buildGameSpec({ gameId: gameAId, ownerUserId: creatorAUser.userId });
    gameStore.save(specA, Date.now(), creatorAUser.userId, true);

    // Another player (or guest) starts a session on Game A
    const createSessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .send({ gameId: gameAId, playerName: 'Khách Chơi Game A' });
    assert.equal(createSessRes.status, 200);
    const sessionId = createSessRes.body.data.sessionId;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_A);

    // Creator A ends the session on Game A from Library (without participant lockToken, using Creator A's token)
    const endRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endRes.status, 200);
    assert.equal(endRes.body.data.ended, true);
    assert.equal(endRes.body.data.session.state, 'ABANDONED');

    // 1B: Local Browser Organizer (no Bearer token, unowned local game in browser) ends session
    const localGameId = `game_local_ac1_${Date.now()}`;
    const localSpec = buildGameSpec({ gameId: localGameId, ownerUserId: null });
    gameStore.save(localSpec, Date.now(), null, true);

    const localSessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_B)
      .send({ gameId: localGameId, playerName: 'Người chơi trên game Local' });
    assert.equal(localSessRes.status, 200);
    const localSessionId = localSessRes.body.data.sessionId;

    // Local Creator in Library calls /end with clean headers (no X-Guest-Token)
    const endLocalRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${localSessionId}/end`);
    assert.equal(endLocalRes.status, 200);
    assert.equal(endLocalRes.body.data.ended, true);
    assert.equal(endLocalRes.body.data.session.state, 'ABANDONED');
  });

  it('Access Control Case 2: Creator A kết thúc phiên của Game B (thuộc sở hữu của Creator B) -> 403 Forbidden', async () => {
    const gameBId = `game_b_ac2_${Date.now()}`;
    const specB = buildGameSpec({ gameId: gameBId, ownerUserId: creatorBUser.userId });
    gameStore.save(specB, Date.now(), creatorBUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorBToken}`)
      .send({ gameId: gameBId, playerName: 'Creator B' });
    assert.equal(sessRes.status, 200);
    const sessionBId = sessRes.body.data.sessionId;

    // Creator A attempts to end session of Game B -> 403 ACCESS_DENIED
    const endByARes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionBId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endByARes.status, 403);
    assert.equal(endByARes.body.error.code, 'ACCESS_DENIED');

    // Also verify Multiplayer Room close: Creator A cannot close room of Game B
    const roomBRes = await supertest(baseUrl)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorBToken}`)
      .send({ gameId: gameBId, capacity: 20 });
    assert.equal(roomBRes.status, 200);
    const roomBCode = roomBRes.body.data.roomCode;

    const closeRoomByARes = await supertest(baseUrl)
      .post(`/api/rooms/${roomBCode}/close`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(closeRoomByARes.status, 403);
    assert.equal(closeRoomByARes.body.error.code, 'ACCESS_DENIED');

    // Clean up by Creator B
    await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionBId}/end`)
      .set('Authorization', `Bearer ${creatorBToken}`);
    await supertest(baseUrl)
      .post(`/api/rooms/${roomBCode}/close`)
      .set('Authorization', `Bearer ${creatorBToken}`);
  });

  it('Access Control Case 3: Creator B kết thúc phiên của Game A (thuộc sở hữu của Creator A) -> 403 Forbidden', async () => {
    const gameAId = `game_a_ac3_${Date.now()}`;
    const specA = buildGameSpec({ gameId: gameAId, ownerUserId: creatorAUser.userId });
    gameStore.save(specA, Date.now(), creatorAUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ gameId: gameAId, playerName: 'Creator A' });
    assert.equal(sessRes.status, 200);
    const sessionAId = sessRes.body.data.sessionId;

    const endByBRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('Authorization', `Bearer ${creatorBToken}`);
    assert.equal(endByBRes.status, 403);
    assert.equal(endByBRes.body.error.code, 'ACCESS_DENIED');

    // Clean up by Creator A
    const endByARes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endByARes.status, 200);
  });

  it('Access Control Case 4: Guest kết thúc phiên của Game A -> 401/403', async () => {
    const gameAId = `game_a_ac4_${Date.now()}`;
    const specA = buildGameSpec({ gameId: gameAId, ownerUserId: creatorAUser.userId });
    gameStore.save(specA, Date.now(), creatorAUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_C)
      .send({ gameId: gameAId, playerName: 'Guest Player AC4' });
    assert.equal(sessRes.status, 200);
    const sessionAId = sessRes.body.data.sessionId;

    // 4A: Request with X-Guest-Token -> 403 ACCESS_DENIED
    const guestHeaderEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('X-Guest-Token', GUEST_TOKEN_C);
    assert.equal(guestHeaderEndRes.status, 403);
    assert.equal(guestHeaderEndRes.body.error.code, 'ACCESS_DENIED');

    // 4B: Unauthenticated request on Creator A's owned game -> 403 ACCESS_DENIED
    const unauthEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`);
    assert.equal(unauthEndRes.status, 403);
    assert.equal(unauthEndRes.body.error.code, 'ACCESS_DENIED');

    // Clean up by Creator A
    await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
  });

  it('Access Control Case 5: Player kết thúc phiên của Game A -> 403 Forbidden', async () => {
    const gameAId = `game_a_ac5_${Date.now()}`;
    const specA = buildGameSpec({ gameId: gameAId, ownerUserId: creatorAUser.userId });
    gameStore.save(specA, Date.now(), creatorAUser.userId, true);

    // Non-owner authenticated Player User starts a session on Game A
    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${playerUserToken}`)
      .send({ gameId: gameAId, playerName: 'Player User AC5' });
    assert.equal(sessRes.status, 200);
    const sessionAId = sessRes.body.data.sessionId;
    const participantToken = sessRes.body.data.lockToken;

    // 5A: Request with X-Player-Token -> 403 ACCESS_DENIED
    const playerTokenEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('X-Player-Token', 'pt_player_12345');
    assert.equal(playerTokenEndRes.status, 403);
    assert.equal(playerTokenEndRes.body.error.code, 'ACCESS_DENIED');

    // 5B: Request with X-Participant-Token (from non-owner player) -> 403 ACCESS_DENIED
    const participantTokenEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('X-Participant-Token', participantToken);
    assert.equal(participantTokenEndRes.status, 403);
    assert.equal(participantTokenEndRes.body.error.code, 'ACCESS_DENIED');

    // 5C: Non-owner authenticated Player User (who started the session) attempts to end session on Game A -> 403 ACCESS_DENIED
    const nonOwnerPlayerEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('Authorization', `Bearer ${playerUserToken}`);
    assert.equal(nonOwnerPlayerEndRes.status, 403);
    assert.equal(nonOwnerPlayerEndRes.body.error.code, 'ACCESS_DENIED');

    // Clean up by Creator A -> 200 OK
    const ownerEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(ownerEndRes.status, 200);
  });

  it('Access Control Case 6: ADMIN kết thúc phiên theo đúng chính sách hiện tại -> 200 OK', async () => {
    const gameAId = `game_a_ac6_${Date.now()}`;
    const specA = buildGameSpec({ gameId: gameAId, ownerUserId: creatorAUser.userId });
    gameStore.save(specA, Date.now(), creatorAUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ gameId: gameAId, playerName: 'Creator A' });
    assert.equal(sessRes.status, 200);
    const sessionAId = sessRes.body.data.sessionId;

    // System ADMIN ends session of Creator A's game -> 200 OK
    const adminEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionAId}/end`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminEndRes.status, 200);
    assert.equal(adminEndRes.body.data.ended, true);
    assert.equal(adminEndRes.body.data.session.state, 'ABANDONED');
  });

  // =========================================================================
  // NHÓM KIỂM THỬ CHỨC NĂNG (10 CASES BẮT BUỘC)
  // =========================================================================

  it('Functional Case 1: Kết thúc phiên khi đang có phiên chơi active (QUESTION_ACTIVE)', async () => {
    const gameId = `game_fn1_${Date.now()}`;
    const spec = buildGameSpec({ gameId, ownerUserId: creatorAUser.userId });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .send({ gameId, playerName: 'Người chơi FN1' });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    const startRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_A);
    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.data.session.state, 'QUESTION_ACTIVE');

    // Verify game status shows active session
    const statusBefore = await supertest(baseUrl)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(statusBefore.body.data.hasActiveSession, true);
    assert.equal(statusBefore.body.data.activeSessionCount, 1);

    // Creator A ends the active session
    const endRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endRes.status, 200);
    assert.equal(endRes.body.data.ended, true);
    assert.equal(endRes.body.data.session.state, 'ABANDONED');

    // Verify game status immediately reflects 0 active sessions
    const statusAfter = await supertest(baseUrl)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(statusAfter.body.data.hasActiveSession, false);
    assert.equal(statusAfter.body.data.activeSessionCount, 0);
  });

  it('Functional Case 2: Kết thúc/Đóng phòng khi đang có người chơi trong phòng (WAITING & QUESTION_ACTIVE)', async () => {
    const gameId = `game_fn2_${Date.now()}`;
    const spec = buildGameSpec({ gameId, ownerUserId: creatorAUser.userId });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    const roomRes = await supertest(baseUrl)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({ gameId, capacity: 25 });
    assert.equal(roomRes.status, 200);
    const { roomCode } = roomRes.body.data;

    // 2 players join the room
    const roomObj = roomService.getRoomByCode(roomCode);
    roomObj.addPlayer('Player 1 In Room');
    roomObj.addPlayer('Player 2 In Room');
    assert.equal(roomObj.players.size, 2);

    // Creator A closes the room from Library using Creator A's Bearer token (even without hostToken)
    const closeRes = await supertest(baseUrl)
      .post(`/api/rooms/${roomCode}/close`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.body.data.closed, true);
    assert.equal(closeRes.body.data.state, 'CLOSED');

    const statusAfter = await supertest(baseUrl)
      .get(`/api/games/${gameId}/status`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(statusAfter.body.data.hasActiveRoom, false);
  });

  it('Functional Case 3: Kết thúc phiên ở chế độ CHƠI (PLAY)', async () => {
    const gameId = `game_fn3_play_${Date.now()}`;
    const spec = buildGameSpec({
      gameId,
      ownerUserId: creatorAUser.userId,
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'PLAY',
      },
    });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_B)
      .send({ gameId, playerName: 'Người chơi PLAY' });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_B);

    const endRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endRes.status, 200);
    assert.equal(endRes.body.data.ended, true);
    assert.equal(endRes.body.data.session.state, 'ABANDONED');
  });

  it('Functional Case 4: Kết thúc phiên ở chế độ THI (EXAM) và giải phóng khóa thí sinh đang làm dở', async () => {
    const gameId = `game_fn4_exam_${Date.now()}`;
    const spec = buildGameSpec({
      gameId,
      ownerUserId: creatorAUser.userId,
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'EXAM',
        examAnswerRevealPolicy: 'AFTER_PUBLISH',
      },
    });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    // Add roster participant
    const rosterRes = await supertest(baseUrl)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        replaceAll: true,
        rosterMode: 'PRECONFIGURED',
        participants: [{ fullName: 'Nguyễn Minh Khoa', departmentUnit: 'Phòng Kỹ Thuật', employeeCode: 'KT01' }],
      });
    assert.equal(rosterRes.status, 200);
    const participantId = rosterRes.body.data.participants[0].participantId;

    // Candidate starts EXAM session
    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_C)
      .send({ gameId, participantId, playerName: 'Nguyễn Minh Khoa' });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;
    const lockToken = sessRes.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Participant-Token', lockToken);

    // Verify participant is IN_PROGRESS with activeSessionId
    const pBefore = persistenceRepo.getParticipantById(gameId, participantId, true);
    assert.equal(pBefore?.status, 'IN_PROGRESS');
    assert.equal(pBefore?.activeSessionId, sessionId);

    // Creator A ends the EXAM session from Library
    const endRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endRes.status, 200);
    assert.equal(endRes.body.data.ended, true);
    assert.equal(endRes.body.data.session.state, 'ABANDONED');

    // Verify participant activeSessionId lock is released so they are not permanently stuck
    const pAfter = persistenceRepo.getParticipantById(gameId, participantId, true);
    assert.equal(pAfter?.activeSessionId, null);
    assert.equal(pAfter?.isLocked, false);
    assert.equal(pAfter?.status, 'PENDING');
  });

  it('Functional Case 5: Kết thúc phiên khi phiên đã kết thúc trước đó (Idempotent, không ghi đè trạng thái FINISHED)', async () => {
    const gameId = `game_fn5_idempotent_${Date.now()}`;
    const spec = buildGameSpec({ gameId, ownerUserId: creatorAUser.userId });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    // 5A: Session already ended via /end -> calling /end again returns 200 OK with alreadyEnded: true
    const sess1Res = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_D)
      .send({ gameId, playerName: 'Player 1' });
    assert.equal(sess1Res.status, 200);
    const session1Id = sess1Res.body.data.sessionId;

    const firstEnd = await supertest(baseUrl)
      .post(`/api/games/sessions/${session1Id}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(firstEnd.status, 200);
    assert.equal(firstEnd.body.data.alreadyEnded, false);

    const secondEnd = await supertest(baseUrl)
      .post(`/api/games/sessions/${session1Id}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(secondEnd.status, 200);
    assert.equal(secondEnd.body.data.ended, true);
    assert.equal(secondEnd.body.data.alreadyEnded, true);
    assert.equal(secondEnd.body.data.session.state, 'ABANDONED');

    // 5B: Session already FINISHED normally -> calling /end preserves FINISHED state and score
    const sess2Res = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_E)
      .send({ gameId, playerName: 'Player 2 Completed' });
    assert.equal(sess2Res.status, 200);
    const session2Id = sess2Res.body.data.sessionId;
    const pToken2 = sess2Res.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${session2Id}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_E)
      .set('X-Participant-Token', pToken2);
    await supertest(baseUrl)
      .post(`/api/games/sessions/${session2Id}/answer`)
      .set('X-Guest-Token', GUEST_TOKEN_E)
      .set('X-Participant-Token', pToken2)
      .send({ questionId: `${gameId}_q1`, answer: 'Hà Nội' });
    await supertest(baseUrl)
      .post(`/api/games/sessions/${session2Id}/next`)
      .set('X-Guest-Token', GUEST_TOKEN_E)
      .set('X-Participant-Token', pToken2);
    await supertest(baseUrl)
      .post(`/api/games/sessions/${session2Id}/answer`)
      .set('X-Guest-Token', GUEST_TOKEN_E)
      .set('X-Participant-Token', pToken2)
      .send({ questionId: `${gameId}_q2`, answer: 'HTTPS' });
    const finRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${session2Id}/next`)
      .set('X-Guest-Token', GUEST_TOKEN_E)
      .set('X-Participant-Token', pToken2);
    assert.equal(finRes.body.data.finished, true);

    // Calling /end on already FINISHED session does not downgrade FINISHED to ABANDONED
    const endAfterFin = await supertest(baseUrl)
      .post(`/api/games/sessions/${session2Id}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endAfterFin.status, 200);
    assert.equal(endAfterFin.body.data.alreadyEnded, true);
    assert.equal(endAfterFin.body.data.session.state, 'FINISHED');
    assert.equal(endAfterFin.body.data.session.score, 200);
  });

  it('Functional Case 6: Kết thúc phiên không tồn tại -> 404 SESSION_NOT_FOUND / ROOM_NOT_FOUND', async () => {
    const missingSessRes = await supertest(baseUrl)
      .post('/api/games/sessions/sess_non_existent_999999/end')
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(missingSessRes.status, 404);
    assert.equal(missingSessRes.body.error.code, 'SESSION_NOT_FOUND');

    const missingRoomRes = await supertest(baseUrl)
      .post('/api/rooms/999999/close')
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(missingRoomRes.status, 404);
    assert.equal(missingRoomRes.body.error.code, 'ROOM_NOT_FOUND');
  });

  it('Functional Case 7 & 8 & Browser E2E: Giao diện Thư viện cập nhật trạng thái ngay sau khi kết thúc phiên & Reload trang Thư viện vẫn hiển thị phiên đã kết thúc', async () => {
    const browserGameId = `game_e2e_end_session_${Date.now()}`;
    const spec = buildGameSpec({
      gameId: browserGameId,
      title: 'E2E Kết Thúc Phiên Chơi Trong Thư Viện',
      ownerUserId: creatorAUser.userId,
      isPublic: true,
    });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    // Start an active solo session on this game by a guest player
    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_F)
      .send({ gameId: browserGameId, playerName: 'Học Viên Đang Làm Bài' });
    assert.equal(sessRes.status, 200);
    const activeSessionId = sessRes.body.data.sessionId;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${activeSessionId}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_F);

    const browser = await Browser.launch({ width: 1440, height: 900 });
    try {
      const page = await browser.newPage({ width: 1440, height: 900 });
      await page.setViewport({ width: 1440, height: 900, mobile: false });

      // 1. Login as Creator A and open Thư viện (/?tab=library)
      await page.goto(`${baseUrl}/`, { settleMs: 500 });
      await page.eval(`
        sessionStorage.setItem('ai_game_admin_session_token', ${JSON.stringify(creatorAToken)});
      `);
      await page.goto(`${baseUrl}/?tab=library`, { settleMs: 1100 });

      // Wait for Library Card to render with "Đang chơi đơn (1)" and direct "Kết thúc phiên chơi" button
      let cardHasEndBtn = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        cardHasEndBtn = await page.eval(`
          Boolean(document.querySelector('[data-testid="library-card-end-session-btn-${browserGameId}"]'))
        `);
        if (cardHasEndBtn) break;
        await sleep(250);
      }
      assert.equal(cardHasEndBtn, true, 'Library card must display direct Kết thúc phiên chơi button for owner');

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_card_active_session_1440x900.png'),
        await page.screenshot()
      );

      // 2. Open game detail (Quản lý game) in Library
      await page.eval(`
        document.querySelector('[data-testid="library-card-detail-btn-${browserGameId}"]')?.click();
      `);
      await sleep(700);

      const detailHasEndBtn = await page.eval(`
        Boolean(document.querySelector('[data-testid="library-detail-end-session-btn"]'))
      `);
      assert.equal(detailHasEndBtn, true, 'Library game detail header must display Kết thúc phiên chơi button');

      // 3. Click "Kết thúc phiên chơi"
      await page.eval(`
        document.querySelector('[data-testid="library-detail-end-session-btn"]')?.click();
      `);
      await sleep(300);

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_confirm_end_session_modal_1440x900.png'),
        await page.screenshot()
      );

      // 4. Confirm in modal ("Xác nhận kết thúc phiên")
      await page.eval(`
        document.querySelector('[data-testid="confirm-end-session-btn"]')?.click();
      `);
      await sleep(900);

      // 5. Verify UI updates immediately: "Kết thúc phiên chơi" button disappears & active session count is 0
      const detailAfterEnd = await page.eval(`
        ({
          hasDetailEndBtn: Boolean(document.querySelector('[data-testid="library-detail-end-session-btn"]')),
          bodyText: document.body.innerText || '',
        })
      `);
      assert.equal(
        detailAfterEnd.hasDetailEndBtn,
        false,
        'After ending session, Kết thúc phiên chơi button in detail view must disappear immediately'
      );

      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'v3_library_after_end_session_1440x900.png'),
        await page.screenshot()
      );

      // 6. Reload Library page and verify session remains ended
      await page.goto(`${baseUrl}/?tab=library`, { settleMs: 1100 });
      let afterReloadCheck = { hasCardEndBtn: false, cardExists: false };
      for (let attempt = 0; attempt < 25; attempt++) {
        afterReloadCheck = await page.eval(`
          ({
            hasCardEndBtn: Boolean(document.querySelector('[data-testid="library-card-end-session-btn-${browserGameId}"]')),
            cardExists: Boolean(document.querySelector('[data-testid="library-card-open-btn-${browserGameId}"]')),
          })
        `);
        if (afterReloadCheck.cardExists) break;
        await sleep(250);
      }
      assert.equal(afterReloadCheck.cardExists, true, 'Game card must still be visible in Library after reload');
      assert.equal(
        afterReloadCheck.hasCardEndBtn,
        false,
        'After reloading Library page, session must remain ended (no active session badge/button)'
      );
    } finally {
      await browser.close();
    }
  });

  it('Functional Case 9: Người chơi không thể tiếp tục nộp câu trả lời sau khi phiên đã kết thúc', async () => {
    const gameId = `game_fn9_block_submit_${Date.now()}`;
    const spec = buildGameSpec({ gameId, ownerUserId: creatorAUser.userId });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    const sessRes = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .send({ gameId, playerName: 'Player FN9' });
    assert.equal(sessRes.status, 200);
    const sessionId = sessRes.body.data.sessionId;
    const pToken = sessRes.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken);

    // Creator A ends the session
    const endRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endRes.status, 200);

    // Player tries to submit an answer after session was ended -> 400 INVALID_GAME_STATE
    const answerAfterEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken)
      .send({ questionId: `${gameId}_q1`, answer: 'Hà Nội' });
    assert.equal(answerAfterEndRes.status, 400);
    assert.equal(answerAfterEndRes.body.error.code, 'INVALID_GAME_STATE');

    // Player tries to advance to next question after session was ended -> 400 INVALID_GAME_STATE
    const nextAfterEndRes = await supertest(baseUrl)
      .post(`/api/games/sessions/${sessionId}/next`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken);
    assert.equal(nextAfterEndRes.status, 400);
    assert.equal(nextAfterEndRes.body.error.code, 'INVALID_GAME_STATE');
  });

  it('Functional Case 10: Dữ liệu điểm/lịch sử hợp lệ trước khi kết thúc phiên không bị mất', async () => {
    const gameId = `game_fn10_preserve_history_${Date.now()}`;
    const spec = buildGameSpec({
      gameId,
      ownerUserId: creatorAUser.userId,
      settings: {
        questionCount: 2,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        sessionMode: 'EXAM',
        examAnswerRevealPolicy: 'IMMEDIATE',
      },
    });
    gameStore.save(spec, Date.now(), creatorAUser.userId, true);

    // Add 2 candidates to roster
    const rosterRes = await supertest(baseUrl)
      .post(`/api/games/${gameId}/participants`)
      .set('Authorization', `Bearer ${creatorAToken}`)
      .send({
        replaceAll: true,
        rosterMode: 'PRECONFIGURED',
        participants: [
          { fullName: 'Trần Thị Mai (Đã Hoàn Thành)', departmentUnit: 'Phòng Kế Toán', employeeCode: 'KT01' },
          { fullName: 'Lê Văn Nam (Đang Thi Dở)', departmentUnit: 'Phòng Kinh Doanh', employeeCode: 'KD02' },
        ],
      });
    assert.equal(rosterRes.status, 200);
    const candidateCompleted = rosterRes.body.data.participants[0];
    const candidateInProgress = rosterRes.body.data.participants[1];

    // Candidate 1 completes the exam with 200/200 score
    const s1Res = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .send({
        gameId,
        participantId: candidateCompleted.participantId,
        playerName: candidateCompleted.fullName,
      });
    assert.equal(s1Res.status, 200);
    const s1Id = s1Res.body.data.sessionId;
    const pToken1 = s1Res.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken1);
    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/answer`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken1)
      .send({ questionId: `${gameId}_q1`, answer: 'Hà Nội' });
    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/next`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken1);
    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/answer`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken1)
      .send({ questionId: `${gameId}_q2`, answer: 'HTTPS' });
    await supertest(baseUrl)
      .post(`/api/games/sessions/${s1Id}/next`)
      .set('X-Guest-Token', GUEST_TOKEN_A)
      .set('X-Participant-Token', pToken1);

    // Candidate 2 starts the exam, answers Question 1 (100 pts), and stays in progress
    const s2Res = await supertest(baseUrl)
      .post('/api/games/sessions')
      .set('X-Guest-Token', GUEST_TOKEN_B)
      .send({
        gameId,
        participantId: candidateInProgress.participantId,
        playerName: candidateInProgress.fullName,
      });
    assert.equal(s2Res.status, 200);
    const s2Id = s2Res.body.data.sessionId;
    const pToken2 = s2Res.body.data.lockToken;

    await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/start`)
      .set('X-Guest-Token', GUEST_TOKEN_B)
      .set('X-Participant-Token', pToken2);
    await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/answer`)
      .set('X-Guest-Token', GUEST_TOKEN_B)
      .set('X-Participant-Token', pToken2)
      .send({ questionId: `${gameId}_q1`, answer: 'Hà Nội' });

    // Creator A ends Candidate 2's active session from Library
    const endS2Res = await supertest(baseUrl)
      .post(`/api/games/sessions/${s2Id}/end`)
      .set('Authorization', `Bearer ${creatorAToken}`);
    assert.equal(endS2Res.status, 200);
    assert.equal(endS2Res.body.data.session.score, 100, 'Partial score of ended session must be preserved');

    // Verify Candidate 1's completed score (200) and COMPLETED status are 100% intact
    const p1Record = persistenceRepo.getParticipantById(gameId, candidateCompleted.participantId, true);
    assert.equal(p1Record?.status, 'COMPLETED');
    assert.equal(p1Record?.bestScore, 200);
    assert.equal(p1Record?.latestScore, 200);

    // Verify both sessions exist in solo session history and Candidate 2's partial score (100) is recorded
    const soloHistories = persistenceRepo.listPracticeSessions({ gameId, isAdmin: true, limit: 10 });
    const h1 = soloHistories.find((h) => h.sessionId === s1Id);
    const h2 = soloHistories.find((h) => h.sessionId === s2Id);
    assert.ok(h1, 'Completed session s1 history must be preserved');
    assert.equal(h1.state, 'FINISHED');
    assert.equal(h1.totalScore, 200);
    assert.ok(h2, 'Ended session s2 history must be saved');
    assert.equal(h2.state, 'ABANDONED');
    assert.equal(h2.totalScore, 100);
  });
});
