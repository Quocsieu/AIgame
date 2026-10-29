import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS } from '../config/limits.js';
import { GameSpecification, GameType } from '../contracts/game.contract.js';
import { gameStore } from '../game/game.store.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';
import {
  aiObservabilityService,
  AiProviderUsageMetadata,
} from './ai.observability.service.js';
import { quotaService } from './quota.service.js';

export interface GeneratedImagePayload {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64Data: string;
  usageMetadata?: AiProviderUsageMetadata;
}

export interface ImageModelProvider {
  generateImage(prompt: string): Promise<GeneratedImagePayload>;
  getLastUsageMetadata?(): AiProviderUsageMetadata | null;
}

export interface GenerateGameCoverOptions {
  userId?: string | null;
  forceRegenerate?: boolean;
  throwOnError?: boolean;
  coversDir?: string;
}

export interface GenerateGameCoverResult {
  gameId: string;
  coverImageUrl: string | null;
  generated: boolean;
  cached: boolean;
  fallbackUsed: boolean;
  promptHash: string;
  reason?: string;
}

const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

function sanitizeGameIdForFilename(gameId: string): string {
  return gameId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function describeGameFormatVisuals(gameType: GameType): string {
  switch (gameType) {
    case 'QUIZ':
    case 'MULTIPLE_CHOICE':
      return 'dynamic quiz arena with four vibrant geometric emblems, knowledge sparks, and a modern game show podium atmosphere';
    case 'TRUE_FALSE':
    case 'QUICK_BUTTON':
      return 'high-energy dual-polarity contrast composition with emerald and coral-amber light beams, representing rapid decision making';
    case 'TYPE_ANSWER':
    case 'FILL_IN_THE_BLANK':
      return 'sleek glowing keycaps, precision knowledge crystals, and luminous conceptual pathways representing active recall';
    case 'PUZZLE':
      return 'interlocking colorful 3D modular blocks and sequential pathways assembling into a harmonious structure';
    case 'SLIDER':
      return 'precision analog-digital dials, calibrated spectrum gauges, and balanced glowing scales';
    case 'ADVENTURE':
      return 'immersive 3D isometric simulation world with glowing checkpoints, exploratory trails, and interactive stations';
    default:
      return 'modern interactive educational game landscape with colorful geometric forms and glowing accents';
  }
}

export class GeminiImageModelProvider implements ImageModelProvider {
  private readonly apiKey: string;
  private readonly primaryModel: string;
  private lastUsageMetadata: AiProviderUsageMetadata | null = null;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = (apiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
    this.primaryModel = (model ?? process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image').trim();
  }

  public getLastUsageMetadata(): AiProviderUsageMetadata | null {
    return this.lastUsageMetadata;
  }

  public isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  public async generateImage(prompt: string): Promise<GeneratedImagePayload> {
    if (!this.apiKey) {
      throw new AppError(
        'AI_PROVIDER_ERROR',
        'GEMINI_API_KEY is not configured for cover image generation.',
        502
      );
    }

    const modelsToTry = Array.from(
      new Set([this.primaryModel, 'gemini-2.5-flash-image', 'gemini-3.1-flash-image'])
    );

    let lastError: unknown = null;

    for (const modelName of modelsToTry) {
      try {
        return await this.callModelWithRetry(modelName, prompt);
      } catch (err) {
        lastError = err;
        // If timeout, do not cascade to additional slow calls
        if (err instanceof AppError && err.code === 'AI_TIMEOUT') {
          throw err;
        }
      }
    }

    if (lastError instanceof AppError) {
      throw lastError;
    }

    throw new AppError(
      'AI_PROVIDER_ERROR',
      `Gemini cover image generation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      502
    );
  }

  private async callModelWithRetry(modelName: string, prompt: string): Promise<GeneratedImagePayload> {
    const maxAttempts = 2; // 1 initial attempt + 1 bounded retry for transient failures
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.invokeGenerateContent(modelName, prompt, attempt === 1);
      } catch (err) {
        lastErr = err;
        if (err instanceof AppError && err.code === 'AI_TIMEOUT') {
          throw err;
        }
        // Only retry once on 5xx / transient or if first attempt used imageConfig that model rejected
        if (attempt >= maxAttempts) {
          break;
        }
      }
    }

    throw lastErr;
  }

  private async invokeGenerateContent(
    modelName: string,
    prompt: string,
    includeAspectRatioConfig: boolean
  ): Promise<GeneratedImagePayload> {
    this.lastUsageMetadata = {
      provider: 'gemini',
      model: modelName,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageReportedByProvider: false,
    };

    const controller = new AbortController();
    const timeoutMs = LIMITS.AI_IMAGE_TIMEOUT_MS || 25_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

      const generationConfig: Record<string, any> = {
        responseModalities: ['IMAGE', 'TEXT'],
      };
      if (includeAspectRatioConfig) {
        generationConfig.imageConfig = {
          aspectRatio: '16:9',
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        throw new AppError(
          'AI_PROVIDER_ERROR',
          `Gemini image API returned HTTP ${status} for model ${modelName}.`,
          502
        );
      }

      const data = (await response.json()) as any;
      const usageMeta = data?.usageMetadata;
      if (usageMeta && typeof usageMeta === 'object') {
        const promptTokenCount =
          typeof usageMeta.promptTokenCount === 'number' ? usageMeta.promptTokenCount : null;
        const candidatesTokenCount =
          typeof usageMeta.candidatesTokenCount === 'number' ? usageMeta.candidatesTokenCount : null;
        const totalTokenCount =
          typeof usageMeta.totalTokenCount === 'number'
            ? usageMeta.totalTokenCount
            : promptTokenCount !== null && candidatesTokenCount !== null
              ? promptTokenCount + candidatesTokenCount
              : null;

        this.lastUsageMetadata = {
          provider: 'gemini',
          model: modelName,
          inputTokens: promptTokenCount,
          outputTokens: candidatesTokenCount,
          totalTokens: totalTokenCount,
          usageReportedByProvider:
            promptTokenCount !== null || candidatesTokenCount !== null || totalTokenCount !== null,
        };
      }

      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        const inline = part?.inlineData || part?.inline_data;
        const rawMime = String(inline?.mimeType || inline?.mime_type || '').toLowerCase().trim();
        const rawBase64 = typeof inline?.data === 'string' ? inline.data.trim() : '';

        if (rawBase64 && ALLOWED_IMAGE_MIME_TYPES[rawMime]) {
          const normalizedMime =
            rawMime === 'image/jpg'
              ? 'image/jpeg'
              : (rawMime as 'image/png' | 'image/jpeg' | 'image/webp');
          return {
            mimeType: normalizedMime,
            base64Data: rawBase64,
            usageMetadata: this.lastUsageMetadata,
          };
        }
      }

      throw new AppError(
        'AI_INVALID_OUTPUT',
        `Gemini image model ${modelName} did not return inline image data.`,
        502
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError('AI_TIMEOUT', 'Gemini cover image generation timed out.', 504);
      }
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        'AI_PROVIDER_ERROR',
        `Failed to call Gemini image API: ${err instanceof Error ? err.message : String(err)}`,
        502
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class AiImageService {
  private provider: ImageModelProvider;
  private defaultCoversDir: string;

  constructor(provider?: ImageModelProvider, defaultCoversDir?: string) {
    this.provider = provider || new GeminiImageModelProvider();
    this.defaultCoversDir =
      defaultCoversDir || path.resolve(process.cwd(), 'public', 'covers');
  }

  public setProvider(provider: ImageModelProvider): void {
    this.provider = provider;
  }

  public setDefaultCoversDir(dirPath: string): void {
    this.defaultCoversDir = dirPath;
  }

  /**
   * Builds a rich, deterministic prompt for game cover art in Premium Colorful style.
   * Explicitly forbids rendered text/letters inside the illustration.
   */
  public buildCoverPrompt(spec: Pick<GameSpecification, 'title' | 'description' | 'gameType' | 'settings'>): string {
    const cleanTitle = (spec.title || 'Interactive Learning Game').trim().slice(0, 120);
    const cleanDesc = (spec.description || '').trim().slice(0, 240);
    const adv = spec.settings?.adventureConfig;
    const industryContext = adv?.industryLabel
      ? `Industry / Domain: ${adv.industryLabel}${adv.subEnvironment ? ` (${adv.subEnvironment})` : ''}.`
      : '';
    const objectiveContext = adv?.learningObjective
      ? `Learning theme: ${adv.learningObjective.slice(0, 160)}.`
      : '';
    const formatVisuals = describeGameFormatVisuals(spec.gameType);

    return [
      'Create a wide 16:9 hero cover illustration for an interactive educational game card.',
      `Topic: "${cleanTitle}".`,
      cleanDesc ? `Context: ${cleanDesc}.` : '',
      industryContext,
      objectiveContext,
      `Visual motif: ${formatVisuals}.`,
      'Art direction: Premium Colorful editorial digital illustration, rich depth, stylized 3D & vector geometric harmony, luminous accent lighting (amber gold, sky cyan, emerald, and deep indigo/slate contrast), crisp focal point in the center-right, clean composition suitable for a game discovery card.',
      'CRITICAL RULE: Do NOT include any text, words, letters, numbers, typography, watermarks, or UI labels inside the image. Pure visual illustration only.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  public computePromptHash(prompt: string): string {
    return crypto.createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 16);
  }

  private resolveLocalFileFromUrl(coverImageUrl: string | null | undefined, coversDir: string): string | null {
    if (!coverImageUrl || !coverImageUrl.startsWith('/covers/')) {
      return null;
    }
    const fileName = path.basename(coverImageUrl);
    if (!fileName || fileName.includes('..') || !fileName.startsWith('cover_')) {
      return null;
    }
    const resolvedDir = path.resolve(coversDir);
    const resolvedFile = path.resolve(resolvedDir, fileName);
    if (!resolvedFile.startsWith(resolvedDir + path.sep) && path.dirname(resolvedFile) !== resolvedDir) {
      return null;
    }
    return resolvedFile;
  }

  /**
   * Safely removes a local generated cover image file from public/covers/ when a game is deleted,
   * ONLY if no other game in the database still references that cover_image_url.
   */
  public cleanupOrphanedCoverImage(
    coverImageUrl: string | null | undefined,
    coversDir?: string
  ): boolean {
    try {
      if (!coverImageUrl || !coverImageUrl.startsWith('/covers/')) {
        return false;
      }
      const targetDir = coversDir || this.defaultCoversDir;
      const localFile = this.resolveLocalFileFromUrl(coverImageUrl, targetDir);
      if (!localFile) {
        return false;
      }

      // Check if any remaining game in SQLite still references this cover URL
      const remainingRefs = persistenceRepo.countGamesByCoverUrl(coverImageUrl);
      if (remainingRefs > 0) {
        return false;
      }

      if (fs.existsSync(localFile)) {
        fs.unlinkSync(localFile);
        return true;
      }
      return false;
    } catch {
      // Never block or throw if file cleanup fails
      return false;
    }
  }

  /**
   * Generates or retrieves a cached Gemini cover image for a persisted game.
   * Never crashes game creation/saving/publishing when throwOnError is false (default).
   */
  public async generateCoverForGame(
    spec: GameSpecification,
    options: GenerateGameCoverOptions = {}
  ): Promise<GenerateGameCoverResult> {
    const coversDir = options.coversDir || this.defaultCoversDir;
    const prompt = this.buildCoverPrompt(spec);
    const promptHash = this.computePromptHash(prompt);

    const existingMeta = persistenceRepo.getGameCoverMetadata(spec.gameId);
    const existingCoverUrl = existingMeta?.coverImageUrl ?? spec.coverImageUrl ?? null;

    // 1. Check cache hit if not forcing regeneration
    if (
      !options.forceRegenerate &&
      existingCoverUrl &&
      existingMeta?.coverImagePromptHash === promptHash
    ) {
      const localFile = this.resolveLocalFileFromUrl(existingCoverUrl, coversDir);
      if (!localFile || fs.existsSync(localFile)) {
        return {
          gameId: spec.gameId,
          coverImageUrl: existingCoverUrl,
          generated: false,
          cached: true,
          fallbackUsed: false,
          promptHash,
        };
      }
    }

    // 2. Enforce AI quota when userId is present
    if (options.userId) {
      quotaService.consumeUserQuota(options.userId, 'DAILY_AI_CALLS', 1);
    }

    const startTime = Date.now();
    try {
      const generated = await this.provider.generateImage(prompt);
      const ext = ALLOWED_IMAGE_MIME_TYPES[generated.mimeType];
      if (!ext) {
        throw new AppError(
          'AI_INVALID_OUTPUT',
          `Unsupported image MIME type: ${generated.mimeType}`,
          502
        );
      }

      const buffer = Buffer.from(generated.base64Data, 'base64');
      if (buffer.length < 32) {
        throw new AppError(
          'AI_INVALID_OUTPUT',
          'Generated image payload is empty or corrupted.',
          502
        );
      }
      if (buffer.length > LIMITS.MAX_COVER_IMAGE_BYTES) {
        throw new AppError(
          'AI_INVALID_OUTPUT',
          `Generated cover image exceeds size limit (${buffer.length} bytes).`,
          502
        );
      }

      fs.mkdirSync(coversDir, { recursive: true });
      const safeId = sanitizeGameIdForFilename(spec.gameId);
      const fileName = `cover_${safeId}_${promptHash.slice(0, 10)}.${ext}`;
      const filePath = path.join(coversDir, fileName);

      fs.writeFileSync(filePath, buffer);

      const publicUrl = `/covers/${fileName}`;
      persistenceRepo.updateGameCover(spec.gameId, publicUrl, promptHash);

      // Remove old cover file if filename changed and no other game references it
      if (existingCoverUrl && existingCoverUrl !== publicUrl) {
        this.cleanupOrphanedCoverImage(existingCoverUrl, coversDir);
      }

      spec.coverImageUrl = publicUrl;
      const inMemory = gameStore.get(spec.gameId);
      if (inMemory) {
        inMemory.coverImageUrl = publicUrl;
        gameStore.save(inMemory);
      }

      const usage =
        generated.usageMetadata ??
        (typeof this.provider.getLastUsageMetadata === 'function'
          ? this.provider.getLastUsageMetadata()
          : null);

      aiObservabilityService.recordAiCall({
        userId: options.userId ?? spec.ownerUserId ?? null,
        provider: usage?.provider || 'gemini',
        model: usage?.model || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
        operation: 'GENERATE_COVER_IMAGE',
        status: 'SUCCESS',
        latencyMs: Date.now() - startTime,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        usageIsEstimated: !usage?.usageReportedByProvider,
        requestedQuestions: 0,
        generatedQuestions: 0,
        validQuestions: 0,
        rejectedQuestions: 0,
        duplicateQuestions: 0,
        diagnosticsCount: 0,
        gameType: spec.gameType,
        sourceCount: spec.sourceSummary?.sourceCount ?? 0,
      });

      return {
        gameId: spec.gameId,
        coverImageUrl: publicUrl,
        generated: true,
        cached: false,
        fallbackUsed: false,
        promptHash,
      };
    } catch (err) {
      const usage =
        typeof this.provider.getLastUsageMetadata === 'function'
          ? this.provider.getLastUsageMetadata()
          : null;

      aiObservabilityService.recordAiCall({
        userId: options.userId ?? spec.ownerUserId ?? null,
        provider: usage?.provider || 'gemini',
        model: usage?.model || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
        operation: 'GENERATE_COVER_IMAGE',
        status: 'FAILED',
        errorCode: err instanceof AppError ? err.code : 'AI_IMAGE_ERROR',
        latencyMs: Date.now() - startTime,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        usageIsEstimated: true,
        requestedQuestions: 0,
        generatedQuestions: 0,
        validQuestions: 0,
        rejectedQuestions: 0,
        duplicateQuestions: 0,
        diagnosticsCount: 0,
        gameType: spec.gameType,
        sourceCount: spec.sourceSummary?.sourceCount ?? 0,
      });

      if (options.throwOnError) {
        throw err;
      }

      return {
        gameId: spec.gameId,
        coverImageUrl: existingCoverUrl,
        generated: false,
        cached: false,
        fallbackUsed: true,
        promptHash,
        reason: err instanceof Error ? err.message : 'Không thể tạo ảnh bìa AI lúc này. Hệ thống sử dụng ảnh minh họa mặc định.',
      };
    }
  }
}

export const aiImageService = new AiImageService();

