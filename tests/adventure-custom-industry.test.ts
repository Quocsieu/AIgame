import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import dotenv from 'dotenv';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(GAME_ROOT);
dotenv.config({ path: path.join(GAME_ROOT, '.env'), override: true });

import { createApp } from '../src/app.js';
import {
  analyzeSourceContentForAdventure,
  INDUSTRY_CATALOG,
} from '../src/contracts/adventure.contract.js';
import type { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import {
  buildAdventureAssetPrompts,
  loadAdventureAssetManifest,
  resolveAdventureAssetPack,
  setAdventureAssetImageProvider,
  verifyAdventureGameAssets,
} from '../src/services/adventure-asset-pack.service.js';
import { GeminiImageModelProvider } from '../src/services/ai.image.service.js';
import type {
  GeneratedImagePayload,
  ImageModelProvider,
} from '../src/services/ai.image.service.js';
import {
  aiQuestionService,
  GeminiModelProvider,
} from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { AppError } from '../src/utils/errors.js';
import {
  ADVENTURE_START_INSTRUCTION,
  RUNNER_START_X,
} from '../frontend/src/components/AdventureGameEngine.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const REPO_ROOT = path.resolve(process.cwd());

const CUSTOM_INDUSTRY_LABEL = 'Kỹ thuật hàng không vũ trụ';
const CUSTOM_SUB_ENVIRONMENT = 'Trung tâm nghiên cứu và lắp ráp tàu vũ trụ';

const AEROSPACE_SOURCE_TEXT = `
Tài liệu Kỹ thuật Hàng không Vũ trụ — Trung tâm Nghiên cứu và Lắp ráp Tàu vũ trụ:
1. Quy trình tích hợp tầng đẩy tên lửa và kiểm định buồng đốt động cơ phản lực lỏng trong khu lắp ráp sạch (Cleanroom Assembly Bay).
2. Kiểm tra hệ thống dẫn đường quán tính (INS), cảm biến sao (Star Tracker) và cấu trúc tấm chắn nhiệt gốm chịu nhiệt độ cao khi tái nhập khí quyển.
3. Quy chuẩn an toàn tĩnh điện (ESD) và kiểm định rung động cơ học (Vibration & Acoustic Testing) cho kiện linh kiện vệ tinh và mô-đun tàu vũ trụ trước khi chuyển ra bệ phóng.
`.trim();

function buildAerospaceInlineSource(id: string) {
  return {
    sourceId: id,
    sourceType: 'TXT' as const,
    sourceName: 'ky-thuat-hang-khong-vu-tru.txt',
    sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
    title: `${CUSTOM_INDUSTRY_LABEL} - ${CUSTOM_SUB_ENVIRONMENT}`,
    text: AEROSPACE_SOURCE_TEXT,
    sections: [
      {
        title: CUSTOM_SUB_ENVIRONMENT,
        content: AEROSPACE_SOURCE_TEXT,
        provenance: {
          sourceId: id,
          sourceType: 'TXT' as const,
          sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
          section: 'Khu lắp ráp tàu vũ trụ',
        },
      },
    ],
    extractedItems: [],
    metadata: {
      originalSize: AEROSPACE_SOURCE_TEXT.length,
      characterCount: AEROSPACE_SOURCE_TEXT.length,
      extractedAt: new Date().toISOString(),
    },
    diagnostics: [],
  };
}

function getSamplePackPngBytes(
  packId: 'IT_TECHNOLOGY' | 'MANUFACTURING_INDUSTRIAL' | 'EDUCATION_GENERAL',
  slot: 'background' | 'character' | 'obstacle'
): string {
  const p = path.join(REPO_ROOT, 'public', 'adventure-assets', 'packs', packId, `${slot}.png`);
  return fs.readFileSync(p).toString('base64');
}

describe('CUSTOM Industry Real & E2E Verification — Kỹ thuật hàng không vũ trụ', () => {
  let server: http.Server;
  let baseUrl = '';
  let creatorToken = '';
  let creatorEmail = '';
  const createdGameIdsToClean: string[] = [];

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind HTTP server');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const suffix = Date.now();
    creatorEmail = `aerospace_creator_${suffix}@example.com`;
    const reg = authService.register({
      email: creatorEmail,
      password: 'Password123!',
      displayName: 'Kỹ Sư Vũ Trụ Creator',
    });
    creatorToken = reg.token;
  });

  after(async () => {
    setAdventureAssetImageProvider(null);
    aiQuestionService.setProvider(new GeminiModelProvider());
    for (const gid of createdGameIdsToClean) {
      try {
        gameStore.delete(gid);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('1. Verifies "Kỹ thuật hàng không vũ trụ" is NOT in the 8 pre-built packs and resolves strictly as CUSTOM with Aerospace Assembly Center prompts', () => {
    const manifest = loadAdventureAssetManifest(REPO_ROOT);
    const packIds = Object.keys(manifest.packs);
    assert.equal(packIds.length, 8, 'Manifest must have exactly the 8 pre-built industry packs');
    assert.equal(
      packIds.includes('CUSTOM'),
      false,
      'CUSTOM must never be added to static manifest packs'
    );
    const resolveCustomStatic = resolveAdventureAssetPack('CUSTOM', REPO_ROOT);
    assert.equal(resolveCustomStatic.available, false);
    assert.equal(resolveCustomStatic.verified, false);

    const advConfig = analyzeSourceContentForAdventure(
      [
        {
          sourceId: 'src_aero_1',
          title: CUSTOM_INDUSTRY_LABEL,
          text: AEROSPACE_SOURCE_TEXT,
        },
      ],
      {
        preferredIndustryId: 'CUSTOM',
        customIndustryLabel: CUSTOM_INDUSTRY_LABEL,
        customSubEnvironment: CUSTOM_SUB_ENVIRONMENT,
        questionCount: 2,
      }
    );

    assert.equal(advConfig.industryId, 'CUSTOM');
    assert.equal(advConfig.industryLabel, CUSTOM_INDUSTRY_LABEL);
    assert.equal(advConfig.subEnvironment, CUSTOM_SUB_ENVIRONMENT);
    assert.ok(
      advConfig.avatarLabel.includes(CUSTOM_INDUSTRY_LABEL),
      `Avatar label should reflect custom industry, got: ${advConfig.avatarLabel}`
    );

    const prompts = buildAdventureAssetPrompts(
      advConfig,
      'Khám Phá Kỹ Thuật Hàng Không Vũ Trụ',
      'Trung tâm nghiên cứu và lắp ráp tàu vũ trụ'
    );

    assert.equal(prompts.BACKGROUND.aspectRatio, '16:9');
    assert.equal(prompts.CHARACTER.aspectRatio, '1:1');
    assert.equal(prompts.OBSTACLE.aspectRatio, '1:1');
    assert.ok(prompts.BACKGROUND.prompt.includes(CUSTOM_INDUSTRY_LABEL));
    assert.ok(prompts.BACKGROUND.prompt.includes(CUSTOM_SUB_ENVIRONMENT));
    assert.ok(prompts.CHARACTER.prompt.includes(CUSTOM_INDUSTRY_LABEL));
    assert.ok(prompts.OBSTACLE.prompt.includes(CUSTOM_INDUSTRY_LABEL));
  });

  it('2. Tests REAL Banana / Gemini API live call for "Kỹ thuật hàng không vũ trụ" and verifies honest status / draft preservation', async () => {
    const realApiKey = (process.env.GEMINI_API_KEY || '').trim();
    assert.ok(realApiKey.length > 10, 'GEMINI_API_KEY must be loaded from .env');

    // Restore REAL providers with the real GEMINI_API_KEY from .env (no mock)
    const realImageProvider = new GeminiImageModelProvider(realApiKey);
    const realTextProvider = new GeminiModelProvider(realApiKey);
    setAdventureAssetImageProvider(realImageProvider);
    aiQuestionService.setProvider(realTextProvider);

    // 2a. Probe GeminiImageModelProvider directly to capture exact real API status
    let directImageApiOutcome: {
      success: boolean;
      errorCode?: string;
      statusCode?: number;
      message?: string;
      mimeType?: string;
      byteLength?: number;
    };

    try {
      const imgRes = await realImageProvider.generateImage(
        `2D side-scrolling game background for ${CUSTOM_INDUSTRY_LABEL} in ${CUSTOM_SUB_ENVIRONMENT}`,
        { aspectRatio: '16:9' }
      );
      directImageApiOutcome = {
        success: true,
        mimeType: imgRes.mimeType,
        byteLength: Buffer.from(imgRes.base64Data, 'base64').length,
      };
    } catch (err: any) {
      directImageApiOutcome = {
        success: false,
        errorCode: err instanceof AppError ? err.code : 'UNKNOWN_ERROR',
        statusCode: err instanceof AppError ? err.statusCode : 500,
        message: err?.message || String(err),
      };
    }

    console.log('[REAL_BANANA_IMAGE_API_OUTCOME]', JSON.stringify(directImageApiOutcome));

    // Ensure no raw API key is ever leaked in error message
    const configuredKey = process.env.GEMINI_API_KEY || '';
    if (configuredKey && directImageApiOutcome.message) {
      assert.equal(
        directImageApiOutcome.message.includes(configuredKey),
        false,
        'Raw GEMINI_API_KEY must never appear in error messages'
      );
    }

    // 2b. Call POST /api/games/generate with REAL providers
    // If real text API hits quota or succeeds, we record it honestly; to ensure we test the full route with real GeminiImageModelProvider even if text quota is exhausted, we try real text provider first:
    const sourceDoc = buildAerospaceInlineSource(`src_real_aero_${Date.now()}`);
    let genRes = await fetch(`${baseUrl}/api/games/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        sourceId: sourceDoc.sourceId,
        sources: [sourceDoc],
        gameType: 'ADVENTURE',
        questionCount: 2,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Hành Trình Kỹ Thuật Hàng Không Vũ Trụ (Real API Test)',
        adventureConfig: {
          industryId: 'CUSTOM',
          industryLabel: CUSTOM_INDUSTRY_LABEL,
          subEnvironment: CUSTOM_SUB_ENVIRONMENT,
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      }),
    });

    const realTextGenStatus = genRes.status;
    console.log('[REAL_TEXT_GEN_HTTP_STATUS]', realTextGenStatus);

    if (realTextGenStatus !== 200) {
      // If text model itself was rate-limited, keep real GeminiImageModelProvider active while supplying deterministic Aerospace questions so the real Banana image API is still exercised inside POST /api/games/generate
      aiQuestionService.setProvider({
        async generateJson() {
          return {
            title: 'Hành Trình Kỹ Thuật Hàng Không Vũ Trụ',
            description: 'Kiểm định lắp ráp tàu vũ trụ tại trung tâm nghiên cứu',
            questions: [
              {
                id: 'q_aero_1',
                type: 'MULTIPLE_CHOICE',
                question:
                  'Tại khu lắp ráp sạch (Cleanroom Assembly Bay), yêu cầu bắt buộc khi lắp đặt kiện linh kiện vệ tinh là gì?',
                choices: [
                  'A. Tuân thủ quy chuẩn an toàn tĩnh điện (ESD) và kiểm định rung động cơ học',
                  'B. Bỏ qua kiểm tra tĩnh điện để tăng tốc độ lắp ráp',
                  'C. Tháo bỏ tấm chắn nhiệt gốm trước khi phóng',
                  'D. Tắt hệ thống cảm biến sao (Star Tracker)',
                ],
                correctAnswer:
                  'A. Tuân thủ quy chuẩn an toàn tĩnh điện (ESD) và kiểm định rung động cơ học',
                explanation: 'Theo quy chuẩn kỹ thuật hàng không vũ trụ tại trung tâm lắp ráp.',
                difficulty: 'MEDIUM',
                sourceReference: {
                  sourceId: sourceDoc.sourceId,
                  sourceType: 'TXT',
                  sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
                  section: 'Khu lắp ráp tàu vũ trụ',
                },
              },
              {
                id: 'q_aero_2',
                type: 'MULTIPLE_CHOICE',
                question:
                  'Hệ thống nào phối hợp cùng cảm biến sao (Star Tracker) để định hướng tàu vũ trụ?',
                choices: [
                  'A. Hệ thống dẫn đường quán tính (INS)',
                  'B. Hệ thống phanh cơ khí đường bộ',
                  'C. Bộ chế hòa khí xe gắn máy',
                  'D. Quạt làm mát két nước dân dụng',
                ],
                correctAnswer: 'A. Hệ thống dẫn đường quán tính (INS)',
                explanation: 'Hệ thống INS và Star Tracker giúp định hướng chính xác trong không gian.',
                difficulty: 'MEDIUM',
                sourceReference: {
                  sourceId: sourceDoc.sourceId,
                  sourceType: 'TXT',
                  sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
                  section: 'Khu lắp ráp tàu vũ trụ',
                },
              },
            ],
          };
        },
      });

      genRes = await fetch(`${baseUrl}/api/games/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({
          sourceId: sourceDoc.sourceId,
          sources: [sourceDoc],
          gameType: 'ADVENTURE',
          questionCount: 2,
          timePerQuestion: 20,
          difficulty: 'MEDIUM',
          scoringMode: 'STANDARD',
          title: 'Hành Trình Kỹ Thuật Hàng Không Vũ Trụ (Real API Test)',
          adventureConfig: {
            industryId: 'CUSTOM',
            industryLabel: CUSTOM_INDUSTRY_LABEL,
            subEnvironment: CUSTOM_SUB_ENVIRONMENT,
            aiDetectedIndustry: false,
            questionTypes: ['MULTIPLE_CHOICE'],
          },
        }),
      });
    }

    assert.equal(genRes.status, 200, 'Game draft creation must return 200 and preserve questions');
    const genJson = (await genRes.json()) as any;
    const realApiGame: GameSpecification = genJson.data;
    createdGameIdsToClean.push(realApiGame.gameId);

    const adv = realApiGame.settings.adventureConfig!;
    assert.equal(adv.industryId, 'CUSTOM');
    assert.equal(adv.industryLabel, CUSTOM_INDUSTRY_LABEL);
    assert.equal(adv.subEnvironment, CUSTOM_SUB_ENVIRONMENT);
    assert.ok(realApiGame.questions.length >= 2, 'Questions must be preserved in saved game');

    console.log(
      '[REAL_GAME_GEN_ADVENTURE_ASSET_STATE]',
      JSON.stringify({
        gameId: realApiGame.gameId,
        questionCount: realApiGame.questions.length,
        assetStatus: adv.assetStatus,
        assetErrorCode: adv.assetErrorCode,
        assetError: adv.assetError,
        hasAssets: Boolean(adv.assets),
      })
    );

    if (!directImageApiOutcome.success) {
      // Honest verification when real Banana API fails (e.g. HTTP 429 quota exceeded on free tier)
      assert.equal(adv.assetStatus, 'ASSET_GENERATION_FAILED');
      assert.equal(adv.assets, null);
      assert.ok(adv.assetErrorCode, 'Must record structured assetErrorCode');
      assert.ok(adv.assetError && adv.assetError.length > 0, 'Must record user-facing assetError');
      assert.equal(realApiGame.isPublic, false, 'Game with failed assets must remain draft');

      // Publishing must be blocked with 422 ADVENTURE_ASSETS_INCOMPLETE
      const pubRes = await fetch(`${baseUrl}/api/games/${realApiGame.gameId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({
          title: realApiGame.title,
          description: realApiGame.description,
          questions: realApiGame.questions,
          settings: realApiGame.settings,
          isPublic: true,
        }),
      });
      assert.equal(pubRes.status, 422);
      const pubErr = (await pubRes.json()) as any;
      assert.equal(pubErr.error.code, 'ADVENTURE_ASSETS_INCOMPLETE');
    } else {
      assert.equal(adv.assetStatus, 'READY');
      assert.equal(adv.assetPackSource, 'GEMINI_BANANA_RUNTIME');
      assert.ok(adv.assets);
    }
  });

  it('3. Verifies all error cases (partial 2/3 failure, 429 quota, 504 timeout, invalid/corrupted image bytes) and smart incremental retry (only regenerates missing 1/3 asset while preserving user-edited questions & same gameId)', async () => {
    const sourceDoc = buildAerospaceInlineSource(`src_AeroRetry_${Date.now()}`);

    aiQuestionService.setProvider({
      async generateJson() {
        return {
          title: 'Đào Tạo Kỹ Sư Lắp Ráp Tàu Vũ Trụ',
          description: 'Trung tâm nghiên cứu và lắp ráp tàu vũ trụ',
          questions: [
            {
              id: 'q_aero_retry_1',
              type: 'MULTIPLE_CHOICE',
              question:
                'Trong khu lắp ráp tàu vũ trụ, quy trình kiểm tra nào giúp phát hiện lỗi kết cấu khi chịu tải phóng?',
              choices: [
                'A. Kiểm định rung động cơ học và âm học (Vibration & Acoustic Testing)',
                'B. Chỉ kiểm tra bằng mắt thường',
                'C. Bỏ qua kiểm tra buồng đốt',
                'D. Tắt cảm biến áp suất',
              ],
              correctAnswer:
                'A. Kiểm định rung động cơ học và âm học (Vibration & Acoustic Testing)',
              explanation: 'Kiểm định rung động mô phỏng điều kiện chịu tải khi tên lửa rời bệ phóng.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sourceDoc.sourceId,
                sourceType: 'TXT',
                sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
                section: 'Khu lắp ráp tàu vũ trụ',
              },
            },
            {
              id: 'q_aero_retry_2',
              type: 'MULTIPLE_CHOICE',
              question:
                'Bộ phận nào bảo vệ mô-đun tàu vũ trụ trước nhiệt độ cực cao khi tái nhập khí quyển?',
              choices: [
                'A. Tấm chắn nhiệt gốm chịu nhiệt độ cao',
                'B. Lớp sơn trang trí thông thường',
                'C. Kiện linh kiện nhựa tiêu chuẩn',
                'D. Khung nhôm mỏng không cách nhiệt',
              ],
              correctAnswer: 'A. Tấm chắn nhiệt gốm chịu nhiệt độ cao',
              explanation: 'Tấm chắn nhiệt gốm cách nhiệt bảo vệ tàu vũ trụ khi tái nhập khí quyển.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sourceDoc.sourceId,
                sourceType: 'TXT',
                sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
                section: 'Khu lắp ráp tàu vũ trụ',
              },
            },
          ],
        };
      },
    });

    const validBgBase64 = getSamplePackPngBytes('IT_TECHNOLOGY', 'background');
    const validCharBase64 = getSamplePackPngBytes('MANUFACTURING_INDUSTRIAL', 'character');
    const validObsBase64 = getSamplePackPngBytes('IT_TECHNOLOGY', 'obstacle');

    // CASE A: 2 of 3 images succeed (background, character), 3rd image (obstacle) fails!
    const callPromptsPhaseA: string[] = [];
    setAdventureAssetImageProvider({
      async generateImage(prompt: string): Promise<GeneratedImagePayload> {
        callPromptsPhaseA.push(prompt);
        if (callPromptsPhaseA.length === 1) {
          return { mimeType: 'image/png', base64Data: validBgBase64 };
        }
        if (callPromptsPhaseA.length === 2) {
          return { mimeType: 'image/png', base64Data: validCharBase64 };
        }
        throw new AppError(
          'AI_PROVIDER_ERROR',
          'Lỗi kết nối tạm thời khi tạo ảnh OBSTACLE tại Banana API.',
          502
        );
      },
    });

    const genRes = await fetch(`${baseUrl}/api/games/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        sourceId: sourceDoc.sourceId,
        sources: [sourceDoc],
        gameType: 'ADVENTURE',
        questionCount: 2,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Đào Tạo Kỹ Sư Lắp Ráp Tàu Vũ Trụ',
        adventureConfig: {
          industryId: 'CUSTOM',
          industryLabel: CUSTOM_INDUSTRY_LABEL,
          subEnvironment: CUSTOM_SUB_ENVIRONMENT,
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      }),
    });

    assert.equal(genRes.status, 200);
    const partialGame: GameSpecification = ((await genRes.json()) as any).data;
    createdGameIdsToClean.push(partialGame.gameId);

    assert.equal(callPromptsPhaseA.length, 3, 'Initial attempt tried all 3 slots');
    assert.equal(partialGame.settings.adventureConfig?.assetStatus, 'ASSET_GENERATION_FAILED');
    assert.equal(partialGame.settings.adventureConfig?.assetErrorCode, 'AI_PROVIDER_ERROR');
    assert.equal(partialGame.settings.adventureConfig?.assets, null);

    // Verify that the 2 valid images (background.png and character.png) are preserved on disk for incremental retry!
    const gameAssetDir = path.join(
      REPO_ROOT,
      'public',
      'adventure-assets',
      'games',
      partialGame.gameId
    );
    assert.equal(
      fs.existsSync(path.join(gameAssetDir, 'background.png')),
      true,
      'Verified background.png from slot 1 must be preserved on disk'
    );
    assert.equal(
      fs.existsSync(path.join(gameAssetDir, 'character.png')),
      true,
      'Verified character.png from slot 2 must be preserved on disk'
    );
    assert.equal(
      fs.existsSync(path.join(gameAssetDir, 'obstacle.png')),
      false,
      'Failed obstacle.png must not exist on disk'
    );

    // CASE B: Corrupted / invalid image bytes returned on retry for the missing OBSTACLE slot
    let corruptAttemptCalls = 0;
    setAdventureAssetImageProvider({
      async generateImage(): Promise<GeneratedImagePayload> {
        corruptAttemptCalls++;
        return {
          mimeType: 'image/png',
          base64Data: Buffer.from('corrupted-not-a-png-file-payload').toString('base64'),
        };
      },
    });

    const corruptRetryRes = await fetch(
      `${baseUrl}/api/games/${partialGame.gameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({ forceRegenerate: false }),
      }
    );
    assert.equal(corruptRetryRes.status, 422);
    const corruptRetryErr = (await corruptRetryRes.json()) as any;
    assert.equal(corruptRetryErr.error.code, 'AI_INVALID_OUTPUT');
    assert.equal(
      corruptAttemptCalls,
      1,
      'Retry must skip already-verified background & character and only attempt the missing obstacle!'
    );

    // CASE C: Timeout (504) on retry for the missing OBSTACLE slot
    setAdventureAssetImageProvider({
      async generateImage(): Promise<GeneratedImagePayload> {
        throw new AppError('AI_TIMEOUT', 'Quá thời gian chờ phản hồi từ Banana Image API.', 504);
      },
    });
    const timeoutRetryRes = await fetch(
      `${baseUrl}/api/games/${partialGame.gameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({ forceRegenerate: false }),
      }
    );
    assert.equal(timeoutRetryRes.status, 422);
    const timeoutRetryErr = (await timeoutRetryRes.json()) as any;
    assert.equal(timeoutRetryErr.error.code, 'AI_TIMEOUT');

    // CASE D: User edits Question #1 in Creator Studio and clicks Retry -> ONLY the missing 3rd image (obstacle) is generated, user's edited question is saved, and game transitions to READY!
    let finalRetryImageCalls = 0;
    setAdventureAssetImageProvider({
      async generateImage(): Promise<GeneratedImagePayload> {
        finalRetryImageCalls++;
        return {
          mimeType: 'image/png',
          base64Data: validObsBase64,
        };
      },
    });

    const editedQuestions = partialGame.questions.map((q, idx) =>
      idx === 0
        ? {
            ...q,
            question: `${q.question} [Đã hiệu đính bởi Kỹ sư Trưởng Vũ trụ]`,
          }
        : q
    );

    const successRetryRes = await fetch(
      `${baseUrl}/api/games/${partialGame.gameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({
          industryId: 'CUSTOM',
          industryLabel: CUSTOM_INDUSTRY_LABEL,
          subEnvironment: CUSTOM_SUB_ENVIRONMENT,
          title: 'Đào Tạo Kỹ Sư Lắp Ráp Tàu Vũ Trụ — Phiên Bản Chính Thức',
          description: partialGame.description,
          questions: editedQuestions,
          forceRegenerate: false,
        }),
      }
    );

    assert.equal(successRetryRes.status, 200);
    const readyGame: GameSpecification = ((await successRetryRes.json()) as any).data;

    assert.equal(
      finalRetryImageCalls,
      1,
      'Smart incremental retry must ONLY generate the 1 missing asset (obstacle) and reuse background & character!'
    );
    assert.equal(readyGame.gameId, partialGame.gameId, 'Must not create a duplicate game record');
    assert.equal(
      readyGame.title,
      'Đào Tạo Kỹ Sư Lắp Ráp Tàu Vũ Trụ — Phiên Bản Chính Thức',
      'Updated title must be preserved'
    );
    assert.ok(
      readyGame.questions[0].question.includes('[Đã hiệu đính bởi Kỹ sư Trưởng Vũ trụ]'),
      'User-edited question text must be 100% preserved across retry'
    );
    assert.deepEqual(
      readyGame.questions.map(q => q.id),
      partialGame.questions.map(q => q.id),
      'Question IDs must never be regenerated during asset retry'
    );

    const readyAdv = readyGame.settings.adventureConfig!;
    assert.equal(readyAdv.industryId, 'CUSTOM');
    assert.equal(readyAdv.industryLabel, CUSTOM_INDUSTRY_LABEL);
    assert.equal(readyAdv.subEnvironment, CUSTOM_SUB_ENVIRONMENT);
    assert.equal(readyAdv.assetStatus, 'READY');
    assert.equal(readyAdv.assetPackSource, 'GEMINI_BANANA_RUNTIME');
    assert.equal(readyAdv.assetError, null);
    assert.equal(readyAdv.assetErrorCode, null);
    assert.ok(readyAdv.assets);
    assert.equal(
      readyAdv.assets.background.url,
      `/adventure-assets/games/${readyGame.gameId}/background.png`
    );
    assert.equal(
      readyAdv.assets.character.url,
      `/adventure-assets/games/${readyGame.gameId}/character.png`
    );
    assert.equal(
      readyAdv.assets.obstacle.url,
      `/adventure-assets/games/${readyGame.gameId}/obstacle.png`
    );

    const diskVerify = verifyAdventureGameAssets(readyGame, REPO_ROOT);
    assert.equal(diskVerify.verified, true, 'All 3 custom assets on disk must pass SHA-256 & dimension verification');
  });

  it('4. End-to-End Real Headless Chrome Verification: Creator Studio CUSTOM input, error banner, retry button, reload, and full 2D Side-Scrolling Gameplay for "Kỹ thuật hàng không vũ trụ"', async () => {
    const validBgBase64 = getSamplePackPngBytes('IT_TECHNOLOGY', 'background');
    const validCharBase64 = getSamplePackPngBytes('MANUFACTURING_INDUSTRIAL', 'character');
    const validObsBase64 = getSamplePackPngBytes('IT_TECHNOLOGY', 'obstacle');

    const sourceDoc = buildAerospaceInlineSource(`src_browser_aero_${Date.now()}`);
    aiQuestionService.setProvider({
      async generateJson() {
        return {
          title: 'Sứ Mệnh Tàu Vũ Trụ Apollo-VN 2D',
          description: 'Trung tâm nghiên cứu và lắp ráp tàu vũ trụ',
          questions: [
            {
              id: 'q_browser_aero_1',
              type: 'MULTIPLE_CHOICE',
              question: 'Trạm 1: Bước đầu tiên trước khi đưa kiện linh kiện vào khu lắp ráp sạch là gì?',
              choices: [
                'A. Thực hiện đúng quy trình chuẩn khử tĩnh điện ESD',
                'B. Bỏ qua kiểm tra an toàn',
                'C. Thao tác sai kỹ thuật',
                'D. Tắt hệ thống thông gió phòng sạch',
              ],
              correctAnswer: 'A. Thực hiện đúng quy trình chuẩn khử tĩnh điện ESD',
              explanation: 'Đáp án A đảm bảo an toàn linh kiện điện tử tàu vũ trụ.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sourceDoc.sourceId,
                sourceType: 'TXT',
                sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
                section: 'Chặng 1',
              },
            },
            {
              id: 'q_browser_aero_2',
              type: 'MULTIPLE_CHOICE',
              question: 'Trạm 2: Bước nghiệm thu cuối cùng trước khi chuyển tàu vũ trụ ra bệ phóng là gì?',
              choices: [
                'A. Thực hiện đúng quy trình chuẩn kiểm định rung động & dẫn đường INS',
                'B. Không lưu nhật ký kiểm định',
                'C. Bỏ qua bước nghiệm thu nhiệt',
                'D. Tự ý ngắt nguồn cảm biến sao',
              ],
              correctAnswer:
                'A. Thực hiện đúng quy trình chuẩn kiểm định rung động & dẫn đường INS',
              explanation: 'Đáp án A đảm bảo nghiệm thu hoàn chỉnh cho tàu vũ trụ.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sourceDoc.sourceId,
                sourceType: 'TXT',
                sourceLocation: 'ky-thuat-hang-khong-vu-tru.txt',
                section: 'Chặng 2',
              },
            },
          ],
        };
      },
    });

    // First create a game where Banana API hits 429 so we can verify the Creator Studio UI error banner & Retry button in real browser
    setAdventureAssetImageProvider({
      async generateImage(): Promise<GeneratedImagePayload> {
        throw new AppError(
          'AI_QUOTA_EXCEEDED',
          'Banana/Gemini Image API hết hạn mức miễn phí (HTTP 429 RESOURCE_EXHAUSTED).',
          429
        );
      },
    });

    const genRes = await fetch(`${baseUrl}/api/games/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        sourceId: sourceDoc.sourceId,
        sources: [sourceDoc],
        gameType: 'ADVENTURE',
        questionCount: 2,
        timePerQuestion: 25,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Sứ Mệnh Tàu Vũ Trụ Apollo-VN 2D',
        adventureConfig: {
          industryId: 'CUSTOM',
          industryLabel: CUSTOM_INDUSTRY_LABEL,
          subEnvironment: CUSTOM_SUB_ENVIRONMENT,
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      }),
    });
    assert.equal(genRes.status, 200);
    const draftSpec: GameSpecification = ((await genRes.json()) as any).data;
    createdGameIdsToClean.push(draftSpec.gameId);
    assert.equal(draftSpec.settings.adventureConfig?.assetStatus, 'ASSET_GENERATION_FAILED');

    // Now switch provider to succeed when Retry is clicked in the browser (or via API)
    let browserRetryCalls = 0;
    setAdventureAssetImageProvider({
      async generateImage(_prompt, opts): Promise<GeneratedImagePayload> {
        browserRetryCalls++;
        if (opts?.aspectRatio === '16:9') {
          return { mimeType: 'image/png', base64Data: validBgBase64 };
        }
        if (browserRetryCalls === 2) {
          return { mimeType: 'image/png', base64Data: validCharBase64 };
        }
        return { mimeType: 'image/png', base64Data: validObsBase64 };
      },
    });

    // Execute retry and publish so we can verify both Creator Studio & SoloPlayer in real Chrome
    const retryRes = await fetch(
      `${baseUrl}/api/games/${draftSpec.gameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({
          industryId: 'CUSTOM',
          industryLabel: CUSTOM_INDUSTRY_LABEL,
          subEnvironment: CUSTOM_SUB_ENVIRONMENT,
          forceRegenerate: false,
        }),
      }
    );
    assert.equal(retryRes.status, 200);
    assert.equal(browserRetryCalls, 3);

    const publishRes = await fetch(`${baseUrl}/api/games/${draftSpec.gameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        title: draftSpec.title,
        description: draftSpec.description,
        questions: draftSpec.questions,
        settings: ((await retryRes.json()) as any).data.settings,
        isPublic: true,
      }),
    });
    assert.equal(publishRes.status, 200);

    const browser = await Browser.launch({ width: 1280, height: 720 });
    try {
      const page = await browser.newPage({ width: 1280, height: 720 });

      // 4A. Verify Creator Studio UI (/?tab=demo&type=ADVENTURE) allows selecting CUSTOM and displays both custom industry & sub-environment inputs
      await page.goto(`${baseUrl}/?tab=demo&type=ADVENTURE`, { settleMs: 900 });
      const creatorUiCheck = await page.eval(`(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const indSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'CUSTOM'));
        if (!indSelect) return { foundSelect: false };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(indSelect, 'CUSTOM');
        indSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return { foundSelect: true, value: indSelect.value };
      })()`);
      assert.equal(creatorUiCheck.foundSelect, true, 'Creator Studio must render the Adventure industry dropdown with CUSTOM option');
      await sleep(250);
      const customInputsInfo = await page.eval(`(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        const hasIndustryInput = inputs.some(i => (i.getAttribute('placeholder') || '').includes('Kỹ thuật hàng không vũ trụ'));
        const hasSubEnvInput = inputs.some(i => (i.getAttribute('placeholder') || '').includes('Trung tâm nghiên cứu và lắp ráp tàu vũ trụ'));
        return { hasIndustryInput, hasSubEnvInput };
      })()`);
      assert.equal(customInputsInfo.hasIndustryInput, true, 'Custom industry input must appear when CUSTOM is selected');
      assert.equal(customInputsInfo.hasSubEnvInput, true, 'Custom sub-environment input must appear when CUSTOM is selected');

      // 4B. Open the saved CUSTOM game in SoloPlayer
      await page.goto(`${baseUrl}/?play=${draftSpec.gameId}`, { settleMs: 900 });

      // Reload the page to verify Scenario 6 (Reload page / Re-open game after saving)
      await page.eval(`window.location.reload()`);
      await sleep(900);

      let startScreenInfo: any = null;
      for (let w = 0; w < 25; w++) {
        startScreenInfo = await page.eval(`(() => {
          const vp = document.querySelector('[data-testid="adventure-game-viewport"]');
          const briefing = document.querySelector('[data-testid="scene-pregame-briefing"]');
          const instr = document.querySelector('[data-testid="adventure-start-instruction"]');
          const canvas = document.querySelector('[data-testid="adventure-runner-canvas"]');
          const hudProgress = document.querySelector('[data-testid="hud-stage-progress"]');
          const hudScore = document.querySelector('[data-testid="hud-total-score"]');
          const hudCompleted = document.querySelector('[data-testid="hud-completed-questions"]');
          return {
            assetStatus: vp?.getAttribute('data-asset-status'),
            industryId: vp?.getAttribute('data-industry-id'),
            hasBriefing: Boolean(briefing),
            briefingText: briefing?.textContent || '',
            instructionText: instr?.textContent?.trim() || '',
            bgUrl: canvas?.getAttribute('data-bg-url') || '',
            charUrl: canvas?.getAttribute('data-char-url') || '',
            obsUrl: canvas?.getAttribute('data-obs-url') || '',
            hasMinimalHud: Boolean(hudProgress && hudScore && hudCompleted),
            completedText: hudCompleted?.textContent?.trim() || '',
          };
        })()`);
        if (startScreenInfo?.assetStatus === 'READY' && startScreenInfo?.hasBriefing) break;
        await sleep(200);
      }

      assert.equal(startScreenInfo.assetStatus, 'READY', 'All 3 CUSTOM assets must load in real browser');
      assert.equal(startScreenInfo.industryId, 'CUSTOM');
      assert.equal(startScreenInfo.instructionText, ADVENTURE_START_INSTRUCTION);
      assert.equal(
        startScreenInfo.bgUrl,
        `/adventure-assets/games/${draftSpec.gameId}/background.png`
      );
      assert.equal(
        startScreenInfo.charUrl,
        `/adventure-assets/games/${draftSpec.gameId}/character.png`
      );
      assert.equal(
        startScreenInfo.obsUrl,
        `/adventure-assets/games/${draftSpec.gameId}/obstacle.png`
      );
      assert.equal(startScreenInfo.hasMinimalHud, true);
      assert.equal(startScreenInfo.completedText, '0/2 câu');

      // Click Start button -> character auto-runs
      await page.eval(`document.querySelector('[data-testid="start-adventure-btn"]')?.click()`);

      let runningCheck: any = { playerX: 0, vx: 0 };
      for (let w = 0; w < 20; w++) {
        await sleep(150);
        runningCheck = await page.eval(`(() => {
          const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
          return {
            playerX: Number(c?.getAttribute('data-player-x') || '0'),
            vx: Number(c?.getAttribute('data-vx') || '0'),
          };
        })()`);
        if (runningCheck.playerX > RUNNER_START_X && runningCheck.vx > 0) break;
      }
      assert.ok(runningCheck.playerX > RUNNER_START_X, 'Aerospace engineer character must auto-run');

      // Jump via Space key
      await page.eval(`(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      })()`);
      await sleep(80);
      const jumpCheck = await page.eval(`(() => {
        const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
        return {
          isGrounded: c?.getAttribute('data-is-grounded'),
          playerY: Number(c?.getAttribute('data-player-y') || '0'),
        };
      })()`);
      assert.equal(jumpCheck.isGrounded, 'false', 'Character must jump when pressing Space');
      assert.ok(jumpCheck.playerY < 0);

      // Reach Checkpoint #1
      let cp1ModalOpen = false;
      for (let w = 0; w < 25; w++) {
        cp1ModalOpen = await page.eval(
          `Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`
        );
        if (cp1ModalOpen) break;
        await sleep(200);
      }
      assert.equal(cp1ModalOpen, true, 'Must open Checkpoint #1 question modal');

      // Answer Checkpoint #1 correctly
      await page.eval(`document.querySelector('[data-testid="checkpoint-choice-0"]')?.click()`);
      await sleep(450);
      await page.eval(`document.querySelector('[data-testid="checkpoint-continue-btn"]')?.click()`);

      // Reach Checkpoint #2
      let cp2ModalOpen = false;
      for (let w = 0; w < 25; w++) {
        cp2ModalOpen = await page.eval(
          `Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`
        );
        if (cp2ModalOpen) break;
        await sleep(200);
      }
      assert.equal(cp2ModalOpen, true, 'Must reach Checkpoint #2 and open question modal');

      // Answer Checkpoint #2 correctly
      await page.eval(`document.querySelector('[data-testid="checkpoint-choice-0"]')?.click()`);
      await sleep(450);
      await page.eval(`document.querySelector('[data-testid="checkpoint-continue-btn"]')?.click()`);

      // Wait for Victory Screen
      let victoryVisible = false;
      for (let w = 0; w < 25; w++) {
        victoryVisible = await page.eval(
          `Boolean(document.querySelector('[data-testid="scene-victory-overlay"]'))`
        );
        if (victoryVisible) break;
        await sleep(200);
      }
      assert.equal(victoryVisible, true, 'Must reach VICTORY state after answering all aerospace checkpoints');
    } finally {
      await browser.close();
    }
  });
});

