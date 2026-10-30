import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { GameSession } from '../src/game/game.session.js';
import { AiQuestionService, calculateMixedTypeCounts } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { resolveAdventureAssetPack } from '../src/services/adventure-asset-pack.service.js';
import {
  CreatableGameTypeEnum,
  GenerateGameRequestSchema,
  MixedQuestionDistributionSchema,
} from '../src/contracts/game.contract.js';
import {
  AdventureQuestionDistributionSchema,
  AdventureQuestionTypeEnum,
  buildDefaultQuestionDistributionForTypes,
  GenerateAdventureConfigInputSchema,
} from '../src/contracts/adventure.contract.js';
import type { CanonicalDocument } from '../src/contracts/canonical.contract.js';
import {
  evaluateRunnerPreviewAnswer,
  normalizeCrosswordAnswerForRunner,
} from '../frontend/src/components/AdventureGameEngine.js';
import { SUPPORTED_GAME_TYPES } from '../frontend/src/components/GameTypeSelector.js';
import type { GameQuestion } from '../src/game/game.types.js';
import type { IAIJsonProvider } from '../src/services/ai.question.service.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const SAMPLE_CANONICAL_DOC: CanonicalDocument = {
  sourceId: 'src_test_dist',
  sourceType: 'TXT',
  sourceName: 'Quy trình Vận hành Chuẩn SOP',
  sourceLocation: 'Quy trình Vận hành Chuẩn SOP',
  title: 'Quy trình Vận hành Chuẩn SOP',
  text: 'Tài liệu đào tạo quy trình vận hành an toàn thiết bị nâng hạ, kiểm tra phanh, khóa an toàn, xử lý điểm mù giao thông và trang bị bảo hộ lao động tại nhà máy.',
  sections: [
    {
      title: 'Mục 1: Quy định an toàn chung',
      content:
        'Luôn kiểm tra thiết bị bảo hộ lao động, đội mũ bảo hiểm đạt chuẩn và khóa chốt an toàn trước khi vận hành.',
      provenance: {
        sourceId: 'src_test_dist',
        sourceType: 'TXT',
        sourceLocation: 'Quy trình Vận hành Chuẩn SOP',
        section: 'Mục 1',
      },
    },
    {
      title: 'Mục 2: Xử lý tình huống kỹ thuật',
      content:
        'Khi phát hiện cảnh báo áp suất hoặc chướng ngại vật, thực hiện quy trình giảm tốc và kiểm tra điểm mù.',
      provenance: {
        sourceId: 'src_test_dist',
        sourceType: 'TXT',
        sourceLocation: 'Quy trình Vận hành Chuẩn SOP',
        section: 'Mục 2',
      },
    },
  ],
  extractedItems: [],
  metadata: {
    originalSize: 310,
    characterCount: 310,
    extractedAt: new Date().toISOString(),
  },
  diagnostics: [],
};

/**
 * Deterministic mock AI provider that returns properly structured questions
 * for MULTIPLE_CHOICE, QUICK_BUTTON, FILL_IN_THE_BLANK, and CROSSWORD.
 */
class DeterministicDistributionProvider implements IAIJsonProvider {
  public callCount = 0;
  private customResponder?: (prompt: string, callIndex: number) => unknown;

  constructor(customResponder?: (prompt: string, callIndex: number) => unknown) {
    this.customResponder = customResponder;
  }

  async generateJson(prompt: string, _systemInstruction: string): Promise<unknown> {
    this.callCount += 1;
    if (this.customResponder) {
      return this.customResponder(prompt, this.callCount);
    }

    // Parse exact counts requested in prompt (supports both "- X câu TYPE" and "+ TYPE (...): X câu")
    const parseTypeCount = (typeName: string): number => {
      const m1 = prompt.match(new RegExp(`-\\s*(\\d+)\\s*câu\\s*${typeName}`));
      if (m1) return Number(m1[1]);
      const m2 = prompt.match(new RegExp(`\\+\\s*${typeName}[^\\n:]*:\\s*(\\d+)\\s*câu`));
      if (m2) return Number(m2[1]);
      return 0;
    };

    let mcCount = parseTypeCount('MULTIPLE_CHOICE');
    let qbCount = parseTypeCount('QUICK_BUTTON');
    let fillCount = parseTypeCount('FILL_IN_THE_BLANK');
    let cwCount = parseTypeCount('CROSSWORD');

    // Fallback for single-type supplemental prompts: "Hãy tạo thêm đúng X câu hỏi thuộc DUY NHẤT loại TYPE"
    const suppMatch = prompt.match(
      /Hãy tạo thêm đúng\s+(\d+)\s+câu hỏi thuộc DUY NHẤT loại\s+(MULTIPLE_CHOICE|QUICK_BUTTON|FILL_IN_THE_BLANK|CROSSWORD)/
    );
    if (suppMatch) {
      const n = Number(suppMatch[1]);
      const t = suppMatch[2];
      mcCount = t === 'MULTIPLE_CHOICE' ? n : 0;
      qbCount = t === 'QUICK_BUTTON' ? n : 0;
      fillCount = t === 'FILL_IN_THE_BLANK' ? n : 0;
      cwCount = t === 'CROSSWORD' ? n : 0;
    }

    const questions: Array<Record<string, unknown>> = [];
    for (let i = 0; i < mcCount; i++) {
      questions.push(makeRawQuestion('MULTIPLE_CHOICE', i + 1));
    }
    for (let i = 0; i < qbCount; i++) {
      questions.push(makeRawQuestion('QUICK_BUTTON', i + 1));
    }
    for (let i = 0; i < fillCount; i++) {
      questions.push(makeRawQuestion('FILL_IN_THE_BLANK', i + 1));
    }
    for (let i = 0; i < cwCount; i++) {
      questions.push(makeRawQuestion('CROSSWORD', i + 1));
    }

    return {
      title: 'Bộ Đề Đào Tạo Hỗn Hợp & Đi Cảnh',
      description: 'Bộ câu hỏi tự động kiểm tra theo đúng tỷ lệ cấu hình.',
      questions,
    };
  }
}

function makeRawQuestion(
  type: 'MULTIPLE_CHOICE' | 'QUICK_BUTTON' | 'FILL_IN_THE_BLANK' | 'CROSSWORD',
  seq: number
): Record<string, unknown> {
  const baseRef = {
    sourceId: 'src_test_dist',
    sourceType: 'TXT',
    sourceLocation: 'Quy trình Vận hành Chuẩn SOP',
    section: `Mục ${seq}`,
  };
  if (type === 'MULTIPLE_CHOICE') {
    const ans = `A. Phương án chuẩn số ${seq}`;
    return {
      type: 'MULTIPLE_CHOICE',
      difficulty: 'MEDIUM',
      question: `[MC #${seq}] Bước xử lý kỹ thuật chuẩn tại trạm số ${seq} là gì?`,
      choices: [
        ans,
        `B. Phương án sai lệch ${seq}.1`,
        `C. Phương án bỏ qua kiểm tra ${seq}.2`,
        `D. Phương án tắt cảnh báo ${seq}.3`,
      ],
      correctAnswer: ans,
      explanation: `Giải thích MC #${seq}: Phải thực hiện đúng phương án A theo SOP.`,
      sourceReference: baseRef,
    };
  }
  if (type === 'QUICK_BUTTON') {
    const isTrue = seq % 2 === 1;
    return {
      type: 'QUICK_BUTTON',
      difficulty: 'EASY',
      question: `[QB #${seq}] Nhận định số ${seq}: Luôn kiểm tra thiết bị bảo hộ trước khi vận hành?`,
      choices: ['Đúng', 'Sai'],
      correctAnswer: isTrue ? 'Đúng' : 'Sai',
      explanation: `Giải thích QB #${seq}: Quy định an toàn lao động bắt buộc.`,
      sourceReference: baseRef,
    };
  }
  if (type === 'FILL_IN_THE_BLANK') {
    const keyword = `antoan${seq}`;
    return {
      type: 'FILL_IN_THE_BLANK',
      difficulty: 'MEDIUM',
      question: `[FILL #${seq}] Trước khi mở van áp suất, kỹ thuật viên phải khóa chốt ___ theo quy trình.`,
      blankPrompt: `Trước khi mở van áp suất, kỹ thuật viên phải khóa chốt ___ theo quy trình.`,
      correctAnswer: keyword,
      acceptedAlternatives: [keyword.toUpperCase()],
      explanation: `Giải thích FILL #${seq}: Từ khóa cần điền là ${keyword}.`,
      sourceReference: baseRef,
    };
  }
  const word = `BAOHO${seq === 1 ? 'LAODONG' : seq === 2 ? 'KYTHUAT' : 'ANTOAN'}`;
  return {
    type: 'CROSSWORD',
    difficulty: 'HARD',
    question: `[CW #${seq}] Giải ô chữ (${word.length} chữ cái): Trang thiết bị bắt buộc khi vào khu vực sản xuất số ${seq}?`,
    crosswordClue: `Trang thiết bị bắt buộc khi vào khu vực sản xuất số ${seq} (${word.length} chữ cái)`,
    crosswordAnswer: word,
    correctAnswer: word,
    explanation: `Giải thích CW #${seq}: Từ khóa ô chữ là ${word}.`,
    sourceReference: baseRef,
  };
}

describe('MIXED Game & Adventure Question Type Configuration — Full BE + FE Verification', () => {
  it('1. Exposes MIXED and CROSSWORD in CreatableGameTypeEnum, AdventureQuestionTypeEnum, and GameTypeSelector', () => {
    assert.ok(CreatableGameTypeEnum.options.includes('MIXED'));
    assert.ok(CreatableGameTypeEnum.options.includes('CROSSWORD'));
    assert.ok(AdventureQuestionTypeEnum.options.includes('CROSSWORD'));

    const selectorIds = SUPPORTED_GAME_TYPES.map(item => item.id);
    assert.ok(selectorIds.includes('MIXED'), 'GameTypeSelector must include MIXED');
    assert.ok(selectorIds.includes('CROSSWORD'), 'GameTypeSelector must include CROSSWORD');
    assert.equal(selectorIds.length, 8, 'All 8 creatable game types must be selectable');
  });

  it('2. MIXED Case 1 — Allocates 100 questions with 40% / 20% / 15% / 25% into exact 40, 20, 15, 25 counts', () => {
    const dist = {
      MULTIPLE_CHOICE: 40,
      QUICK_BUTTON: 20,
      FILL_IN_THE_BLANK: 15,
      CROSSWORD: 25,
    };
    const parsed = MixedQuestionDistributionSchema.safeParse(dist);
    assert.equal(parsed.success, true);

    const counts = calculateMixedTypeCounts(100, dist);
    assert.deepEqual(counts, {
      MULTIPLE_CHOICE: 40,
      QUICK_BUTTON: 20,
      FILL_IN_THE_BLANK: 15,
      CROSSWORD: 25,
    });
    assert.equal(
      counts.MULTIPLE_CHOICE + counts.QUICK_BUTTON + counts.FILL_IN_THE_BLANK + counts.CROSSWORD,
      100
    );
  });

  it('3. MIXED Case 2 & Case 3 — Deterministic Largest Remainder rounding on non-divisible counts & 0% types strictly get 0 questions', () => {
    // 10 questions with 33% / 33% / 34% / 0%
    const dist = {
      MULTIPLE_CHOICE: 33,
      QUICK_BUTTON: 33,
      FILL_IN_THE_BLANK: 34,
      CROSSWORD: 0,
    };
    const counts = calculateMixedTypeCounts(10, dist);
    assert.equal(counts.CROSSWORD, 0, '0% type must strictly receive 0 questions');
    assert.equal(counts.MULTIPLE_CHOICE, 3);
    assert.equal(counts.QUICK_BUTTON, 3);
    assert.equal(counts.FILL_IN_THE_BLANK, 4);
    assert.equal(
      counts.MULTIPLE_CHOICE + counts.QUICK_BUTTON + counts.FILL_IN_THE_BLANK + counts.CROSSWORD,
      10
    );

    // 7 questions with 50% / 0% / 50% / 0%
    const dist2 = {
      MULTIPLE_CHOICE: 50,
      QUICK_BUTTON: 0,
      FILL_IN_THE_BLANK: 50,
      CROSSWORD: 0,
    };
    const counts2 = calculateMixedTypeCounts(7, dist2);
    assert.equal(counts2.QUICK_BUTTON, 0);
    assert.equal(counts2.CROSSWORD, 0);
    assert.equal(counts2.MULTIPLE_CHOICE, 4);
    assert.equal(counts2.FILL_IN_THE_BLANK, 3);
    assert.equal(
      counts2.MULTIPLE_CHOICE + counts2.QUICK_BUTTON + counts2.FILL_IN_THE_BLANK + counts2.CROSSWORD,
      7
    );
  });

  it('4. MIXED Cases 4, 5, 6, 7 — Rejects < 100%, > 100%, negative/NaN/non-integer, and disallowed keys (MIXED, ADVENTURE)', async () => {
    // Case 4: < 100% (80%)
    const under100 = MixedQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: 30,
      QUICK_BUTTON: 20,
      FILL_IN_THE_BLANK: 15,
      CROSSWORD: 15,
    });
    assert.equal(under100.success, false);

    // Case 5: > 100% (120%)
    const over100 = MixedQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: 50,
      QUICK_BUTTON: 30,
      FILL_IN_THE_BLANK: 20,
      CROSSWORD: 20,
    });
    assert.equal(over100.success, false);

    // Case 6: Negative / decimal / > 100 single field
    const negativeRes = MixedQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: -10,
      QUICK_BUTTON: 60,
      FILL_IN_THE_BLANK: 25,
      CROSSWORD: 25,
    });
    assert.equal(negativeRes.success, false);

    const floatRes = MixedQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: 33.5,
      QUICK_BUTTON: 33.5,
      FILL_IN_THE_BLANK: 33,
      CROSSWORD: 0,
    });
    assert.equal(floatRes.success, false);

    // Case 7: Disallowed keys MIXED or ADVENTURE inside distribution
    const nestedMixedRes = MixedQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: 25,
      QUICK_BUTTON: 25,
      FILL_IN_THE_BLANK: 25,
      CROSSWORD: 25,
      MIXED: 0,
    });
    assert.equal(nestedMixedRes.success, false, 'Must reject nested MIXED key');

    const nestedAdvRes = MixedQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: 25,
      QUICK_BUTTON: 25,
      FILL_IN_THE_BLANK: 25,
      CROSSWORD: 25,
      ADVENTURE: 0,
    });
    assert.equal(nestedAdvRes.success, false, 'Must reject nested ADVENTURE key');

    // Verify GenerateGameRequestSchema and HTTP 400 on POST /api/games/generate when mixedDistribution sum != 100
    const userEmail = `validator_${Date.now()}@test.local`;
    const reg = await authService.register({
      email: userEmail,
      password: 'Password123!',
      displayName: 'Validator Tester',
    });

    const badHttp80 = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${reg.token}`)
      .send({
        sources: [SAMPLE_CANONICAL_DOC],
        gameType: 'MIXED',
        questionCount: 8,
        mixedDistribution: {
          MULTIPLE_CHOICE: 40,
          QUICK_BUTTON: 20,
          FILL_IN_THE_BLANK: 10,
          CROSSWORD: 10,
        },
      });
    assert.equal(badHttp80.status, 400);

    const badHttp120 = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${reg.token}`)
      .send({
        sources: [SAMPLE_CANONICAL_DOC],
        gameType: 'MIXED',
        questionCount: 8,
        mixedDistribution: {
          MULTIPLE_CHOICE: 50,
          QUICK_BUTTON: 30,
          FILL_IN_THE_BLANK: 20,
          CROSSWORD: 20,
        },
      });
    assert.equal(badHttp120.status, 400);

    const badHttpNested = await request(app)
      .post('/api/games/generate')
      .set('Authorization', `Bearer ${reg.token}`)
      .send({
        sources: [SAMPLE_CANONICAL_DOC],
        gameType: 'MIXED',
        questionCount: 8,
        mixedDistribution: {
          MULTIPLE_CHOICE: 25,
          QUICK_BUTTON: 25,
          FILL_IN_THE_BLANK: 25,
          CROSSWORD: 25,
          MIXED: 10,
        },
      });
    assert.equal(badHttpNested.status, 400);
  });

  it('5. MIXED Generation & Supplemental Call — Generates exact per-type question structures, supplements missing types, and persists to SQLite', async () => {
    // Provider returns short CROSSWORD on first call (only 1 instead of 2), then supplies the missing CROSSWORD on supplemental call
    const provider = new DeterministicDistributionProvider((prompt, callIdx) => {
      if (callIdx === 1) {
        return {
          title: 'Game Hỗn Hợp Kiểm Thử Bổ Sung',
          description: 'Kiểm thử tự động gọi bổ sung khi thiếu câu Ô chữ',
          questions: [
            makeRawQuestion('MULTIPLE_CHOICE', 1),
            makeRawQuestion('MULTIPLE_CHOICE', 2),
            makeRawQuestion('MULTIPLE_CHOICE', 3),
            makeRawQuestion('QUICK_BUTTON', 1),
            makeRawQuestion('QUICK_BUTTON', 2),
            makeRawQuestion('FILL_IN_THE_BLANK', 1),
            makeRawQuestion('CROSSWORD', 1),
            // Missing 2nd CROSSWORD on purpose!
          ],
        };
      }
      // Supplemental call for CROSSWORD
      assert.ok(
        prompt.includes('CROSSWORD'),
        'Supplemental prompt must specifically request CROSSWORD'
      );
      return {
        title: 'Supplemental Crossword',
        questions: [makeRawQuestion('CROSSWORD', 2)],
      };
    });

    const service = new AiQuestionService(provider);
    const dist = {
      MULTIPLE_CHOICE: 40, // 3 questions (out of 8: 3.2 -> 3)
      QUICK_BUTTON: 25, // 2 questions (out of 8: 2.0 -> 2)
      FILL_IN_THE_BLANK: 10, // 1 question (out of 8: 0.8 -> 1)
      CROSSWORD: 25, // 2 questions (out of 8: 2.0 -> 2)
    };

    const reqPayload = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'MIXED',
      questionCount: 8,
      mixedDistribution: dist,
    });

    const spec = await service.generateGame([SAMPLE_CANONICAL_DOC], reqPayload);
    gameStore.save(spec, Date.now(), null, true);

    assert.equal(provider.callCount, 2, 'Should make 1 initial call + 1 supplemental call');
    assert.equal(spec.gameType, 'MIXED');
    assert.equal(spec.questions.length, 8);
    assert.deepEqual(spec.settings.mixedDistribution, dist);

    const byType = {
      MULTIPLE_CHOICE: spec.questions.filter(q => q.type === 'MULTIPLE_CHOICE'),
      QUICK_BUTTON: spec.questions.filter(q => q.type === 'QUICK_BUTTON'),
      FILL_IN_THE_BLANK: spec.questions.filter(q => q.type === 'FILL_IN_THE_BLANK'),
      CROSSWORD: spec.questions.filter(q => q.type === 'CROSSWORD'),
    };
    assert.equal(byType.MULTIPLE_CHOICE.length, 3);
    assert.equal(byType.QUICK_BUTTON.length, 2);
    assert.equal(byType.FILL_IN_THE_BLANK.length, 1);
    assert.equal(byType.CROSSWORD.length, 2);

    // Verify each question's real data structure (not just relabeled type)
    for (const q of byType.MULTIPLE_CHOICE) {
      assert.equal(Array.isArray(q.choices) && q.choices.length, 4);
      assert.ok(q.choices!.includes(q.correctAnswer));
    }
    for (const q of byType.QUICK_BUTTON) {
      assert.deepEqual(q.choices, ['Đúng', 'Sai']);
      assert.ok(['Đúng', 'Sai'].includes(q.correctAnswer));
    }
    for (const q of byType.FILL_IN_THE_BLANK) {
      assert.ok(q.question.includes('___'));
      assert.equal(q.choices, undefined);
    }
    for (const q of byType.CROSSWORD) {
      assert.ok(q.crosswordClue && q.crosswordClue.length >= 3);
      assert.ok(q.crosswordAnswer && /^[A-Z0-9]{2,20}$/.test(q.crosswordAnswer));
      assert.equal(q.choices, undefined);
    }

    // Verify persistence in SQLite gameStore & reload via GET /api/games/:id
    const persisted = gameStore.get(spec.gameId);
    assert.ok(persisted);
    assert.deepEqual(persisted.settings.mixedDistribution, dist);
    assert.equal(persisted.questions.length, 8);

    const getRes = await request(app).get(`/api/games/${spec.gameId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.data.settings.mixedDistribution, dist);
    assert.equal(getRes.body.data.questions.length, 8);
  });

  it('6. MIXED Unmet Distribution Error — Throws AI_QUESTION_DISTRIBUTION_UNMET (422) instead of silently substituting another type', async () => {
    // Provider always returns MULTIPLE_CHOICE even when CROSSWORD is requested
    const brokenProvider = new DeterministicDistributionProvider(() => ({
      title: 'Broken Provider Output',
      questions: [
        makeRawQuestion('MULTIPLE_CHOICE', 1),
        makeRawQuestion('MULTIPLE_CHOICE', 2),
        makeRawQuestion('MULTIPLE_CHOICE', 3),
        makeRawQuestion('MULTIPLE_CHOICE', 4),
      ],
    }));

    const service = new AiQuestionService(brokenProvider);
    const reqPayload = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'MIXED',
      questionCount: 4,
      mixedDistribution: {
        MULTIPLE_CHOICE: 50,
        QUICK_BUTTON: 0,
        FILL_IN_THE_BLANK: 0,
        CROSSWORD: 50,
      },
    });

    await assert.rejects(
      () => service.generateGame([SAMPLE_CANONICAL_DOC], reqPayload),
      (err: any) => {
        assert.equal(err.code, 'AI_QUESTION_DISTRIBUTION_UNMET');
        assert.equal(err.statusCode, 422);
        return true;
      }
    );
  });

  it('7. ADVENTURE Cases 1, 2, 3, 4 — Supports 1 type (100%), 2 types (60/40), 3 types, and 4 types (25/25/25/25) with unselected types strictly 0%', async () => {
    const provider = new DeterministicDistributionProvider();
    const service = new AiQuestionService(provider);

    // Case 1: 1 type (CROSSWORD = 100%)
    const dist1 = buildDefaultQuestionDistributionForTypes(['CROSSWORD']);
    assert.deepEqual(dist1, {
      MULTIPLE_CHOICE: 0,
      QUICK_BUTTON: 0,
      FILL_IN_THE_BLANK: 0,
      CROSSWORD: 100,
    });
    const req1 = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'ADVENTURE',
      questionCount: 4,
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        questionTypes: ['CROSSWORD'],
        questionDistribution: dist1,
      },
    });
    const game1 = await service.generateGame([SAMPLE_CANONICAL_DOC], req1);
    assert.equal(game1.questions.length, 4);
    assert.ok(game1.questions.every(q => q.type === 'CROSSWORD'));

    // Case 2: 2 types (MULTIPLE_CHOICE = 60%, QUICK_BUTTON = 40%) -> on 5 questions => 3 MC + 2 QB, 0 FILL, 0 CW
    const dist2 = {
      MULTIPLE_CHOICE: 60,
      QUICK_BUTTON: 40,
      FILL_IN_THE_BLANK: 0,
      CROSSWORD: 0,
    };
    const req2 = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'ADVENTURE',
      questionCount: 5,
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
        questionDistribution: dist2,
      },
    });
    const game2 = await service.generateGame([SAMPLE_CANONICAL_DOC], req2);
    assert.equal(game2.questions.filter(q => q.type === 'MULTIPLE_CHOICE').length, 3);
    assert.equal(game2.questions.filter(q => q.type === 'QUICK_BUTTON').length, 2);
    assert.equal(game2.questions.filter(q => q.type === 'FILL_IN_THE_BLANK').length, 0);
    assert.equal(game2.questions.filter(q => q.type === 'CROSSWORD').length, 0);

    // Case 3: 3 types auto-balanced (34 / 33 / 33 / 0) on 6 questions => 2 MC, 2 QB, 2 FILL, 0 CW
    const dist3 = buildDefaultQuestionDistributionForTypes([
      'MULTIPLE_CHOICE',
      'QUICK_BUTTON',
      'FILL_IN_THE_BLANK',
    ]);
    assert.deepEqual(dist3, {
      MULTIPLE_CHOICE: 34,
      QUICK_BUTTON: 33,
      FILL_IN_THE_BLANK: 33,
      CROSSWORD: 0,
    });
    const req3 = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'ADVENTURE',
      questionCount: 6,
      adventureConfig: {
        industryId: 'IT_TECHNOLOGY',
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK'],
        questionDistribution: dist3,
      },
    });
    const game3 = await service.generateGame([SAMPLE_CANONICAL_DOC], req3);
    assert.equal(game3.questions.filter(q => q.type === 'MULTIPLE_CHOICE').length, 2);
    assert.equal(game3.questions.filter(q => q.type === 'QUICK_BUTTON').length, 2);
    assert.equal(game3.questions.filter(q => q.type === 'FILL_IN_THE_BLANK').length, 2);
    assert.equal(game3.questions.filter(q => q.type === 'CROSSWORD').length, 0);

    // Case 4: All 4 types (25% / 25% / 25% / 25%) on 8 questions => 2 of each
    const dist4 = buildDefaultQuestionDistributionForTypes([
      'MULTIPLE_CHOICE',
      'QUICK_BUTTON',
      'FILL_IN_THE_BLANK',
      'CROSSWORD',
    ]);
    assert.deepEqual(dist4, {
      MULTIPLE_CHOICE: 25,
      QUICK_BUTTON: 25,
      FILL_IN_THE_BLANK: 25,
      CROSSWORD: 25,
    });
    const req4 = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'ADVENTURE',
      questionCount: 8,
      adventureConfig: {
        industryId: 'HEALTHCARE_TRAINING',
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'CROSSWORD'],
        questionDistribution: dist4,
      },
    });
    const game4 = await service.generateGame([SAMPLE_CANONICAL_DOC], req4);
    assert.equal(game4.questions.filter(q => q.type === 'MULTIPLE_CHOICE').length, 2);
    assert.equal(game4.questions.filter(q => q.type === 'QUICK_BUTTON').length, 2);
    assert.equal(game4.questions.filter(q => q.type === 'FILL_IN_THE_BLANK').length, 2);
    assert.equal(game4.questions.filter(q => q.type === 'CROSSWORD').length, 2);
    assert.deepEqual(game4.settings.adventureConfig?.questionDistribution, dist4);
  });

  it('8. ADVENTURE Cases 5, 6, 7 — Rejects empty questionTypes, sum != 100%, unselected type > 0%, and disallowed MIXED/ADVENTURE types', () => {
    // Case 5: Empty questionTypes
    const emptyTypes = GenerateAdventureConfigInputSchema.safeParse({
      industryId: 'MOTORCYCLE_TRAFFIC',
      questionTypes: [],
    });
    assert.equal(emptyTypes.success, false, 'Empty questionTypes must be rejected');

    // Case 6: Sum != 100% (e.g., 70% or 130%)
    const under100 = GenerateAdventureConfigInputSchema.safeParse({
      industryId: 'MOTORCYCLE_TRAFFIC',
      questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
      questionDistribution: {
        MULTIPLE_CHOICE: 40,
        QUICK_BUTTON: 30,
        FILL_IN_THE_BLANK: 0,
        CROSSWORD: 0,
      },
    });
    assert.equal(under100.success, false);

    const over100 = GenerateAdventureConfigInputSchema.safeParse({
      industryId: 'MOTORCYCLE_TRAFFIC',
      questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON'],
      questionDistribution: {
        MULTIPLE_CHOICE: 80,
        QUICK_BUTTON: 50,
        FILL_IN_THE_BLANK: 0,
        CROSSWORD: 0,
      },
    });
    assert.equal(over100.success, false);

    // Unselected type given > 0%
    const unselectedNonZero = GenerateAdventureConfigInputSchema.safeParse({
      industryId: 'MOTORCYCLE_TRAFFIC',
      questionTypes: ['MULTIPLE_CHOICE'],
      questionDistribution: {
        MULTIPLE_CHOICE: 50,
        QUICK_BUTTON: 50,
        FILL_IN_THE_BLANK: 0,
        CROSSWORD: 0,
      },
    });
    assert.equal(
      unselectedNonZero.success,
      false,
      'Unselected type with > 0% must be rejected by superRefine'
    );

    // Case 7: Disallowed MIXED or ADVENTURE in questionTypes or questionDistribution
    const mixedInAdvTypes = GenerateAdventureConfigInputSchema.safeParse({
      industryId: 'MOTORCYCLE_TRAFFIC',
      questionTypes: ['MULTIPLE_CHOICE', 'MIXED'],
    });
    assert.equal(mixedInAdvTypes.success, false);

    const advInAdvDist = AdventureQuestionDistributionSchema.safeParse({
      MULTIPLE_CHOICE: 50,
      QUICK_BUTTON: 50,
      FILL_IN_THE_BLANK: 0,
      CROSSWORD: 0,
      ADVENTURE: 0,
    });
    assert.equal(advInAdvDist.success, false);
  });

  it('9. ADVENTURE Checkpoint Evaluation & Live Session — Evaluates MULTIPLE_CHOICE, QUICK_BUTTON, FILL_IN_THE_BLANK, and CROSSWORD accurately', async () => {
    const mcQ: GameQuestion = {
      id: 'q_mc_1',
      type: 'MULTIPLE_CHOICE',
      difficulty: 'MEDIUM',
      question: 'Bước xử lý chuẩn là gì?',
      choices: ['A. Đúng chuẩn', 'B. Sai 1', 'C. Sai 2', 'D. Sai 3'],
      correctAnswer: 'A. Đúng chuẩn',
      explanation: 'Giải thích MC',
      sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'Doc' },
    };
    const qbQ: GameQuestion = {
      id: 'q_qb_1',
      type: 'QUICK_BUTTON',
      difficulty: 'EASY',
      question: 'Nhận định này đúng hay sai?',
      choices: ['Đúng', 'Sai'],
      correctAnswer: 'Đúng',
      explanation: 'Giải thích QB',
      sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'Doc' },
    };
    const fillQ: GameQuestion = {
      id: 'q_fill_1',
      type: 'FILL_IN_THE_BLANK',
      difficulty: 'MEDIUM',
      question: 'Luôn đội mũ ___ đạt chuẩn.',
      blankPrompt: 'Luôn đội mũ ___ đạt chuẩn.',
      correctAnswer: 'bảo hiểm',
      acceptedAlternatives: ['bao hiem'],
      explanation: 'Giải thích FILL',
      sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'Doc' },
    };
    const cwQ: GameQuestion = {
      id: 'q_cw_1',
      type: 'CROSSWORD',
      difficulty: 'HARD',
      question: 'Giải ô chữ (8 chữ cái): Trang bị bảo vệ đầu khi lái mô tô?',
      crosswordClue: 'Trang bị bảo vệ đầu khi lái mô tô (8 chữ cái)',
      crosswordAnswer: 'MUBAOHIEM',
      correctAnswer: 'MUBAOHIEM',
      explanation: 'Giải thích CW',
      sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'Doc' },
    };

    // Runner preview answer evaluation
    assert.equal(evaluateRunnerPreviewAnswer(mcQ, 'A. Đúng chuẩn'), true);
    assert.equal(evaluateRunnerPreviewAnswer(mcQ, 'A'), true);
    assert.equal(evaluateRunnerPreviewAnswer(mcQ, 'B. Sai 1'), false);

    assert.equal(evaluateRunnerPreviewAnswer(qbQ, 'Đúng'), true);
    assert.equal(evaluateRunnerPreviewAnswer(qbQ, 'Sai'), false);

    assert.equal(evaluateRunnerPreviewAnswer(fillQ, 'Bảo hiểm'), true);
    assert.equal(evaluateRunnerPreviewAnswer(fillQ, 'bao hiem'), true);
    assert.equal(evaluateRunnerPreviewAnswer(fillQ, 'nón vải'), false);

    assert.equal(normalizeCrosswordAnswerForRunner('Mũ Bảo Hiểm!'), 'MUBAOHIEM');
    assert.equal(evaluateRunnerPreviewAnswer(cwQ, 'mũ bảo hiểm'), true);
    assert.equal(evaluateRunnerPreviewAnswer(cwQ, 'MUBAOHIEM'), true);
    assert.equal(evaluateRunnerPreviewAnswer(cwQ, 'SAIOTCHU'), false);

    // Also verify backend live session (GameSession) handles all 4 question types including crosswordWordLength
    const provider = new DeterministicDistributionProvider();
    const service = new AiQuestionService(provider);
    const reqPayload = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'ADVENTURE',
      questionCount: 4,
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'CROSSWORD'],
        questionDistribution: {
          MULTIPLE_CHOICE: 25,
          QUICK_BUTTON: 25,
          FILL_IN_THE_BLANK: 25,
          CROSSWORD: 25,
        },
      },
    });
    const advGame = await service.generateGame([SAMPLE_CANONICAL_DOC], reqPayload);
    gameStore.save(advGame, Date.now(), null, true);

    const session = new GameSession('sess_4types_test', advGame);
    session.start();

    for (let i = 0; i < advGame.questions.length; i++) {
      const clientQ = session.getCurrentClientQuestion();
      const serverQ = advGame.questions[i];
      assert.equal(clientQ.type, serverQ.type);

      if (serverQ.type === 'CROSSWORD') {
        assert.equal(
          clientQ.crosswordWordLength,
          (serverQ.crosswordAnswer || serverQ.correctAnswer).length,
          'ClientQuestion must expose crosswordWordLength without exposing correctAnswer'
        );
        assert.equal((clientQ as any).correctAnswer, undefined);
      }

      const ansResult = session.submitAnswer(serverQ.id, serverQ.correctAnswer, 1800);
      assert.equal(ansResult.isCorrect, true);
      session.advance();
    }
  });

  it('10. Real Browser E2E — Verifies Creator Studio MIXED & ADVENTURE ratio controls + Adventure 2D checkpoint UI for all 4 question types', async () => {
    const provider = new DeterministicDistributionProvider();
    const service = new AiQuestionService(provider);
    const packRes = resolveAdventureAssetPack('MOTORCYCLE_TRAFFIC');
    assert.equal(packRes.verified, true);

    const reqPayload = GenerateGameRequestSchema.parse({
      sources: [SAMPLE_CANONICAL_DOC],
      gameType: 'ADVENTURE',
      questionCount: 4,
      adventureConfig: {
        industryId: 'MOTORCYCLE_TRAFFIC',
        questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'CROSSWORD'],
        questionDistribution: {
          MULTIPLE_CHOICE: 25,
          QUICK_BUTTON: 25,
          FILL_IN_THE_BLANK: 25,
          CROSSWORD: 25,
        },
      },
    });
    const advGame = await service.generateGame([SAMPLE_CANONICAL_DOC], reqPayload);
    advGame.settings.adventureConfig = {
      ...advGame.settings.adventureConfig!,
      assetStatus: 'READY',
      assetPackId: packRes.pack!.packId,
      assetPackSource: 'VERIFIED_PACK',
      assets: packRes.pack!.assets,
    };

    const userEmail = `creator_mixed_${Date.now()}@test.local`;
    const reg = await authService.register({
      email: userEmail,
      password: 'Password123!',
      displayName: 'Creator Mixed Tester',
    });
    gameStore.save(advGame, Date.now(), reg.user.userId, true);

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const browser = await Browser.launch({ width: 1440, height: 900 });
    try {
      const page = await browser.newPage({ width: 1440, height: 900 });

      // 1. Open Creator Studio and verify MIXED & ADVENTURE ratio controls
      await page.goto(baseUrl, { settleMs: 600 });
      await page.eval(`(() => {
        localStorage.setItem('ai_game_auth_token', ${JSON.stringify(reg.token)});
        localStorage.setItem('ai_game_auth_user', ${JSON.stringify(JSON.stringify(reg.user))});
      })()`);
      await page.goto(baseUrl, { settleMs: 800 });

      // Navigate to Creator Studio tab if not already on it
      await page.eval(`(() => {
        const createNav = Array.from(document.querySelectorAll('button, a')).find(
          el => /Tạo Game|Creator Studio/i.test(el.textContent || '')
        );
        if (createNav) createNav.click();
      })()`);
      await sleep(500);

      // Select MIXED game type
      const mixedPanelCheck = await page.eval(`(() => {
        const btn = document.querySelector('[data-testid="game-type-option-MIXED"]');
        if (!btn) return { foundBtn: false };
        btn.click();
        return { foundBtn: true };
      })()`);
      assert.equal(mixedPanelCheck.foundBtn, true, 'MIXED option button must exist in GameTypeSelector');
      await sleep(300);

      const mixedUiState = await page.eval(`(() => {
        const panel = document.querySelector('[data-testid="mixed-distribution-panel"]');
        const badge = document.querySelector('[data-testid="mixed-total-badge"]');
        const mcCount = document.querySelector('[data-testid="mixed-count-MULTIPLE_CHOICE"]');
        return {
          hasPanel: Boolean(panel),
          badgeText: badge ? badge.textContent : '',
          mcCountText: mcCount ? mcCount.textContent : '',
        };
      })()`);
      assert.equal(mixedUiState.hasPanel, true, 'MIXED distribution panel must render');
      assert.ok(mixedUiState.badgeText.includes('100%'), 'Default MIXED total must be 100%');

      // Select ADVENTURE game type and verify 4 question types + ratio config panel
      await page.eval(`(() => {
        const btn = document.querySelector('[data-testid="game-type-option-ADVENTURE"]');
        if (btn) btn.click();
      })()`);
      await sleep(350);

      const advUiState = await page.eval(`(() => {
        const panel = document.querySelector('[data-testid="adventure-question-config-panel"]');
        const cwToggle = document.querySelector('[data-testid="adventure-type-toggle-CROSSWORD"]');
        const totalBadge = document.querySelector('[data-testid="adventure-total-badge"]');
        return {
          hasPanel: Boolean(panel),
          hasCrosswordToggle: Boolean(cwToggle),
          totalBadgeText: totalBadge ? totalBadge.textContent : '',
        };
      })()`);
      assert.equal(advUiState.hasPanel, true, 'Adventure question config panel must render');
      assert.equal(advUiState.hasCrosswordToggle, true, 'CROSSWORD toggle must exist in Adventure config');
      assert.ok(advUiState.totalBadgeText.includes('100%'), 'Default Adventure total must be 100%');

      // Toggle CROSSWORD on (3 types selected) -> auto-rebalances to 34% / 33% / 0% / 33%
      await page.eval(`(() => {
        const cwToggle = document.querySelector('[data-testid="adventure-type-toggle-CROSSWORD"]');
        if (cwToggle) cwToggle.click();
      })()`);
      await sleep(250);

      const advThreeTypesState = await page.eval(`(() => {
        const mcVal = document.querySelector('[data-testid="adventure-input-MULTIPLE_CHOICE"]')?.value;
        const qbVal = document.querySelector('[data-testid="adventure-input-QUICK_BUTTON"]')?.value;
        const fillVal = document.querySelector('[data-testid="adventure-input-FILL_IN_THE_BLANK"]')?.value;
        const cwVal = document.querySelector('[data-testid="adventure-input-CROSSWORD"]')?.value;
        const selectedBadge = document.querySelector('[data-testid="adventure-selected-types-badge"]')?.textContent;
        return { mcVal, qbVal, fillVal, cwVal, selectedBadge };
      })()`);
      assert.equal(advThreeTypesState.mcVal, '34');
      assert.equal(advThreeTypesState.qbVal, '33');
      assert.equal(advThreeTypesState.fillVal, '0');
      assert.equal(advThreeTypesState.cwVal, '33');
      assert.ok(advThreeTypesState.selectedBadge.includes('3/4'));

      // Toggle FILL_IN_THE_BLANK on so all 4 types are selected -> auto-rebalances to 25% / 25% / 25% / 25%
      await page.eval(`(() => {
        const fillToggle = document.querySelector('[data-testid="adventure-type-toggle-FILL_IN_THE_BLANK"]');
        if (fillToggle) fillToggle.click();
      })()`);
      await sleep(250);

      const advFourTypesState = await page.eval(`(() => {
        const mcVal = document.querySelector('[data-testid="adventure-input-MULTIPLE_CHOICE"]')?.value;
        const qbVal = document.querySelector('[data-testid="adventure-input-QUICK_BUTTON"]')?.value;
        const fillVal = document.querySelector('[data-testid="adventure-input-FILL_IN_THE_BLANK"]')?.value;
        const cwVal = document.querySelector('[data-testid="adventure-input-CROSSWORD"]')?.value;
        const selectedBadge = document.querySelector('[data-testid="adventure-selected-types-badge"]')?.textContent;
        return { mcVal, qbVal, fillVal, cwVal, selectedBadge };
      })()`);
      assert.equal(advFourTypesState.mcVal, '25');
      assert.equal(advFourTypesState.qbVal, '25');
      assert.equal(advFourTypesState.fillVal, '25');
      assert.equal(advFourTypesState.cwVal, '25');
      assert.ok(advFourTypesState.selectedBadge.includes('4/4'));

      // 2. Navigate to guest play link for advGame and verify all 4 checkpoint question types in AdventureGameEngine
      await page.goto(`${baseUrl}/?play=${advGame.gameId}`, { settleMs: 900 });

      for (let w = 0; w < 20; w++) {
        const ready = await page.eval(`(() => {
          const vp = document.querySelector('[data-testid="adventure-game-viewport"]');
          return vp?.getAttribute('data-asset-status') === 'READY';
        })()`);
        if (ready) break;
        await sleep(200);
      }

      // Click Start button -> character begins auto-running
      await page.eval(`document.querySelector('[data-testid="start-adventure-btn"]')?.click()`);
      await sleep(250);

      const seenQuestionTypes: string[] = [];

      for (let stageIdx = 0; stageIdx < 4; stageIdx++) {
        // Wait until checkpoint modal appears
        let modalAppeared = false;
        for (let tick = 0; tick < 60; tick++) {
          const check = await page.eval(`(() => {
            const modal = document.querySelector('[data-testid="runner-checkpoint-modal"]');
            if (modal) {
              const badge = document.querySelector('[data-testid="checkpoint-question-type-badge"]');
              return {
                open: true,
                qType: badge?.getAttribute('data-question-type') || '',
              };
            }
            return { open: false, qType: '' };
          })()`);
          if (check.open) {
            modalAppeared = true;
            seenQuestionTypes.push(check.qType);
            break;
          }
          await sleep(220);
        }

        assert.equal(modalAppeared, true, `Checkpoint #${stageIdx + 1} modal must open`);

        const currentServerQ = advGame.questions[stageIdx];
        // Verify specific checkpoint UI for the current question type and submit the answer
        const submitOutcome = await page.eval(`((expectedAnswer, qType) => {
          if (qType === 'MULTIPLE_CHOICE') {
            const group = document.querySelector('[data-testid="checkpoint-multiple-choice-group"]');
            const btn0 = document.querySelector('[data-testid="checkpoint-choice-0"]');
            if (btn0) btn0.click();
            return { hasSpecificUi: Boolean(group), clicked: Boolean(btn0) };
          }
          if (qType === 'QUICK_BUTTON') {
            const group = document.querySelector('[data-testid="checkpoint-quick-button-group"]');
            const btns = Array.from(document.querySelectorAll('[data-testid^="checkpoint-choice-"]'));
            const match = btns.find(b => (b.textContent || '').includes(expectedAnswer)) || btns[0];
            if (match) match.click();
            return { hasSpecificUi: Boolean(group), clicked: Boolean(match) };
          }
          if (qType === 'FILL_IN_THE_BLANK') {
            const box = document.querySelector('[data-testid="checkpoint-fill-blank-box"]');
            const input = document.querySelector('[data-testid="checkpoint-fill-blank-input"]');
            if (input) {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeSetter.call(input, expectedAnswer);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { hasSpecificUi: Boolean(box && input), clicked: true };
          }
          if (qType === 'CROSSWORD') {
            const box = document.querySelector('[data-testid="checkpoint-crossword-box"]');
            const slots = document.querySelector('[data-testid="checkpoint-crossword-slots"]');
            const input = document.querySelector('[data-testid="checkpoint-crossword-input"]');
            if (input) {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeSetter.call(input, expectedAnswer);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { hasSpecificUi: Boolean(box && slots && input), clicked: true };
          }
          return { hasSpecificUi: false, clicked: false };
        })(${JSON.stringify(currentServerQ.correctAnswer)}, ${JSON.stringify(currentServerQ.type)})`);

        assert.equal(
          submitOutcome.hasSpecificUi,
          true,
          `Checkpoint UI for ${currentServerQ.type} must render its dedicated component`
        );

        if (currentServerQ.type === 'FILL_IN_THE_BLANK' || currentServerQ.type === 'CROSSWORD') {
          await sleep(150);
          await page.eval(`(() => {
            const submitBtn = document.querySelector('[data-testid="checkpoint-submit-answer-btn"]');
            if (submitBtn) submitBtn.click();
          })()`);
        }

        // Wait for feedback panel and click continue
        let feedbackShown = false;
        for (let w = 0; w < 20; w++) {
          const fb = await page.eval(`(() => {
            const panel = document.querySelector('[data-testid="checkpoint-feedback-panel"]');
            const contBtn = document.querySelector('[data-testid="checkpoint-continue-btn"]');
            if (panel && contBtn) {
              contBtn.click();
              return true;
            }
            return false;
          })()`);
          if (fb) {
            feedbackShown = true;
            break;
          }
          await sleep(200);
        }
        assert.equal(feedbackShown, true, `Feedback panel must appear at checkpoint #${stageIdx + 1}`);
      }

      assert.deepEqual(seenQuestionTypes, [
        'MULTIPLE_CHOICE',
        'QUICK_BUTTON',
        'FILL_IN_THE_BLANK',
        'CROSSWORD',
      ]);
    } finally {
      await browser.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
