import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

import request from 'supertest';
import { app } from '../src/app.js';
import { gameStore } from '../src/game/game.store.js';
import { aiQuestionService } from '../src/services/ai.question.service.js';
import { authService } from '../src/services/auth.service.js';
import { resolveAdventureAssetPack } from '../src/services/adventure-asset-pack.service.js';
import {
  ADVENTURE_START_INSTRUCTION,
  RUNNER_CHECKPOINT_STOP_OFFSET,
  RUNNER_MAX_FRAME_DT,
  RUNNER_STAGE_SEGMENT_LENGTH,
  RUNNER_START_X,
  createInitialRunnerPhysicsState,
  evaluateRunnerPreviewAnswer,
  resolveAdventureRuntimeAssets,
  stepAdventureRunnerPhysics,
  triggerRunnerJump,
} from '../frontend/src/components/AdventureGameEngine.js';
import { buildDefaultAdventureConfig } from '../frontend/src/config/adventureThemes.js';
import type { AdventureConfig, GameQuestion, IndustryId } from '../frontend/src/types/index.js';
// @ts-ignore
import { Browser, sleep } from '../../../WEB_2064/ASM/.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const ALL_EIGHT_INDUSTRIES: IndustryId[] = [
  'MOTORCYCLE_TRAFFIC',
  'BUSINESS_SALES',
  'MANUFACTURING_INDUSTRIAL',
  'IT_TECHNOLOGY',
  'HEALTHCARE_TRAINING',
  'FINANCE_BANKING',
  'FNB_HOSPITALITY',
  'EDUCATION_GENERAL',
];

const SAMPLE_QUESTIONS: GameQuestion[] = [
  {
    id: 'q_p4_1',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    question: 'Bước xử lý chuẩn tại Checkpoint 1 là gì?',
    choices: [
      'A. Thực hiện đúng quy trình chuẩn',
      'B. Bỏ qua kiểm tra an toàn',
      'C. Thao tác sai kỹ thuật',
      'D. Tắt cảnh báo hệ thống',
    ],
    correctAnswer: 'A. Thực hiện đúng quy trình chuẩn',
    explanation: 'Đáp án A tuân thủ đúng quy trình chuẩn trong tài liệu.',
    sourceReference: {
      sourceId: 'src_p4',
      sourceType: 'TXT',
      sourceLocation: 'Tài liệu đào tạo Phase 4',
      section: 'Chặng 1',
    },
  },
  {
    id: 'q_p4_2',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    question: 'Bước xác nhận hoàn tất tại Checkpoint 2 là gì?',
    choices: [
      'A. Thực hiện đúng quy trình chuẩn',
      'B. Không lưu nhật ký',
      'C. Bỏ qua bước nghiệm thu',
      'D. Tự ý đóng hệ thống',
    ],
    correctAnswer: 'A. Thực hiện đúng quy trình chuẩn',
    explanation: 'Đáp án A đảm bảo nghiệm thu chính xác.',
    sourceReference: {
      sourceId: 'src_p4',
      sourceType: 'TXT',
      sourceLocation: 'Tài liệu đào tạo Phase 4',
      section: 'Chặng 2',
    },
  },
];

describe('Phase 4 — Adventure 2D Side-Scrolling Gameplay & Asset Runtime Verification', () => {
  it('1. Loads and validates all 3 required assets (background, character, obstacle) for each of the 8 industries', () => {
    for (const industryId of ALL_EIGHT_INDUSTRIES) {
      const packRes = resolveAdventureAssetPack(industryId);
      assert.equal(packRes.verified, true, `Pack for ${industryId} must be verified`);
      assert.ok(packRes.pack);

      const baseCfg = buildDefaultAdventureConfig('theme_edu_campus', SAMPLE_QUESTIONS.length, SAMPLE_QUESTIONS);
      const phase3Config: AdventureConfig = {
        ...baseCfg,
        version: 2,
        industryId,
        assetStatus: 'READY',
        assetPackSource: 'ANTIGRAVITY_BANANA_PACK',
        assets: packRes.pack.assets,
      };

      const resolved = resolveAdventureRuntimeAssets(phase3Config);
      assert.equal(resolved.valid, true, `Assets for ${industryId} must be valid`);
      assert.equal(resolved.isLegacyFallback, false);
      assert.equal(resolved.industryId, industryId);
      assert.ok(resolved.assets);
      assert.equal(
        resolved.assets.background.url,
        `/adventure-assets/packs/${industryId}/background.png`
      );
      assert.equal(
        resolved.assets.character.url,
        `/adventure-assets/packs/${industryId}/character.png`
      );
      assert.equal(
        resolved.assets.obstacle.url,
        `/adventure-assets/packs/${industryId}/obstacle.png`
      );
    }
  });

  it('2. Detects broken URLs, missing assets, failed status, and cross-industry asset mismatch without falling back to MOTORCYCLE_TRAFFIC', () => {
    const motoPack = resolveAdventureAssetPack('MOTORCYCLE_TRAFFIC').pack!;
    const itBaseCfg = buildDefaultAdventureConfig('theme_it_cyberlab', SAMPLE_QUESTIONS.length, SAMPLE_QUESTIONS);

    // Case 2a: Cross-industry mismatch (MOTORCYCLE_TRAFFIC assets attached to IT_TECHNOLOGY game)
    const crossIndustryCfg: AdventureConfig = {
      ...itBaseCfg,
      version: 2,
      industryId: 'IT_TECHNOLOGY',
      assetStatus: 'READY',
      assets: motoPack.assets,
    };
    const crossRes = resolveAdventureRuntimeAssets(crossIndustryCfg);
    assert.equal(crossRes.valid, false);
    assert.equal(crossRes.errorCode, 'CROSS_INDUSTRY_ASSET_MISMATCH');
    assert.equal(crossRes.assets, null);

    // Case 2b: Missing assets on Phase 3 game (version: 2)
    const missingPhase3Cfg: AdventureConfig = {
      ...itBaseCfg,
      version: 2,
      industryId: 'IT_TECHNOLOGY',
      assetStatus: 'READY',
      assets: undefined,
    };
    const missingRes = resolveAdventureRuntimeAssets(missingPhase3Cfg);
    assert.equal(missingRes.valid, false);
    assert.equal(missingRes.errorCode, 'MISSING_ADVENTURE_ASSETS');
    assert.equal(missingRes.assets, null);

    // Case 2c: ASSET_GENERATION_FAILED status on CUSTOM industry
    const failedCustomCfg: AdventureConfig = {
      ...itBaseCfg,
      version: 2,
      industryId: 'CUSTOM',
      industryLabel: 'Hàng không Vũ trụ',
      assetStatus: 'ASSET_GENERATION_FAILED',
      assetErrorCode: 'AI_QUOTA_EXCEEDED',
      assetError: 'Quota exceeded on Free Tier',
    };
    const failedRes = resolveAdventureRuntimeAssets(failedCustomCfg);
    assert.equal(failedRes.valid, false);
    assert.equal(failedRes.errorCode, 'AI_QUOTA_EXCEEDED');
    assert.equal(failedRes.assets, null);

    // Case 2d: Unsafe / path-traversal URL in obstacle asset
    const itPack = resolveAdventureAssetPack('IT_TECHNOLOGY').pack!;
    const unsafeUrlCfg: AdventureConfig = {
      ...itBaseCfg,
      version: 2,
      industryId: 'IT_TECHNOLOGY',
      assetStatus: 'READY',
      assets: {
        ...itPack.assets,
        obstacle: {
          ...itPack.assets.obstacle,
          url: '/adventure-assets/../../etc/passwd',
        },
      },
    };
    const unsafeRes = resolveAdventureRuntimeAssets(unsafeUrlCfg);
    assert.equal(unsafeRes.valid, false);
    assert.equal(unsafeRes.errorCode, 'INVALID_ADVENTURE_ASSETS');
    assert.deepEqual(unsafeRes.missingOrInvalidAssets, ['OBSTACLE']);
  });

  it('3. Auto-runs horizontally, transitions GROUNDED -> JUMPING -> LANDING -> GROUNDED, blocks mid-air infinite jump, and detects obstacle collisions', () => {
    const state = createInitialRunnerPhysicsState({
      totalStages: 3,
      obstacleDensity: 'MEDIUM',
    });

    assert.equal(state.playerX, RUNNER_START_X);
    assert.equal(state.playerY, 0);
    assert.equal(state.isGrounded, true);
    assert.equal(state.jumpState, 'GROUNDED');

    // Verify obstacles have >= 280px spacing and safe buffers from start & checkpoints
    for (let i = 1; i < state.obstacles.length; i++) {
      const gap = state.obstacles[i].x - state.obstacles[i - 1].x;
      assert.ok(gap >= 280, `Obstacle spacing must be >= 280px, got ${gap}`);
    }

    // Step forward on ground -> auto-runs and scrolls camera horizontally
    stepAdventureRunnerPhysics(state, 0.03, { canMove: true });
    assert.ok(state.playerX > RUNNER_START_X, 'Character must auto-run forward');
    assert.ok(state.vx > 0, 'Horizontal velocity vx must be positive while running');
    assert.equal(state.isGrounded, true);
    assert.equal(state.jumpState, 'GROUNDED');

    // Trigger jump while grounded -> succeeds and enters JUMPING
    const jumped1 = triggerRunnerJump(state, true);
    assert.equal(jumped1, true);
    assert.equal(state.isGrounded, false);
    assert.equal(state.jumpState, 'JUMPING');
    assert.ok(state.vy < 0);

    // Attempt second jump while mid-air -> MUST be blocked (no infinite jump)
    const jumpedMidAir1 = triggerRunnerJump(state, true);
    assert.equal(jumpedMidAir1, false, 'Mid-air jump during JUMPING must be blocked');

    // Step until vertical velocity turns positive (descending -> LANDING state)
    let sawLandingState = false;
    for (let f = 0; f < 40; f++) {
      stepAdventureRunnerPhysics(state, 0.025, { canMove: true });
      if (state.jumpState === 'LANDING') {
        sawLandingState = true;
        // Attempt jump during LANDING -> MUST also be blocked
        assert.equal(
          triggerRunnerJump(state, true),
          false,
          'Mid-air jump during LANDING must be blocked'
        );
      }
      if (state.isGrounded) break;
    }

    assert.equal(sawLandingState, true, 'Jump cycle must pass through LANDING state');
    assert.equal(state.isGrounded, true, 'Character must return to GROUNDED state');
    assert.equal(state.jumpState, 'GROUNDED');
    assert.equal(state.playerY, 0);

    // Verify AABB collision when running straight through an obstacle without jumping
    const collisionState = createInitialRunnerPhysicsState({
      totalStages: 2,
      obstacleDensity: 'MEDIUM',
    });
    for (let f = 0; f < 80; f++) {
      stepAdventureRunnerPhysics(collisionState, 0.03, { canMove: true });
      if (collisionState.obstacleHits > 0) break;
    }
    assert.ok(collisionState.obstacleHits >= 1, 'Running into an obstacle on ground must register AABB collision');
  });

  it('4. Stops completely at checkpoint, locks jump while modal is open, and resumes movement only after answering', () => {
    const state = createInitialRunnerPhysicsState({
      totalStages: 2,
      obstacleDensity: 'LOW',
    });

    let reachedCp1: number | null = null;
    for (let f = 0; f < 200; f++) {
      const ev = stepAdventureRunnerPhysics(state, 0.03, { canMove: true });
      if (ev.reachedCheckpointIndex !== null) {
        reachedCp1 = ev.reachedCheckpointIndex;
        break;
      }
    }

    assert.equal(reachedCp1, 0, 'Must reach Checkpoint #1 (stage index 0)');
    assert.equal(state.isAtCheckpoint, true);
    assert.equal(state.vx, 0, 'Character vx must be 0 at checkpoint');
    assert.equal(state.vy, 0, 'Character vy must be 0 at checkpoint');
    assert.equal(state.playerY, 0, 'Character must be grounded at checkpoint');
    assert.equal(
      state.playerX,
      RUNNER_STAGE_SEGMENT_LENGTH - RUNNER_CHECKPOINT_STOP_OFFSET
    );

    const stoppedX = state.playerX;
    const stoppedCameraX = state.cameraX;

    // While at checkpoint / modal open, stepping physics does NOT move character or camera, and jump is locked
    for (let f = 0; f < 10; f++) {
      stepAdventureRunnerPhysics(state, 0.03, { canMove: false });
      assert.equal(triggerRunnerJump(state, false), false);
      assert.equal(triggerRunnerJump(state, true), false);
    }
    assert.equal(state.playerX, stoppedX, 'Player X must remain completely frozen while modal is open');
    assert.equal(state.cameraX, stoppedCameraX, 'Camera X must remain completely frozen while modal is open');

    // Simulate answering Checkpoint #1 and clicking Continue
    state.unlockedStageCount = 1;
    state.isAtCheckpoint = false;

    let reachedCp2: number | null = null;
    for (let f = 0; f < 200; f++) {
      const ev = stepAdventureRunnerPhysics(state, 0.03, { canMove: true });
      if (ev.reachedCheckpointIndex !== null) {
        reachedCp2 = ev.reachedCheckpointIndex;
        break;
      }
    }
    assert.equal(reachedCp2, 1, 'After unlocking stage 1, character must run to Checkpoint #2');
    assert.equal(state.isAtCheckpoint, true);
    assert.equal(state.vx, 0);

    // Unlock final stage 2 and run to finish gate
    state.unlockedStageCount = 2;
    state.isAtCheckpoint = false;
    let finished = false;
    for (let f = 0; f < 100; f++) {
      const ev = stepAdventureRunnerPhysics(state, 0.03, { canMove: true });
      if (ev.reachedFinish) {
        finished = true;
        break;
      }
    }
    assert.equal(finished, true, 'After final checkpoint, character must reach Finish Gate');
    assert.equal(state.isFinished, true);
    assert.equal(state.vx, 0);
  });

  it('5. Handles pause/resume, tab-switch delta-time spike clamping, and reload stage restoration without skipping checkpoints', () => {
    const state = createInitialRunnerPhysicsState({
      totalStages: 3,
      obstacleDensity: 'MEDIUM',
    });

    stepAdventureRunnerPhysics(state, 0.03, { canMove: true });
    const posBeforePause = state.playerX;

    // Pause / Tab hidden (canMove = false) -> zero movement
    stepAdventureRunnerPhysics(state, 0.03, { canMove: false });
    assert.equal(state.playerX, posBeforePause);
    assert.equal(state.vx, 0);

    // Tab switch spike: rawDt = 120 seconds (user switched tabs for 2 minutes)
    // Engine must clamp dt to RUNNER_MAX_FRAME_DT (0.033s) so character never teleports past Checkpoint #1
    stepAdventureRunnerPhysics(state, 120.0, { canMove: true });
    const distanceMoved = state.playerX - posBeforePause;
    assert.ok(
      distanceMoved <= 350 * RUNNER_MAX_FRAME_DT + 1,
      `Tab-switch spike must be clamped to a single frame (<12px), moved ${distanceMoved}px`
    );
    assert.ok(state.playerX < state.checkpointPositions[0], 'Must never skip Checkpoint #1 on tab switch');

    // Reload mid-session after completing Stage 0 (currentQuestionIndex = 1)
    const reloadedState = createInitialRunnerPhysicsState({
      totalStages: 3,
      obstacleDensity: 'MEDIUM',
      initialUnlockedStages: 1,
    });
    assert.equal(reloadedState.unlockedStageCount, 1);
    assert.ok(
      reloadedState.playerX > reloadedState.checkpointPositions[0],
      'Reloaded session at Stage 2 must position player past Checkpoint #1'
    );
    assert.ok(
      reloadedState.playerX < reloadedState.checkpointPositions[1],
      'Reloaded session at Stage 2 must position player before Checkpoint #2'
    );
  });

  it('6. Preserves backward compatibility for legacy v1 Adventure configs (without assets field) and evaluates all question formats accurately', () => {
    const legacyV1Config: AdventureConfig = {
      ...buildDefaultAdventureConfig('theme_fnb_kitchen_safety', SAMPLE_QUESTIONS.length, SAMPLE_QUESTIONS),
      industryId: 'FNB_HOSPITALITY',
      version: 1,
      assets: undefined,
      assetStatus: undefined,
    };
    const resolvedLegacy = resolveAdventureRuntimeAssets(legacyV1Config);
    assert.equal(resolvedLegacy.valid, true, 'Legacy v1 Adventure game must remain playable');
    assert.equal(resolvedLegacy.isLegacyFallback, true);
    assert.equal(
      resolvedLegacy.assets?.background.url,
      '/adventure-assets/packs/FNB_HOSPITALITY/background.png'
    );

    // Verify answer evaluation for MC, Type Answer (with acceptedAlternatives), and Slider (with tolerance)
    assert.equal(
      evaluateRunnerPreviewAnswer(SAMPLE_QUESTIONS[0], 'A. Thực hiện đúng quy trình chuẩn'),
      true
    );
    assert.equal(
      evaluateRunnerPreviewAnswer(SAMPLE_QUESTIONS[0], 'B. Bỏ qua kiểm tra an toàn'),
      false
    );

    const sliderQ: GameQuestion = {
      id: 'q_slider',
      type: 'SLIDER',
      difficulty: 'MEDIUM',
      question: 'Nhiệt độ chuẩn?',
      correctAnswer: '75',
      sliderConfig: { min: 0, max: 100, step: 5, correctValue: 75, tolerance: 5, unit: '°C' },
      explanation: '75°C ± 5°C',
      sourceReference: SAMPLE_QUESTIONS[0].sourceReference,
    };
    assert.equal(evaluateRunnerPreviewAnswer(sliderQ, '75'), true);
    assert.equal(evaluateRunnerPreviewAnswer(sliderQ, '79'), true);
    assert.equal(evaluateRunnerPreviewAnswer(sliderQ, '85'), false);
  });

  it('7. Real Browser E2E: verifies full-viewport 2D side-scrolling gameplay, Banana image loading, Start instruction, minimal HUD, jump, checkpoint stop/answer, and asset error screen on Desktop & Mobile', async () => {
    const reg = authService.register({
      email: `phase4_e2e_${Date.now()}@example.com`,
      password: 'Password123!',
      displayName: 'Phase 4 Tester',
    });
    const authHeader = { Authorization: `Bearer ${reg.token}` };

    const ingestRes = await request(app)
      .post('/api/content/ingest')
      .set(authHeader)
      .send({
        sampleText:
          'An ninh mạng và quản trị hệ thống CNTT: cấu hình tường lửa, xác thực đa yếu tố MFA và sao lưu dữ liệu định kỳ.',
      })
      .expect(200);
    const src = ingestRes.body.data.sources[0];

    aiQuestionService.setProvider({
      async generateJson() {
        return {
          title: 'Hành Trình An Ninh Mạng 2D Phase 4',
          description: 'Kiểm thử thực tế Adventure 2D Phase 4',
          questions: SAMPLE_QUESTIONS.map((q, idx) => ({
            ...q,
            id: `q_e2e_${idx + 1}`,
            sourceReference: {
              sourceId: src.sourceId,
              sourceType: 'TXT',
              sourceLocation: 'Tài liệu CNTT',
              section: `Chặng ${idx + 1}`,
            },
          })),
        };
      },
    });

    const genRes = await request(app)
      .post('/api/games/generate')
      .set(authHeader)
      .send({
        sourceIds: [src.sourceId],
        gameType: 'ADVENTURE',
        questionCount: 2,
        timePerQuestion: 25,
        difficulty: 'MEDIUM',
        scoringMode: 'STANDARD',
        title: 'Hành Trình An Ninh Mạng 2D Phase 4',
        adventureConfig: {
          industryId: 'IT_TECHNOLOGY',
          aiDetectedIndustry: false,
          questionTypes: ['MULTIPLE_CHOICE'],
        },
      })
      .expect(200);

    const itGame = genRes.body.data;
    gameStore.save({ ...itGame, isPublic: true }, Date.now(), reg.user.userId, true);

    // Also create a game with a broken image URL to verify the browser asset error screen
    const brokenGameId = `game_broken_assets_${Date.now()}`;
    const brokenSpec = {
      ...itGame,
      gameId: brokenGameId,
      title: 'Game Lỗi URL Ảnh',
      isPublic: true,
      settings: {
        ...itGame.settings,
        adventureConfig: {
          ...itGame.settings.adventureConfig,
          industryId: 'FNB_HOSPITALITY',
          assets: {
            ...itGame.settings.adventureConfig.assets,
            background: {
              ...itGame.settings.adventureConfig.assets.background,
              industryId: 'FNB_HOSPITALITY',
              url: '/adventure-assets/packs/FNB_HOSPITALITY/non_existent_404.png',
            },
            character: {
              ...itGame.settings.adventureConfig.assets.character,
              industryId: 'FNB_HOSPITALITY',
            },
            obstacle: {
              ...itGame.settings.adventureConfig.assets.obstacle,
              industryId: 'FNB_HOSPITALITY',
            },
          },
        },
      },
    };
    gameStore.save(brokenSpec, Date.now(), reg.user.userId, true);

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const browser = await Browser.launch({ width: 1280, height: 720 });
    try {
      const page = await browser.newPage({ width: 1280, height: 720 });
      await page.goto(`${baseUrl}/?play=${itGame.gameId}`, { settleMs: 900 });

      // Wait for assets to preload (data-asset-status="READY") and Start screen to appear
      let startScreenInfo: any = null;
      for (let w = 0; w < 20; w++) {
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
            instructionText: instr?.textContent?.trim() || '',
            bgUrl: canvas?.getAttribute('data-bg-url') || '',
            charUrl: canvas?.getAttribute('data-char-url') || '',
            obsUrl: canvas?.getAttribute('data-obs-url') || '',
            bodyOverflow: document.body.style.overflow,
            hasMinimalHud: Boolean(hudProgress && hudScore && hudCompleted),
            completedText: hudCompleted?.textContent?.trim() || '',
          };
        })()`);
        if (startScreenInfo?.assetStatus === 'READY' && startScreenInfo?.hasBriefing) break;
        await sleep(200);
      }

      assert.equal(startScreenInfo.assetStatus, 'READY', 'All 3 Banana assets must load in browser');
      assert.equal(startScreenInfo.industryId, 'IT_TECHNOLOGY');
      assert.equal(startScreenInfo.instructionText, ADVENTURE_START_INSTRUCTION);
      assert.equal(
        startScreenInfo.bgUrl,
        '/adventure-assets/packs/IT_TECHNOLOGY/background.png'
      );
      assert.equal(
        startScreenInfo.charUrl,
        '/adventure-assets/packs/IT_TECHNOLOGY/character.png'
      );
      assert.equal(
        startScreenInfo.obsUrl,
        '/adventure-assets/packs/IT_TECHNOLOGY/obstacle.png'
      );
      assert.equal(startScreenInfo.bodyOverflow, 'hidden', 'Page scroll must be locked');
      assert.equal(startScreenInfo.hasMinimalHud, true, 'Minimal HUD with 3 items must render');
      assert.equal(startScreenInfo.completedText, '0/2 câu');

      // Click Start button -> character begins auto-running
      await page.eval(`document.querySelector('[data-testid="start-adventure-btn"]')?.click()`);

      let runningCheck: any = { playerX: 0, vx: 0, isGrounded: 'true' };
      for (let w = 0; w < 20; w++) {
        await sleep(150);
        runningCheck = await page.eval(`(() => {
          const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
          return {
            playerX: Number(c?.getAttribute('data-player-x') || '0'),
            vx: Number(c?.getAttribute('data-vx') || '0'),
            isGrounded: c?.getAttribute('data-is-grounded'),
          };
        })()`);
        if (runningCheck.playerX > RUNNER_START_X && runningCheck.vx > 0) break;
      }
      assert.ok(runningCheck.playerX > RUNNER_START_X, 'Character must auto-run after Start');
      assert.ok(runningCheck.vx > 0, 'Character velocity must be positive while running');

      // Trigger Jump via Space key -> verify JUMPING state
      await page.eval(`(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      })()`);
      await sleep(80);
      const jumpCheck = await page.eval(`(() => {
        const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
        return {
          jumpState: c?.getAttribute('data-jump-state'),
          isGrounded: c?.getAttribute('data-is-grounded'),
          playerY: Number(c?.getAttribute('data-player-y') || '0'),
        };
      })()`);
      assert.equal(jumpCheck.isGrounded, 'false', 'Character must be airborne after pressing Space');
      assert.ok(jumpCheck.playerY < 0, 'Player Y must be negative while jumping');

      // Test Pause & Resume
      await page.eval(`document.querySelector('[data-testid="hud-pause-button"]')?.click()`);
      await sleep(150);
      const pauseState = await page.eval(`(() => {
        const overlay = document.querySelector('[data-testid="scene-pause-overlay"]');
        const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
        return {
          hasOverlay: Boolean(overlay),
          vx: Number(c?.getAttribute('data-vx') || '0'),
          playerX: Number(c?.getAttribute('data-player-x') || '0'),
        };
      })()`);
      assert.equal(pauseState.hasOverlay, true, 'Pause overlay must open');
      assert.equal(pauseState.vx, 0, 'Velocity must be 0 while paused');

      await page.eval(`document.querySelector('[data-testid="resume-adventure-btn"]')?.click()`);

      // Wait for character to reach Checkpoint #1 and open question modal
      let cp1ModalOpen = false;
      for (let w = 0; w < 25; w++) {
        cp1ModalOpen = await page.eval(
          `Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`
        );
        if (cp1ModalOpen) break;
        await sleep(200);
      }
      assert.equal(cp1ModalOpen, true, 'Character must reach Checkpoint #1 and open question modal');

      // Verify full stop at Checkpoint #1 and jump lock while modal is open
      const cp1StopBefore = await page.eval(`(() => {
        const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
        return {
          playerX: Number(c?.getAttribute('data-player-x') || '0'),
          vx: Number(c?.getAttribute('data-vx') || '0'),
          isGrounded: c?.getAttribute('data-is-grounded'),
          questionText: document.querySelector('[data-testid="checkpoint-question-text"]')?.textContent || '',
        };
      })()`);
      await sleep(150);
      const cp1StopAfter = await page.eval(`(() => {
        const c = document.querySelector('[data-testid="adventure-runner-canvas"]');
        return {
          playerX: Number(c?.getAttribute('data-player-x') || '0'),
          isGrounded: c?.getAttribute('data-is-grounded'),
        };
      })()`);
      assert.equal(cp1StopBefore.vx, 0);
      assert.equal(cp1StopBefore.playerX, cp1StopAfter.playerX, 'Character must remain completely stopped at checkpoint');
      assert.equal(cp1StopAfter.isGrounded, 'true', 'Jump must be locked while checkpoint modal is open');
      assert.ok(cp1StopBefore.questionText.includes('Checkpoint 1'));

      // Answer Checkpoint #1 (dispatch multiple rapid clicks to verify anti-duplicate submission guard)
      await page.eval(`(() => {
        const btn = document.querySelector('[data-testid="checkpoint-choice-0"]');
        if (btn) {
          btn.click();
          btn.click();
        }
      })()`);
      await sleep(450);

      await page.eval(`document.querySelector('[data-testid="checkpoint-continue-btn"]')?.click()`);
      await sleep(200);

      const hudAfterCp1 = await page.eval(`(() => ({
        score: Number(document.querySelector('[data-testid="hud-total-score"]')?.textContent || '0'),
        completed: document.querySelector('[data-testid="hud-completed-questions"]')?.textContent?.trim() || '',
      }))()`);
      assert.ok(hudAfterCp1.score > 0, 'Score must increase after answering Checkpoint #1');
      assert.equal(hudAfterCp1.completed, '1/2 câu');

      // Wait for Checkpoint #2 -> answer -> reach Victory overlay
      for (let w = 0; w < 25; w++) {
        const open = await page.eval(
          `Boolean(document.querySelector('[data-testid="runner-checkpoint-modal"]'))`
        );
        if (open) break;
        await sleep(200);
      }
      await page.eval(`document.querySelector('[data-testid="checkpoint-choice-0"]')?.click()`);
      await sleep(450);
      await page.eval(`document.querySelector('[data-testid="checkpoint-continue-btn"]')?.click()`);

      let victoryVisible = false;
      for (let w = 0; w < 20; w++) {
        victoryVisible = await page.eval(
          `Boolean(document.querySelector('[data-testid="scene-victory-overlay"]'))`
        );
        if (victoryVisible) break;
        await sleep(200);
      }
      assert.equal(victoryVisible, true, 'Victory overlay must appear after reaching Finish Gate');

      // Verify mobile viewport (390x844) layout without horizontal overflow
      await page.setViewport({ width: 390, height: 844, mobile: true });
      await sleep(200);
      const mobileOverflow = await page.eval(
        `document.documentElement.scrollWidth > window.innerWidth + 2`
      );
      assert.equal(mobileOverflow, false, 'Mobile viewport 390x844 must not overflow horizontally');
      await page.close();

      // Verify broken asset URL game displays clear error screen and does NOT start gameplay
      const brokenPage = await browser.newPage({ width: 1280, height: 720 });
      await brokenPage.goto(`${baseUrl}/?play=${brokenGameId}`, { settleMs: 900 });
      let errorScreenFound = false;
      for (let w = 0; w < 15; w++) {
        errorScreenFound = await brokenPage.eval(
          `Boolean(document.querySelector('[data-testid="adventure-asset-error"]'))`
        );
        if (errorScreenFound) break;
        await sleep(200);
      }
      assert.equal(
        errorScreenFound,
        true,
        'Game with broken asset URL must display adventure-asset-error screen'
      );
      await brokenPage.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});

