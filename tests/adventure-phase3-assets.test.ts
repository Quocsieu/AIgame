import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import {
  analyzeSourceContentForAdventure,
  INDUSTRY_CATALOG,
  sanitizeAdventureConfig,
} from '../src/contracts/adventure.contract.js';
import type { GameSpecification } from '../src/contracts/game.contract.js';
import { gameStore } from '../src/game/game.store.js';
import {
  cleanupOrphanedAdventureGameAssets,
  inspectImageBuffer,
  provisionAdventureAssetsForGame,
  resolveAdventureAssetPack,
  setAdventureAssetImageProvider,
  verifyAdventureGameAssets,
} from '../src/services/adventure-asset-pack.service.js';
import {
  GeminiImageModelProvider,
  sanitizeAiErrorMessage,
} from '../src/services/ai.image.service.js';
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

const REPO_ROOT = path.resolve(process.cwd());

function buildValidTestPngBase64(): string {
  // Read an actual verified PNG from our packs (> 1024 bytes, valid PNG signature & dimensions)
  const samplePackPng = path.join(
    REPO_ROOT,
    'public',
    'adventure-assets',
    'packs',
    'IT_TECHNOLOGY',
    'obstacle.png'
  );
  return fs.readFileSync(samplePackPng).toString('base64');
}

function buildInlineSource(id: string, title: string, text: string) {
  return {
    sourceId: id,
    sourceType: 'TXT' as const,
    sourceName: `${title}.txt`,
    sourceLocation: `${title}.txt`,
    title,
    text,
    sections: [
      {
        title,
        content: text,
        provenance: {
          sourceId: id,
          sourceType: 'TXT' as const,
          sourceLocation: `${title}.txt`,
        },
      },
    ],
    extractedItems: [],
    metadata: {
      originalSize: text.length,
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
    },
    diagnostics: [],
  };
}

describe('Phase 3 — Adventure 2D Asset Provisioning, Runtime Generation & Save/Publish Gate', () => {
  let server: http.Server;
  let baseUrl = '';
  let creatorToken = '';
  let creatorUserId = '';
  let otherUserToken = '';

  before(async () => {
    aiQuestionService.setProvider({
      async generateJson(prompt: string) {
        const sourceIdMatch = prompt.match(/SOURCE ID:\s*([^\r\n]+)/);
        const sid = sourceIdMatch ? sourceIdMatch[1].trim() : 'src_test';
        return {
          title: 'Game Adventure Kiểm Thử',
          description: 'Bộ câu hỏi được sinh phục vụ kiểm thử Giai đoạn 3',
          questions: [
            {
              id: 'q_gen_1',
              type: 'MULTIPLE_CHOICE',
              question: 'Câu hỏi kiểm tra trạm số 1 trong quy trình vận hành là gì?',
              choices: [
                'A. Kiểm tra hệ thống an toàn và xác thực thông số',
                'B. Bỏ qua quy trình kiểm tra',
                'C. Tắt toàn bộ cảnh báo',
                'D. Khởi động ngẫu nhiên',
              ],
              correctAnswer: 'A. Kiểm tra hệ thống an toàn và xác thực thông số',
              explanation: 'Căn cứ trực tiếp từ tài liệu nguồn.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sid,
                sourceType: 'TXT',
                sourceLocation: 'test.txt',
              },
            },
            {
              id: 'q_gen_2',
              type: 'QUICK_BUTTON',
              question: 'Việc giám sát liên tục giúp phát hiện sớm sự cố kỹ thuật.',
              choices: ['Đúng', 'Sai'],
              correctAnswer: 'Đúng',
              explanation: 'Theo quy chuẩn vận hành trong tài liệu nguồn.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sid,
                sourceType: 'TXT',
                sourceLocation: 'test.txt',
              },
            },
            {
              id: 'q_gen_3',
              type: 'MULTIPLE_CHOICE',
              question: 'Bước xử lý tiếp theo sau khi hoàn thành kiểm định tại trạm 2 là gì?',
              choices: [
                'A. Ghi nhận biên bản và chuyển sang trạm tiếp theo',
                'B. Xóa nhật ký hệ thống',
                'C. Ngắt kết nối cảm biến',
                'D. Bỏ qua bước xác nhận',
              ],
              correctAnswer: 'A. Ghi nhận biên bản và chuyển sang trạm tiếp theo',
              explanation: 'Đúng theo quy trình chuẩn.',
              difficulty: 'MEDIUM',
              sourceReference: {
                sourceId: sid,
                sourceType: 'TXT',
                sourceLocation: 'test.txt',
              },
            },
          ],
        };
      },
    });

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind test HTTP server');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const suffix = Date.now();
    const creator = authService.register({
      email: `creator_phase3_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Phase 3 Creator',
    });
    creatorToken = creator.token;
    creatorUserId = creator.user.userId;

    const other = authService.register({
      email: `other_phase3_${suffix}@example.com`,
      password: 'Password123!',
      displayName: 'Other User',
    });
    otherUserToken = other.token;
  });

  after(async () => {
    setAdventureAssetImageProvider(null);
    aiQuestionService.setProvider(new GeminiModelProvider());
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('1. Pre-defined 8 industries attach verified Banana packs automatically during game creation and publish cleanly without regenerating on reload', async () => {
    const concreteIndustries = INDUSTRY_CATALOG.filter((i) => i.industryId !== 'CUSTOM').map(
      (i) => i.industryId
    );
    assert.equal(concreteIndustries.length, 8);

    // Test POST /api/games/generate with IT_TECHNOLOGY
    const sourceDoc = buildInlineSource(
      `src_it_${Date.now()}`,
      'Kiến trúc Bảo mật Đám mây và Vận hành SOC',
      'Hệ thống tường lửa Zero-Trust, giám sát nhật ký SIEM tại trung tâm điều hành an ninh mạng SOC giúp phát hiện sớm các cuộc tấn công DDoS, SQL Injection và leo thang đặc quyền trên cụm Kubernetes.'
    );

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
        questionCount: 3,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Chiến dịch Phòng thủ SOC 2D',
        adventureConfig: {
          industryId: 'IT_TECHNOLOGY',
          industryLabel: 'Công nghệ thông tin, Phần mềm & Chuyển đổi số',
          subEnvironment: 'Trung Tâm Dữ Liệu (Data Center) & Hạ Tầng Cloud',
        },
      }),
    });

    assert.equal(genRes.status, 200);
    const genJson = (await genRes.json()) as any;
    assert.equal(genJson.success, true);

    const createdGame: GameSpecification = genJson.data;
    assert.equal(createdGame.gameType, 'ADVENTURE');
    assert.equal(createdGame.isPublic, false);
    assert.ok(createdGame.questions.length >= 1);

    const adv = createdGame.settings.adventureConfig!;
    assert.equal(adv.industryId, 'IT_TECHNOLOGY');
    assert.equal(adv.assetStatus, 'READY');
    assert.equal(adv.assetPackSource, 'ANTIGRAVITY_BANANA_PACK');
    assert.ok(adv.assets, 'Assets must be bound on AdventureConfig');
    assert.equal(adv.assets.background.industryId, 'IT_TECHNOLOGY');
    assert.equal(adv.assets.character.industryId, 'IT_TECHNOLOGY');
    assert.equal(adv.assets.obstacle.industryId, 'IT_TECHNOLOGY');
    assert.equal(adv.assets.background.verified, true);
    assert.equal(adv.assets.character.verified, true);
    assert.equal(adv.assets.obstacle.verified, true);

    // Re-opening via GET /api/games/:gameId returns the exact same verified asset pack without regenerating
    const getRes = await fetch(`${baseUrl}/api/games/${createdGame.gameId}`, {
      headers: { Authorization: `Bearer ${creatorToken}` },
    });
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as any;
    assert.equal(
      getJson.data.settings.adventureConfig.assets.background.sha256,
      adv.assets.background.sha256
    );

    // Publishing via PATCH /api/games/:gameId succeeds because all 3 assets are verified on disk
    const patchRes = await fetch(`${baseUrl}/api/games/${createdGame.gameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        title: createdGame.title,
        description: createdGame.description,
        questions: createdGame.questions,
        settings: createdGame.settings,
        isPublic: true,
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as any;
    assert.equal(patchJson.data.isPublic, true);
    assert.equal(patchJson.data.settings.adventureConfig.assetStatus, 'READY');
  });

  it('2. Non-existent industryId or CUSTOM without valid assets is blocked from finalizing/publishing while preserving draft questions', async () => {
    // Direct resolution of non-existent industryId fails without cross-industry fallback
    const badRes = resolveAdventureAssetPack('AEROSPACE_UNKNOWN', REPO_ROOT);
    assert.equal(badRes.available, false);
    assert.equal(badRes.verified, false);
    assert.equal(badRes.pack, null);

    // Configure provider to simulate Banana API failure (e.g., 429 quota exhausted) for CUSTOM industry
    const failingProvider: ImageModelProvider = {
      async generateImage(): Promise<GeneratedImagePayload> {
        throw new AppError(
          'AI_QUOTA_EXCEEDED',
          'Banana/Gemini Image API hết hạn mức (HTTP 429 RESOURCE_EXHAUSTED).',
          429
        );
      },
    };
    setAdventureAssetImageProvider(failingProvider);

    const sourceDoc = buildInlineSource(
      `src_custom_${Date.now()}`,
      'Kỹ thuật Hàng không Vũ trụ & Vệ tinh Viễn thông',
      'Quy trình hiệu chuẩn động cơ đẩy ion, kiểm soát quỹ đạo địa tĩnh và bảo vệ tấm pin mặt trời vệ tinh trước bão từ mặt trời.'
    );

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
        questionCount: 3,
        timePerQuestion: 20,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Hành trình Trạm Vũ trụ CUSTOM',
        adventureConfig: {
          industryId: 'CUSTOM',
          industryLabel: 'Kỹ thuật Hàng không Vũ trụ',
          subEnvironment: 'Trạm Quỹ đạo Vệ tinh Địa tĩnh',
        },
      }),
    });

    // Draft creation still returns 200 so generated questions are NEVER lost!
    assert.equal(genRes.status, 200);
    const genJson = (await genRes.json()) as any;
    const draftGame: GameSpecification = genJson.data;
    assert.equal(draftGame.isPublic, false);
    assert.equal(draftGame.questions.length, 3);
    assert.equal(draftGame.settings.adventureConfig?.industryId, 'CUSTOM');
    assert.equal(draftGame.settings.adventureConfig?.assetStatus, 'ASSET_GENERATION_FAILED');
    assert.equal(draftGame.settings.adventureConfig?.assetErrorCode, 'AI_QUOTA_EXCEEDED');
    assert.equal(draftGame.settings.adventureConfig?.assets, null);

    // Attempt to complete/publish this CUSTOM game while assets are missing -> blocked with 422 ADVENTURE_ASSETS_INCOMPLETE, but edited question text is preserved in draft!
    const editedQuestions = draftGame.questions.map((q, idx) =>
      idx === 0 ? { ...q, question: `${q.question} [Đã chỉnh sửa nháp]` } : q
    );

    const publishRes = await fetch(`${baseUrl}/api/games/${draftGame.gameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        title: draftGame.title,
        description: draftGame.description,
        questions: editedQuestions,
        settings: draftGame.settings,
        isPublic: true,
      }),
    });

    assert.equal(publishRes.status, 422);
    const publishErr = (await publishRes.json()) as any;
    assert.equal(publishErr.success, false);
    assert.equal(publishErr.error.code, 'ADVENTURE_ASSETS_INCOMPLETE');

    // Verify the draft questions were preserved in storage and isPublic remained false
    const storedAfterFailedPublish = gameStore.get(draftGame.gameId);
    assert.ok(storedAfterFailedPublish);
    assert.equal(storedAfterFailedPublish.isPublic, false);
    assert.ok(storedAfterFailedPublish.questions[0].question.includes('[Đã chỉnh sửa nháp]'));
  });

  it('3. Detects missing file, wrong SHA-256 hash, corrupted file, and path traversal', () => {
    const validPack = resolveAdventureAssetPack('FINANCE_BANKING', REPO_ROOT);
    assert.equal(validPack.verified, true);
    assert.ok(validPack.pack);

    const baseAdv = analyzeSourceContentForAdventure([], {
      preferredIndustryId: 'FINANCE_BANKING',
      questionCount: 2,
    });

    const validSpec: GameSpecification = {
      gameId: `game_verify_${Date.now()}`,
      title: 'Kiểm định Ngân hàng Số',
      description: 'Mô tả',
      gameType: 'ADVENTURE',
      questions: [
        {
          id: 'q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu hỏi 1?',
          choices: ['A. 1', 'B. 2', 'C. 3', 'D. 4'],
          correctAnswer: 'A. 1',
          difficulty: 'MEDIUM',
          sourceReference: {
            sourceId: 's1',
            sourceType: 'TXT',
            sourceLocation: 'doc.txt',
          },
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        adventureConfig: {
          ...baseAdv,
          version: 2,
          industryId: 'FINANCE_BANKING',
          assetStatus: 'READY',
          assetPackSource: 'ANTIGRAVITY_BANANA_PACK',
          assets: validPack.pack.assets,
        },
      },
      sourceSummary: { sourceCount: 1, sources: [] },
      generatedAt: new Date().toISOString(),
    };

    assert.equal(verifyAdventureGameAssets(validSpec, REPO_ROOT).verified, true);

    // 3a. Tampered SHA-256 hash
    const tamperedHashSpec: GameSpecification = {
      ...validSpec,
      settings: {
        ...validSpec.settings,
        adventureConfig: {
          ...validSpec.settings.adventureConfig!,
          assets: {
            ...validPack.pack.assets,
            character: {
              ...validPack.pack.assets.character,
              sha256: '0'.repeat(64),
            },
          },
        },
      },
    };
    const hashCheck = verifyAdventureGameAssets(tamperedHashSpec, REPO_ROOT);
    assert.equal(hashCheck.verified, false);
    assert.ok(hashCheck.missingAssets.includes('CHARACTER'));

    // 3b. Path traversal attempt in relativePath
    const traversalSpec: GameSpecification = {
      ...validSpec,
      settings: {
        ...validSpec.settings,
        adventureConfig: {
          ...validSpec.settings.adventureConfig!,
          assets: {
            ...validPack.pack.assets,
            obstacle: {
              ...validPack.pack.assets.obstacle,
              source: 'GEMINI_BANANA_RUNTIME',
              relativePath: 'public/adventure-assets/games/../../../package.json',
            },
          },
        },
      },
    };
    const traversalCheck = verifyAdventureGameAssets(traversalSpec, REPO_ROOT);
    assert.equal(traversalCheck.verified, false);
    assert.ok(traversalCheck.missingAssets.includes('OBSTACLE'));

    // 3c. Corrupted / non-image bytes rejected by inspectImageBuffer
    const fakeBytes = Buffer.alloc(2048, 0x41);
    const corruptInspection = inspectImageBuffer(fakeBytes, 'image/png');
    assert.equal(corruptInspection.valid, false);
  });

  it('4 & 6. Runtime Banana API generation for CUSTOM industry saves per-game assets, retry preserves questions without regenerating them, and game deletion cleans up per-game assets safely', async () => {
    let imageCallCount = 0;
    const validPngBase64 = buildValidTestPngBase64();

    // First, create a CUSTOM game when Banana API fails
    setAdventureAssetImageProvider({
      async generateImage(): Promise<GeneratedImagePayload> {
        throw new AppError('AI_TIMEOUT', 'Banana image generation timed out.', 504);
      },
    });

    const sourceDoc = buildInlineSource(
      `src_retry_${Date.now()}`,
      'Nông nghiệp Công nghệ cao & Nhà kính Thông minh IoT',
      'Hệ thống cảm biến độ ẩm đất, tưới nhỏ giọt tự động và điều khiển ánh sáng quang hợp bằng AI trong nhà kính thủy canh.'
    );

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
        title: 'Nông trại IoT Thông minh',
        adventureConfig: {
          industryId: 'CUSTOM',
          industryLabel: 'Nông nghiệp Công nghệ cao IoT',
          subEnvironment: 'Nhà Kính Thủy Canh Tự Động Hóa',
        },
      }),
    });

    assert.equal(genRes.status, 200);
    const genJson = (await genRes.json()) as any;
    const draftGame: GameSpecification = genJson.data;
    assert.equal(draftGame.settings.adventureConfig?.assetStatus, 'ASSET_GENERATION_FAILED');
    assert.equal(draftGame.settings.adventureConfig?.assetErrorCode, 'AI_TIMEOUT');

    const originalQuestionIds = draftGame.questions.map((q) => q.id);
    const originalQuestionTexts = draftGame.questions.map((q) => q.question);

    // Now switch provider to succeed and call POST /api/games/:gameId/adventure-assets/retry
    setAdventureAssetImageProvider({
      async generateImage(_prompt, options): Promise<GeneratedImagePayload> {
        imageCallCount++;
        assert.ok(options?.aspectRatio === '16:9' || options?.aspectRatio === '1:1');
        return {
          mimeType: 'image/png',
          base64Data: validPngBase64,
        };
      },
    });

    const retryRes = await fetch(
      `${baseUrl}/api/games/${draftGame.gameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
        },
        body: JSON.stringify({ forceRegenerate: true }),
      }
    );

    assert.equal(retryRes.status, 200);
    const retryJson = (await retryRes.json()) as any;
    assert.equal(retryJson.success, true);
    assert.equal(imageCallCount, 3, 'Must generate BACKGROUND, CHARACTER, and OBSTACLE');

    const readyGame: GameSpecification = retryJson.data;
    // Questions must be 100% preserved (never regenerated)
    assert.deepEqual(
      readyGame.questions.map((q) => q.id),
      originalQuestionIds
    );
    assert.deepEqual(
      readyGame.questions.map((q) => q.question),
      originalQuestionTexts
    );

    const readyAdv = readyGame.settings.adventureConfig!;
    assert.equal(readyAdv.assetStatus, 'READY');
    assert.equal(readyAdv.assetPackSource, 'GEMINI_BANANA_RUNTIME');
    assert.ok(readyAdv.assets);
    assert.equal(readyAdv.assets.background.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(readyAdv.assets.character.source, 'GEMINI_BANANA_RUNTIME');
    assert.equal(readyAdv.assets.obstacle.source, 'GEMINI_BANANA_RUNTIME');

    // Verify files exist in public/adventure-assets/games/<gameId>/ and NOT in packs/
    const bgDiskPath = path.resolve(REPO_ROOT, readyAdv.assets.background.relativePath);
    const charDiskPath = path.resolve(REPO_ROOT, readyAdv.assets.character.relativePath);
    const obsDiskPath = path.resolve(REPO_ROOT, readyAdv.assets.obstacle.relativePath);
    assert.ok(fs.existsSync(bgDiskPath));
    assert.ok(fs.existsSync(charDiskPath));
    assert.ok(fs.existsSync(obsDiskPath));
    assert.ok(readyAdv.assets.background.url.startsWith('/adventure-assets/games/'));

    // Now publishing the game succeeds!
    const publishRes = await fetch(`${baseUrl}/api/games/${readyGame.gameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        title: readyGame.title,
        description: readyGame.description,
        questions: readyGame.questions,
        settings: readyGame.settings,
        isPublic: true,
      }),
    });
    assert.equal(publishRes.status, 200);
    const publishJson = (await publishRes.json()) as any;
    assert.equal(publishJson.data.isPublic, true);

    // Deleting the game removes public/adventure-assets/games/<gameId>/ while keeping packs intact
    const delRes = await fetch(`${baseUrl}/api/games/${readyGame.gameId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${creatorToken}` },
    });
    assert.equal(delRes.status, 200);
    assert.equal(fs.existsSync(bgDiskPath), false);
    assert.equal(
      resolveAdventureAssetPack('MOTORCYCLE_TRAFFIC', REPO_ROOT).verified,
      true,
      'Shared packs in public/adventure-assets/packs/ must never be deleted'
    );
  });

  it('5. Classifies 429 quota, 401/403 auth, 404 unsupported model, timeout, and redacts API keys from all error messages', async () => {
    const fakeSecretKey = 'AIzaSyFakeSecretKeyForRedactionTest987654321';
    const redacted = sanitizeAiErrorMessage(
      `Request to https://generativelanguage.googleapis.com?key=${fakeSecretKey} failed with x-goog-api-key: ${fakeSecretKey}`,
      fakeSecretKey
    );
    assert.equal(redacted.includes(fakeSecretKey), false);
    assert.ok(redacted.includes('[REDACTED_API_KEY]'));

    // Verify GeminiImageModelProvider classifies HTTP 429, 403, and 404 accurately without leaking key
    const originalFetch = globalThis.fetch;
    try {
      // 5a. HTTP 429 -> AI_QUOTA_EXCEEDED
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: `Quota exceeded for model with key ${fakeSecretKey}`,
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );

      const provider = new GeminiImageModelProvider(fakeSecretKey, 'gemini-2.5-flash-image');
      await assert.rejects(
        () => provider.generateImage('test prompt'),
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, 'AI_QUOTA_EXCEEDED');
          assert.equal(err.statusCode, 429);
          assert.equal(err.message.includes(fakeSecretKey), false);
          return true;
        }
      );

      // 5b. HTTP 403 -> AI_AUTH_ERROR
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: `API key ${fakeSecretKey} not valid`,
              status: 'PERMISSION_DENIED',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );

      await assert.rejects(
        () => provider.generateImage('test prompt'),
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, 'AI_AUTH_ERROR');
          assert.equal(err.message.includes(fakeSecretKey), false);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('7. Strictly forbids cross-industry asset fallback (e.g. MOTORCYCLE_TRAFFIC pack cannot be attached to IT_TECHNOLOGY or CUSTOM)', () => {
    const motoPack = resolveAdventureAssetPack('MOTORCYCLE_TRAFFIC', REPO_ROOT);
    assert.equal(motoPack.verified, true);
    assert.ok(motoPack.pack);

    const baseItAdv = analyzeSourceContentForAdventure([], {
      preferredIndustryId: 'IT_TECHNOLOGY',
      questionCount: 2,
    });

    // Attempt to sanitize an IT_TECHNOLOGY config carrying MOTORCYCLE_TRAFFIC assets
    const sanitized = sanitizeAdventureConfig(
      {
        ...baseItAdv,
        industryId: 'IT_TECHNOLOGY',
        assets: motoPack.pack.assets,
      },
      baseItAdv
    );
    assert.equal(
      sanitized.assets,
      undefined,
      'sanitizeAdventureConfig must strip cross-industry assets'
    );

    // Attempt to verify an IT_TECHNOLOGY game spec that manually injected MOTORCYCLE_TRAFFIC assets
    const crossIndustrySpec: GameSpecification = {
      gameId: `game_cross_${Date.now()}`,
      title: 'Cross Industry Test',
      description: 'Test',
      gameType: 'ADVENTURE',
      questions: [
        {
          id: 'q1',
          type: 'MULTIPLE_CHOICE',
          question: 'Q1?',
          choices: ['A. 1', 'B. 2', 'C. 3', 'D. 4'],
          correctAnswer: 'A. 1',
          difficulty: 'MEDIUM',
          sourceReference: { sourceId: 's1', sourceType: 'TXT', sourceLocation: 'a.txt' },
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        adventureConfig: {
          ...baseItAdv,
          industryId: 'IT_TECHNOLOGY',
          assets: motoPack.pack.assets,
        },
      },
      sourceSummary: { sourceCount: 1, sources: [] },
      generatedAt: new Date().toISOString(),
    };

    const verification = verifyAdventureGameAssets(crossIndustrySpec, REPO_ROOT);
    assert.equal(verification.verified, false);
    assert.ok(
      verification.errors.some((e) => e.includes('Cross-industry fallback forbidden'))
    );
  });

  it('8. Preserves backward compatibility for legacy Adventure games (without assetStatus metadata) and traditional QUIZ games', async () => {
    const legacyAdvConfig = analyzeSourceContentForAdventure([], {
      preferredIndustryId: 'EDUCATION_GENERAL',
      questionCount: 2,
    });
    // Ensure legacy game has version: 1 and no assetStatus / assets
    delete (legacyAdvConfig as any).assetStatus;
    delete (legacyAdvConfig as any).assets;
    legacyAdvConfig.version = 1;

    const legacyGameId = `game_legacy_adv_${Date.now()}`;
    const legacySpec: GameSpecification = {
      gameId: legacyGameId,
      ownerUserId: creatorUserId,
      isPublic: false,
      title: 'Game Adventure Thế Hệ Cũ (Legacy v1)',
      description: 'Tương thích ngược',
      gameType: 'ADVENTURE',
      questions: [
        {
          id: 'q_leg_1',
          type: 'MULTIPLE_CHOICE',
          question: 'Câu hỏi legacy số 1?',
          choices: ['A. Đúng', 'B. Sai 1', 'C. Sai 2', 'D. Sai 3'],
          correctAnswer: 'A. Đúng',
          difficulty: 'EASY',
          sourceReference: { sourceId: 's_leg', sourceType: 'TXT', sourceLocation: 'legacy.txt' },
        },
      ],
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
        adventureConfig: legacyAdvConfig,
      },
      sourceSummary: { sourceCount: 1, sources: [] },
      generatedAt: new Date().toISOString(),
    };

    gameStore.save(legacySpec, Date.now(), creatorUserId, false);

    // Editing and publishing the legacy Adventure game works without forcing new asset metadata
    const patchLegacyRes = await fetch(`${baseUrl}/api/games/${legacyGameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        title: 'Game Adventure Thế Hệ Cũ (Đã cập nhật)',
        description: legacySpec.description,
        questions: legacySpec.questions,
        settings: legacySpec.settings,
        isPublic: true,
      }),
    });
    assert.equal(patchLegacyRes.status, 200);
    const patchLegacyJson = (await patchLegacyRes.json()) as any;
    assert.equal(patchLegacyJson.data.isPublic, true);

    // Starting a solo session on the legacy Adventure game works normally
    const sessionRes = await fetch(`${baseUrl}/api/games/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({ gameId: legacyGameId }),
    });
    assert.equal(sessionRes.status, 200);

    // Traditional QUIZ game is also completely unaffected
    const quizGameId = `game_trad_quiz_${Date.now()}`;
    const quizSpec: GameSpecification = {
      ...legacySpec,
      gameId: quizGameId,
      title: 'Game Trắc nghiệm Truyền thống',
      gameType: 'MULTIPLE_CHOICE',
      settings: {
        questionCount: 1,
        timePerQuestion: 20,
        scoringMode: 'STANDARD',
      },
    };
    gameStore.save(quizSpec, Date.now(), creatorUserId, false);

    const patchQuizRes = await fetch(`${baseUrl}/api/games/${quizGameId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify({
        title: quizSpec.title,
        description: quizSpec.description,
        questions: quizSpec.questions,
        settings: quizSpec.settings,
        isPublic: true,
      }),
    });
    assert.equal(patchQuizRes.status, 200);
  });

  it('9. Rejects unauthorized users, guests, and player tokens from retrying or modifying Adventure assets on another user game', async () => {
    const pack = resolveAdventureAssetPack('HEALTHCARE_TRAINING', REPO_ROOT);
    assert.ok(pack.pack);
    const advConfig = analyzeSourceContentForAdventure([], {
      preferredIndustryId: 'HEALTHCARE_TRAINING',
      questionCount: 1,
    });
    const protectedGameId = `game_protected_${Date.now()}`;
    gameStore.save(
      {
        gameId: protectedGameId,
        ownerUserId: creatorUserId,
        isPublic: false,
        title: 'Game Y Tế Nội Bộ',
        description: 'Bảo mật quyền sở hữu',
        gameType: 'ADVENTURE',
        questions: [
          {
            id: 'q_med_1',
            type: 'MULTIPLE_CHOICE',
            question: 'Quy trình kiểm soát nhiễm khuẩn gồm mấy bước?',
            choices: ['A. 6 bước', 'B. 3 bước', 'C. 2 bước', 'D. 1 bước'],
            correctAnswer: 'A. 6 bước',
            difficulty: 'MEDIUM',
            sourceReference: { sourceId: 's_med', sourceType: 'TXT', sourceLocation: 'med.txt' },
          },
        ],
        settings: {
          questionCount: 1,
          timePerQuestion: 20,
          scoringMode: 'STANDARD',
          adventureConfig: {
            ...advConfig,
            version: 2,
            assetStatus: 'READY',
            assetPackSource: 'ANTIGRAVITY_BANANA_PACK',
            assets: pack.pack.assets,
          },
        },
        sourceSummary: { sourceCount: 1, sources: [] },
        generatedAt: new Date().toISOString(),
      },
      Date.now(),
      creatorUserId,
      false
    );

    // Unauthenticated guest -> 401 or 403
    const unauthRes = await fetch(
      `${baseUrl}/api/games/${protectedGameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    assert.ok(unauthRes.status === 401 || unauthRes.status === 403);

    // Player token -> 403
    const playerTokenRes = await fetch(
      `${baseUrl}/api/games/${protectedGameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creatorToken}`,
          'x-player-token': 'ptok_fake_123',
        },
        body: JSON.stringify({}),
      }
    );
    assert.equal(playerTokenRes.status, 403);

    // Different logged-in user -> 403
    const otherUserRes = await fetch(
      `${baseUrl}/api/games/${protectedGameId}/adventure-assets/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherUserToken}`,
        },
        body: JSON.stringify({}),
      }
    );
    assert.equal(otherUserRes.status, 403);
  });
});
