import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { LIMITS } from '../config/limits.js';
import {
  AdventureAssetMetadataSchema,
  AdventureAssetSourceEnum,
  AdventureAssetStatusEnum,
  AdventureAssetTypeEnum,
  AdventureBoundAssetsSchema,
  IndustryIdEnum,
} from '../contracts/adventure.contract.js';
import type {
  AdventureAssetMetadata,
  AdventureAssetSource,
  AdventureAssetStatus,
  AdventureAssetType,
  AdventureBoundAssets,
  AdventureConfig,
  IndustryId,
} from '../contracts/adventure.contract.js';
import type { GameSpecification } from '../contracts/game.contract.js';
import { AppError } from '../utils/errors.js';
import {
  GeminiImageModelProvider,
  sanitizeAiErrorMessage,
} from './ai.image.service.js';
import type { ImageModelProvider } from './ai.image.service.js';
import { aiObservabilityService } from './ai.observability.service.js';
import { quotaService } from './quota.service.js';

export {
  AdventureAssetTypeEnum,
  AdventureAssetSourceEnum,
  AdventureAssetStatusEnum,
  AdventureAssetMetadataSchema,
  AdventureBoundAssetsSchema,
};
export type {
  AdventureAssetType,
  AdventureAssetSource,
  AdventureAssetStatus,
  AdventureAssetMetadata,
  AdventureBoundAssets,
};

export const AdventureIndustryAssetPackSchema = z.object({
  industryId: IndustryIdEnum,
  source: AdventureAssetSourceEnum,
  verified: z.boolean(),
  generatedAt: z.string(),
  assets: AdventureBoundAssetsSchema,
});
export type AdventureIndustryAssetPack = z.infer<typeof AdventureIndustryAssetPackSchema>;

export const AdventureAssetPackManifestSchema = z.object({
  version: z.string(),
  source: AdventureAssetSourceEnum,
  updatedAt: z.string(),
  supportedIndustries: z.array(IndustryIdEnum),
  packs: z.record(z.string(), AdventureIndustryAssetPackSchema),
});
export type AdventureAssetPackManifest = z.infer<typeof AdventureAssetPackManifestSchema>;

export interface AdventureAssetPackResolution {
  industryId: string;
  available: boolean;
  verified: boolean;
  pack: AdventureIndustryAssetPack | null;
  missingAssets: AdventureAssetType[];
  errors: string[];
}

export interface ImageInspectionResult {
  valid: boolean;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | null;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  error?: string;
}

export interface AdventureGameAssetVerificationResult {
  verified: boolean;
  industryId: IndustryId;
  assetStatus: AdventureAssetStatus;
  assets: AdventureBoundAssets | null;
  missingAssets: AdventureAssetType[];
  errors: string[];
  errorCode?: string;
}

export interface ProvisionAdventureAssetsOptions {
  baseDir?: string;
  userId?: string | null;
  forceRegenerate?: boolean;
  imageProvider?: ImageModelProvider;
}

export interface ProvisionAdventureAssetsResult {
  specification: GameSpecification;
  verified: boolean;
  assetStatus: AdventureAssetStatus;
  source: AdventureAssetSource | null;
  errors: string[];
  errorCode: string | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_ASSET_SIZE_BYTES = 1024;
const MAX_ASSET_SIZE_BYTES = LIMITS.MAX_COVER_IMAGE_BYTES || 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<'image/png' | 'image/jpeg' | 'image/webp', string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function sanitizeGameIdForAdventureDir(gameId: string): string {
  const cleaned = String(gameId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new AppError('INVALID_REQUEST', 'Invalid gameId for Adventure asset storage.', 400);
  }
  return cleaned;
}

function getPacksDirectory(baseDir: string = process.cwd()): string {
  return path.resolve(baseDir, 'public', 'adventure-assets', 'packs');
}

function getGamesAssetsRootDirectory(baseDir: string = process.cwd()): string {
  return path.resolve(baseDir, 'public', 'adventure-assets', 'games');
}

function resolveSafeGameAssetsDirectory(gameId: string, baseDir: string = process.cwd()): string {
  const safeId = sanitizeGameIdForAdventureDir(gameId);
  const rootDir = getGamesAssetsRootDirectory(baseDir);
  const targetDir = path.resolve(rootDir, safeId);
  const relative = path.relative(rootDir, targetDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(
      'INVALID_REQUEST',
      'Path traversal detected while resolving Adventure game asset directory.',
      400
    );
  }
  return targetDir;
}

function isPathContainedIn(childPath: string, parentDir: string): boolean {
  const resolvedChild = path.resolve(childPath);
  const resolvedParent = path.resolve(parentDir);
  const rel = path.relative(resolvedParent, resolvedChild);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return null;
  }
  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // Skip padding 0xFF bytes
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buf.length) break;
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buf.length) {
      break;
    }
    // SOF0, SOF1, SOF2 markers
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (offset + 9 <= buf.length) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      break;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function parseWebpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (
    buf.length < 30 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunkType = buf.toString('ascii', 12, 16);
  if (chunkType === 'VP8 ' && buf.length >= 30) {
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width > 0 && height > 0) return { width, height };
  } else if (chunkType === 'VP8L' && buf.length >= 25) {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width > 0 && height > 0) return { width, height };
  } else if (chunkType === 'VP8X' && buf.length >= 30) {
    const width = 1 + buf.readUIntLE(24, 3);
    const height = 1 + buf.readUIntLE(27, 3);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

export function inspectImageBuffer(
  buf: Buffer,
  expectedMimeType?: string
): ImageInspectionResult {
  if (!Buffer.isBuffer(buf) || buf.length < MIN_ASSET_SIZE_BYTES) {
    return {
      valid: false,
      mimeType: null,
      sizeBytes: buf ? buf.length : 0,
      width: 0,
      height: 0,
      sha256: '',
      error: `File size ${buf ? buf.length : 0} bytes is below minimum threshold (${MIN_ASSET_SIZE_BYTES} bytes)`,
    };
  }

  if (buf.length > MAX_ASSET_SIZE_BYTES) {
    return {
      valid: false,
      mimeType: null,
      sizeBytes: buf.length,
      width: 0,
      height: 0,
      sha256: '',
      error: `File size ${buf.length} bytes exceeds maximum allowed (${MAX_ASSET_SIZE_BYTES} bytes)`,
    };
  }

  let detectedMime: 'image/png' | 'image/jpeg' | 'image/webp' | null = null;
  let width = 0;
  let height = 0;

  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    detectedMime = 'image/png';
    width = buf.readUInt32BE(16);
    height = buf.readUInt32BE(20);
  } else if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    detectedMime = 'image/jpeg';
    const dims = parseJpegDimensions(buf);
    if (dims) {
      width = dims.width;
      height = dims.height;
    }
  } else if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    detectedMime = 'image/webp';
    const dims = parseWebpDimensions(buf);
    if (dims) {
      width = dims.width;
      height = dims.height;
    }
  }

  if (!detectedMime) {
    return {
      valid: false,
      mimeType: null,
      sizeBytes: buf.length,
      width: 0,
      height: 0,
      sha256: '',
      error: 'Invalid or unsupported image binary signature (expected PNG, JPEG, or WebP)',
    };
  }

  const normalizedExpected =
    expectedMimeType === 'image/jpg' ? 'image/jpeg' : expectedMimeType?.toLowerCase().trim();
  if (normalizedExpected && normalizedExpected !== detectedMime) {
    return {
      valid: false,
      mimeType: detectedMime,
      sizeBytes: buf.length,
      width,
      height,
      sha256: '',
      error: `MIME type mismatch: expected ${normalizedExpected}, but binary signature is ${detectedMime}`,
    };
  }

  if (width <= 0 || height <= 0) {
    return {
      valid: false,
      mimeType: detectedMime,
      sizeBytes: buf.length,
      width,
      height,
      sha256: '',
      error: `Invalid image dimensions: ${width}x${height}`,
    };
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return {
    valid: true,
    mimeType: detectedMime,
    sizeBytes: buf.length,
    width,
    height,
    sha256,
  };
}

export function inspectImageFile(
  filePath: string,
  expectedMimeType?: string
): ImageInspectionResult {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      mimeType: null,
      sizeBytes: 0,
      width: 0,
      height: 0,
      sha256: '',
      error: 'File does not exist',
    };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return {
      valid: false,
      mimeType: null,
      sizeBytes: 0,
      width: 0,
      height: 0,
      sha256: '',
      error: 'Path is not a regular file',
    };
  }

  const buf = fs.readFileSync(filePath);
  return inspectImageBuffer(buf, expectedMimeType);
}

export function loadAdventureAssetManifest(
  baseDir: string = process.cwd()
): AdventureAssetPackManifest | null {
  const manifestPath = path.join(getPacksDirectory(baseDir), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const raw = fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  return AdventureAssetPackManifestSchema.parse(parsed);
}

/**
 * Resolves and physically verifies the 2D Adventure asset pack for a specific industryId.
 * Strictly prohibits cross-industry fallback (e.g., never returns MOTORCYCLE_TRAFFIC for another industry).
 */
export function resolveAdventureAssetPack(
  industryId: IndustryId | string,
  baseDir: string = process.cwd()
): AdventureAssetPackResolution {
  const normalizedId = String(industryId || '').trim();
  const parsedIndustry = IndustryIdEnum.safeParse(normalizedId);

  if (!parsedIndustry.success) {
    return {
      industryId: normalizedId,
      available: false,
      verified: false,
      pack: null,
      missingAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      errors: [`Unsupported industryId: "${normalizedId}"`],
    };
  }

  if (parsedIndustry.data === 'CUSTOM') {
    return {
      industryId: 'CUSTOM',
      available: false,
      verified: false,
      pack: null,
      missingAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      errors: ['Industry CUSTOM requires dedicated asset generation and has no prebuilt static pack'],
    };
  }

  let manifest: AdventureAssetPackManifest | null = null;
  try {
    manifest = loadAdventureAssetManifest(baseDir);
  } catch (err: any) {
    return {
      industryId: parsedIndustry.data,
      available: false,
      verified: false,
      pack: null,
      missingAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      errors: [`Failed to read asset pack manifest: ${err?.message || String(err)}`],
    };
  }

  const packEntry = manifest?.packs?.[parsedIndustry.data];
  if (!packEntry) {
    return {
      industryId: parsedIndustry.data,
      available: false,
      verified: false,
      pack: null,
      missingAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      errors: [`No asset pack registered in manifest for industry "${parsedIndustry.data}"`],
    };
  }

  if (packEntry.industryId !== parsedIndustry.data) {
    return {
      industryId: parsedIndustry.data,
      available: false,
      verified: false,
      pack: null,
      missingAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      errors: [
        `Manifest industryId mismatch: expected "${parsedIndustry.data}", got "${packEntry.industryId}"`,
      ],
    };
  }

  const requiredChecks: Array<{
    key: 'background' | 'character' | 'obstacle';
    type: AdventureAssetType;
  }> = [
    { key: 'background', type: 'BACKGROUND' },
    { key: 'character', type: 'CHARACTER' },
    { key: 'obstacle', type: 'OBSTACLE' },
  ];

  const missingAssets: AdventureAssetType[] = [];
  const errors: string[] = [];
  const packsRoot = getPacksDirectory(baseDir);

  for (const check of requiredChecks) {
    const assetMeta = packEntry.assets[check.key];
    if (!assetMeta) {
      missingAssets.push(check.type);
      errors.push(`Missing ${check.type} metadata for industry "${parsedIndustry.data}"`);
      continue;
    }

    if (assetMeta.industryId !== parsedIndustry.data) {
      missingAssets.push(check.type);
      errors.push(
        `Cross-industry asset forbidden: ${check.type} belongs to "${assetMeta.industryId}" instead of "${parsedIndustry.data}"`
      );
      continue;
    }

    const diskPath = path.resolve(baseDir, assetMeta.relativePath);
    if (!isPathContainedIn(diskPath, packsRoot)) {
      missingAssets.push(check.type);
      errors.push(`${check.type} relativePath escapes packs directory`);
      continue;
    }

    const inspection = inspectImageFile(diskPath, assetMeta.mimeType);
    if (!inspection.valid) {
      missingAssets.push(check.type);
      errors.push(`${check.type} failed physical verification: ${inspection.error}`);
      continue;
    }

    if (inspection.sha256 !== assetMeta.sha256) {
      missingAssets.push(check.type);
      errors.push(`${check.type} SHA-256 mismatch on disk`);
    }
  }

  const verified = missingAssets.length === 0 && errors.length === 0;
  return {
    industryId: parsedIndustry.data,
    available: verified,
    verified,
    pack: verified ? packEntry : null,
    missingAssets,
    errors,
  };
}

export function listVerifiedAdventureAssetPacks(
  baseDir: string = process.cwd()
): AdventureIndustryAssetPack[] {
  const manifest = loadAdventureAssetManifest(baseDir);
  if (!manifest) return [];

  const verifiedPacks: AdventureIndustryAssetPack[] = [];
  for (const industryId of manifest.supportedIndustries) {
    const res = resolveAdventureAssetPack(industryId, baseDir);
    if (res.verified && res.pack) {
      verifiedPacks.push(res.pack);
    }
  }
  return verifiedPacks;
}

/**
 * Builds 3 industry-specific 2D side-scrolling Banana image prompts for BACKGROUND, CHARACTER, and OBSTACLE.
 */
export function buildAdventureAssetPrompts(
  config: AdventureConfig,
  gameTitle: string,
  gameDescription: string
): Record<AdventureAssetType, { prompt: string; aspectRatio: '16:9' | '1:1' }> {
  const industryLabel = (config.industryLabel || 'Chuyên ngành thực hành').trim();
  const subEnvironment = (config.subEnvironment || 'Bối cảnh thực hành chuyên môn').trim();
  const avatarLabel = (config.avatarLabel || 'Nhân vật thực hành').trim();
  const obstacleSubject =
    (config.interactiveObjects && config.interactiveObjects[0]) ||
    'Chướng ngại vật chuyên ngành';
  const contextTopic = [gameTitle, gameDescription, config.learningObjective]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 240);

  return {
    BACKGROUND: {
      aspectRatio: '16:9',
      prompt: [
        '2D side-scrolling platformer game environment background illustration.',
        `Industry & Domain: ${industryLabel}.`,
        `Scene Setting: ${subEnvironment}.`,
        `Topic Context: ${contextTopic}.`,
        'Composition: Wide 16:9 horizontal side-view layer with a clear flat horizontal road or floor walkway along the bottom 25% of the frame for a runner character.',
        'Style: Crisp modern 2D vector game art, rich depth layers, vibrant lighting.',
        'Strict constraints: NO characters, NO vehicles on the road, NO text, NO letters, NO numbers, NO UI HUD, NO watermarks.',
      ].join(' '),
    },
    CHARACTER: {
      aspectRatio: '1:1',
      prompt: [
        '2D side-scrolling runner game character sprite in full side profile facing RIGHT.',
        `Character Role: ${avatarLabel} for industry "${industryLabel}" (${subEnvironment}).`,
        'Style: Clean 2D game character illustration, full body visible, dynamic forward-moving pose facing right, isolated on a solid pure white (#FFFFFF) background.',
        'Strict constraints: Single character only, NO background scenery, NO ground shadow extending to edges, NO text, NO labels, NO watermarks.',
      ].join(' '),
    },
    OBSTACLE: {
      aspectRatio: '1:1',
      prompt: [
        '2D side-scrolling platformer game obstacle prop sprite in side view.',
        `Obstacle Object: ${obstacleSubject} matching industry "${industryLabel}" (${subEnvironment}).`,
        'Style: Clean 2D game prop illustration, compact jumpable obstacle silhouette, isolated on a solid pure white (#FFFFFF) background.',
        'Strict constraints: Single prop object only, NO characters, NO background scenery, NO text, NO numbers, NO watermarks.',
      ].join(' '),
    },
  };
}

/**
 * Physically verifies the 3 bound assets on an Adventure GameSpecification.
 * Never trusts client metadata alone: checks disk existence, containment, magic bytes, dimensions, SHA-256,
 * and strict same-industry matching.
 */
export function verifyAdventureGameAssets(
  spec: GameSpecification,
  baseDir: string = process.cwd()
): AdventureGameAssetVerificationResult {
  const adv = spec.settings?.adventureConfig;
  const industryId: IndustryId = adv?.industryId || 'EDUCATION_GENERAL';

  if (!adv || !adv.assets) {
    return {
      verified: false,
      industryId,
      assetStatus: adv?.assetStatus || 'ASSET_GENERATION_FAILED',
      assets: null,
      missingAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      errors: ['Adventure game is missing bound asset metadata (background, character, obstacle).'],
      errorCode: adv?.assetErrorCode || 'ADVENTURE_ASSETS_MISSING',
    };
  }

  const requiredChecks: Array<{
    key: 'background' | 'character' | 'obstacle';
    type: AdventureAssetType;
  }> = [
    { key: 'background', type: 'BACKGROUND' },
    { key: 'character', type: 'CHARACTER' },
    { key: 'obstacle', type: 'OBSTACLE' },
  ];

  const missingAssets: AdventureAssetType[] = [];
  const errors: string[] = [];
  const packsRoot = getPacksDirectory(baseDir);
  const gamesRoot = getGamesAssetsRootDirectory(baseDir);

  let manifest: AdventureAssetPackManifest | null = null;
  try {
    manifest = loadAdventureAssetManifest(baseDir);
  } catch {
    manifest = null;
  }

  for (const check of requiredChecks) {
    const meta = adv.assets[check.key];
    if (!meta) {
      missingAssets.push(check.type);
      errors.push(`Missing ${check.type} metadata`);
      continue;
    }

    if (meta.assetType !== check.type) {
      missingAssets.push(check.type);
      errors.push(`${check.type} metadata has mismatched assetType "${meta.assetType}"`);
      continue;
    }

    if (meta.industryId !== industryId) {
      missingAssets.push(check.type);
      errors.push(
        `Cross-industry fallback forbidden: ${check.type} asset belongs to "${meta.industryId}" instead of game industry "${industryId}"`
      );
      continue;
    }

    if (!meta.verified) {
      missingAssets.push(check.type);
      errors.push(`${check.type} asset is not marked verified`);
      continue;
    }

    const diskPath = path.resolve(baseDir, meta.relativePath);
    const inPacks = isPathContainedIn(diskPath, packsRoot);
    const inGames = isPathContainedIn(diskPath, gamesRoot);
    if (!inPacks && !inGames) {
      missingAssets.push(check.type);
      errors.push(`${check.type} relativePath is outside allowed adventure-assets directories`);
      continue;
    }

    if (meta.source === 'ANTIGRAVITY_BANANA_PACK') {
      if (!inPacks) {
        missingAssets.push(check.type);
        errors.push(`${check.type} claims ANTIGRAVITY_BANANA_PACK source but is not in packs directory`);
        continue;
      }
      const manifestAsset = manifest?.packs?.[industryId]?.assets?.[check.key];
      if (!manifestAsset || manifestAsset.sha256 !== meta.sha256) {
        missingAssets.push(check.type);
        errors.push(`${check.type} SHA-256 does not match official manifest for industry "${industryId}"`);
        continue;
      }
    }

    const inspection = inspectImageFile(diskPath, meta.mimeType);
    if (!inspection.valid) {
      missingAssets.push(check.type);
      errors.push(`${check.type} failed physical disk verification: ${inspection.error}`);
      continue;
    }

    if (inspection.sha256 !== meta.sha256) {
      missingAssets.push(check.type);
      errors.push(`${check.type} SHA-256 mismatch on disk`);
      continue;
    }
  }

  const verified = missingAssets.length === 0 && errors.length === 0;
  return {
    verified,
    industryId,
    assetStatus: verified ? 'READY' : 'ASSET_GENERATION_FAILED',
    assets: verified ? adv.assets : null,
    missingAssets,
    errors,
    errorCode: verified ? undefined : 'ADVENTURE_ASSETS_INVALID',
  };
}

let defaultAdventureImageProvider: ImageModelProvider | null = null;

export function setAdventureAssetImageProvider(provider: ImageModelProvider | null): void {
  defaultAdventureImageProvider = provider;
}

export function getAdventureAssetImageProvider(): ImageModelProvider {
  return defaultAdventureImageProvider || new GeminiImageModelProvider();
}

/**
 * Generates BACKGROUND, CHARACTER, and OBSTACLE via the Banana runtime image API for a specific game
 * (used when industryId === 'CUSTOM' or when runtime generation is triggered).
 */
export async function generateRuntimeAdventureAssetsForGame(
  spec: GameSpecification,
  options: ProvisionAdventureAssetsOptions = {}
): Promise<{
  verified: boolean;
  assets: AdventureBoundAssets | null;
  errorCode: string | null;
  errorMessage: string | null;
}> {
  const baseDir = options.baseDir || process.cwd();
  const provider = options.imageProvider || getAdventureAssetImageProvider();
  const adv = spec.settings?.adventureConfig;
  if (!adv) {
    return {
      verified: false,
      assets: null,
      errorCode: 'ADVENTURE_CONFIG_MISSING',
      errorMessage: 'Thiếu cấu hình AdventureConfig để tạo tài nguyên hình ảnh.',
    };
  }

  const safeGameId = sanitizeGameIdForAdventureDir(spec.gameId);
  const gameAssetsDir = resolveSafeGameAssetsDirectory(spec.gameId, baseDir);
  const prompts = buildAdventureAssetPrompts(adv, spec.title, spec.description);

  const assetOrder: Array<{
    key: 'background' | 'character' | 'obstacle';
    type: AdventureAssetType;
    baseName: string;
  }> = [
    { key: 'background', type: 'BACKGROUND', baseName: 'background' },
    { key: 'character', type: 'CHARACTER', baseName: 'character' },
    { key: 'obstacle', type: 'OBSTACLE', baseName: 'obstacle' },
  ];

  const generatedMeta: Partial<AdventureBoundAssets> = {};

  try {
    fs.mkdirSync(gameAssetsDir, { recursive: true });

    for (const item of assetOrder) {
      if (!options.forceRegenerate) {
        let reusedValidSlot = false;
        for (const candidateExt of ['png', 'jpg', 'webp'] as const) {
          const candidateFileName = `${item.baseName}.${candidateExt}`;
          const candidateFilePath = path.resolve(gameAssetsDir, candidateFileName);
          if (!isPathContainedIn(candidateFilePath, gameAssetsDir)) {
            continue;
          }
          if (fs.existsSync(candidateFilePath)) {
            const existingInspection = inspectImageFile(candidateFilePath);
            if (
              existingInspection.valid &&
              existingInspection.mimeType &&
              existingInspection.width &&
              existingInspection.height &&
              existingInspection.sha256
            ) {
              generatedMeta[item.key] = {
                industryId: adv.industryId,
                assetType: item.type,
                fileName: candidateFileName,
                url: `/adventure-assets/games/${safeGameId}/${candidateFileName}`,
                relativePath: `public/adventure-assets/games/${safeGameId}/${candidateFileName}`,
                mimeType: existingInspection.mimeType,
                sizeBytes: existingInspection.sizeBytes,
                width: existingInspection.width,
                height: existingInspection.height,
                sha256: existingInspection.sha256,
                source: 'GEMINI_BANANA_RUNTIME',
                verified: true,
              };
              reusedValidSlot = true;
              break;
            } else {
              try {
                fs.unlinkSync(candidateFilePath);
              } catch {
                // Ignore cleanup error for corrupted slot file
              }
            }
          }
        }
        if (reusedValidSlot) {
          continue;
        }
      }

      if (options.userId) {
        quotaService.consumeUserQuota(options.userId, 'DAILY_AI_CALLS', 1);
      }

      const promptCfg = prompts[item.type];
      const startedAt = Date.now();
      let payload;
      try {
        payload = await provider.generateImage(promptCfg.prompt, {
          aspectRatio: promptCfg.aspectRatio,
        });
        const usage = payload.usageMetadata ?? provider.getLastUsageMetadata?.() ?? null;
        aiObservabilityService.recordAiCall({
          userId: options.userId ?? spec.ownerUserId ?? null,
          provider: usage?.provider || 'gemini',
          model: usage?.model || 'gemini-2.5-flash-image',
          operation: 'GENERATE_COVER_IMAGE',
          status: 'SUCCESS',
          latencyMs: Date.now() - startedAt,
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
      } catch (apiErr: unknown) {
        const usage = provider.getLastUsageMetadata?.() ?? null;
        const errCode = apiErr instanceof AppError ? apiErr.code : 'AI_PROVIDER_ERROR';
        aiObservabilityService.recordAiCall({
          userId: options.userId ?? spec.ownerUserId ?? null,
          provider: usage?.provider || 'gemini',
          model: usage?.model || 'gemini-2.5-flash-image',
          operation: 'GENERATE_COVER_IMAGE',
          status: 'FAILED',
          errorCode: errCode,
          latencyMs: Date.now() - startedAt,
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
        throw apiErr;
      }

      const rawBase64 = String(payload?.base64Data || '').trim();
      if (!rawBase64) {
        throw new AppError(
          'AI_INVALID_OUTPUT',
          `Banana Image API trả về dữ liệu rỗng cho tài nguyên ${item.type}.`,
          502
        );
      }

      const buffer = Buffer.from(rawBase64, 'base64');
      const inspection = inspectImageBuffer(buffer, payload.mimeType);
      if (!inspection.valid || !inspection.mimeType) {
        throw new AppError(
          'AI_INVALID_OUTPUT',
          `Tài nguyên ${item.type} từ Banana Image API không hợp lệ: ${inspection.error || 'Dữ liệu ảnh lỗi'}`,
          502
        );
      }

      const ext = EXTENSION_BY_MIME[inspection.mimeType];
      const fileName = `${item.baseName}.${ext}`;
      const filePath = path.resolve(gameAssetsDir, fileName);
      if (!isPathContainedIn(filePath, gameAssetsDir)) {
        throw new AppError('INVALID_REQUEST', 'Invalid asset filename path.', 400);
      }

      // Remove any stale file with a different extension for this same slot
      for (const otherExt of ['png', 'jpg', 'webp'] as const) {
        if (otherExt !== ext) {
          const stalePath = path.resolve(gameAssetsDir, `${item.baseName}.${otherExt}`);
          if (isPathContainedIn(stalePath, gameAssetsDir) && fs.existsSync(stalePath)) {
            try {
              fs.unlinkSync(stalePath);
            } catch {
              // Ignore
            }
          }
        }
      }

      fs.writeFileSync(filePath, buffer);

      const diskInspection = inspectImageFile(filePath, inspection.mimeType);
      if (!diskInspection.valid || diskInspection.sha256 !== inspection.sha256) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Ignore cleanup error
        }
        throw new AppError(
          'AI_INVALID_OUTPUT',
          `Không thể xác thực tệp ${fileName} sau khi lưu xuống đĩa.`,
          502
        );
      }

      generatedMeta[item.key] = {
        industryId: adv.industryId,
        assetType: item.type,
        fileName,
        url: `/adventure-assets/games/${safeGameId}/${fileName}`,
        relativePath: `public/adventure-assets/games/${safeGameId}/${fileName}`,
        mimeType: inspection.mimeType,
        sizeBytes: diskInspection.sizeBytes,
        width: diskInspection.width,
        height: diskInspection.height,
        sha256: diskInspection.sha256,
        source: 'GEMINI_BANANA_RUNTIME',
        verified: true,
      };
    }

    const boundAssets = AdventureBoundAssetsSchema.parse(generatedMeta);
    return {
      verified: true,
      assets: boundAssets,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err: unknown) {
    try {
      if (fs.existsSync(gameAssetsDir) && fs.readdirSync(gameAssetsDir).length === 0) {
        fs.rmdirSync(gameAssetsDir);
      }
    } catch {
      // Ignore directory cleanup errors
    }

    const errorCode = err instanceof AppError ? err.code : 'AI_PROVIDER_ERROR';
    const rawMsg =
      err instanceof Error
        ? err.message
        : 'Không thể tạo bộ tài nguyên hình ảnh Adventure bằng Banana API.';
    return {
      verified: false,
      assets: null,
      errorCode,
      errorMessage: sanitizeAiErrorMessage(rawMsg),
    };
  }
}

/**
 * Provisions and verifies Adventure 2D assets for a GameSpecification:
 * - For the 8 pre-defined industries: resolves and physically verifies the static Banana pack from manifest.json.
 * - For CUSTOM: invokes runtime Banana API generation and saves verified per-game assets under public/adventure-assets/games/<gameId>/.
 * - Never regenerates assets when re-opening/replaying a game that already has verified assets for its industry.
 * - Preserves all generated questions on failure and records assetStatus = 'ASSET_GENERATION_FAILED' with sanitized error details.
 */
export async function provisionAdventureAssetsForGame(
  spec: GameSpecification,
  options: ProvisionAdventureAssetsOptions = {}
): Promise<ProvisionAdventureAssetsResult> {
  const baseDir = options.baseDir || process.cwd();
  if (spec.gameType !== 'ADVENTURE' || !spec.settings?.adventureConfig) {
    return {
      specification: spec,
      verified: true,
      assetStatus: 'READY',
      source: null,
      errors: [],
      errorCode: null,
    };
  }

  const adv = spec.settings.adventureConfig;
  const nowIso = new Date().toISOString();

  // 1. If not forcing regeneration and game already has valid, verified assets on disk for this exact industryId, reuse them!
  if (!options.forceRegenerate && adv.assets) {
    const existingCheck = verifyAdventureGameAssets(spec, baseDir);
    if (existingCheck.verified && existingCheck.assets) {
      const source = existingCheck.assets.background.source;
      const updatedAdv: AdventureConfig = {
        ...adv,
        version: Math.max(adv.version || 1, 2),
        assetStatus: 'READY',
        assetPackSource: source,
        assets: existingCheck.assets,
        assetError: null,
        assetErrorCode: null,
        assetUpdatedAt: adv.assetUpdatedAt || nowIso,
      };
      return {
        specification: {
          ...spec,
          settings: {
            ...spec.settings,
            adventureConfig: updatedAdv,
          },
        },
        verified: true,
        assetStatus: 'READY',
        source,
        errors: [],
        errorCode: null,
      };
    }
  }

  // 2. Pre-defined industries (8 concrete IndustryIds): resolve from verified Banana packs
  if (adv.industryId !== 'CUSTOM') {
    const packRes = resolveAdventureAssetPack(adv.industryId, baseDir);
    if (packRes.verified && packRes.pack) {
      const updatedAdv: AdventureConfig = {
        ...adv,
        version: Math.max(adv.version || 1, 2),
        assetStatus: 'READY',
        assetPackSource: 'ANTIGRAVITY_BANANA_PACK',
        assets: packRes.pack.assets,
        assetError: null,
        assetErrorCode: null,
        assetUpdatedAt: nowIso,
      };
      return {
        specification: {
          ...spec,
          settings: {
            ...spec.settings,
            adventureConfig: updatedAdv,
          },
        },
        verified: true,
        assetStatus: 'READY',
        source: 'ANTIGRAVITY_BANANA_PACK',
        errors: [],
        errorCode: null,
      };
    }

    const errMsg =
      packRes.errors.join('; ') ||
      `Bộ tài nguyên hình ảnh cho ngành "${adv.industryId}" không hợp lệ hoặc bị thiếu trên đĩa.`;
    const updatedAdv: AdventureConfig = {
      ...adv,
      version: Math.max(adv.version || 1, 2),
      assetStatus: 'ASSET_GENERATION_FAILED',
      assetPackSource: null,
      assets: null,
      assetError: errMsg.slice(0, 500),
      assetErrorCode: 'ASSET_PACK_INTEGRITY_ERROR',
      assetUpdatedAt: nowIso,
    };
    return {
      specification: {
        ...spec,
        settings: {
          ...spec.settings,
          adventureConfig: updatedAdv,
        },
      },
      verified: false,
      assetStatus: 'ASSET_GENERATION_FAILED',
      source: null,
      errors: packRes.errors,
      errorCode: 'ASSET_PACK_INTEGRITY_ERROR',
    };
  }

  // 3. CUSTOM industry: generate dedicated assets via Banana runtime API
  const runtimeRes = await generateRuntimeAdventureAssetsForGame(spec, options);
  if (runtimeRes.verified && runtimeRes.assets) {
    const updatedAdv: AdventureConfig = {
      ...adv,
      version: Math.max(adv.version || 1, 2),
      assetStatus: 'READY',
      assetPackSource: 'GEMINI_BANANA_RUNTIME',
      assets: runtimeRes.assets,
      assetError: null,
      assetErrorCode: null,
      assetUpdatedAt: nowIso,
    };
    return {
      specification: {
        ...spec,
        settings: {
          ...spec.settings,
          adventureConfig: updatedAdv,
        },
      },
      verified: true,
      assetStatus: 'READY',
      source: 'GEMINI_BANANA_RUNTIME',
      errors: [],
      errorCode: null,
    };
  }

  const failMsg =
    runtimeRes.errorMessage ||
    'Không thể tạo đủ 3 tài nguyên hình ảnh (background, character, obstacle) từ Banana API cho ngành tùy chỉnh.';
  const failCode = runtimeRes.errorCode || 'AI_PROVIDER_ERROR';
  const updatedAdv: AdventureConfig = {
    ...adv,
    version: Math.max(adv.version || 1, 2),
    assetStatus: 'ASSET_GENERATION_FAILED',
    assetPackSource: null,
    assets: null,
    assetError: failMsg.slice(0, 500),
    assetErrorCode: failCode,
    assetUpdatedAt: nowIso,
  };
  return {
    specification: {
      ...spec,
      settings: {
        ...spec.settings,
        adventureConfig: updatedAdv,
      },
    },
    verified: false,
    assetStatus: 'ASSET_GENERATION_FAILED',
    source: null,
    errors: [failMsg],
    errorCode: failCode,
  };
}

/**
 * Safely deletes per-game runtime Adventure assets under public/adventure-assets/games/<safeGameId>/
 * when a game is deleted, ensuring shared packs in public/adventure-assets/packs/ are NEVER touched.
 */
export function cleanupOrphanedAdventureGameAssets(
  gameId: string,
  baseDir: string = process.cwd(),
  isReferencedByOtherGame?: (urlPrefix: string) => boolean
): boolean {
  try {
    const safeGameId = sanitizeGameIdForAdventureDir(gameId);
    const gamesRoot = getGamesAssetsRootDirectory(baseDir);
    const targetDir = resolveSafeGameAssetsDirectory(gameId, baseDir);
    if (!isPathContainedIn(targetDir, gamesRoot)) {
      return false;
    }

    const urlPrefix = `/adventure-assets/games/${safeGameId}/`;
    if (isReferencedByOtherGame && isReferencedByOtherGame(urlPrefix)) {
      return false;
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
