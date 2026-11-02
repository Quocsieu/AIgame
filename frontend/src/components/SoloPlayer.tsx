import React, { useEffect, useRef, useState } from 'react';
import { useToast } from './ToastContext.js';
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  RefreshIcon,
  StarIcon,
  TrophyIcon,
  XMarkIcon,
} from './Icons.js';
import {
  activatePracticeCheckpoint,
  advancePracticeSession,
  createPracticeSession,
  fetchGameById,
  fetchGameParticipantsApi,
  fetchPracticeResult,
  fetchPracticeSessionQuestion,
  fetchPracticeSessionSummary,
  recordPracticeTimeout,
  saveEditedQuestions,
  startPracticeSession,
  submitPracticeAnswer,
} from '../services/api.js';
import { soundManager } from '../services/audio.js';
import { AdventureGameEngine } from './AdventureGameEngine.js';
import type {
  GameQuestion,
  GameSpecification,
  ParticipantRosterItem,
  PracticeFinalResult,
  PracticeQuestionResult,
  SanitizedQuestion,
} from '../types/index.js';
import {
  calculateFrontendMaxPossibleScore,
  evaluateFrontendPerformance,
} from '../types/index.js';

interface SoloPlayerProps {
  gameId?: string;
  initialSpec?: GameSpecification | null;
  onLeave: () => void;
  playtestMode?: boolean;
  onSpecUpdated?: (spec: GameSpecification) => void;
}

function normalizePlaytestToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stripPlaytestOptionPrefix(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizePlaytestCrosswordAscii(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizePlaytestTrueFalsePolarity(value: string): 'TRUE' | 'FALSE' | null {
  const clean = stripPlaytestOptionPrefix(value);
  if (['đúng', 'dung', 'true', 'yes', 'có', 'co', 'chính xác', 'chinh xac', '1'].includes(clean)) {
    return 'TRUE';
  }
  if (['sai', 'false', 'no', 'không', 'khong', 'không đúng', 'khong dung', '0'].includes(clean)) {
    return 'FALSE';
  }
  return null;
}

function shufflePlaytestPuzzleChoices(choices: string[], seedStr: string): string[] {
  const arr = [...choices];
  if (arr.length <= 1) return arr;
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  const matchesOriginal = arr.every((item, idx) => item === choices[idx]);
  if (matchesOriginal && arr.length > 1) {
    const tmp = arr[0];
    arr[0] = arr[1];
    arr[1] = tmp;
  }
  return arr;
}

function buildPlaytestClientQuestion(
  spec: GameSpecification,
  index: number
): SanitizedQuestion {
  const q = spec.questions[index];
  const effectiveType = q.type || spec.gameType;
  const timePerQ =
    (typeof q.timeLimitSeconds === 'number' && q.timeLimitSeconds >= 5
      ? q.timeLimitSeconds
      : spec.settings?.timePerQuestion) || 20;
  const crosswordWordLength =
    effectiveType === 'CROSSWORD'
      ? (q.crosswordAnswer || q.correctAnswer || '').replace(/\s+/g, '').length
      : undefined;
  const clientChoices =
    effectiveType === 'PUZZLE' && Array.isArray(q.choices)
      ? shufflePlaytestPuzzleChoices(q.choices, `${q.id}_${index}`)
      : Array.isArray(q.choices)
        ? [...q.choices]
        : undefined;

  return {
    id: q.id || `q_${index + 1}`,
    question: q.question,
    type: effectiveType as SanitizedQuestion['type'],
    choices: clientChoices,
    sliderConfig: q.sliderConfig ? { ...q.sliderConfig } : undefined,
    difficulty: q.difficulty || 'MEDIUM',
    crosswordClue: q.crosswordClue,
    crosswordWordLength,
    questionIndex: index,
    totalQuestions: spec.questions.length,
    timePerQuestion: timePerQ,
    remainingTimeSeconds: timePerQ,
  };
}

function evaluatePlaytestAnswer(
  q: GameSpecification['questions'][number],
  fallbackType: string,
  submittedAnswer: string
): boolean {
  const effectiveType = q.type || fallbackType;
  const trimmed = submittedAnswer.trim();
  if (!trimmed) return false;

  if (effectiveType === 'SLIDER' && q.sliderConfig) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return false;
    if (num < q.sliderConfig.min - 1e-9 || num > q.sliderConfig.max + 1e-9) {
      return false;
    }
    const margin = Math.max(0, q.sliderConfig.tolerance ?? 0);
    return Math.abs(num - q.sliderConfig.correctValue) <= margin + 1e-9;
  }

  if (effectiveType === 'PUZZLE') {
    const submittedOrder = trimmed
      .split('|')
      .map(normalizePlaytestToken)
      .filter(Boolean);
    const expectedRaw =
      q.correctAnswer && q.correctAnswer.includes('|')
        ? q.correctAnswer.split('|')
        : Array.isArray(q.choices)
          ? q.choices
          : [q.correctAnswer];
    const expectedOrder = expectedRaw.map(normalizePlaytestToken).filter(Boolean);
    if (submittedOrder.length !== expectedOrder.length || expectedOrder.length === 0) {
      return false;
    }
    return submittedOrder.every((item, idx) => item === expectedOrder[idx]);
  }

  if (effectiveType === 'CROSSWORD') {
    const rawTarget = q.crosswordAnswer || q.correctAnswer || '';
    const acceptedWords = rawTarget
      .split(/[|;]/)
      .map((part) => normalizePlaytestCrosswordAscii(part))
      .filter(Boolean);
    const actualNorm = normalizePlaytestCrosswordAscii(trimmed);
    if (actualNorm.length === 0) return false;
    if (acceptedWords.includes(actualNorm)) return true;
    const expectedRaw = rawTarget.trim().toLowerCase().replace(/\s+/g, '');
    const actualRaw = trimmed.toLowerCase().replace(/\s+/g, '');
    return Boolean(expectedRaw) && actualRaw === expectedRaw;
  }

  if (effectiveType === 'QUICK_BUTTON' || effectiveType === 'TRUE_FALSE') {
    const normSub = normalizePlaytestToken(trimmed);
    const strippedSub = stripPlaytestOptionPrefix(trimmed);
    const normCorrect = normalizePlaytestToken(q.correctAnswer);
    const strippedCorrect = stripPlaytestOptionPrefix(q.correctAnswer);
    if (normSub === normCorrect || (strippedSub && strippedSub === strippedCorrect)) {
      return true;
    }
    const subPol = normalizePlaytestTrueFalsePolarity(trimmed);
    const corrPol = normalizePlaytestTrueFalsePolarity(q.correctAnswer);
    if (subPol && corrPol) {
      return subPol === corrPol;
    }
  }

  if (effectiveType === 'MULTIPLE_CHOICE' || effectiveType === 'QUIZ') {
    const normSub = normalizePlaytestToken(trimmed);
    const strippedSub = stripPlaytestOptionPrefix(trimmed);
    const normCorrect = normalizePlaytestToken(q.correctAnswer);
    const strippedCorrect = stripPlaytestOptionPrefix(q.correctAnswer);
    if (normSub === normCorrect || (strippedSub && strippedSub === strippedCorrect)) {
      return true;
    }
    if (Array.isArray(q.choices) && q.choices.length > 0) {
      const upperKey = q.correctAnswer.trim().toUpperCase();
      const letterIdx = ['A', 'B', 'C', 'D'].indexOf(upperKey);
      if (letterIdx >= 0 && letterIdx < q.choices.length) {
        const targetChoice = q.choices[letterIdx];
        if (
          normalizePlaytestToken(targetChoice) === normSub ||
          stripPlaytestOptionPrefix(targetChoice) === strippedSub
        ) {
          return true;
        }
      }
    }
  }

  const normalizedSubmitted = normalizePlaytestToken(trimmed);
  const strippedSubmitted = stripPlaytestOptionPrefix(trimmed);
  const rawCandidates = [
    ...(q.correctAnswer ? q.correctAnswer.split(/[|;]/) : []),
    q.correctAnswer,
    ...(q.acceptedAlternatives || []),
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const candidates = rawCandidates.map(normalizePlaytestToken);
  const strippedCandidates = rawCandidates.map(stripPlaytestOptionPrefix);

  return (
    candidates.includes(normalizedSubmitted) ||
    (Boolean(strippedSubmitted) && strippedCandidates.includes(strippedSubmitted))
  );
}

function calculatePlaytestPoints(
  isCorrect: boolean,
  scoringMode: string | undefined,
  responseTimeMs: number,
  timeLimitMs: number,
  newStreak: number
): number {
  if (!isCorrect) return 0;
  const BASE_POINTS = 100;
  const MAX_SPEED_BONUS = 50;
  const STREAK_STEP_BONUS = 20;
  const MAX_STREAK_BONUS = 100;

  const safeLimit = Math.max(1, timeLimitMs);
  const clampedResponse = Math.min(Math.max(0, responseTimeMs), safeLimit);
  const remainingRatio = (safeLimit - clampedResponse) / safeLimit;
  const speedBonus = Math.round(remainingRatio * MAX_SPEED_BONUS);
  const streakSteps = Math.max(0, newStreak - 1);
  const streakBonus = Math.min(streakSteps * STREAK_STEP_BONUS, MAX_STREAK_BONUS);

  if (scoringMode === 'SPEED_BONUS') {
    return BASE_POINTS + speedBonus;
  }
  if (scoringMode === 'STREAK') {
    return BASE_POINTS + speedBonus + streakBonus;
  }
  return BASE_POINTS;
}

export const SoloPlayer: React.FC<SoloPlayerProps> = ({
  gameId,
  initialSpec,
  onLeave,
  playtestMode = false,
  onSpecUpdated,
}) => {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadedSpec, setLoadedSpec] = useState<GameSpecification | null>(initialSpec || null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<SanitizedQuestion | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [textAnswerInput, setTextAnswerInput] = useState('');
  const [puzzleOrder, setPuzzleOrder] = useState<string[]>([]);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [sliderTouched, setSliderTouched] = useState<boolean>(false);

  // Audio state
  const [audioMuted, setAudioMuted] = useState<boolean>(() => soundManager.isMuted());
  const [audioVolume, setAudioVolume] = useState<number>(() => soundManager.getVolume());

  // Roster Gate state (for Solo live sessions when game has PRECONFIGURED / HYBRID roster)
  const [rosterGateOpen, setRosterGateOpen] = useState<boolean>(false);
  const [rosterItems, setRosterItems] = useState<ParticipantRosterItem[]>([]);
  const [rosterSearch, setRosterSearch] = useState<string>('');
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [confirmingIdentity, setConfirmingIdentity] = useState<boolean>(false);
  const [hybridFreeTextMode, setHybridFreeTextMode] = useState<boolean>(false);
  const [freeTextPlayerName, setFreeTextPlayerName] = useState<string>('');
  const [freeTextDepartment, setFreeTextDepartment] = useState<string>('');
  const confirmedIdentityRef = useRef<{
    participantId?: string;
    playerName?: string;
    departmentUnit?: string;
    lockToken?: string;
  } | null>(null);

  // Playtest Inline Question Editor state
  const [inlineEditOpen, setInlineEditOpen] = useState<boolean>(false);
  const [inlineEditIndex, setInlineEditIndex] = useState<number>(0);
  const [savingInlineEdit, setSavingInlineEdit] = useState<boolean>(false);
  const [editDraft, setEditDraft] = useState<{
    question: string;
    choices: string[];
    correctAnswer: string;
    explanation: string;
    timeLimitSeconds: number;
    crosswordClue?: string;
    crosswordAnswer?: string;
  }>({
    question: '',
    choices: ['', '', '', ''],
    correctAnswer: '',
    explanation: '',
    timeLimitSeconds: 20,
  });

  useEffect(() => {
    if (currentQuestion?.type === 'SLIDER' && currentQuestion.sliderConfig) {
      const { min, max, step } = currentQuestion.sliderConfig;
      const safeStep = step > 0 ? step : 1;
      const rawMid = min + Math.round(((max - min) / 2) / safeStep) * safeStep;
      const clampedMid = Math.max(min, Math.min(max, Number(rawMid.toFixed(6))));
      setSliderValue(clampedMid);
      setSliderTouched(false);
    }
  }, [currentQuestion?.id, currentQuestion?.type]);

  useEffect(() => {
    if (currentQuestion?.type === 'PUZZLE' && Array.isArray(currentQuestion.choices)) {
      setPuzzleOrder([...currentQuestion.choices]);
    } else {
      setPuzzleOrder([]);
    }
  }, [currentQuestion?.id, currentQuestion?.type]);

  const handleMovePuzzleItem = (idx: number, direction: -1 | 1) => {
    setPuzzleOrder(prev => {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = tmp;
      return next;
    });
  };
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [questionFeedback, setQuestionFeedback] = useState<PracticeQuestionResult | null>(null);
  const [isQuestionTimedOut, setIsQuestionTimedOut] = useState(false);
  const [finalResult, setFinalResult] = useState<PracticeFinalResult | null>(null);

  const [playerScore, setPlayerScore] = useState(0);
  const [playerStreak, setPlayerStreak] = useState(0);
  const [playerCorrectCount, setPlayerCorrectCount] = useState(0);
  const [playerWrongCount, setPlayerWrongCount] = useState(0);
  const submittingLockRef = useRef(false);
  const advancingLockRef = useRef(false);
  const answeredQuestionIdsRef = useRef<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(20);

  const timerRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const playtestQuestionIndexRef = useRef<number>(0);
  const playtestQuestionStartedAtRef = useRef<number>(Date.now());
  const playtestStartedAtRef = useRef<number>(Date.now());
  const playtestMaxStreakRef = useRef<number>(0);
  const adventureCheckpointOpenRef = useRef<boolean>(false);

  const clearAutoAdvanceTimer = () => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  };

  const handleToggleAudioMute = () => {
    const nextMuted = soundManager.toggleMute();
    setAudioMuted(nextMuted);
    if (!nextMuted && !finalResult) {
      const spec = loadedSpec || initialSpec;
      soundManager.startSessionAudio(spec?.settings?.audioConfig);
    }
  };

  const handleAudioVolumeChange = (volPercent: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(volPercent)));
    soundManager.setVolume(clamped);
    setAudioVolume(clamped);
    if (audioMuted && clamped > 0) {
      soundManager.setMuted(false);
      setAudioMuted(false);
    }
  };

  const handleLeave = () => {
    stopTimer();
    clearAutoAdvanceTimer();
    soundManager.stopAll();
    const targetGameId = gameId || initialSpec?.gameId;
    if (targetGameId && !playtestMode) {
      sessionStorage.removeItem(`active_solo_session_${targetGameId}`);
    }
    onLeave();
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startCountdown = (durationSec: number) => {
    stopTimer();
    soundManager.resetCountdownTracker();
    const safeSec = Math.max(0, Math.ceil(durationSec));
    setTimeLeft(safeSec);
    if (safeSec <= 0) {
      setIsQuestionTimedOut(true);
      return;
    }
    setIsQuestionTimedOut(false);

    timerRef.current = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopTimer();
          setIsQuestionTimedOut(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Trigger countdown tick sound when timeLeft reaches last N seconds
  useEffect(() => {
    if (!currentQuestion || questionFeedback || isQuestionTimedOut || inlineEditOpen) return;
    const spec = loadedSpec || initialSpec;
    if (spec?.gameType === 'ADVENTURE' && !adventureCheckpointOpenRef.current) return;
    soundManager.checkCountdownTick(timeLeft, spec?.settings?.audioConfig);
  }, [timeLeft, currentQuestion?.id, questionFeedback, isQuestionTimedOut, inlineEditOpen, loadedSpec, initialSpec]);

  const initializeSession = async (forceStart?: boolean | unknown) => {
    const isExplicitStart = forceStart === true || forceStart === 'RESTART';
    const isForceRestart = forceStart === 'RESTART';
    setIsLoading(true);
    setErrorMessage(null);
    setFinalResult(null);
    setQuestionFeedback(null);
    setIsQuestionTimedOut(false);
    setSelectedChoice(null);
    setTextAnswerInput('');
    setPlayerScore(0);
    setPlayerStreak(0);
    setPlayerCorrectCount(0);
    setPlayerWrongCount(0);
    submittingLockRef.current = false;
    advancingLockRef.current = false;
    clearAutoAdvanceTimer();
    answeredQuestionIdsRef.current.clear();

    if (playtestMode) {
      stopTimer();
      const spec = loadedSpec || initialSpec;
      if (!spec || !Array.isArray(spec.questions) || spec.questions.length === 0) {
        setErrorMessage('Không tìm thấy câu hỏi để bắt đầu chế độ chơi thử.');
        setIsLoading(false);
        return;
      }
      setLoadedSpec(spec);
      soundManager.startSessionAudio(spec.settings?.audioConfig);
      if (spec.gameType === 'ADVENTURE' && !isExplicitStart) {
        setSessionId(null);
        setIsLoading(false);
        return;
      }
      playtestQuestionIndexRef.current = 0;
      playtestStartedAtRef.current = Date.now();
      playtestQuestionStartedAtRef.current = Date.now();
      playtestMaxStreakRef.current = 0;
      setSessionId('playtest-local-session');
      const firstQ = buildPlaytestClientQuestion(spec, 0);
      setCurrentQuestion(firstQ);
      if (spec.gameType === 'ADVENTURE') {
        setTimeLeft(firstQ.timePerQuestion || 20);
        setIsQuestionTimedOut(false);
      } else {
        startCountdown(firstQ.timePerQuestion || 20);
      }
      setIsLoading(false);
      return;
    }
    stopTimer();

    const targetGameId = gameId || initialSpec?.gameId;
    let resolvedSpec = loadedSpec || initialSpec || null;
    if (initialSpec && !loadedSpec) {
      setLoadedSpec(initialSpec);
    } else if (gameId && !resolvedSpec) {
      try {
        const fetched = await fetchGameById(gameId, { mode: 'public' }).catch(() =>
          fetchGameById(gameId)
        );
        resolvedSpec = fetched;
        setLoadedSpec(fetched);
      } catch {
        // Ignore if public play only allows session endpoints
      }
    }

    const sessionKey = targetGameId ? `active_solo_session_${targetGameId}` : null;
    const identityKey = targetGameId ? `solo_roster_identity_${targetGameId}` : null;
    if (isForceRestart && sessionKey) {
      sessionStorage.removeItem(sessionKey);
    }

    // Restore saved roster identity from sessionStorage if present
    if (!confirmedIdentityRef.current && identityKey) {
      try {
        const rawIdent = sessionStorage.getItem(identityKey);
        if (rawIdent) {
          confirmedIdentityRef.current = JSON.parse(rawIdent);
        }
      } catch {
        // Ignore corrupt storage
      }
    }

    const savedSessionId = sessionKey ? sessionStorage.getItem(sessionKey) : null;

    // Reload recovery: check if previous in-progress session exists BEFORE showing roster gate
    if (savedSessionId) {
      try {
        const summary = await fetchPracticeSessionSummary(savedSessionId);
        if (summary.state === 'FINISHED') {
          const res = await fetchPracticeResult(savedSessionId);
          setSessionId(savedSessionId);
          setFinalResult(res);
          setIsLoading(false);
          return;
        } else if (
          summary.state === 'IN_PROGRESS' ||
          summary.state === 'QUESTION_ACTIVE' ||
          summary.state === 'QUESTION_ANSWERED'
        ) {
          const q = await fetchPracticeSessionQuestion(savedSessionId);
          setSessionId(savedSessionId);
          setCurrentQuestion(q);
          setPlayerScore(summary.score || 0);
          setPlayerStreak(summary.currentStreak || 0);
          setPlayerCorrectCount((summary as any).correctCount || 0);
          setPlayerWrongCount((summary as any).wrongCount || 0);
          soundManager.startSessionAudio(resolvedSpec?.settings?.audioConfig);
          if (summary.state === 'QUESTION_ANSWERED') {
            const adv = await advancePracticeSession(savedSessionId);
            if (adv.finished && adv.result) {
              setSessionId(savedSessionId);
              setFinalResult(adv.result);
              if (sessionKey) sessionStorage.removeItem(sessionKey);
              setIsLoading(false);
              return;
            } else if (adv.question) {
              setSessionId(savedSessionId);
              setCurrentQuestion(adv.question);
              startCountdown(adv.question.timePerQuestion || 20);
              setIsLoading(false);
              return;
            }
          }
          const questionTime =
            typeof q.remainingTimeSeconds === 'number'
              ? q.remainingTimeSeconds
              : q.timePerQuestion || 20;
          startCountdown(questionTime);
          setIsLoading(false);
          return;
        }
      } catch {
        if (sessionKey) sessionStorage.removeItem(sessionKey);
      }
    }

    // Check if game requires Roster Gate (PRECONFIGURED or HYBRID) before creating session
    if (targetGameId && !confirmedIdentityRef.current) {
      try {
        const rosterRes = await fetchGameParticipantsApi(targetGameId, { mode: 'public' });
        const mode = rosterRes.rosterMode || resolvedSpec?.settings?.rosterMode || 'FREE_TEXT';
        if (
          (mode === 'PRECONFIGURED' || mode === 'HYBRID') &&
          Array.isArray(rosterRes.participants) &&
          rosterRes.participants.length > 0
        ) {
          setRosterItems(rosterRes.participants);
          setRosterGateOpen(true);
          setIsLoading(false);
          return;
        }
      } catch {
        // Proceed without roster gate if endpoint not applicable
      }
    }

    if (
      (initialSpec?.gameType === 'ADVENTURE' || resolvedSpec?.gameType === 'ADVENTURE') &&
      !isExplicitStart
    ) {
      if (sessionKey) sessionStorage.removeItem(sessionKey);
      setSessionId(null);
      setIsLoading(false);
      return;
    }

    try {
      let activeSessionId: string;
      const ident = confirmedIdentityRef.current;

      if (gameId) {
        const sessionRes = await createPracticeSession({
          gameId,
          publicPlay: true,
          participantId: ident?.participantId,
          playerName: ident?.playerName,
          departmentUnit: ident?.departmentUnit,
          lockToken: ident?.lockToken,
        });
        activeSessionId = sessionRes.sessionId;
        if (sessionRes.lockToken && ident) {
          ident.lockToken = sessionRes.lockToken;
          if (identityKey) sessionStorage.setItem(identityKey, JSON.stringify(ident));
        }
      } else if (initialSpec?.gameId) {
        const sessionRes = await createPracticeSession({
          gameId: initialSpec.gameId,
          gameSpecification: resolvedSpec || initialSpec,
          participantId: ident?.participantId,
          playerName: ident?.playerName,
          departmentUnit: ident?.departmentUnit,
          lockToken: ident?.lockToken,
        });
        activeSessionId = sessionRes.sessionId;
      } else {
        throw new Error('Không tìm thấy thông tin bộ câu hỏi để bắt đầu chơi.');
      }

      setSessionId(activeSessionId);
      if (sessionKey) {
        sessionStorage.setItem(sessionKey, activeSessionId);
      }
      soundManager.startSessionAudio(resolvedSpec?.settings?.audioConfig);
      const startRes = await startPracticeSession(activeSessionId);
      setCurrentQuestion(startRes.question);
      const questionTime =
        typeof startRes.question.remainingTimeSeconds === 'number'
          ? startRes.question.remainingTimeSeconds
          : startRes.question.timePerQuestion || 20;
      startCountdown(questionTime);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể khởi động phiên chơi solo.');
      toast.error(err.message || 'Lỗi khởi động trận đấu', 'Không thể bắt đầu');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initializeSession();
    return () => {
      stopTimer();
      clearAutoAdvanceTimer();
      soundManager.stopAll();
    };
  }, [gameId, initialSpec]);

  const handleAdventureCheckpointModalChange = React.useCallback(
    (isOpen: boolean) => {
      adventureCheckpointOpenRef.current = isOpen;
      const spec = loadedSpec || initialSpec;
      if (spec?.gameType !== 'ADVENTURE') return;
      if (isOpen) {
        if (!questionFeedback) {
          playtestQuestionStartedAtRef.current = Date.now();
          setIsQuestionTimedOut(false);
          if (!playtestMode && sessionId) {
            activatePracticeCheckpoint(sessionId)
              .then((res) => {
                const qTime =
                  res.question?.remainingTimeSeconds ??
                  res.question?.timePerQuestion ??
                  currentQuestion?.timePerQuestion ??
                  spec.settings?.timePerQuestion ??
                  20;
                startCountdown(qTime);
              })
              .catch(() => {
                const qTime =
                  currentQuestion?.timePerQuestion || spec.settings?.timePerQuestion || 20;
                startCountdown(qTime);
              });
          } else {
            const qTime =
              currentQuestion?.timePerQuestion || spec.settings?.timePerQuestion || 20;
            startCountdown(qTime);
          }
        }
      } else {
        stopTimer();
        soundManager.resetCountdownTracker();
      }
    },
    [loadedSpec, initialSpec, questionFeedback, currentQuestion?.timePerQuestion, playtestMode, sessionId]
  );

  // Ghi nhận tự động khi hết thời gian trả lời (cả Playtest lẫn Live Session) để chuyển sang feedback & tự động qua câu
  useEffect(() => {
    if (!isQuestionTimedOut || !currentQuestion || questionFeedback || inlineEditOpen) {
      return;
    }
    const spec = loadedSpec || initialSpec;
    if (playtestMode) {
      const rawQ =
        spec?.questions[currentQuestion.questionIndex] ||
        spec?.questions.find((item) => item.id === currentQuestion.id);
      if (!spec || !rawQ) return;
      const effectiveType = rawQ.type || spec.gameType;
      const displayCorrectAnswer =
        effectiveType === 'CROSSWORD'
          ? rawQ.crosswordAnswer || rawQ.correctAnswer
          : effectiveType === 'SLIDER' && rawQ.sliderConfig
            ? `${rawQ.sliderConfig.correctValue}${rawQ.sliderConfig.unit ? ` ${rawQ.sliderConfig.unit}` : ''}`
            : rawQ.correctAnswer;
      const timeoutRes: PracticeQuestionResult = {
        questionId: currentQuestion.id,
        answer: '',
        isCorrect: false,
        timedOut: true,
        pointsEarned: 0,
        responseTimeMs: (currentQuestion.timePerQuestion || spec.settings?.timePerQuestion || 20) * 1000,
        answeredAt: new Date().toISOString(),
        correctAnswer: displayCorrectAnswer,
        explanation:
          rawQ.explanation ||
          'Đã hết thời gian trả lời cho câu hỏi này (+0 điểm).',
        sourceReference: rawQ.sourceReference,
      };
      answeredQuestionIdsRef.current.add(currentQuestion.id);
      soundManager.playTimeout();
      setQuestionFeedback(timeoutRes);
      setIsQuestionTimedOut(false);
      setPlayerStreak(0);
      setPlayerWrongCount((prev) => prev + 1);
      return;
    }

    // Live session: call backend recordPracticeTimeout idempotently
    if (sessionId && !answeredQuestionIdsRef.current.has(currentQuestion.id)) {
      answeredQuestionIdsRef.current.add(currentQuestion.id);
      soundManager.playTimeout();
      recordPracticeTimeout(sessionId, currentQuestion.id)
        .then((res) => {
          setQuestionFeedback(res);
          setIsQuestionTimedOut(false);
          setPlayerStreak(0);
          setPlayerWrongCount((prev) => prev + 1);
        })
        .catch(() => {
          const fallbackTimeout: PracticeQuestionResult = {
            questionId: currentQuestion.id,
            answer: '',
            isCorrect: false,
            timedOut: true,
            pointsEarned: 0,
            responseTimeMs: (currentQuestion.timePerQuestion || 20) * 1000,
            answeredAt: new Date().toISOString(),
          };
          setQuestionFeedback(fallbackTimeout);
          setIsQuestionTimedOut(false);
          setPlayerStreak(0);
          setPlayerWrongCount((prev) => prev + 1);
        });
    }
  }, [playtestMode, loadedSpec, initialSpec, isQuestionTimedOut, currentQuestion, questionFeedback, inlineEditOpen, sessionId]);

  const handleSubmitAnswer = async (answerVal?: string) => {
    if (
      !sessionId ||
      !currentQuestion ||
      questionFeedback ||
      (!playtestMode && isQuestionTimedOut) ||
      isSubmitting ||
      submittingLockRef.current ||
      answeredQuestionIdsRef.current.has(currentQuestion.id)
    )
      return;

    const finalAnswer = (answerVal !== undefined ? answerVal : (selectedChoice || textAnswerInput)).trim();
    if (!finalAnswer) {
      toast.warning('Vui lòng chọn hoặc nhập đáp án trước khi gửi.', 'Chưa có đáp án');
      return;
    }

    submittingLockRef.current = true;
    setIsSubmitting(true);
    stopTimer();

    if (playtestMode) {
      try {
        const spec = loadedSpec || initialSpec;
        const rawQ =
          spec?.questions[currentQuestion.questionIndex] ||
          spec?.questions.find((item) => item.id === currentQuestion.id);
        if (!spec || !rawQ) {
          throw new Error('Không tìm thấy dữ liệu câu hỏi trong phiên chơi thử.');
        }
        const isCorrect = evaluatePlaytestAnswer(rawQ, spec.gameType, finalAnswer);
        const timeLimitMs =
          (currentQuestion.timePerQuestion || spec.settings?.timePerQuestion || 20) * 1000;
        const responseTimeMs = Math.max(
          0,
          Math.min(timeLimitMs, Date.now() - playtestQuestionStartedAtRef.current)
        );
        const nextStreak = isCorrect ? playerStreak + 1 : 0;
        if (nextStreak > playtestMaxStreakRef.current) {
          playtestMaxStreakRef.current = nextStreak;
        }
        const pointsEarned = calculatePlaytestPoints(
          isCorrect,
          spec.settings?.scoringMode,
          responseTimeMs,
          timeLimitMs,
          nextStreak
        );
        const nextScore = playerScore + pointsEarned;
        const effectiveType = rawQ.type || spec.gameType;
        const displayCorrectAnswer =
          effectiveType === 'CROSSWORD'
            ? rawQ.crosswordAnswer || rawQ.correctAnswer
            : effectiveType === 'SLIDER' && rawQ.sliderConfig
              ? `${rawQ.sliderConfig.correctValue}${rawQ.sliderConfig.unit ? ` ${rawQ.sliderConfig.unit}` : ''}`
              : rawQ.correctAnswer;

        const localRes: PracticeQuestionResult = {
          questionId: currentQuestion.id,
          answer: finalAnswer,
          isCorrect,
          pointsEarned,
          responseTimeMs,
          answeredAt: new Date().toISOString(),
          correctAnswer: displayCorrectAnswer,
          explanation: rawQ.explanation,
          sourceReference: rawQ.sourceReference,
        };

        answeredQuestionIdsRef.current.add(currentQuestion.id);
        if (isCorrect) soundManager.playCorrect();
        else soundManager.playWrong();
        setQuestionFeedback(localRes);
        setIsQuestionTimedOut(false);
        setPlayerScore(nextScore);
        setPlayerStreak(nextStreak);
        setPlayerCorrectCount((prev) => prev + (isCorrect ? 1 : 0));
        setPlayerWrongCount((prev) => prev + (isCorrect ? 0 : 1));
      } finally {
        submittingLockRef.current = false;
        setIsSubmitting(false);
      }
      return;
    }
    setIsSubmitting(true);
    stopTimer();

    try {
      const res = await submitPracticeAnswer(sessionId, {
        questionId: currentQuestion.id,
        answer: finalAnswer,
      });
      answeredQuestionIdsRef.current.add(currentQuestion.id);
      const spec = loadedSpec || initialSpec;
      const isExamUnpublished =
        spec?.settings?.sessionMode === 'EXAM' && !spec?.settings?.answersPublished;
      if (isExamUnpublished) {
        soundManager.playAnswerRecorded();
      } else if (res.isCorrect) {
        soundManager.playCorrect();
      } else {
        soundManager.playWrong();
      }
      setQuestionFeedback(res);
      setIsQuestionTimedOut(false);
      setPlayerScore((prev) => prev + res.pointsEarned);
      setPlayerStreak((prev) => (res.isCorrect ? prev + 1 : 0));
      setPlayerCorrectCount((prev) => prev + (res.isCorrect ? 1 : 0));
      setPlayerWrongCount((prev) => prev + (res.isCorrect ? 0 : 1));
    } catch (err: any) {
      if (err.message?.includes('abandoned') || err.message?.includes('đã bị kết thúc')) {
        toast.warning('Phiên luyện tập này đã được kết thúc bởi người tạo. Đang chuyển hướng...', 'Phiên đã đóng');
        setTimeout(() => handleLeave(), 1500);
      } else if (
        err.code === 'ANSWER_TIMEOUT' ||
        err.message?.includes('time limit expired') ||
        err.message?.includes('ANSWER_TIMEOUT')
      ) {
        setTimeLeft(0);
        setIsQuestionTimedOut(true);
        toast.warning('Đã hết thời gian trả lời cho câu hỏi này (+0 điểm).', 'Hết giờ');
      } else {
        toast.error(err.message || 'Không thể gửi câu trả lời.', 'Lỗi nộp bài');
      }
    } finally {
      submittingLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleNextQuestion = async () => {
    if (!sessionId || advancingLockRef.current) return;
    advancingLockRef.current = true;
    clearAutoAdvanceTimer();
    setIsLoading(true);
    const wasTimedOut = isQuestionTimedOut && !questionFeedback;
    setQuestionFeedback(null);
    setIsQuestionTimedOut(false);
    setSelectedChoice(null);
    setTextAnswerInput('');

    try {
      if (playtestMode) {
        const spec = loadedSpec || initialSpec;
        const nextWrongCount = wasTimedOut ? playerWrongCount + 1 : playerWrongCount;
        if (wasTimedOut) {
          setPlayerStreak(0);
          setPlayerWrongCount(nextWrongCount);
        }
        const nextIdx = playtestQuestionIndexRef.current + 1;
        if (!spec || nextIdx >= spec.questions.length) {
          const totalQ = spec?.questions.length || 1;
          const maxScore = calculateFrontendMaxPossibleScore(totalQ, spec?.settings?.scoringMode);
          const perfEval = evaluateFrontendPerformance({
            correctAnswers: playerCorrectCount,
            totalQuestions: totalQ,
            sessionMode: spec?.settings?.sessionMode,
            passThresholdPercent: spec?.settings?.passThresholdPercent,
          });
          const durationSeconds = Math.max(
            1,
            Math.round((Date.now() - playtestStartedAtRef.current) / 1000)
          );
          const localFinal: PracticeFinalResult = {
            sessionId: 'playtest-local-session',
            gameId: spec?.gameId || 'playtest-game',
            title: spec?.title || 'Chơi thử',
            gameType: spec?.gameType || 'MIXED',
            sessionMode: spec?.settings?.sessionMode || 'PLAY',
            totalScore: playerScore,
            score: playerScore,
            maxPossibleScore: maxScore,
            maxStreak: playtestMaxStreakRef.current,
            totalQuestions: totalQ,
            correctAnswers: playerCorrectCount,
            correctCount: playerCorrectCount,
            wrongCount: nextWrongCount,
            wrongAnswers: nextWrongCount,
            accuracy: perfEval.accuracyPercentage,
            performanceEvaluation: perfEval,
            durationMs: durationSeconds * 1000,
            finishedAt: new Date().toISOString(),
            questionResults: [],
          };
          soundManager.stopAll();
          soundManager.playVictory();
          setFinalResult(localFinal);
          setCurrentQuestion(null);
          stopTimer();
        } else {
          playtestQuestionIndexRef.current = nextIdx;
          playtestQuestionStartedAtRef.current = Date.now();
          const nextQ = buildPlaytestClientQuestion(spec, nextIdx);
          setCurrentQuestion(nextQ);
          if (spec.gameType === 'ADVENTURE') {
            stopTimer();
            setTimeLeft(nextQ.timePerQuestion || 20);
            setIsQuestionTimedOut(false);
          } else {
            startCountdown(nextQ.timePerQuestion || 20);
          }
        }
        return;
      }
      const advanceRes = await advancePracticeSession(sessionId);
      if (wasTimedOut) {
        setPlayerStreak(0);
        setPlayerWrongCount((prev) => prev + 1);
      }
      if (advanceRes.finished && advanceRes.result) {
        soundManager.stopAll();
        soundManager.playVictory();
        setFinalResult(advanceRes.result);
        setCurrentQuestion(null);
        stopTimer();
        const targetGameId = gameId || initialSpec?.gameId;
        if (targetGameId && !playtestMode) {
          sessionStorage.removeItem(`active_solo_session_${targetGameId}`);
        }
      } else if (advanceRes.question) {
        setCurrentQuestion(advanceRes.question);
        const qTime =
          typeof advanceRes.question.remainingTimeSeconds === 'number'
            ? advanceRes.question.remainingTimeSeconds
            : advanceRes.question.timePerQuestion || 20;
        startCountdown(qTime);
      }
    } catch (err: any) {
      if (err.message?.includes('abandoned') || err.message?.includes('đã bị kết thúc')) {
        toast.warning('Phiên luyện tập này đã được kết thúc bởi người tạo. Đang chuyển hướng...', 'Phiên đã đóng');
        setTimeout(() => handleLeave(), 1500);
      } else {
        toast.error(err.message || 'Không thể tải câu hỏi tiếp theo.', 'Lỗi chuyển câu');
      }
    } finally {
      advancingLockRef.current = false;
      setIsLoading(false);
    }
  };

  // Auto-advance after questionFeedback (3500ms in PLAY mode, 1500ms in EXAM mode) for non-Adventure modes
  useEffect(() => {
    clearAutoAdvanceTimer();
    const spec = loadedSpec || initialSpec;
    if (!questionFeedback || inlineEditOpen || finalResult || spec?.gameType === 'ADVENTURE') {
      return;
    }
    const isExamMode = spec?.settings?.sessionMode === 'EXAM';
    const delayMs =
      typeof spec?.settings?.autoAdvanceDelayMs === 'number' && spec.settings.autoAdvanceDelayMs >= 500
        ? spec.settings.autoAdvanceDelayMs
        : isExamMode
          ? 1500
          : 3500;
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      handleNextQuestion();
    }, delayMs);
    return () => {
      clearAutoAdvanceTimer();
    };
  }, [questionFeedback, inlineEditOpen, finalResult, loadedSpec, initialSpec]);

  // Open Inline Question Editor during Playtest
  const handleOpenInlineEditor = (targetIdx?: number) => {
    if (!playtestMode) return;
    const spec = loadedSpec || initialSpec;
    if (!spec || !Array.isArray(spec.questions)) return;
    const idx =
      typeof targetIdx === 'number'
        ? targetIdx
        : currentQuestion?.questionIndex ?? playtestQuestionIndexRef.current;
    const q = spec.questions[idx];
    if (!q) return;

    stopTimer();
    clearAutoAdvanceTimer();
    setInlineEditIndex(idx);
    setEditDraft({
      question: q.question || '',
      choices: Array.isArray(q.choices) && q.choices.length > 0 ? [...q.choices] : ['', '', '', ''],
      correctAnswer: q.correctAnswer || '',
      explanation: q.explanation || '',
      timeLimitSeconds:
        q.timeLimitSeconds || currentQuestion?.timePerQuestion || spec.settings?.timePerQuestion || 20,
      crosswordClue: q.crosswordClue,
      crosswordAnswer: q.crosswordAnswer,
    });
    setInlineEditOpen(true);
  };

  const handleCloseInlineEditor = () => {
    setInlineEditOpen(false);
    const spec = loadedSpec || initialSpec;
    if (!questionFeedback && currentQuestion && spec?.gameType !== 'ADVENTURE') {
      startCountdown(Math.max(1, timeLeft));
    }
  };

  const handleSaveInlineEditor = async () => {
    const spec = loadedSpec || initialSpec;
    if (!spec || !Array.isArray(spec.questions)) return;
    const trimmedQ = editDraft.question.trim();
    const trimmedAns = editDraft.correctAnswer.trim();
    if (!trimmedQ || !trimmedAns) {
      toast.warning('Nội dung câu hỏi và đáp án đúng không được để trống.', 'Thiếu thông tin');
      return;
    }

    setSavingInlineEdit(true);
    try {
      const updatedQuestions: GameQuestion[] = spec.questions.map((item, idx) => {
        if (idx !== inlineEditIndex) return item;
        const effectiveType = item.type || spec.gameType;
        const cleanedChoices = editDraft.choices.map((c) => c.trim()).filter(Boolean);
        return {
          ...item,
          question: trimmedQ,
          choices:
            effectiveType === 'MULTIPLE_CHOICE' ||
            effectiveType === 'QUIZ' ||
            effectiveType === 'QUICK_BUTTON' ||
            effectiveType === 'TRUE_FALSE' ||
            effectiveType === 'PUZZLE'
              ? cleanedChoices.length > 0
                ? cleanedChoices
                : item.choices
              : item.choices,
          correctAnswer: trimmedAns,
          explanation: editDraft.explanation.trim(),
          timeLimitSeconds: Math.max(5, Math.min(300, Number(editDraft.timeLimitSeconds) || 20)),
          crosswordClue: editDraft.crosswordClue ?? item.crosswordClue,
          crosswordAnswer:
            effectiveType === 'CROSSWORD'
              ? editDraft.crosswordAnswer?.trim() || trimmedAns
              : item.crosswordAnswer,
        };
      });

      let updatedSpec: GameSpecification = {
        ...spec,
        questions: updatedQuestions,
      };

      // Persist to backend on the SAME gameId if already saved in DB
      if (
        spec.gameId &&
        spec.gameId !== 'playtest-game' &&
        !spec.gameId.startsWith('temp_') &&
        !spec.gameId.startsWith('local_')
      ) {
        try {
          const persisted = await saveEditedQuestions(spec.gameId, updatedQuestions);
          updatedSpec = {
            ...persisted,
            questions: updatedQuestions,
          };
        } catch {
          // Keep local spec update if offline/unauthenticated
        }
      }

      setLoadedSpec(updatedSpec);
      onSpecUpdated?.(updatedSpec);

      if (currentQuestion && currentQuestion.questionIndex === inlineEditIndex) {
        const refreshedQ = buildPlaytestClientQuestion(updatedSpec, inlineEditIndex);
        setCurrentQuestion(refreshedQ);
        setTimeLeft(refreshedQ.timePerQuestion || 20);
        if (!questionFeedback && updatedSpec.gameType !== 'ADVENTURE') {
          startCountdown(refreshedQ.timePerQuestion || 20);
        }
      }

      setInlineEditOpen(false);
      toast.success(`Đã cập nhật Câu #${inlineEditIndex + 1} ngay trong phiên chơi thử.`, 'Đã lưu câu hỏi');
    } finally {
      setSavingInlineEdit(false);
    }
  };

  const activeGameSpec = loadedSpec || initialSpec;
  const isExamMode = activeGameSpec?.settings?.sessionMode === 'EXAM';
  const isExamUnpublished =
    isExamMode && !activeGameSpec?.settings?.answersPublished && !playtestMode;

  const inlineEditModalNode = inlineEditOpen ? (
    <div
      data-testid="playtest-inline-edit-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(9, 13, 22, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
          backgroundColor: 'var(--bg-surface)',
          border: '1.5px solid var(--primary)',
          borderRadius: '18px',
          padding: '1.5rem',
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-xl)',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 900,
                color: '#f59e0b',
                textTransform: 'uppercase',
              }}
            >
              Chỉnh sửa trực tiếp trong Chơi thử · Câu #{inlineEditIndex + 1}
            </span>
            <h3 style={{ margin: '0.2rem 0 0 0', fontSize: '1.15rem', fontWeight: 900 }}>
              Cập nhật nội dung câu hỏi (Đồng hồ đã tạm dừng)
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCloseInlineEditor}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XMarkIcon size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.35rem' }}>
              Nội dung câu hỏi:
            </label>
            <textarea
              data-testid="playtest-inline-question-input"
              rows={2}
              value={editDraft.question}
              onChange={(e) => setEditDraft((prev) => ({ ...prev, question: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                fontWeight: 700,
              }}
            />
          </div>

          {Array.isArray(activeGameSpec?.questions?.[inlineEditIndex]?.choices) &&
            (activeGameSpec?.questions?.[inlineEditIndex]?.choices?.length || 0) > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.35rem' }}>
                  Các lựa chọn:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {editDraft.choices.map((ch, cIdx) => (
                    <input
                      key={cIdx}
                      type="text"
                      data-testid={`playtest-inline-choice-${cIdx}`}
                      value={ch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditDraft((prev) => {
                          const next = [...prev.choices];
                          next[cIdx] = val;
                          return { ...prev, choices: next };
                        });
                      }}
                      placeholder={`Lựa chọn ${cIdx + 1}`}
                      style={{
                        padding: '0.55rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.35rem' }}>
                Đáp án đúng:
              </label>
              <input
                type="text"
                data-testid="playtest-inline-correct-input"
                value={editDraft.correctAnswer}
                onChange={(e) => setEditDraft((prev) => ({ ...prev, correctAnswer: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '10px',
                  border: '1.5px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.92rem',
                  fontWeight: 800,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.35rem' }}>
                Thời gian (giây):
              </label>
              <input
                type="number"
                min={5}
                max={300}
                data-testid="playtest-inline-time-input"
                value={editDraft.timeLimitSeconds}
                onChange={(e) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    timeLimitSeconds: Math.max(5, Math.min(300, Number(e.target.value) || 20)),
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '10px',
                  border: '1.5px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.92rem',
                  fontWeight: 800,
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, marginBottom: '0.35rem' }}>
              Giải thích đáp án:
            </label>
            <textarea
              data-testid="playtest-inline-explanation-input"
              rows={2}
              value={editDraft.explanation}
              onChange={(e) => setEditDraft((prev) => ({ ...prev, explanation: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={handleCloseInlineEditor}
              style={{
                minHeight: '42px',
                padding: '0.55rem 1.15rem',
                borderRadius: '10px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Hủy
            </button>
            <button
              type="button"
              data-testid="playtest-inline-save-btn"
              disabled={savingInlineEdit}
              onClick={handleSaveInlineEditor}
              style={{
                minHeight: '42px',
                padding: '0.55rem 1.35rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: 800,
                cursor: savingInlineEdit ? 'wait' : 'pointer',
              }}
            >
              {savingInlineEdit ? 'Đang lưu...' : 'Lưu câu hỏi & Tiếp tục chơi thử'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  // ROSTER GATE SCREEN (Solo Live Mode with PRECONFIGURED / HYBRID Roster)
  if (rosterGateOpen && !playtestMode) {
    const rosterMode = activeGameSpec?.settings?.rosterMode || 'PRECONFIGURED';
    const filteredRoster = rosterItems.filter((item) => {
      const q = rosterSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        item.fullName.toLowerCase().includes(q) ||
        (item.departmentUnit || '').toLowerCase().includes(q) ||
        (item.employeeCode || '').toLowerCase().includes(q)
      );
    });
    const selectedParticipant =
      rosterItems.find((p) => (p.id || p.participantId) === selectedParticipantId) || null;

    const handleConfirmRosterIdentity = () => {
      const targetGameId = gameId || initialSpec?.gameId;
      const identityKey = targetGameId ? `solo_roster_identity_${targetGameId}` : null;
      if (hybridFreeTextMode && rosterMode === 'HYBRID') {
        const cleanName = freeTextPlayerName.trim();
        if (!cleanName) {
          toast.warning('Vui lòng nhập họ tên của bạn trước khi bắt đầu.', 'Thiếu họ tên');
          return;
        }
        const ident = {
          playerName: cleanName,
          departmentUnit: freeTextDepartment.trim() || undefined,
        };
        confirmedIdentityRef.current = ident;
        if (identityKey) sessionStorage.setItem(identityKey, JSON.stringify(ident));
        setRosterGateOpen(false);
        initializeSession(true);
        return;
      }

      if (!selectedParticipant) {
        toast.warning('Vui lòng chọn đúng tên của bạn trong danh sách thí sinh.', 'Chưa chọn tên');
        return;
      }
      const ident = {
        participantId: selectedParticipant.id || selectedParticipant.participantId,
        playerName: selectedParticipant.fullName,
        departmentUnit: selectedParticipant.departmentUnit,
      };
      confirmedIdentityRef.current = ident;
      if (identityKey) sessionStorage.setItem(identityKey, JSON.stringify(ident));
      setConfirmingIdentity(false);
      setRosterGateOpen(false);
      initializeSession(true);
    };

    return (
      <div
        data-testid="solo-roster-gate"
        style={{
          maxWidth: '580px',
          margin: '2rem auto',
          padding: '2rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '20px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1.4rem', fontWeight: 900 }}>
          Xác Nhận Danh Tính Thí Sinh
        </h2>
        <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {activeGameSpec?.title || 'Bài thi / Kiểm tra'} — Vui lòng chọn đúng tên và đơn vị của bạn để ghi nhận kết quả chính thức.
        </p>

        {rosterMode === 'HYBRID' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={() => setHybridFreeTextMode(false)}
              style={{
                flex: 1,
                padding: '0.55rem',
                borderRadius: '10px',
                border: `1.5px solid ${!hybridFreeTextMode ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: !hybridFreeTextMode ? 'var(--primary-subtle)' : 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Chọn từ danh sách BTC
            </button>
            <button
              type="button"
              data-testid="roster-hybrid-freetext-toggle"
              onClick={() => setHybridFreeTextMode(true)}
              style={{
                flex: 1,
                padding: '0.55rem',
                borderRadius: '10px',
                border: `1.5px solid ${hybridFreeTextMode ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: hybridFreeTextMode ? 'var(--primary-subtle)' : 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Nhập tên ngoài danh sách
            </button>
          </div>
        )}

        {hybridFreeTextMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.25rem' }}>
            <input
              type="text"
              data-testid="roster-freetext-name-input"
              placeholder="Nhập họ và tên của bạn..."
              value={freeTextPlayerName}
              onChange={(e) => setFreeTextPlayerName(e.target.value)}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
              }}
            />
            <input
              type="text"
              data-testid="roster-freetext-unit-input"
              placeholder="Đơn vị / Phòng ban (tùy chọn)..."
              value={freeTextDepartment}
              onChange={(e) => setFreeTextDepartment(e.target.value)}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 600,
              }}
            />
            <button
              type="button"
              data-testid="confirm-participant-identity-btn"
              onClick={handleConfirmRosterIdentity}
              style={{
                minHeight: '46px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Xác nhận & Bắt đầu làm bài
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              data-testid="roster-search-input"
              placeholder="Tìm nhanh theo họ tên, mã nhân viên hoặc đơn vị..."
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.7rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                marginBottom: '0.85rem',
              }}
            />

            <div
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                marginBottom: '1.25rem',
              }}
            >
              {filteredRoster.map((p) => {
                const pid = p.id || p.participantId;
                const retakesGranted = p.retakesGranted ?? Math.max(0, (p.allowedAttempts ?? 1) - 1);
                const attemptsUsed = p.attemptsUsed ?? p.usedAttempts ?? 0;
                const canRetake = p.canStartAttempt ?? (retakesGranted > 0 && attemptsUsed <= retakesGranted);
                const isBlocked =
                  p.isLocked &&
                  !canRetake &&
                  (p.lockStatus === 'IN_PROGRESS' ||
                    (isExamMode && p.lockStatus === 'COMPLETED'));
                const isSelected = selectedParticipantId === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    data-testid={`roster-participant-option-${pid}`}
                    disabled={isBlocked}
                    onClick={() => {
                      setSelectedParticipantId(pid);
                      setConfirmingIdentity(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      borderRadius: '12px',
                      border: `1.5px solid ${
                        isSelected ? 'var(--primary)' : 'var(--border-subtle)'
                      }`,
                      backgroundColor: isSelected
                        ? 'var(--primary-subtle)'
                        : 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      textAlign: 'left',
                      cursor: isBlocked ? 'not-allowed' : 'pointer',
                      opacity: isBlocked ? 0.55 : 1,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{p.fullName}</div>
                      {p.departmentUnit && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Đơn vị: {p.departmentUnit}
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        backgroundColor: isBlocked
                          ? 'rgba(239, 68, 68, 0.15)'
                          : canRetake
                            ? 'rgba(56, 189, 248, 0.15)'
                            : 'rgba(16, 185, 129, 0.15)',
                        color: isBlocked ? '#ef4444' : canRetake ? '#0284c7' : '#10b981',
                      }}
                    >
                      {p.lockStatus === 'IN_PROGRESS'
                        ? 'Đang thi'
                        : canRetake
                          ? 'Được cấp thi lại'
                          : isBlocked
                            ? 'Đã hoàn thành'
                            : 'Sẵn sàng'}
                    </span>
                  </button>
                );
              })}
            </div>

            {confirmingIdentity && selectedParticipant && (
              <div
                data-testid="roster-confirm-card"
                style={{
                  padding: '1rem',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(99, 102, 241, 0.1)',
                  border: '1.5px solid var(--primary)',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '0.35rem' }}>
                  Xác nhận: Bạn là <strong>{selectedParticipant.fullName}</strong>
                  {selectedParticipant.departmentUnit
                    ? ` (${selectedParticipant.departmentUnit})`
                    : ''}
                  ?
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Sau khi xác nhận, tên này sẽ được khóa cho phiên làm bài của bạn để tránh trùng lặp.
                </div>
                <button
                  type="button"
                  data-testid="confirm-participant-identity-btn"
                  onClick={handleConfirmRosterIdentity}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Đây là tôi — Bắt đầu ngay
                </button>
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={handleLeave}
          style={{
            width: '100%',
            minHeight: '42px',
            borderRadius: '10px',
            border: '1px solid var(--border-strong)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Quay lại
        </button>
      </div>
    );
  }

  if (isLoading && !currentQuestion && !finalResult) {
    return (
      <div
        style={{
          minHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '4px solid var(--border-subtle)',
            borderTopColor: 'var(--primary)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Đang chuẩn bị đấu trường...</h3>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Tải câu hỏi và thiết lập phiên chơi an toàn.
        </p>
      </div>
    );
  }

  if (errorMessage && !currentQuestion && !finalResult) {
    return (
      <div
        style={{
          maxWidth: '540px',
          margin: '3rem auto',
          padding: '2.5rem 2rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '20px',
          textAlign: 'center',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            color: 'var(--accent-rose)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          <XMarkIcon size={28} />
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.35rem', fontWeight: 800 }}>
          Không Thể Bắt Đầu Trận Đấu
        </h2>
        <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
          {errorMessage}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={initializeSession}
            style={{
              minHeight: '44px',
              padding: '0.65rem 1.25rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <RefreshIcon size={16} />
            <span>Thử lại</span>
          </button>
          <button
            type="button"
            onClick={handleLeave}
            style={{
              minHeight: '44px',
              padding: '0.65rem 1.25rem',
              borderRadius: '10px',
              border: '1.5px solid var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  const playtestBanner = playtestMode ? (
    <div
      data-testid="playtest-mode-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.65rem 1.15rem',
        marginBottom: '1rem',
        borderRadius: '14px',
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        border: '1.5px solid rgba(245, 158, 11, 0.38)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
            backgroundColor: '#f59e0b',
            color: '#0f172a',
            fontSize: '0.72rem',
            fontWeight: 900,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          CHẾ ĐỘ CHƠI THỬ
        </span>
        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
          Trải nghiệm kiểm thử — Không ghi điểm, lịch sử hay thống kê thật
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {currentQuestion && (
          <button
            type="button"
            data-testid="playtest-inline-edit-btn"
            onClick={() => handleOpenInlineEditor(currentQuestion.questionIndex)}
            style={{
              minHeight: '36px',
              padding: '0.35rem 0.85rem',
              borderRadius: '10px',
              border: '1.5px solid var(--primary)',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              fontSize: '0.82rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ✎ Chỉnh sửa câu này
          </button>
        )}
        <button
          type="button"
          data-testid="exit-playtest-btn"
          onClick={handleLeave}
          style={{
            minHeight: '36px',
            padding: '0.35rem 0.9rem',
            borderRadius: '10px',
            border: '1.5px solid rgba(245, 158, 11, 0.5)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: '0.82rem',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          <XMarkIcon size={15} />
          <span>Thoát chơi thử</span>
        </button>
      </div>
    </div>
  ) : null;

  if (activeGameSpec && activeGameSpec.gameType === 'ADVENTURE') {
    return (
      <div className="w-full h-full">
        {inlineEditModalNode}
        <AdventureGameEngine
          key={activeGameSpec.gameId}
          game={activeGameSpec}
          adventureConfig={activeGameSpec.settings?.adventureConfig}
          mode="LIVE_SESSION"
          sessionStarted={Boolean(sessionId)}
          startingSession={isLoading}
          onStartSession={() => initializeSession(true)}
          currentQuestion={currentQuestion}
          currentQuestionIndex={currentQuestion ? currentQuestion.questionIndex : 0}
          totalQuestions={
            currentQuestion?.totalQuestions || activeGameSpec.questions?.length || 5
          }
          timeRemaining={timeLeft}
          liveScore={playerScore}
          liveCorrectCount={playerCorrectCount}
          liveWrongCount={playerWrongCount}
          questionFeedback={questionFeedback}
          submittingAnswer={isSubmitting}
          onSubmitAnswer={handleSubmitAnswer}
          onNextQuestion={handleNextQuestion}
          finalResult={finalResult}
          onRestartSession={() => initializeSession('RESTART')}
          onExit={handleLeave}
          isPlaytest={playtestMode}
          onCheckpointModalChange={handleAdventureCheckpointModalChange}
          onEditCheckpointQuestion={(stageIdx) => handleOpenInlineEditor(stageIdx)}
          audioMuted={audioMuted}
          onToggleAudioMute={handleToggleAudioMute}
        />
      </div>
    );
  }

  // FINISH SCREEN
  if (finalResult) {
    const totalPts = finalResult.totalScore ?? finalResult.score ?? 0;
    const correctCount = finalResult.correctAnswers ?? finalResult.correctCount ?? 0;
    const maxScore =
      finalResult.maxPossibleScore ||
      calculateFrontendMaxPossibleScore(
        finalResult.totalQuestions,
        activeGameSpec?.settings?.scoringMode
      );
    const perfEval =
      finalResult.performanceEvaluation ||
      evaluateFrontendPerformance({
        correctAnswers: correctCount,
        totalQuestions: finalResult.totalQuestions,
        sessionMode: finalResult.sessionMode || activeGameSpec?.settings?.sessionMode,
        passThresholdPercent: activeGameSpec?.settings?.passThresholdPercent,
      });

    return (
      <div
        data-testid="solo-finish-screen"
        style={{
          maxWidth: '580px',
          margin: '2rem auto',
          padding: '2.5rem 2rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '24px',
          textAlign: 'center',
          boxShadow: 'var(--shadow-xl)',
          animation: 'popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          style={{
            width: '68px',
            height: '68px',
            borderRadius: '20px',
            backgroundColor: 'var(--accent-amber)',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          <TrophyIcon size={34} />
        </div>

        {perfEval.isPassed !== null && (
          <div style={{ marginBottom: '0.65rem' }}>
            <span
              data-testid="exam-pass-status-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.3rem 0.9rem',
                borderRadius: '999px',
                fontSize: '0.82rem',
                fontWeight: 900,
                backgroundColor: perfEval.isPassed
                  ? 'rgba(16, 185, 129, 0.16)'
                  : 'rgba(239, 68, 68, 0.16)',
                border: `1.5px solid ${
                  perfEval.isPassed ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                }`,
                color: perfEval.isPassed ? 'var(--accent-emerald)' : 'var(--accent-rose)',
              }}
            >
              {perfEval.isPassed ? '✓ ĐẠT YÊU CẦU' : '✕ CHƯA ĐẠT'} (Ngưỡng {perfEval.passThresholdPercent}%)
            </span>
          </div>
        )}

        <h2 style={{ margin: '0 0 0.35rem 0', fontSize: '1.75rem', fontWeight: 900 }}>
          {playtestMode
            ? 'Hoàn Thành Chơi Thử!'
            : isExamMode
              ? 'Hoàn Thành Bài Thi!'
              : 'Hoàn Thành Trận Đấu!'}
        </h2>
        <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          {activeGameSpec?.title || finalResult.title}
        </p>

        {playtestBanner}

        {/* Unified 4-Tier Evaluation Card */}
        <div
          data-testid="solo-result-evaluation"
          style={{
            padding: '1rem 1.25rem',
            borderRadius: '16px',
            backgroundColor: 'var(--bg-input)',
            border: '1.5px solid var(--primary)',
            marginBottom: '1.5rem',
            textAlign: 'left',
          }}
        >
          <div
            data-testid="result-tier-label"
            style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--primary)' }}
          >
            Mức đánh giá: {perfEval.tierLabel} ({perfEval.accuracyPercentage}%)
          </div>
          <div
            style={{
              fontSize: '0.88rem',
              color: 'var(--text-secondary)',
              marginTop: '0.35rem',
              lineHeight: 1.45,
            }}
          >
            {perfEval.comment}
          </div>
        </div>

        {/* Score cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.85rem',
            marginBottom: '2rem',
          }}
        >
          <div
            style={{
              padding: '1.25rem 1rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem' }}>
              ĐIỂM ĐẠT / TỐI ĐA
            </div>
            <div
              data-testid="solo-result-score-ratio"
              style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--primary)' }}
            >
              {totalPts.toLocaleString()} / {maxScore.toLocaleString()}
            </div>
          </div>

          <div
            style={{
              padding: '1.25rem 1rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem' }}>
              SỐ CÂU ĐÚNG
            </div>
            <div
              data-testid="solo-result-correct-ratio"
              style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-emerald)' }}
            >
              {correctCount} / {finalResult.totalQuestions}
            </div>
          </div>

          <div
            style={{
              padding: '1.25rem 1rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem' }}>
              TỶ LỆ ĐÚNG
            </div>
            <div
              data-testid="solo-result-accuracy"
              style={{ fontSize: '1.45rem', fontWeight: 900, color: '#f59e0b' }}
            >
              {perfEval.accuracyPercentage}%
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {(!isExamMode || playtestMode) && (
            <button
              type="button"
              onClick={() => initializeSession('RESTART')}
              style={{
                minHeight: '48px',
                padding: '0.75rem 1.5rem',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink)',
                fontWeight: 800,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 0 16px var(--primary-subtle)',
              }}
            >
              <RefreshIcon size={18} />
              <span>Chơi Lại Trận Này</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleLeave}
            style={{
              minHeight: '48px',
              padding: '0.75rem 1.5rem',
              borderRadius: '12px',
              border: '1.5px solid var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            {playtestMode ? 'Thoát chơi thử' : 'Rời Khỏi'}
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE QUESTION SCREEN
  if (!currentQuestion) return null;

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '1rem 1rem 3rem' }}>
      {inlineEditModalNode}
      {/* Top Bar: Question Index, Score, Streak, Audio, Timer, Leave */}
      {playtestBanner}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          padding: '0.85rem 1.25rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: '0.95rem',
              color: 'var(--primary)',
              backgroundColor: 'rgba(99, 102, 241, 0.12)',
              padding: '0.3rem 0.75rem',
              borderRadius: '8px',
            }}
          >
            Câu {currentQuestion.questionIndex + 1} / {currentQuestion.totalQuestions}
          </span>

          {isExamMode && (
            <span
              data-testid="solo-exam-mode-badge"
              style={{
                fontWeight: 900,
                fontSize: '0.75rem',
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                padding: '0.22rem 0.55rem',
                borderRadius: '999px',
              }}
            >
              CHẾ ĐỘ THI
            </span>
          )}

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.92rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
            }}
          >
            <StarIcon size={16} style={{ color: '#f59e0b' }} />
            <span>{playerScore.toLocaleString()} đ</span>
          </div>

          {playerStreak > 1 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.82rem',
                fontWeight: 800,
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                padding: '0.2rem 0.55rem',
                borderRadius: '8px',
              }}
            >
              <FlameIcon size={14} />
              <span>x{playerStreak} streak</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Audio Mute & Volume Controls */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.25rem 0.6rem',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              data-testid="audio-mute-toggle-btn"
              onClick={handleToggleAudioMute}
              title={audioMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
              style={{
                border: 'none',
                background: 'transparent',
                color: audioMuted ? 'var(--text-muted)' : 'var(--primary)',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: 'pointer',
                padding: '0.15rem 0.25rem',
              }}
            >
              {audioMuted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              data-testid="audio-volume-slider"
              min={0}
              max={100}
              step={5}
              value={
                audioMuted
                  ? 0
                  : Math.round(
                      audioVolume > 0 && audioVolume <= 1 ? audioVolume * 100 : audioVolume
                    )
              }
              onChange={(e) => handleAudioVolumeChange(Number(e.target.value))}
              aria-label="Âm lượng"
              style={{
                width: '64px',
                height: '6px',
                accentColor: 'var(--primary)',
                cursor: 'pointer',
              }}
            />
          </div>

          {/* Timer Badge */}
          <div
            data-testid="solo-question-timer-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.85rem',
              borderRadius: '999px',
              backgroundColor: timeLeft <= 5 ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-input)',
              color: timeLeft <= 5 ? 'var(--accent-rose)' : 'var(--text-primary)',
              border: `1.5px solid ${timeLeft <= 5 ? 'var(--accent-rose)' : 'var(--border-strong)'}`,
              fontWeight: 900,
              fontSize: '1rem',
            }}
          >
            <ClockIcon size={16} />
            <span>{timeLeft}s</span>
          </div>

          {/* Leave Button */}
          <button
            type="button"
            onClick={handleLeave}
            title="Thoát trận đấu"
            style={{
              minHeight: '40px',
              padding: '0.4rem 0.75rem',
              borderRadius: '10px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontSize: '0.85rem',
              fontWeight: 700,
            }}
          >
            <XMarkIcon size={16} />
            <span>{playtestMode ? 'Thoát chơi thử' : 'Thoát'}</span>
          </button>
        </div>
      </div>

      {/* Question Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '24px',
          padding: '2.5rem 2rem',
          boxShadow: 'var(--card-shadow)',
          marginBottom: '1.5rem',
          textAlign: 'center',
        }}
      >
        <h2
          data-testid="solo-active-question-text"
          style={{
            fontSize: 'clamp(1.25rem, 3vw, 1.85rem)',
            fontWeight: 800,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            margin: '0 auto 1.5rem auto',
            maxWidth: '720px',
          }}
        >
          {currentQuestion.question}
        </h2>

        {/* FEEDBACK STATE: Reveal Answer and Explanation (or Redacted in EXAM Mode) */}
        {questionFeedback ? (
          <div
            data-testid="solo-question-feedback"
            style={{
              padding: '1.75rem',
              borderRadius: '18px',
              backgroundColor: isExamUnpublished
                ? 'rgba(56, 189, 248, 0.1)'
                : questionFeedback.isCorrect
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(239, 68, 68, 0.12)',
              border: `2px solid ${
                isExamUnpublished
                  ? '#38bdf8'
                  : questionFeedback.isCorrect
                    ? 'var(--accent-emerald)'
                    : 'var(--accent-rose)'
              }`,
              marginBottom: '1.5rem',
              animation: 'popIn 0.2s ease',
            }}
          >
            {isExamUnpublished ? (
              <div data-testid="exam-feedback-recorded">
                <div
                  style={{
                    fontSize: '1.3rem',
                    fontWeight: 900,
                    color: '#0284c7',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {questionFeedback.timedOut ? (
                    <>
                      <ClockIcon size={24} />
                      <span>Hết thời gian trả lời — Đã ghi nhận tự động (+0 điểm)</span>
                    </>
                  ) : (
                    <>
                      <CheckIcon size={24} />
                      <span>Đã ghi nhận câu trả lời của bạn</span>
                    </>
                  )}
                </div>
                <p
                  style={{
                    margin: '0.35rem auto 0 auto',
                    fontSize: '0.88rem',
                    color: 'var(--text-secondary)',
                    maxWidth: '540px',
                  }}
                >
                  Chế độ Thi nghiêm túc: Đáp án và giải thích được bảo mật cho đến khi kết thúc kỳ thi. Hệ thống tự động chuyển câu sau 1.5 giây...
                </p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontSize: '1.4rem',
                    fontWeight: 900,
                    color: questionFeedback.isCorrect
                      ? 'var(--accent-emerald)'
                      : 'var(--accent-rose)',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {questionFeedback.isCorrect ? (
                    <>
                      <CheckIcon size={26} />
                      <span>Chính Xác! +{questionFeedback.pointsEarned} điểm</span>
                    </>
                  ) : questionFeedback.timedOut ? (
                    <>
                      <ClockIcon size={26} />
                      <span>Hết Thời Gian Trả Lời! (+0 điểm)</span>
                    </>
                  ) : (
                    <>
                      <XMarkIcon size={26} />
                      <span>Chưa Đúng!</span>
                    </>
                  )}
                </div>

                {questionFeedback.correctAnswer && (
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 700 }}>
                    Đáp án chính xác: <strong>{questionFeedback.correctAnswer}</strong>
                  </p>
                )}

                {questionFeedback.explanation && (
                  <p
                    style={{
                      margin: '0.5rem auto 0 auto',
                      fontSize: '0.88rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                      maxWidth: '600px',
                    }}
                  >
                    {questionFeedback.explanation}
                  </p>
                )}
              </>
            )}

            <button
              type="button"
              data-testid="solo-next-question-btn"
              onClick={handleNextQuestion}
              style={{
                marginTop: '1.25rem',
                minHeight: '46px',
                padding: '0.75rem 1.75rem',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink)',
                fontWeight: 800,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 0 16px var(--primary-subtle)',
              }}
            >
              <span>
                {currentQuestion.questionIndex + 1 < currentQuestion.totalQuestions
                  ? 'Tiếp Tục Câu Kế Tiếp'
                  : 'Tiếp Tục — Xem Kết Quả'}
              </span>
              <ArrowRightIcon size={16} />
            </button>
          </div>
        ) : isQuestionTimedOut ? (
          <div
            data-testid="solo-timeout-banner"
            style={{
              padding: '1.75rem',
              borderRadius: '18px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '2px solid var(--accent-rose)',
              marginBottom: '1.5rem',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div
              style={{
                fontSize: '1.4rem',
                fontWeight: 900,
                color: 'var(--accent-rose)',
                marginBottom: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <ClockIcon size={26} />
              <span>Hết Thời Gian Trả Lời! (+0 điểm)</span>
            </div>
            <p
              style={{
                margin: '0.35rem auto 0 auto',
                fontSize: '0.92rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                maxWidth: '560px',
              }}
            >
              Thời gian cho câu hỏi này đã kết thúc trước khi hệ thống nhận được đáp án của bạn.
            </p>
            <button
              type="button"
              onClick={handleNextQuestion}
              style={{
                marginTop: '1.25rem',
                minHeight: '46px',
                padding: '0.75rem 1.75rem',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink)',
                fontWeight: 800,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 0 16px var(--primary-subtle)',
              }}
            >
              <span>
                {currentQuestion.questionIndex + 1 < currentQuestion.totalQuestions
                  ? 'Tiếp Tục Câu Kế Tiếp'
                  : 'Tiếp Tục — Xem Kết Quả'}
              </span>
              <ArrowRightIcon size={16} />
            </button>
          </div>
        ) : (
          /* ACTIVE ANSWER INPUT / OPTIONS */
          <div>
            {/* MULTIPLE CHOICE / CHOICES */}
            {(currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'QUIZ') && currentQuestion.choices && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '1rem',
                }}
              >
                {currentQuestion.choices.map((opt: string, idx: number) => {
                  const configs = [
                    { bg: 'var(--k-red)', dark: 'var(--k-red-dark)', icon: '▲', label: 'A', text: '#ffffff' },
                    { bg: 'var(--k-blue)', dark: 'var(--k-blue-dark)', icon: '◆', label: 'B', text: '#ffffff' },
                    { bg: 'var(--k-yellow)', dark: 'var(--k-yellow-dark)', icon: '●', label: 'C', text: 'var(--k-yellow-ink)' },
                    { bg: 'var(--k-green)', dark: 'var(--k-green-dark)', icon: '■', label: 'D', text: '#ffffff' },
                  ];
                  const cfg = configs[idx % 4];
                  const isSelected = selectedChoice === opt;

                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setSelectedChoice(opt);
                        handleSubmitAnswer(opt);
                      }}
                      className="k-btn"
                      style={{
                        padding: '1.15rem 1.25rem',
                        minHeight: '68px',
                        borderRadius: '16px',
                        border: isSelected ? '3px solid #ffffff' : 'none',
                        backgroundColor: cfg.bg,
                        color: cfg.text,
                        fontWeight: 900,
                        fontSize: '1.05rem',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        gap: '0.85rem',
                        boxShadow: isSelected
                          ? `0 2px 0 ${cfg.dark}`
                          : `0 5px 0 ${cfg.dark}`,
                        transform: isSelected ? 'translateY(3px)' : 'none',
                        transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                      }}
                    >
                      <span
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '1.15rem',
                          flexShrink: 0,
                        }}
                      >
                        {cfg.icon}
                      </span>
                      <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.35 }}>{opt}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* QUICK BUTTON (ĐÚNG / SAI) */}
            {(currentQuestion.type === 'QUICK_BUTTON' || currentQuestion.type === 'TRUE_FALSE') && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1.5rem',
                  maxWidth: '540px',
                  margin: '0 auto',
                }}
              >
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    handleSubmitAnswer(currentQuestion.choices?.[0] || 'Đúng')
                  }
                  className="k-btn k-btn-green"
                  style={{
                    minHeight: '74px',
                    borderRadius: '18px',
                    border: 'none',
                    fontWeight: 900,
                    fontSize: '1.35rem',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.65rem',
                  }}
                >
                  <CheckIcon size={26} />
                  <span>{currentQuestion.choices?.[0] || 'ĐÚNG'}</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    handleSubmitAnswer(currentQuestion.choices?.[1] || 'Sai')
                  }
                  className="k-btn k-btn-red"
                  style={{
                    minHeight: '74px',
                    borderRadius: '18px',
                    border: 'none',
                    fontWeight: 900,
                    fontSize: '1.35rem',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.65rem',
                  }}
                >
                  <XMarkIcon size={26} />
                  <span>{currentQuestion.choices?.[1] || 'SAI'}</span>
                </button>
              </div>
            )}

            {/* FILL IN THE BLANK / CROSSWORD / TEXT */}
            {currentQuestion.type === 'PUZZLE' && (
              <div style={{ maxWidth: '580px', margin: '0 auto', textAlign: 'left' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textAlign: 'center' }}>
                  Sắp xếp các bước dưới đây theo đúng thứ tự từ trên xuống dưới:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.25rem' }}>
                  {puzzleOrder.map((item, idx) => (
                    <div
                      key={`${idx}_${item}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.85rem 1rem',
                        borderRadius: '14px',
                        backgroundColor: 'var(--bg-input)',
                        border: '1.5px solid var(--border-strong)',
                      }}
                    >
                      <span
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--primary)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '0.9rem',
                          flexShrink: 0,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span style={{ flex: 1, fontWeight: 800, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                        {item}
                      </span>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type="button"
                          disabled={isSubmitting || idx === 0}
                          onClick={() => handleMovePuzzleItem(idx, -1)}
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: idx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                            fontWeight: 900,
                            cursor: isSubmitting || idx === 0 ? 'not-allowed' : 'pointer',
                          }}
                          title="Di chuyển lên"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={isSubmitting || idx === puzzleOrder.length - 1}
                          onClick={() => handleMovePuzzleItem(idx, 1)}
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: idx === puzzleOrder.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                            fontWeight: 900,
                            cursor: isSubmitting || idx === puzzleOrder.length - 1 ? 'not-allowed' : 'pointer',
                          }}
                          title="Di chuyển xuống"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={isSubmitting || puzzleOrder.length === 0}
                  onClick={() => handleSubmitAnswer(puzzleOrder.join(' | '))}
                  style={{
                    width: '100%',
                    minHeight: '50px',
                    padding: '0.85rem 1.5rem',
                    borderRadius: '14px',
                    border: 'none',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: '1rem',
                    cursor: isSubmitting || puzzleOrder.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  Xác Nhận Thứ Tự Đã Sắp Xếp →
                </button>
              </div>
            )}
            {currentQuestion.type === 'SLIDER' && (() => {
              const cfg = currentQuestion.sliderConfig || { min: 0, max: 100, step: 1 };
              const min = cfg.min;
              const max = cfg.max;
              const step = cfg.step > 0 ? cfg.step : 1;
              const unit = cfg.unit ? ` ${cfg.unit}` : '';
              const clampToSlider = (val: number) => {
                if (!Number.isFinite(val)) return min;
                const snapped = min + Math.round((val - min) / step) * step;
                return Math.max(min, Math.min(max, Number(snapped.toFixed(6))));
              };
              const progressPct = max > min ? Math.max(0, Math.min(100, ((sliderValue - min) / (max - min)) * 100)) : 0;

              return (
                <div style={{ maxWidth: '580px', margin: '0 auto', textAlign: 'center' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '0.85rem 1.75rem',
                      borderRadius: '16px',
                      backgroundColor: 'var(--bg-input)',
                      border: `2px solid ${sliderTouched ? 'var(--primary)' : 'var(--border-strong)'}`,
                      marginBottom: '1rem',
                      minWidth: '180px',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {sliderTouched ? 'Giá trị bạn chọn' : 'Kéo thanh trượt để chọn giá trị'}
                    </span>
                    <span style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                      {sliderValue}{unit}
                    </span>
                  </div>

                  <div style={{ padding: '0.5rem 0.25rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <button
                        type="button"
                        disabled={isSubmitting || sliderValue <= min}
                        onClick={() => {
                          setSliderTouched(true);
                          setSliderValue(prev => clampToSlider(prev - step));
                        }}
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          border: '1.5px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontWeight: 900,
                          fontSize: '1.2rem',
                          cursor: isSubmitting || sliderValue <= min ? 'not-allowed' : 'pointer',
                          flexShrink: 0,
                        }}
                        aria-label="Giảm 1 bước"
                      >
                        −
                      </button>

                      <div style={{ flex: 1, position: 'relative' }}>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={sliderValue}
                          disabled={isSubmitting}
                          onPointerDown={() => setSliderTouched(true)}
                          onTouchStart={() => setSliderTouched(true)}
                          onChange={(e) => {
                            setSliderTouched(true);
                            setSliderValue(clampToSlider(Number(e.target.value)));
                          }}
                          aria-label="Thanh trượt chọn giá trị"
                          style={{
                            width: '100%',
                            height: '12px',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            accentColor: 'var(--primary)',
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                          <span>Min: {min}{unit}</span>
                          <span>{Math.round(progressPct)}%</span>
                          <span>Max: {max}{unit}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting || sliderValue >= max}
                        onClick={() => {
                          setSliderTouched(true);
                          setSliderValue(prev => clampToSlider(prev + step));
                        }}
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          border: '1.5px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontWeight: 900,
                          fontSize: '1.2rem',
                          cursor: isSubmitting || sliderValue >= max ? 'not-allowed' : 'pointer',
                          flexShrink: 0,
                        }}
                        aria-label="Tăng 1 bước"
                      >
                        +
                      </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setSliderTouched(true);
                          setSliderValue(min);
                        }}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: sliderTouched && sliderValue === min ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Chọn Min ({min}{unit})
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setSliderTouched(true);
                          setSliderValue(clampToSlider(sliderValue));
                        }}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: sliderTouched ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Giữ mức {sliderValue}{unit}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setSliderTouched(true);
                          setSliderValue(max);
                        }}
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: sliderTouched && sliderValue === max ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Chọn Max ({max}{unit})
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting || !sliderTouched}
                    onClick={() => {
                      if (!sliderTouched) {
                        toast.warning('Vui lòng kéo thanh trượt hoặc chọn một mức giá trị trước khi xác nhận.', 'Chưa chọn giá trị');
                        return;
                      }
                      const safeVal = clampToSlider(sliderValue);
                      handleSubmitAnswer(String(safeVal));
                    }}
                    style={{
                      width: '100%',
                      minHeight: '50px',
                      padding: '0.85rem 1.5rem',
                      borderRadius: '14px',
                      border: 'none',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: '1rem',
                      cursor: isSubmitting || !sliderTouched ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting || !sliderTouched ? 0.6 : 1,
                    }}
                  >
                    {sliderTouched
                      ? `Xác Nhận Giá Trị ${sliderValue}${unit} →`
                      : 'Hãy Kéo Thanh Trượt Để Chọn Giá Trị'}
                  </button>
                </div>
              );
            })()}
            {(currentQuestion.type === 'FILL_IN_THE_BLANK' ||
              currentQuestion.type === 'TYPE_ANSWER' ||
              currentQuestion.type === 'CROSSWORD') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmitAnswer();
                }}
                style={{ maxWidth: '560px', margin: '0 auto' }}
              >
                {currentQuestion.type === 'CROSSWORD' && (
                  <div
                    data-testid="solo-crossword-box"
                    style={{
                      marginBottom: '1rem',
                      padding: '0.9rem 1rem',
                      borderRadius: '14px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1.5px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.65rem',
                    }}
                  >
                    {currentQuestion.crosswordClue &&
                      currentQuestion.crosswordClue.trim() !== currentQuestion.question.trim() && (
                        <div
                          style={{
                            fontSize: '0.92rem',
                            color: 'var(--text-secondary)',
                            fontWeight: 700,
                            lineHeight: 1.45,
                          }}
                        >
                          <strong style={{ color: 'var(--primary)' }}>Gợi ý ô chữ:</strong>{' '}
                          {currentQuestion.crosswordClue}
                        </div>
                      )}
                    {typeof currentQuestion.crosswordWordLength === 'number' &&
                      currentQuestion.crosswordWordLength > 0 &&
                      currentQuestion.crosswordWordLength <= 24 && (
                        <>
                          <div
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              color: 'var(--text-muted)',
                            }}
                          >
                            Từ khóa gồm {currentQuestion.crosswordWordLength} chữ cái:
                          </div>
                          <div
                            data-testid="solo-crossword-slots"
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              justifyContent: 'center',
                              gap: '0.4rem',
                            }}
                          >
                            {Array.from({ length: currentQuestion.crosswordWordLength }).map(
                              (_, slotIdx) => {
                                const typedNorm = normalizePlaytestCrosswordAscii(textAnswerInput);
                                const ch = typedNorm[slotIdx] || '';
                                return (
                                  <span
                                    key={slotIdx}
                                    style={{
                                      width: '36px',
                                      height: '40px',
                                      borderRadius: '8px',
                                      backgroundColor: 'var(--bg-surface)',
                                      border: `2px solid ${
                                        ch ? 'var(--primary)' : 'var(--border-strong)'
                                      }`,
                                      color: 'var(--text-primary)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '1rem',
                                      fontWeight: 900,
                                    }}
                                  >
                                    {ch || '_'}
                                  </span>
                                );
                              }
                            )}
                          </div>
                        </>
                      )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.65rem' }}>
                  <input
                    type="text"
                    data-testid="solo-text-answer-input"
                    value={textAnswerInput}
                    onChange={(e) =>
                      setTextAnswerInput(
                        currentQuestion.type === 'CROSSWORD'
                          ? e.target.value.toUpperCase()
                          : e.target.value
                      )
                    }
                    placeholder={
                      currentQuestion.type === 'CROSSWORD'
                        ? 'Nhập từ khóa ô chữ (VD: ANTOAN)...'
                        : 'Nhập câu trả lời của bạn...'
                    }
                    disabled={isSubmitting}
                    autoFocus
                    style={{
                      flex: 1,
                      minHeight: '48px',
                      padding: '0.75rem 1.15rem',
                      borderRadius: '12px',
                      border: '2px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="submit"
                    data-testid="solo-submit-answer-btn"
                    disabled={isSubmitting || !textAnswerInput.trim()}
                    style={{
                      minHeight: '48px',
                      padding: '0.75rem 1.5rem',
                      borderRadius: '12px',
                      border: 'none',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      cursor: isSubmitting || !textAnswerInput.trim() ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting || !textAnswerInput.trim() ? 0.6 : 1,
                    }}
                  >
                    {currentQuestion.type === 'CROSSWORD' ? 'Giải Ô Chữ' : 'Gửi'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

