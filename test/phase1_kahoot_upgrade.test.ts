import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, beforeEach, after } from 'node:test';
import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { resetAllRateLimiters } from '../src/middleware/rateLimiter.js';
import {
  aiImageService,
  AiImageService,
  type GeneratedImagePayload,
  type ImageModelProvider,
} from '../src/services/ai.image.service.js';
import { persistenceRepo } from '../src/storage/persistence.repository.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/storage/sqlite.db.js';

// Minimal valid 1x1 PNG base64 for deterministic image generation tests
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

class MockSuccessImageProvider implements ImageModelProvider {
  public callCount = 0;

  async generateImage(_prompt: string): Promise<GeneratedImagePayload> {
    this.callCount += 1;
    return {
      base64Data: SAMPLE_PNG_BASE64,
      mimeType: 'image/png',
    };
  }
}

class MockFailingImageProvider implements ImageModelProvider {
  public callCount = 0;

  async generateImage(_prompt: string): Promise<GeneratedImagePayload> {
    this.callCount += 1;
    throw new Error('Simulated Gemini image provider timeout or network failure');
  }
}

const DEFAULT_SOURCE_REF = {
  sourceId: 'src_phase1',
  sourceType: 'TXT' as const,
  sourceLocation: 'phase1.txt',
  sectionTitle: 'Intro',
};

const DEFAULT_SOURCE_SUMMARY = {
  sourceCount: 1,
  sources: [
    {
      sourceId: 'src_phase1',
      sourceType: 'TXT' as const,
      sourceName: 'phase1.txt',
      sourceLocation: 'phase1.txt',
    },
  ],
};

describe('Phase 1 Kahoot Upgrade: Discovery, Library, Duplication & Gemini Cover Generation', () => {
  let tempDir: string;
  let tempDbPath: string;
  let tempCoversDir: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-phase1-kahoot-'));
    tempDbPath = path.join(tempDir, 'test_phase1.sqlite');
    tempCoversDir = path.join(tempDir, 'covers');
    initDatabase(tempDbPath);
    aiImageService.setDefaultCoversDir(tempCoversDir);
  });

  beforeEach(() => {
    resetAllRateLimiters();
    gameStore.clear();
    getDatabase().exec('DELETE FROM game_questions; DELETE FROM games;');
  });

  after(() => {
    closeDatabase();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. Public Discovery & Library Filtering: lists public games on Discover and supports search & gameType filters', async () => {
    const publicQuizId = 'game_phase1_pub_quiz';
    const draftSliderId = 'game_phase1_draft_slider';

    persistenceRepo.saveGameSpecification({
      gameId: publicQuizId,
      title: 'Khám phá Trí tuệ Nhân tạo cơ bản',
      description: 'Bộ câu hỏi trắc nghiệm công khai về AI và Machine Learning.',
      gameType: 'QUIZ',
      isPublic: true,
      settings: { questionCount: 1, timePerQuestion: 20, scoringMode: 'SPEED_BONUS' },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'q1',
          question: 'Mô hình ngôn ngữ lớn viết tắt là gì?',
          type: 'QUIZ',
          choices: ['LLM', 'CNN', 'RNN', 'GAN'],
          correctAnswer: 'LLM',
          explanation: 'Large Language Model.',
          difficulty: 'EASY',
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
    });

    persistenceRepo.saveGameSpecification({
      gameId: draftSliderId,
      title: 'Bản nháp lịch sử Việt Nam',
      description: 'Bộ câu hỏi thanh trượt đang biên soạn.',
      gameType: 'SLIDER',
      isPublic: false,
      settings: { questionCount: 1, timePerQuestion: 15, scoringMode: 'STANDARD' },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'q1',
          question: 'Năm thành lập nước Việt Nam Dân chủ Cộng hòa?',
          type: 'SLIDER',
          correctAnswer: '1945',
          sliderConfig: { min: 1900, max: 2000, step: 1, unit: 'năm', correctValue: 1945, tolerance: 0 },
          explanation: 'Ngày 2/9/1945.',
          difficulty: 'MEDIUM',
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
    });

    // Discover scope=public only returns published games
    const publicRes = await request(app).get('/api/games?scope=public');
    assert.equal(publicRes.status, 200);
    assert.equal(publicRes.body.data.games.length, 1);
    assert.equal(publicRes.body.data.games[0].gameId, publicQuizId);
    assert.equal(publicRes.body.data.games[0].isPublic, true);

    // Search filter on Discover
    const searchRes = await request(app).get(
      `/api/games?scope=public&search=${encodeURIComponent('Trí tuệ Nhân tạo')}`
    );
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.data.games.length, 1);
    assert.equal(searchRes.body.data.games[0].gameId, publicQuizId);

    // Library scope=manage returns both published and draft games for unauthenticated legacy/system items
    const manageRes = await request(app).get('/api/games?scope=manage');
    assert.equal(manageRes.status, 200);
    assert.equal(manageRes.body.data.games.length, 2);

    // Filter by SLIDER in Library
    const sliderFilterRes = await request(app).get('/api/games?scope=manage&gameType=SLIDER');
    assert.equal(sliderFilterRes.status, 200);
    assert.equal(sliderFilterRes.body.data.games.length, 1);
    assert.equal(sliderFilterRes.body.data.games[0].gameId, draftSliderId);
  });

  it('2. Game Duplication (POST /api/games/:gameId/duplicate): clones specification, preserves questions & sliderConfig, sets draft status', async () => {
    const sourceId = 'game_phase1_dup_source';
    persistenceRepo.saveGameSpecification({
      gameId: sourceId,
      title: 'Bộ câu hỏi Gốc cần nhân bản',
      description: 'Mô tả bộ câu hỏi gốc',
      gameType: 'SLIDER',
      isPublic: true,
      coverImageUrl: '/covers/sample_existing_cover.png',
      settings: { questionCount: 1, timePerQuestion: 25, scoringMode: 'STREAK' },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'q_slider_1',
          question: 'Nhiệt độ sôi của nước ở áp suất tiêu chuẩn?',
          type: 'SLIDER',
          correctAnswer: '100',
          sliderConfig: { min: 0, max: 200, step: 5, unit: '°C', correctValue: 100, tolerance: 5 },
          explanation: 'Nước sôi ở 100°C.',
          difficulty: 'EASY',
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
    });

    const dupRes = await request(app).post(`/api/games/${sourceId}/duplicate`);
    assert.equal(dupRes.status, 201);
    assert.ok(dupRes.body.data);

    const duplicated = dupRes.body.data;
    assert.notEqual(duplicated.gameId, sourceId);
    assert.equal(duplicated.title, 'Bộ câu hỏi Gốc cần nhân bản (Bản sao)');
    assert.equal(duplicated.isPublic, false, 'Duplicated game must start as draft (isPublic=false)');
    assert.equal(duplicated.coverImageUrl, '/covers/sample_existing_cover.png');
    assert.equal(duplicated.questions.length, 1);
    assert.deepEqual(duplicated.questions[0].sliderConfig, {
      min: 0,
      max: 200,
      step: 5,
      unit: '°C',
      correctValue: 100,
      tolerance: 5,
    });
  });

  it('3. Gemini Cover Generation: generates cover file, persists coverImageUrl, caches by promptHash, and supports forceRegenerate', async () => {
    const gameId = 'game_phase1_cover_gen';
    persistenceRepo.saveGameSpecification({
      gameId,
      title: 'Khám phá Vũ trụ và Hệ Mặt trời',
      description: 'Tìm hiểu các hành tinh trong hệ mặt trời qua câu hỏi tương tác.',
      gameType: 'QUIZ',
      isPublic: true,
      settings: { questionCount: 1, timePerQuestion: 15, scoringMode: 'SPEED_BONUS' },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'q1',
          question: 'Hành tinh nào lớn nhất Hệ Mặt trời?',
          type: 'QUIZ',
          choices: ['Sao Mộc', 'Sao Thổ', 'Trái Đất', 'Sao Hỏa'],
          correctAnswer: 'Sao Mộc',
          explanation: 'Sao Mộc là hành tinh lớn nhất.',
          difficulty: 'EASY',
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
    });

    const mockProvider = new MockSuccessImageProvider();
    aiImageService.setProvider(mockProvider);

    // First call: generates image and writes to tempCoversDir
    const firstGenRes = await request(app)
      .post(`/api/games/${gameId}/cover`)
      .send({ forceRegenerate: false });

    assert.equal(firstGenRes.status, 200);
    assert.equal(firstGenRes.body.data.cached, false);
    assert.equal(firstGenRes.body.data.fallbackUsed, false);
    assert.ok(
      typeof firstGenRes.body.data.coverImageUrl === 'string' &&
        firstGenRes.body.data.coverImageUrl.startsWith('/covers/cover_'),
      'Expected valid /covers/ URL'
    );
    assert.equal(mockProvider.callCount, 1);

    const fileName = path.basename(firstGenRes.body.data.coverImageUrl);
    const diskPath = path.join(tempCoversDir, fileName);
    assert.ok(fs.existsSync(diskPath), 'Generated cover image file must exist on disk');

    // Verify SQLite persistence returns coverImageUrl in both detail and summary list
    const savedSpec = persistenceRepo.getGameSpecificationById(gameId);
    assert.equal(savedSpec?.coverImageUrl, firstGenRes.body.data.coverImageUrl);

    const listRes = await request(app).get('/api/games?scope=public');
    const summaryItem = listRes.body.data.games.find((i: any) => i.gameId === gameId);
    assert.equal(summaryItem?.coverImageUrl, firstGenRes.body.data.coverImageUrl);

    // Second call with unchanged metadata and forceRegenerate=false -> cache hit!
    const secondGenRes = await request(app)
      .post(`/api/games/${gameId}/cover`)
      .send({ forceRegenerate: false });

    assert.equal(secondGenRes.status, 200);
    assert.equal(secondGenRes.body.data.cached, true);
    assert.equal(secondGenRes.body.data.coverImageUrl, firstGenRes.body.data.coverImageUrl);
    assert.equal(mockProvider.callCount, 1, 'Cached call must not invoke Gemini provider again');

    // Third call with forceRegenerate=true -> invokes provider again
    const forceGenRes = await request(app)
      .post(`/api/games/${gameId}/cover`)
      .send({ forceRegenerate: true });

    assert.equal(forceGenRes.status, 200);
    assert.equal(forceGenRes.body.data.cached, false);
    assert.equal(mockProvider.callCount, 2);
  });

  it('4. Graceful Fallback: when Gemini image provider fails, game publish and cover endpoint never crash', async () => {
    const gameId = 'game_phase1_cover_fallback';
    persistenceRepo.saveGameSpecification({
      gameId,
      title: 'Bộ câu hỏi kiểm thử Fallback Ảnh bìa',
      description: 'Đảm bảo lỗi Gemini Image không chặn xuất bản game.',
      gameType: 'TRUE_FALSE',
      isPublic: false,
      settings: { questionCount: 1, timePerQuestion: 15, scoringMode: 'STANDARD' },
      sourceSummary: DEFAULT_SOURCE_SUMMARY,
      generatedAt: new Date().toISOString(),
      questions: [
        {
          id: 'q1',
          question: 'Trái Đất quay quanh Mặt Trời là Đúng hay Sai?',
          type: 'TRUE_FALSE',
          choices: ['Đúng', 'Sai'],
          correctAnswer: 'Đúng',
          explanation: 'Chính xác.',
          difficulty: 'EASY',
          sourceReference: DEFAULT_SOURCE_REF,
        },
      ],
    });

    const failingProvider = new MockFailingImageProvider();
    aiImageService.setProvider(failingProvider);

    // Direct cover endpoint returns 200 with fallbackUsed=true instead of 500
    const coverRes = await request(app)
      .post(`/api/games/${gameId}/cover`)
      .send({ forceRegenerate: true });

    assert.equal(coverRes.status, 200);
    assert.equal(coverRes.body.data.fallbackUsed, true);
    assert.equal(coverRes.body.data.coverImageUrl, null);

    // Publishing game with generateCover=true succeeds even when image provider fails
    const publishRes = await request(app)
      .patch(`/api/games/${gameId}/questions`)
      .send({
        isPublic: true,
        generateCover: true,
        questions: [
          {
            id: 'q1',
            question: 'Trái Đất quay quanh Mặt Trời là Đúng hay Sai?',
            type: 'TRUE_FALSE',
            choices: ['Đúng', 'Sai'],
            correctAnswer: 'Đúng',
            explanation: 'Chính xác.',
            difficulty: 'EASY',
            sourceReference: DEFAULT_SOURCE_REF,
          },
        ],
      });

    assert.equal(publishRes.status, 200);
    assert.equal(publishRes.body.data.isPublic, true);
  });

  it('5. Prompt Builder: enforces Premium Colorful illustration rules and forbids embedded text', () => {
    const service = new AiImageService(new MockSuccessImageProvider());
    const prompt = service.buildCoverPrompt({
      title: 'An toàn thông tin mạng 2026',
      description: 'Kiến thức bảo mật đám mây và phòng chống phishing',
      gameType: 'QUIZ',
    });

    assert.ok(prompt.includes('Premium Colorful'));
    assert.ok(prompt.includes('Do NOT include any text'));
    assert.ok(prompt.includes('An toàn thông tin mạng 2026'));
  });
});
