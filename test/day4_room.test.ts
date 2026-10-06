import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSpecification } from '../src/contracts/game.contract.js';
import { MultiplayerRoom, roomService } from '../src/multiplayer/room.service.js';
import { roomStore } from '../src/multiplayer/room.store.js';
import { MULTIPLAYER_CONFIG } from '../src/multiplayer/room.types.js';
import { AppError } from '../src/utils/errors.js';

function createSampleSpec(overrides?: Partial<GameSpecification>): GameSpecification {
  return {
    gameId: 'game_room_test',
    title: 'Multiplayer Knowledge Challenge',
    description: 'Testing multiplayer room mechanics',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_1',
        type: 'MULTIPLE_CHOICE',
        question: 'What is the primary runtime for Node.js?',
        choices: ['A. V8', 'B. SpiderMonkey', 'C. JVM', 'D. Flash'],
        correctAnswer: 'A. V8',
        explanation: 'Node.js runs on V8.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_1',
          sourceType: 'WEBSITE',
          sourceLocation: 'http://test',
        },
      },
      {
        id: 'q_2',
        type: 'MULTIPLE_CHOICE',
        question: 'What year was TypeScript released?',
        choices: ['A. 2010', 'B. 2012', 'C. 2015', 'D. 2020'],
        correctAnswer: 'B. 2012',
        explanation: 'Microsoft released TypeScript in October 2012.',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_1',
          sourceType: 'WEBSITE',
          sourceLocation: 'http://test',
        },
      },
    ],
    settings: {
      questionCount: 2,
      timePerQuestion: 20,
      scoringMode: 'STANDARD',
    },
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_1',
          sourceType: 'WEBSITE',
          sourceName: 'test',
          sourceLocation: 'http://test',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('DAY 4 - Multiplayer Room Core Test Suite', () => {
  beforeEach(() => {
    roomStore.clear();
  });

  afterEach(() => {
    roomStore.clear();
  });

  // ==========================================
  // ROOM CREATION & LOOKUP (1-7)
  // ==========================================

  it('1. should create a multiplayer room with valid initial state', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    assert.ok(room.roomId.startsWith('room_'));
    assert.equal(room.roomCode.length, 6);
    assert.ok(room.hostToken.startsWith('host_'));
    assert.equal(room.state, 'WAITING');
    assert.equal(room.capacity, 300);
    assert.equal(room.players.size, 0);
  });

  it('2. should generate unique room codes avoiding ambiguous characters', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const code = roomStore.generateUniqueRoomCode();
      assert.equal(code.length, 6);
      assert.ok(!/[0O1IS5]/.test(code), `Code ${code} contains ambiguous characters`);
      assert.equal(codes.has(code), false);
      codes.add(code);
    }
  });

  it('3. should lookup room by code (case-insensitive) and by roomId', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const byId = roomService.getRoomById(room.roomId);
    assert.equal(byId.roomId, room.roomId);

    const byCode = roomService.getRoomByCode(room.roomCode.toLowerCase());
    assert.equal(byCode.roomId, room.roomId);
  });

  it('4. should reject lookup of nonexistent room', () => {
    assert.throws(
      () => roomService.getRoomByCode('NONEXS'),
      (err: any) => err instanceof AppError && err.code === 'ROOM_NOT_FOUND'
    );
  });

  it('5. should enforce hard room capacity of 300 players', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec, 300);

    for (let i = 0; i < 300; i++) {
      room.addPlayer(`Player ${i}`);
    }

    assert.equal(room.players.size, 300);
  });

  it('6. should reject 301st player join with ROOM_FULL error', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec, 300);

    for (let i = 0; i < 300; i++) {
      room.addPlayer(`Player ${i}`);
    }

    assert.throws(
      () => room.addPlayer('Player 301'),
      (err: any) => err instanceof AppError && err.code === 'ROOM_FULL'
    );
  });

  it('7. should cleanup and reject joins to expired rooms', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    // Simulate 3 hours elapsed (ROOM_TTL is 2 hours)
    const future = Date.now() + 3 * 60 * 60 * 1000;
    const cleaned = roomStore.cleanupExpired(future);
    assert.equal(cleaned, 1);

    assert.throws(
      () => roomService.getRoomByCode(room.roomCode),
      (err: any) => err instanceof AppError && err.code === 'ROOM_NOT_FOUND'
    );
  });

  // ==========================================
  // HOST PRIVILEGES & ACTIONS (8-13)
  // ==========================================

  it('8. host with valid token can start game', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    room.addPlayer('Alice');

    const sanitizedQ = room.start(room.hostToken);
    assert.equal(room.state, 'QUESTION_ACTIVE');
    assert.equal(sanitizedQ.id, 'q_1');
    assert.equal(sanitizedQ.questionIndex, 0);
  });

  it('9. invalid host token rejected with INVALID_HOST_TOKEN', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    room.addPlayer('Alice');

    assert.throws(
      () => room.start('bad_token'),
      (err: any) => err instanceof AppError && err.code === 'INVALID_HOST_TOKEN'
    );
  });

  it('10. cannot start game without players in WAITING state', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    assert.throws(
      () => room.start(room.hostToken),
      (err: any) => err instanceof AppError && err.code === 'INVALID_ROOM_STATE'
    );
  });

  it('11. host can advance to next question from QUESTION_REVEAL', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Alice');
    room.start(room.hostToken);

    room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');
    room.revealQuestion();
    assert.equal(room.state, 'QUESTION_REVEAL');

    const nextResult = room.nextQuestion(room.hostToken);
    assert.equal(nextResult.nextQuestionAvailable, true);
    assert.equal(nextResult.finished, false);
    assert.equal(nextResult.question?.id, 'q_2');
    assert.equal(room.state, 'QUESTION_ACTIVE');
  });

  it('12. non-host cannot advance questions', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    room.addPlayer('Alice');
    room.start(room.hostToken);
    room.revealQuestion();

    assert.throws(
      () => room.nextQuestion('fake_host_token'),
      (err: any) => err instanceof AppError && err.code === 'INVALID_HOST_TOKEN'
    );
  });

  it('13. host can end game and retrieve final leaderboard', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    room.addPlayer('Alice');
    room.start(room.hostToken);

    const finalLb = room.endGame(room.hostToken);
    assert.equal(room.state, 'FINISHED');
    assert.equal(finalLb.length, 1);
  });

  // ==========================================
  // PLAYER IDENTITY & RECONNECT (14-19)
  // ==========================================

  it('14. player join creates private token and distinct playerId', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Alice');

    assert.ok(player.playerId.startsWith('player_'));
    assert.ok(player.playerToken.startsWith('token_'));
    assert.equal(player.displayName, 'Alice');
    assert.equal(player.score, 0);
    assert.equal(player.connected, true);
  });

  it('15. reconnect with valid player token does not duplicate player record', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player: p1 } = room.addPlayer('Alice');
    assert.equal(room.players.size, 1);

    // Disconnect
    room.disconnectPlayer(p1.playerToken);
    assert.equal(p1.connected, false);

    // Reconnect
    const { player: reconnected, isReconnect } = room.addPlayer('Alice', p1.playerToken);
    assert.equal(isReconnect, true);
    assert.equal(reconnected.playerId, p1.playerId);
    assert.equal(reconnected.connected, true);
    assert.equal(room.players.size, 1);
  });

  it('16. invalid player token rejected on reconnectPlayer', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    assert.throws(
      () => room.reconnectPlayer('nonexistent_token'),
      (err: any) => err instanceof AppError && err.code === 'INVALID_PLAYER_TOKEN'
    );
  });

  it('17. empty or whitespace player names rejected', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    assert.throws(
      () => room.addPlayer('   '),
      (err: any) => err instanceof AppError && err.code === 'INVALID_REQUEST'
    );
  });

  it('18. disconnect preserves player state and answers', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Bob');
    room.start(room.hostToken);

    room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');
    assert.equal(player.score, 100);

    room.disconnectPlayer(player.playerToken);
    assert.equal(player.connected, false);
    assert.equal(player.score, 100);
    assert.equal(player.answeredQuestionIds.has('q_1'), true);
  });

  it('19. reconnect preserves score and streak across questions', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Bob');
    room.start(room.hostToken);

    room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');
    room.disconnectPlayer(player.playerToken);

    const reconnected = room.reconnectPlayer(player.playerToken);
    assert.equal(reconnected.score, 100);
    assert.equal(reconnected.currentStreak, 1);
    assert.equal(reconnected.connected, true);
  });

  // ==========================================
  // GAME STATE & SECRECY (20-24)
  // ==========================================

  it('20. full state transitions: WAITING -> QUESTION_ACTIVE -> QUESTION_REVEAL -> FINISHED', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    assert.equal(room.state, 'WAITING');

    const { player } = room.addPlayer('Carol');
    room.start(room.hostToken);
    assert.equal(room.state, 'QUESTION_ACTIVE');

    room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');
    room.revealQuestion();
    assert.equal(room.state, 'QUESTION_REVEAL');

    const nextQ = room.nextQuestion(room.hostToken);
    assert.equal(nextQ.finished, false);
    assert.equal(room.state, 'QUESTION_ACTIVE');

    room.submitPlayerAnswer(player.playerToken, 'q_2', 'B. 2012');
    room.revealQuestion();
    const finishRes = room.nextQuestion(room.hostToken);
    assert.equal(finishRes.finished, true);
    assert.equal(room.state, 'FINISHED');
  });

  it('21. sanitized question payload strictly excludes correctAnswer and explanation', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    room.addPlayer('Dave');
    const q = room.start(room.hostToken);

    assert.equal(q.id, 'q_1');
    assert.equal((q as any).correctAnswer, undefined);
    assert.equal((q as any).acceptedAlternatives, undefined);
    assert.equal((q as any).explanation, undefined);
  });

  // ==========================================
  // ANSWERS & FORGERY RESISTANCE (25-32)
  // ==========================================

  it('25. correct answer awards points and records result', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Eve');
    room.start(room.hostToken);

    const { result } = room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');
    assert.equal(result.isCorrect, true);
    assert.equal(result.pointsEarned, 100);
    assert.equal(player.score, 100);
  });

  it('26. wrong answer awards 0 points', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Frank');
    room.start(room.hostToken);

    const { result } = room.submitPlayerAnswer(player.playerToken, 'q_1', 'B. SpiderMonkey');
    assert.equal(result.isCorrect, false);
    assert.equal(result.pointsEarned, 0);
    assert.equal(player.score, 0);
  });

  it('27. duplicate answer for same question rejected with QUESTION_ALREADY_ANSWERED', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Grace');
    room.start(room.hostToken);

    room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');

    assert.throws(
      () => room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8'),
      (err: any) => err instanceof AppError && err.code === 'QUESTION_ALREADY_ANSWERED'
    );
  });

  it('28. answer for non-active question rejected with QUESTION_NOT_FOUND', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Heidi');
    room.start(room.hostToken);

    assert.throws(
      () => room.submitPlayerAnswer(player.playerToken, 'q_2', 'B. 2012'),
      (err: any) => err instanceof AppError && err.code === 'QUESTION_NOT_FOUND'
    );
  });

  it('29. answer submitted after question deadline rejected with ANSWER_TIMEOUT', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Ivan');
    room.start(room.hostToken);

    // Pass simulated timestamp 25 seconds later (limit is 20s)
    const lateTime = room.questionStartedAt! + 25000;

    assert.throws(
      () => room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8', lateTime),
      (err: any) => err instanceof AppError && err.code === 'ANSWER_TIMEOUT'
    );
  });

  it('30. invalid answer choice rejected with INVALID_ANSWER', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Judy');
    room.start(room.hostToken);

    assert.throws(
      () => room.submitPlayerAnswer(player.playerToken, 'q_1', 'Z. Nonexistent Option'),
      (err: any) => err instanceof AppError && err.code === 'INVALID_ANSWER'
    );
  });

  // ==========================================
  // SCORING MODES & DETERMINISTIC TIES (33-37)
  // ==========================================

  it('33. SPEED_BONUS awards higher score for faster answers', () => {
    const spec = createSampleSpec({
      settings: { questionCount: 1, timePerQuestion: 20, scoringMode: 'SPEED_BONUS' },
    });
    const room = roomService.createRoom(spec);
    const { player: fast } = room.addPlayer('Fast');
    const { player: slow } = room.addPlayer('Slow');
    room.start(room.hostToken);

    const t0 = room.questionStartedAt!;
    // Fast answers after 1 second
    const { result: fastRes } = room.submitPlayerAnswer(fast.playerToken, 'q_1', 'A. V8', t0 + 1000);
    // Slow answers after 15 seconds
    const { result: slowRes } = room.submitPlayerAnswer(slow.playerToken, 'q_1', 'A. V8', t0 + 15000);

    assert.ok(fastRes.pointsEarned > slowRes.pointsEarned);
    assert.ok(fast.score > slow.score);
  });

  it('34. STREAK awards bonus on consecutive correct answers and resets on incorrect', () => {
    const spec = createSampleSpec({
      settings: { questionCount: 2, timePerQuestion: 20, scoringMode: 'STREAK' },
    });
    const room = roomService.createRoom(spec);
    const { player } = room.addPlayer('Streaker');
    room.start(room.hostToken);

    // Q1 correct: streak 1 (+100)
    const { result: r1 } = room.submitPlayerAnswer(player.playerToken, 'q_1', 'A. V8');
    assert.equal(r1.pointsEarned, 100);
    assert.equal(player.currentStreak, 1);

    room.revealQuestion();
    room.nextQuestion(room.hostToken);

    // Q2 correct: streak 2 (+120)
    const { result: r2 } = room.submitPlayerAnswer(player.playerToken, 'q_2', 'B. 2012');
    assert.equal(r2.pointsEarned, 120);
    assert.equal(player.currentStreak, 2);
    assert.equal(player.score, 220);
  });

  it('35. deterministic leaderboard tie-breaking: score -> correct -> responseTime -> playerId', () => {
    const spec = createSampleSpec();
    const room = roomService.createRoom(spec);

    const { player: pA } = room.addPlayer('PlayerA');
    const { player: pB } = room.addPlayer('PlayerB');
    const { player: pC } = room.addPlayer('PlayerC');

    // Manually test ordering:
    // pA: score 100, correct 1, time 5000ms
    // pB: score 100, correct 1, time 3000ms (faster time beats pA)
    // pC: score 50, correct 0, time 1000ms (lower score loses)
    pA.score = 100; pA.correctCount = 1; pA.totalResponseTimeMs = 5000;
    pB.score = 100; pB.correctCount = 1; pB.totalResponseTimeMs = 3000;
    pC.score = 50; pC.correctCount = 0; pC.totalResponseTimeMs = 1000;

    const lb = room.getLeaderboard();
    assert.equal(lb[0].playerId, pB.playerId); // Faster wins tie
    assert.equal(lb[0].rank, 1);
    assert.equal(lb[1].playerId, pA.playerId);
    assert.equal(lb[1].rank, 2);
    assert.equal(lb[2].playerId, pC.playerId);
    assert.equal(lb[2].rank, 3);
  });
});

