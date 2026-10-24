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
  timeRemaining: liveTimeRemaining = 20,
  liveScore = 0,
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

  const totalStages = Math.max(
    1,
    liveTotalQuestions || game.questions?.length || effectiveConfig.stages.length || 1
  );

  // Preview mode internal state — starts immediately without multi-step briefing friction
  const [previewStarted, setPreviewStarted] = useState<boolean>(true);
  const [previewStageIdx, setPreviewStageIdx] = useState<number>(0);
  const [previewFeedback, setPreviewFeedback] = useState<PracticeQuestionResult | null>(null);
  const [previewFinished, setPreviewFinished] = useState<boolean>(false);
  const [previewScore, setPreviewScore] = useState<number>(0);
  const [previewCorrectCount, setPreviewCorrectCount] = useState<number>(0);
  const [previewStreak, setPreviewStreak] = useState<number>(0);
  const [previewMaxStreak, setPreviewMaxStreak] = useState<number>(0);
  const [previewTimeRemaining, setPreviewTimeRemaining] = useState<number>(
    game.settings?.timePerQuestion || 20
  );

  // Shared gameplay state — autoCruise is enabled by default so vehicle runs automatically
  const [activeModalOpen, setActiveModalOpen] = useState<boolean>(false);
  const [selectedChoice, setSelectedChoice] = useState<string>('');
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [autoCruise, setAutoCruise] = useState<boolean>(true);
  const [skillBonusScore, setSkillBonusScore] = useState<number>(0);
  const [obstaclesClearedCount, setObstaclesClearedCount] = useState<number>(0);
  const [obstaclesHitCount, setObstaclesHitCount] = useState<number>(0);
  const [energyPercent, setEnergyPercent] = useState<number>(100);
  const [nearCheckpointIndex, setNearCheckpointIndex] = useState<number | null>(null);
  const [reachedFinishGate, setReachedFinishGate] = useState<boolean>(false);
  const [playerProgressPercent, setPlayerProgressPercent] = useState<number>(0);
  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(true);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(false);

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

  const activeTimeRemaining =
    mode === 'LIVE_SESSION' ? liveTimeRemaining : previewTimeRemaining;

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

  // Build world obstacles and non-collidable decor
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
        : ['TRAFFIC_CONE', 'OIL_BARREL', 'BARRIER_GATE'];

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
    playerY: 0, // offset above ground (<= 0)
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
    particles: [] as FloatingParticle[],
    unlockedStageCount: 0,
  });

  // Sync obstacles when config changes
  useEffect(() => {
    physicsRef.current.obstacles = initialWorldObstacles.map(o => ({ ...o }));
  }, [initialWorldObstacles]);

  // Keep unlockedStageCount in sync with activeStageIndex & activeFeedback
  useEffect(() => {
    const unlocked = activeFeedback ? activeStageIndex + 1 : activeStageIndex;
    physicsRef.current.unlockedStageCount = unlocked;
  }, [activeStageIndex, activeFeedback]);

  // Reset question input when stage changes
  useEffect(() => {
    setSelectedChoice('');
    setTextAnswer('');
  }, [activeStageIndex, activeQuestion?.id]);

  // Preview countdown timer when checkpoint question modal is open
  useEffect(() => {
    if (mode !== 'CREATOR_PREVIEW') return;
    if (!activeModalOpen || previewFeedback || previewFinished) return;

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
  }, [mode, activeModalOpen, previewFeedback, previewFinished]);

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
    if (p.isGrounded && !activeModalOpen) {
      p.vy = JUMP_VELOCITY;
      p.isGrounded = false;
      playClickSound();
      // Auto-collapse how-to-play banner shortly after first jump so view stays clean
      setTimeout(() => setShowHowToPlay(false), 1200);
    }
  }, [activeModalOpen]);

  const handleOpenCheckpointModal = useCallback(() => {
    if (!activeQuestion) return;
    setActiveModalOpen(true);
    physicsRef.current.keys.left = false;
    physicsRef.current.keys.right = false;
  }, [activeQuestion]);

  // Handle Answer Submission (both Live Session and Creator Preview)
  const handleAnswerSubmit = useCallback(
    (explicitAnswer?: string) => {
      if (!activeQuestion || activeFeedback || submittingAnswer) return;
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
      const normalizedUser = rawAns.trim().toLowerCase();
      const normalizedCorrect = (fullQ.correctAnswer || '').trim().toLowerCase();
      const altMatches = (fullQ.acceptedAlternatives || []).some(
        alt => alt.trim().toLowerCase() === normalizedUser
      );
      const isCorrect = normalizedUser === normalizedCorrect || altMatches;
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
    setAutoCruise(true);
    const isLastStage = activeStageIndex + 1 >= totalStages;

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
  }, [activeStageIndex, totalStages, mode, onNextQuestion, game.settings?.timePerQuestion]);

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

  // Keyboard Listeners (Space / Up / W jump, 1-4 answer shortcuts, Enter continue, Left/Right optional)
  useEffect(() => {
    if (!isJourneyStarted || isJourneyFinished) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Enter' && activeModalOpen && !activeFeedback) {
          e.preventDefault();
          handleAnswerSubmit();
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
    activeModalOpen,
    activeFeedback,
    activeQuestion,
    nearCheckpointIndex,
    triggerJump,
    handleOpenCheckpointModal,
    handleAnswerSubmit,
    handleContinueJourney,
  ]);

  // Main 60fps Canvas Physics & Rendering Loop
  useEffect(() => {
    if (!isJourneyStarted || isJourneyFinished) return;
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

        // Bike chassis
        c.fillStyle = accentColor;
        c.beginPath();
        c.moveTo(-26, -20);
        c.lineTo(-6, -38);
        c.lineTo(22, -36);
        c.lineTo(32, -20);
        c.closePath();
        c.fill();

        // Headlight beam inside canvas world
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

        // Rider torso & helmet
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
                ? '#312E81'
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
        c.font = 'bold 10px sans-serif';
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
        c.font = 'bold 10px sans-serif';
        c.textAlign = 'center';
        c.fillText('NHẢY', obs.width / 2, -obs.height - 8);
      }
      c.restore();
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
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

      // 1. Auto-run forward by default unless paused by checkpoint modal
      const moveRightActive = p.keys.right || (autoCruise && !activeModalOpen);
      const moveLeftActive = p.keys.left && !activeModalOpen;

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

      // Stop smoothly at locked checkpoint
      if (p.playerX >= blockingCheckpointX - 18) {
        p.playerX = blockingCheckpointX - 18;
        p.vx = 0;
      }

      if (Math.abs(p.vx) > 5 && p.isGrounded) {
        p.wheelAngle += (p.vx * dt) / 16;
      }

      // 2. Vertical jump physics
      if (!p.isGrounded || p.vy < 0) {
        p.playerY += p.vy * dt;
        p.vy += GRAVITY * dt;
        if (p.playerY >= 0) {
          p.playerY = 0;
          p.vy = 0;
          p.isGrounded = true;
        }
      }

      // 3. AABB Collision Detection with Obstacles
      const playerLeft = p.playerX - 20;
      const playerRight = p.playerX + 20;
      const playerBottom = p.playerY;
      const playerTop = p.playerY - 58;

      for (const obs of p.obstacles) {
        const obsLeft = obs.x;
        const obsRight = obs.x + obs.width;
        const obsTop = -obs.height;

        if (!obs.cleared && !obs.hit && playerLeft > obsRight) {
          obs.cleared = true;
          setSkillBonusScore(prev => prev + 15);
          setObstaclesClearedCount(prev => prev + 1);
          spawnFloatingText(obs.x, -obs.height - 25, '+15 VƯỢT CẢN', '#38BDF8');
        }

        const horizontalOverlap = playerRight > obsLeft + 4 && playerLeft < obsRight - 4;
        const verticalOverlap = playerBottom > obsTop + 6 && playerTop < 0;

        if (horizontalOverlap && verticalOverlap && now > p.invulnerableUntil) {
          obs.hit = true;
          p.invulnerableUntil = now + 900;
          p.playerX = Math.max(40, obsLeft - 28);
          p.vy = -260;
          p.isGrounded = false;
          setObstaclesHitCount(prev => prev + 1);
          setEnergyPercent(prev => Math.max(10, prev - 10));
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

      // 4. Proximity to active Checkpoint -> pause vehicle & open question modal
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

      // 5. Camera Follow
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

      // Parallax Layer 1 (Far Silhouette Buildings)
      const farParallax = effectiveConfig.reducedMotion ? 0 : p.cameraX * 0.2;
      ctx.fillStyle = `${palette.buildingPrimary}AA`;
      const farCount = Math.ceil(width / 220) + 4;
      for (let i = -1; i < farCount; i++) {
        const bx =
          ((i * 220 - (farParallax % 220)) + width + 220) % (width + 440) - 220;
        const bh = 120 + ((Math.abs(i) * 43) % 130);
        ctx.fillRect(bx, groundY - bh, 160, bh);
      }

      // Parallax Layer 2 (Midground Industry Structures)
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
        ctx.font = 'bold 10px sans-serif';
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
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          isUnlocked ? `CHẶNG ${idx + 1} ĐÃ QUA` : `CHẶNG ${idx + 1}`,
          0,
          -150
        );
        ctx.fillStyle = '#94A3B8';
        ctx.font = '10px sans-serif';
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
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ĐÍCH ĐẾN HÀNH TRÌNH', 0, -150);
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
          ctx.font = 'bold 13px sans-serif';
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

      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    isJourneyStarted,
    isJourneyFinished,
    effectiveConfig,
    checkpointPositions,
    finishGateX,
    worldDecorList,
    autoCruise,
    activeModalOpen,
    activeFeedback,
    canvasSize.width,
    canvasSize.height,
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
    setReachedFinishGate(false);
    setActiveModalOpen(false);
    setAutoCruise(true);
    if (mode === 'LIVE_SESSION' && onRestartSession) {
      onRestartSession();
    }
  };

  const currentStageMeta =
    effectiveConfig.stages[activeStageIndex] || effectiveConfig.stages[0];
  const currentQuizScore = mode === 'LIVE_SESSION' ? liveScore : previewScore;
  const totalDisplayScore = currentQuizScore + skillBonusScore;
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
        fontFamily: 'var(--font-sans, "Plus Jakarta Sans", system-ui, sans-serif)',
      }}
    >
      {/* ================= INTEGRATED TOP HUD BAR ================= */}
      <header
        style={{
          minHeight: '56px',
          padding: '8px 16px',
          backgroundColor: '#0b0f19',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          flexShrink: 0,
          zIndex: 30,
        }}
      >
        {/* Left: Game Title & Industry Context */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: '#161f30',
              border: '1px solid #26334d',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {effectiveConfig.industryLabel}
          </span>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 700,
                color: '#f8fafc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '280px',
              }}
            >
              {game.title || effectiveConfig.environmentTitle}
            </h1>
          </div>
        </div>

        {/* Center: Divided KPI Strip (Chặng | Điểm | Vượt qua) — Taste Skill §5 */}
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
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
              borderRight: '1px solid #222d42',
            }}
          >
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Chặng</span>
            <strong style={{ fontSize: '15px', color: '#f8fafc', fontWeight: 700 }}>
              {Math.min(totalStages, activeStageIndex + 1)}/{totalStages}
            </strong>
          </div>

          <div
            style={{
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
              borderRight: '1px solid #222d42',
            }}
          >
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Điểm</span>
            <strong style={{ fontSize: '15px', color: accentHex, fontWeight: 700 }}>
              {totalDisplayScore}
            </strong>
          </div>

          <div
            style={{
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Vượt qua</span>
            <strong style={{ fontSize: '15px', color: '#3fc07a', fontWeight: 700 }}>
              {obstaclesClearedCount}
            </strong>
          </div>
        </div>

        {/* Right: How-To-Play Toggle, Fullscreen & Exit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setShowHowToPlay(prev => !prev)}
            style={{
              height: '34px',
              padding: '0 12px',
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
              height: '34px',
              padding: '0 12px',
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
              height: '34px',
              padding: '0 14px',
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
            width: `${playerProgressPercent}%`,
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
          // Allow tapping directly on the canvas world to jump on mobile/tablet
          if (
            (e.target as HTMLElement)?.tagName === 'CANVAS' &&
            isJourneyStarted &&
            !isJourneyFinished &&
            !activeModalOpen
          ) {
            e.preventDefault();
            triggerJump();
          }
        }}
      >
        <canvas
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

        {/* Compact Integrated How-To-Play Banner (Auto-collapses after jumping) */}
        {showHowToPlay && isJourneyStarted && !isJourneyFinished && !activeModalOpen && (
          <div
            style={{
              position: 'absolute',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 15,
              backgroundColor: '#0b0f19',
              border: '1px solid #26334d',
              borderRadius: '8px',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              maxWidth: 'calc(100vw - 32px)',
            }}
          >
            <span style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 500 }}>
              <strong>Cách chơi:</strong> Xe tự chạy về phía trước. Nhấn phím{' '}
              <kbd
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                Space
              </kbd>{' '}
              hoặc chạm nút <strong>NHẢY</strong> để né vật cản.
            </span>
            <button
              type="button"
              onClick={() => setShowHowToPlay(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
            >
              Ẩn
            </button>
          </div>
        )}

        {/* Loading / Session Initialization Overlay (for LIVE_SESSION if still connecting) */}
        {!isJourneyStarted && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 25,
              backgroundColor: '#090d16',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '480px',
                backgroundColor: '#111726',
                border: '1px solid #222d42',
                borderRadius: '12px',
                padding: '28px 24px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  color: '#94a3b8',
                  fontWeight: 600,
                  marginBottom: '6px',
                }}
              >
                {effectiveConfig.industryLabel} · {effectiveConfig.subEnvironment}
              </div>
              <h2
                style={{
                  margin: '0 0 10px 0',
                  fontSize: '22px',
                  fontWeight: 700,
                  color: '#f8fafc',
                }}
              >
                {game.title || effectiveConfig.environmentTitle}
              </h2>
              <p
                style={{
                  margin: '0 0 20px 0',
                  fontSize: '14px',
                  color: '#b4b4b4',
                  lineHeight: 1.5,
                }}
              >
                Xe tự động chạy qua {totalStages} chặng câu hỏi. Nhấn Space hoặc chạm nút NHẢY để né vật cản trên đường.
              </p>
              <button
                type="button"
                onClick={onStartSession}
                disabled={startingSession}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: accentHex,
                  color: '#090d16',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: startingSession ? 'not-allowed' : 'pointer',
                  opacity: startingSession ? 0.6 : 1,
                }}
              >
                {startingSession ? 'Đang chuẩn bị đường chạy...' : 'Bắt đầu chơi'}
              </button>
            </div>
          </div>
        )}

        {/* ================= ONE-BUTTON JUMP CONTROL (BOTTOM RIGHT) ================= */}
        {isJourneyStarted && !isJourneyFinished && !activeModalOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '24px',
              right: '24px',
              left: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            {/* Left subtle auto-run indicator / manual pause toggle */}
            <button
              type="button"
              onClick={() => setAutoCruise(prev => !prev)}
              style={{
                pointerEvents: 'auto',
                height: '40px',
                padding: '0 14px',
                borderRadius: '8px',
                backgroundColor: '#0b0f19',
                border: '1px solid #26334d',
                color: autoCruise ? '#3fc07a' : '#94a3b8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {autoCruise ? 'Xe tự chạy: BẬT' : 'Xe tự chạy: TẠM DỪNG'}
            </button>

            {/* Right Primary Jump Action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', pointerEvents: 'auto' }}>
              {nearCheckpointIndex !== null && (
                <button
                  type="button"
                  onClick={handleOpenCheckpointModal}
                  style={{
                    height: '56px',
                    padding: '0 20px',
                    borderRadius: '10px',
                    backgroundColor: '#3fc07a',
                    border: 'none',
                    color: '#04250e',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Mở câu hỏi chặng {nearCheckpointIndex + 1}
                </button>
              )}

              <button
                type="button"
                onPointerDown={e => {
                  e.preventDefault();
                  triggerJump();
                }}
                aria-label="Nhảy qua chướng ngại vật (Phím Space)"
                style={{
                  minWidth: '156px',
                  height: '56px',
                  padding: '0 24px',
                  borderRadius: '10px',
                  backgroundColor: accentHex,
                  border: 'none',
                  color: '#090d16',
                  fontSize: '16px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  touchAction: 'none',
                  userSelect: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span>NHẢY</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(9, 13, 22, 0.18)',
                    color: '#090d16',
                  }}
                >
                  Space
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ================= CHECKPOINT QUESTION MODAL ================= */}
        {activeModalOpen && activeQuestion && !isJourneyFinished && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              backgroundColor: 'rgba(9, 13, 22, 0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '640px',
                backgroundColor: '#111726',
                border: '1px solid #26334d',
                borderRadius: '12px',
                padding: '24px',
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
                  gap: '12px',
                  paddingBottom: '14px',
                  borderBottom: '1px solid #1e293b',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
                    Chặng {activeStageIndex + 1} / {totalStages} ·{' '}
                    {currentStageMeta?.zoneLabel || effectiveConfig.subEnvironment}
                  </div>
                  <h2
                    style={{
                      margin: '2px 0 0 0',
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#f8fafc',
                    }}
                  >
                    {currentStageMeta?.checkpointTitle || `Câu hỏi chặng ${activeStageIndex + 1}`}
                  </h2>
                </div>

                <div
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: activeTimeRemaining <= 5 ? '#2c1a20' : '#161f30',
                    border: `1px solid ${activeTimeRemaining <= 5 ? '#5c2632' : '#26334d'}`,
                    color: activeTimeRemaining <= 5 ? '#e5566f' : '#f8fafc',
                    fontSize: '14px',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {activeTimeRemaining}s
                </div>
              </div>

              {/* Question Prompt */}
              <div style={{ marginTop: '18px' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#f8fafc',
                    lineHeight: 1.5,
                  }}
                >
                  {activeQuestion.question}
                </p>

                {/* Choices */}
                {Array.isArray(activeQuestion.choices) && activeQuestion.choices.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: '10px',
                      marginTop: '16px',
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
                            padding: '14px 16px',
                            borderRadius: '8px',
                            backgroundColor: bg,
                            border: `1px solid ${border}`,
                            color: textColor,
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor:
                              Boolean(activeFeedback) || submittingAnswer
                                ? 'default'
                                : 'pointer',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px',
                            minHeight: '48px',
                          }}
                        >
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: '4px',
                              backgroundColor: '#0b0f19',
                              color: '#94a3b8',
                              fontSize: '12px',
                              fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              flexShrink: 0,
                            }}
                          >
                            {cIdx + 1}
                          </span>
                          <span style={{ flex: 1, lineHeight: 1.4 }}>{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: '16px',
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
                        height: '44px',
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
                          height: '44px',
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
                    marginTop: '18px',
                    padding: '14px 16px',
                    borderRadius: '8px',
                    backgroundColor: activeFeedback.isCorrect ? '#172a1d' : '#2c1a20',
                    border: `1px solid ${activeFeedback.isCorrect ? '#3fc07a' : '#e5566f'}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: activeFeedback.isCorrect ? '#3fc07a' : '#e5566f',
                      marginBottom: activeFeedback.explanation ? '6px' : '12px',
                    }}
                  >
                    {activeFeedback.isCorrect
                      ? `Chính xác (+${activeFeedback.pointsEarned} điểm) — Rào chắn chặng ${activeStageIndex + 1} đã mở.`
                      : `Chưa chính xác — Đáp án đúng: ${activeFeedback.correctAnswer}`}
                  </div>
                  {activeFeedback.explanation && (
                    <p
                      style={{
                        margin: '0 0 12px 0',
                        fontSize: '13px',
                        color: '#e2e8f0',
                        lineHeight: 1.5,
                      }}
                    >
                      {activeFeedback.explanation}
                    </p>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handleContinueJourney}
                      style={{
                        height: '40px',
                        padding: '0 18px',
                        borderRadius: '6px',
                        backgroundColor: '#f8fafc',
                        border: 'none',
                        color: '#090d16',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {activeStageIndex + 1 < totalStages
                        ? 'Tiếp tục chạy sang chặng kế tiếp (Space)'
                        : 'Tiến về đích (Space)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= VICTORY / FINISH OVERLAY ================= */}
        {isJourneyFinished && (
          <div
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
                maxWidth: '580px',
                backgroundColor: '#111726',
                border: '1px solid #26334d',
                borderRadius: '12px',
                padding: '28px 24px',
                color: '#f8fafc',
              }}
            >
              <div style={{ fontSize: '12px', color: '#3fc07a', fontWeight: 600 }}>
                Hoàn thành hành trình · {effectiveConfig.industryLabel}
              </div>
              <h2
                style={{
                  margin: '4px 0 18px 0',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#f8fafc',
                }}
              >
                {game.title || effectiveConfig.environmentTitle}
              </h2>

              {/* Divided KPI Summary Strip (Taste Skill §5) */}
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
                    style={{
                      fontSize: '26px',
                      fontWeight: 700,
                      color: accentHex,
                      marginTop: '4px',
                    }}
                  >
                    {(mode === 'LIVE_SESSION' ? liveFinalResult?.totalScore || 0 : previewScore) +
                      skillBonusScore}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', borderRight: '1px solid #222d42' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Trạm trả lời đúng</div>
                  <div
                    style={{
                      fontSize: '26px',
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
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Vật cản vượt qua</div>
                  <div
                    style={{
                      fontSize: '26px',
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
