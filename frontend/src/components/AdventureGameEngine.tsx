import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type {
  AdventureConfig,
  AvatarId,
  GameQuestion,
  GameSpecification,
  ObstacleType,
  PracticeFinalResult,
  PracticeQuestionResult,
  SanitizedQuestion,
} from '../types/index.js';
import {
  OBSTACLE_METADATA,
  syncAdventureStagesWithQuestions,
} from '../config/adventureThemes.js';
import { resolveSceneRendererDescriptor } from './AdventureSceneRegistry.js';
import {
  MechanicalDiagnosticGarageScene,
  KitchenFoodSafetyLabScene,
  CustomerConsultationShowroomScene,
  CodingIdeDebuggerScene,
  CyberDefenseSocRadarScene,
  MedicalClinicalTriageScene,
  AcademyKnowledgeLabScene,
} from './AdventureInteractiveScenes.js';

function playTone(freq: number, durationSec: number, type: OscillatorType = 'sine'): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  } catch {
    // Ignore audio context restrictions
  }
}

const playClickSound = () => playTone(520, 0.08, 'triangle');
const playCorrectSound = () => {
  playTone(587.33, 0.12, 'sine');
  setTimeout(() => playTone(880, 0.18, 'sine'), 90);
};
const playWrongSound = () => playTone(220, 0.22, 'sawtooth');
const playVictorySound = () => {
  playTone(523.25, 0.12, 'triangle');
  setTimeout(() => playTone(659.25, 0.12, 'triangle'), 100);
  setTimeout(() => playTone(783.99, 0.25, 'triangle'), 200);
};

interface WorldObstacle {
  id: string;
  stageIndex: number;
  x: number;
  width: number;
  height: number;
  type: ObstacleType;
  cleared: boolean;
  hit: boolean;
}

interface WorldCollectible {
  id: string;
  x: number;
  yOffset: number;
  label: string;
  collected: boolean;
}

interface WorldDecor {
  id: string;
  x: number;
  kind: 'SIGN' | 'LAMP' | 'TREE' | 'PILLAR' | 'BANNER';
  label?: string;
}

interface FloatingParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  text?: string;
}

export interface AdventureGameEngineProps {
  game: GameSpecification;
  adventureConfig?: AdventureConfig;
  mode: 'LIVE_SESSION' | 'CREATOR_PREVIEW';
  sessionStarted?: boolean;
  startingSession?: boolean;
  onStartSession?: () => void;
  currentQuestion?: SanitizedQuestion | null;
  currentQuestionIndex?: number;
  totalQuestions?: number;
  timeRemaining?: number;
  liveScore?: number;
  liveCorrectCount?: number;
  liveWrongCount?: number;
  questionFeedback?: PracticeQuestionResult | null;
  submittingAnswer?: boolean;
  onSubmitAnswer?: (answer: string) => void;
  onNextQuestion?: () => void;
  finalResult?: PracticeFinalResult | null;
  onRestartSession?: () => void;
  onExit: () => void;
}

const STAGE_SEGMENT_LENGTH = 760;
const FIRST_CHECKPOINT_X = 720;
const GRAVITY = 1750;
const JUMP_VELOCITY = -650;
const BASE_MOVE_SPEED = 285;

function getIndustryGameplayProfile(config: AdventureConfig) {
  const archetype = config.gameplayArchetype || 'DIAGNOSTIC_WORKBENCH_SIM';
  if (archetype === 'TRAFFIC_RUNNER_SIM') {
    return {
      archetypeId: 'TRAFFIC_RUNNER_SIM' as const,
      archetypeBadge: 'RUNNER MÔ PHỎNG LỘ TRÌNH',
      mechanicTitle:
        config.industryId === 'MANUFACTURING_INDUSTRIAL'
          ? 'Điều Phối Lộ Trình Kho Vận & Xử Lý Vật Cản Logistics'
          : 'Sa Hình Lộ Trình & Xử Lý Tình Huống Giao Thông Thực Tế',
      autoMoveOn: 'Phương tiện tự chạy: BẬT',
      autoMoveOff: 'Phương tiện tự chạy: TẠM DỪNG',
      actionVerb: 'NHẢY NÉ VẬT CẢN',
      clearFloatingText: '+15 AN TOÀN LỘ TRÌNH',
      checkpointAction: 'Mở chốt sát hạch chặng',
      clearedMetricLabel: 'Vật cản vượt qua',
      continueLabel: 'Tiếp tục di chuyển sang chặng kế tiếp (Space)',
    };
  }
  if (archetype === 'DIAGNOSTIC_WORKBENCH_SIM') {
    return {
      archetypeId: 'DIAGNOSTIC_WORKBENCH_SIM' as const,
      archetypeBadge: 'BÀN CHẨN ĐOÁN KỸ THUẬT',
      mechanicTitle:
        config.industryId === 'MANUFACTURING_INDUSTRIAL'
          ? 'Kiểm Định Trạm Máy Dây Chuyền & Xử Lý Lỗi QA/QC - 5S'
          : 'Chẩn Đoán Bộ Phận Kỹ Thuật & Sửa Chữa Bảo Dưỡng Xưởng',
      autoMoveOn: 'Máy quét chẩn đoán: SẴN SÀNG',
      autoMoveOff: 'Máy quét chẩn đoán: TẠM DỪNG',
      actionVerb: 'QUÉT CHẨN ĐOÁN BỘ PHẬN',
      clearFloatingText: '+15 KỸ THUẬT CHẨN ĐOÁN',
      checkpointAction: 'Mở phiếu chẩn đoán cụm',
      clearedMetricLabel: 'Bộ phận đã chẩn đoán',
      continueLabel: 'Xác nhận & Chuyển sang cụm kỹ thuật kế tiếp (Space)',
    };
  }
  if (archetype === 'CYBER_DEFENSE_CONSOLE_SIM') {
    return {
      archetypeId: 'CYBER_DEFENSE_CONSOLE_SIM' as const,
      archetypeBadge: 'TRUNG TÂM ĐIỀU HÀNH SOC',
      mechanicTitle: 'Giám Sát Sơ Đồ Node Mạng, Cô Lập Đe Dọa & Phản Ứng Sự Cố SOC',
      autoMoveOn: 'Radar giám sát SIEM: BẬT',
      autoMoveOff: 'Radar giám sát SIEM: TẠM DỪNG',
      actionVerb: 'CÔ LẬP & PHÂN TÍCH NODE',
      clearFloatingText: '+15 CHẶN SỰ CỐ SOC',
      checkpointAction: 'Mở phiếu phản ứng Node',
      clearedMetricLabel: 'Node mạng đã cô lập',
      continueLabel: 'Hoàn tất xử lý & Chuyển sang Node kế tiếp (Space)',
    };
  }
  return {
    archetypeId: 'SCENARIO_DECISION_SIM' as const,
    archetypeBadge: 'BÀN HỒ SƠ TÌNH HUỐNG',
    mechanicTitle:
      config.industryId === 'HEALTHCARE_TRAINING'
        ? 'Mô Phỏng Hồ Sơ Ca Đào Tạo Lâm Sàng & Quyết Định An Toàn Y Khoa'
        : config.industryId === 'BUSINESS_SALES' || config.themePresetId === 'theme_biz_retail'
          ? 'Mô Phỏng Tư Vấn Khách Hàng, Showroom & Ra Quyết Định Chốt Deal'
          : 'Mô Phỏng Phân Tích Hồ Sơ Tình Huống & Ra Quyết Định Chuyên Môn',
    autoMoveOn: 'Luồng hồ sơ tình huống: SẴN SÀNG',
    autoMoveOff: 'Luồng hồ sơ tình huống: TẠM DỪNG',
    actionVerb: 'TIẾP NHẬN & RA QUYẾT ĐỊNH',
    clearFloatingText: '+15 NGHIỆP VỤ CHUYÊN MÔN',
    checkpointAction: 'Mở hồ sơ tình huống',
    clearedMetricLabel: 'Hồ sơ đã thẩm định',
    continueLabel: 'Xác nhận quyết định & Mở hồ sơ kế tiếp (Space)',
  };
}

export const AdventureGameEngine: React.FC<AdventureGameEngineProps> = ({
  game,
  adventureConfig: propAdventureConfig,
  mode,
  sessionStarted = false,
  startingSession = false,
  onStartSession,
  currentQuestion: liveCurrentQuestion,
  currentQuestionIndex: liveQuestionIndex = 0,
  totalQuestions: liveTotalQuestions,
  liveScore = 0,
  liveCorrectCount = 0,
  liveWrongCount = 0,
  questionFeedback: liveQuestionFeedback,
  submittingAnswer = false,
  onSubmitAnswer,
  onNextQuestion,
  finalResult: liveFinalResult,
  onRestartSession,
  onExit,
}) => {
  const effectiveConfig = useMemo(() => {
    const raw = propAdventureConfig || game.settings?.adventureConfig;
    return syncAdventureStagesWithQuestions(raw, game.questions || []);
  }, [propAdventureConfig, game.settings?.adventureConfig, game.questions]);
  const gameplayProfile = useMemo(
    () => getIndustryGameplayProfile(effectiveConfig),
    [effectiveConfig]
  );
  const sceneDescriptor = useMemo(
    () => resolveSceneRendererDescriptor(effectiveConfig),
    [effectiveConfig]
  );

  const isRunnerArchetype = sceneDescriptor.sceneId === 'TRAFFIC_ROAD_RUNNER_SCENE';
  const inspectedStagesRef = useRef<Set<number>>(new Set());
  const [stageInspected, setStageInspected] = useState<boolean>(false);

  const totalStages = Math.max(
    1,
    liveTotalQuestions || game.questions?.length || effectiveConfig.stages.length || 1
  );

  // Preview mode internal state
  const [previewStarted, setPreviewStarted] = useState<boolean>(false);
  const [previewStageIdx, setPreviewStageIdx] = useState<number>(0);
  const [previewFeedback, setPreviewFeedback] = useState<PracticeQuestionResult | null>(null);
  const [previewFinished, setPreviewFinished] = useState<boolean>(false);
  const [previewScore, setPreviewScore] = useState<number>(0);
  const [previewCorrectCount, setPreviewCorrectCount] = useState<number>(0);
  const [previewWrongCount, setPreviewWrongCount] = useState<number>(0);
  const [previewStreak, setPreviewStreak] = useState<number>(0);
  const [, setPreviewMaxStreak] = useState<number>(0);
  const [previewTimeRemaining, setPreviewTimeRemaining] = useState<number>(
    game.settings?.timePerQuestion || 20
  );

  // Shared gameplay state
  const [activeModalOpen, setActiveModalOpen] = useState<boolean>(false);
  const [selectedChoice, setSelectedChoice] = useState<string>('');
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [autoCruise, setAutoCruise] = useState<boolean>(true);
  const [skillBonusScore, setSkillBonusScore] = useState<number>(0);
  const [obstaclesClearedCount, setObstaclesClearedCount] = useState<number>(0);
  const [, setObstaclesHitCount] = useState<number>(0);
  const [energyPercent, setEnergyPercent] = useState<number>(100);
  const [nearCheckpointIndex, setNearCheckpointIndex] = useState<number | null>(null);
  const [reachedFinishGate, setReachedFinishGate] = useState<boolean>(false);
  const [playerProgressPercent, setPlayerProgressPercent] = useState<number>(0);
  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Dynamic viewport dimensions for full-screen Canvas
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? Math.max(420, window.innerHeight - 60) : 660,
  });

  useEffect(() => {
    const updateSize = () => {
      const el = canvasWrapperRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          setCanvasSize({
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
          return;
        }
      }
      setCanvasSize({
        width: window.innerWidth,
        height: Math.max(360, window.innerHeight - 60),
      });
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvasWrapperRef.current) {
      observer = new ResizeObserver(() => updateSize());
      observer.observe(canvasWrapperRef.current);
    }

    const handleFullscreenChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
      setTimeout(updateSize, 60);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      window.removeEventListener('resize', updateSize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (observer) observer.disconnect();
    };
  }, []);

  const toggleNativeFullscreen = useCallback(() => {
    try {
      if (!document.fullscreenElement) {
        const target = viewportContainerRef.current || document.documentElement;
        target.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      // Ignore fullscreen API restrictions
    }
  }, []);

  const handleExitGame = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      // Ignore
    }
    onExit();
  }, [onExit]);

  const activeStageIndex = mode === 'LIVE_SESSION' ? liveQuestionIndex : previewStageIdx;
  const activeFeedback = mode === 'LIVE_SESSION' ? liveQuestionFeedback : previewFeedback;
  const isJourneyStarted = mode === 'LIVE_SESSION' ? sessionStarted : previewStarted;
  const isJourneyFinished =
    mode === 'LIVE_SESSION' ? Boolean(liveFinalResult) : previewFinished;

  const activeQuestion: SanitizedQuestion | GameQuestion | null = useMemo(() => {
    if (mode === 'LIVE_SESSION') {
      return liveCurrentQuestion || game.questions?.[activeStageIndex] || null;
    }
    return game.questions?.[previewStageIdx] || null;
  }, [mode, liveCurrentQuestion, game.questions, activeStageIndex, previewStageIdx]);

  const activeTimeRemaining = previewTimeRemaining;

  // World geometry calculation
  const checkpointPositions = useMemo(() => {
    return Array.from(
      { length: totalStages },
      (_, idx) => FIRST_CHECKPOINT_X + idx * STAGE_SEGMENT_LENGTH
    );
  }, [totalStages]);

  const finishGateX = useMemo(() => {
    const lastCheckpoint =
      checkpointPositions[checkpointPositions.length - 1] || FIRST_CHECKPOINT_X;
    return lastCheckpoint + 460;
  }, [checkpointPositions]);

  // Build world obstacles and collectibles
  const initialWorldObstacles = useMemo<WorldObstacle[]>(() => {
    const list: WorldObstacle[] = [];
    const densityCount =
      effectiveConfig.obstacleDensity === 'HIGH'
        ? 3
        : effectiveConfig.obstacleDensity === 'LOW'
          ? 1
          : 2;
    const types: ObstacleType[] =
      effectiveConfig.obstacleTypes.length > 0
        ? effectiveConfig.obstacleTypes
        : ['TRAFFIC_CONE', 'CARGO_CRATE', 'BARRIER_GATE'];

    for (let stageIdx = 0; stageIdx < totalStages; stageIdx++) {
      const segmentStart =
        stageIdx === 0 ? 250 : checkpointPositions[stageIdx - 1] + 160;
      const segmentEnd = checkpointPositions[stageIdx] - 160;
      const span = Math.max(180, segmentEnd - segmentStart);

      for (let k = 0; k < densityCount; k++) {
        const ratio = (k + 0.5) / densityCount;
        const obsX = Math.round(segmentStart + span * ratio);
        const obsType = types[(stageIdx + k) % types.length];
        const isTall =
          obsType === 'SERVER_FIREWALL' ||
          obsType === 'BIOHAZARD_CART' ||
          obsType === 'MEDICAL_SCREEN';
        list.push({
          id: `obs_${stageIdx}_${k}`,
          stageIndex: stageIdx,
          x: obsX,
          width: isTall ? 46 : 42,
          height: isTall ? 54 : 44,
          type: obsType,
          cleared: false,
          hit: false,
        });
      }
    }
    return list;
  }, [
    totalStages,
    checkpointPositions,
    effectiveConfig.obstacleDensity,
    effectiveConfig.obstacleTypes,
  ]);

  const initialWorldCollectibles = useMemo<WorldCollectible[]>(() => {
    const tokens: WorldCollectible[] = [];
    for (let stageIdx = 0; stageIdx < totalStages; stageIdx++) {
      const segmentStart =
        stageIdx === 0 ? 180 : checkpointPositions[stageIdx - 1] + 110;
      const segmentEnd = checkpointPositions[stageIdx] - 110;
      const midX = Math.round((segmentStart + segmentEnd) / 2);
      tokens.push({
        id: `token_${stageIdx}_a`,
        x: segmentStart + 60,
        yOffset: -26,
        label: 'HUY HIỆU AN TOÀN',
        collected: false,
      });
      tokens.push({
        id: `token_${stageIdx}_b`,
        x: midX + 55,
        yOffset: -74,
        label: 'MŨ CHUẨN +10',
        collected: false,
      });
    }
    return tokens;
  }, [totalStages, checkpointPositions]);

  const worldDecorList = useMemo<WorldDecor[]>(() => {
    const decors: WorldDecor[] = [];
    const kinds: WorldDecor['kind'][] = ['SIGN', 'LAMP', 'TREE', 'PILLAR', 'BANNER'];
    for (let x = 160; x < finishGateX + 300; x += 220) {
      const stageIdx = Math.min(
        totalStages - 1,
        Math.max(0, Math.floor(x / STAGE_SEGMENT_LENGTH))
      );
      const stageInfo = effectiveConfig.stages[stageIdx];
      decors.push({
        id: `decor_${x}`,
        x,
        kind: kinds[Math.floor(x / 220) % kinds.length],
        label: stageInfo?.zoneLabel || effectiveConfig.subEnvironment,
      });
    }
    return decors;
  }, [finishGateX, totalStages, effectiveConfig.stages, effectiveConfig.subEnvironment]);

  // Mutable physics state inside ref for 60fps Canvas loop
  const physicsRef = useRef({
    playerX: 90,
    playerY: 0,
    vy: 0,
    vx: 0,
    facing: 1 as 1 | -1,
    isGrounded: true,
    wheelAngle: 0,
    invulnerableUntil: 0,
    cameraX: 0,
    keys: {
      left: false,
      right: false,
      jump: false,
    },
    obstacles: [] as WorldObstacle[],
    collectibles: [] as WorldCollectible[],
    particles: [] as FloatingParticle[],
    unlockedStageCount: 0,
  });

  useEffect(() => {
    physicsRef.current.obstacles = initialWorldObstacles.map(o => ({ ...o }));
    physicsRef.current.collectibles = initialWorldCollectibles.map(c => ({ ...c }));
  }, [initialWorldObstacles, initialWorldCollectibles]);

  // Reset engine state completely when gameId or archetype/preset changes
  useEffect(() => {
    setPreviewStarted(false);
    setPreviewStageIdx(0);
    setPreviewFeedback(null);
    setPreviewFinished(false);
    setPreviewScore(0);
    setPreviewCorrectCount(0);
    setPreviewWrongCount(0);
    setPreviewStreak(0);
    setPreviewMaxStreak(0);
    setActiveModalOpen(false);
    setStageInspected(false);
    setIsPaused(false);
    inspectedStagesRef.current.clear();
    setSelectedChoice('');
    setTextAnswer('');
    setSkillBonusScore(0);
    setObstaclesClearedCount(0);
    setObstaclesHitCount(0);
    setEnergyPercent(100);
    setNearCheckpointIndex(null);
    setReachedFinishGate(false);
    setPlayerProgressPercent(0);
    physicsRef.current.playerX = 90;
    physicsRef.current.playerY = 0;
    physicsRef.current.vy = 0;
    physicsRef.current.vx = 0;
    physicsRef.current.cameraX = 0;
    physicsRef.current.particles = [];
    physicsRef.current.unlockedStageCount = 0;
  }, [game.gameId, effectiveConfig.themePresetId, effectiveConfig.gameplayArchetype]);

  // Keep unlockedStageCount in sync with activeStageIndex & activeFeedback
  useEffect(() => {
    const unlocked = activeFeedback ? activeStageIndex + 1 : activeStageIndex;
    physicsRef.current.unlockedStageCount = unlocked;
    if (activeStageIndex > 0 && checkpointPositions[activeStageIndex - 1]) {
      const minX = checkpointPositions[activeStageIndex - 1] + 40;
      if (physicsRef.current.playerX < minX) {
        physicsRef.current.playerX = minX;
      }
    }
  }, [activeStageIndex, activeFeedback, checkpointPositions]);

  // Reset question input and stage inspection state when stage changes
  useEffect(() => {
    setSelectedChoice('');
    setTextAnswer('');
    setStageInspected(inspectedStagesRef.current.has(activeStageIndex));
    setPreviewTimeRemaining(game.settings?.timePerQuestion || 20);
  }, [activeStageIndex, activeQuestion?.id, game.settings?.timePerQuestion]);

  // Preview countdown timer when checkpoint question modal or inline non-runner question is active
  useEffect(() => {
    const isChallengeActive = isRunnerArchetype ? activeModalOpen : stageInspected;
    if (!isChallengeActive || Boolean(activeFeedback) || isJourneyFinished || isPaused) return;

    const timer = window.setInterval(() => {
      setPreviewTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [
    mode,
    isRunnerArchetype,
    activeModalOpen,
    stageInspected,
    previewFeedback,
    previewFinished,
    activeFeedback,
    isJourneyFinished,
    isPaused,
  ]);

  const spawnFloatingText = useCallback(
    (worldX: number, worldY: number, text: string, color: string) => {
      physicsRef.current.particles.push({
        id: Date.now() + Math.random(),
        x: worldX,
        y: worldY,
        vx: 0,
        vy: -48,
        color,
        size: 14,
        alpha: 1,
        text,
      });
    },
    []
  );

  const spawnBurstParticles = useCallback(
    (worldX: number, worldY: number, color: string) => {
      for (let i = 0; i < 14; i++) {
        const angle = (Math.PI * 2 * i) / 14;
        const speed = 70 + Math.random() * 90;
        physicsRef.current.particles.push({
          id: Date.now() + Math.random() + i,
          x: worldX,
          y: worldY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          color,
          size: 5 + Math.random() * 4,
          alpha: 1,
        });
      }
    },
    []
  );

  const triggerJump = useCallback(() => {
    const p = physicsRef.current;
    if (p.isGrounded && !activeModalOpen && !isPaused) {
      p.vy = JUMP_VELOCITY;
      p.isGrounded = false;
      playClickSound();
      setTimeout(() => setShowHowToPlay(false), 1200);
    }
  }, [activeModalOpen, isPaused]);

  const handleInspectCurrentStage = useCallback(() => {
    if (!activeQuestion || isPaused) return;
    if (!inspectedStagesRef.current.has(activeStageIndex)) {
      inspectedStagesRef.current.add(activeStageIndex);
      setSkillBonusScore(prev => prev + 15);
      setObstaclesClearedCount(prev => prev + 1);
      playClickSound();
    }
    setStageInspected(true);
  }, [activeQuestion, activeStageIndex, isPaused]);

  const handleCollectArenaBonus = useCallback((bonusPoints: number) => {
    setSkillBonusScore(prev => Math.max(0, prev + bonusPoints));
    if (bonusPoints > 0) {
      playClickSound();
    }
  }, []);

  const handleArenaHazardHit = useCallback(() => {
    setEnergyPercent(prev => Math.max(10, prev - 8));
    playWrongSound();
  }, []);

  const handleOpenCheckpointModal = useCallback(() => {
    if (!activeQuestion || isPaused) return;
    if (!isRunnerArchetype) {
      handleInspectCurrentStage();
      return;
    }
    setActiveModalOpen(true);
    physicsRef.current.keys.left = false;
    physicsRef.current.keys.right = false;
  }, [activeQuestion, isPaused, isRunnerArchetype, handleInspectCurrentStage]);

  // Handle Answer Submission (both Live Session and Creator Preview)
  const handleAnswerSubmit = useCallback(
    (explicitAnswer?: string) => {
      if (!activeQuestion || activeFeedback || submittingAnswer || isPaused) return;
      const rawAns =
        explicitAnswer !== undefined
          ? explicitAnswer
          : activeQuestion.type === 'MULTIPLE_CHOICE' || activeQuestion.type === 'QUICK_BUTTON'
            ? selectedChoice
            : textAnswer.trim();

      if (!rawAns) return;

      if (mode === 'LIVE_SESSION' && onSubmitAnswer) {
        onSubmitAnswer(rawAns);
        return;
      }

      // Creator Preview Mode evaluation
      const fullQ = game.questions?.[previewStageIdx];
      if (!fullQ) return;
      const normalizeAns = (val: string) =>
        val.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
      const normalizedUser = normalizeAns(rawAns);
      const validAnswers = new Set<string>();
      const addCandidate = (rawStr: string) => {
        const full = normalizeAns(rawStr);
        if (full) validAnswers.add(full);
        if (rawStr.includes('|') || rawStr.includes(';')) {
          for (const part of rawStr.split(/[|;]/)) {
            const p = normalizeAns(part);
            if (p) validAnswers.add(p);
          }
        }
      };
      addCandidate(fullQ.correctAnswer || '');
      for (const alt of fullQ.acceptedAlternatives || []) {
        if (typeof alt === 'string') addCandidate(alt);
      }
      const isCorrect = normalizedUser.length > 0 && validAnswers.has(normalizedUser);
      const earned = isCorrect ? 100 + previewStreak * 15 : 0;
      const newStreak = isCorrect ? previewStreak + 1 : 0;

      if (isCorrect) {
        playCorrectSound();
        setPreviewScore(prev => prev + earned);
        setPreviewCorrectCount(prev => prev + 1);
        setPreviewStreak(newStreak);
        setPreviewMaxStreak(prev => Math.max(prev, newStreak));
        setEnergyPercent(prev => Math.min(100, prev + 20));
        const cpX = checkpointPositions[previewStageIdx] || physicsRef.current.playerX;
        spawnBurstParticles(cpX, -70, '#3fc07a');
        spawnFloatingText(cpX, -110, `+${earned} ĐIỂM`, '#3fc07a');
      } else {
        playWrongSound();
        setPreviewStreak(0);
        setPreviewWrongCount(prev => prev + 1);
        setEnergyPercent(prev => Math.max(10, prev - 15));
      }

      setPreviewFeedback({
        questionId: fullQ.id,
        answer: rawAns,
        isCorrect,
        correctAnswer: fullQ.correctAnswer,
        explanation: fullQ.explanation,
        pointsEarned: earned,
        responseTimeMs: 5000,
        answeredAt: new Date().toISOString(),
      });
    },
    [
      activeQuestion,
      activeFeedback,
      submittingAnswer,
      isPaused,
      selectedChoice,
      textAnswer,
      mode,
      onSubmitAnswer,
      game.questions,
      previewStageIdx,
      previewStreak,
      checkpointPositions,
      spawnBurstParticles,
      spawnFloatingText,
    ]
  );

  // React to Live Session feedback arrival for particles & sound
  useEffect(() => {
    if (mode !== 'LIVE_SESSION' || !liveQuestionFeedback) return;
    const cpX = checkpointPositions[liveQuestionIndex] || physicsRef.current.playerX;
    if (liveQuestionFeedback.isCorrect) {
      playCorrectSound();
      setEnergyPercent(prev => Math.min(100, prev + 20));
      spawnBurstParticles(cpX, -70, '#3fc07a');
      spawnFloatingText(cpX, -110, `+${liveQuestionFeedback.pointsEarned} ĐIỂM`, '#3fc07a');
    } else {
      playWrongSound();
      setEnergyPercent(prev => Math.max(10, prev - 15));
    }
  }, [
    mode,
    liveQuestionFeedback,
    liveQuestionIndex,
    checkpointPositions,
    spawnBurstParticles,
    spawnFloatingText,
  ]);

  // Proceed after answering a checkpoint question — vehicle automatically resumes running
  const handleContinueJourney = useCallback(() => {
    setActiveModalOpen(false);
    setStageInspected(false);
    setAutoCruise(true);
    const isLastStage = activeStageIndex + 1 >= totalStages;

    if (!isRunnerArchetype && isLastStage) {
      setReachedFinishGate(true);
      playVictorySound();
      if (mode === 'LIVE_SESSION' && onNextQuestion && !liveFinalResult) {
        onNextQuestion();
      } else if (mode === 'CREATOR_PREVIEW') {
        setPreviewFinished(true);
      }
      return;
    }

    if (mode === 'LIVE_SESSION') {
      if (!isLastStage && onNextQuestion) {
        onNextQuestion();
      }
    } else {
      if (!isLastStage) {
        setPreviewFeedback(null);
        setPreviewStageIdx(prev => prev + 1);
        setPreviewTimeRemaining(game.settings?.timePerQuestion || 20);
      }
    }
  }, [
    activeStageIndex,
    totalStages,
    isRunnerArchetype,
    mode,
    onNextQuestion,
    liveFinalResult,
    game.settings?.timePerQuestion,
  ]);

  // When player reaches the Finish Gate after unlocking the last stage
  useEffect(() => {
    if (!reachedFinishGate) return;
    const allUnlocked = activeStageIndex + 1 >= totalStages && Boolean(activeFeedback);
    if (!allUnlocked) return;

    playVictorySound();
    if (mode === 'LIVE_SESSION' && onNextQuestion && !liveFinalResult) {
      onNextQuestion();
    } else if (mode === 'CREATOR_PREVIEW' && !previewFinished) {
      setPreviewFinished(true);
    }
  }, [
    reachedFinishGate,
    activeStageIndex,
    totalStages,
    activeFeedback,
    mode,
    onNextQuestion,
    liveFinalResult,
    previewFinished,
  ]);

  // Keyboard Listeners
  useEffect(() => {
    if (isJourneyFinished) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isJourneyStarted) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Enter' && (activeModalOpen || stageInspected) && !activeFeedback) {
          e.preventDefault();
          handleAnswerSubmit();
        }
        return;
      }

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setIsPaused(prev => !prev);
        return;
      }

      if (isPaused) return;

      // Non-runner challenge shortcuts
      if (!isRunnerArchetype) {
        if (activeFeedback && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleContinueJourney();
          return;
        }
        if (
          stageInspected &&
          !activeFeedback &&
          activeQuestion &&
          Array.isArray(activeQuestion.choices) &&
          ['1', '2', '3', '4'].includes(e.key)
        ) {
          const idx = Number(e.key) - 1;
          const choice = activeQuestion.choices[idx];
          if (choice) {
            e.preventDefault();
            setSelectedChoice(choice);
            handleAnswerSubmit(choice);
          }
          return;
        }
        if (!stageInspected && e.key === 'Enter') {
          e.preventDefault();
          handleInspectCurrentStage();
          return;
        }
        return;
      }

      if (activeModalOpen) {
        if (activeFeedback && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleContinueJourney();
          return;
        }
        if (
          !activeFeedback &&
          activeQuestion &&
          Array.isArray(activeQuestion.choices) &&
          ['1', '2', '3', '4'].includes(e.key)
        ) {
          const idx = Number(e.key) - 1;
          const choice = activeQuestion.choices[idx];
          if (choice) {
            e.preventDefault();
            setSelectedChoice(choice);
            handleAnswerSubmit(choice);
          }
        }
        return;
      }

      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        triggerJump();
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        physicsRef.current.keys.right = true;
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        physicsRef.current.keys.left = true;
      } else if (e.key === 'e' || e.key === 'E' || e.key === 'Enter') {
        if (nearCheckpointIndex !== null) {
          e.preventDefault();
          handleOpenCheckpointModal();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        physicsRef.current.keys.right = false;
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        physicsRef.current.keys.left = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    isJourneyStarted,
    isJourneyFinished,
    isPaused,
    isRunnerArchetype,
    stageInspected,
    activeModalOpen,
    activeFeedback,
    activeQuestion,
    nearCheckpointIndex,
    triggerJump,
    handleInspectCurrentStage,
    handleOpenCheckpointModal,
    handleAnswerSubmit,
    handleContinueJourney,
  ]);

  // Main 60fps Canvas Physics & Rendering Loop
  useEffect(() => {
    if (isJourneyFinished || !isRunnerArchetype) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastTime = performance.now();

    const drawAvatar = (
      c: CanvasRenderingContext2D,
      avatarId: AvatarId,
      screenX: number,
      groundY: number,
      playerY: number,
      wheelAngle: number,
      invulnerable: boolean,
      accentColor: string
    ) => {
      c.save();
      c.translate(screenX, groundY + playerY);
      if (invulnerable && Math.floor(performance.now() / 80) % 2 === 0) {
        c.globalAlpha = 0.45;
      }

      if (avatarId === 'MOTO_RIDER') {
        const drawWheel = (wx: number) => {
          c.save();
          c.translate(wx, -16);
          c.fillStyle = '#0F172A';
          c.beginPath();
          c.arc(0, 0, 15, 0, Math.PI * 2);
          c.fill();
          c.lineWidth = 3;
          c.strokeStyle = '#94A3B8';
          c.stroke();
          c.rotate(wheelAngle);
          c.strokeStyle = accentColor;
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(-10, 0);
          c.lineTo(10, 0);
          c.moveTo(0, -10);
          c.lineTo(0, 10);
          c.stroke();
          c.restore();
        };
        drawWheel(-22);
        drawWheel(24);

        c.fillStyle = accentColor;
        c.beginPath();
        c.moveTo(-26, -20);
        c.lineTo(-6, -38);
        c.lineTo(22, -36);
        c.lineTo(32, -20);
        c.closePath();
        c.fill();

        const grad = c.createLinearGradient(30, -32, 130, -18);
        grad.addColorStop(0, 'rgba(253, 224, 71, 0.5)');
        grad.addColorStop(1, 'rgba(253, 224, 71, 0)');
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(30, -33);
        c.lineTo(130, -48);
        c.lineTo(130, -8);
        c.closePath();
        c.fill();

        c.fillStyle = '#1E293B';
        c.fillRect(-10, -56, 16, 22);
        c.fillStyle = '#F8FAFC';
        c.beginPath();
        c.arc(0, -64, 11, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#38BDF8';
        c.fillRect(2, -68, 9, 6);
      } else if (avatarId === 'CYBER_BOT') {
        const hoverOffset = Math.sin(wheelAngle * 2) * 4;
        c.translate(0, hoverOffset);
        c.fillStyle = '#22D3EE';
        c.beginPath();
        c.arc(0, -10, 9, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#0F172A';
        c.strokeStyle = accentColor;
        c.lineWidth = 3;
        c.beginPath();
        c.roundRect(-20, -54, 40, 38, 10);
        c.fill();
        c.stroke();
        c.beginPath();
        c.roundRect(-16, -78, 32, 22, 8);
        c.fill();
        c.stroke();
        c.fillStyle = '#22D3EE';
        c.fillRect(-10, -71, 22, 7);
      } else {
        const stride = Math.sin(wheelAngle * 3) * 8;
        c.strokeStyle = '#1E293B';
        c.lineWidth = 6;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-4, -26);
        c.lineTo(-4 - stride, -3);
        c.moveTo(4, -26);
        c.lineTo(4 + stride, -3);
        c.stroke();

        c.fillStyle =
          avatarId === 'MEDICAL_MEDIC'
            ? '#F8FAFC'
            : avatarId === 'FACTORY_ENGINEER'
              ? '#F59E0B'
              : avatarId === 'SALES_ADVISOR'
                ? '#0EA5E9'
                : accentColor;
        c.beginPath();
        c.roundRect(-14, -56, 28, 32, 7);
        c.fill();

        c.fillStyle = '#FDE68A';
        c.beginPath();
        c.arc(0, -67, 11, 0, Math.PI * 2);
        c.fill();

        if (avatarId === 'FACTORY_ENGINEER') {
          c.fillStyle = '#EAB308';
          c.beginPath();
          c.arc(0, -71, 12, Math.PI, 0);
          c.fill();
        } else if (avatarId === 'MEDICAL_MEDIC') {
          c.fillStyle = '#EF4444';
          c.fillRect(-5, -45, 10, 3);
          c.fillRect(-1.5, -48.5, 3, 10);
        }
      }
      c.restore();
    };

    const drawObstacle = (
      c: CanvasRenderingContext2D,
      obs: WorldObstacle,
      screenX: number,
      groundY: number,
      accentColor: string
    ) => {
      c.save();
      c.translate(screenX, groundY);

      if (obs.type === 'TRAFFIC_CONE') {
        c.fillStyle = '#F97316';
        c.beginPath();
        c.moveTo(4, 0);
        c.lineTo(obs.width / 2, -obs.height);
        c.lineTo(obs.width - 4, 0);
        c.closePath();
        c.fill();
        c.fillStyle = '#F8FAFC';
        c.fillRect(11, -obs.height * 0.58, obs.width - 22, 7);
      } else if (obs.type === 'OIL_BARREL') {
        c.fillStyle = '#DC2626';
        c.beginPath();
        c.roundRect(2, -obs.height, obs.width - 4, obs.height, 6);
        c.fill();
        c.fillStyle = '#FACC15';
        c.fillRect(4, -obs.height * 0.65, obs.width - 8, 8);
        c.fillStyle = '#0F172A';
        c.font = 'bold 10px "Be Vietnam Pro", system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('OIL', obs.width / 2, -obs.height * 0.3);
      } else if (obs.type === 'TIRE_STACK') {
        for (let i = 0; i < 3; i++) {
          c.fillStyle = '#1E293B';
          c.beginPath();
          c.roundRect(3, -(i + 1) * 14, obs.width - 6, 13, 5);
          c.fill();
          c.strokeStyle = '#64748B';
          c.lineWidth = 1.5;
          c.stroke();
        }
      } else if (obs.type === 'SERVER_FIREWALL' || obs.type === 'BUG_DRONE') {
        c.fillStyle = '#0F172A';
        c.strokeStyle = '#EF4444';
        c.lineWidth = 2.5;
        c.beginPath();
        c.roundRect(2, -obs.height, obs.width - 4, obs.height, 6);
        c.fill();
        c.stroke();
        c.fillStyle = '#EF4444';
        c.font = 'bold 10px monospace';
        c.textAlign = 'center';
        c.fillText(obs.type === 'BUG_DRONE' ? 'BUG' : 'FW', obs.width / 2, -obs.height / 2);
      } else if (obs.type === 'BIOHAZARD_CART' || obs.type === 'MEDICAL_SCREEN') {
        c.fillStyle = '#F8FAFC';
        c.strokeStyle = '#0D9488';
        c.lineWidth = 2.5;
        c.beginPath();
        c.roundRect(2, -obs.height, obs.width - 4, obs.height, 6);
        c.fill();
        c.stroke();
        c.fillStyle = '#EF4444';
        c.fillRect(obs.width / 2 - 6, -obs.height / 2 - 2, 12, 4);
        c.fillRect(obs.width / 2 - 2, -obs.height / 2 - 6, 4, 12);
      } else {
        c.fillStyle = '#D97706';
        c.strokeStyle = accentColor;
        c.lineWidth = 2;
        c.beginPath();
        c.roundRect(2, -obs.height, obs.width - 4, obs.height, 4);
        c.fill();
        c.stroke();
        c.strokeStyle = '#78350F';
        c.beginPath();
        c.moveTo(4, -obs.height + 4);
        c.lineTo(obs.width - 4, -4);
        c.stroke();
      }

      if (!obs.cleared) {
        c.fillStyle = '#F8FAFC';
        c.font = 'bold 10px "Be Vietnam Pro", system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('NHẢY', obs.width / 2, -obs.height - 8);
      }
      c.restore();
    };

    const step = (now: number) => {
      const dt =
        isJourneyStarted && !isPaused ? Math.min(0.05, (now - lastTime) / 1000) : 0;
      lastTime = now;

      const p = physicsRef.current;
      const palette = effectiveConfig.palette;
      const width = canvas.width;
      const height = canvas.height;
      const groundHeight = Math.max(92, Math.min(140, Math.round(height * 0.18)));
      const groundY = height - groundHeight;

      const currentLockedIdx = p.unlockedStageCount;
      const blockingCheckpointX =
        currentLockedIdx < checkpointPositions.length
          ? checkpointPositions[currentLockedIdx]
          : finishGateX;

      const moveRightActive =
        isJourneyStarted && !isPaused && (p.keys.right || (autoCruise && !activeModalOpen));
      const moveLeftActive = p.keys.left && !activeModalOpen && !isPaused;

      const speed = BASE_MOVE_SPEED * (effectiveConfig.speedMultiplier || 1);
      if (moveRightActive && !activeModalOpen) {
        p.vx = speed;
        p.facing = 1;
      } else if (moveLeftActive && !activeModalOpen) {
        p.vx = -speed * 0.85;
        p.facing = -1;
      } else {
        p.vx = 0;
      }

      p.playerX += p.vx * dt;
      if (p.playerX < 40) p.playerX = 40;

      if (p.playerX >= blockingCheckpointX - 18) {
        p.playerX = blockingCheckpointX - 18;
        p.vx = 0;
      }

      if (Math.abs(p.vx) > 5 && p.isGrounded) {
        p.wheelAngle += (p.vx * dt) / 16;
      }

      if (!p.isGrounded || p.vy < 0) {
        p.playerY += p.vy * dt;
        p.vy += GRAVITY * dt;
        if (p.playerY >= 0) {
          p.playerY = 0;
          p.vy = 0;
          p.isGrounded = true;
        }
      }

      const playerLeft = p.playerX - 20;
      const playerRight = p.playerX + 20;
      const playerBottom = p.playerY;
      const playerTop = p.playerY - 58;

      // Collectible Safety Tokens pickup
      for (const token of p.collectibles) {
        if (token.collected) continue;
        const dx = Math.abs(p.playerX - token.x);
        const dy = Math.abs(p.playerY - 26 - token.yOffset);
        if (dx < 32 && dy < 38) {
          token.collected = true;
          setSkillBonusScore(prev => prev + 10);
          spawnBurstParticles(token.x, token.yOffset, '#3fc07a');
          spawnFloatingText(token.x, token.yOffset - 18, '+10 AN TOÀN', '#3fc07a');
          playClickSound();
        }
      }

      // AABB Collision Detection with Obstacles
      for (const obs of p.obstacles) {
        const obsLeft = obs.x;
        const obsRight = obs.x + obs.width;
        const obsTop = -obs.height;

        if (!obs.cleared && !obs.hit && playerLeft > obsRight) {
          obs.cleared = true;
          setSkillBonusScore(prev => prev + 15);
          setObstaclesClearedCount(prev => prev + 1);
          spawnFloatingText(obs.x, -obs.height - 25, gameplayProfile.clearFloatingText, '#38BDF8');
        }

        const horizontalOverlap = playerRight > obsLeft + 4 && playerLeft < obsRight - 4;
        const verticalOverlap = playerBottom > obsTop + 6 && playerTop < 0;

        if (!obs.hit && horizontalOverlap && verticalOverlap && now > p.invulnerableUntil) {
          obs.hit = true;
          p.invulnerableUntil = now + 900;
          p.playerX = Math.max(40, obsLeft - 28);
          p.vy = -260;
          p.isGrounded = false;
          setObstaclesHitCount(prev => prev + 1);
          setEnergyPercent(prev => Math.max(10, prev - 12));
          setSkillBonusScore(prev => Math.max(0, prev - 5));
          spawnBurstParticles(obs.x + obs.width / 2, -obs.height / 2, '#EF4444');
          spawnFloatingText(
            obs.x,
            -obs.height - 20,
            `VA CHẠM ${OBSTACLE_METADATA[obs.type]?.label?.toUpperCase() || ''}`,
            '#F87171'
          );
          playWrongSound();
        }
      }

      // Proximity to active Checkpoint
      if (currentLockedIdx < checkpointPositions.length) {
        const targetCpX = checkpointPositions[currentLockedIdx];
        const dist = Math.abs(p.playerX - targetCpX);
        if (dist <= 52) {
          setNearCheckpointIndex(currentLockedIdx);
          if (!activeModalOpen && !activeFeedback) {
            setActiveModalOpen(true);
            p.keys.right = false;
            p.keys.left = false;
          }
        } else {
          setNearCheckpointIndex(null);
        }
      } else {
        setNearCheckpointIndex(null);
        if (p.playerX >= finishGateX - 30) {
          setReachedFinishGate(true);
        }
      }

      const pct = Math.min(100, Math.max(0, Math.round((p.playerX / finishGateX) * 100)));
      setPlayerProgressPercent(pct);

      const targetCamX = Math.max(0, p.playerX - width * 0.26);
      p.cameraX += (targetCamX - p.cameraX) * (effectiveConfig.reducedMotion ? 1 : 0.14);

      // ================= RENDER SCENE =================
      const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
      skyGrad.addColorStop(0, palette.skyTop);
      skyGrad.addColorStop(1, palette.skyBottom);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, groundY);

      const glowGrad = ctx.createLinearGradient(0, groundY - 120, 0, groundY);
      glowGrad.addColorStop(0, 'rgba(0,0,0,0)');
      glowGrad.addColorStop(1, `${palette.horizonGlow}44`);
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, groundY - 120, width, 120);

      // Parallax Layer 1
      const farParallax = effectiveConfig.reducedMotion ? 0 : p.cameraX * 0.2;
      ctx.fillStyle = `${palette.buildingPrimary}AA`;
      const farCount = Math.ceil(width / 220) + 4;
      for (let i = -1; i < farCount; i++) {
        const bx =
          ((i * 220 - (farParallax % 220)) + width + 220) % (width + 440) - 220;
        const bh = 120 + ((Math.abs(i) * 43) % 130);
        ctx.fillRect(bx, groundY - bh, 160, bh);
      }

      // Parallax Layer 2
      const midParallax = effectiveConfig.reducedMotion ? 0 : p.cameraX * 0.5;
      const midCount = Math.ceil(width / 290) + 4;
      for (let i = -1; i < midCount; i++) {
        const mx =
          ((i * 290 - (midParallax % 290)) + width + 290) % (width + 580) - 290;
        const mh = 95 + ((Math.abs(i) * 53) % 90);
        ctx.fillStyle = palette.buildingSecondary;
        ctx.beginPath();
        ctx.roundRect(mx, groundY - mh, 195, mh, [8, 8, 0, 0]);
        ctx.fill();

        ctx.fillStyle = `${palette.accentColor}55`;
        for (let wy = groundY - mh + 16; wy < groundY - 18; wy += 20) {
          ctx.fillRect(mx + 18, wy, 38, 9);
          ctx.fillRect(mx + 74, wy, 38, 9);
          ctx.fillRect(mx + 130, wy, 38, 9);
        }
      }

      // World Decor Signboards
      for (const dec of worldDecorList) {
        const sx = dec.x - p.cameraX;
        if (sx < -140 || sx > width + 140) continue;

        ctx.save();
        ctx.translate(sx, groundY);
        ctx.fillStyle = '#64748B';
        ctx.fillRect(-2, -68, 4, 68);
        ctx.fillStyle = '#0F172A';
        ctx.strokeStyle = palette.accentColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(-54, -90, 108, 24, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#E2E8F0';
        ctx.font = 'bold 10px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((dec.label || '').slice(0, 18), 0, -74);
        ctx.restore();
      }

      // Ground & Road Track
      ctx.fillStyle = palette.roadSurface;
      ctx.fillRect(0, groundY, width, groundHeight);
      ctx.fillStyle = palette.accentColor;
      ctx.fillRect(0, groundY, width, 4);

      ctx.fillStyle = palette.roadLine;
      const dashOffset = p.cameraX % 90;
      for (let rx = -dashOffset; rx < width + 90; rx += 90) {
        ctx.fillRect(rx, groundY + Math.round(groundHeight * 0.42), 48, 5);
      }

      // Checkpoints
      checkpointPositions.forEach((cpX, idx) => {
        const sx = cpX - p.cameraX;
        if (sx < -160 || sx > width + 160) return;
        const isUnlocked = idx < p.unlockedStageCount;
        const isCurrent = idx === p.unlockedStageCount;
        const stageMeta = effectiveConfig.stages[idx];

        ctx.save();
        ctx.translate(sx, groundY);

        ctx.fillStyle = isUnlocked ? '#3fc07a' : isCurrent ? palette.accentColor : '#64748B';
        ctx.fillRect(-40, -130, 8, 130);
        ctx.fillRect(32, -130, 8, 130);

        ctx.fillStyle = '#0F172A';
        ctx.strokeStyle = isUnlocked ? '#3fc07a' : isCurrent ? palette.accentColor : '#64748B';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-74, -168, 148, 40, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isUnlocked ? '#3fc07a' : '#F8FAFC';
        ctx.font = 'bold 11px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          isUnlocked ? `CHẶNG ${idx + 1} ĐÃ QUA` : `CHẶNG ${idx + 1}`,
          0,
          -150
        );
        ctx.fillStyle = '#94A3B8';
        ctx.font = '10px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.fillText((stageMeta?.checkpointTitle || '').slice(0, 22), 0, -135);

        if (!isUnlocked) {
          ctx.strokeStyle = isCurrent ? palette.accentColor : '#EF4444';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(0, -126);
          ctx.lineTo(0, 0);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      });

      // Finish Gate
      const finishScreenX = finishGateX - p.cameraX;
      if (finishScreenX > -160 && finishScreenX < width + 160) {
        ctx.save();
        ctx.translate(finishScreenX, groundY);
        ctx.fillStyle = '#EAB308';
        ctx.fillRect(-44, -136, 10, 136);
        ctx.fillRect(34, -136, 10, 136);
        ctx.fillStyle = '#0F172A';
        ctx.strokeStyle = '#EAB308';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-74, -174, 148, 40, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FACC15';
        ctx.font = 'bold 12px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ĐÍCH ĐẾN HÀNH TRÌNH', 0, -150);
        ctx.restore();
      }

      // Collectible Safety Tokens
      for (const token of p.collectibles) {
        if (token.collected) continue;
        const sx = token.x - p.cameraX;
        if (sx < -60 || sx > width + 60) continue;
        ctx.save();
        ctx.translate(sx, groundY + token.yOffset);
        ctx.fillStyle = '#172a1d';
        ctx.strokeStyle = '#3fc07a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#3fc07a';
        ctx.font = 'bold 9px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+10', 0, 3);
        ctx.restore();
      }

      // Obstacles
      for (const obs of p.obstacles) {
        const sx = obs.x - p.cameraX;
        if (sx < -80 || sx > width + 80) continue;
        drawObstacle(ctx, obs, sx, groundY, palette.accentColor);
      }

      // Player Avatar
      const playerScreenX = p.playerX - p.cameraX;
      drawAvatar(
        ctx,
        effectiveConfig.avatarId,
        playerScreenX,
        groundY,
        p.playerY,
        p.wheelAngle,
        now < p.invulnerableUntil,
        palette.accentColor
      );

      // Floating Particles & Score Popups
      for (let i = p.particles.length - 1; i >= 0; i--) {
        const pt = p.particles[i];
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.alpha -= dt * 0.9;
        if (pt.alpha <= 0) {
          p.particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, pt.alpha);
        const px = pt.x - p.cameraX;
        const py = groundY + pt.y;
        if (pt.text) {
          ctx.fillStyle = pt.color;
          ctx.font = 'bold 13px "Be Vietnam Pro", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(pt.text, px, py);
        } else {
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(px, py, pt.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (isJourneyStarted) {
        animationFrameId = requestAnimationFrame(step);
      } else if (!animationFrameId) {
        animationFrameId = -1;
        step(performance.now());
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    isJourneyStarted,
    isJourneyFinished,
    isPaused,
    isRunnerArchetype,
    effectiveConfig,
    checkpointPositions,
    finishGateX,
    worldDecorList,
    autoCruise,
    activeModalOpen,
    activeFeedback,
    canvasSize.width,
    canvasSize.height,
    gameplayProfile.clearFloatingText,
    spawnBurstParticles,
    spawnFloatingText,
  ]);

  const handleRestartPreview = () => {
    physicsRef.current.playerX = 90;
    physicsRef.current.playerY = 0;
    physicsRef.current.vy = 0;
    physicsRef.current.cameraX = 0;
    physicsRef.current.unlockedStageCount = 0;
    physicsRef.current.obstacles = initialWorldObstacles.map(o => ({ ...o }));
    physicsRef.current.collectibles = initialWorldCollectibles.map(c => ({ ...c }));
    setPreviewStageIdx(0);
    setPreviewFeedback(null);
    setPreviewFinished(false);
    setPreviewScore(0);
    setPreviewCorrectCount(0);
    setPreviewStreak(0);
    setPreviewMaxStreak(0);
    setSkillBonusScore(0);
    setObstaclesClearedCount(0);
    setObstaclesHitCount(0);
    setEnergyPercent(100);
    inspectedStagesRef.current.clear();
    setPreviewWrongCount(0);
    setReachedFinishGate(false);
    setActiveModalOpen(false);
    setIsPaused(false);
    setAutoCruise(true);
    if (mode === 'LIVE_SESSION' && onRestartSession) {
      onRestartSession();
    }
  };

  const currentStageMeta =
    effectiveConfig.stages[activeStageIndex] || effectiveConfig.stages[0];
  const currentQuizScore = mode === 'LIVE_SESSION' ? liveScore : previewScore;
  const totalDisplayScore = currentQuizScore + skillBonusScore;
  const currentCorrectCount = mode === 'LIVE_SESSION' ? liveCorrectCount : previewCorrectCount;
  const currentWrongCount = mode === 'LIVE_SESSION' ? liveWrongCount : previewWrongCount;
  const currentAnsweredCount = currentCorrectCount + currentWrongCount;
  const accentHex = effectiveConfig.palette.accentColor || '#F59E0B';

  return (
    <div
      ref={viewportContainerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        width: '100dvw',
        height: '100dvh',
        backgroundColor: '#090d16',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: 'var(--font-sans, "Be Vietnam Pro", system-ui, sans-serif)',
      }}
    >
      {/* ================= INTEGRATED TOP HUD BAR ================= */}
      <header
        style={{
          minHeight: '52px',
          padding: '6px 14px',
          backgroundColor: '#0b0f19',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          flexShrink: 0,
          zIndex: 30,
        }}
      >
        {/* Left: Game Title & Industry Context */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '6px',
              backgroundColor: '#161f30',
              border: '1px solid #26334d',
              color: '#f8fafc',
              fontSize: '11.5px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {effectiveConfig.industryLabel}
          </span>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: '14.5px',
                fontWeight: 700,
                color: '#f8fafc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '250px',
              }}
            >
              {game.title || effectiveConfig.environmentTitle}
            </h1>
          </div>
        </div>

        {/* Center: Divided KPI Strip (Chặng | Điểm | Năng lượng | Mục tiêu) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: '#111726',
            border: '1px solid #222d42',
            borderRadius: '8px',
            overflow: 'hidden',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <div
            style={{
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '5px',
              borderRight: '1px solid #222d42',
            }}
          >
            <span style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 500 }}>Chặng</span>
            <strong style={{ fontSize: '14px', color: '#f8fafc', fontWeight: 700 }}>
              {Math.min(totalStages, activeStageIndex + 1)}/{totalStages}
            </strong>
          </div>

          <div
            style={{
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '5px',
              borderRight: '1px solid #222d42',
            }}
          >
            <span style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 500 }}>Điểm</span>
            <strong
              data-testid="hud-total-score"
              style={{ fontSize: '14px', color: accentHex, fontWeight: 700 }}
            >
              {totalDisplayScore}
            </strong>
          </div>

          <div
            style={{
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '5px',
              borderRight: '1px solid #222d42',
            }}
          >
            <span style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 500 }}>An toàn</span>
            <strong
              data-testid="hud-safety-percent"
              style={{
                fontSize: '14px',
                color: energyPercent >= 50 ? '#3fc07a' : '#e5566f',
                fontWeight: 700,
              }}
            >
              {energyPercent}%
            </strong>
          </div>

          <div
            style={{
              padding: '5px 12px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '5px',
            }}
          >
            <span style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 500 }}>
              {sceneDescriptor.clearedMetricLabel}
            </span>
            <strong style={{ fontSize: '14px', color: '#3fc07a', fontWeight: 700 }}>
              {obstaclesClearedCount}
            </strong>
          </div>
        </div>

        {/* Right: Pause/Resume, How-To-Play Toggle, Fullscreen & Exit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isJourneyStarted && !isJourneyFinished && (
            <button
              type="button"
              data-testid="hud-pause-button"
              onClick={() => setIsPaused(prev => !prev)}
              style={{
                height: '32px',
                padding: '0 11px',
                borderRadius: '6px',
                backgroundColor: isPaused ? '#f59e0b' : '#111726',
                border: `1px solid ${isPaused ? '#f59e0b' : '#2e3c56'}`,
                color: isPaused ? '#090d16' : '#e2e8f0',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
            </button>
          )}

          <button
            type="button"
            data-testid="hud-how-to-play-button"
            onClick={() => setShowHowToPlay(prev => !prev)}
            style={{
              height: '32px',
              padding: '0 11px',
              borderRadius: '6px',
              backgroundColor: showHowToPlay ? '#1e293b' : '#111726',
              border: '1px solid #2e3c56',
              color: '#e2e8f0',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Cách chơi
          </button>

          <button
            type="button"
            onClick={toggleNativeFullscreen}
            style={{
              height: '32px',
              padding: '0 11px',
              borderRadius: '6px',
              backgroundColor: '#111726',
              border: '1px solid #2e3c56',
              color: '#e2e8f0',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isNativeFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
          </button>

          <button
            type="button"
            onClick={handleExitGame}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              backgroundColor: '#2c1a20',
              border: '1px solid #5c2632',
              color: '#e5566f',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Thoát
          </button>
        </div>
      </header>

      {/* Thin 3px Route Progress Bar */}
      <div
        style={{
          height: '3px',
          width: '100%',
          backgroundColor: '#111726',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${
              isRunnerArchetype
                ? playerProgressPercent
                : Math.min(100, Math.round((currentAnsweredCount / totalStages) * 100))
            }%`,
            backgroundColor: accentHex,
            transition: 'width 120ms linear',
          }}
        />
      </div>

      {/* ================= MAIN FULL-VIEWPORT GAME WORLD ================= */}
      <div
        ref={canvasWrapperRef}
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: '#090d16',
          touchAction: 'none',
        }}
        onPointerDown={e => {
          if (
            (e.target as HTMLElement)?.tagName === 'CANVAS' &&
            isJourneyStarted &&
            !isJourneyFinished &&
            !activeModalOpen &&
            !isPaused
          ) {
            e.preventDefault();
            triggerJump();
          }
        }}
      >
        {(() => {
          const commonSceneProps = {
            config: effectiveConfig,
            sceneDescriptor,
            activeStageIndex,
            totalStages,
            activeQuestion,
            activeFeedback: activeFeedback || null,
            activeTimeRemaining,
            submittingAnswer,
            selectedChoice,
            onSelectChoice: setSelectedChoice,
            textAnswer,
            onChangeTextAnswer: setTextAnswer,
            onSubmitAnswer: handleAnswerSubmit,
            onContinueStage: handleContinueJourney,
            stageInspected,
            onInspectStage: () => handleInspectCurrentStage(),
            energyPercent,
            skillBonusScore,
            answeredCount: currentAnsweredCount,
            correctCount: currentCorrectCount,
            wrongCount: currentWrongCount,
            isPaused,
            onCollectBonus: handleCollectArenaBonus,
            onHazardHit: handleArenaHazardHit,
          };

          switch (sceneDescriptor.sceneId) {
            case 'TRAFFIC_ROAD_RUNNER_SCENE':
              return (
                <canvas
                  data-testid="scene-traffic-road-runner"
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    touchAction: 'none',
                  }}
                />
              );
            case 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE':
              return <MechanicalDiagnosticGarageScene {...commonSceneProps} />;
            case 'KITCHEN_FOOD_SAFETY_LAB_SCENE':
              return <KitchenFoodSafetyLabScene {...commonSceneProps} />;
            case 'CODING_IDE_DEBUGGER_SCENE':
              return <CodingIdeDebuggerScene {...commonSceneProps} />;
            case 'CYBER_DEFENSE_SOC_RADAR_SCENE':
              return <CyberDefenseSocRadarScene {...commonSceneProps} />;
            case 'MEDICAL_CLINICAL_TRIAGE_SCENE':
              return <MedicalClinicalTriageScene {...commonSceneProps} />;
            case 'ACADEMY_KNOWLEDGE_LAB_SCENE':
              return <AcademyKnowledgeLabScene {...commonSceneProps} />;
            case 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE':
            default:
              return <CustomerConsultationShowroomScene {...commonSceneProps} />;
          }
        })()}

        {/* Scene-Specific Visual How-To-Play Modal Card (Opened via "Cách chơi" in Top Bar) */}
        {showHowToPlay && isJourneyStarted && !isJourneyFinished && !activeModalOpen && !stageInspected && (
          <div
            data-testid="scene-tutorial-banner"
            style={{
              position: 'absolute',
              top: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 28,
              backgroundColor: 'rgba(11, 15, 25, 0.96)',
              border: `1.5px solid ${accentHex}`,
              borderRadius: '12px',
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              width: 'min(640px, calc(100vw - 28px))',
              boxShadow: '0 14px 32px rgba(0, 0, 0, 0.6)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                borderBottom: '1px solid #1e293b',
                paddingBottom: '8px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 800, color: accentHex }}>
                CÁCH CHƠI · {sceneDescriptor.sceneBadge}
              </div>
              <button
                type="button"
                data-testid="close-how-to-play-btn"
                onClick={() => setShowHowToPlay(false)}
                style={{
                  background: '#161f30',
                  border: '1px solid #26334d',
                  borderRadius: '6px',
                  color: '#f8fafc',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '4px 10px',
                  flexShrink: 0,
                }}
              >
                Đóng
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
                lineHeight: 1.4,
              }}
            >
              {sceneDescriptor.sceneId === 'TRAFFIC_ROAD_RUNNER_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>DI CHUYỂN &amp; TỐC ĐỘ</strong>
                    Phím <code>A / D</code> hoặc <code>← / →</code> để giảm/tăng tốc trên làn đường.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>NHẢY NÉ VẬT CẢN</strong>
                    Nhấn <code>Space</code> / <code>W</code> / <code>↑</code> hoặc chạm trực tiếp màn hình để nhảy.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>VƯỢT CHỐT</strong>
                    Dừng tại cổng Chốt Sát Hạch và chọn đáp án đúng (phím <code>1-4</code>).
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'KITCHEN_FOOD_SAFETY_LAB_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>ĐỔI LÀN BẾP</strong>
                    Phím <code>← / →</code> hoặc <code>A / D</code> (hoặc chạm vào làn) để di chuyển Đầu Bếp.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>SƠ CHẾ &amp; NẤU MÓN</strong>
                    Nhấn <code>Space</code> hoặc chạm nguyên liệu sạch để chế biến; chạm vi khuẩn để hủy.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>HOÀN THÀNH MÓN</strong>
                    Đủ 3 nguyên liệu trên khay phục vụ sẽ mở câu hỏi kiểm định VSATTP.
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'MECHANICAL_DIAGNOSTIC_GARAGE_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>CHỌN DỤNG CỤ</strong>
                    Chạm vào hình Máy quét, Đồng hồ đo hoặc Cờ-lê trên khay dụng cụ.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>SIẾT BU-LÔNG &amp; CÂN LỰC</strong>
                    Chạm vào 2 ốc bu-lông lỏng để siết và nhấn <code>Space</code>/đồng hồ khi kim ở vùng xanh.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>AN TOÀN XƯỞNG</strong>
                    Tránh chạm vào vùng ống xả đang bốc khói nóng đỏ.
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'CODING_IDE_DEBUGGER_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>CHẠY &amp; NHẢY BẬC</strong>
                    Phím <code>A / D</code> để chạy, <code>W</code> / <code>↑</code> / <code>Space</code> (hoặc chạm bậc thềm) để nhảy.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>BẮN TIA DIỆT BUG</strong>
                    Nhấn phím <code>F</code> / <code>E</code> hoặc chạm trực tiếp vào con bọ Bug đỏ để bắn hạ.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>CỔNG ĐÍCH</strong>
                    Thu thập pha lê dữ liệu và nhảy tới Cổng Xoáy Năng Lượng ở tầng trên cùng.
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'CYBER_DEFENSE_SOC_RADAR_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>XOAY KHIÊN 360°</strong>
                    Phím <code>A / D</code>, <code>← / →</code> hoặc chạm quanh Lõi để xoay khiên chắn tường lửa.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>BẮN CHẶN MÃ ĐỘC</strong>
                    Nhấn <code>Space</code> hoặc chạm vào tên lửa/nhện mã độc đang bay vào để bắn hạ.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>KHÓA MỐI ĐE DỌA</strong>
                    Chặn đủ 3 mục tiêu tấn công để mở bảng câu hỏi phòng thủ SOC.
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'MEDICAL_CLINICAL_TRIAGE_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>CHỌN THIẾT BỊ Y KHOA</strong>
                    Chạm vào khay thiết bị bên trái (hoặc phím <code>1-3</code>: ECG, SpO2, RX-GPP) theo chỉ định trên màn hình ICU.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>ỔN ĐỊNH SINH HIỆU</strong>
                    Nhấn <code>Space</code> hoặc chạm vào Màn hình Sinh hiệu ICU bên phải để can thiệp và hội chẩn.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>VÔ KHUẨN LÂM SÀNG</strong>
                    Tránh chạm vào Mầm bệnh Sinh học màu đỏ đang di chuyển ở giữa phòng cấp cứu (<code>-5đ</code>).
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'ACADEMY_KNOWLEDGE_LAB_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>KÍCH HOẠT NÚT TRI THỨC</strong>
                    Chạm vào 3 Nút Tinh Vân bên trái (hoặc phím <code>1-3</code>) để kết nối tia năng lượng học thuật (<code>+10đ</code>).
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>TRÁNH NHIỄU NGỤY BIỆN</strong>
                    Không chạm vào Hạt Nhiễu Ngụy Biện màu đỏ đang bay cắt ngang mạch tri thức (<code>-5đ</code>).
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>MỞ CỔNG NGHIÊN CỨU</strong>
                    Nhấn <code>Space</code> hoặc chạm vào Cổng Nghiên Cứu trung tâm bên phải để bảo vệ chuyên đề.
                  </div>
                </>
              )}
              {sceneDescriptor.sceneId === 'CUSTOMER_CONSULTATION_SHOWROOM_SCENE' && (
                <>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: accentHex, display: 'block', marginBottom: '2px' }}>QUAN SÁT YÊU CẦU</strong>
                    Nhìn hình ảnh sản phẩm/món ăn trong bóng suy nghĩ của khách ở bàn bên phải.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px' }}>LẤY ĐÚNG SẢN PHẨM</strong>
                    Chạm vào kệ trưng bày tương ứng bên trái (hoặc phím <code>1-3</code>) để lấy hàng.
                  </div>
                  <div style={{ background: '#111726', padding: '8px 10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    <strong style={{ color: '#3fc07a', display: 'block', marginBottom: '2px' }}>GIAO TỚI KHÁCH HÀNG</strong>
                    Nhấn <code>Space</code> hoặc chạm vào bàn khách hàng để giao sản phẩm và tư vấn.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Pause Overlay */}
        {isPaused && isJourneyStarted && !isJourneyFinished && (
          <div
            data-testid="scene-pause-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 38,
              backgroundColor: 'rgba(9, 13, 22, 0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '420px',
                backgroundColor: '#111726',
                border: '1px solid #26334d',
                borderRadius: '12px',
                padding: '22px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '12px', color: accentHex, fontWeight: 800 }}>
                TẠM DỪNG TRÒ CHƠI
              </div>
              <h3 style={{ margin: '6px 0 14px 0', fontSize: '19px', color: '#f8fafc' }}>
                {game.title || effectiveConfig.environmentTitle}
              </h3>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => setIsPaused(false)}
                  style={{
                    height: '40px',
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
                  Tiếp tục chơi (P)
                </button>
                <button
                  type="button"
                  onClick={handleExitGame}
                  style={{
                    height: '40px',
                    padding: '0 16px',
                    borderRadius: '8px',
                    backgroundColor: '#161f30',
                    border: '1px solid #26334d',
                    color: '#f8fafc',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Thoát
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Concise Visual Pre-Game Briefing Overlay */}
        {!isJourneyStarted && (
          <div
            data-testid="scene-pregame-briefing"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 25,
              backgroundColor: 'rgba(9, 13, 22, 0.88)',
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
                maxWidth: '520px',
                backgroundColor: '#111726',
                border: '1px solid #222d42',
                borderRadius: '12px',
                padding: '22px 20px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '11.5px',
                  color: accentHex,
                  fontWeight: 800,
                  marginBottom: '6px',
                }}
              >
                {effectiveConfig.industryLabel} · {sceneDescriptor.sceneBadge} · {totalStages} CHẶNG
              </div>
              <h2
                style={{
                  margin: '0 0 14px 0',
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#f8fafc',
                }}
              >
                {game.title || effectiveConfig.environmentTitle}
              </h2>

              {/* 3 Concise Visual Control Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  marginBottom: '18px',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    backgroundColor: '#0b0f19',
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: accentHex }}>
                    1. DI CHUYỂN
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: '4px', lineHeight: 1.35 }}>
                    Phím WASD / Mũi tên hoặc chạm trực tiếp lên màn chơi 2D
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0b0f19',
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#38bdf8' }}>
                    2. TƯƠNG TÁC
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: '4px', lineHeight: 1.35 }}>
                    Né vật cản, thu thập vật phẩm (+10Đ) &amp; chạm mục tiêu (Space)
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#0b0f19',
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    padding: '10px',
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#3fc07a' }}>
                    3. VƯỢT CHỐT
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#cbd5e1', marginTop: '4px', lineHeight: 1.35 }}>
                    Trả lời nhanh câu hỏi tại chốt (phím 1-4) để mở khóa chặng
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (mode === 'LIVE_SESSION' && onStartSession) {
                    onStartSession();
                  } else {
                    setPreviewStarted(true);
                  }
                }}
                disabled={startingSession}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: accentHex,
                  color: '#090d16',
                  fontSize: '15px',
                  fontWeight: 800,
                  cursor: startingSession ? 'not-allowed' : 'pointer',
                  opacity: startingSession ? 0.6 : 1,
                }}
              >
                {startingSession ? 'Đang khởi tạo màn chơi...' : 'Bắt đầu trải nghiệm'}
              </button>
            </div>
          </div>
        )}

        {/* Bottom control bar removed per visual polish spec; touch & keyboard controls remain active on the game canvas */}

        {/* ================= CHECKPOINT QUESTION MODAL (ROAD RUNNER) ================= */}
        {activeModalOpen && activeQuestion && !isJourneyFinished && (
          <div
            data-testid="runner-checkpoint-modal"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              backgroundColor: 'rgba(9, 13, 22, 0.84)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '610px',
                backgroundColor: '#111726',
                border: `1.5px solid ${accentHex}`,
                borderRadius: '12px',
                padding: '18px 20px',
                color: '#f8fafc',
                margin: 'auto',
              }}
            >
              {/* Modal Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  paddingBottom: '12px',
                  borderBottom: '1px solid #1e293b',
                }}
              >
                <div>
                  <div style={{ fontSize: '11.5px', color: accentHex, fontWeight: 800 }}>
                    CHỐT SÁT HẠCH #{activeStageIndex + 1}/{totalStages} ·{' '}
                    {currentStageMeta?.zoneLabel || effectiveConfig.subEnvironment}
                  </div>
                  <h2
                    style={{
                      margin: '2px 0 0 0',
                      fontSize: '16.5px',
                      fontWeight: 700,
                      color: '#f8fafc',
                    }}
                  >
                    {currentStageMeta?.checkpointTitle || `Câu hỏi chặng ${activeStageIndex + 1}`}
                  </h2>
                </div>

                <div
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    backgroundColor: activeTimeRemaining <= 5 ? '#2c1a20' : '#161f30',
                    border: `1px solid ${activeTimeRemaining <= 5 ? '#5c2632' : '#26334d'}`,
                    color: activeTimeRemaining <= 5 ? '#e5566f' : '#f8fafc',
                    fontSize: '13.5px',
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {activeTimeRemaining}s
                </div>
              </div>

              {/* Question Prompt */}
              <div style={{ marginTop: '14px' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#f8fafc',
                    lineHeight: 1.45,
                  }}
                >
                  {activeQuestion.question}
                </p>

                {Array.isArray(activeQuestion.choices) && activeQuestion.choices.length > 0 ? (
                  <div
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
                              Boolean(activeFeedback) || submittingAnswer
                                ? 'default'
                                : 'pointer',
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
                              fontVariantNumeric: 'tabular-nums',
                              flexShrink: 0,
                            }}
                          >
                            {cIdx + 1}
                          </span>
                          <span style={{ flex: 1, lineHeight: 1.38 }}>{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: '14px',
                      display: 'flex',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input
                      type="text"
                      value={textAnswer}
                      disabled={Boolean(activeFeedback) || submittingAnswer}
                      onChange={e => setTextAnswer(e.target.value)}
                      placeholder="Nhập câu trả lời của bạn..."
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
                      ? gameplayProfile.continueLabel
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
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Tổng điểm</div>
                  <div
                    data-testid="victory-total-score"
                    style={{
                      fontSize: '25px',
                      fontWeight: 700,
                      color: accentHex,
                      marginTop: '4px',
                    }}
                  >
                    {(mode === 'LIVE_SESSION'
                      ? (liveFinalResult?.totalScore ?? liveScore)
                      : previewScore) + skillBonusScore}
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
                      ? liveFinalResult?.correctAnswers || 0
                      : previewCorrectCount}
                    /{totalStages}
                  </div>
                </div>

                <div style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {sceneDescriptor.clearedMetricLabel}
                  </div>
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
