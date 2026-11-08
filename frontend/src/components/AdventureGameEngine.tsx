import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDefaultAdventureConfig,
  syncAdventureStagesWithQuestions,
} from '../config/adventureThemes.js';
import { soundManager } from '../services/audio.js';
import type {
  AdventureAssetMetadata,
  AdventureConfig,
  GameQuestion,
  GameSpecification,
  IndustryId,
  LeaderboardEntry,
  PracticeFinalResult,
  PracticeQuestionResult,
  SanitizedQuestion,
} from '../types/index.js';
import {
  calculateFrontendMaxPossibleScore,
  evaluateFrontendPerformance,
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

const ADVENTURE_BACKEND_ORIGIN: string = (() => {
  try {
    const rawApiUrl = String((import.meta as any).env?.VITE_API_URL || '').trim();
    if (rawApiUrl.startsWith('http://') || rawApiUrl.startsWith('https://')) {
      return new URL(rawApiUrl).origin;
    }
  } catch {
    // ignore URL parse error
  }
  return '';
})();

function buildAdventureAssetCandidateUrls(url: string): string[] {
  if (!url) return [];
  const trimmed = url.trim();
  if (!trimmed.startsWith('/adventure-assets/')) {
    return [trimmed];
  }
  if (!ADVENTURE_BACKEND_ORIGIN) {
    return [trimmed];
  }
  const backendUrl = `${ADVENTURE_BACKEND_ORIGIN}${trimmed}`;
  // Per-game AI assets live on the backend origin; static industry packs exist on both Frontend CDN and Backend
  if (trimmed.startsWith('/adventure-assets/games/')) {
    return [backendUrl, trimmed];
  }
  return [trimmed, backendUrl];
}

export function buildDefaultFallbackSlotAsset(
  slotType: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE',
  industryId: IndustryId,
  preferredPresetId?: string
): AdventureAssetItem {
  let packIndustry: IndustryId = KNOWN_CONCRETE_INDUSTRIES.has(industryId)
    ? industryId
    : 'EDUCATION_GENERAL';

  if (!KNOWN_CONCRETE_INDUSTRIES.has(industryId) && preferredPresetId) {
    const p = preferredPresetId.toLowerCase();
    if (p.includes('moto')) packIndustry = 'MOTORCYCLE_TRAFFIC';
    else if (p.includes('biz')) packIndustry = 'BUSINESS_SALES';
    else if (p.includes('mfg')) packIndustry = 'MANUFACTURING_INDUSTRIAL';
    else if (p.includes('it')) packIndustry = 'IT_TECHNOLOGY';
    else if (p.includes('med')) packIndustry = 'HEALTHCARE_TRAINING';
    else if (p.includes('fin')) packIndustry = 'FINANCE_BANKING';
    else if (p.includes('fnb')) packIndustry = 'FNB_HOSPITALITY';
  }

  const fileName =
    slotType === 'BACKGROUND'
      ? 'background.png'
      : slotType === 'CHARACTER'
        ? 'character.png'
        : 'obstacle.png';
  const basePackPath = `/adventure-assets/packs/${packIndustry}`;
  const relPackPath = `adventure-assets/packs/${packIndustry}`;

  return {
    assetType: slotType,
    industryId,
    fileName,
    url: `${basePackPath}/${fileName}`,
    relativePath: `${relPackPath}/${fileName}`,
    mimeType: 'image/png',
    sizeBytes: 1,
    width: slotType === 'BACKGROUND' ? 1376 : 1024,
    height: slotType === 'BACKGROUND' ? 768 : 1024,
    sha256: `fallback-pack-${slotType.toLowerCase()}`,
    source: 'ANTIGRAVITY_BANANA_PACK',
    verified: true,
  };
}

/**
 * Validates and resolves the 3 required 2D Adventure image assets (background, character, obstacle).
 * Implements mandatory per-slot safe fallback: if any slot is missing, failed, or invalid,
 * preserves any valid slots and substitutes only the broken/missing slot with a verified default pack asset.
 */
export function resolveAdventureRuntimeAssets(
  config: AdventureConfig
): ResolvedAdventureEngineAssets {
  const industryId = config.industryId || 'EDUCATION_GENERAL';
  const missingOrInvalid: Array<'BACKGROUND' | 'CHARACTER' | 'OBSTACLE'> = [];

  const resolveSlot = (
    item: AdventureAssetItem | undefined,
    expectedType: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE'
  ): AdventureAssetItem => {
    const isSlotUsable =
      Boolean(item) &&
      config.assetStatus !== 'ASSET_GENERATION_FAILED' &&
      config.assetStatus !== 'ASSET_GENERATION_PENDING' &&
      isSafeAssetUrl(item!.url) &&
      item!.verified !== false &&
      item!.assetType === expectedType &&
      (item!.industryId === industryId || industryId === 'CUSTOM');

    if (isSlotUsable && item) {
      return item;
    }

    missingOrInvalid.push(expectedType);
    return buildDefaultFallbackSlotAsset(expectedType, industryId, config.themePresetId);
  };

  const resolvedBg = resolveSlot(config.assets?.background, 'BACKGROUND');
  const resolvedChar = resolveSlot(config.assets?.character, 'CHARACTER');
  const resolvedObs = resolveSlot(config.assets?.obstacle, 'OBSTACLE');

  return {
    valid: true,
    isLegacyFallback: missingOrInvalid.length > 0,
    industryId,
    errorCode: null,
    errorMessage: null,
    missingOrInvalidAssets: missingOrInvalid,
    assets: {
      background: resolvedBg,
      character: resolvedChar,
      obstacle: resolvedObs,
    },
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
  isPlaytest?: boolean;
  isDemoMode?: boolean;
  onCreateThisGameType?: () => void;
  onCheckpointModalChange?: (isOpen: boolean, stageIndex: number) => void;
  onEditCheckpointQuestion?: (stageIndex: number) => void;
  onPrevCheckpointQuestion?: () => void;
  audioMuted?: boolean;
  onToggleAudioMute?: () => void;
  isMultiplayer?: boolean;
  multiplayerRoomCode?: string;
  multiplayerPlayerName?: string;
  multiplayerPlayerId?: string | null;
  multiplayerStreak?: number;
  multiplayerIsAnswerSubmitted?: boolean;
  multiplayerSubmittedAnswerText?: string;
  multiplayerIsHostDisconnected?: boolean;
  multiplayerIsReconnecting?: boolean;
  multiplayerLeaderboard?: LeaderboardEntry[];
  multiplayerFinalRank?: number | null;
  multiplayerTotalPlayers?: number;
  multiplayerShowLeaderboard?: boolean;
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
  timeRemaining,
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
  isPlaytest = false,
  isDemoMode = false,
  onCreateThisGameType,
  onCheckpointModalChange,
  onEditCheckpointQuestion,
  onPrevCheckpointQuestion,
  audioMuted = false,
  onToggleAudioMute,
  isMultiplayer = false,
  multiplayerRoomCode = '',
  multiplayerPlayerName = '',
  multiplayerPlayerId = null,
  multiplayerStreak = 0,
  multiplayerIsAnswerSubmitted = false,
  multiplayerSubmittedAnswerText = '',
  multiplayerIsHostDisconnected = false,
  multiplayerIsReconnecting = false,
  multiplayerLeaderboard = [],
  multiplayerFinalRank = null,
  multiplayerTotalPlayers = 0,
  multiplayerShowLeaderboard = true,
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

  // Preload the 3 verified image assets once per game config with automatic per-slot safe fallback
  useEffect(() => {
    const fallbackAssets = {
      background: buildDefaultFallbackSlotAsset(
        'BACKGROUND',
        effectiveConfig.industryId,
        effectiveConfig.themePresetId
      ),
      character: buildDefaultFallbackSlotAsset(
        'CHARACTER',
        effectiveConfig.industryId,
        effectiveConfig.themePresetId
      ),
      obstacle: buildDefaultFallbackSlotAsset(
        'OBSTACLE',
        effectiveConfig.industryId,
        effectiveConfig.themePresetId
      ),
    };

    const { background, character, obstacle } = resolvedAssets.assets || fallbackAssets;
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
      setFailedAssetSlots(resolvedAssets.missingOrInvalidAssets);
      return;
    }

    let cancelled = false;
    setAssetLoadStatus('LOADING');
    setAssetLoadError(null);

    const loadSingleUrlImage = (url: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        if (url.startsWith('http://') || url.startsWith('https://')) {
          img.crossOrigin = 'anonymous';
        }
        img.onload = () => {
          if ((img.naturalWidth || img.width) > 0 && (img.naturalHeight || img.height) > 0) {
            resolve(img);
          } else {
            reject(new Error('Ảnh có kích thước 0px'));
          }
        };
        img.onerror = () => {
          reject(new Error('Không thể tải URL ảnh'));
        };
        img.src = url;
      });

    const loadRawImage = async (url: string): Promise<HTMLImageElement> => {
      const candidates = buildAdventureAssetCandidateUrls(url);
      let lastError: unknown = new Error('Không thể tải URL ảnh');
      for (const candidateUrl of candidates) {
        try {
          return await loadSingleUrlImage(candidateUrl);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    };

    const loadSlotWithFallback = async (
      slotName: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE',
      primaryUrl: string,
      fallbackUrl: string
    ): Promise<{
      slotName: 'BACKGROUND' | 'CHARACTER' | 'OBSTACLE';
      img: HTMLImageElement | null;
      usedUrl: string;
      usedFallback: boolean;
    }> => {
      try {
        const img = await loadRawImage(primaryUrl);
        return { slotName, img, usedUrl: primaryUrl, usedFallback: false };
      } catch {
        if (fallbackUrl && fallbackUrl !== primaryUrl) {
          try {
            const fbImg = await loadRawImage(fallbackUrl);
            return { slotName, img: fbImg, usedUrl: fallbackUrl, usedFallback: true };
          } catch {
            // Fall through to universal EDUCATION_GENERAL pack or procedural canvas sprite
          }
        }
        const universalFallbackUrl = `/adventure-assets/packs/EDUCATION_GENERAL/${slotName.toLowerCase()}.png`;
        if (universalFallbackUrl !== primaryUrl && universalFallbackUrl !== fallbackUrl) {
          try {
            const uniImg = await loadRawImage(universalFallbackUrl);
            return { slotName, img: uniImg, usedUrl: universalFallbackUrl, usedFallback: true };
          } catch {
            // Fall through to procedural canvas fallback
          }
        }
        return { slotName, img: null, usedUrl: universalFallbackUrl, usedFallback: true };
      }
    };

    Promise.all([
      loadSlotWithFallback('BACKGROUND', background.url, fallbackAssets.background.url),
      loadSlotWithFallback('CHARACTER', character.url, fallbackAssets.character.url),
      loadSlotWithFallback('OBSTACLE', obstacle.url, fallbackAssets.obstacle.url),
    ]).then(([bgRes, charRes, obsRes]) => {
      if (cancelled) return;

      const fallbackUsedSlots = new Set<string>(resolvedAssets.missingOrInvalidAssets);
      if (bgRes.usedFallback) fallbackUsedSlots.add('BACKGROUND');
      if (charRes.usedFallback) fallbackUsedSlots.add('CHARACTER');
      if (obsRes.usedFallback) fallbackUsedSlots.add('OBSTACLE');

      loadedSpritesRef.current = {
        background: bgRes.img
          ? prepareCleanSprite(bgRes.img, true, `bg:${bgRes.usedUrl}`)
          : null,
        character: charRes.img
          ? prepareCleanSprite(charRes.img, false, `char:${charRes.usedUrl}`)
          : null,
        obstacle: obsRes.img
          ? prepareCleanSprite(obsRes.img, false, `obs:${obsRes.usedUrl}`)
          : null,
      };
      setFailedAssetSlots(Array.from(fallbackUsedSlots));
      setAssetLoadError(null);
      setAssetLoadStatus('READY');
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedAssets, effectiveConfig.industryId, effectiveConfig.themePresetId]);

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

  // Synchronize live session progress (e.g., on page reload recovery in SoloPlayer or Host question advance in Multiplayer)
  useEffect(() => {
    if (mode !== 'LIVE_SESSION') return;
    if (currentQuestionIndex > unlockedStageCount || (isMultiplayer && currentQuestionIndex !== activeStageIndex)) {
      const targetStage = Math.max(0, Math.min(currentQuestionIndex, totalStages - 1));
      setUnlockedStageCount(currentQuestionIndex);
      setActiveStageIndex(targetStage);

      const p = physicsRef.current;
      p.unlockedStageCount = currentQuestionIndex;
      p.activeStageIndex = targetStage;
      const prevCpX =
        currentQuestionIndex > 0 ? p.checkpointPositions[currentQuestionIndex - 1] : undefined;
      if (isMultiplayer) {
        // When Host advances to a new stage, close the previous checkpoint modal and start running from the unlocked gate
        if (!effectiveLiveFeedback && !multiplayerIsAnswerSubmitted) {
          setCheckpointModalOpen(false);
          p.isAtCheckpoint = false;
          if (prevCpX !== undefined && p.playerX < prevCpX + 20) {
            p.playerX = prevCpX + 36;
          } else if (currentQuestionIndex === 0 && p.playerX > p.checkpointPositions[0] - 40) {
            p.playerX = RUNNER_START_X;
          }
          p.playerY = 0;
          p.vy = 0;
          p.isGrounded = true;
          p.jumpState = 'GROUNDED';
          p.cameraX = Math.max(0, p.playerX - 180);
        }
      } else if (prevCpX !== undefined && p.playerX < prevCpX) {
        p.playerX = prevCpX + 36;
        p.playerY = 0;
        p.vy = 0;
        p.isGrounded = true;
        p.jumpState = 'GROUNDED';
        p.isAtCheckpoint = false;
        p.cameraX = Math.max(0, p.playerX - 180);
      }
    }
  }, [
    mode,
    currentQuestionIndex,
    unlockedStageCount,
    activeStageIndex,
    totalStages,
    isMultiplayer,
    effectiveLiveFeedback,
    multiplayerIsAnswerSubmitted,
  ]);

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

  const handleOpenCheckpointImmediately = useCallback(() => {
    const targetStage = Math.max(
      0,
      Math.min(
        mode === 'LIVE_SESSION' ? currentQuestionIndex : activeStageIndex,
        totalStages - 1
      )
    );
    const p = physicsRef.current;
    const cpX = p.checkpointPositions[targetStage];
    if (cpX !== undefined) {
      p.playerX = Math.max(p.playerX, cpX - RUNNER_CHECKPOINT_STOP_OFFSET);
      p.playerY = 0;
      p.vx = 0;
      p.vy = 0;
      p.isGrounded = true;
      p.jumpState = 'GROUNDED';
      p.isAtCheckpoint = true;
      p.activeStageIndex = targetStage;
      p.cameraX = Math.max(0, p.playerX - 200);
      for (const obs of p.obstacles) {
        if (obs.stageIndex <= targetStage && obs.x < p.playerX) {
          obs.cleared = true;
        }
      }
      setJourneyProgressPercent(
        Math.min(100, Math.max(0, Math.round((p.playerX / Math.max(1, p.finishLineX)) * 100)))
      );
    }
    setActiveStageIndex(targetStage);
    setCheckpointModalOpen(true);
  }, [mode, currentQuestionIndex, activeStageIndex, totalStages]);

  // In Multiplayer, automatically open the checkpoint modal if the player has already submitted,
  // if the Host/timer revealed the question, or if <= 5 seconds remain so slow runners never miss answering.
  useEffect(() => {
    if (!isMultiplayer || mode !== 'LIVE_SESSION' || isJourneyFinished) return;
    if (activeFeedback || multiplayerIsAnswerSubmitted) {
      if (!checkpointModalOpen) {
        handleOpenCheckpointImmediately();
      }
      return;
    }
    if (
      currentQuestion &&
      !checkpointModalOpen &&
      typeof timeRemaining === 'number' &&
      timeRemaining <= 5
    ) {
      handleOpenCheckpointImmediately();
    }
  }, [
    isMultiplayer,
    mode,
    isJourneyFinished,
    activeFeedback,
    multiplayerIsAnswerSubmitted,
    currentQuestion,
    checkpointModalOpen,
    timeRemaining,
    handleOpenCheckpointImmediately,
  ]);

  useEffect(() => {
    onCheckpointModalChange?.(activeModalOpen, activeStageIndex);
  }, [activeModalOpen, activeStageIndex, onCheckpointModalChange]);

  useEffect(() => {
    if (isJourneyFinished) {
      setJourneyProgressPercent(100);
    }
  }, [isJourneyFinished]);

  // Reset question input controls when activeQuestion changes or when feedback is reset after inline edit
  useEffect(() => {
    if (!activeFeedback) {
      submittedStageIndicesRef.current.delete(activeStageIndex);
      submittingStageLockRef.current = false;
    }
  }, [activeFeedback, activeStageIndex, activeQuestion?.question, (activeQuestion as any)?.correctAnswer]);

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
    soundManager.playSelect();
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
    soundManager.startSessionAudio({
      ...(game.settings?.audioConfig || {}),
      sessionMode: game.settings?.sessionMode || 'PLAY',
      answersPublished: Boolean(game.settings?.answersPublished),
    });
    soundManager.playStart();
    if (mode === 'LIVE_SESSION' && effectiveOnStartSession) {
      await effectiveOnStartSession();
    }
    setIsJourneyStarted(true);
    setIsPaused(false);
  }, [assetLoadStatus, mode, effectiveOnStartSession, game.settings]);

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
      soundManager.playAdventureJump();
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
      if (
        !activeQuestion ||
        activeFeedback ||
        submittingAnswer ||
        (isMultiplayer && multiplayerIsAnswerSubmitted)
      ) {
        return;
      }
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
          if (isMultiplayer) {
            soundManager.playSelect();
          }
          await effectiveOnSubmitAnswer(trimmed);
          return;
        }

        const fullQ = activeQuestion as Partial<GameQuestion>;
        const isCorrect = evaluateRunnerPreviewAnswer(activeQuestion, trimmed);
        if (isCorrect) {
          soundManager.playCorrect();
        } else {
          soundManager.playWrong();
        }
        const pts = isCorrect ? 100 : 0;
        setPreviewScore(prev => prev + pts);
        if (isCorrect) {
          setPreviewCorrectCount(prev => prev + 1);
        }
        setPreviewAnswerResult({
          isCorrect,
          pointsEarned: pts,
          correctAnswer: fullQ.correctAnswer || '',
          explanation: fullQ.explanation || '',
        });
      } catch (err) {
        submittedStageIndicesRef.current.delete(activeStageIndex);
        throw err;
      } finally {
        submittingStageLockRef.current = false;
      }
    },
    [
      activeQuestion,
      activeFeedback,
      submittingAnswer,
      isMultiplayer,
      multiplayerIsAnswerSubmitted,
      activeStageIndex,
      mode,
      effectiveOnSubmitAnswer,
    ]
  );

  const handleContinueJourney = useCallback(async () => {
    if (!activeFeedback) return;

    if (isMultiplayer) {
      // In Multiplayer, the Host controls advancing to the next question.
      // Closing the modal lets the player view the 2D scene at the checkpoint gate while waiting for Host.
      setCheckpointModalOpen(false);
      if (effectiveOnNextQuestion) {
        await effectiveOnNextQuestion();
      }
      return;
    }

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
  }, [activeFeedback, isMultiplayer, totalStages, activeStageIndex, mode, effectiveOnNextQuestion]);

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
    soundManager.stopAll();
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

      if (stepEvents.collidedObstacleIds.length > 0) {
        soundManager.playAdventureHit();
      }
      if (stepEvents.reachedCheckpointIndex !== null) {
        soundManager.playAdventureCheckpoint();
        setActiveStageIndex(stepEvents.reachedCheckpointIndex);
        setCheckpointModalOpen(true);
      }
      if (stepEvents.reachedFinish && mode === 'CREATOR_PREVIEW' && !previewFinished) {
        soundManager.stopAll();
        soundManager.playVictory();
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

  const [isLightTheme, setIsLightTheme] = useState<boolean>(() => {
    try {
      return (
        document.documentElement.getAttribute('data-theme') === 'light' ||
        localStorage.getItem('app_theme') === 'light' ||
        localStorage.getItem('ai_game_theme') === 'light'
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const syncTheme = () => {
      try {
        const attr = document.documentElement.getAttribute('data-theme');
        if (attr === 'light' || attr === 'dark') {
          setIsLightTheme(attr === 'light');
        }
      } catch {
        // ignore
      }
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const accentHex = effectiveConfig.palette.accentColor || '#38bdf8';
  const getReadableAccentInk = (hex: string): string => {
    const clean = (hex || '').replace('#', '').trim();
    if (clean.length !== 6) return '#ffffff';
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const toLin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
    return lum > 0.42 ? '#090d16' : '#ffffff';
  };
  const accentInk = getReadableAccentInk(accentHex);

  const uiTheme = isLightTheme
    ? {
        backdropBg: 'rgba(15, 23, 42, 0.58)',
        cardBg: '#ffffff',
        cardBorder: '#cbd5e1',
        cardShadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
        subCardBg: '#f8fafc',
        subCardBorder: '#cbd5e1',
        inputBg: '#ffffff',
        inputBorder: '#94a3b8',
        textPrimary: '#0f172a',
        textSecondary: '#334155',
        textMuted: '#475569',
        choiceBg: '#f8fafc',
        choiceBorder: '#cbd5e1',
        choiceText: '#0f172a',
        choiceSelectedBg: '#eff6ff',
        choiceCorrectBg: '#dcfce7',
        choiceCorrectBorder: '#16a34a',
        choiceCorrectText: '#14532d',
        choiceWrongBg: '#ffe4e6',
        choiceWrongBorder: '#e11d48',
        choiceWrongText: '#881337',
        choiceBadgeBg: '#e2e8f0',
        choiceBadgeText: '#0f172a',
        typeBadgeBg: '#e0f2fe',
        typeBadgeBorder: '#7dd3fc',
        typeBadgeText: '#0369a1',
        timerNormalBg: '#fef3c7',
        timerNormalBorder: '#d97706',
        timerNormalText: '#92400e',
        timerUrgentBg: '#ffe4e6',
        timerUrgentBorder: '#e11d48',
        timerUrgentText: '#9f1239',
        feedbackExamBg: '#e0f2fe',
        feedbackExamBorder: '#0284c7',
        feedbackExamText: '#0c4a6e',
        continueBtnBg: '#0f172a',
        continueBtnText: '#ffffff',
      }
    : {
        backdropBg: 'rgba(9, 13, 22, 0.88)',
        cardBg: '#111726',
        cardBorder: '#26334d',
        cardShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
        subCardBg: '#0b0f19',
        subCardBorder: '#26334d',
        inputBg: '#161f30',
        inputBorder: '#26334d',
        textPrimary: '#f8fafc',
        textSecondary: '#e2e8f0',
        textMuted: '#94a3b8',
        choiceBg: '#161f30',
        choiceBorder: '#26334d',
        choiceText: '#f8fafc',
        choiceSelectedBg: '#1e293b',
        choiceCorrectBg: '#143321',
        choiceCorrectBorder: '#3fc07a',
        choiceCorrectText: '#86efac',
        choiceWrongBg: '#3b1822',
        choiceWrongBorder: '#f43f5e',
        choiceWrongText: '#fda4af',
        choiceBadgeBg: '#0b0f19',
        choiceBadgeText: '#cbd5e1',
        typeBadgeBg: 'rgba(56, 189, 248, 0.14)',
        typeBadgeBorder: 'rgba(56, 189, 248, 0.35)',
        typeBadgeText: '#38bdf8',
        timerNormalBg: 'rgba(245, 158, 11, 0.18)',
        timerNormalBorder: '#f59e0b',
        timerNormalText: '#fde68a',
        timerUrgentBg: 'rgba(239, 68, 68, 0.2)',
        timerUrgentBorder: '#ef4444',
        timerUrgentText: '#fca5a5',
        feedbackExamBg: '#161f30',
        feedbackExamBorder: '#38bdf8',
        feedbackExamText: '#38bdf8',
        continueBtnBg: '#f8fafc',
        continueBtnText: '#090d16',
      };

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
        overscrollBehavior: 'contain',
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
          <div
            style={
              isMultiplayer
                ? {
                    paddingRight: '10px',
                    borderRight: '1px solid rgba(148, 163, 184, 0.2)',
                  }
                : undefined
            }
          >
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

          {isMultiplayer && (
            <div data-testid="adventure-mp-room-badge">
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#38bdf8' }}>
                CHƠI NHÓM · PHÒNG {multiplayerRoomCode}
              </div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 800,
                  color: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{multiplayerPlayerName || 'Người chơi'}</span>
                {multiplayerStreak > 1 && (
                  <span style={{ color: '#fb923c', fontSize: '11.5px', fontWeight: 900 }}>
                    🔥 x{multiplayerStreak}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action controls: Pause/Resume & Exit */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            pointerEvents: 'auto',
          }}
        >
          {isMultiplayer && multiplayerIsReconnecting && (
            <div
              data-testid="adventure-mp-reconnecting-badge"
              style={{
                padding: '6px 12px',
                borderRadius: '10px',
                backgroundColor: 'rgba(245, 158, 11, 0.22)',
                border: '1.5px solid #f59e0b',
                color: '#fde68a',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              ⏳ Đang kết nối lại...
            </div>
          )}
          {isMultiplayer && multiplayerIsHostDisconnected && (
            <div
              data-testid="adventure-mp-host-disconnected-badge"
              style={{
                padding: '6px 12px',
                borderRadius: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.22)',
                border: '1.5px solid #ef4444',
                color: '#fca5a5',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              ⚠️ Chủ phòng tạm mất kết nối
            </div>
          )}
          {isMultiplayer &&
            isJourneyStarted &&
            !isJourneyFinished &&
            !activeModalOpen &&
            !activeFeedback &&
            !multiplayerIsAnswerSubmitted &&
            currentQuestion && (
              <button
                type="button"
                data-testid="mp-open-checkpoint-btn"
                onClick={handleOpenCheckpointImmediately}
                style={{
                  minHeight: '44px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  backgroundColor: accentHex,
                  border: 'none',
                  color: accentInk,
                  fontSize: '12.5px',
                  fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
                }}
              >
                ⚡ Mở câu hỏi Trạm #{activeStageIndex + 1}
                {typeof timeRemaining === 'number' ? ` (${timeRemaining}s)` : ''}
              </button>
            )}
          {isMultiplayer &&
            isJourneyStarted &&
            !isJourneyFinished &&
            !activeModalOpen &&
            (Boolean(activeFeedback) || multiplayerIsAnswerSubmitted) && (
              <button
                type="button"
                data-testid="adventure-mp-waiting-host"
                onClick={() => setCheckpointModalOpen(true)}
                style={{
                  minHeight: '44px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(15, 23, 42, 0.92)',
                  border: `1.5px solid ${accentHex}`,
                  color: '#f8fafc',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ⏳ Đang chờ Chủ phòng mở Chặng tiếp theo · Xem trạm
              </button>
            )}
          {isPlaytest && (
            <div
              data-testid="playtest-mode-banner"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '38px',
                padding: '0 12px',
                borderRadius: '10px',
                backgroundColor: isDemoMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.18)',
                border: isDemoMode ? '1.5px solid rgba(16, 185, 129, 0.55)' : '1.5px solid rgba(245, 158, 11, 0.5)',
                color: isDemoMode ? '#34d399' : '#fbbf24',
                fontSize: '11.5px',
                fontWeight: 900,
                letterSpacing: '0.03em',
              }}
            >
              <span>{isDemoMode ? 'XEM DEMO' : 'CHẾ ĐỘ CHƠI THỬ'}</span>
            </div>
          )}
          {onToggleAudioMute && (
            <button
              type="button"
              data-testid="audio-mute-toggle-btn"
              onClick={onToggleAudioMute}
              style={{
                minHeight: '44px',
                minWidth: '44px',
                padding: '0 14px',
                borderRadius: '10px',
                backgroundColor: 'rgba(15, 23, 42, 0.88)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                color: audioMuted ? '#94a3b8' : '#38bdf8',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
              title={audioMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            >
              {audioMuted ? '🔇 Đã tắt tiếng' : '🔊 Âm thanh'}
            </button>
          )}
          {isJourneyStarted && !isJourneyFinished && assetLoadStatus === 'READY' && (
            <button
              type="button"
              data-testid="hud-pause-button"
              onClick={() => setIsPaused(p => !p)}
              style={{
                minHeight: '44px',
                minWidth: '44px',
                padding: '0 14px',
                borderRadius: '10px',
                backgroundColor: isPaused ? accentHex : 'rgba(15, 23, 42, 0.88)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                color: isPaused ? accentInk : '#f8fafc',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
            </button>
          )}
          {isPlaytest ? (
            <button
              type="button"
              data-testid="exit-playtest-btn"
              onClick={handleExitGame}
              style={{
                minHeight: '44px',
                minWidth: '44px',
                padding: '0 14px',
                borderRadius: '10px',
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                border: '1.5px solid rgba(245, 158, 11, 0.55)',
                color: '#fde68a',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isDemoMode ? 'Đóng demo' : 'Thoát chơi thử'}
            </button>
          ) : (
            <button
              type="button"
              data-testid="hud-exit-button"
              onClick={handleExitGame}
              style={{
                minHeight: '44px',
                minWidth: '44px',
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
          )}
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
              backgroundColor: uiTheme.backdropBg,
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
                backgroundColor: uiTheme.cardBg,
                border: `2px solid ${accentHex}`,
                borderRadius: '16px',
                padding: '26px 24px',
                color: uiTheme.textPrimary,
                boxShadow: uiTheme.cardShadow,
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
                  color: uiTheme.textPrimary,
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
                  backgroundColor: uiTheme.subCardBg,
                  border: `1px solid ${uiTheme.subCardBorder}`,
                  fontSize: '14.5px',
                  fontWeight: 600,
                  color: uiTheme.textSecondary,
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
                  minHeight: '46px',
                  borderRadius: '10px',
                  backgroundColor:
                    assetLoadStatus === 'READY' && !startingSession ? accentHex : '#334155',
                  border: 'none',
                  color: assetLoadStatus === 'READY' && !startingSession ? accentInk : '#ffffff',
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
              backgroundColor: uiTheme.backdropBg,
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
                backgroundColor: uiTheme.cardBg,
                border: `1.5px solid ${uiTheme.cardBorder}`,
                borderRadius: '14px',
                padding: '24px',
                textAlign: 'center',
                color: uiTheme.textPrimary,
                boxShadow: uiTheme.cardShadow,
              }}
            >
              <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', fontWeight: 800, color: uiTheme.textPrimary }}>
                Đang tạm dừng màn chơi
              </h3>
              <p style={{ margin: '0 0 18px 0', fontSize: '13.5px', color: uiTheme.textMuted }}>
                Tiến trình hiện tại tại Chặng {Math.min(activeStageIndex + 1, totalStages)}/{totalStages} được giữ nguyên.
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="resume-adventure-btn"
                  onClick={() => setIsPaused(false)}
                  style={{
                    minHeight: '44px',
                    padding: '0 20px',
                    borderRadius: '8px',
                    backgroundColor: accentHex,
                    border: 'none',
                    color: accentInk,
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
                    minHeight: '44px',
                    padding: '0 18px',
                    borderRadius: '8px',
                    backgroundColor: uiTheme.choiceBg,
                    border: `1px solid ${uiTheme.choiceBorder}`,
                    color: uiTheme.textPrimary,
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
              backgroundColor: uiTheme.backdropBg,
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
              data-theme-mode={isLightTheme ? 'light' : 'dark'}
              style={{
                width: '100%',
                maxWidth: '680px',
                backgroundColor: uiTheme.cardBg,
                border: `2px solid ${accentHex}`,
                borderRadius: '14px',
                padding: 'clamp(16px, 3vw, 22px)',
                color: uiTheme.textPrimary,
                boxShadow: uiTheme.cardShadow,
                boxSizing: 'border-box',
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
                      backgroundColor: uiTheme.typeBadgeBg,
                      border: `1px solid ${uiTheme.typeBadgeBorder}`,
                      color: uiTheme.typeBadgeText,
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {isPlaytest && onPrevCheckpointQuestion && activeStageIndex > 0 && (
                    <button
                      type="button"
                      data-testid="playtest-prev-question-btn"
                      onClick={() => {
                        const prevIdx = Math.max(0, activeStageIndex - 1);
                        submittedStageIndicesRef.current.delete(prevIdx);
                        setActiveStageIndex(prevIdx);
                        physicsRef.current.activeStageIndex = prevIdx;
                        onPrevCheckpointQuestion();
                      }}
                      style={{
                        padding: '6px 12px',
                        minHeight: '38px',
                        borderRadius: '8px',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        backgroundColor: uiTheme.subCardBg,
                        border: `1px solid ${uiTheme.choiceBorder}`,
                        color: uiTheme.textPrimary,
                        cursor: 'pointer',
                      }}
                    >
                      ← Câu trước
                    </button>
                  )}
                  {isPlaytest && !isDemoMode && onEditCheckpointQuestion && (
                    <button
                      type="button"
                      data-testid="playtest-inline-edit-btn"
                      onClick={() => onEditCheckpointQuestion(activeStageIndex)}
                      style={{
                        padding: '6px 12px',
                        minHeight: '38px',
                        borderRadius: '8px',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        backgroundColor: uiTheme.timerNormalBg,
                        border: `1px solid ${uiTheme.timerNormalBorder}`,
                        color: uiTheme.timerNormalText,
                        cursor: 'pointer',
                      }}
                    >
                      ✎ Chỉnh sửa câu này
                    </button>
                  )}
                  {mode === 'LIVE_SESSION' && typeof timeRemaining === 'number' && !activeFeedback && (
                    <span
                      data-testid="checkpoint-timer-badge"
                      style={{
                        padding: '2px 9px',
                        borderRadius: '999px',
                        fontSize: '12px',
                        fontWeight: 900,
                        backgroundColor:
                          timeRemaining <= 5
                            ? uiTheme.timerUrgentBg
                            : uiTheme.timerNormalBg,
                        border: `1px solid ${timeRemaining <= 5 ? uiTheme.timerUrgentBorder : uiTheme.timerNormalBorder}`,
                        color: timeRemaining <= 5 ? uiTheme.timerUrgentText : uiTheme.timerNormalText,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      ⏱ {timeRemaining}s
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: uiTheme.textMuted, fontWeight: 600 }}>
                    Nhân vật đã dừng — Trả lời để mở cổng đi tiếp
                  </span>
                </div>
              </div>

              <div
                data-testid="checkpoint-question-text"
                style={{
                  fontSize: '17px',
                  fontWeight: 700,
                  color: uiTheme.textPrimary,
                  lineHeight: 1.45,
                }}
              >
                {activeQuestion.question}
              </div>

              {/* Answer Input Area */}
              <div>
                {(() => {
                  const isInputLocked =
                    Boolean(activeFeedback) ||
                    submittingAnswer ||
                    Boolean(isMultiplayer && multiplayerIsAnswerSubmitted);
                  return activeQuestion.type === 'SLIDER' && activeQuestion.sliderConfig ? (
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
                            backgroundColor: uiTheme.subCardBg,
                            border: `1px solid ${uiTheme.subCardBorder}`,
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
                            <span style={{ fontSize: '12.5px', fontWeight: 700, color: uiTheme.textMuted }}>
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
                                disabled={isInputLocked}
                                onChange={e => {
                                  const parsed = Number(e.target.value);
                                  if (Number.isFinite(parsed)) {
                                    setSliderValue(clampVal(parsed));
                                  }
                                }}
                                style={{
                                  width: '100px',
                                  minHeight: '44px',
                                  padding: '0 10px',
                                  borderRadius: '8px',
                                  backgroundColor: uiTheme.inputBg,
                                  border: `1.5px solid ${accentHex}`,
                                  color: uiTheme.textPrimary,
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
                            disabled={isInputLocked}
                            onChange={e => setSliderValue(clampVal(Number(e.target.value)))}
                            style={{
                              width: '100%',
                              accentColor: accentHex,
                              cursor: isInputLocked ? 'default' : 'pointer',
                            }}
                          />
                          {!isInputLocked && (
                            <button
                              type="button"
                              disabled={isInputLocked}
                              onClick={() => handleAnswerSubmit(String(clampVal(currentVal)))}
                              style={{
                                minHeight: '44px',
                                padding: '0 20px',
                                borderRadius: '8px',
                                backgroundColor: accentHex,
                                border: 'none',
                                color: accentInk,
                                fontSize: '14px',
                                fontWeight: 800,
                                cursor: isInputLocked ? 'not-allowed' : 'pointer',
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
                    <div style={{ fontSize: '12px', fontWeight: 700, color: uiTheme.textMuted }}>
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
                            backgroundColor: uiTheme.choiceBg,
                            border: `1.5px solid ${uiTheme.choiceBorder}`,
                            color: uiTheme.textPrimary,
                          }}
                        >
                          <span
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              backgroundColor: uiTheme.choiceBadgeBg,
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
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              disabled={isInputLocked || idx === 0}
                              onClick={() => handleMovePuzzleItem(idx, -1)}
                              style={{
                                minWidth: '44px',
                                minHeight: '44px',
                                borderRadius: '6px',
                                border: `1px solid ${uiTheme.choiceBorder}`,
                                backgroundColor: uiTheme.subCardBg,
                                color: idx === 0 ? uiTheme.textMuted : uiTheme.textPrimary,
                                fontWeight: 800,
                                cursor:
                                  isInputLocked || idx === 0
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={
                                isInputLocked ||
                                idx === arr.length - 1
                              }
                              onClick={() => handleMovePuzzleItem(idx, 1)}
                              style={{
                                minWidth: '44px',
                                minHeight: '44px',
                                borderRadius: '6px',
                                border: `1px solid ${uiTheme.choiceBorder}`,
                                backgroundColor: uiTheme.subCardBg,
                                color: idx === arr.length - 1 ? uiTheme.textMuted : uiTheme.textPrimary,
                                fontWeight: 800,
                                cursor:
                                  isInputLocked ||
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
                    {!isInputLocked && (
                      <button
                        type="button"
                        disabled={isInputLocked}
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
                          minHeight: '44px',
                          padding: '0 20px',
                          borderRadius: '8px',
                          backgroundColor: accentHex,
                          border: 'none',
                          color: accentInk,
                          fontSize: '14px',
                          fontWeight: 800,
                          cursor: isInputLocked ? 'not-allowed' : 'pointer',
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
                          backgroundColor: uiTheme.subCardBg,
                          border: `1px solid ${uiTheme.subCardBorder}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        {clueText && (
                          <div
                            data-testid="checkpoint-crossword-clue"
                            style={{ fontSize: '13.5px', color: uiTheme.textSecondary, lineHeight: 1.45 }}
                          >
                            <strong style={{ color: accentHex }}>Gợi ý ô chữ:</strong> {clueText}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: uiTheme.textMuted }}>
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
                                    backgroundColor: ch ? uiTheme.choiceBg : uiTheme.inputBg,
                                    border: `1.5px solid ${ch ? accentHex : uiTheme.choiceBorder}`,
                                    color: uiTheme.textPrimary,
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
                            disabled={isInputLocked}
                            onChange={e => setTextAnswer(e.target.value.toUpperCase())}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && textAnswer.trim() && !isInputLocked) {
                                e.preventDefault();
                                handleAnswerSubmit(normalizeCrosswordAnswerForRunner(textAnswer) || textAnswer.trim());
                              }
                            }}
                            placeholder="Nhập từ khóa ô chữ (VD:ANTOAN)..."
                            style={{
                              flex: '1 1 220px',
                              minHeight: '44px',
                              padding: '0 14px',
                              borderRadius: '8px',
                              backgroundColor: uiTheme.inputBg,
                              border: `1.5px solid ${accentHex}`,
                              color: uiTheme.textPrimary,
                              fontSize: '15px',
                              fontWeight: 800,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}
                          />
                          {!isInputLocked && (
                            <button
                              type="button"
                              data-testid="checkpoint-submit-answer-btn"
                              disabled={!textAnswer.trim() || isInputLocked}
                              onClick={() =>
                                handleAnswerSubmit(
                                  normalizeCrosswordAnswerForRunner(textAnswer) || textAnswer.trim()
                                )
                              }
                              style={{
                                minHeight: '44px',
                                padding: '0 20px',
                                borderRadius: '8px',
                                backgroundColor: accentHex,
                                border: 'none',
                                color: accentInk,
                                fontSize: '14px',
                                fontWeight: 800,
                                cursor:
                                  !textAnswer.trim() || isInputLocked ? 'not-allowed' : 'pointer',
                                opacity: !textAnswer.trim() || isInputLocked ? 0.5 : 1,
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
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
                      gap: '10px',
                      marginTop: '14px',
                    }}
                  >
                    {activeQuestion.choices.map((choice, cIdx) => {
                      const isSelected =
                        selectedChoice === choice ||
                        Boolean(
                          isMultiplayer &&
                            multiplayerIsAnswerSubmitted &&
                            multiplayerSubmittedAnswerText === choice
                        );
                      const isExamQuestionRedacted =
                        game.settings?.sessionMode === 'EXAM' &&
                        !game.settings?.answersPublished &&
                        !isPlaytest &&
                        game.settings?.examAnswerRevealPolicy !== 'IMMEDIATE' &&
                        Boolean(
                          (activeFeedback as any)?.examAnswerRecorded ||
                            (activeFeedback as any)?.examRedacted ||
                            !activeFeedback?.correctAnswer
                        );
                      const normChoice = choice
                        .replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '')
                        .trim()
                        .toLowerCase();
                      const normCorrect = (activeFeedback?.correctAnswer || '')
                        .replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '')
                        .trim()
                        .toLowerCase();
                      const isCorrectChoice = Boolean(
                        activeFeedback &&
                          !isExamQuestionRedacted &&
                          activeFeedback.correctAnswer &&
                          (choice.trim().toLowerCase() ===
                            activeFeedback.correctAnswer.trim().toLowerCase() ||
                            (normChoice && normChoice === normCorrect))
                      );
                      const isWrongSelected = Boolean(
                        activeFeedback &&
                          !isExamQuestionRedacted &&
                          isSelected &&
                          !activeFeedback.isCorrect &&
                          !(activeFeedback as any)?.timedOut
                      );

                      let bg = uiTheme.choiceBg;
                      let border = uiTheme.choiceBorder;
                      let textColor = uiTheme.choiceText;

                      if (isCorrectChoice) {
                        bg = uiTheme.choiceCorrectBg;
                        border = uiTheme.choiceCorrectBorder;
                        textColor = uiTheme.choiceCorrectText;
                      } else if (isWrongSelected) {
                        bg = uiTheme.choiceWrongBg;
                        border = uiTheme.choiceWrongBorder;
                        textColor = uiTheme.choiceWrongText;
                      } else if (isSelected) {
                        bg = uiTheme.choiceSelectedBg;
                        border = accentHex;
                      }

                      return (
                        <button
                          key={`${cIdx}_${choice}`}
                          type="button"
                          data-testid={`checkpoint-choice-${cIdx}`}
                          data-feedback-state={
                            isCorrectChoice
                              ? 'correct'
                              : isWrongSelected
                                ? 'wrong'
                                : isSelected
                                  ? 'selected'
                                  : 'neutral'
                          }
                          disabled={isInputLocked}
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
                            cursor: isInputLocked ? 'default' : 'pointer',
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
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
                      gap: '8px',
                      marginTop: '14px',
                    }}
                  >
                    {activeQuestion.choices.map((choice, cIdx) => {
                      const isSelected =
                        selectedChoice === choice ||
                        Boolean(
                          isMultiplayer &&
                            multiplayerIsAnswerSubmitted &&
                            multiplayerSubmittedAnswerText === choice
                        );
                      const isExamQuestionRedacted =
                        game.settings?.sessionMode === 'EXAM' &&
                        !game.settings?.answersPublished &&
                        !isPlaytest &&
                        game.settings?.examAnswerRevealPolicy !== 'IMMEDIATE' &&
                        Boolean(
                          (activeFeedback as any)?.examAnswerRecorded ||
                            (activeFeedback as any)?.examRedacted ||
                            !activeFeedback?.correctAnswer
                        );
                      const normChoice = choice
                        .replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '')
                        .trim()
                        .toLowerCase();
                      const normCorrect = (activeFeedback?.correctAnswer || '')
                        .replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '')
                        .trim()
                        .toLowerCase();
                      const isCorrectChoice = Boolean(
                        activeFeedback &&
                          !isExamQuestionRedacted &&
                          activeFeedback.correctAnswer &&
                          (choice.trim().toLowerCase() ===
                            activeFeedback.correctAnswer.trim().toLowerCase() ||
                            (normChoice && normChoice === normCorrect))
                      );
                      const isWrongSelected = Boolean(
                        activeFeedback &&
                          !isExamQuestionRedacted &&
                          isSelected &&
                          !activeFeedback.isCorrect &&
                          !(activeFeedback as any)?.timedOut
                      );

                      let bg = uiTheme.choiceBg;
                      let border = uiTheme.choiceBorder;
                      let textColor = uiTheme.choiceText;

                      if (isCorrectChoice) {
                        bg = uiTheme.choiceCorrectBg;
                        border = uiTheme.choiceCorrectBorder;
                        textColor = uiTheme.choiceCorrectText;
                      } else if (isWrongSelected) {
                        bg = uiTheme.choiceWrongBg;
                        border = uiTheme.choiceWrongBorder;
                        textColor = uiTheme.choiceWrongText;
                      } else if (isSelected) {
                        bg = uiTheme.choiceSelectedBg;
                        border = accentHex;
                      }

                      return (
                        <button
                          key={`${cIdx}_${choice}`}
                          type="button"
                          data-testid={`checkpoint-choice-${cIdx}`}
                          data-feedback-state={
                            isCorrectChoice
                              ? 'correct'
                              : isWrongSelected
                                ? 'wrong'
                                : isSelected
                                  ? 'selected'
                                  : 'neutral'
                          }
                          disabled={isInputLocked}
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
                            cursor: isInputLocked ? 'default' : 'pointer',
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
                              backgroundColor: uiTheme.choiceBadgeBg,
                              color: uiTheme.choiceBadgeText,
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
                      disabled={isInputLocked}
                      onChange={e => setTextAnswer(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && textAnswer.trim() && !isInputLocked) {
                          e.preventDefault();
                          handleAnswerSubmit(textAnswer.trim());
                        }
                      }}
                      placeholder="Nhập từ khóa còn thiếu..."
                      style={{
                        flex: '1 1 220px',
                        minHeight: '44px',
                        padding: '0 14px',
                        borderRadius: '8px',
                        backgroundColor: uiTheme.inputBg,
                        border: `1.5px solid ${uiTheme.inputBorder}`,
                        color: uiTheme.textPrimary,
                        fontSize: '14px',
                      }}
                    />
                    {!isInputLocked && (
                      <button
                        type="button"
                        data-testid="checkpoint-submit-answer-btn"
                        disabled={!textAnswer.trim() || isInputLocked}
                        onClick={() => handleAnswerSubmit(textAnswer.trim())}
                        style={{
                          minHeight: '44px',
                          padding: '0 20px',
                          borderRadius: '8px',
                          backgroundColor: accentHex,
                          border: 'none',
                          color: accentInk,
                          fontSize: '14px',
                          fontWeight: 700,
                          cursor:
                            !textAnswer.trim() || isInputLocked ? 'not-allowed' : 'pointer',
                          opacity: !textAnswer.trim() || isInputLocked ? 0.5 : 1,
                        }}
                      >
                        Trả lời
                      </button>
                    )}
                  </div>
                );
                })()}
              </div>

              {/* Multiplayer Waiting for Reveal Banner */}
              {isMultiplayer && multiplayerIsAnswerSubmitted && !activeFeedback && (
                <div
                  data-testid="adventure-mp-waiting-banner"
                  style={{
                    marginTop: '14px',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    border: '1.5px solid rgba(16, 185, 129, 0.5)',
                    color: '#34d399',
                    fontSize: '13.5px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    ✓ Đã ghi nhận câu trả lời của bạn
                    {multiplayerSubmittedAnswerText
                      ? `: "${multiplayerSubmittedAnswerText}"`
                      : ''}
                    ! Đang đợi Chủ phòng / người chơi khác hoàn thành...
                  </div>
                  {typeof timeRemaining === 'number' && (
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '999px',
                        backgroundColor: 'rgba(15, 23, 42, 0.75)',
                        color: '#f8fafc',
                        fontSize: '12px',
                        fontWeight: 900,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      ⏱ {timeRemaining}s
                    </span>
                  )}
                </div>
              )}

              {/* Feedback & Continue Button */}
              {activeFeedback && (() => {
                const isExamUnpublished =
                  game.settings?.sessionMode === 'EXAM' &&
                  !game.settings?.answersPublished &&
                  !isPlaytest &&
                  game.settings?.examAnswerRevealPolicy !== 'IMMEDIATE' &&
                  Boolean(
                    (activeFeedback as any)?.examAnswerRecorded ||
                      (activeFeedback as any)?.examRedacted ||
                      !activeFeedback?.correctAnswer
                  );
                const isTimedOutFeedback =
                  (activeFeedback as PracticeQuestionResult).timedOut === true;
                return (
                <div
                  data-testid="checkpoint-feedback-panel"
                  style={{
                    marginTop: '14px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: isExamUnpublished
                      ? uiTheme.feedbackExamBg
                      : activeFeedback.isCorrect
                        ? uiTheme.choiceCorrectBg
                        : uiTheme.choiceWrongBg,
                    border: `1.5px solid ${
                      isExamUnpublished
                        ? uiTheme.feedbackExamBorder
                        : activeFeedback.isCorrect
                          ? uiTheme.choiceCorrectBorder
                          : uiTheme.choiceWrongBorder
                    }`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
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
                          color: isExamUnpublished
                            ? uiTheme.feedbackExamText
                            : activeFeedback.isCorrect
                              ? uiTheme.choiceCorrectText
                              : uiTheme.choiceWrongText,
                        }}
                      >
                        {isExamUnpublished
                          ? isTimedOutFeedback
                            ? `[HẾT THỜI GIAN TRẢ LỜI] Đã ghi nhận tự động — Cổng chắn chặng ${activeStageIndex + 1} đã mở!`
                            : `[ĐÃ GHI NHẬN CÂU TRẢ LỜI] Cổng chắn chặng ${activeStageIndex + 1} đã mở!`
                          : activeFeedback.isCorrect
                            ? `[CHÍNH XÁC · TRẢ LỜI ĐÚNG +${activeFeedback.pointsEarned}Đ] Cổng chắn chặng ${activeStageIndex + 1} đã mở!`
                            : isTimedOutFeedback
                              ? `[HẾT THỜI GIAN TRẢ LỜI · +0Đ]${activeFeedback.correctAnswer ? ` Đáp án chuẩn: ${activeFeedback.correctAnswer}` : ''}`
                              : `[CHƯA ĐÚNG · TRẢ LỜI SAI +0Đ]${activeFeedback.correctAnswer ? ` Đáp án chuẩn: ${activeFeedback.correctAnswer}` : ''}`}
                      </div>
                      {!isExamUnpublished &&
                        typeof activeFeedback.explanation === 'string' &&
                        activeFeedback.explanation.trim().length > 0 && (
                          <div
                            data-testid="checkpoint-feedback-explanation"
                            style={{
                              marginTop: '4px',
                              fontSize: '12px',
                              color: uiTheme.textSecondary,
                              lineHeight: 1.4,
                            }}
                          >
                            {activeFeedback.explanation.trim()}
                          </div>
                        )}
                      {isMultiplayer && (
                        <div
                          style={{
                            marginTop: '6px',
                            fontSize: '11.5px',
                            fontWeight: 800,
                            color: accentHex,
                          }}
                        >
                          ⏳ Chủ phòng điều khiển chuyển sang chặng tiếp theo cho toàn phòng.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      data-testid="checkpoint-continue-btn"
                      onClick={handleContinueJourney}
                      style={{
                        minHeight: '44px',
                        padding: '0 16px',
                        borderRadius: '6px',
                        backgroundColor: uiTheme.continueBtnBg,
                        border: 'none',
                        color: uiTheme.continueBtnText,
                        fontSize: '13px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {isMultiplayer
                        ? 'Đóng bảng & Chờ Chủ phòng (Space)'
                        : activeStageIndex + 1 < totalStages
                          ? 'Tiếp tục hành trình (Space)'
                          : 'Tiến về đích (Space)'}
                    </button>
                  </div>

                  {isMultiplayer &&
                    multiplayerShowLeaderboard &&
                    Array.isArray(multiplayerLeaderboard) &&
                    multiplayerLeaderboard.length > 0 && (
                      <div
                        data-testid="adventure-mp-reveal-leaderboard"
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          backgroundColor: uiTheme.subCardBg,
                          border: `1px solid ${uiTheme.subCardBorder}`,
                        }}
                      >
                        <div
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 800,
                            color: uiTheme.textMuted,
                            textTransform: 'uppercase',
                            marginBottom: '6px',
                          }}
                        >
                          🏆 Bảng xếp hạng trực tiếp (Top 5)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {multiplayerLeaderboard.slice(0, 5).map(entry => {
                            const isMe = Boolean(
                              multiplayerPlayerId && entry.playerId === multiplayerPlayerId
                            );
                            return (
                              <div
                                key={entry.playerId}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '5px 8px',
                                  borderRadius: '6px',
                                  backgroundColor: isMe
                                    ? 'rgba(56, 189, 248, 0.16)'
                                    : uiTheme.cardBg,
                                  border: `1px solid ${
                                    isMe ? '#38bdf8' : uiTheme.subCardBorder
                                  }`,
                                  fontSize: '12px',
                                  fontWeight: isMe ? 900 : 700,
                                  color: uiTheme.textPrimary,
                                }}
                              >
                                <span>
                                  #{entry.rank} {entry.displayName} {isMe ? '(Bạn)' : ''}
                                </span>
                                <span
                                  style={{
                                    color: '#34d399',
                                    fontWeight: 900,
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                >
                                  {entry.score} đ
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ================= VICTORY / FINISH OVERLAY ================= */}
        {isJourneyFinished && (() => {
          const victoryCorrectCount =
            mode === 'LIVE_SESSION'
              ? (effectiveFinalResult as PracticeFinalResult | null)?.correctCount ??
                effectiveFinalResult?.correctAnswers ??
                liveCorrectCount
              : previewCorrectCount;
          const victoryMaxScore =
            (effectiveFinalResult as PracticeFinalResult | null)?.maxPossibleScore ||
            calculateFrontendMaxPossibleScore(totalStages, game.settings?.scoringMode);
          const victoryEval =
            (effectiveFinalResult as PracticeFinalResult | null)?.performanceEvaluation ||
            evaluateFrontendPerformance({
              correctAnswers: victoryCorrectCount,
              totalQuestions: totalStages,
              sessionMode: game.settings?.sessionMode,
              passThresholdPercent: game.settings?.passThresholdPercent,
            });
          return (
          <div
            data-testid="scene-victory-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 45,
              backgroundColor: uiTheme.backdropBg,
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
                maxWidth: '580px',
                backgroundColor: uiTheme.cardBg,
                border: `1.5px solid ${uiTheme.cardBorder}`,
                borderRadius: '12px',
                padding: '26px 24px',
                color: uiTheme.textPrimary,
                boxShadow: uiTheme.cardShadow,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', color: uiTheme.choiceCorrectText, fontWeight: 700 }}>
                  HOÀN THÀNH MÀN CHƠI · {effectiveConfig.industryLabel}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {isMultiplayer && typeof multiplayerFinalRank === 'number' && multiplayerFinalRank > 0 && (
                    <span
                      data-testid="adventure-mp-final-rank"
                      style={{
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '11.5px',
                        fontWeight: 900,
                        backgroundColor: 'rgba(245, 158, 11, 0.2)',
                        border: '1.5px solid #f59e0b',
                        color: '#fbbf24',
                      }}
                    >
                      🏆 Hạng #{multiplayerFinalRank}
                      {multiplayerTotalPlayers ? ` / ${multiplayerTotalPlayers}` : ''}
                    </span>
                  )}
                  {victoryEval.isPassed !== null && (
                    <span
                      data-testid="exam-pass-status-badge"
                      style={{
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '11.5px',
                        fontWeight: 900,
                        backgroundColor: victoryEval.isPassed ? uiTheme.choiceCorrectBg : uiTheme.choiceWrongBg,
                        border: `1.5px solid ${victoryEval.isPassed ? uiTheme.choiceCorrectBorder : uiTheme.choiceWrongBorder}`,
                        color: victoryEval.isPassed ? uiTheme.choiceCorrectText : uiTheme.choiceWrongText,
                      }}
                    >
                      {victoryEval.isPassed ? '✓ ĐẠT YÊU CẦU' : '✕ CHƯA ĐẠT'} (Ngưỡng {victoryEval.passThresholdPercent}%)
                    </span>
                  )}
                </div>
              </div>
              <h2
                style={{
                  margin: '4px 0 14px 0',
                  fontSize: '23px',
                  fontWeight: 700,
                  color: uiTheme.textPrimary,
                }}
              >
                {game.title || effectiveConfig.environmentTitle}
              </h2>

              <div
                data-testid="adventure-victory-evaluation"
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: uiTheme.choiceBg,
                  border: `1px solid ${accentHex}`,
                  marginBottom: '16px',
                }}
              >
                <div
                  data-testid="result-tier-label"
                  style={{ fontSize: '15px', fontWeight: 900, color: accentHex }}
                >
                  Đánh giá: {victoryEval.tierLabel} ({victoryEval.accuracyPercentage}%)
                </div>
                <div style={{ fontSize: '12.5px', color: uiTheme.textSecondary, marginTop: '4px', lineHeight: 1.45 }}>
                  {victoryEval.comment}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  backgroundColor: uiTheme.subCardBg,
                  border: `1px solid ${uiTheme.subCardBorder}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  fontVariantNumeric: 'tabular-nums',
                  marginBottom: '22px',
                }}
              >
                <div style={{ padding: '14px 16px', borderRight: `1px solid ${uiTheme.subCardBorder}` }}>
                  <div style={{ fontSize: '12px', color: uiTheme.textMuted }}>
                    Tổng điểm (Tối đa: <span data-testid="victory-max-score">{victoryMaxScore}</span>)
                  </div>
                  <div
                    data-testid="victory-total-score"
                    style={{
                      fontSize: '21px',
                      fontWeight: 700,
                      color: accentHex,
                      marginTop: '4px',
                    }}
                  >
                    {displayedTotalScore}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', borderRight: `1px solid ${uiTheme.subCardBorder}` }}>
                  <div style={{ fontSize: '12px', color: uiTheme.textMuted }}>Trạm đúng ({victoryEval.accuracyPercentage}%)</div>
                  <div
                    style={{
                      fontSize: '21px',
                      fontWeight: 700,
                      color: uiTheme.textPrimary,
                      marginTop: '4px',
                    }}
                  >
                    {victoryCorrectCount}/{totalStages}
                  </div>
                </div>

                <div style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: '12px', color: uiTheme.textMuted }}>Vật cản vượt qua</div>
                  <div
                    style={{
                      fontSize: '21px',
                      fontWeight: 700,
                      color: uiTheme.choiceCorrectText,
                      marginTop: '4px',
                    }}
                  >
                    {obstaclesClearedCount}
                  </div>
                </div>
              </div>

              {isMultiplayer &&
                multiplayerShowLeaderboard &&
                Array.isArray(multiplayerLeaderboard) &&
                multiplayerLeaderboard.length > 0 && (
                  <div
                    data-testid="adventure-mp-final-leaderboard"
                    style={{
                      marginBottom: '18px',
                      padding: '12px',
                      borderRadius: '10px',
                      backgroundColor: uiTheme.subCardBg,
                      border: `1px solid ${uiTheme.subCardBorder}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 800,
                        color: uiTheme.textPrimary,
                        marginBottom: '8px',
                      }}
                    >
                      🏆 Bảng xếp hạng chung cuộc ({multiplayerLeaderboard.length} người chơi)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {multiplayerLeaderboard.slice(0, 10).map(entry => {
                        const isMe = Boolean(
                          multiplayerPlayerId && entry.playerId === multiplayerPlayerId
                        );
                        return (
                          <div
                            key={entry.playerId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '7px 10px',
                              borderRadius: '8px',
                              backgroundColor: isMe
                                ? 'rgba(56, 189, 248, 0.16)'
                                : uiTheme.cardBg,
                              border: `1px solid ${isMe ? '#38bdf8' : uiTheme.subCardBorder}`,
                              fontSize: '13px',
                              fontWeight: isMe ? 900 : 700,
                              color: uiTheme.textPrimary,
                            }}
                          >
                            <span>
                              #{entry.rank} {entry.displayName} {isMe ? '(Bạn)' : ''}
                            </span>
                            <span
                              style={{
                                color: '#34d399',
                                fontWeight: 900,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {entry.score} đ
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {mode === 'LIVE_SESSION' &&
                (() => {
                  const resObj = effectiveFinalResult as PracticeFinalResult | null;
                  const isExam =
                    resObj?.sessionMode === 'EXAM' || game.settings?.sessionMode === 'EXAM';
                  const policy =
                    resObj?.examAnswerRevealPolicy ||
                    game.settings?.examAnswerRevealPolicy ||
                    'AFTER_PUBLISH';
                  const canShowResultAnswers =
                    Boolean(isPlaytest) ||
                    (isExam &&
                      (Boolean(resObj?.canRevealAnswers) ||
                        Boolean(resObj?.answersPublished) ||
                        policy === 'IMMEDIATE' ||
                        policy === 'AFTER_SUBMIT'));
                  const qResults = Array.isArray(resObj?.questionResults)
                    ? resObj!.questionResults!
                    : [];

                  if (canShowResultAnswers && qResults.length > 0) {
                    return (
                      <div
                        data-testid="solo-result-question-review"
                        style={{
                          marginBottom: '18px',
                          padding: '12px',
                          borderRadius: '10px',
                          backgroundColor: uiTheme.subCardBg,
                          border: `1px solid ${uiTheme.subCardBorder}`,
                          maxHeight: '220px',
                          overflowY: 'auto',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12.5px',
                            fontWeight: 800,
                            color: uiTheme.textPrimary,
                            marginBottom: '8px',
                          }}
                        >
                          Chi tiết đáp án từng trạm ({qResults.length} câu)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {qResults.map((qr, idx) => {
                            const specQ =
                              game.questions?.[idx] ||
                              game.questions?.find((item) => item.id === qr.questionId);
                            const displayCorrectAns = qr.correctAnswer || specQ?.correctAnswer;
                            const displayExplanation =
                              typeof qr.explanation === 'string' && qr.explanation.trim().length > 0
                                ? qr.explanation.trim()
                                : typeof specQ?.explanation === 'string'
                                  ? specQ.explanation.trim()
                                  : '';
                            return (
                              <div
                                key={qr.questionId || idx}
                                data-testid={`solo-result-review-item-${idx}`}
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: '8px',
                                  backgroundColor: uiTheme.cardBg,
                                  border: `1px solid ${
                                    qr.isCorrect ? uiTheme.choiceCorrectBorder : uiTheme.choiceWrongBorder
                                  }`,
                                  fontSize: '12px',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontWeight: 800,
                                      color: qr.isCorrect ? uiTheme.choiceCorrectText : uiTheme.choiceWrongText,
                                    }}
                                  >
                                    Trạm #{idx + 1}:{' '}
                                    {qr.isCorrect
                                      ? `✓ Đúng (+${qr.pointsEarned}đ)`
                                      : qr.timedOut
                                        ? '⏰ Hết giờ (+0đ)'
                                        : '✕ Sai (+0đ)'}
                                  </div>
                                  {isPlaytest && !isDemoMode && onEditCheckpointQuestion && (
                                    <button
                                      type="button"
                                      data-testid={`playtest-finish-edit-q-${idx}`}
                                      onClick={() => onEditCheckpointQuestion(idx)}
                                      style={{
                                        padding: '3px 8px',
                                        borderRadius: '6px',
                                        border: `1px solid ${uiTheme.subCardBorder}`,
                                        backgroundColor: uiTheme.subCardBg,
                                        color: uiTheme.textPrimary,
                                        fontSize: '11px',
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ✎ Sửa câu này
                                    </button>
                                  )}
                                </div>
                                {specQ?.question && (
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      color: uiTheme.textPrimary,
                                      marginTop: '4px',
                                      lineHeight: 1.38,
                                    }}
                                  >
                                    {specQ.question}
                                  </div>
                                )}
                                <div style={{ color: uiTheme.textSecondary, marginTop: '3px' }}>
                                  Câu trả lời của bạn:{' '}
                                  <strong
                                    style={{
                                      color: qr.isCorrect ? uiTheme.choiceCorrectText : uiTheme.choiceWrongText,
                                    }}
                                  >
                                    {qr.timedOut || !qr.answer ? 'Chưa trả lời (Hết thời gian)' : qr.answer}
                                  </strong>
                                </div>
                                {displayCorrectAns && (
                                  <div style={{ color: uiTheme.textSecondary, marginTop: '2px' }}>
                                    Đáp án đúng:{' '}
                                    <strong style={{ color: uiTheme.choiceCorrectText }}>
                                      {displayCorrectAns}
                                    </strong>
                                  </div>
                                )}
                                {displayExplanation && (
                                  <div
                                    data-testid={`solo-result-review-explanation-${idx}`}
                                    style={{ color: uiTheme.textMuted, marginTop: '2px' }}
                                  >
                                    Giải thích: {displayExplanation}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (isExam && !canShowResultAnswers) {
                    return (
                      <div
                        data-testid="solo-result-answers-pending-publish"
                        style={{
                          marginBottom: '18px',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          backgroundColor: uiTheme.feedbackExamBg,
                          border: `1px solid ${uiTheme.feedbackExamBorder}`,
                          color: uiTheme.feedbackExamText,
                          fontSize: '12px',
                          fontWeight: 700,
                        }}
                      >
                        🔒 Đáp án chi tiết từng trạm sẽ hiển thị sau khi người tạo chính thức công bố đáp án.
                      </div>
                    );
                  }
                  return null;
                })()}

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {isDemoMode && onCreateThisGameType && (
                  <button
                    type="button"
                    data-testid="demo-finish-create-btn"
                    onClick={onCreateThisGameType}
                    style={{
                      minHeight: '44px',
                      padding: '0 18px',
                      borderRadius: '8px',
                      backgroundColor: '#10b981',
                      border: 'none',
                      color: '#052e16',
                      fontSize: '14px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✨ Tạo game loại này
                  </button>
                )}
                {!isMultiplayer && (
                  <button
                    type="button"
                    data-testid="victory-restart-btn"
                    onClick={handleRestartPreview}
                    style={{
                      minHeight: '44px',
                      padding: '0 18px',
                      borderRadius: '8px',
                      backgroundColor: accentHex,
                      border: 'none',
                      color: accentInk,
                      fontSize: '14px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Chơi lại
                  </button>
                )}
                <button
                  type="button"
                  data-testid="victory-exit-btn"
                  onClick={handleExitGame}
                  style={{
                    minHeight: '44px',
                    padding: '0 18px',
                    borderRadius: '8px',
                    backgroundColor: uiTheme.choiceBg,
                    border: `1px solid ${uiTheme.choiceBorder}`,
                    color: uiTheme.textPrimary,
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isMultiplayer ? 'Rời phòng chơi' : 'Thoát màn hình chơi'}
                </button>
              </div>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
};
