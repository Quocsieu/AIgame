import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDefaultAdventureConfig,
  syncAdventureStagesWithQuestions,
} from '../config/adventureThemes.js';
import type {
  AdventureAssetMetadata,
  AdventureConfig,
  GameQuestion,
  GameSpecification,
  IndustryId,
  PracticeFinalResult,
  PracticeQuestionResult,
  SanitizedQuestion,
} from '../types/index.js';

export type AdventureAssetItem = AdventureAssetMetadata;

export const ADVENTURE_START_INSTRUCTION =
  'Nhân vật tự chạy. Chạm màn hình hoặc nhấn Space để nhảy. Trả lời câu hỏi tại checkpoint để đi tiếp.';

const KNOWN_CONCRETE_INDUSTRIES: ReadonlySet<IndustryId> = new Set<IndustryId>([
  'MOTORCYCLE_TRAFFIC',
  'BUSINESS_SALES',
  'MANUFACTURING_INDUSTRIAL',
  'IT_TECHNOLOGY',
  'HEALTHCARE_TRAINING',
  'FINANCE_BANKING',
  'FNB_HOSPITALITY',
  'EDUCATION_GENERAL',
]);

export type JumpState = 'GROUNDED' | 'JUMPING' | 'LANDING';

export interface ResolvedAdventureEngineAssets {
  valid: boolean;
  isLegacyFallback: boolean;
  industryId: IndustryId;
  errorCode: string | null;
  errorMessage: string | null;
  missingOrInvalidAssets: Array<'BACKGROUND' | 'CHARACTER' | 'OBSTACLE'>;
  assets: {
    background: AdventureAssetItem;
    character: AdventureAssetItem;
    obstacle: AdventureAssetItem;
  } | null;
}

function isSafeAssetUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\') || /\s/.test(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith('/adventure-assets/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:image/')
  );
}

/**
 * Validates and resolves the 3 required 2D Adventure image assets (background, character, obstacle).
 * Strictly forbids cross-industry fallback (e.g. never uses MOTORCYCLE_TRAFFIC assets for another industry).
 */
export function resolveAdventureRuntimeAssets(
  config: AdventureConfig
): ResolvedAdventureEngineAssets {
  const industryId = config.industryId;

  if (
    config.assetStatus === 'ASSET_GENERATION_FAILED' ||
    config.assetStatus === 'ASSET_GENERATION_PENDING'
  ) {
    return {
      valid: false,
      isLegacyFallback: false,
      industryId,
      errorCode: config.assetErrorCode || 'ADVENTURE_ASSETS_NOT_READY',
      errorMessage:
        config.assetError ||
        `Tài nguyên hình ảnh 2D cho ngành "${config.industryLabel || industryId}" chưa sẵn sàng hoặc tạo thất bại.`,
      missingOrInvalidAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      assets: null,
    };
  }

  if (config.assets) {
    const rawBg = config.assets.background;
    const rawChar = config.assets.character;
    const rawObs = config.assets.obstacle;

    const missingOrInvalid: Array<'BACKGROUND' | 'CHARACTER' | 'OBSTACLE'> = [];
    const mismatchErrors: string[] = [];

    const checkSlot = (
      item: AdventureAssetItem | undefined,
      expectedType: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE'
    ) => {
      if (!item || !isSafeAssetUrl(item.url) || item.verified === false) {
        missingOrInvalid.push(expectedType);
        return;
      }
      if (item.assetType !== expectedType) {
        missingOrInvalid.push(expectedType);
        return;
      }
      if (item.industryId !== industryId) {
        missingOrInvalid.push(expectedType);
        mismatchErrors.push(
          `Tài nguyên ${expectedType} thuộc ngành "${item.industryId}" không khớp với ngành của game ("${industryId}").`
        );
      }
    };

    checkSlot(rawBg, 'BACKGROUND');
    checkSlot(rawChar, 'CHARACTER');
    checkSlot(rawObs, 'OBSTACLE');

    if (missingOrInvalid.length > 0) {
      const isCrossIndustry = mismatchErrors.length > 0;
      return {
        valid: false,
        isLegacyFallback: false,
        industryId,
        errorCode: isCrossIndustry ? 'CROSS_INDUSTRY_ASSET_MISMATCH' : 'INVALID_ADVENTURE_ASSETS',
        errorMessage: isCrossIndustry
          ? mismatchErrors.join(' ')
          : `Thiếu hoặc không hợp lệ các tài nguyên hình ảnh bắt buộc: ${missingOrInvalid.join(', ')}.`,
        missingOrInvalidAssets: missingOrInvalid,
        assets: null,
      };
    }

    return {
      valid: true,
      isLegacyFallback: false,
      industryId,
      errorCode: null,
      errorMessage: null,
      missingOrInvalidAssets: [],
      assets: {
        background: rawBg,
        character: rawChar,
        obstacle: rawObs,
      },
    };
  }

  // No assets object bound on config:
  // If this is a Phase 3+ game (version >= 2, assetStatus present, or CUSTOM industry), block gameplay!
  const isPhase3OrCustom =
    industryId === 'CUSTOM' ||
    (config.version ?? 1) >= 2 ||
    config.assetStatus !== undefined;

  if (isPhase3OrCustom) {
    return {
      valid: false,
      isLegacyFallback: false,
      industryId,
      errorCode: 'MISSING_ADVENTURE_ASSETS',
      errorMessage: `Game Adventure ngành "${config.industryLabel || industryId}" thiếu bộ 3 tài nguyên hình ảnh bắt buộc (background, character, obstacle).`,
      missingOrInvalidAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
      assets: null,
    };
  }

  // Legacy v1 Adventure game created before Phase 3: resolve its own industry's verified static pack
  if (KNOWN_CONCRETE_INDUSTRIES.has(industryId)) {
    const basePackPath = `/adventure-assets/packs/${industryId}`;
    const relPackPath = `adventure-assets/packs/${industryId}`;
    return {
      valid: true,
      isLegacyFallback: true,
      industryId,
      errorCode: null,
      errorMessage: null,
      missingOrInvalidAssets: [],
      assets: {
        background: {
          assetType: 'BACKGROUND',
          industryId,
          fileName: 'background.png',
          url: `${basePackPath}/background.png`,
          relativePath: `${relPackPath}/background.png`,
          mimeType: 'image/png',
          sizeBytes: 1,
          width: 1376,
          height: 768,
          sha256: 'legacy-pack-bg',
          source: 'ANTIGRAVITY_BANANA_PACK',
          verified: true,
        },
        character: {
          assetType: 'CHARACTER',
          industryId,
          fileName: 'character.png',
          url: `${basePackPath}/character.png`,
          relativePath: `${relPackPath}/character.png`,
          mimeType: 'image/png',
          sizeBytes: 1,
          width: 1024,
          height: 1024,
          sha256: 'legacy-pack-char',
          source: 'ANTIGRAVITY_BANANA_PACK',
          verified: true,
        },
        obstacle: {
          assetType: 'OBSTACLE',
          industryId,
          fileName: 'obstacle.png',
          url: `${basePackPath}/obstacle.png`,
          relativePath: `${relPackPath}/obstacle.png`,
          mimeType: 'image/png',
          sizeBytes: 1,
          width: 1024,
          height: 1024,
          sha256: 'legacy-pack-obs',
          source: 'ANTIGRAVITY_BANANA_PACK',
          verified: true,
        },
      },
    };
  }

  return {
    valid: false,
    isLegacyFallback: false,
    industryId,
    errorCode: 'UNKNOWN_INDUSTRY_PACK',
    errorMessage: `Không tìm thấy gói tài nguyên hình ảnh hợp lệ cho ngành "${industryId}".`,
    missingOrInvalidAssets: ['BACKGROUND', 'CHARACTER', 'OBSTACLE'],
    assets: null,
  };
}

export interface RunnerObstacleInstance {
  id: string;
  x: number;
  width: number;
  height: number;
  stageIndex: number;
  cleared: boolean;
  hitCooldown: number;
}

export interface AdventureRunnerPhysicsState {
  playerX: number;
  playerY: number; // 0 = grounded on road surface, negative = airborne height above ground
  vx: number;
  vy: number;
  isGrounded: boolean;
  jumpState: JumpState;
  cameraX: number;
  obstacles: RunnerObstacleInstance[];
  checkpointPositions: number[];
  finishLineX: number;
  unlockedStageCount: number;
  activeStageIndex: number;
  isAtCheckpoint: boolean;
  isFinished: boolean;
  hitFlashTimer: number;
  obstaclesCleared: number;
  obstacleHits: number;
}

export const RUNNER_START_X = 140;
export const RUNNER_STAGE_SEGMENT_LENGTH = 900;
export const RUNNER_BASE_SPEED = 290;
export const RUNNER_JUMP_VELOCITY = -640;
export const RUNNER_GRAVITY = 1580;
export const RUNNER_CHECKPOINT_STOP_OFFSET = 28;
export const RUNNER_MAX_FRAME_DT = 0.033;

export function createInitialRunnerPhysicsState(params: {
  totalStages: number;
  obstacleDensity?: 'LOW' | 'MEDIUM' | 'HIGH';
  initialUnlockedStages?: number;
}): AdventureRunnerPhysicsState {
  const totalStages = Math.max(1, params.totalStages);
  const density = params.obstacleDensity || 'MEDIUM';
  const checkpointPositions: number[] = [];
  const obstacles: RunnerObstacleInstance[] = [];

  for (let idx = 0; idx < totalStages; idx++) {
    const cpX = (idx + 1) * RUNNER_STAGE_SEGMENT_LENGTH;
    checkpointPositions.push(cpX);

    const segStart = idx === 0 ? RUNNER_START_X : checkpointPositions[idx - 1];
    // Guaranteed minimum >= 280px spacing between obstacles and safe buffers from start/checkpoint
    const obsPositions =
      density === 'LOW'
        ? [segStart + 380]
        : [segStart + 290, segStart + 590];

    obsPositions.forEach((ox, oIdx) => {
      if (ox < cpX - 220) {
        obstacles.push({
          id: `obs_${idx}_${oIdx}`,
          x: ox,
          width: 58,
          height: 58,
          stageIndex: idx,
          cleared: false,
          hitCooldown: 0,
        });
      }
    });
  }

  const finishLineX = totalStages * RUNNER_STAGE_SEGMENT_LENGTH + 340;
  const unlockedStageCount = Math.max(
    0,
    Math.min(totalStages, params.initialUnlockedStages ?? 0)
  );
  const startX =
    unlockedStageCount > 0 && checkpointPositions[unlockedStageCount - 1] !== undefined
      ? checkpointPositions[unlockedStageCount - 1] + 36
      : RUNNER_START_X;

  for (const obs of obstacles) {
    if (obs.x < startX) {
      obs.cleared = true;
    }
  }

  return {
    playerX: startX,
    playerY: 0,
    vx: 0,
    vy: 0,
    isGrounded: true,
    jumpState: 'GROUNDED',
    cameraX: Math.max(0, startX - 180),
    obstacles,
    checkpointPositions,
    finishLineX,
    unlockedStageCount,
    activeStageIndex: Math.min(unlockedStageCount, totalStages - 1),
    isAtCheckpoint: false,
    isFinished: false,
    hitFlashTimer: 0,
    obstaclesCleared: 0,
    obstacleHits: 0,
  };
}

/**
 * Initiates a jump ONLY if the character is currently grounded and controls are unlocked.
 * Prevents mid-air double/infinite jumping and blocks jumping while a checkpoint modal is open.
 */
export function triggerRunnerJump(
  state: AdventureRunnerPhysicsState,
  canControl: boolean
): boolean {
  if (!canControl) return false;
  if (state.isAtCheckpoint || state.isFinished) return false;
  if (!state.isGrounded || state.jumpState !== 'GROUNDED' || state.playerY < -0.5) {
    return false;
  }

  state.vy = RUNNER_JUMP_VELOCITY;
  state.isGrounded = false;
  state.jumpState = 'JUMPING';
  return true;
}

export interface StepRunnerPhysicsOptions {
  canMove: boolean;
  speedMultiplier?: number;
  playerAnchorScreenX?: number;
}

export interface StepRunnerPhysicsEvents {
  reachedCheckpointIndex: number | null;
  reachedFinish: boolean;
  collidedObstacleIds: string[];
  newlyClearedCount: number;
}

/**
 * Advances the 2D side-scrolling runner physics by a clamped delta time.
 * When `canMove` is false (paused, modal open, tab hidden, or before start), all movement is frozen.
 */
export function stepAdventureRunnerPhysics(
  state: AdventureRunnerPhysicsState,
  rawDt: number,
  options: StepRunnerPhysicsOptions
): StepRunnerPhysicsEvents {
  const events: StepRunnerPhysicsEvents = {
    reachedCheckpointIndex: null,
    reachedFinish: false,
    collidedObstacleIds: [],
    newlyClearedCount: 0,
  };

  const dt = Math.min(RUNNER_MAX_FRAME_DT, Math.max(0, Number.isFinite(rawDt) ? rawDt : 0));
  const anchorX = options.playerAnchorScreenX ?? 180;

  if (!options.canMove || state.isFinished || state.isAtCheckpoint || dt <= 0) {
    state.vx = 0;
    state.cameraX = Math.max(0, state.playerX - anchorX);
    return events;
  }

  const speedMult = Math.max(0.75, Math.min(1.5, options.speedMultiplier ?? 1));
  const targetSpeed = RUNNER_BASE_SPEED * speedMult;

  if (state.hitFlashTimer > 0) {
    state.hitFlashTimer = Math.max(0, state.hitFlashTimer - dt);
  }

  const effectiveSpeed = state.hitFlashTimer > 0.15 ? targetSpeed * 0.55 : targetSpeed;
  state.vx = effectiveSpeed;
  state.playerX += state.vx * dt;

  // Vertical jump & gravity state machine: GROUNDED -> JUMPING -> LANDING -> GROUNDED
  if (!state.isGrounded || state.playerY < 0 || state.vy !== 0) {
    state.vy += RUNNER_GRAVITY * dt;
    state.playerY += state.vy * dt;

    if (state.vy >= 0 && state.playerY < 0) {
      state.jumpState = 'LANDING';
    }

    if (state.playerY >= 0) {
      state.playerY = 0;
      state.vy = 0;
      state.isGrounded = true;
      state.jumpState = 'GROUNDED';
    }
  } else {
    state.playerY = 0;
    state.vy = 0;
    state.isGrounded = true;
    state.jumpState = 'GROUNDED';
  }

  // Check checkpoint stop BEFORE allowing player to pass locked checkpoint
  const nextCheckpointIdx = state.unlockedStageCount;
  if (nextCheckpointIdx < state.checkpointPositions.length) {
    const checkpointStopX =
      state.checkpointPositions[nextCheckpointIdx] - RUNNER_CHECKPOINT_STOP_OFFSET;
    if (state.playerX >= checkpointStopX) {
      state.playerX = checkpointStopX;
      state.playerY = 0;
      state.vx = 0;
      state.vy = 0;
      state.isGrounded = true;
      state.jumpState = 'GROUNDED';
      state.isAtCheckpoint = true;
      state.activeStageIndex = nextCheckpointIdx;
      state.cameraX = Math.max(0, state.playerX - anchorX);
      events.reachedCheckpointIndex = nextCheckpointIdx;
      return events;
    }
  } else if (state.playerX >= state.finishLineX) {
    state.playerX = state.finishLineX;
    state.playerY = 0;
    state.vx = 0;
    state.vy = 0;
    state.isGrounded = true;
    state.jumpState = 'GROUNDED';
    state.isFinished = true;
    state.cameraX = Math.max(0, state.playerX - anchorX);
    events.reachedFinish = true;
    return events;
  }

  // Obstacle AABB collision & clearance
  const pLeft = state.playerX - 18;
  const pRight = state.playerX + 18;
  const pBottom = state.playerY; // 0 when on ground, negative when jumping

  for (const obs of state.obstacles) {
    if (obs.hitCooldown > 0) {
      obs.hitCooldown = Math.max(0, obs.hitCooldown - dt);
    }

    const halfW = obs.width * 0.36;
    const oLeft = obs.x - halfW;
    const oRight = obs.x + halfW;
    const oTop = -obs.height * 0.78;

    if (pRight > oLeft && pLeft < oRight && pBottom > oTop) {
      if (obs.hitCooldown <= 0) {
        obs.hitCooldown = 0.85;
        state.hitFlashTimer = 0.4;
        state.obstacleHits += 1;
        events.collidedObstacleIds.push(obs.id);
      }
    }

    if (!obs.cleared && state.playerX > obs.x + halfW + 10) {
      obs.cleared = true;
      if (obs.hitCooldown <= 0) {
        state.obstaclesCleared += 1;
        events.newlyClearedCount += 1;
      }
    }
  }

  state.cameraX = Math.max(0, state.playerX - anchorX);
  return events;
}

export function normalizeCrosswordAnswerForRunner(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, m => (m === 'đ' ? 'd' : 'D'))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function evaluateRunnerPreviewAnswer(
  q: GameQuestion | SanitizedQuestion,
  rawSubmitted: string
): boolean {
  const submitted = rawSubmitted.trim().toLowerCase();
  const fullQ = q as Partial<GameQuestion>;
  const expected = (fullQ.correctAnswer || '').trim().toLowerCase();
  if (!submitted) return false;

  if (q.type === 'SLIDER' && q.sliderConfig) {
    const numVal = Number(rawSubmitted.trim());
    if (!Number.isFinite(numVal)) return false;
    const sliderCfg = q.sliderConfig as Partial<NonNullable<GameQuestion['sliderConfig']>>;
    const tolerance = Math.max(0, Number(sliderCfg.tolerance) || 0);
    return Math.abs(numVal - Number(sliderCfg.correctValue)) <= tolerance + 1e-6;
  }

  if (q.type === 'CROSSWORD') {
    const normSubmitted = normalizeCrosswordAnswerForRunner(rawSubmitted);
    const normExpected = normalizeCrosswordAnswerForRunner(
      fullQ.crosswordAnswer || fullQ.correctAnswer || ''
    );
    if (!normSubmitted || !normExpected) return false;
    if (normSubmitted === normExpected) return true;
    if (
      Array.isArray(fullQ.acceptedAlternatives) &&
      fullQ.acceptedAlternatives.some(
        alt => normalizeCrosswordAnswerForRunner(alt) === normSubmitted
      )
    ) {
      return true;
    }
    return false;
  }

  if (submitted === expected) return true;
  if (
    Array.isArray(fullQ.acceptedAlternatives) &&
    fullQ.acceptedAlternatives.some(alt => alt.trim().toLowerCase() === submitted)
  ) {
    return true;
  }

  if ((q.type === 'MULTIPLE_CHOICE' || q.type === 'QUIZ') && Array.isArray(q.choices)) {
    const letters = ['a', 'b', 'c', 'd'];
    const letterIdx = letters.indexOf(submitted);
    if (letterIdx >= 0 && q.choices[letterIdx]) {
      return q.choices[letterIdx].trim().toLowerCase() === expected;
    }
  }

  return false;
}

interface ProcessedSprite {
  source: CanvasImageSource;
  width: number;
  height: number;
  aspectRatio: number;
}

const processedSpriteCache = new Map<string, ProcessedSprite>();

/**
 * Removes contiguous studio white/light background from 1:1 sprites once on load
 * and crops transparent padding so the bottom of the character/obstacle aligns flush with the road.
 */
function prepareCleanSprite(
  img: HTMLImageElement,
  isBackground: boolean,
  cacheKey?: string
): ProcessedSprite {
  if (cacheKey && processedSpriteCache.has(cacheKey)) {
    return processedSpriteCache.get(cacheKey)!;
  }

  const natW = Math.max(1, img.naturalWidth || img.width || 512);
  const natH = Math.max(1, img.naturalHeight || img.height || 512);

  if (isBackground || typeof document === 'undefined') {
    const bgSprite: ProcessedSprite = {
      source: img,
      width: natW,
      height: natH,
      aspectRatio: natW / natH,
    };
    if (cacheKey) processedSpriteCache.set(cacheKey, bgSprite);
    return bgSprite;
  }

  try {
    const workSize = 256;
    const canvas = document.createElement('canvas');
    canvas.width = workSize;
    canvas.height = workSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { source: img, width: natW, height: natH, aspectRatio: natW / natH };
    }

    ctx.drawImage(img, 0, 0, workSize, workSize);
    const imgData = ctx.getImageData(0, 0, workSize, workSize);
    const data = imgData.data;

    // Sample corner pixels to detect solid studio background
    const corners = [
      0,
      (workSize - 1) * 4,
      (workSize * (workSize - 1)) * 4,
      (workSize * workSize - 1) * 4,
    ];
    let cornerAlphaSum = 0;
    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    for (const c of corners) {
      bgR += data[c];
      bgG += data[c + 1];
      bgB += data[c + 2];
      cornerAlphaSum += data[c + 3];
    }
    bgR /= 4;
    bgG /= 4;
    bgB /= 4;
    const avgCornerAlpha = cornerAlphaSum / 4;

    if (avgCornerAlpha > 30) {
      // Flood-fill from all 4 borders where color matches the corner background
      const visited = new Uint8Array(workSize * workSize);
      const queue = new Int32Array(workSize * workSize);
      let head = 0;
      let tail = 0;

      const isBgMatch = (pixelIdx: number): boolean => {
        const i = pixelIdx * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 25) return true;
        const dr = r - bgR;
        const dg = g - bgG;
        const db = b - bgB;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq <= 46 * 46) return true;
        // Also match bright neutral studio backdrop near borders
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        return minC >= 230 && maxC - minC <= 20;
      };

      const pushIfBg = (x: number, y: number) => {
        const idx = y * workSize + x;
        if (visited[idx]) return;
        if (isBgMatch(idx)) {
          visited[idx] = 1;
          queue[tail++] = idx;
        }
      };

      for (let x = 0; x < workSize; x++) {
        pushIfBg(x, 0);
        pushIfBg(x, workSize - 1);
      }
      for (let y = 0; y < workSize; y++) {
        pushIfBg(0, y);
        pushIfBg(workSize - 1, y);
      }

      while (head < tail) {
        const curr = queue[head++];
        data[curr * 4 + 3] = 0;
        const cx = curr % workSize;
        const cy = (curr / workSize) | 0;

        if (cx > 0) pushIfBg(cx - 1, cy);
        if (cx + 1 < workSize) pushIfBg(cx + 1, cy);
        if (cy > 0) pushIfBg(cx, cy - 1);
        if (cy + 1 < workSize) pushIfBg(cx, cy + 1);
      }

      // Soften 1px silhouette edge
      for (let y = 1; y < workSize - 1; y++) {
        for (let x = 1; x < workSize - 1; x++) {
          const idx = y * workSize + x;
          if (visited[idx]) continue;
          const neighborsBg =
            visited[idx - 1] +
            visited[idx + 1] +
            visited[idx - workSize] +
            visited[idx + workSize];
          if (neighborsBg > 0) {
            const aIdx = idx * 4 + 3;
            data[aIdx] = Math.min(data[aIdx], neighborsBg >= 2 ? 120 : 190);
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
    }

    // Find tight non-transparent bounding box so feet/wheels touch ground line directly
    let minX = workSize;
    let minY = workSize;
    let maxX = 0;
    let maxY = 0;
    let foundOpaque = false;

    for (let y = 0; y < workSize; y++) {
      for (let x = 0; x < workSize; x++) {
        const a = data[(y * workSize + x) * 4 + 3];
        if (a > 40) {
          foundOpaque = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!foundOpaque || maxX <= minX || maxY <= minY) {
      return { source: img, width: natW, height: natH, aspectRatio: natW / natH };
    }

    const pad = 2;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(workSize - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(workSize - cropY, maxY - minY + 1 + pad); // tight bottom edge!

    const outCanvas = document.createElement('canvas');
    outCanvas.width = cropW;
    outCanvas.height = cropH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      return { source: canvas, width: workSize, height: workSize, aspectRatio: 1 };
    }
    outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const processed: ProcessedSprite = {
      source: outCanvas,
      width: cropW,
      height: cropH,
      aspectRatio: cropW / Math.max(1, cropH),
    };
    if (cacheKey) processedSpriteCache.set(cacheKey, processed);
    return processed;
  } catch {
    const fallback: ProcessedSprite = {
      source: img,
      width: natW,
      height: natH,
      aspectRatio: natW / natH,
    };
    if (cacheKey) processedSpriteCache.set(cacheKey, fallback);
    return fallback;
  }
}

export interface AdventureGameEngineProps {
  game: GameSpecification;
  adventureConfig?: AdventureConfig;
  mode: 'CREATOR_PREVIEW' | 'LIVE_SESSION';
  sessionStarted?: boolean;
  startingSession?: boolean;
  onStartSession?: () => Promise<void> | void;
  currentQuestion?: GameQuestion | SanitizedQuestion | null;
  currentQuestionIndex?: number;
  totalQuestions?: number;
  timeRemaining?: number;
  liveScore?: number;
  liveStreak?: number;
  liveCorrectCount?: number;
  liveWrongCount?: number;
  questionFeedback?: PracticeQuestionResult | null;
  lastAnswerResult?: {
    isCorrect: boolean;
    pointsEarned: number;
    correctAnswer: string;
    explanation: string;
    totalScore: number;
  } | null;
  submittingAnswer?: boolean;
  onSubmitAnswer?: (answer: string) => Promise<void> | void;
  onNextQuestion?: () => Promise<void> | void;
  isSessionFinished?: boolean;
  finalResult?: PracticeFinalResult | null;
  liveFinalResult?: {
    totalScore: number;
    correctAnswers: number;
    totalQuestions: number;
    accuracyPercentage?: number;
  } | null;
  onStartLiveSession?: () => Promise<void> | void;
  onSubmitLiveAnswer?: (answer: string) => Promise<void> | void;
  onNextLiveQuestion?: () => Promise<void> | void;
  onRestartSession?: () => Promise<void> | void;
  onRestartLiveSession?: () => Promise<void> | void;
  onExit: () => void;
  onOpenConfigTab?: () => void;
}

export const AdventureGameEngine: React.FC<AdventureGameEngineProps> = ({
  game,
  adventureConfig,
  mode,
  sessionStarted = false,
  startingSession = false,
  onStartSession,
  currentQuestion,
  currentQuestionIndex = 0,
  totalQuestions,
  liveScore = 0,
  liveCorrectCount = 0,
  questionFeedback = null,
  lastAnswerResult = null,
  submittingAnswer = false,
  onSubmitAnswer,
  onNextQuestion,
  isSessionFinished = false,
  finalResult = null,
  liveFinalResult = null,
  onStartLiveSession,
  onSubmitLiveAnswer,
  onNextLiveQuestion,
  onRestartSession,
  onRestartLiveSession,
  onExit,
}) => {
  const effectiveOnStartSession = onStartSession || onStartLiveSession;
  const effectiveOnSubmitAnswer = onSubmitAnswer || onSubmitLiveAnswer;
  const effectiveOnNextQuestion = onNextQuestion || onNextLiveQuestion;
  const effectiveOnRestartSession = onRestartSession || onRestartLiveSession;
  const effectiveLiveFeedback = questionFeedback || lastAnswerResult;
  const effectiveFinalResult = finalResult || liveFinalResult;
  const questions = useMemo(() => game.questions || [], [game.questions]);
  const totalStages = Math.max(1, totalQuestions || questions.length || 1);

  const effectiveConfig: AdventureConfig = useMemo(() => {
    const raw =
      adventureConfig ||
      game.settings?.adventureConfig ||
      buildDefaultAdventureConfig('theme_moto_circuit', questions.length || 5, questions);
    return syncAdventureStagesWithQuestions(raw, questions);
  }, [adventureConfig, game.settings?.adventureConfig, questions]);

  const resolvedAssets = useMemo(
    () => resolveAdventureRuntimeAssets(effectiveConfig),
    [effectiveConfig]
  );

  // Asset preloading state (never calls Banana API during gameplay or replay)
  const [assetLoadStatus, setAssetLoadStatus] = useState<'LOADING' | 'READY' | 'ERROR'>(() =>
    resolvedAssets.valid ? 'LOADING' : 'ERROR'
  );
  const [assetLoadError, setAssetLoadError] = useState<string | null>(() =>
    resolvedAssets.errorMessage
  );
  const [failedAssetSlots, setFailedAssetSlots] = useState<string[]>(() =>
    resolvedAssets.missingOrInvalidAssets
  );

  const loadedSpritesRef = useRef<{
    background: ProcessedSprite | null;
    character: ProcessedSprite | null;
    obstacle: ProcessedSprite | null;
  }>({
    background: null,
    character: null,
    obstacle: null,
  });

  // Preload the 3 verified image assets once per game config
  useEffect(() => {
    if (!resolvedAssets.valid || !resolvedAssets.assets) {
      setAssetLoadStatus('ERROR');
      setAssetLoadError(
        resolvedAssets.errorMessage ||
          'Thiếu tài nguyên hình ảnh bắt buộc cho game Adventure.'
      );
      setFailedAssetSlots(
        resolvedAssets.missingOrInvalidAssets.length > 0
          ? resolvedAssets.missingOrInvalidAssets
          : ['BACKGROUND', 'CHARACTER', 'OBSTACLE']
      );
      return;
    }

    const { background, character, obstacle } = resolvedAssets.assets;
    const cachedBg = processedSpriteCache.get(`bg:${background.url}`);
    const cachedChar = processedSpriteCache.get(`char:${character.url}`);
    const cachedObs = processedSpriteCache.get(`obs:${obstacle.url}`);
    if (cachedBg && cachedChar && cachedObs) {
      loadedSpritesRef.current = {
        background: cachedBg,
        character: cachedChar,
        obstacle: cachedObs,
      };
      setAssetLoadStatus('READY');
      setAssetLoadError(null);
      setFailedAssetSlots([]);
      return;
    }

    let cancelled = false;
    setAssetLoadStatus('LOADING');
    setAssetLoadError(null);
    setFailedAssetSlots([]);

    const loadSingleImage = (
      slotName: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE',
      url: string
    ): Promise<{ slotName: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE'; img: HTMLImageElement }> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if ((img.naturalWidth || img.width) > 0 && (img.naturalHeight || img.height) > 0) {
            resolve({ slotName, img });
          } else {
            reject({ slotName, url, reason: 'Ảnh có kích thước 0px' });
          }
        };
        img.onerror = () => {
          reject({ slotName, url, reason: 'Không thể tải URL ảnh' });
        };
        img.src = url;
      });

    Promise.allSettled([
      loadSingleImage('BACKGROUND', background.url),
      loadSingleImage('CHARACTER', character.url),
      loadSingleImage('OBSTACLE', obstacle.url),
    ]).then(results => {
      if (cancelled) return;

      const failed: string[] = [];
      let bgImg: HTMLImageElement | null = null;
      let charImg: HTMLImageElement | null = null;
      let obsImg: HTMLImageElement | null = null;

      for (const res of results) {
        if (res.status === 'fulfilled') {
          if (res.value.slotName === 'BACKGROUND') bgImg = res.value.img;
          if (res.value.slotName === 'CHARACTER') charImg = res.value.img;
          if (res.value.slotName === 'OBSTACLE') obsImg = res.value.img;
        } else {
          failed.push(String(res.reason?.slotName || 'UNKNOWN'));
        }
      }

      if (failed.length > 0 || !bgImg || !charImg || !obsImg) {
        setFailedAssetSlots(failed);
        setAssetLoadStatus('ERROR');
        setAssetLoadError(
          `Không thể tải tài nguyên ảnh 2D (${failed.join(', ')}) cho ngành "${effectiveConfig.industryLabel}". Không tự động thay bằng ảnh ngành khác.`
        );
        return;
      }

      loadedSpritesRef.current = {
        background: prepareCleanSprite(bgImg, true, `bg:${background.url}`),
        character: prepareCleanSprite(charImg, false, `char:${character.url}`),
        obstacle: prepareCleanSprite(obsImg, false, `obs:${obstacle.url}`),
      };
      setAssetLoadStatus('READY');
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedAssets, effectiveConfig.industryLabel]);

  // Lock underlying page scroll while full-viewport Adventure engine is mounted
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  // Gameplay states
  const [isJourneyStarted, setIsJourneyStarted] = useState<boolean>(() => Boolean(sessionStarted));
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Sync when SoloPlayer transitions sessionStarted to true after initializeSession(true)
  useEffect(() => {
    if (sessionStarted) {
      setIsJourneyStarted(true);
    }
  }, [sessionStarted]);
  const [isTabHidden, setIsTabHidden] = useState<boolean>(false);
  const [activeStageIndex, setActiveStageIndex] = useState<number>(0);
  const [unlockedStageCount, setUnlockedStageCount] = useState<number>(0);
  const [checkpointModalOpen, setCheckpointModalOpen] = useState<boolean>(false);

  // Preview mode states (when creator previews without a live backend session)
  const [previewScore, setPreviewScore] = useState<number>(0);
  const [previewCorrectCount, setPreviewCorrectCount] = useState<number>(0);
  const [previewAnswerResult, setPreviewAnswerResult] = useState<{
    isCorrect: boolean;
    pointsEarned: number;
    correctAnswer: string;
    explanation: string;
  } | null>(null);
  const [previewFinished, setPreviewFinished] = useState<boolean>(false);

  // Question input states
  const [selectedChoice, setSelectedChoice] = useState<string>('');
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [puzzleOrder, setPuzzleOrder] = useState<string[]>([]);

  // Anti-duplicate submission guard per stage
  const submittedStageIndicesRef = useRef<Set<number>>(new Set());
  const submittingStageLockRef = useRef<boolean>(false);

  // HUD / Telemetry reactive snapshots
  const [journeyProgressPercent, setJourneyProgressPercent] = useState<number>(0);
  const [obstaclesClearedCount, setObstaclesClearedCount] = useState<number>(0);
  const [jumpStateSnapshot, setJumpStateSnapshot] = useState<JumpState>('GROUNDED');
  const [isGroundedSnapshot, setIsGroundedSnapshot] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const physicsRef = useRef<AdventureRunnerPhysicsState>(
    createInitialRunnerPhysicsState({
      totalStages,
      obstacleDensity: effectiveConfig.obstacleDensity,
      initialUnlockedStages: mode === 'LIVE_SESSION' ? currentQuestionIndex : 0,
    })
  );

  // Reset physics when gameId or stage count changes
  useEffect(() => {
    const initialUnlocked = mode === 'LIVE_SESSION' ? Math.max(0, currentQuestionIndex) : 0;
    physicsRef.current = createInitialRunnerPhysicsState({
      totalStages,
      obstacleDensity: effectiveConfig.obstacleDensity,
      initialUnlockedStages: initialUnlocked,
    });
    submittedStageIndicesRef.current.clear();
    submittingStageLockRef.current = false;
    setUnlockedStageCount(initialUnlocked);
    setActiveStageIndex(Math.min(initialUnlocked, totalStages - 1));
    setCheckpointModalOpen(false);
    setObstaclesClearedCount(0);
    setJumpStateSnapshot('GROUNDED');
    setIsGroundedSnapshot(true);
    setJourneyProgressPercent(
      Math.min(
        100,
        Math.round(
          (physicsRef.current.playerX / Math.max(1, physicsRef.current.finishLineX)) * 100
        )
      )
    );
  }, [game.gameId, totalStages, effectiveConfig.obstacleDensity]);

  // Synchronize live session progress (e.g., on page reload recovery in SoloPlayer)
  useEffect(() => {
    if (mode !== 'LIVE_SESSION') return;
    if (currentQuestionIndex > unlockedStageCount) {
      setUnlockedStageCount(currentQuestionIndex);
      setActiveStageIndex(Math.min(currentQuestionIndex, totalStages - 1));

      const p = physicsRef.current;
      p.unlockedStageCount = currentQuestionIndex;
      p.activeStageIndex = Math.min(currentQuestionIndex, totalStages - 1);
      const prevCpX =
        currentQuestionIndex > 0 ? p.checkpointPositions[currentQuestionIndex - 1] : undefined;
      if (prevCpX !== undefined && p.playerX < prevCpX) {
        p.playerX = prevCpX + 36;
        p.playerY = 0;
        p.vy = 0;
        p.isGrounded = true;
        p.jumpState = 'GROUNDED';
        p.isAtCheckpoint = false;
        p.cameraX = Math.max(0, p.playerX - 180);
      }
    }
  }, [mode, currentQuestionIndex, unlockedStageCount, totalStages]);

  const activeQuestion: GameQuestion | SanitizedQuestion | null = useMemo(() => {
    if (mode === 'LIVE_SESSION' && currentQuestion) {
      return currentQuestion;
    }
    return questions[activeStageIndex] || questions[0] || null;
  }, [mode, currentQuestion, questions, activeStageIndex]);

  const activeFeedback = mode === 'LIVE_SESSION' ? effectiveLiveFeedback : previewAnswerResult;
  const isJourneyFinished =
    mode === 'LIVE_SESSION' ? Boolean(isSessionFinished || effectiveFinalResult) : previewFinished;
  const activeModalOpen = checkpointModalOpen && !isJourneyFinished;

  // Reset question input controls when activeQuestion changes
  useEffect(() => {
    setSelectedChoice('');
    setTextAnswer('');
    if (activeQuestion?.type === 'SLIDER' && activeQuestion.sliderConfig) {
      const { min, max, step } = activeQuestion.sliderConfig;
      const safeStep = step > 0 ? step : 1;
      const mid = min + Math.round((max - min) / 2 / safeStep) * safeStep;
      setSliderValue(Math.min(max, Math.max(min, Number(mid.toFixed(6)))));
    } else {
      setSliderValue(null);
    }
    if (activeQuestion?.type === 'PUZZLE' && Array.isArray(activeQuestion.choices)) {
      setPuzzleOrder([...activeQuestion.choices]);
    } else {
      setPuzzleOrder([]);
    }
    submittingStageLockRef.current = false;
  }, [activeQuestion?.id, activeStageIndex]);

  const handleMovePuzzleItem = useCallback((index: number, direction: -1 | 1) => {
    setPuzzleOrder(prev => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  }, []);

  // Pause movement automatically on browser tab switch / visibilitychange
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      const hidden = document.visibilityState === 'hidden';
      setIsTabHidden(hidden);
      if (hidden) {
        physicsRef.current.vx = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleStartJourney = useCallback(async () => {
    if (assetLoadStatus !== 'READY') return;
    if (mode === 'LIVE_SESSION' && effectiveOnStartSession) {
      await effectiveOnStartSession();
    }
    setIsJourneyStarted(true);
    setIsPaused(false);
  }, [assetLoadStatus, mode, effectiveOnStartSession]);

  const handleJumpAction = useCallback(() => {
    const canControl =
      assetLoadStatus === 'READY' &&
      isJourneyStarted &&
      !isPaused &&
      !isTabHidden &&
      !activeModalOpen &&
      !isJourneyFinished;

    const jumped = triggerRunnerJump(physicsRef.current, canControl);
    if (jumped) {
      setJumpStateSnapshot(physicsRef.current.jumpState);
      setIsGroundedSnapshot(physicsRef.current.isGrounded);
    }
  }, [
    assetLoadStatus,
    isJourneyStarted,
    isPaused,
    isTabHidden,
    activeModalOpen,
    isJourneyFinished,
  ]);

  const handleAnswerSubmit = useCallback(
    async (answerValue: string) => {
      if (!activeQuestion || activeFeedback || submittingAnswer) return;
      const trimmed = answerValue.trim();
      if (!trimmed) return;

      // Prevent duplicate answer submission for the same stage
      if (
        submittedStageIndicesRef.current.has(activeStageIndex) ||
        submittingStageLockRef.current
      ) {
        return;
      }
      submittingStageLockRef.current = true;
      submittedStageIndicesRef.current.add(activeStageIndex);

      try {
        if (mode === 'LIVE_SESSION' && effectiveOnSubmitAnswer) {
          await effectiveOnSubmitAnswer(trimmed);
          return;
        }

        const fullQ = activeQuestion as Partial<GameQuestion>;
        const isCorrect = evaluateRunnerPreviewAnswer(activeQuestion, trimmed);
        const pts = isCorrect ? 100 : 0;
        setPreviewScore(prev => prev + pts);
        if (isCorrect) {
          setPreviewCorrectCount(prev => prev + 1);
        }
        setPreviewAnswerResult({
          isCorrect,
          pointsEarned: pts,
          correctAnswer: fullQ.correctAnswer || '',
          explanation:
            fullQ.explanation ||
            'Đã đối chiếu đáp án tại trạm kiểm tra theo nội dung nguồn.',
        });
      } finally {
        submittingStageLockRef.current = false;
      }
    },
    [activeQuestion, activeFeedback, submittingAnswer, activeStageIndex, mode, effectiveOnSubmitAnswer]
  );

  const handleContinueJourney = useCallback(async () => {
    if (!activeFeedback) return;

    const nextUnlocked = Math.min(totalStages, activeStageIndex + 1);
    setUnlockedStageCount(nextUnlocked);
    physicsRef.current.unlockedStageCount = nextUnlocked;
    physicsRef.current.isAtCheckpoint = false;
    setCheckpointModalOpen(false);
    setSelectedChoice('');
    setTextAnswer('');

    if (mode === 'LIVE_SESSION' && effectiveOnNextQuestion) {
      await effectiveOnNextQuestion();
      if (nextUnlocked < totalStages) {
        setActiveStageIndex(nextUnlocked);
        physicsRef.current.activeStageIndex = nextUnlocked;
      }
      return;
    }

    setPreviewAnswerResult(null);
    if (nextUnlocked < totalStages) {
      setActiveStageIndex(nextUnlocked);
      physicsRef.current.activeStageIndex = nextUnlocked;
    } else {
      setPreviewFinished(true);
    }
  }, [activeFeedback, totalStages, activeStageIndex, mode, effectiveOnNextQuestion]);

  const handleRestartPreview = useCallback(async () => {
    // Reuses already-loaded assets in loadedSpritesRef; never calls Banana API
    submittedStageIndicesRef.current.clear();
    submittingStageLockRef.current = false;

    if (mode === 'LIVE_SESSION' && effectiveOnRestartSession) {
      await effectiveOnRestartSession();
    }

    physicsRef.current = createInitialRunnerPhysicsState({
      totalStages,
      obstacleDensity: effectiveConfig.obstacleDensity,
      initialUnlockedStages: 0,
    });
    setUnlockedStageCount(0);
    setActiveStageIndex(0);
    setCheckpointModalOpen(false);
    setPreviewScore(0);
    setPreviewCorrectCount(0);
    setPreviewAnswerResult(null);
    setPreviewFinished(false);
    setObstaclesClearedCount(0);
    setJumpStateSnapshot('GROUNDED');
    setIsGroundedSnapshot(true);
    setJourneyProgressPercent(0);
    setIsPaused(false);
    setIsJourneyStarted(true);
  }, [mode, effectiveOnRestartSession, totalStages, effectiveConfig.obstacleDensity]);

  const handleExitGame = useCallback(() => {
    setIsPaused(true);
    setCheckpointModalOpen(false);
    onExit();
  }, [onExit]);

  // Keyboard listener (Space / ArrowUp / W to jump; Enter/Space to start or continue after feedback)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (assetLoadStatus !== 'READY') return;

        if (!isJourneyStarted && !isJourneyFinished) {
          handleStartJourney();
          return;
        }
        if (activeModalOpen && activeFeedback) {
          handleContinueJourney();
          return;
        }
        if (!activeModalOpen && !isPaused && !isJourneyFinished) {
          handleJumpAction();
        }
      } else if (e.code === 'Enter') {
        if (activeModalOpen && activeFeedback) {
          e.preventDefault();
          handleContinueJourney();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    assetLoadStatus,
    isJourneyStarted,
    isJourneyFinished,
    activeModalOpen,
    activeFeedback,
    isPaused,
    handleStartJourney,
    handleContinueJourney,
    handleJumpAction,
  ]);

  // Main 60fps 2D Side-Scrolling Canvas Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;

      // Match canvas pixel buffer to viewport container size
      const parent = canvas.parentElement;
      const targetW = Math.max(320, parent?.clientWidth || window.innerWidth || 1280);
      const targetH = Math.max(320, parent?.clientHeight || window.innerHeight || 720);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const width = canvas.width;
      const height = canvas.height;
      const isCompactViewport = width < 640;
      const playerAnchorScreenX = isCompactViewport
        ? Math.round(width * 0.24)
        : Math.min(240, Math.round(width * 0.2));

      const canMove =
        assetLoadStatus === 'READY' &&
        isJourneyStarted &&
        !isPaused &&
        !isTabHidden &&
        !activeModalOpen &&
        !isJourneyFinished;

      const physics = physicsRef.current;
      physics.unlockedStageCount = unlockedStageCount;

      const stepEvents = stepAdventureRunnerPhysics(physics, rawDt, {
        canMove,
        speedMultiplier: effectiveConfig.speedMultiplier || 1,
        playerAnchorScreenX,
      });

      if (stepEvents.reachedCheckpointIndex !== null) {
        setActiveStageIndex(stepEvents.reachedCheckpointIndex);
        setCheckpointModalOpen(true);
      }
      if (stepEvents.reachedFinish && mode === 'CREATOR_PREVIEW' && !previewFinished) {
        setPreviewFinished(true);
      }

      // Update reactive snapshots for HUD & DOM data attributes
      const pct = Math.min(
        100,
        Math.max(0, Math.round((physics.playerX / Math.max(1, physics.finishLineX)) * 100))
      );
      setJourneyProgressPercent(prev => (prev !== pct ? pct : prev));
      setObstaclesClearedCount(prev =>
        prev !== physics.obstaclesCleared ? physics.obstaclesCleared : prev
      );
      setJumpStateSnapshot(prev => (prev !== physics.jumpState ? physics.jumpState : prev));
      setIsGroundedSnapshot(prev => (prev !== physics.isGrounded ? physics.isGrounded : prev));

      canvas.dataset.playerX = String(Math.round(physics.playerX));
      canvas.dataset.playerY = String(Math.round(physics.playerY));
      canvas.dataset.cameraX = String(Math.round(physics.cameraX));
      canvas.dataset.vx = String(Math.round(physics.vx));
      canvas.dataset.jumpState = physics.jumpState;
      canvas.dataset.isGrounded = String(physics.isGrounded);

      // ================= RENDER 2D SIDE-SCROLLING WORLD =================
      ctx.clearRect(0, 0, width, height);

      const palette = effectiveConfig.palette;
      const sprites = loadedSpritesRef.current;
      // Ground surface aligned with the flat lower 18-22% road/floor band of the 16:9 Banana backgrounds
      const groundSurfaceY = Math.round(height * 0.82);

      // 1. Draw Horizontally Scrolling 2D Background Image
      if (sprites.background) {
        const bg = sprites.background;
        const tileWidth = Math.max(width, Math.round(height * bg.aspectRatio));
        const scrollOffset = ((physics.cameraX * 0.65) % tileWidth + tileWidth) % tileWidth;

        for (let drawX = -scrollOffset; drawX < width + tileWidth; drawX += tileWidth) {
          ctx.drawImage(bg.source, Math.floor(drawX), 0, tileWidth + 1, height);
        }
      } else {
        const skyGrad = ctx.createLinearGradient(0, 0, 0, groundSurfaceY);
        skyGrad.addColorStop(0, palette.skyTop);
        skyGrad.addColorStop(1, palette.skyBottom);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Subtle ground/road running track line for clear visual reference of jump & landing
      ctx.save();
      ctx.fillStyle = 'rgba(9, 13, 22, 0.26)';
      ctx.fillRect(0, groundSurfaceY, width, height - groundSurfaceY);
      ctx.strokeStyle = palette.accentColor || '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, groundSurfaceY);
      ctx.lineTo(width, groundSurfaceY);
      ctx.stroke();

      // Scrolling ground distance ticks
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      const dashSpacing = 96;
      const dashStart = -(physics.cameraX % dashSpacing);
      for (let dx = dashStart; dx < width; dx += dashSpacing) {
        ctx.fillRect(dx, groundSurfaceY + Math.round((height - groundSurfaceY) * 0.42), 36, 4);
      }
      ctx.restore();

      // 2. Draw Checkpoints along the world track
      physics.checkpointPositions.forEach((cpX, idx) => {
        const screenX = cpX - physics.cameraX;
        if (screenX < -140 || screenX > width + 140) return;

        const isUnlocked = idx < unlockedStageCount;
        const gateColor = isUnlocked ? '#22c55e' : palette.accentColor || '#f59e0b';
        const poleHeight = Math.round(height * 0.24);
        const topY = groundSurfaceY - poleHeight;

        ctx.save();
        // Gate pillar
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(screenX - 6, topY, 12, poleHeight);
        ctx.strokeStyle = gateColor;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(screenX - 6, topY, 12, poleHeight);

        // Checkpoint banner
        const bannerW = 108;
        const bannerH = 30;
        ctx.fillStyle = '#090d16';
        ctx.fillRect(screenX - bannerW / 2, topY - bannerH, bannerW, bannerH);
        ctx.strokeStyle = gateColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX - bannerW / 2, topY - bannerH, bannerW, bannerH);

        ctx.fillStyle = gateColor;
        ctx.font = 'bold 12px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          isUnlocked ? `✓ TRẠM ${idx + 1}` : `CHECKPOINT ${idx + 1}`,
          screenX,
          topY - bannerH / 2
        );

        // Laser barrier beam when locked
        if (!isUnlocked) {
          ctx.strokeStyle = gateColor;
          ctx.lineWidth = 4;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(screenX, topY);
          ctx.lineTo(screenX, groundSurfaceY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      });

      // 3. Draw Finish Gate
      const finishScreenX = physics.finishLineX - physics.cameraX;
      if (finishScreenX > -140 && finishScreenX < width + 140) {
        const poleH = Math.round(height * 0.26);
        const topY = groundSurfaceY - poleH;
        ctx.save();
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(finishScreenX - 6, topY, 12, poleH);
        ctx.fillStyle = '#090d16';
        ctx.fillRect(finishScreenX - 56, topY - 32, 112, 30);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(finishScreenX - 56, topY - 32, 112, 30);
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 12px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🏁 VỀ ĐÍCH', finishScreenX, topY - 17);
        ctx.restore();
      }

      // 4. Draw Industry Obstacles from verified Banana obstacle sprite
      const obsTargetH = Math.round(
        Math.max(46, Math.min(isCompactViewport ? 60 : 74, height * 0.105))
      );
      for (const obs of physics.obstacles) {
        const screenX = obs.x - physics.cameraX;
        if (screenX < -120 || screenX > width + 120) continue;

        ctx.save();
        // Ground shadow under obstacle
        ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
        ctx.beginPath();
        ctx.ellipse(screenX, groundSurfaceY + 2, obsTargetH * 0.45, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        if (sprites.obstacle) {
          const obsSprite = sprites.obstacle;
          const drawH = obsTargetH;
          const drawW = Math.round(
            Math.max(40, Math.min(drawH * 1.45, drawH * obsSprite.aspectRatio))
          );
          obs.width = drawW;
          obs.height = drawH;
          ctx.drawImage(
            obsSprite.source,
            Math.round(screenX - drawW / 2),
            Math.round(groundSurfaceY - drawH),
            drawW,
            drawH
          );
        } else {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(screenX - 24, groundSurfaceY - 48, 48, 48);
        }
        ctx.restore();
      }

      // 5. Draw Industry Character / Vehicle from verified Banana character sprite
      const playerScreenX = physics.playerX - physics.cameraX;
      const charTargetH = Math.round(
        Math.max(66, Math.min(isCompactViewport ? 88 : 112, height * 0.155))
      );
      const runBobOffset =
        physics.isGrounded && physics.vx > 10 ? Math.sin(now * 0.018) * 3 : 0;
      const playerFootY = groundSurfaceY + physics.playerY + runBobOffset;

      ctx.save();
      // Dynamic ground shadow that shrinks while jumping
      const heightRatio = Math.max(0.35, 1 - Math.abs(physics.playerY) / 180);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(
        playerScreenX,
        groundSurfaceY + 3,
        charTargetH * 0.42 * heightRatio,
        7 * heightRatio,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();

      if (physics.hitFlashTimer > 0 && Math.floor(now / 60) % 2 === 0) {
        ctx.globalAlpha = 0.65;
      }

      if (sprites.character) {
        const charSprite = sprites.character;
        const drawH = charTargetH;
        const drawW = Math.round(
          Math.max(54, Math.min(drawH * 1.6, drawH * charSprite.aspectRatio))
        );

        ctx.translate(playerScreenX, playerFootY - drawH / 2);
        if (!physics.isGrounded) {
          const tiltAngle =
            physics.jumpState === 'JUMPING' ? -0.09 : physics.jumpState === 'LANDING' ? 0.06 : 0;
          ctx.rotate(tiltAngle);
        }
        ctx.drawImage(
          charSprite.source,
          Math.round(-drawW / 2),
          Math.round(-drawH / 2),
          drawW,
          drawH
        );
      } else {
        ctx.fillStyle = palette.accentColor || '#38bdf8';
        ctx.fillRect(playerScreenX - 24, playerFootY - 64, 48, 64);
      }
      ctx.restore();

      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [
    assetLoadStatus,
    isJourneyStarted,
    isPaused,
    isTabHidden,
    activeModalOpen,
    isJourneyFinished,
    unlockedStageCount,
    effectiveConfig,
    mode,
    previewFinished,
  ]);

  const accentHex = effectiveConfig.palette.accentColor || '#38bdf8';
  const displayedTotalScore =
    mode === 'LIVE_SESSION'
      ? (effectiveFinalResult?.totalScore ??
          (effectiveFinalResult as PracticeFinalResult | null)?.score ??
          liveScore)
      : previewScore;
  const completedQuestionsCount = Math.min(totalStages, unlockedStageCount);

  return (
    <div
      data-testid="adventure-game-viewport"
       data-industry-id={effectiveConfig.industryId}
      data-asset-status={assetLoadStatus}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 50,
        overflow: 'hidden',
        backgroundColor: '#090d16',
        fontFamily: 'var(--font-sans, "Be Vietnam Pro", system-ui, sans-serif)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* ================= MINIMAL HUD (STAGE/PROGRESS, SCORE, COMPLETED QUESTIONS) ================= */}
      <div
        data-testid="adventure-minimal-hud"
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          right: '12px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          flexWrap: 'wrap',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            backgroundColor: 'rgba(9, 13, 22, 0.86)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '12px',
            padding: '8px 14px',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'auto',
          }}
        >
          {/* 1. Chặng / tiến độ */}
          <div
            data-testid="hud-stage-progress"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              paddingRight: '10px',
              borderRight: '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8' }}>
                CHẶNG / TIẾN ĐỘ
              </div>
              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 800,
                  color: '#f8fafc',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                Chặng {Math.min(activeStageIndex + 1, totalStages)}/{totalStages} ({journeyProgressPercent}%)
              </div>
            </div>
            <div
              style={{
                width: '64px',
                height: '6px',
                borderRadius: '999px',
                backgroundColor: '#1e293b',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${journeyProgressPercent}%`,
                  height: '100%',
                  backgroundColor: accentHex,
                  transition: 'width 120ms linear',
                }}
              />
            </div>
          </div>

          {/* 2. Điểm */}
          <div
            style={{
              paddingRight: '10px',
              borderRight: '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8' }}>ĐIỂM</div>
            <div
              data-testid="hud-total-score"
              style={{
                fontSize: '15px',
                fontWeight: 800,
                color: accentHex,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {displayedTotalScore}
            </div>
          </div>

          {/* 3. Số câu đã hoàn thành */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8' }}>
              ĐÃ HOÀN THÀNH
            </div>
            <div
              data-testid="hud-completed-questions"
              style={{
                fontSize: '13.5px',
                fontWeight: 800,
                color: '#3fc07a',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {completedQuestionsCount}/{totalStages} câu
            </div>
          </div>
        </div>

        {/* Action controls: Pause/Resume & Exit */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'auto',
          }}
        >
          {isJourneyStarted && !isJourneyFinished && assetLoadStatus === 'READY' && (
            <button
              type="button"
              data-testid="hud-pause-button"
              onClick={() => setIsPaused(p => !p)}
              style={{
                height: '38px',
                padding: '0 14px',
                borderRadius: '10px',
                backgroundColor: isPaused ? accentHex : 'rgba(15, 23, 42, 0.88)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                color: isPaused ? '#090d16' : '#f8fafc',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
            </button>
          )}
          <button
            type="button"
            data-testid="hud-exit-button"
            onClick={handleExitGame}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(15, 23, 42, 0.88)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              color: '#fca5a5',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Thoát
          </button>
        </div>
      </div>

      {/* ================= 2D SIDE-SCROLLING CANVAS STAGE ================= */}
      <div
        data-testid="scene-traffic-road-runner"
        onPointerDown={e => {
          const target = e.target as HTMLElement | null;
          if (target && target.closest('button, input, textarea')) return;
          handleJumpAction();
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          cursor:
            isJourneyStarted && !activeModalOpen && !isPaused && !isJourneyFinished
              ? 'pointer'
              : 'default',
        }}
      >
        <canvas
          ref={canvasRef}
          data-testid="adventure-runner-canvas"
          data-bg-url={resolvedAssets.assets?.background.url || ''}
          data-char-url={resolvedAssets.assets?.character.url || ''}
          data-obs-url={resolvedAssets.assets?.obstacle.url || ''}
          data-industry-id={effectiveConfig.industryId}
          data-jump-state={jumpStateSnapshot}
          data-is-grounded={String(isGroundedSnapshot)}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
          }}
        />

        {/* Touch-friendly Jump Button on active canvas */}
        {isJourneyStarted && !activeModalOpen && !isPaused && !isJourneyFinished && assetLoadStatus === 'READY' && (
          <button
            type="button"
            data-testid="mobile-jump-button"
            onPointerDown={e => {
              e.stopPropagation();
              handleJumpAction();
            }}
            style={{
              position: 'absolute',
              right: '20px',
              bottom: '22px',
              zIndex: 25,
              height: '54px',
              padding: '0 22px',
              borderRadius: '999px',
              backgroundColor: 'rgba(15, 23, 42, 0.86)',
              border: `2px solid ${accentHex}`,
              color: '#f8fafc',
              fontSize: '13.5px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
              touchAction: 'manipulation',
            }}
          >
            NHẢY (Chạm / Space)
          </button>
        )}

        {/* ================= ASSET ERROR OVERLAY ================= */}
        {assetLoadStatus === 'ERROR' && (
          <div
            data-testid="adventure-asset-error"
            data-error-code={resolvedAssets.errorCode || 'ASSET_LOAD_FAILED'}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 48,
              backgroundColor: 'rgba(9, 13, 22, 0.96)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '520px',
                backgroundColor: '#111827',
                border: '1.5px solid #ef4444',
                borderRadius: '14px',
                padding: '26px 24px',
                color: '#f8fafc',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: '#f87171',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                LỖI TÀI NGUYÊN HÌNH ẢNH 2D · {effectiveConfig.industryLabel || effectiveConfig.industryId}
              </div>
              <h2
                style={{
                  margin: '8px 0 10px 0',
                  fontSize: '20px',
                  fontWeight: 800,
                  color: '#f8fafc',
                }}
              >
                Không thể khởi chạy màn chơi Adventure 2D
              </h2>
              <p
                style={{
                  margin: '0 0 14px 0',
                  fontSize: '14px',
                  lineHeight: 1.55,
                  color: '#cbd5e1',
                }}
              >
                {assetLoadError ||
                  'Màn chơi thiếu tài nguyên hình ảnh bắt buộc (background, character, obstacle) hoặc đường dẫn ảnh bị lỗi.'}
              </p>
              {failedAssetSlots.length > 0 && (
                <div
                  style={{
                    marginBottom: '18px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    fontSize: '12.5px',
                    color: '#fca5a5',
                    fontWeight: 700,
                  }}
                >
                  Tài nguyên lỗi / thiếu: {failedAssetSlots.join(', ')}
                </div>
              )}
              <button
                type="button"
                data-testid="asset-error-exit-btn"
                onClick={handleExitGame}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '10px',
                  backgroundColor: '#ef4444',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Thoát màn chơi
              </button>
            </div>
          </div>
        )}

        {/* ================= START SCREEN OVERLAY ================= */}
        {assetLoadStatus !== 'ERROR' && !isJourneyStarted && !isJourneyFinished && (
          <div
            data-testid="scene-pregame-briefing"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              backgroundColor: 'rgba(9, 13, 22, 0.84)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '480px',
                backgroundColor: '#111726',
                border: `1.5px solid ${accentHex}`,
                borderRadius: '16px',
                padding: '26px 24px',
                color: '#f8fafc',
                boxShadow: '0 20px 48px rgba(0, 0, 0, 0.6)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '11.5px',
                  fontWeight: 800,
                  color: accentHex,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {effectiveConfig.industryLabel} · {totalStages} CHECKPOINT
              </div>
              <h2
                style={{
                  margin: '8px 0 12px 0',
                  fontSize: '21px',
                  fontWeight: 800,
                  color: '#f8fafc',
                  lineHeight: 1.3,
                }}
              >
                {game.title || effectiveConfig.environmentTitle}
              </h2>
              <p
                data-testid="adventure-start-instruction"
                style={{
                  margin: '0 0 22px 0',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: '#0b0f19',
                  border: '1px solid #1e293b',
                  fontSize: '14.5px',
                  fontWeight: 600,
                  color: '#e2e8f0',
                  lineHeight: 1.5,
                }}
              >
                {ADVENTURE_START_INSTRUCTION}
              </p>
              <button
                type="button"
                data-testid="start-adventure-btn"
                disabled={assetLoadStatus !== 'READY' || startingSession}
                onClick={handleStartJourney}
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '10px',
                  backgroundColor:
                    assetLoadStatus === 'READY' && !startingSession ? accentHex : '#334155',
                  border: 'none',
                  color: '#090d16',
                  fontSize: '15px',
                  fontWeight: 800,
                  cursor: assetLoadStatus === 'READY' ? 'pointer' : 'wait',
                }}
              >
                {assetLoadStatus === 'READY'
                  ? 'Bắt đầu (Chạm / Space)'
                  : 'Đang tải tài nguyên 2D...'}
              </button>
            </div>
          </div>
        )}

        {/* ================= PAUSE OVERLAY ================= */}
        {isJourneyStarted && isPaused && !activeModalOpen && !isJourneyFinished && (
          <div
            data-testid="scene-pause-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 38,
              backgroundColor: 'rgba(9, 13, 22, 0.82)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '400px',
                backgroundColor: '#111726',
                border: '1px solid #26334d',
                borderRadius: '14px',
                padding: '24px',
                textAlign: 'center',
                color: '#f8fafc',
              }}
            >
              <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', fontWeight: 800 }}>
                Đang tạm dừng màn chơi
              </h3>
              <p style={{ margin: '0 0 18px 0', fontSize: '13.5px', color: '#94a3b8' }}>
                Tiến trình hiện tại tại Chặng {Math.min(activeStageIndex + 1, totalStages)}/{totalStages} được giữ nguyên.
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button
                  type="button"
                  data-testid="resume-adventure-btn"
                  onClick={() => setIsPaused(false)}
                  style={{
                    height: '42px',
                    padding: '0 20px',
                    borderRadius: '8px',
                    backgroundColor: accentHex,
                    border: 'none',
                    color: '#090d16',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Tiếp tục chơi
                </button>
                <button
                  type="button"
                  onClick={handleExitGame}
                  style={{
                    height: '42px',
                    padding: '0 18px',
                    borderRadius: '8px',
                    backgroundColor: '#161f30',
                    border: '1px solid #26334d',
                    color: '#f8fafc',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Thoát
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= CHECKPOINT QUESTION MODAL ================= */}
        {activeModalOpen && activeQuestion && (
          <div
            data-testid="runner-checkpoint-modal"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 42,
              backgroundColor: 'rgba(9, 13, 22, 0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              overflowY: 'auto',
            }}
          >
            <div
              data-testid="ingame-challenge-popup"
              data-question-type={activeQuestion.type}
              style={{
                width: '100%',
                maxWidth: '680px',
                backgroundColor: '#111726',
                border: `1.5px solid ${accentHex}`,
                borderRadius: '14px',
                padding: '20px 22px',
                color: '#f8fafc',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  marginBottom: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      color: accentHex,
                      textTransform: 'uppercase',
                    }}
                  >
                    CHECKPOINT {activeStageIndex + 1}/{totalStages} ·{' '}
                    {effectiveConfig.stages[activeStageIndex]?.checkpointTitle ||
                      `Trạm kiểm tra #${activeStageIndex + 1}`}
                  </span>
                  <span
                    data-testid="checkpoint-question-type-badge"
                    data-question-type={activeQuestion.type}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 800,
                      backgroundColor: 'rgba(56, 189, 248, 0.14)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      color: '#38bdf8',
                    }}
                  >
                    {activeQuestion.type === 'MULTIPLE_CHOICE' || activeQuestion.type === 'QUIZ'
                      ? 'Trắc nghiệm 4 lựa chọn'
                      : activeQuestion.type === 'QUICK_BUTTON' || activeQuestion.type === 'TRUE_FALSE'
                        ? 'Bấm nhanh · Đúng / Sai'
                        : activeQuestion.type === 'FILL_IN_THE_BLANK' || activeQuestion.type === 'TYPE_ANSWER'
                          ? 'Điền vào chỗ trống'
                          : activeQuestion.type === 'CROSSWORD'
                            ? 'Giải Ô chữ'
                            : activeQuestion.type}
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
                  Nhân vật đã dừng — Trả lời để mở cổng đi tiếp
                </span>
              </div>

              <div
                data-testid="checkpoint-question-text"
                style={{
                  fontSize: '17px',
                  fontWeight: 700,
                  color: '#f8fafc',
                  lineHeight: 1.45,
                }}
              >
                {activeQuestion.question}
              </div>

              {/* Answer Input Area */}
              <div>
                {activeQuestion.type === 'SLIDER' && activeQuestion.sliderConfig ? (
                  <div style={{ marginTop: '14px' }}>
                    {(() => {
                      const { min, max, step } = activeQuestion.sliderConfig!;
                      const unit = activeQuestion.sliderConfig!.unit || '';
                      const safeStep = step > 0 ? step : 1;
                      const currentVal = sliderValue !== null ? sliderValue : min;
                      const clampVal = (v: number) => {
                        const snapped = min + Math.round((v - min) / safeStep) * safeStep;
                        return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
                      };
                      return (
                        <div
                          style={{
                            padding: '14px 16px',
                            borderRadius: '10px',
                            backgroundColor: '#0b0f19',
                            border: '1px solid #26334d',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '8px',
                            }}
                          >
                            <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#94a3b8' }}>
                              Kéo thanh trượt hoặc nhập số ({min}
                              {unit} → {max}
                              {unit}):
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <input
                                type="number"
                                min={min}
                                max={max}
                                step={safeStep}
                                value={currentVal}
                                disabled={Boolean(activeFeedback) || submittingAnswer}
                                onChange={e => {
                                  const parsed = Number(e.target.value);
                                  if (Number.isFinite(parsed)) {
                                    setSliderValue(clampVal(parsed));
                                  }
                                }}
                                style={{
                                  width: '100px',
                                  height: '36px',
                                  padding: '0 10px',
                                  borderRadius: '8px',
                                  backgroundColor: '#161f30',
                                  border: `1.5px solid ${accentHex}`,
                                  color: '#f8fafc',
                                  fontSize: '15px',
                                  fontWeight: 800,
                                  textAlign: 'center',
                                }}
                              />
                              {unit && (
                                <span style={{ fontSize: '14px', fontWeight: 800, color: accentHex }}>
                                  {unit}
                                </span>
                              )}
                            </div>
                          </div>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={safeStep}
                            value={currentVal}
                            disabled={Boolean(activeFeedback) || submittingAnswer}
                            onChange={e => setSliderValue(clampVal(Number(e.target.value)))}
                            style={{
                              width: '100%',
                              accentColor: accentHex,
                              cursor:
                                Boolean(activeFeedback) || submittingAnswer ? 'default' : 'pointer',
                            }}
                          />
                          {!activeFeedback && (
                            <button
                              type="button"
                              disabled={submittingAnswer}
                              onClick={() => handleAnswerSubmit(String(clampVal(currentVal)))}
                              style={{
                                height: '42px',
                                padding: '0 20px',
                                borderRadius: '8px',
                                backgroundColor: accentHex,
                                border: 'none',
                                color: '#090d16',
                                fontSize: '14px',
                                fontWeight: 800,
                                cursor: submittingAnswer ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Xác nhận giá trị {currentVal}
                              {unit}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : activeQuestion.type === 'PUZZLE' &&
                  Array.isArray(activeQuestion.choices) &&
                  activeQuestion.choices.length > 0 ? (
                  <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8' }}>
                      Sắp xếp các bước theo đúng thứ tự từ trên xuống dưới:
                    </div>
                    {(puzzleOrder.length > 0 ? puzzleOrder : activeQuestion.choices).map(
                      (item, idx, arr) => (
                        <div
                          key={`${idx}_${item}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: '#161f30',
                            border: '1.5px solid #26334d',
                            color: '#f8fafc',
                          }}
                        >
                          <span
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              backgroundColor: '#0b0f19',
                              color: accentHex,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 800,
                              flexShrink: 0,
                            }}
                          >
                            {idx + 1}
                          </span>
                          <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600 }}>
                            {item}
                          </span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              disabled={Boolean(activeFeedback) || submittingAnswer || idx === 0}
                              onClick={() => handleMovePuzzleItem(idx, -1)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '6px',
                                border: '1px solid #26334d',
                                backgroundColor: '#0b0f19',
                                color: idx === 0 ? '#475569' : '#f8fafc',
                                fontWeight: 800,
                                cursor:
                                  Boolean(activeFeedback) || submittingAnswer || idx === 0
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={
                                Boolean(activeFeedback) ||
                                submittingAnswer ||
                                idx === arr.length - 1
                              }
                              onClick={() => handleMovePuzzleItem(idx, 1)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '6px',
                                border: '1px solid #26334d',
                                backgroundColor: '#0b0f19',
                                color: idx === arr.length - 1 ? '#475569' : '#f8fafc',
                                fontWeight: 800,
                                cursor:
                                  Boolean(activeFeedback) ||
                                  submittingAnswer ||
                                  idx === arr.length - 1
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      )
                    )}
                    {!activeFeedback && (
                      <button
                        type="button"
                        disabled={submittingAnswer}
                        onClick={() =>
                          handleAnswerSubmit(
                            (puzzleOrder.length > 0
                              ? puzzleOrder
                              : activeQuestion.choices || []
                            ).join(' | ')
                          )
                        }
                        style={{
                          marginTop: '4px',
                          height: '42px',
                          padding: '0 20px',
                          borderRadius: '8px',
                          backgroundColor: accentHex,
                          border: 'none',
                          color: '#090d16',
                          fontSize: '14px',
                          fontWeight: 800,
                          cursor: submittingAnswer ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Xác nhận thứ tự đã sắp xếp
                      </button>
                    )}
                  </div>
                ) : activeQuestion.type === 'CROSSWORD' ? (
                  (() => {
                    const fullQ = activeQuestion as Partial<GameQuestion> & SanitizedQuestion;
                    const expectedWord = normalizeCrosswordAnswerForRunner(
                      fullQ.crosswordAnswer || fullQ.correctAnswer || ''
                    );
                    const wordLen =
                      fullQ.crosswordWordLength && fullQ.crosswordWordLength > 0
                        ? fullQ.crosswordWordLength
                        : expectedWord.length;
                    const typedNorm = normalizeCrosswordAnswerForRunner(textAnswer);
                    const clueText =
                      fullQ.crosswordClue && fullQ.crosswordClue.trim() !== activeQuestion.question.trim()
                        ? fullQ.crosswordClue.trim()
                        : '';

                    return (
                      <div
                        data-testid="checkpoint-crossword-box"
                        style={{
                          marginTop: '14px',
                          padding: '14px 16px',
                          borderRadius: '10px',
                          backgroundColor: '#0b0f19',
                          border: '1px solid #26334d',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        {clueText && (
                          <div
                            data-testid="checkpoint-crossword-clue"
                            style={{ fontSize: '13.5px', color: '#cbd5e1', lineHeight: 1.45 }}
                          >
                            <strong style={{ color: accentHex }}>Gợi ý ô chữ:</strong> {clueText}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8' }}>
                            Từ khóa gồm {wordLen > 0 ? `${wordLen} chữ cái` : 'các chữ cái viết liền không dấu'}:
                          </span>
                        </div>
                        {wordLen > 0 && wordLen <= 20 && (
                          <div
                            data-testid="checkpoint-crossword-slots"
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '6px',
                            }}
                          >
                            {Array.from({ length: wordLen }).map((_, slotIdx) => {
                              const ch = typedNorm[slotIdx] || '';
                              return (
                                <span
                                  key={slotIdx}
                                  data-testid={`checkpoint-crossword-slot-${slotIdx}`}
                                  style={{
                                    width: '34px',
                                    height: '38px',
                                    borderRadius: '6px',
                                    backgroundColor: ch ? '#161f30' : '#090d16',
                                    border: `1.5px solid ${ch ? accentHex : '#334155'}`,
                                    color: '#f8fafc',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '15px',
                                    fontWeight: 900,
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  {ch || '_'}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            data-testid="checkpoint-crossword-input"
                            value={textAnswer}
                            disabled={Boolean(activeFeedback) || submittingAnswer}
                            onChange={e => setTextAnswer(e.target.value.toUpperCase())}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && textAnswer.trim() && !activeFeedback && !submittingAnswer) {
                                e.preventDefault();
                                handleAnswerSubmit(normalizeCrosswordAnswerForRunner(textAnswer) || textAnswer.trim());
                              }
                            }}
                            placeholder="Nhập từ khóa ô chữ (VD:ANTOAN)..."
                            style={{
                              flex: '1 1 220px',
                              height: '42px',
                              padding: '0 14px',
                              borderRadius: '8px',
                              backgroundColor: '#161f30',
                              border: `1.5px solid ${accentHex}`,
                              color: '#f8fafc',
                              fontSize: '15px',
                              fontWeight: 800,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}
                          />
                          {!activeFeedback && (
                            <button
                              type="button"
                              data-testid="checkpoint-submit-answer-btn"
                              disabled={!textAnswer.trim() || submittingAnswer}
                              onClick={() =>
                                handleAnswerSubmit(
                                  normalizeCrosswordAnswerForRunner(textAnswer) || textAnswer.trim()
                                )
                              }
                              style={{
                                height: '42px',
                                padding: '0 20px',
                                borderRadius: '8px',
                                backgroundColor: accentHex,
                                border: 'none',
                                color: '#090d16',
                                fontSize: '14px',
                                fontWeight: 800,
                                cursor:
                                  !textAnswer.trim() || submittingAnswer ? 'not-allowed' : 'pointer',
                                opacity: !textAnswer.trim() || submittingAnswer ? 0.5 : 1,
                              }}
                            >
                              Giải Ô Chữ
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (activeQuestion.type === 'QUICK_BUTTON' || activeQuestion.type === 'TRUE_FALSE') &&
                  Array.isArray(activeQuestion.choices) &&
                  activeQuestion.choices.length > 0 ? (
                  <div
                    data-testid="checkpoint-quick-button-group"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '10px',
                      marginTop: '14px',
                    }}
                  >
                    {activeQuestion.choices.map((choice, cIdx) => {
                      const isSelected = selectedChoice === choice;
                      const isCorrectChoice =
                        activeFeedback && choice === activeFeedback.correctAnswer;
                      const isWrongSelected =
                        activeFeedback && isSelected && !activeFeedback.isCorrect;

                      let bg = '#161f30';
                      let border = '#26334d';
                      let textColor = '#f8fafc';

                      if (isCorrectChoice) {
                        bg = '#172a1d';
                        border = '#3fc07a';
                        textColor = '#3fc07a';
                      } else if (isWrongSelected) {
                        bg = '#2c1a20';
                        border = '#e5566f';
                        textColor = '#e5566f';
                      } else if (isSelected) {
                        bg = '#1e293b';
                        border = accentHex;
                      }

                      return (
                        <button
                          key={`${cIdx}_${choice}`}
                          type="button"
                          data-testid={`checkpoint-choice-${cIdx}`}
                          disabled={Boolean(activeFeedback) || submittingAnswer}
                          onClick={() => {
                            setSelectedChoice(choice);
                            handleAnswerSubmit(choice);
                          }}
                          style={{
                            textAlign: 'center',
                            padding: '14px 16px',
                            borderRadius: '10px',
                            backgroundColor: bg,
                            border: `2px solid ${border}`,
                            color: textColor,
                            fontSize: '15px',
                            fontWeight: 800,
                            cursor:
                              Boolean(activeFeedback) || submittingAnswer ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            minHeight: '52px',
                          }}
                        >
                          <span>{cIdx === 0 ? '✓' : '✕'}</span>
                          <span>{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : Array.isArray(activeQuestion.choices) && activeQuestion.choices.length > 0 ? (
                  <div
                    data-testid="checkpoint-multiple-choice-group"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                      gap: '8px',
                      marginTop: '14px',
                    }}
                  >
                    {activeQuestion.choices.map((choice, cIdx) => {
                      const isSelected = selectedChoice === choice;
                      const isCorrectChoice =
                        activeFeedback && choice === activeFeedback.correctAnswer;
                      const isWrongSelected =
                        activeFeedback && isSelected && !activeFeedback.isCorrect;

                      let bg = '#161f30';
                      let border = '#26334d';
                      let textColor = '#f8fafc';

                      if (isCorrectChoice) {
                        bg = '#172a1d';
                        border = '#3fc07a';
                        textColor = '#3fc07a';
                      } else if (isWrongSelected) {
                        bg = '#2c1a20';
                        border = '#e5566f';
                        textColor = '#e5566f';
                      } else if (isSelected) {
                        bg = '#1e293b';
                        border = accentHex;
                      }

                      return (
                        <button
                          key={`${cIdx}_${choice}`}
                          type="button"
                          data-testid={`checkpoint-choice-${cIdx}`}
                          disabled={Boolean(activeFeedback) || submittingAnswer}
                          onClick={() => {
                            setSelectedChoice(choice);
                            handleAnswerSubmit(choice);
                          }}
                          style={{
                            textAlign: 'left',
                            padding: '12px 14px',
                            borderRadius: '8px',
                            backgroundColor: bg,
                            border: `1.5px solid ${border}`,
                            color: textColor,
                            fontSize: '13.5px',
                            fontWeight: 600,
                            cursor:
                              Boolean(activeFeedback) || submittingAnswer ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '9px',
                            minHeight: '46px',
                          }}
                        >
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: '4px',
                              backgroundColor: '#0b0f19',
                              color: '#94a3b8',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              flexShrink: 0,
                            }}
                          >
                            {['A', 'B', 'C', 'D'][cIdx] || cIdx + 1}
                          </span>
                          <span style={{ flex: 1, lineHeight: 1.38 }}>{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    data-testid="checkpoint-fill-blank-box"
                    style={{
                      marginTop: '14px',
                      display: 'flex',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input
                      type="text"
                      data-testid="checkpoint-fill-blank-input"
                      value={textAnswer}
                      disabled={Boolean(activeFeedback) || submittingAnswer}
                      onChange={e => setTextAnswer(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && textAnswer.trim() && !activeFeedback && !submittingAnswer) {
                          e.preventDefault();
                          handleAnswerSubmit(textAnswer.trim());
                        }
                      }}
                      placeholder="Nhập từ khóa còn thiếu..."
                      style={{
                        flex: '1 1 220px',
                        height: '42px',
                        padding: '0 14px',
                        borderRadius: '8px',
                        backgroundColor: '#0b0f19',
                        border: '1px solid #26334d',
                        color: '#f8fafc',
                        fontSize: '14px',
                      }}
                    />
                    {!activeFeedback && (
                      <button
                        type="button"
                        data-testid="checkpoint-submit-answer-btn"
                        disabled={!textAnswer.trim() || submittingAnswer}
                        onClick={() => handleAnswerSubmit(textAnswer.trim())}
                        style={{
                          height: '42px',
                          padding: '0 20px',
                          borderRadius: '8px',
                          backgroundColor: accentHex,
                          border: 'none',
                          color: '#090d16',
                          fontSize: '14px',
                          fontWeight: 700,
                          cursor:
                            !textAnswer.trim() || submittingAnswer ? 'not-allowed' : 'pointer',
                          opacity: !textAnswer.trim() || submittingAnswer ? 0.5 : 1,
                        }}
                      >
                        Trả lời
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Feedback & Continue Button */}
              {activeFeedback && (
                <div
                  data-testid="checkpoint-feedback-panel"
                  style={{
                    marginTop: '14px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: activeFeedback.isCorrect ? '#172a1d' : '#2c1a20',
                    border: `1px solid ${activeFeedback.isCorrect ? '#3fc07a' : '#e5566f'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 240px' }}>
                    <div
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 700,
                        color: activeFeedback.isCorrect ? '#3fc07a' : '#e5566f',
                      }}
                    >
                      {activeFeedback.isCorrect
                        ? `[CHÍNH XÁC +${activeFeedback.pointsEarned}Đ] Cổng chắn chặng ${activeStageIndex + 1} đã mở!`
                        : `[CHƯA ĐÚNG] Đáp án chuẩn: ${activeFeedback.correctAnswer}`}
                    </div>
                    {activeFeedback.explanation && (
                      <div
                        style={{
                          marginTop: '4px',
                          fontSize: '12px',
                          color: '#e2e8f0',
                          lineHeight: 1.4,
                        }}
                      >
                        {activeFeedback.explanation}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="checkpoint-continue-btn"
                    onClick={handleContinueJourney}
                    style={{
                      height: '38px',
                      padding: '0 16px',
                      borderRadius: '6px',
                      backgroundColor: '#f8fafc',
                      border: 'none',
                      color: '#090d16',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {activeStageIndex + 1 < totalStages
                      ? 'Tiếp tục hành trình (Space)'
                      : 'Tiến về đích (Space)'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= VICTORY / FINISH OVERLAY ================= */}
        {isJourneyFinished && (
          <div
            data-testid="scene-victory-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 45,
              backgroundColor: 'rgba(9, 13, 22, 0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '560px',
                backgroundColor: '#111726',
                border: '1px solid #26334d',
                borderRadius: '12px',
                padding: '26px 24px',
                color: '#f8fafc',
              }}
            >
              <div style={{ fontSize: '12px', color: '#3fc07a', fontWeight: 700 }}>
                HOÀN THÀNH MÀN CHƠI · {effectiveConfig.industryLabel}
              </div>
              <h2
                style={{
                  margin: '4px 0 18px 0',
                  fontSize: '23px',
                  fontWeight: 700,
                  color: '#f8fafc',
                }}
              >
                {game.title || effectiveConfig.environmentTitle}
              </h2>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  backgroundColor: '#0b0f19',
                  border: '1px solid #222d42',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  fontVariantNumeric: 'tabular-nums',
                  marginBottom: '22px',
                }}
              >
                <div style={{ padding: '14px 16px', borderRight: '1px solid #222d42' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Tổng điểm màn chơi</div>
                  <div
                    data-testid="victory-total-score"
                    style={{
                      fontSize: '25px',
                      fontWeight: 700,
                      color: accentHex,
                      marginTop: '4px',
                    }}
                  >
                    {displayedTotalScore}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', borderRight: '1px solid #222d42' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Trạm trả lời đúng</div>
                  <div
                    style={{
                      fontSize: '25px',
                      fontWeight: 700,
                      color: '#f8fafc',
                      marginTop: '4px',
                    }}
                  >
                    {mode === 'LIVE_SESSION'
                      ? (effectiveFinalResult as PracticeFinalResult | null)?.correctCount ??
                        effectiveFinalResult?.correctAnswers ??
                        liveCorrectCount
                      : previewCorrectCount}
                    /{totalStages}
                  </div>
                </div>

                <div style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Vật cản vượt qua</div>
                  <div
                    style={{
                      fontSize: '25px',
                      fontWeight: 700,
                      color: '#3fc07a',
                      marginTop: '4px',
                    }}
                  >
                    {obstaclesClearedCount}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  data-testid="victory-restart-btn"
                  onClick={handleRestartPreview}
                  style={{
                    height: '40px',
                    padding: '0 18px',
                    borderRadius: '8px',
                    backgroundColor: accentHex,
                    border: 'none',
                    color: '#090d16',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Chơi lại
                </button>
                <button
                  type="button"
                  data-testid="victory-exit-btn"
                  onClick={handleExitGame}
                  style={{
                    height: '40px',
                    padding: '0 18px',
                    borderRadius: '8px',
                    backgroundColor: '#161f30',
                    border: '1px solid #26334d',
                    color: '#f8fafc',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Thoát màn hình chơi
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
