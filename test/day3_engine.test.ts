import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { GameSpecification, GameQuestion } from '../src/contracts/game.contract.js';
import { GameEngine, gameEngine } from '../src/game/game.engine.js';
import { GameSession } from '../src/game/game.session.js';
import { gameStore, sessionStore } from '../src/game/game.store.js';
import { calculateScore, calculateMaxPossibleScore, SCORING_CONSTANTS } from '../src/game/game.scoring.js';
import { GameTimer } from '../src/game/game.timer.js';
import { MultipleChoiceHandler } from '../src/game/handlers/multipleChoice.handler.js';
import { FillBlankHandler } from '../src/game/handlers/fillBlank.handler.js';
import { QuickButtonHandler } from '../src/game/handlers/quickButton.handler.js';
import { CrosswordHandler } from '../src/game/handlers/crossword.handler.js';
import { getHandler } from '../src/game/handlers/index.js';
import { AppError } from '../src/utils/errors.js';

function createSampleMultipleChoiceSpec(overrides?: Partial<GameSpecification>): GameSpecification {
  return {
    gameId: 'game_mc_test',
    title: 'TypeScript Basics Quiz',
    description: 'A quiz testing basic TypeScript knowledge.',
    gameType: 'MULTIPLE_CHOICE',
    questions: [
      {
        id: 'q_mc_1',
        type: 'MULTIPLE_CHOICE',
        question: 'Who created TypeScript?',
        choices: ['A. Anders Hejlsberg', 'B. Brendan Eich', 'C. Guido van Rossum', 'D. Bjarne Stroustrup'],
        correctAnswer: 'A. Anders Hejlsberg',
        explanation: 'Anders Hejlsberg designed TypeScript at Microsoft.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_test',
          sourceType: 'WEBSITE',
          sourceLocation: 'https://typescriptlang.org',
          section: 'History',
        },
      },
      {
        id: 'q_mc_2',
        type: 'MULTIPLE_CHOICE',
        question: 'What is TypeScript a superset of?',
        choices: ['A. Python', 'B. JavaScript', 'C. Java', 'D. C++'],
        correctAnswer: 'B. JavaScript',
        explanation: 'TypeScript is a typed superset of JavaScript.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_test',
          sourceType: 'WEBSITE',
          sourceLocation: 'https://typescriptlang.org',
          section: 'Overview',
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
          sourceId: 'src_test',
          sourceType: 'WEBSITE',
          sourceName: 'typescriptlang.org',
          sourceLocation: 'https://typescriptlang.org',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createSampleFillBlankSpec(): GameSpecification {
  return {
    gameId: 'game_fib_test',
    title: 'Fill In The Blank Challenge',
    description: 'Fill in the blank test.',
    gameType: 'FILL_IN_THE_BLANK',
    questions: [
      {
        id: 'q_fib_1',
        type: 'FILL_IN_THE_BLANK',
        question: 'The company that created the Prius hybrid car is _______.',
        correctAnswer: 'Toyota',
        acceptedAlternatives: ['Toyota Motor', 'Toyota Motor Corporation'],
        explanation: 'Toyota released the Prius in 1997.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_fib',
          sourceType: 'WEBSITE',
          sourceLocation: 'https://toyota.com',
          section: 'Vehicles',
        },
      },
    ],
    settings: {
      questionCount: 1,
      timePerQuestion: 30,
      scoringMode: 'STANDARD',
    },
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_fib',
          sourceType: 'WEBSITE',
          sourceName: 'toyota.com',
          sourceLocation: 'https://toyota.com',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

function createSampleQuickButtonSpec(): GameSpecification {
  return {
    gameId: 'game_qb_test',
    title: 'Quick Decision Game',
    description: 'Select the right button quickly.',
    gameType: 'QUICK_BUTTON',
    questions: [
      {
        id: 'q_qb_1',
        type: 'QUICK_BUTTON',
        question: 'Is HTML a programming language?',
        choices: ['Yes', 'No', 'Sometimes'],
        correctAnswer: 'No',
        explanation: 'HTML is a markup language, not a programming language.',
        difficulty: 'EASY',
        sourceReference: {
          sourceId: 'src_qb',
          sourceType: 'WEBSITE',
          sourceLocation: 'https://w3.org',
          section: 'HTML',
        },
      },
    ],
    settings: {
      questionCount: 1,
      timePerQuestion: 15,
      scoringMode: 'STANDARD',
    },
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_qb',
          sourceType: 'WEBSITE',
          sourceName: 'w3.org',
          sourceLocation: 'https://w3.org',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

function createSampleCrosswordSpec(): GameSpecification {
  return {
    gameId: 'game_cw_test',
    title: 'Crossword Clues',
    description: 'Find the word from the clue.',
    gameType: 'CROSSWORD',
    questions: [
      {
        id: 'q_cw_1',
        type: 'CROSSWORD',
        question: 'A large city in the USA often known as The Big Apple (7 letters)',
        crosswordClue: 'The Big Apple',
        crosswordAnswer: 'NEWYORK',
        correctAnswer: 'NEWYORK',
        explanation: 'New York is called The Big Apple.',
        difficulty: 'MEDIUM',
        sourceReference: {
          sourceId: 'src_cw',
          sourceType: 'WEBSITE',
          sourceLocation: 'https://ny.gov',
          section: 'Info',
        },
      },
    ],
    settings: {
      questionCount: 1,
      timePerQuestion: 45,
      scoringMode: 'STANDARD',
    },
    sourceSummary: {
      sourceCount: 1,
      sources: [
        {
          sourceId: 'src_cw',
          sourceType: 'WEBSITE',
          sourceName: 'ny.gov',
          sourceLocation: 'https://ny.gov',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
}

describe('DAY 3 - Game Engine Core Test Suite', () => {
  beforeEach(() => {
    gameStore.clear();
    sessionStore.clear();
  });

  // ==========================================
  // CORE LIFECYCLE (1-11)
  // ==========================================

  it('1. should create a session in NOT_STARTED state', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);

    assert.ok(session.sessionId.startsWith('session_'));
    assert.equal(session.state, 'NOT_STARTED');
    assert.equal(session.currentQuestionIndex, 0);
    assert.equal(session.score, 0);
    assert.equal(session.correctCount, 0);
    assert.equal(session.wrongCount, 0);
  });

  it('2. should start session and transition to QUESTION_ACTIVE with first question', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    const startResult = gameEngine.start(session.sessionId);

    assert.equal(startResult.session.state, 'QUESTION_ACTIVE');
    assert.equal(startResult.question.id, 'q_mc_1');
    assert.equal(startResult.question.questionIndex, 0);
    assert.equal(startResult.question.totalQuestions, 2);
  });

  it('3. cannot answer before start', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);

    assert.throws(
      () => gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A'),
      (err: any) => err instanceof AppError && err.code === 'GAME_NOT_STARTED'
    );
  });

  it('4. current question returned without authoritative answer', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    const question = gameEngine.getCurrentQuestion(session.sessionId);
    assert.equal(question.id, 'q_mc_1');
    assert.equal((question as any).correctAnswer, undefined);
    assert.equal((question as any).explanation, undefined);
  });

  it('5. correct answer awards points and marks isCorrect = true', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    const result = gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A. Anders Hejlsberg');
    assert.equal(result.isCorrect, true);
    assert.equal(result.pointsEarned, 100);
    assert.equal(result.score, 100);
    assert.equal(session.correctCount, 1);
    assert.equal(session.wrongCount, 0);
    assert.equal(session.state, 'QUESTION_ANSWERED');
  });

  it('6. incorrect answer awards 0 points and marks isCorrect = false', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    const result = gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'B. Brendan Eich');
    assert.equal(result.isCorrect, false);
    assert.equal(result.pointsEarned, 0);
    assert.equal(result.score, 0);
    assert.equal(session.correctCount, 0);
    assert.equal(session.wrongCount, 1);
    assert.equal(session.state, 'QUESTION_ANSWERED');
  });

  it('7. duplicate answer rejected', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A');

    assert.throws(
      () => gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A'),
      (err: any) => err instanceof AppError && err.code === 'QUESTION_ALREADY_ANSWERED'
    );
  });

  it('8. advance to next question transitions state back to QUESTION_ACTIVE', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);
    gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A');

    const advanceResult = gameEngine.advance(session.sessionId);
    assert.equal(advanceResult.nextQuestionAvailable, true);
    assert.equal(advanceResult.finished, false);
    assert.ok(advanceResult.question);
    assert.equal(advanceResult.question.id, 'q_mc_2');
    assert.equal(session.state, 'QUESTION_ACTIVE');
    assert.equal(session.currentQuestionIndex, 1);
  });

  it('9. cannot advance beyond final question', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    // Q1
    gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A');
    gameEngine.advance(session.sessionId);

    // Q2 (last question)
    gameEngine.submitAnswer(session.sessionId, 'q_mc_2', 'B');
    const finalAdvance = gameEngine.advance(session.sessionId);

    assert.equal(finalAdvance.nextQuestionAvailable, false);
    assert.equal(finalAdvance.finished, true);
    assert.equal(session.state, 'FINISHED');

    // Attempting to advance again must be rejected
    assert.throws(
      () => gameEngine.advance(session.sessionId),
      (err: any) => err instanceof AppError && err.code === 'GAME_FINISHED'
    );
  });

  it('10. final result generated with accurate summary', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A'); // correct (+100)
    gameEngine.advance(session.sessionId);
    gameEngine.submitAnswer(session.sessionId, 'q_mc_2', 'A'); // wrong (+0)
    gameEngine.advance(session.sessionId);

    const result = gameEngine.getResult(session.sessionId);
    assert.equal(result.sessionId, session.sessionId);
    assert.equal(result.gameId, spec.gameId);
    assert.equal(result.totalQuestions, 2);
    assert.equal(result.correctCount, 1);
    assert.equal(result.wrongCount, 1);
    assert.equal(result.score, 100);
    assert.equal(result.accuracy, 50);
    assert.equal(result.questionResults.length, 2);
  });

  it('11. cannot answer after finish', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A');
    gameEngine.advance(session.sessionId);
    gameEngine.submitAnswer(session.sessionId, 'q_mc_2', 'B');
    gameEngine.advance(session.sessionId);

    assert.throws(
      () => gameEngine.submitAnswer(session.sessionId, 'q_mc_2', 'B'),
      (err: any) => err instanceof AppError && err.code === 'GAME_FINISHED'
    );
  });

  // ==========================================
  // MULTIPLE_CHOICE HANDLER (12-15)
  // ==========================================

  it('12. four choices required for multiple choice question', () => {
    const handler = new MultipleChoiceHandler();
    const badQuestion: any = {
      id: 'bad_mc',
      type: 'MULTIPLE_CHOICE',
      question: 'Test',
      choices: ['A. One', 'B. Two'],
      correctAnswer: 'A. One',
    };

    const res = handler.validateAnswer(badQuestion, 'A. One');
    assert.equal(res.isValid, false);
    assert.match(res.invalidReason!, /exactly 4 choices/);
  });

  it('13. correct choice accepted via letter, exact string, or trimmed text', () => {
    const handler = new MultipleChoiceHandler();
    const question: GameQuestion = {
      id: 'q_mc',
      type: 'MULTIPLE_CHOICE',
      question: 'Who created TypeScript?',
      choices: ['A. Anders Hejlsberg', 'B. Brendan Eich', 'C. Guido van Rossum', 'D. Bjarne Stroustrup'],
      correctAnswer: 'A. Anders Hejlsberg',
      difficulty: 'EASY',
      sourceReference: {
        sourceId: 's1',
        sourceType: 'WEBSITE',
        sourceLocation: 'http://test',
      },
    };

    const resByLetter = handler.validateAnswer(question, 'A');
    assert.equal(resByLetter.isValid, true);
    assert.equal(resByLetter.isCorrect, true);

    const resByFull = handler.validateAnswer(question, 'A. Anders Hejlsberg');
    assert.equal(resByFull.isValid, true);
    assert.equal(resByFull.isCorrect, true);

    const resByText = handler.validateAnswer(question, 'Anders Hejlsberg');
    assert.equal(resByText.isValid, true);
    assert.equal(resByText.isCorrect, true);
  });

  it('14. invalid choice rejected as invalid answer', () => {
    const handler = new MultipleChoiceHandler();
    const question: GameQuestion = {
      id: 'q_mc',
      type: 'MULTIPLE_CHOICE',
      question: 'Who created TypeScript?',
      choices: ['A. Anders Hejlsberg', 'B. Brendan Eich', 'C. Guido van Rossum', 'D. Bjarne Stroustrup'],
      correctAnswer: 'A. Anders Hejlsberg',
      difficulty: 'EASY',
      sourceReference: {
        sourceId: 's1',
        sourceType: 'WEBSITE',
        sourceLocation: 'http://test',
      },
    };

    const res = handler.validateAnswer(question, 'E. Elon Musk');
    assert.equal(res.isValid, false);
    assert.match(res.invalidReason!, /Invalid choice/);
  });

  it('15. correct answer cannot be determined from client score', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    // Client sends an incorrect answer but claims isCorrect: true and points: 9999
    const payload: any = {
      questionId: 'q_mc_1',
      answer: 'B. Brendan Eich',
      isCorrect: true,
      points: 9999,
    };

    const res = gameEngine.submitAnswer(session.sessionId, payload.questionId, payload.answer);
    assert.equal(res.isCorrect, false);
    assert.equal(res.pointsEarned, 0);
    assert.equal(session.score, 0);
  });

  // ==========================================
  // FILL_IN_THE_BLANK HANDLER (16-19)
  // ==========================================

  it('16. case-insensitive match for FILL_IN_THE_BLANK', () => {
    const handler = new FillBlankHandler();
    const spec = createSampleFillBlankSpec();
    const q = spec.questions[0];

    const resLower = handler.validateAnswer(q, 'toyota');
    assert.equal(resLower.isValid, true);
    assert.equal(resLower.isCorrect, true);

    const resUpper = handler.validateAnswer(q, 'TOYOTA');
    assert.equal(resUpper.isValid, true);
    assert.equal(resUpper.isCorrect, true);
  });

  it('17. whitespace normalization for FILL_IN_THE_BLANK', () => {
    const handler = new FillBlankHandler();
    const spec = createSampleFillBlankSpec();
    const q = spec.questions[0];

    const resSpaced = handler.validateAnswer(q, '   Toyota   ');
    assert.equal(resSpaced.isValid, true);
    assert.equal(resSpaced.isCorrect, true);

    const resInternalSpaces = handler.validateAnswer(q, 'Toyota   Motor');
    assert.equal(resInternalSpaces.isValid, true);
    assert.equal(resInternalSpaces.isCorrect, true);
  });

  it('18. accepted alternative for FILL_IN_THE_BLANK', () => {
    const handler = new FillBlankHandler();
    const spec = createSampleFillBlankSpec();
    const q = spec.questions[0];

    const resAlt = handler.validateAnswer(q, 'Toyota Motor Corporation');
    assert.equal(resAlt.isValid, true);
    assert.equal(resAlt.isCorrect, true);
  });

  it('19. incorrect answer rejected for FILL_IN_THE_BLANK', () => {
    const handler = new FillBlankHandler();
    const spec = createSampleFillBlankSpec();
    const q = spec.questions[0];

    const resWrong = handler.validateAnswer(q, 'Honda');
    assert.equal(resWrong.isValid, true);
    assert.equal(resWrong.isCorrect, false);
  });

  // ==========================================
  // QUICK_BUTTON HANDLER (20-21)
  // ==========================================

  it('20. valid button choice evaluates correctly for QUICK_BUTTON', () => {
    const handler = new QuickButtonHandler();
    const spec = createSampleQuickButtonSpec();
    const q = spec.questions[0];

    const resCorrect = handler.validateAnswer(q, 'No');
    assert.equal(resCorrect.isValid, true);
    assert.equal(resCorrect.isCorrect, true);

    const resWrong = handler.validateAnswer(q, 'Yes');
    assert.equal(resWrong.isValid, true);
    assert.equal(resWrong.isCorrect, false);
  });

  it('21. invalid button rejected for QUICK_BUTTON', () => {
    const handler = new QuickButtonHandler();
    const spec = createSampleQuickButtonSpec();
    const q = spec.questions[0];

    const res = handler.validateAnswer(q, 'Definitive Maybe');
    assert.equal(res.isValid, false);
    assert.match(res.invalidReason!, /Invalid choice/);
  });

  // ==========================================
  // CROSSWORD HANDLER (22-23)
  // ==========================================

  it('22. normalized answer accepted for CROSSWORD', () => {
    const handler = new CrosswordHandler();
    const spec = createSampleCrosswordSpec();
    const q = spec.questions[0];

    const resExact = handler.validateAnswer(q, 'NEWYORK');
    assert.equal(resExact.isValid, true);
    assert.equal(resExact.isCorrect, true);

    const resSpacedLower = handler.validateAnswer(q, '  new york  ');
    assert.equal(resSpacedLower.isValid, true);
    assert.equal(resSpacedLower.isCorrect, true);
  });

  it('23. wrong crossword answer rejected', () => {
    const handler = new CrosswordHandler();
    const spec = createSampleCrosswordSpec();
    const q = spec.questions[0];

    const resWrong = handler.validateAnswer(q, 'CHICAGO');
    assert.equal(resWrong.isValid, true);
    assert.equal(resWrong.isCorrect, false);
  });

  // ==========================================
  // SCORING ENGINE (24-28)
  // ==========================================

  it('24. STANDARD scoring awards flat 100 points for correct, 0 for incorrect', () => {
    const correctRes = calculateScore({
      isCorrect: true,
      scoringMode: 'STANDARD',
      responseTimeMs: 5000,
      timeLimitMs: 20000,
      currentStreak: 0,
    });
    assert.equal(correctRes.pointsEarned, 100);

    const wrongRes = calculateScore({
      isCorrect: false,
      scoringMode: 'STANDARD',
      responseTimeMs: 2000,
      timeLimitMs: 20000,
      currentStreak: 2,
    });
    assert.equal(wrongRes.pointsEarned, 0);
  });

  it('25. SPEED_BONUS scoring awards base points plus bounded time bonus', () => {
    // Instant response (0ms) on 20s limit should receive maximum speed bonus (50) -> 150 points
    const instantRes = calculateScore({
      isCorrect: true,
      scoringMode: 'SPEED_BONUS',
      responseTimeMs: 0,
      timeLimitMs: 20000,
      currentStreak: 0,
    });
    assert.equal(instantRes.pointsEarned, 150);

    // Half time elapsed (10s on 20s limit) -> 100 + round(50 * 0.5) = 125
    const halfRes = calculateScore({
      isCorrect: true,
      scoringMode: 'SPEED_BONUS',
      responseTimeMs: 10000,
      timeLimitMs: 20000,
      currentStreak: 0,
    });
    assert.equal(halfRes.pointsEarned, 125);

    // Full time elapsed (20s) -> 100 + 0 = 100
    const lateRes = calculateScore({
      isCorrect: true,
      scoringMode: 'SPEED_BONUS',
      responseTimeMs: 20000,
      timeLimitMs: 20000,
      currentStreak: 0,
    });
    assert.equal(lateRes.pointsEarned, 100);
  });

  it('26. STREAK scoring awards cumulative bonus for consecutive correct answers', () => {
    // First correct answer: streak 1, bonus = 0 -> 100
    const s1 = calculateScore({
      isCorrect: true,
      scoringMode: 'STREAK',
      responseTimeMs: 5000,
      timeLimitMs: 20000,
      currentStreak: 0,
    });
    assert.equal(s1.pointsEarned, 100);
    assert.equal(s1.newStreak, 1);

    // Second consecutive correct: streak 2, bonus = (2-1)*20 = 20 -> 120
    const s2 = calculateScore({
      isCorrect: true,
      scoringMode: 'STREAK',
      responseTimeMs: 5000,
      timeLimitMs: 20000,
      currentStreak: 1,
    });
    assert.equal(s2.pointsEarned, 120);
    assert.equal(s2.newStreak, 2);

    // Sixth consecutive correct: streak 6, bonus capped at 100 -> 200
    const s6 = calculateScore({
      isCorrect: true,
      scoringMode: 'STREAK',
      responseTimeMs: 5000,
      timeLimitMs: 20000,
      currentStreak: 5,
    });
    assert.equal(s6.pointsEarned, 200);
    assert.equal(s6.newStreak, 6);
  });

  it('27. streak reset after wrong answer', () => {
    const wrongRes = calculateScore({
      isCorrect: false,
      scoringMode: 'STREAK',
      responseTimeMs: 1000,
      timeLimitMs: 20000,
      currentStreak: 5,
    });
    assert.equal(wrongRes.pointsEarned, 0);
    assert.equal(wrongRes.newStreak, 0);
  });

  it('28. score cannot be client-forged in session', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    // Client passes arbitrary extra parameters
    const forgedInput = 'A. Anders Hejlsberg';
    const res = gameEngine.submitAnswer(session.sessionId, 'q_mc_1', forgedInput);

    assert.equal(res.pointsEarned, 100);
    assert.equal(session.score, 100);
    assert.equal(session.score, res.score);
  });

  // ==========================================
  // TIMER (29-31)
  // ==========================================

  it('29. timeout blocks answer with ANSWER_TIMEOUT error', () => {
    let fakeNow = 1000000;
    const fakeClock = () => fakeNow;

    const spec = createSampleMultipleChoiceSpec();
    const session = new GameSession('session_timer_test', spec, fakeClock);
    session.start();

    // Advance clock past timePerQuestion (20 seconds = 20,000ms)
    fakeNow += 25000;

    assert.throws(
      () => session.submitAnswer('q_mc_1', 'A. Anders Hejlsberg'),
      (err: any) => err instanceof AppError && err.code === 'ANSWER_TIMEOUT'
    );
  });

  it('30. response time recorded accurately from timer', () => {
    let fakeNow = 1000000;
    const fakeClock = () => fakeNow;

    const spec = createSampleMultipleChoiceSpec();
    const session = new GameSession('session_timer_test_2', spec, fakeClock);
    session.start();

    // Advance clock by 7.5 seconds
    fakeNow += 7500;

    const result = session.submitAnswer('q_mc_1', 'A. Anders Hejlsberg');
    assert.equal(result.responseTimeMs, 7500);
  });

  it('31. cannot answer after deadline', () => {
    let fakeNow = 2000000;
    const fakeClock = () => fakeNow;

    const timer = new GameTimer(fakeClock);
    timer.start(10); // 10 seconds

    assert.equal(timer.isExpired(), false);

    fakeNow += 10001;
    assert.equal(timer.isExpired(), true);
  });

  // ==========================================
  // SECURITY & ERROR BOUNDARIES (32-36)
  // ==========================================

  it('32. current question does not expose correctAnswer', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    const clientQ = gameEngine.getCurrentQuestion(session.sessionId);
    assert.equal((clientQ as any).correctAnswer, undefined);
    assert.equal((clientQ as any).acceptedAlternatives, undefined);
    assert.equal((clientQ as any).explanation, undefined);
  });

  it('33. question result reveals answer only after submission', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    const answerResult = gameEngine.submitAnswer(session.sessionId, 'q_mc_1', 'A');
    assert.ok(answerResult.correctAnswer);
    assert.ok(answerResult.explanation);
  });

  it('34. unknown session rejected with SESSION_NOT_FOUND', () => {
    assert.throws(
      () => gameEngine.getSession('session_non_existent'),
      (err: any) => err instanceof AppError && err.code === 'SESSION_NOT_FOUND'
    );
  });

  it('35. unknown question rejected with QUESTION_NOT_FOUND', () => {
    const spec = createSampleMultipleChoiceSpec();
    const session = gameEngine.createSession(spec.gameId, spec);
    gameEngine.start(session.sessionId);

    assert.throws(
      () => gameEngine.submitAnswer(session.sessionId, 'q_non_existent', 'A'),
      (err: any) => err instanceof AppError && err.code === 'QUESTION_NOT_FOUND'
    );
  });

  it('36. unsupported game type rejected with UNSUPPORTED_GAME_TYPE', () => {
    assert.throws(
      () => getHandler('VIRTUAL_REALITY' as any),
      (err: any) => err instanceof AppError && err.code === 'UNSUPPORTED_GAME_TYPE'
    );
  });

  // ==========================================
  // HTTP REST API END-TO-END FLOW
  // ==========================================

  it('37. HTTP API complete single-player local game flow', async () => {
    const spec = createSampleMultipleChoiceSpec();

    // 1. Create session via POST /api/games/sessions
    const createRes = await request(app)
      .post('/api/games/sessions')
      .send({ gameId: spec.gameId, gameSpecification: spec });

    assert.equal(createRes.status, 200);
    assert.equal(createRes.body.success, true);
    const { sessionId, totalQuestions } = createRes.body.data;
    assert.ok(sessionId);
    assert.equal(totalQuestions, 2);

    // 2. Start session via POST /api/games/sessions/:sessionId/start
    const startRes = await request(app)
      .post(`/api/games/sessions/${sessionId}/start`);

    assert.equal(startRes.status, 200);
    assert.equal(startRes.body.success, true);
    assert.equal(startRes.body.data.question.id, 'q_mc_1');
    assert.equal(startRes.body.data.question.correctAnswer, undefined);

    // 3. Query current question via GET /api/games/sessions/:sessionId/question
    const qRes = await request(app)
      .get(`/api/games/sessions/${sessionId}/question`);

    assert.equal(qRes.status, 200);
    assert.equal(qRes.body.data.id, 'q_mc_1');
    assert.equal(qRes.body.data.correctAnswer, undefined);

    // 4. Submit answer for Question 1
    const ans1Res = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({
        questionId: 'q_mc_1',
        answer: 'A. Anders Hejlsberg',
      });

    assert.equal(ans1Res.status, 200);
    assert.equal(ans1Res.body.data.isCorrect, true);
    assert.equal(ans1Res.body.data.pointsEarned, 100);
    assert.equal(ans1Res.body.data.score, 100);
    assert.equal(ans1Res.body.data.nextQuestionAvailable, true);

    // 5. Advance to Question 2 via POST /api/games/sessions/:sessionId/next
    const next1Res = await request(app)
      .post(`/api/games/sessions/${sessionId}/next`);

    assert.equal(next1Res.status, 200);
    assert.equal(next1Res.body.data.nextQuestionAvailable, true);
    assert.equal(next1Res.body.data.question.id, 'q_mc_2');

    // 6. Submit answer for Question 2
    const ans2Res = await request(app)
      .post(`/api/games/sessions/${sessionId}/answer`)
      .send({
        questionId: 'q_mc_2',
        answer: 'B. JavaScript',
      });

    assert.equal(ans2Res.status, 200);
    assert.equal(ans2Res.body.data.isCorrect, true);
    assert.equal(ans2Res.body.data.score, 200);
    assert.equal(ans2Res.body.data.nextQuestionAvailable, false);

    // 7. Advance to finish
    const next2Res = await request(app)
      .post(`/api/games/sessions/${sessionId}/next`);

    assert.equal(next2Res.status, 200);
    assert.equal(next2Res.body.data.finished, true);
    assert.ok(next2Res.body.data.result);
    assert.equal(next2Res.body.data.result.score, 200);
    assert.equal(next2Res.body.data.result.accuracy, 100);

    // 8. Fetch final result via GET /api/games/sessions/:sessionId/result
    const resultRes = await request(app)
      .get(`/api/games/sessions/${sessionId}/result`);

    assert.equal(resultRes.status, 200);
    assert.equal(resultRes.body.data.score, 200);
    assert.equal(resultRes.body.data.correctCount, 2);
    assert.equal(resultRes.body.data.wrongCount, 0);
  });
});

