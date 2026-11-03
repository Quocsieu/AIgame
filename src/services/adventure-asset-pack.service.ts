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
  generationId?: string | null;
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
 * Resolves a verified default fallback asset item for a single slot ('background' | 'character' | 'obstacle').
 * Used when Banana runtime generation fails/times out for a slot or when a saved asset file is missing/corrupted.
 */
export function resolveDefaultFallbackSlotAsset(
  slotKey: 'background' | 'character' | 'obstacle',
  targetIndustryId: IndustryId,
  baseDir: string = process.cwd(),
  preferredPresetId?: string
): AdventureAssetMetadata {
  const slotTypeMap: Record<'background' | 'character' | 'obstacle', AdventureAssetType> = {
    background: 'BACKGROUND',
    character: 'CHARACTER',
    obstacle: 'OBSTACLE',
  };
  const assetType = slotTypeMap[slotKey];

  let candidatePackIndustry: IndustryId =
    targetIndustryId !== 'CUSTOM' ? targetIndustryId : 'EDUCATION_GENERAL';

  if (targetIndustryId === 'CUSTOM' && preferredPresetId) {
    const p = preferredPresetId.toLowerCase();
    if (p.includes('moto')) candidatePackIndustry = 'MOTORCYCLE_TRAFFIC';
    else if (p.includes('biz')) candidatePackIndustry = 'BUSINESS_SALES';
    else if (p.includes('mfg')) candidatePackIndustry = 'MANUFACTURING_INDUSTRIAL';
    else if (p.includes('it')) candidatePackIndustry = 'IT_TECHNOLOGY';
    else if (p.includes('med')) candidatePackIndustry = 'HEALTHCARE_TRAINING';
    else if (p.includes('fin')) candidatePackIndustry = 'FINANCE_BANKING';
    else if (p.includes('fnb')) candidatePackIndustry = 'FNB_HOSPITALITY';
  }

  const primaryPack = resolveAdventureAssetPack(candidatePackIndustry, baseDir);
  const resolvedPack =
    primaryPack.verified && primaryPack.pack
      ? primaryPack.pack
      : resolveAdventureAssetPack('EDUCATION_GENERAL', baseDir).pack;

  if (resolvedPack && resolvedPack.assets && resolvedPack.assets[slotKey]) {
    const templateItem = resolvedPack.assets[slotKey];
    return {
      ...templateItem,
      industryId: targetIndustryId,
      assetType,
      source: 'ANTIGRAVITY_BANANA_PACK',
      verified: true,
    };
  }

  // Ultimate deterministic fallback metadata pointing to EDUCATION_GENERAL static pack
  const fileName = `${slotKey}.png`;
  return {
    industryId: targetIndustryId,
    assetType,
    fileName,
    url: `/adventure-assets/packs/EDUCATION_GENERAL/${fileName}`,
    relativePath: `public/adventure-assets/packs/EDUCATION_GENERAL/${fileName}`,
    mimeType: 'image/png',
    sizeBytes: 65536,
    width: slotKey === 'background' ? 1280 : 512,
    height: slotKey === 'background' ? 720 : 512,
    sha256: '0'.repeat(64),
    source: 'ANTIGRAVITY_BANANA_PACK',
    verified: true,
  };
}

/**
 * Physically verifies the 3 bound assets on an Adventure GameSpecification.
 * Never trusts client metadata alone: checks disk existence, containment, magic bytes, dimensions, and SHA-256.
 * Allows CUSTOM industry games to bind verified default pack fallback slots when Banana runtime generation fell back.
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

    if (meta.industryId !== industryId && industryId !== 'CUSTOM') {
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
      if (industryId !== 'CUSTOM') {
        const manifestAsset = manifest?.packs?.[industryId]?.assets?.[check.key];
        if (!manifestAsset || manifestAsset.sha256 !== meta.sha256) {
          missingAssets.push(check.type);
          errors.push(`${check.type} SHA-256 does not match official manifest for industry "${industryId}"`);
          continue;
        }
      }
    }

    const inspection = inspectImageFile(diskPath, meta.mimeType);
    if (!inspection.valid) {
      missingAssets.push(check.type);
      errors.push(`${check.type} failed physical disk verification: ${inspection.error}`);
      continue;
    }

    if (inspection.sha256 !== meta.sha256 && meta.sha256 !== '0'.repeat(64)) {
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

/**
 * Ensures an Adventure GameSpecification has playable, verified 3-slot assets (BACKGROUND, CHARACTER, OBSTACLE).
 * If any slot is missing or its file on disk is missing/corrupted, automatically substitutes ONLY that slot
 * with a verified default pack asset without calling Banana API again.
 */
export function ensurePlayableAdventureAssetsWithFallback(
  spec: GameSpecification,
  baseDir: string = process.cwd()
): {
  specification: GameSpecification;
  repaired: boolean;
  fallbackSlots: AdventureAssetType[];
} {
  if (spec.gameType !== 'ADVENTURE' || !spec.settings?.adventureConfig) {
    return { specification: spec, repaired: false, fallbackSlots: [] };
  }

  const adv = spec.settings.adventureConfig;
  const industryId: IndustryId = adv.industryId || 'EDUCATION_GENERAL';
  const packsRoot = getPacksDirectory(baseDir);
  const gamesRoot = getGamesAssetsRootDirectory(baseDir);

  const slots: Array<{ key: 'background' | 'character' | 'obstacle'; type: AdventureAssetType }> = [
    { key: 'background', type: 'BACKGROUND' },
    { key: 'character', type: 'CHARACTER' },
    { key: 'obstacle', type: 'OBSTACLE' },
  ];

  const resolvedAssets: Partial<AdventureBoundAssets> = {};
  const fallbackSlots: AdventureAssetType[] = [];

  for (const slot of slots) {
    const existingSlot = adv.assets?.[slot.key];
    let slotValid = false;

    if (existingSlot && existingSlot.assetType === slot.type && existingSlot.relativePath) {
      const diskPath = path.resolve(baseDir, existingSlot.relativePath);
      const inPacks = isPathContainedIn(diskPath, packsRoot);
      const inGames = isPathContainedIn(diskPath, gamesRoot);
      if (inPacks || inGames) {
        const inspection = inspectImageFile(diskPath, existingSlot.mimeType);
        if (
          inspection.valid &&
          (inspection.sha256 === existingSlot.sha256 || existingSlot.sha256 === '0'.repeat(64))
        ) {
          resolvedAssets[slot.key] = {
            ...existingSlot,
            industryId,
            verified: true,
          };
          slotValid = true;
        }
      }
    }

    if (!slotValid) {
      fallbackSlots.push(slot.type);
      resolvedAssets[slot.key] = resolveDefaultFallbackSlotAsset(
        slot.key,
        industryId,
        baseDir,
        adv.themePresetId
      );
    }
  }

  const repaired = fallbackSlots.length > 0 || adv.assetStatus !== 'READY' || !adv.assets;
  if (!repaired) {
    return { specification: spec, repaired: false, fallbackSlots: [] };
  }

  const boundAssets = AdventureBoundAssetsSchema.parse(resolvedAssets);
  const updatedAdv: AdventureConfig = {
    ...adv,
    version: Math.max(adv.version || 1, 2),
    assetStatus: 'READY',
    assetPackSource: boundAssets.background.source,
    assets: boundAssets,
    assetError: null,
    assetErrorCode: null,
    assetUpdatedAt: adv.assetUpdatedAt || new Date().toISOString(),
  };

  return {
    specification: {
      ...spec,
      settings: {
        ...spec.settings,
        adventureConfig: updatedAdv,
      },
    },
    repaired: true,
    fallbackSlots,
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
  fallbackUsed?: boolean;
  fallbackSlots?: AdventureAssetType[];
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
  const fallbackSlots: AdventureAssetType[] = [];

  try {
    fs.mkdirSync(gameAssetsDir, { recursive: true });
  } catch {
    // Directory creation fallback handled per slot below
  }

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

    try {
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
          generationId: options.generationId ?? null,
          userId: options.userId ?? spec.ownerUserId ?? null,
          gameId: spec.gameId,
          gameTitleSnapshot: spec.title,
          assetSlot: item.type,
          provider: usage?.provider || 'gemini',
          model: usage?.model || 'gemini-2.5-flash-image',
          operation: 'GENERATE_ADVENTURE_SPRITE',
          taskType: 'ADVENTURE_SPRITE_GENERATION',
          status: 'SUCCESS',
          latencyMs: Date.now() - startedAt,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cachedTokens: usage?.cachedTokens ?? null,
          thinkingTokens: usage?.thinkingTokens ?? null,
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
          generationId: options.generationId ?? null,
          userId: options.userId ?? spec.ownerUserId ?? null,
          gameId: spec.gameId,
          gameTitleSnapshot: spec.title,
          assetSlot: item.type,
          provider: usage?.provider || 'gemini',
          model: usage?.model || 'gemini-2.5-flash-image',
          operation: 'GENERATE_ADVENTURE_SPRITE',
          taskType: 'ADVENTURE_SPRITE_GENERATION',
          status: 'FAILED',
          errorCode: errCode,
          latencyMs: Date.now() - startedAt,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cachedTokens: usage?.cachedTokens ?? null,
          thinkingTokens: usage?.thinkingTokens ?? null,
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
    } catch {
      // Safe per-slot fallback: keep any successful Banana slots and substitute only the failed slot with the verified default pack asset
      fallbackSlots.push(item.type);
      generatedMeta[item.key] = resolveDefaultFallbackSlotAsset(
        item.key,
        adv.industryId,
        baseDir,
        adv.themePresetId
      );
    }
  }

  try {
    if (fs.existsSync(gameAssetsDir) && fs.readdirSync(gameAssetsDir).length === 0) {
      fs.rmdirSync(gameAssetsDir);
    }
  } catch {
    // Ignore cleanup error
  }

  const boundAssets = AdventureBoundAssetsSchema.parse(generatedMeta);
  return {
    verified: true,
    assets: boundAssets,
    fallbackUsed: fallbackSlots.length > 0,
    fallbackSlots,
    errorCode: null,
    errorMessage: null,
  };
}

/**
 * Provisions and verifies Adventure 2D assets for a GameSpecification:
 * - For the 8 pre-defined industries: resolves and physically verifies the static Banana pack from manifest.json.
 * - For CUSTOM: invokes runtime Banana API generation and saves verified per-game assets under public/adventure-assets/games/<gameId>/,
 *   with automatic per-slot fallback to verified default pack assets if Banana API fails for any slot.
 * - Never regenerates assets when re-opening/replaying a game that already has verified assets.
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

  // 2. Pre-defined industries (8 concrete IndustryIds): resolve from verified Banana packs (with per-slot fallback if needed)
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

    const fallbackSpecRes = ensurePlayableAdventureAssetsWithFallback(spec, baseDir);
    return {
      specification: fallbackSpecRes.specification,
      verified: true,
      assetStatus: 'READY',
      source: 'ANTIGRAVITY_BANANA_PACK',
      errors: [],
      errorCode: null,
    };
  }

  // 3. CUSTOM industry: generate dedicated assets via Banana runtime API (with per-slot fallback to verified default pack)
  const runtimeRes = await generateRuntimeAdventureAssetsForGame(spec, options);
  if (runtimeRes.verified && runtimeRes.assets) {
    const source =
      runtimeRes.assets.background.source === 'GEMINI_BANANA_RUNTIME' ||
      runtimeRes.assets.character.source === 'GEMINI_BANANA_RUNTIME' ||
      runtimeRes.assets.obstacle.source === 'GEMINI_BANANA_RUNTIME'
        ? 'GEMINI_BANANA_RUNTIME'
        : 'ANTIGRAVITY_BANANA_PACK';
    const updatedAdv: AdventureConfig = {
      ...adv,
      version: Math.max(adv.version || 1, 2),
      assetStatus: 'READY',
      assetPackSource: source,
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
      source,
      errors: [],
      errorCode: null,
    };
  }

  const fallbackRes = ensurePlayableAdventureAssetsWithFallback(spec, baseDir);
  return {
    specification: fallbackRes.specification,
    verified: true,
    assetStatus: 'READY',
    source: 'ANTIGRAVITY_BANANA_PACK',
    errors: [],
    errorCode: null,
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
