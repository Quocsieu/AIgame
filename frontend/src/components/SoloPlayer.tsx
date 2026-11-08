import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  setSessionLockToken,
  startPracticeSession,
  submitPracticeAnswer,
} from '../services/api.js';
import { soundManager } from '../services/audio.js';
import { AdventureGameEngine } from './AdventureGameEngine.js';
import type {
  GameQuestion,
  GameSpecification,
  GameType,
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
  batchId?: string | null;
  initialSpec?: GameSpecification | null;
  onLeave: () => void;
  playtestMode?: boolean;
  onSpecUpdated?: (spec: GameSpecification) => void;
  demoMode?: boolean;
  demoGuideText?: string;
  onCreateThisGameType?: (gameType: GameType) => void;
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  MULTIPLE_CHOICE: 'Trắc nghiệm 4 lựa chọn',
  QUIZ: 'Trắc nghiệm 4 lựa chọn',
  QUICK_BUTTON: 'Đúng / Sai',
  TRUE_FALSE: 'Đúng / Sai',
  FILL_IN_THE_BLANK: 'Điền vào chỗ trống',
  TYPE_ANSWER: 'Điền câu trả lời ngắn',
  CROSSWORD: 'Ô chữ từ khóa',
  PUZZLE: 'Sắp xếp thứ tự',
  SLIDER: 'Thanh trượt giá trị',
  ADVENTURE: 'Đi cảnh vượt chướng ngại vật',
};

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

function normalizeVietnameseSearch(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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

function doesChoiceMatchTarget(
  choiceText: string,
  targetAnswer: string | undefined,
  choiceIdx: number,
  questionType?: string
): boolean {
  if (!targetAnswer) return false;
  const normChoice = normalizePlaytestToken(choiceText);
  const strippedChoice = stripPlaytestOptionPrefix(choiceText);
  const normTarget = normalizePlaytestToken(targetAnswer);
  const strippedTarget = stripPlaytestOptionPrefix(targetAnswer);
  if (normChoice && (normChoice === normTarget || (strippedChoice && strippedChoice === strippedTarget))) {
    return true;
  }
  const upperTarget = targetAnswer.trim().toUpperCase();
  const letterIdx = ['A', 'B', 'C', 'D'].indexOf(upperTarget);
  if (letterIdx >= 0 && letterIdx === choiceIdx) {
    return true;
  }
  if (questionType === 'QUICK_BUTTON' || questionType === 'TRUE_FALSE') {
    const choicePol = normalizePlaytestTrueFalsePolarity(choiceText);
    const targetPol = normalizePlaytestTrueFalsePolarity(targetAnswer);
    if (choicePol && targetPol && choicePol === targetPol) {
      return true;
    }
  }
  return false;
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
  newStreak: number,
  basePoints?: number
): number {
  if (!isCorrect) return 0;
  const BASE_POINTS =
    typeof basePoints === 'number' && Number.isFinite(basePoints) && basePoints >= 10
      ? Math.round(basePoints)
      : 100;
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
  batchId,
  initialSpec,
  onLeave,
  playtestMode = false,
  onSpecUpdated,
  demoMode = false,
  demoGuideText,
  onCreateThisGameType,
}) => {
  const toast = useToast();
  const effectiveBatchId =
    batchId !== undefined && batchId !== null && String(batchId).trim()
      ? String(batchId).trim()
      : typeof window !== 'undefined'
        ? (new URLSearchParams(window.location.search).get('batch') || '').trim() || null
        : null;
  const prevBatchIdRef = useRef<string | null | undefined>(undefined);

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

  // Roster Gate & Free-Text Gate state (V2/V3)
  const [rosterGateOpen, setRosterGateOpen] = useState<boolean>(false);
  const [rosterItems, setRosterItems] = useState<ParticipantRosterItem[]>([]);
  const [rosterSearch, setRosterSearch] = useState<string>('');
  const [rosterHighlightIndex, setRosterHighlightIndex] = useState<number>(0);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>('');
  const [confirmingIdentity, setConfirmingIdentity] = useState<boolean>(false);
  const [hybridFreeTextMode, setHybridFreeTextMode] = useState<boolean>(false);
  const [freeTextPlayerName, setFreeTextPlayerName] = useState<string>('');
  const [freeTextDepartment, setFreeTextDepartment] = useState<string>('');
  const [freeNameGateOpen, setFreeNameGateOpen] = useState<boolean>(false);
  const [freeNameError, setFreeNameError] = useState<string | null>(null);
  const [examNoRosterBlocked, setExamNoRosterBlocked] = useState<boolean>(false);
  const [examClosedByBtc, setExamClosedByBtc] = useState<boolean>(false);
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
  const [editorCloseConfirmOpen, setEditorCloseConfirmOpen] = useState<boolean>(false);
  const [editorPendingSwitchIdx, setEditorPendingSwitchIdx] = useState<number | null>(null);
  const initialEditDraftJsonRef = useRef<string>('');
  const [editDraft, setEditDraft] = useState<{
    question: string;
    choices: string[];
    correctAnswer: string;
    explanation: string;
    timeLimitSeconds: number;
    points: number;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    crosswordClue?: string;
    crosswordAnswer?: string;
    sliderMin?: number;
    sliderMax?: number;
    sliderStep?: number;
    sliderCorrectValue?: number;
    sliderTolerance?: number;
    sliderUnit?: string;
  }>({
    question: '',
    choices: ['', '', '', ''],
    correctAnswer: '',
    explanation: '',
    timeLimitSeconds: 20,
    points: 100,
    difficulty: 'MEDIUM',
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
  const [isReviewingPreviousAnswer, setIsReviewingPreviousAnswer] = useState(false);
  const [finalResult, setFinalResult] = useState<PracticeFinalResult | null>(null);

  const [playerScore, setPlayerScore] = useState(0);
  const [playerStreak, setPlayerStreak] = useState(0);
  const [playerCorrectCount, setPlayerCorrectCount] = useState(0);
  const [playerWrongCount, setPlayerWrongCount] = useState(0);
  const submittingLockRef = useRef(false);
  const advancingLockRef = useRef(false);
  const lastAdvancedQuestionKeyRef = useRef<string | null>(null);
  const lastAdvanceTimestampRef = useRef<number>(0);
  const answeredQuestionIdsRef = useRef<Set<string>>(new Set());
  const playtestResultsByIndexRef = useRef<Record<number, PracticeQuestionResult>>({});
  const [timeLeft, setTimeLeft] = useState(20);

  const timerRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const playtestQuestionIndexRef = useRef<number>(0);
  const playtestQuestionStartedAtRef = useRef<number>(Date.now());
  const playtestStartedAtRef = useRef<number>(Date.now());
  const playtestMaxStreakRef = useRef<number>(0);
  const playtestQuestionResultsRef = useRef<PracticeQuestionResult[]>([]);
  const adventureCheckpointOpenRef = useRef<boolean>(false);

  // Keep audioMuted and audioVolume synchronized with soundManager
  useEffect(() => {
    const unsubscribe = soundManager.subscribe(() => {
      setAudioMuted(soundManager.isMuted());
      setAudioVolume(soundManager.getVolume());
    });
    return unsubscribe;
  }, []);

  // Release question-advance key tracker when question index changes
  useEffect(() => {
    lastAdvancedQuestionKeyRef.current = null;
  }, [currentQuestion?.questionIndex, currentQuestion?.id, Boolean(finalResult)]);

  const recomputePlaytestAggregates = (spec: GameSpecification | null | undefined) => {
    const total = spec?.questions?.length || 0;
    const orderedResults: PracticeQuestionResult[] = [];
    let score = 0;
    let correct = 0;
    let wrong = 0;
    let streak = 0;
    let maxStreak = 0;

    for (let i = 0; i < total; i++) {
      const r = playtestResultsByIndexRef.current[i];
      if (!r) continue;
      orderedResults.push(r);
      score += typeof r.pointsEarned === 'number' ? r.pointsEarned : 0;
      if (r.isCorrect) {
        correct += 1;
        streak += 1;
        if (streak > maxStreak) maxStreak = streak;
      } else {
        wrong += 1;
        streak = 0;
      }
    }

    playtestQuestionResultsRef.current = orderedResults;
    playtestMaxStreakRef.current = maxStreak;
    setPlayerScore(score);
    setPlayerCorrectCount(correct);
    setPlayerWrongCount(wrong);
    setPlayerStreak(streak);
    return { orderedResults, score, correct, wrong, streak, maxStreak };
  };

  const clearAutoAdvanceTimer = () => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  };

  const handleToggleAudioMute = () => {
    const nextMuted = soundManager.toggleMute();
    const nextVol = soundManager.getVolume();
    flushSync(() => {
      setAudioMuted(nextMuted);
      setAudioVolume(nextVol);
    });
    if (!nextMuted && !finalResult) {
      const spec = loadedSpec || initialSpec;
      soundManager.startSessionAudio(spec?.settings?.audioConfig);
    }
  };

  const handleAudioVolumeChange = (volPercent: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(volPercent)));
    soundManager.setVolume(clamped);
    const shouldUnmute = audioMuted && clamped > 0;
    if (shouldUnmute) {
      soundManager.setMuted(false);
    }
    flushSync(() => {
      setAudioVolume(soundManager.getVolume());
      if (shouldUnmute) {
        setAudioMuted(false);
      }
    });
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

  const loadPlaytestQuestionAtIndex = (
    spec: GameSpecification,
    targetIdx: number,
    options?: { forceResetResult?: boolean }
  ) => {
    const clampedIdx = Math.max(0, Math.min(targetIdx, spec.questions.length - 1));
    const qRaw = spec.questions[clampedIdx];
    const qId = qRaw?.id || `q_${clampedIdx + 1}`;

    if (options?.forceResetResult) {
      delete playtestResultsByIndexRef.current[clampedIdx];
      answeredQuestionIdsRef.current.delete(qId);
      recomputePlaytestAggregates(spec);
    }

    const clientQ = buildPlaytestClientQuestion(spec, clampedIdx);
    playtestQuestionIndexRef.current = clampedIdx;
    setCurrentQuestion(clientQ);

    const existingResult = playtestResultsByIndexRef.current[clampedIdx];
    if (existingResult && !options?.forceResetResult) {
      stopTimer();
      soundManager.resetCountdownTracker();
      setTimeLeft(0);
      setIsQuestionTimedOut(false);
      setIsReviewingPreviousAnswer(true);
      setSelectedChoice(existingResult.answer || null);
      setTextAnswerInput(existingResult.answer || '');
      setQuestionFeedback(existingResult);
    } else {
      setQuestionFeedback(null);
      setIsQuestionTimedOut(false);
      setIsReviewingPreviousAnswer(false);
      setSelectedChoice(null);
      setTextAnswerInput('');
      playtestQuestionStartedAtRef.current = Date.now();
      if (spec.gameType === 'ADVENTURE') {
        stopTimer();
        setTimeLeft(clientQ.timePerQuestion || 20);
      } else {
        startCountdown(clientQ.timePerQuestion || 20);
      }
    }
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
    setIsReviewingPreviousAnswer(false);
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
    playtestResultsByIndexRef.current = {};

    if (playtestMode) {
      stopTimer();
      const spec = loadedSpec || initialSpec;
      if (!spec || !Array.isArray(spec.questions) || spec.questions.length === 0) {
        setErrorMessage('Không tìm thấy câu hỏi để bắt đầu chế độ chơi thử.');
        setIsLoading(false);
        return;
      }
      setLoadedSpec(spec);
      soundManager.startSessionAudio({
        ...(spec.settings?.audioConfig || {}),
        sessionMode: spec.settings?.sessionMode || 'PLAY',
        answersPublished: Boolean(spec.settings?.answersPublished),
      });
      if (spec.gameType === 'ADVENTURE' && !isExplicitStart) {
        setSessionId(null);
        setIsLoading(false);
        return;
      }
      soundManager.playStart();
      playtestQuestionIndexRef.current = 0;
      playtestStartedAtRef.current = Date.now();
      playtestQuestionStartedAtRef.current = Date.now();
      playtestMaxStreakRef.current = 0;
      playtestQuestionResultsRef.current = [];
      setSessionId('playtest-local-session');
      loadPlaytestQuestionAtIndex(spec, 0);
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

    const sessionKey = targetGameId
      ? effectiveBatchId
        ? `active_solo_session_${targetGameId}_${effectiveBatchId}`
        : `active_solo_session_${targetGameId}`
      : null;
    const identityKey = targetGameId ? `solo_roster_identity_${targetGameId}` : null;
    if (isForceRestart && sessionKey) {
      sessionStorage.removeItem(sessionKey);
    }

    // Restore saved roster identity from sessionStorage if present
    if (!confirmedIdentityRef.current && identityKey && !effectiveBatchId) {
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
      if (confirmedIdentityRef.current?.lockToken) {
        setSessionLockToken(savedSessionId, confirmedIdentityRef.current.lockToken);
      }
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
          soundManager.startSessionAudio({
            ...(resolvedSpec?.settings?.audioConfig || {}),
            sessionMode: resolvedSpec?.settings?.sessionMode || 'PLAY',
            answersPublished: Boolean(resolvedSpec?.settings?.answersPublished),
          });
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

    // Check Roster / Free-Text Name / Exam requirements before creating session
    if (targetGameId && !confirmedIdentityRef.current) {
      try {
        const rosterRes = await fetchGameParticipantsApi(targetGameId, {
          mode: 'public',
          batchId: effectiveBatchId || undefined,
        });
        const mode = rosterRes.rosterMode || resolvedSpec?.settings?.rosterMode || 'FREE_TEXT';
        const effectiveSessionMode =
          rosterRes.sessionMode || resolvedSpec?.settings?.sessionMode || 'PLAY';
        const effectiveExamStatus =
          rosterRes.examStatus || resolvedSpec?.settings?.examStatus || 'OPEN';
        const hasRosterList =
          Array.isArray(rosterRes.participants) && rosterRes.participants.length > 0;

        if (effectiveExamStatus === 'CLOSED' || effectiveExamStatus === 'CLOSING') {
          setErrorMessage('Đợt thi này đã kết thúc, không thể bắt đầu lượt thi mới.');
          setIsLoading(false);
          return;
        }

        if (effectiveSessionMode === 'EXAM' && !hasRosterList) {
          setExamNoRosterBlocked(true);
          setIsLoading(false);
          return;
        }

        if (
          hasRosterList &&
          (effectiveSessionMode === 'EXAM' || mode === 'PRECONFIGURED' || mode === 'HYBRID')
        ) {
          setRosterItems(rosterRes.participants);
          setRosterGateOpen(true);
          setIsLoading(false);
          return;
        }

        // V3 Stage 3: Solo Play without Roster -> Require Free-Text Name before Question 1
        if (effectiveSessionMode === 'PLAY' && !hasRosterList && Boolean(gameId)) {
          setFreeNameGateOpen(true);
          setIsLoading(false);
          return;
        }
      } catch {
        // Proceed if endpoint not applicable
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
          batchId: effectiveBatchId || undefined,
          publicPlay: true,
          participantId: ident?.participantId,
          playerName: ident?.playerName,
          departmentUnit: ident?.departmentUnit,
          lockToken: ident?.lockToken,
        });
        activeSessionId = sessionRes.sessionId;
        if (sessionRes.lockToken) {
          setSessionLockToken(activeSessionId, sessionRes.lockToken);
          if (ident) {
            ident.lockToken = sessionRes.lockToken;
            if (identityKey) sessionStorage.setItem(identityKey, JSON.stringify(ident));
          }
        }
      } else if (initialSpec?.gameId) {
        const sessionRes = await createPracticeSession({
          gameId: initialSpec.gameId,
          batchId: effectiveBatchId || undefined,
          gameSpecification: resolvedSpec || initialSpec,
          participantId: ident?.participantId,
          playerName: ident?.playerName,
          departmentUnit: ident?.departmentUnit,
          lockToken: ident?.lockToken,
        });
        activeSessionId = sessionRes.sessionId;
        if (sessionRes.lockToken) {
          setSessionLockToken(activeSessionId, sessionRes.lockToken);
        }
      } else {
        throw new Error('Không tìm thấy thông tin bộ câu hỏi để bắt đầu chơi.');
      }

      setSessionId(activeSessionId);
      if (sessionKey) {
        sessionStorage.setItem(sessionKey, activeSessionId);
      }
      soundManager.startSessionAudio({
        ...(resolvedSpec?.settings?.audioConfig || {}),
        sessionMode: resolvedSpec?.settings?.sessionMode || 'PLAY',
        answersPublished: Boolean(resolvedSpec?.settings?.answersPublished),
      });
      soundManager.playStart();
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

  const sessionInitKey = `${playtestMode ? 'playtest' : 'solo'}::${demoMode ? 'demo' : 'std'}::${
    gameId || initialSpec?.gameId || 'inline'
  }::${effectiveBatchId || ''}`;

  useEffect(() => {
    if (initialSpec) {
      setLoadedSpec(initialSpec);
    }
  }, [initialSpec]);

  useEffect(() => {
    if (prevBatchIdRef.current !== undefined && prevBatchIdRef.current !== effectiveBatchId) {
      confirmedIdentityRef.current = null;
      setRosterGateOpen(false);
    }
    prevBatchIdRef.current = effectiveBatchId;
    initializeSession();
    return () => {
      stopTimer();
      clearAutoAdvanceTimer();
      soundManager.stopAll();
    };
  }, [sessionInitKey]);

  // V3 Stage 5: Poll session status during active Solo Exam to detect BTC Close Exam & auto-submit immediately
  useEffect(() => {
    if (playtestMode || !sessionId || finalResult) return;
    const spec = loadedSpec || initialSpec;
    if (spec?.settings?.sessionMode !== 'EXAM') return;

    const interval = window.setInterval(async () => {
      try {
        const summary = await fetchPracticeSessionSummary(sessionId);
        if (
          summary.state === 'FINISHED' ||
          summary.examStatus === 'CLOSED' ||
          summary.examStatus === 'CLOSING'
        ) {
          window.clearInterval(interval);
          stopTimer();
          clearAutoAdvanceTimer();
          setExamClosedByBtc(true);
          const res = await fetchPracticeResult(sessionId);
          soundManager.stopAll();
          soundManager.playVictory();
          setFinalResult(res);
          setCurrentQuestion(null);
          const targetGameId = gameId || initialSpec?.gameId;
          if (targetGameId) {
            sessionStorage.removeItem(`active_solo_session_${targetGameId}`);
          }
          toast.info(
            'Đợt thi đã kết thúc theo quyết định của Ban Tổ Chức. Bài làm đã được tự động ghi nhận.',
            'Đợt thi đã kết thúc'
          );
        }
      } catch {
        // Ignore transient network errors
      }
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [playtestMode, sessionId, finalResult, loadedSpec, initialSpec, gameId]);

  // Poll result on Finish Screen in EXAM AFTER_PUBLISH mode so answers appear automatically once published by BTC
  useEffect(() => {
    if (playtestMode || !sessionId || !finalResult) return;
    const spec = loadedSpec || initialSpec;
    if ((finalResult.sessionMode || spec?.settings?.sessionMode) !== 'EXAM') return;
    if (finalResult.canRevealAnswers || finalResult.answersPublished) return;

    const interval = window.setInterval(async () => {
      try {
        const latest = await fetchPracticeResult(sessionId);
        if (latest.canRevealAnswers || latest.answersPublished) {
          window.clearInterval(interval);
          setFinalResult(latest);
        }
      } catch {
        // Ignore transient network errors
      }
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [playtestMode, sessionId, finalResult, loadedSpec, initialSpec]);

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

  // Ghi nhận tự động khi hết thời gian trả lời (cả Playtest lẫn Live Session) để chuyển sang feedback
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
        explanation: rawQ.explanation || undefined,
        sourceReference: rawQ.sourceReference,
      };
      answeredQuestionIdsRef.current.add(currentQuestion.id);
      playtestResultsByIndexRef.current[currentQuestion.questionIndex] = timeoutRes;
      recomputePlaytestAggregates(spec);
      soundManager.playTimeout();
      setIsReviewingPreviousAnswer(false);
      setQuestionFeedback(timeoutRes);
      setIsQuestionTimedOut(false);
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
        let streakBefore = 0;
        for (let i = 0; i < currentQuestion.questionIndex; i++) {
          const prevRes = playtestResultsByIndexRef.current[i];
          if (prevRes?.isCorrect) {
            streakBefore += 1;
          } else if (prevRes) {
            streakBefore = 0;
          }
        }
        const nextStreak = isCorrect ? streakBefore + 1 : 0;
        const pointsEarned = calculatePlaytestPoints(
          isCorrect,
          spec.settings?.scoringMode,
          responseTimeMs,
          timeLimitMs,
          nextStreak,
          rawQ.points
        );
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
        playtestResultsByIndexRef.current[currentQuestion.questionIndex] = localRes;
        recomputePlaytestAggregates(spec);
        if (isCorrect) {
          soundManager.playCorrect();
        } else {
          soundManager.playWrong();
        }
        setIsReviewingPreviousAnswer(false);
        setQuestionFeedback(localRes);
        setIsQuestionTimedOut(false);
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
        Boolean((res as any).examAnswerRecorded) ||
        (spec?.settings?.sessionMode === 'EXAM' &&
          !spec?.settings?.answersPublished &&
          spec?.settings?.examAnswerRevealPolicy !== 'IMMEDIATE');
      if (isExamUnpublished) {
        soundManager.playAnswerRecorded();
      } else if (res.isCorrect) {
        soundManager.playCorrect();
      } else {
        soundManager.playWrong();
      }
      setQuestionFeedback(res);
      setIsQuestionTimedOut(false);
      setPlayerScore((prev) => prev + (typeof res.pointsEarned === 'number' ? res.pointsEarned : 0));
      if (typeof res.isCorrect === 'boolean') {
        setPlayerStreak((prev) => (res.isCorrect ? prev + 1 : 0));
        setPlayerCorrectCount((prev) => prev + (res.isCorrect ? 1 : 0));
        setPlayerWrongCount((prev) => prev + (res.isCorrect ? 0 : 1));
      }
    } catch (err: any) {
      if (err.code === 'EXAM_CLOSED' || err.message?.includes('Đợt thi đã kết thúc')) {
        stopTimer();
        clearAutoAdvanceTimer();
        setExamClosedByBtc(true);
        try {
          const res = await fetchPracticeResult(sessionId);
          soundManager.stopAll();
          soundManager.playVictory();
          setFinalResult(res);
          setCurrentQuestion(null);
        } catch {
          // ignore
        }
        toast.info(
          'Đợt thi đã kết thúc. Hệ thống đã tự động ghi nhận kết quả các câu bạn đã hoàn thành.',
          'Đợt thi đã kết thúc'
        );
      } else if (err.message?.includes('abandoned') || err.message?.includes('đã bị kết thúc')) {
        stopTimer();
        clearAutoAdvanceTimer();
        try {
          const res = await fetchPracticeResult(sessionId);
          soundManager.stopAll();
          setFinalResult(res);
          setCurrentQuestion(null);
          toast.warning('Phiên chơi đã được kết thúc. Đây là kết quả tổng kết của bạn.', 'Phiên đã kết thúc');
        } catch {
          toast.warning('Phiên luyện tập này đã được kết thúc bởi người tạo. Đang chuyển hướng...', 'Phiên đã đóng');
          setTimeout(() => handleLeave(), 1500);
        }
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

  const handlePrevQuestion = () => {
    if (!playtestMode || !sessionId || advancingLockRef.current) return;
    const spec = loadedSpec || initialSpec;
    const currentIdx = currentQuestion?.questionIndex ?? playtestQuestionIndexRef.current;
    if (!spec || currentIdx <= 0) return;
    soundManager.playSelect();
    loadPlaytestQuestionAtIndex(spec, currentIdx - 1);
  };

  const handleRetestCurrentQuestion = () => {
    if (!playtestMode || demoMode || !currentQuestion) return;
    const spec = loadedSpec || initialSpec;
    if (!spec) return;
    soundManager.playSelect();
    loadPlaytestQuestionAtIndex(spec, currentQuestion.questionIndex, { forceResetResult: true });
    toast.info(`Đã đặt lại Câu #${currentQuestion.questionIndex + 1} để bạn kiểm thử lại.`, 'Chơi lại câu này');
  };

  const handleNextQuestion = async () => {
    if (!sessionId || !currentQuestion || advancingLockRef.current) return;
    const nowMs = Date.now();
    if (nowMs - lastAdvanceTimestampRef.current < 80) return;
    if (playtestMode) {
      const currentIdx = currentQuestion.questionIndex;
      const canAdvancePlaytest = Boolean(
        questionFeedback ||
          isQuestionTimedOut ||
          isReviewingPreviousAnswer ||
          playtestResultsByIndexRef.current[currentIdx]
      );
      if (!canAdvancePlaytest) return;
    } else if (!questionFeedback && !isQuestionTimedOut) {
      return;
    }

    const advanceKey = `${currentQuestion.questionIndex}:${currentQuestion.id}`;
    if (lastAdvancedQuestionKeyRef.current === advanceKey) return;
    lastAdvancedQuestionKeyRef.current = advanceKey;
    lastAdvanceTimestampRef.current = nowMs;
    advancingLockRef.current = true;
    clearAutoAdvanceTimer();
    setIsLoading(true);
    const wasTimedOut = isQuestionTimedOut && !questionFeedback;
    setQuestionFeedback(null);
    setIsQuestionTimedOut(false);
    setIsReviewingPreviousAnswer(false);
    setSelectedChoice(null);
    setTextAnswerInput('');

    try {
      if (playtestMode) {
        const spec = loadedSpec || initialSpec;
        if (wasTimedOut && spec && currentQuestion) {
          const rawQ = spec.questions[currentQuestion.questionIndex];
          const effectiveType = rawQ?.type || spec.gameType;
          const displayCorrectAnswer =
            effectiveType === 'CROSSWORD'
              ? rawQ?.crosswordAnswer || rawQ?.correctAnswer
              : effectiveType === 'SLIDER' && rawQ?.sliderConfig
                ? `${rawQ.sliderConfig.correctValue}${rawQ.sliderConfig.unit ? ` ${rawQ.sliderConfig.unit}` : ''}`
                : rawQ?.correctAnswer;
          playtestResultsByIndexRef.current[currentQuestion.questionIndex] = {
            questionId: currentQuestion.id,
            answer: '',
            isCorrect: false,
            timedOut: true,
            pointsEarned: 0,
            responseTimeMs: (currentQuestion.timePerQuestion || 20) * 1000,
            answeredAt: new Date().toISOString(),
            correctAnswer: displayCorrectAnswer,
            explanation: rawQ?.explanation,
            sourceReference: rawQ?.sourceReference,
          };
        }
        const agg = recomputePlaytestAggregates(spec);
        const nextIdx = playtestQuestionIndexRef.current + 1;
        if (!spec || nextIdx >= spec.questions.length) {
          const totalQ = spec?.questions.length || 1;
          const maxScore = calculateFrontendMaxPossibleScore(
            spec?.questions || totalQ,
            spec?.settings?.scoringMode
          );
          const perfEval = evaluateFrontendPerformance({
            correctAnswers: agg.correct,
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
            canRevealAnswers: true,
            totalScore: agg.score,
            score: agg.score,
            maxPossibleScore: maxScore,
            maxStreak: agg.maxStreak,
            totalQuestions: totalQ,
            correctAnswers: agg.correct,
            correctCount: agg.correct,
            wrongCount: agg.wrong,
            wrongAnswers: agg.wrong,
            accuracy: perfEval.accuracyPercentage,
            performanceEvaluation: perfEval,
            durationMs: durationSeconds * 1000,
            finishedAt: new Date().toISOString(),
            questionResults: [...agg.orderedResults],
          };
          soundManager.stopAll();
          soundManager.playVictory();
          setFinalResult(localFinal);
          setCurrentQuestion(null);
          stopTimer();
        } else {
          soundManager.playSelect();
          loadPlaytestQuestionAtIndex(spec, nextIdx);
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
        stopTimer();
        clearAutoAdvanceTimer();
        try {
          const res = await fetchPracticeResult(sessionId);
          soundManager.stopAll();
          setFinalResult(res);
          setCurrentQuestion(null);
          toast.warning('Phiên chơi đã được kết thúc. Đây là kết quả tổng kết của bạn.', 'Phiên đã kết thúc');
        } catch {
          toast.warning('Phiên luyện tập này đã được kết thúc bởi người tạo. Đang chuyển hướng...', 'Phiên đã đóng');
          setTimeout(() => handleLeave(), 1500);
        }
      } else {
        toast.error(err.message || 'Không thể tải câu hỏi tiếp theo.', 'Lỗi chuyển câu');
      }
    } finally {
      setIsLoading(false);
      if (!playtestMode) {
        advancingLockRef.current = false;
      } else {
        window.setTimeout(() => {
          advancingLockRef.current = false;
        }, 0);
      }
    }
  };

  // Unified Question Progression Policy:
  // Both Creator Playtest (playtestMode === true) and Real Solo Play (playtestMode === false)
  // strictly use MANUAL progression — never auto-advance after answering or timing out.
  const questionAdvancePolicy: 'MANUAL' | 'AUTO' = 'MANUAL';

  useEffect(() => {
    clearAutoAdvanceTimer();
    if (questionAdvancePolicy === 'MANUAL') {
      return;
    }
    return () => {
      clearAutoAdvanceTimer();
    };
  }, [questionAdvancePolicy, playtestMode, questionFeedback, inlineEditOpen, finalResult]);

  const populateEditDraftForQuestion = (spec: GameSpecification, idx: number) => {
    const q = spec.questions[idx];
    if (!q) return;
    const nextDraft = {
      question: q.question || '',
      choices: Array.isArray(q.choices) && q.choices.length > 0 ? [...q.choices] : ['', '', '', ''],
      correctAnswer: q.correctAnswer || '',
      explanation: q.explanation || '',
      timeLimitSeconds:
        q.timeLimitSeconds || currentQuestion?.timePerQuestion || spec.settings?.timePerQuestion || 20,
      points: typeof q.points === 'number' && q.points >= 10 ? q.points : 100,
      difficulty: (q.difficulty || 'MEDIUM') as 'EASY' | 'MEDIUM' | 'HARD',
      crosswordClue: q.crosswordClue,
      crosswordAnswer: q.crosswordAnswer,
      sliderMin: q.sliderConfig?.min ?? 0,
      sliderMax: q.sliderConfig?.max ?? 100,
      sliderStep: q.sliderConfig?.step ?? 1,
      sliderCorrectValue: q.sliderConfig?.correctValue ?? Number(q.correctAnswer || 50),
      sliderTolerance: q.sliderConfig?.tolerance ?? 0,
      sliderUnit: q.sliderConfig?.unit ?? '',
    };
    initialEditDraftJsonRef.current = JSON.stringify(nextDraft);
    setInlineEditIndex(idx);
    setEditDraft(nextDraft);
    setEditorCloseConfirmOpen(false);
    setEditorPendingSwitchIdx(null);
  };

  // Open Inline Question Editor during Playtest (disabled in public Demo mode)
  const handleOpenInlineEditor = (targetIdx?: number) => {
    if (!playtestMode || demoMode) return;
    const spec = loadedSpec || initialSpec;
    if (!spec || !Array.isArray(spec.questions)) return;
    const idx =
      typeof targetIdx === 'number'
        ? targetIdx
        : currentQuestion?.questionIndex ?? playtestQuestionIndexRef.current;
    if (!spec.questions[idx]) return;

    stopTimer();
    clearAutoAdvanceTimer();
    populateEditDraftForQuestion(spec, idx);
    setInlineEditOpen(true);
  };

  const isInlineEditorDirty =
    inlineEditOpen && JSON.stringify(editDraft) !== initialEditDraftJsonRef.current;

  const forceCloseInlineEditor = () => {
    setEditorCloseConfirmOpen(false);
    setEditorPendingSwitchIdx(null);
    setInlineEditOpen(false);
    const spec = loadedSpec || initialSpec;
    if (!questionFeedback && currentQuestion && spec?.gameType !== 'ADVENTURE') {
      startCountdown(Math.max(1, timeLeft));
    }
  };

  const handleCloseInlineEditor = () => {
    if (isInlineEditorDirty && !editorCloseConfirmOpen) {
      setEditorPendingSwitchIdx(null);
      setEditorCloseConfirmOpen(true);
      return;
    }
    forceCloseInlineEditor();
  };

  const handleSwitchQuestionInEditor = (targetIdx: number) => {
    const spec = loadedSpec || initialSpec;
    if (!spec || targetIdx < 0 || targetIdx >= spec.questions.length) return;
    if (isInlineEditorDirty) {
      setEditorPendingSwitchIdx(targetIdx);
      setEditorCloseConfirmOpen(true);
      return;
    }
    soundManager.playSelect();
    populateEditDraftForQuestion(spec, targetIdx);
    loadPlaytestQuestionAtIndex(spec, targetIdx);
  };

  const handleSaveInlineEditor = async () => {
    const spec = loadedSpec || initialSpec;
    if (!spec || !Array.isArray(spec.questions)) return;
    const targetQ = spec.questions[inlineEditIndex];
    const effectiveType = targetQ?.type || spec.gameType;
    const trimmedQ = editDraft.question.trim();
    const trimmedAns =
      effectiveType === 'SLIDER'
        ? String(editDraft.sliderCorrectValue ?? editDraft.correctAnswer).trim()
        : editDraft.correctAnswer.trim();
    if (!trimmedQ || !trimmedAns) {
      toast.warning('Nội dung câu hỏi và đáp án đúng không được để trống.', 'Thiếu thông tin');
      return;
    }

    setSavingInlineEdit(true);
    try {
      const updatedQuestions: GameQuestion[] = spec.questions.map((item, idx) => {
        if (idx !== inlineEditIndex) return item;
        const qType = item.type || spec.gameType;
        const cleanedChoices = editDraft.choices.map((c) => c.trim()).filter(Boolean);
        return {
          ...item,
          question: trimmedQ,
          choices:
            qType === 'MULTIPLE_CHOICE' ||
            qType === 'QUIZ' ||
            qType === 'QUICK_BUTTON' ||
            qType === 'TRUE_FALSE' ||
            qType === 'PUZZLE'
              ? cleanedChoices.length > 0
                ? cleanedChoices
                : item.choices
              : item.choices,
          correctAnswer: trimmedAns,
          explanation: editDraft.explanation.trim(),
          difficulty: editDraft.difficulty || item.difficulty || 'MEDIUM',
          timeLimitSeconds: Math.max(5, Math.min(300, Number(editDraft.timeLimitSeconds) || 20)),
          points: Math.max(10, Math.min(1000, Math.round(Number(editDraft.points) || 100))),
          crosswordClue: editDraft.crosswordClue ?? item.crosswordClue,
          crosswordAnswer:
            qType === 'CROSSWORD'
              ? editDraft.crosswordAnswer?.trim() || trimmedAns
              : item.crosswordAnswer,
          sliderConfig:
            qType === 'SLIDER'
              ? {
                  min: Number(editDraft.sliderMin ?? item.sliderConfig?.min ?? 0),
                  max: Number(editDraft.sliderMax ?? item.sliderConfig?.max ?? 100),
                  step: Math.max(0.1, Number(editDraft.sliderStep ?? item.sliderConfig?.step ?? 1)),
                  correctValue: Number(editDraft.sliderCorrectValue ?? trimmedAns),
                  tolerance: Math.max(0, Number(editDraft.sliderTolerance ?? item.sliderConfig?.tolerance ?? 0)),
                  unit: editDraft.sliderUnit?.trim() || item.sliderConfig?.unit,
                }
              : item.sliderConfig,
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

      const editedQ = updatedQuestions[inlineEditIndex];
      const editedDisplayAnswer =
        (editedQ?.type || updatedSpec.gameType) === 'CROSSWORD'
          ? editedQ?.crosswordAnswer || editedQ?.correctAnswer
          : (editedQ?.type || updatedSpec.gameType) === 'SLIDER' && editedQ?.sliderConfig
            ? `${editedQ.sliderConfig.correctValue}${editedQ.sliderConfig.unit ? ` ${editedQ.sliderConfig.unit}` : ''}`
            : editedQ?.correctAnswer;

      if (finalResult) {
        if (playtestResultsByIndexRef.current[inlineEditIndex]) {
          playtestResultsByIndexRef.current[inlineEditIndex] = {
            ...playtestResultsByIndexRef.current[inlineEditIndex],
            correctAnswer: editedDisplayAnswer,
            explanation: editedQ?.explanation,
          };
        }
        setFinalResult((prev) => {
          if (!prev || !Array.isArray(prev.questionResults)) return prev;
          return {
            ...prev,
            questionResults: prev.questionResults.map((qr, idx) =>
              idx === inlineEditIndex
                ? {
                    ...qr,
                    correctAnswer: editedDisplayAnswer,
                    explanation: editedQ?.explanation,
                  }
                : qr
            ),
          };
        });
      } else {
        // Reset the edited question's playtest result and jump to it so the creator can immediately re-test
        loadPlaytestQuestionAtIndex(updatedSpec, inlineEditIndex, { forceResetResult: true });
      }

      setEditorCloseConfirmOpen(false);
      setEditorPendingSwitchIdx(null);
      setInlineEditOpen(false);
      toast.success(
        finalResult
          ? `Đã lưu chỉnh sửa Câu #${inlineEditIndex + 1} trên màn hình tổng kết.`
          : `Đã lưu Câu #${inlineEditIndex + 1}. Bạn có thể trả lời lại câu này ngay để kiểm thử.`,
        finalResult ? 'Đã cập nhật câu hỏi' : 'Đã lưu & đặt lại câu hỏi'
      );
    } finally {
      setSavingInlineEdit(false);
    }
  };

  const activeGameSpec = loadedSpec || initialSpec;
  const isExamMode =
    finalResult?.sessionMode === 'EXAM' || activeGameSpec?.settings?.sessionMode === 'EXAM';
  const effectiveExamRevealPolicy =
    finalResult?.examAnswerRevealPolicy === 'IMMEDIATE' ||
    finalResult?.examAnswerRevealPolicy === 'AFTER_SUBMIT' ||
    finalResult?.examAnswerRevealPolicy === 'AFTER_PUBLISH'
      ? finalResult.examAnswerRevealPolicy
      : activeGameSpec?.settings?.examAnswerRevealPolicy === 'IMMEDIATE' ||
          activeGameSpec?.settings?.examAnswerRevealPolicy === 'AFTER_SUBMIT' ||
          activeGameSpec?.settings?.examAnswerRevealPolicy === 'AFTER_PUBLISH'
        ? activeGameSpec.settings.examAnswerRevealPolicy
        : 'AFTER_PUBLISH';
  const isExamUnpublished =
    isExamMode &&
    !activeGameSpec?.settings?.answersPublished &&
    !playtestMode &&
    effectiveExamRevealPolicy !== 'IMMEDIATE' &&
    Boolean(
      (questionFeedback as any)?.examAnswerRecorded ||
        (questionFeedback as any)?.examRedacted ||
        !questionFeedback?.correctAnswer
    );

  const editingQuestionRaw = activeGameSpec?.questions?.[inlineEditIndex];
  const editingQuestionEffectiveType = editingQuestionRaw?.type || activeGameSpec?.gameType || 'MULTIPLE_CHOICE';

  const inlineEditModalNode = inlineEditOpen && !demoMode ? (
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
        padding: '0.85rem',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '660px',
          maxHeight: 'calc(100dvh - 1.7rem)',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-surface)',
          border: '1.5px solid var(--primary)',
          borderRadius: '18px',
          padding: '1.25rem 1.35rem',
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
            marginBottom: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 900,
                color: '#f59e0b',
                textTransform: 'uppercase',
              }}
            >
              Chỉnh sửa trực tiếp trong Chơi thử · Câu #{inlineEditIndex + 1} /{' '}
              {activeGameSpec?.questions?.length || 1}
            </span>
            <h3 style={{ margin: '0.15rem 0 0 0', fontSize: '1.08rem', fontWeight: 900 }}>
              Cập nhật nội dung câu hỏi (Đồng hồ đã tạm dừng)
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {activeGameSpec && activeGameSpec.questions.length > 1 && (
              <>
                <button
                  type="button"
                  data-testid="playtest-editor-prev-q-btn"
                  disabled={inlineEditIndex <= 0}
                  onClick={() => handleSwitchQuestionInEditor(inlineEditIndex - 1)}
                  style={{
                    height: '34px',
                    padding: '0 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: inlineEditIndex <= 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    cursor: inlineEditIndex <= 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ← Câu trước
                </button>
                <button
                  type="button"
                  data-testid="playtest-editor-next-q-btn"
                  disabled={inlineEditIndex + 1 >= activeGameSpec.questions.length}
                  onClick={() => handleSwitchQuestionInEditor(inlineEditIndex + 1)}
                  style={{
                    height: '34px',
                    padding: '0 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color:
                      inlineEditIndex + 1 >= activeGameSpec.questions.length
                        ? 'var(--text-muted)'
                        : 'var(--text-primary)',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    cursor:
                      inlineEditIndex + 1 >= activeGameSpec.questions.length
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  Câu tiếp →
                </button>
              </>
            )}
            <button
              type="button"
              data-testid="playtest-inline-close-btn"
              onClick={handleCloseInlineEditor}
              style={{
                width: '34px',
                height: '34px',
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
        </div>

        {editorCloseConfirmOpen && (
          <div
            data-testid="playtest-unsaved-warning-banner"
            style={{
              marginBottom: '0.85rem',
              padding: '0.75rem 0.95rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(245, 158, 11, 0.14)',
              border: '1.5px solid rgba(245, 158, 11, 0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.6rem',
            }}
          >
            <div style={{ fontSize: '0.83rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              ⚠ Bạn có thay đổi chưa lưu ở Câu #{inlineEditIndex + 1}. Bạn muốn lưu hay bỏ thay đổi?
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="playtest-unsaved-keep-editing-btn"
                onClick={() => {
                  setEditorCloseConfirmOpen(false);
                  setEditorPendingSwitchIdx(null);
                }}
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Tiếp tục sửa
              </button>
              <button
                type="button"
                data-testid="playtest-inline-discard-btn"
                onClick={() => {
                  const spec = loadedSpec || initialSpec;
                  if (typeof editorPendingSwitchIdx === 'number' && spec) {
                    const target = editorPendingSwitchIdx;
                    populateEditDraftForQuestion(spec, target);
                    loadPlaytestQuestionAtIndex(spec, target);
                  } else {
                    forceCloseInlineEditor();
                  }
                }}
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  backgroundColor: 'rgba(239, 68, 68, 0.14)',
                  color: 'var(--accent-rose)',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Bỏ thay đổi
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
              Nội dung câu hỏi:
            </label>
            <textarea
              data-testid="playtest-inline-question-input"
              rows={2}
              value={editDraft.question}
              onChange={(e) => setEditDraft((prev) => ({ ...prev, question: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.55rem 0.8rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.92rem',
                fontWeight: 700,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {editingQuestionEffectiveType === 'CROSSWORD' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                Gợi ý ô chữ (Clue):
              </label>
              <input
                type="text"
                data-testid="playtest-inline-crossword-clue-input"
                value={editDraft.crosswordClue || ''}
                onChange={(e) => setEditDraft((prev) => ({ ...prev, crosswordClue: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {editingQuestionEffectiveType === 'SLIDER' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, marginBottom: '0.25rem' }}>
                  Min:
                </label>
                <input
                  type="number"
                  value={editDraft.sliderMin ?? 0}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, sliderMin: Number(e.target.value) }))}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, marginBottom: '0.25rem' }}>
                  Max:
                </label>
                <input
                  type="number"
                  value={editDraft.sliderMax ?? 100}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, sliderMax: Number(e.target.value) }))}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, marginBottom: '0.25rem' }}>
                  Sai số (±):
                </label>
                <input
                  type="number"
                  min={0}
                  value={editDraft.sliderTolerance ?? 0}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, sliderTolerance: Number(e.target.value) }))}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, marginBottom: '0.25rem' }}>
                  Đơn vị:
                </label>
                <input
                  type="text"
                  value={editDraft.sliderUnit ?? ''}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, sliderUnit: e.target.value }))}
                  placeholder="%, năm..."
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {Array.isArray(editingQuestionRaw?.choices) &&
            (editingQuestionRaw?.choices?.length || 0) > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                  Các lựa chọn:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
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
                        padding: '0.5rem 0.7rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: '0.86rem',
                        fontWeight: 600,
                        boxSizing: 'border-box',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                Đáp án đúng:
              </label>
              <input
                type="text"
                data-testid="playtest-inline-correct-input"
                value={editDraft.correctAnswer}
                onChange={(e) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    correctAnswer: e.target.value,
                    ...(editingQuestionEffectiveType === 'SLIDER'
                      ? { sliderCorrectValue: Number(e.target.value) || 0 }
                      : {}),
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '10px',
                  border: '1.5px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                Thời gian (s):
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
                  padding: '0.55rem 0.65rem',
                  borderRadius: '10px',
                  border: '1.5px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                Điểm:
              </label>
              <input
                type="number"
                min={10}
                max={1000}
                step={10}
                data-testid="playtest-inline-points-input"
                value={editDraft.points}
                onChange={(e) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    points: Math.max(10, Math.min(1000, Math.round(Number(e.target.value) || 100))),
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.55rem 0.65rem',
                  borderRadius: '10px',
                  border: '1.5px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                Độ khó:
              </label>
              <select
                data-testid="playtest-inline-difficulty-select"
                value={editDraft.difficulty}
                onChange={(e) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD',
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.55rem 0.5rem',
                  borderRadius: '10px',
                  border: '1.5px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              >
                <option value="EASY">Dễ</option>
                <option value="MEDIUM">Vừa</option>
                <option value="HARD">Khó</option>
              </select>
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

  // V3 Stage 4: EXAM mode blocked when no participant roster is configured
  if (examNoRosterBlocked && !playtestMode) {
    return (
      <div
        data-testid="solo-exam-no-roster-error"
        style={{
          maxWidth: '560px',
          margin: '2.5rem auto',
          padding: '2.25rem 2rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1.5px solid rgba(239, 68, 68, 0.45)',
          borderRadius: '20px',
          boxShadow: 'var(--shadow-lg)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            backgroundColor: 'rgba(239, 68, 68, 0.14)',
            color: 'var(--accent-rose)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          <XMarkIcon size={28} />
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.35rem', fontWeight: 900 }}>
          Đợt Thi Chưa Có Danh Sách Thí Sinh
        </h2>
        <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
          Ở chế độ Thi cá nhân, Ban Tổ Chức bắt buộc phải cấu hình danh sách thí sinh trước khi mở đợt thi. Không cho phép thí sinh tự nhập tên tự do.
        </p>
        <button
          type="button"
          onClick={handleLeave}
          style={{
            minHeight: '44px',
            padding: '0.65rem 1.5rem',
            borderRadius: '10px',
            border: '1.5px solid var(--border-strong)',
            backgroundColor: 'var(--bg-input)',
            color: 'var(--text-primary)',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          Quay lại
        </button>
      </div>
    );
  }

  // V3 Stage 3: Free-Text Name Gate for Solo PLAY mode without a participant roster
  if (freeNameGateOpen && !playtestMode) {
    const handleStartFreeNameSolo = (e: React.FormEvent) => {
      e.preventDefault();
      const formEl = e.currentTarget as HTMLFormElement | null;
      const domNameVal =
        formEl?.querySelector<HTMLInputElement>('[data-testid="solo-free-name-input"]')?.value || '';
      const domDeptVal =
        formEl?.querySelector<HTMLInputElement>('[data-testid="solo-free-dept-input"]')?.value || '';
      const rawName = freeTextPlayerName || domNameVal;
      const rawDept = freeTextDepartment || domDeptVal;
      const cleanName = rawName.replace(/\s+/g, ' ').trim();
      if (!cleanName) {
        setFreeNameError('Vui lòng nhập tên của bạn (không được để trống hoặc chỉ chứa khoảng trắng).');
        toast.warning('Vui lòng nhập tên của bạn trước khi bắt đầu chơi.', 'Thiếu tên người chơi');
        return;
      }
      if (cleanName.length > 80) {
        setFreeNameError('Tên người chơi không được vượt quá 80 ký tự.');
        return;
      }
      setFreeNameError(null);
      const targetGameId = gameId || initialSpec?.gameId;
      const identityKey = targetGameId ? `solo_roster_identity_${targetGameId}` : null;
      const ident = {
        playerName: cleanName,
        departmentUnit: rawDept.trim() || undefined,
      };
      confirmedIdentityRef.current = ident;
      if (identityKey) sessionStorage.setItem(identityKey, JSON.stringify(ident));
      setFreeNameGateOpen(false);
      const isAdventure = (initialSpec?.gameType || loadedSpec?.gameType) === 'ADVENTURE';
      initializeSession(!isAdventure);
    };

    return (
      <div
        data-testid="solo-free-name-gate"
        style={{
          maxWidth: '520px',
          margin: '2.5rem auto',
          padding: '2rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '20px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1.4rem', fontWeight: 900 }}>
          Nhập Tên Người Chơi
        </h2>
        <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {activeGameSpec?.title || 'Chơi cá nhân'} — Nhập tên của bạn để bắt đầu thử thách và lưu kết quả.
        </p>
        <form onSubmit={handleStartFreeNameSolo} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <label
              htmlFor="solo-free-name-input"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, marginBottom: '0.35rem' }}
            >
              Họ và tên / Biệt danh <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input
              id="solo-free-name-input"
              type="text"
              data-testid="solo-free-name-input"
              maxLength={80}
              placeholder="VD: Nguyễn Minh Anh"
              value={freeTextPlayerName}
              onChange={(e) => {
                setFreeTextPlayerName(e.target.value);
                if (freeNameError) setFreeNameError(null);
              }}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label
              htmlFor="solo-free-dept-input"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, marginBottom: '0.35rem' }}
            >
              Đơn vị / Lớp / Phòng ban (tùy chọn)
            </label>
            <input
              id="solo-free-dept-input"
              type="text"
              data-testid="solo-free-dept-input"
              maxLength={80}
              placeholder="VD: Phòng Kỹ Thuật"
              value={freeTextDepartment}
              onChange={(e) => setFreeTextDepartment(e.target.value)}
              style={{
                width: '100%',
                padding: '0.7rem 1rem',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                boxSizing: 'border-box',
              }}
            />
          </div>
          {freeNameError && (
            <div
              data-testid="solo-free-name-error"
              style={{
                padding: '0.6rem 0.85rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: 'var(--accent-rose)',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              {freeNameError}
            </div>
          )}
          <button
            type="submit"
            data-testid="solo-free-start-btn"
            style={{
              minHeight: '46px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.98rem',
              cursor: 'pointer',
              marginTop: '0.25rem',
            }}
          >
            Bắt đầu chơi
          </button>
          <button
            type="button"
            onClick={handleLeave}
            style={{
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
        </form>
      </div>
    );
  }

  // ROSTER GATE SCREEN (Solo Live Mode with PRECONFIGURED / HYBRID Roster)
  if (rosterGateOpen && !playtestMode) {
    const rosterMode = isExamMode
      ? 'PRECONFIGURED'
      : activeGameSpec?.settings?.rosterMode || 'PRECONFIGURED';
    const duplicateNameCounts = new Map<string, number>();
    for (const item of rosterItems) {
      const k = normalizeVietnameseSearch(item.fullName);
      duplicateNameCounts.set(k, (duplicateNameCounts.get(k) || 0) + 1);
    }
    const normSearch = normalizeVietnameseSearch(rosterSearch);
    const filteredRoster = rosterItems.filter((item) => {
      if (!normSearch) return true;
      const hay = normalizeVietnameseSearch(
        `${item.fullName} ${item.departmentUnit || ''} ${item.employeeCode || ''}`
      );
      return hay.includes(normSearch);
    });
    const safeHighlight = Math.max(
      0,
      Math.min(rosterHighlightIndex, Math.max(0, filteredRoster.length - 1))
    );
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
        const isAdventure = (initialSpec?.gameType || loadedSpec?.gameType) === 'ADVENTURE';
        initializeSession(!isAdventure);
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
      const isAdventure = (initialSpec?.gameType || loadedSpec?.gameType) === 'ADVENTURE';
      initializeSession(!isAdventure);
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                Hiển thị {filteredRoster.length}/{rosterItems.length} người tham gia
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                ↑↓ Di chuyển • Enter Chọn • Esc Xóa tìm kiếm
              </span>
            </div>
            <input
              type="text"
              data-testid="roster-search-input"
              placeholder="Gõ tên không dấu/có dấu, mã nhân viên hoặc đơn vị..."
              value={rosterSearch}
              onChange={(e) => {
                setRosterSearch(e.target.value);
                setRosterHighlightIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setRosterHighlightIndex((prev) =>
                    filteredRoster.length > 0 ? (prev + 1) % filteredRoster.length : 0
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setRosterHighlightIndex((prev) =>
                    filteredRoster.length > 0
                      ? (prev - 1 + filteredRoster.length) % filteredRoster.length
                      : 0
                  );
                } else if (e.key === 'Enter') {
                  const target = filteredRoster[safeHighlight];
                  if (target) {
                    e.preventDefault();
                    const pid = target.id || target.participantId;
                    setSelectedParticipantId(pid);
                    setConfirmingIdentity(true);
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  if (rosterSearch) {
                    setRosterSearch('');
                    setRosterHighlightIndex(0);
                  } else {
                    setSelectedParticipantId('');
                    setConfirmingIdentity(false);
                  }
                }
              }}
              style={{
                width: '100%',
                padding: '0.7rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                marginBottom: '0.85rem',
                boxSizing: 'border-box',
              }}
            />

            <div
              role="listbox"
              aria-label="Danh sách thí sinh"
              data-testid="solo-roster-dropdown-list"
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                marginBottom: '1.25rem',
              }}
            >
              {filteredRoster.length === 0 ? (
                <div
                  data-testid="solo-roster-empty-search"
                  style={{
                    padding: '1rem',
                    textAlign: 'center',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Không tìm thấy thí sinh phù hợp với từ khóa "{rosterSearch}".
                </div>
              ) : (
                filteredRoster.map((p, idx) => {
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
                  const isHighlighted = idx === safeHighlight;
                  const isDuplicateName =
                    (duplicateNameCounts.get(normalizeVietnameseSearch(p.fullName)) || 0) > 1;
                  return (
                    <button
                      key={pid}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`roster-participant-option-${pid}`}
                      disabled={isBlocked}
                      onMouseEnter={() => setRosterHighlightIndex(idx)}
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
                          isSelected
                            ? 'var(--primary)'
                            : isHighlighted
                              ? 'var(--accent-sky)'
                              : 'var(--border-subtle)'
                        }`,
                        backgroundColor: isSelected
                          ? 'var(--primary-subtle)'
                          : isHighlighted
                            ? 'rgba(56, 189, 248, 0.08)'
                            : 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                        cursor: isBlocked ? 'not-allowed' : 'pointer',
                        opacity: isBlocked ? 0.55 : 1,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span>{p.fullName}</span>
                          {isDuplicateName && (
                            <span
                              data-testid={`solo-duplicate-badge-${pid}`}
                              style={{
                                fontSize: '0.7rem',
                                padding: '0.1rem 0.45rem',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(56, 189, 248, 0.16)',
                                color: 'var(--accent-sky)',
                                fontWeight: 800,
                              }}
                            >
                              {p.departmentUnit || p.employeeCode || `ID: ${pid.slice(-4)}`}
                            </span>
                          )}
                        </div>
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
                })
              )}
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

  const finishPlaytestBanner = playtestMode ? (
    <div
      data-testid="playtest-mode-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: '0.45rem',
        padding: '0.32rem 0.75rem',
        marginBottom: '0.5rem',
        borderRadius: '10px',
        backgroundColor: demoMode ? 'rgba(99, 102, 241, 0.12)' : 'rgba(245, 158, 11, 0.12)',
        border: `1px solid ${demoMode ? 'rgba(99, 102, 241, 0.4)' : 'rgba(245, 158, 11, 0.38)'}`,
        color: 'var(--text-primary)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.14rem 0.48rem',
          borderRadius: '999px',
          backgroundColor: demoMode ? 'var(--primary)' : '#f59e0b',
          color: demoMode ? '#ffffff' : '#0f172a',
          fontSize: '0.66rem',
          fontWeight: 900,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {demoMode ? 'CHẾ ĐỘ XEM DEMO' : 'CHẾ ĐỘ CHƠI THỬ'}
      </span>
      <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
        {demoMode
          ? 'Trải nghiệm câu hỏi mẫu — Không tốn AI token và không ghi dữ liệu thật'
          : 'Trải nghiệm kiểm thử — Không ghi điểm, lịch sử hay thống kê thật'}
      </span>
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
          onPrevCheckpointQuestion={handlePrevQuestion}
          finalResult={finalResult}
          onRestartSession={() => initializeSession('RESTART')}
          onExit={handleLeave}
          isPlaytest={playtestMode}
          isDemoMode={demoMode}
          onCreateThisGameType={
            demoMode && onCreateThisGameType
              ? () => onCreateThisGameType('ADVENTURE')
              : undefined
          }
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
        activeGameSpec?.questions || finalResult.totalQuestions,
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
        className="solo-finish-screen-card"
        style={{
          maxWidth: '760px',
          width: '100%',
          margin: playtestMode ? '0 auto' : '0.75rem auto',
          padding: '0.95rem 1.25rem',
          maxHeight: demoMode ? 'calc(100dvh - 116px)' : 'calc(100dvh - 2rem)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '20px',
          textAlign: 'center',
          boxShadow: 'var(--shadow-xl)',
          animation: 'popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`
          @media (max-width: 639px) and (min-height: 540px) {
            .solo-finish-screen-card {
              max-height: ${ demoMode ? 'calc(100dvh - 108px)' : playtestMode ? 'calc(100dvh - 2rem)' : 'calc(100dvh - 4.5rem)' } !important;
              overflow: hidden !important;
              padding: 0.6rem 0.75rem !important;
              margin: 0 auto !important;
            }
            .solo-finish-screen-card [data-testid="solo-finish-top-summary"] h2 {
              font-size: 1.02rem !important;
            }
            .solo-finish-screen-card [data-testid="playtest-mode-banner"] {
              padding: 0.28rem 0.55rem !important;
              margin-bottom: 0.35rem !important;
              font-size: 0.72rem !important;
            }
            .solo-finish-screen-card [data-testid="solo-result-evaluation"] {
              padding: 0.35rem 0.6rem !important;
              margin-bottom: 0.38rem !important;
            }
            .solo-finish-score-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
              gap: 0.35rem !important;
              margin-bottom: 0.4rem !important;
            }
            .solo-finish-score-grid > div {
              padding: 0.32rem 0.4rem !important;
            }
            .solo-finish-screen-card [data-testid="solo-result-question-review"] {
              margin-bottom: 0.4rem !important;
              padding: 0.45rem 0.6rem !important;
              flex: 1 1 auto !important;
              min-height: 110px !important;
            }
            .solo-finish-review-scroll {
              flex: 1 1 auto !important;
              min-height: 0 !important;
              max-height: none !important;
              overflow-y: auto !important;
            }
            .solo-finish-screen-card [data-testid="solo-finish-actions-bar"] {
              gap: 0.4rem !important;
              padding-top: 0.1rem !important;
            }
            .solo-finish-screen-card [data-testid="solo-finish-actions-bar"] button {
              min-height: 36px !important;
              padding: 0.35rem 0.75rem !important;
              font-size: 0.78rem !important;
            }
          }
          @media (max-height: 539px) {
            .solo-finish-screen-card {
              max-height: none !important;
              overflow: visible !important;
              padding: 0.75rem 0.85rem !important;
              margin: 0.25rem auto !important;
            }
            .solo-finish-review-scroll {
              max-height: 52dvh !important;
            }
            .solo-finish-score-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
              gap: 0.4rem !important;
            }
          }
        `}</style>
        {inlineEditModalNode}

        {/* VÙNG TRÊN: Tiêu đề, đánh giá kết quả, điểm, số câu đúng, tỷ lệ đúng (Thiết kế gọn, cố định) */}
        <div
          data-testid="solo-finish-top-summary"
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginBottom: '0.5rem',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: '1 1 240px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--accent-amber)',
                  color: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <TrophyIcon size={22} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1.22rem', fontWeight: 900, lineHeight: 1.2 }}>
                  {demoMode
                    ? 'Hoàn Thành Bản Demo!'
                    : playtestMode
                      ? 'Hoàn Thành Chơi Thử!'
                      : isExamMode
                        ? 'Hoàn Thành Bài Thi!'
                        : 'Hoàn Thành Trận Đấu!'}
                </h2>
                <p
                  style={{
                    margin: '0.1rem 0 0 0',
                    color: 'var(--text-secondary)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeGameSpec?.title || finalResult.title}
                </p>
              </div>
            </div>

            {perfEval.isPassed !== null && (
              <span
                data-testid="exam-pass-status-badge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.24rem 0.75rem',
                  borderRadius: '999px',
                  fontSize: '0.76rem',
                  fontWeight: 900,
                  backgroundColor: perfEval.isPassed
                    ? 'rgba(16, 185, 129, 0.16)'
                    : 'rgba(239, 68, 68, 0.16)',
                  border: `1.5px solid ${
                    perfEval.isPassed ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                  }`,
                  color: perfEval.isPassed ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                  flexShrink: 0,
                }}
              >
                {perfEval.isPassed ? '✓ ĐẠT YÊU CẦU' : '✕ CHƯA ĐẠT'} (Ngưỡng {perfEval.passThresholdPercent}%)
              </span>
            )}
          </div>

          {(examClosedByBtc || (finalResult as any)?.examStatus === 'CLOSED') && (
            <div
              data-testid="solo-exam-closed-banner"
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                border: '1.5px solid rgba(245, 158, 11, 0.45)',
                color: 'var(--text-primary)',
                fontSize: '0.78rem',
                fontWeight: 800,
                marginBottom: '0.5rem',
              }}
            >
              Đợt thi đã kết thúc — Hệ thống đã tự động ghi nhận và chấm điểm các câu bạn đã hoàn thành.
            </div>
          )}

          {finishPlaytestBanner}

          {/* Unified 4-Tier Evaluation Card + 3 Score Cards */}
          <div
            data-testid="solo-result-evaluation"
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '11px',
              backgroundColor: 'var(--bg-input)',
              border: '1.5px solid var(--primary)',
              marginBottom: '0.55rem',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.25rem 0.75rem',
            }}
          >
            <div
              data-testid="result-tier-label"
              style={{ fontSize: '0.88rem', fontWeight: 900, color: 'var(--primary)' }}
            >
              Mức đánh giá: {perfEval.tierLabel} ({perfEval.accuracyPercentage}%)
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.35,
              }}
            >
              {perfEval.comment}
            </div>
          </div>

          {/* Score cards */}
          <div
            className="solo-finish-score-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '0.55rem',
              marginBottom: '0.6rem',
            }}
          >
            <div
              style={{
                padding: '0.5rem 0.65rem',
                borderRadius: '11px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 800, marginBottom: '0.1rem' }}>
                ĐIỂM ĐẠT / TỐI ĐA
              </div>
              <div
                data-testid="solo-result-score-ratio"
                style={{ fontSize: '1.08rem', fontWeight: 900, color: 'var(--primary)', lineHeight: 1.2 }}
              >
                {totalPts.toLocaleString()} / {maxScore.toLocaleString()}
              </div>
            </div>

            <div
              style={{
                padding: '0.5rem 0.65rem',
                borderRadius: '11px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 800, marginBottom: '0.1rem' }}>
                SỐ CÂU ĐÚNG
              </div>
              <div
                data-testid="solo-result-correct-ratio"
                style={{ fontSize: '1.08rem', fontWeight: 900, color: 'var(--accent-emerald)', lineHeight: 1.2 }}
              >
                {correctCount} / {finalResult.totalQuestions}
              </div>
            </div>

            <div
              style={{
                padding: '0.5rem 0.65rem',
                borderRadius: '11px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 800, marginBottom: '0.1rem' }}>
                TỶ LỆ ĐÚNG
              </div>
              <div
                data-testid="solo-result-accuracy"
                style={{ fontSize: '1.08rem', fontWeight: 900, color: '#f59e0b', lineHeight: 1.2 }}
              >
                {perfEval.accuracyPercentage}%
              </div>
            </div>
          </div>
        </div>

        {/* VÙNG GIỮA: Danh sách chi tiết đáp án & giải thích (Khu vực cuộn dọc chính: flex: 1, min-height: 0, overflow-y: auto) */}
        {(() => {
          const canShowResultAnswers =
            playtestMode ||
            (isExamMode &&
              (Boolean(finalResult.canRevealAnswers) ||
                Boolean(finalResult.answersPublished) ||
                effectiveExamRevealPolicy === 'IMMEDIATE' ||
                effectiveExamRevealPolicy === 'AFTER_SUBMIT'));
          const qResults = Array.isArray(finalResult.questionResults)
            ? finalResult.questionResults
            : [];

          if (canShowResultAnswers && qResults.length > 0) {
            return (
              <div
                data-testid="solo-result-question-review"
                style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  textAlign: 'left',
                  marginBottom: '0.65rem',
                  padding: '0.65rem 0.8rem',
                  borderRadius: '13px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    fontSize: '0.84rem',
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>Chi tiết đáp án từng câu ({qResults.length} câu)</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-emerald)', fontWeight: 800 }}>
                    Đã hiển thị đáp án
                  </span>
                </div>
                <div
                  data-testid="solo-result-review-scroll-list"
                  className="solo-finish-review-scroll"
                  style={{
                    flex: '1 1 auto',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.55rem',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    scrollbarGutter: 'stable',
                    paddingRight: '0.25rem',
                  }}
                >
                  {qResults.map((qr, idx) => {
                    const specQ =
                      activeGameSpec?.questions?.find((item) => item.id === qr.questionId) ||
                      activeGameSpec?.questions?.[idx];
                    const isRight = Boolean(qr.isCorrect);
                    const isTimedOutItem = Boolean(qr.timedOut);
                    return (
                      <div
                        key={qr.questionId || idx}
                        data-testid={`solo-result-review-item-${idx}`}
                        style={{
                          flexShrink: 0,
                          padding: '0.65rem 0.85rem',
                          borderRadius: '11px',
                          backgroundColor: 'var(--bg-surface)',
                          border: `1.5px solid ${
                            isRight ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)'
                          }`,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                            marginBottom: '0.3rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', fontWeight: 900, color: 'var(--text-secondary)' }}>
                            Câu #{idx + 1}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span
                              data-testid={`solo-result-review-status-${idx}`}
                              style={{
                                padding: '0.14rem 0.48rem',
                                borderRadius: '999px',
                                fontSize: '0.7rem',
                                fontWeight: 900,
                                backgroundColor: isRight
                                  ? 'rgba(16, 185, 129, 0.16)'
                                  : 'rgba(239, 68, 68, 0.16)',
                                color: isRight ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                              }}
                            >
                              {isRight
                                ? `✓ Trả lời đúng (+${qr.pointsEarned ?? 0}đ)`
                                : isTimedOutItem
                                  ? '⏰ Hết thời gian (+0đ)'
                                  : '✕ Trả lời sai (+0đ)'}
                            </span>
                            {playtestMode && !demoMode && (
                              <button
                                type="button"
                                data-testid={`playtest-finish-edit-q-${idx}`}
                                onClick={() => handleOpenInlineEditor(idx)}
                                style={{
                                  padding: '0.16rem 0.5rem',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-strong)',
                                  backgroundColor: 'var(--bg-input)',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.7rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                ✎ Sửa câu này
                              </button>
                            )}
                          </div>
                        </div>
                        {specQ?.question && (
                          <div
                            style={{
                              fontSize: '0.85rem',
                              fontWeight: 800,
                              color: 'var(--text-primary)',
                              marginBottom: '0.28rem',
                              lineHeight: 1.4,
                            }}
                          >
                            {specQ.question}
                          </div>
                        )}
                        <div style={{ fontSize: '0.79rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                          <div>
                            Câu trả lời của bạn:{' '}
                            <strong style={{ color: isRight ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                              {isTimedOutItem || !qr.answer ? 'Chưa trả lời (Hết thời gian)' : qr.answer}
                            </strong>
                          </div>
                          {qr.correctAnswer && (
                            <div style={{ marginTop: '0.12rem' }}>
                              Đáp án chính xác:{' '}
                              <strong style={{ color: 'var(--accent-emerald)' }}>{qr.correctAnswer}</strong>
                            </div>
                          )}
                          {typeof qr.explanation === 'string' && qr.explanation.trim().length > 0 && (
                            <div
                              data-testid={`solo-result-review-explanation-${idx}`}
                              style={{
                                marginTop: '0.25rem',
                                paddingTop: '0.25rem',
                                borderTop: '1px dashed var(--border-subtle)',
                                color: 'var(--text-secondary)',
                                wordBreak: 'break-word',
                              }}
                            >
                              Giải thích: {qr.explanation.trim()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (isExamMode && !canShowResultAnswers) {
            return (
              <div
                data-testid="solo-result-answers-pending-publish"
                style={{
                  flexShrink: 0,
                  marginBottom: '0.65rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  border: '1.5px solid rgba(56, 189, 248, 0.4)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  lineHeight: 1.45,
                }}
              >
                🔒 Chế độ Thi bảo mật đáp án: Chi tiết đúng/sai từng câu, đáp án chính xác và lời giải thích sẽ được hiển thị sau khi người tạo chính thức công bố đáp án.
              </div>
            );
          }

          return null;
        })()}

        {/* VÙNG DƯỚI: Thanh nút hành động luôn nhìn thấy (flex-shrink: 0) */}
        <div
          data-testid="solo-finish-actions-bar"
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: '0.65rem',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingTop: '0.15rem',
          }}
        >
          {demoMode && onCreateThisGameType && activeGameSpec && (
            <button
              type="button"
              data-testid="demo-finish-create-btn"
              onClick={() => onCreateThisGameType(activeGameSpec.gameType)}
              style={{
                minHeight: '42px',
                padding: '0.55rem 1.2rem',
                borderRadius: '11px',
                border: 'none',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)',
              }}
            >
              <span>✨ Tạo game loại này</span>
            </button>
          )}

          {playtestMode && !demoMode && (activeGameSpec?.questions?.length || 0) > 0 && (
            <button
              type="button"
              data-testid="playtest-back-to-questions-btn"
              onClick={() => {
                if (!activeGameSpec) return;
                setFinalResult(null);
                const lastIdx = Math.max(0, (activeGameSpec.questions?.length || 1) - 1);
                loadPlaytestQuestionAtIndex(activeGameSpec, lastIdx);
              }}
              style={{
                minHeight: '42px',
                padding: '0.55rem 1.1rem',
                borderRadius: '11px',
                border: '1.5px solid var(--primary)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--primary)',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
              }}
            >
              ← Quay lại xem các câu
            </button>
          )}

          {(!isExamMode || playtestMode) && activeGameSpec?.settings?.allowReplay !== false && (
            <button
              type="button"
              data-testid="solo-replay-btn"
              onClick={() => initializeSession('RESTART')}
              style={{
                minHeight: '42px',
                padding: '0.55rem 1.2rem',
                borderRadius: '11px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink)',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 0 14px var(--primary-subtle)',
              }}
            >
              <RefreshIcon size={16} />
              <span>{demoMode ? 'Chơi lại Demo' : 'Chơi Lại Trận Này'}</span>
            </button>
          )}

          <button
            type="button"
            data-testid="exit-playtest-btn"
            onClick={handleLeave}
            style={{
              minHeight: '42px',
              padding: '0.55rem 1.2rem',
              borderRadius: '11px',
              border: '1.5px solid var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.86rem',
              cursor: 'pointer',
            }}
          >
            {demoMode ? 'Đóng demo' : playtestMode ? 'Thoát chơi thử' : 'Rời Khỏi'}
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE QUESTION SCREEN
  if (!currentQuestion) return null;

  const isLastQuestion = currentQuestion.questionIndex + 1 >= currentQuestion.totalQuestions;
  const hasAnsweredOrTimedOut = Boolean(questionFeedback) || isQuestionTimedOut;
  const questionPhase: 'ANSWERING' | 'RESULT' = hasAnsweredOrTimedOut ? 'RESULT' : 'ANSWERING';
  const questionTypeLabel =
    QUESTION_TYPE_LABELS[currentQuestion.type] || currentQuestion.type;

  return (
    <div
      data-testid="solo-active-question-screen"
      data-advance-policy={questionAdvancePolicy}
      data-question-phase={questionPhase}
      style={{
        maxWidth: '880px',
        width: '100%',
        margin: '0 auto',
        padding: '0.6rem 0.85rem 0.85rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        boxSizing: 'border-box',
      }}
    >
      {inlineEditModalNode}

      {/* Unified Compact Single-Row Header Bar (Identical across Playtest, Demo, and Real Solo Play) */}
      <div
        data-testid={playtestMode ? 'playtest-mode-banner' : 'solo-active-top-bar'}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.45rem 0.65rem',
          padding: '0.5rem 0.85rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          {playtestMode ? (
            <span
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '999px',
                backgroundColor: demoMode ? '#10b981' : 'var(--primary)',
                color: '#ffffff',
                fontSize: '0.68rem',
                fontWeight: 900,
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
              }}
            >
              {demoMode ? 'XEM DEMO' : 'CHƠI THỬ'}
            </span>
          ) : isExamMode ? (
            <span
              data-testid="solo-exam-mode-badge"
              style={{
                fontWeight: 900,
                fontSize: '0.68rem',
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                padding: '0.18rem 0.55rem',
                borderRadius: '999px',
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
              }}
            >
              CHẾ ĐỘ THI
            </span>
          ) : (
            <span
              data-testid="solo-play-mode-badge"
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '999px',
                backgroundColor: 'rgba(99, 102, 241, 0.14)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                color: 'var(--primary)',
                fontSize: '0.68rem',
                fontWeight: 900,
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
              }}
            >
              CHƠI ĐƠN
            </span>
          )}

          <span
            data-testid="solo-question-progress-pill"
            style={{
              fontWeight: 800,
              fontSize: '0.84rem',
              color: 'var(--primary)',
              backgroundColor: 'rgba(99, 102, 241, 0.12)',
              padding: '0.2rem 0.6rem',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            Câu {currentQuestion.questionIndex + 1} / {currentQuestion.totalQuestions}
          </span>

          <span
            data-testid="question-type-badge"
            style={{
              fontWeight: 700,
              fontSize: '0.73rem',
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              padding: '0.18rem 0.5rem',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            {questionTypeLabel}
          </span>

          {playtestMode && isExamMode && (
            <span
              data-testid="solo-exam-mode-badge"
              style={{
                fontWeight: 900,
                fontSize: '0.68rem',
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                padding: '0.16rem 0.45rem',
                borderRadius: '999px',
                whiteSpace: 'nowrap',
              }}
            >
              CHẾ ĐỘ THI
            </span>
          )}

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.28rem',
              fontSize: '0.84rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              padding: '0.18rem 0.5rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <StarIcon size={14} style={{ color: '#f59e0b' }} />
            <span>{playerScore.toLocaleString()} đ</span>
          </div>

          {playerStreak > 1 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.2rem',
                fontSize: '0.74rem',
                fontWeight: 800,
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                padding: '0.16rem 0.45rem',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
              }}
            >
              <FlameIcon size={13} />
              <span>x{playerStreak}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          {/* Audio Mute & Volume Controls */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.18rem 0.45rem',
              borderRadius: '9px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              data-testid="audio-mute-toggle-btn"
              aria-pressed={audioMuted}
              data-muted={audioMuted ? 'true' : 'false'}
              onClick={handleToggleAudioMute}
              title={audioMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
              style={{
                border: 'none',
                background: 'transparent',
                color: audioMuted ? 'var(--text-muted)' : 'var(--primary)',
                fontWeight: 800,
                fontSize: '0.76rem',
                cursor: 'pointer',
                padding: '0.1rem 0.18rem',
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
                width: '48px',
                height: '5px',
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
              gap: '0.28rem',
              padding: '0.22rem 0.65rem',
              borderRadius: '999px',
              backgroundColor:
                hasAnsweredOrTimedOut
                  ? 'var(--bg-input)'
                  : timeLeft <= 5
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'var(--bg-input)',
              color:
                hasAnsweredOrTimedOut
                  ? 'var(--text-secondary)'
                  : timeLeft <= 5
                    ? 'var(--accent-rose)'
                    : 'var(--text-primary)',
              border: `1.5px solid ${
                !hasAnsweredOrTimedOut && timeLeft <= 5
                  ? 'var(--accent-rose)'
                  : 'var(--border-strong)'
              }`,
              fontWeight: 900,
              fontSize: '0.86rem',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            <ClockIcon size={13} />
            <span>{timeLeft}s</span>
          </div>

          {/* Single Leave / Exit Button */}
          <button
            type="button"
            data-testid="exit-playtest-btn"
            onClick={handleLeave}
            title={demoMode ? 'Đóng demo' : playtestMode ? 'Thoát chơi thử' : 'Thoát trận đấu'}
            style={{
              minHeight: '32px',
              padding: '0.26rem 0.65rem',
              borderRadius: '9px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.78rem',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            <XMarkIcon size={13} />
            <span>{demoMode ? 'Đóng demo' : playtestMode ? 'Thoát chơi thử' : 'Thoát'}</span>
          </button>
        </div>
      </div>

      {/* Optional Demo How-to-Play Guide Banner */}
      {demoMode && demoGuideText && (
        <div
          data-testid="demo-how-to-play-guide"
          style={{
            padding: '0.45rem 0.85rem',
            borderRadius: '11px',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--text-secondary)',
            fontSize: '0.79rem',
            fontWeight: 700,
            lineHeight: 1.4,
          }}
        >
          <strong style={{ color: 'var(--accent-emerald)' }}>💡 Hướng dẫn cách chơi:</strong>{' '}
          {demoGuideText}
        </div>
      )}

      {/* Question & Answer / Result Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '18px',
          padding: '1.15rem 1.35rem',
          boxShadow: 'var(--card-shadow)',
          textAlign: 'center',
        }}
      >
        <h2
          data-testid="solo-active-question-text"
          style={{
            fontSize: 'clamp(1.05rem, 1.9vw, 1.32rem)',
            fontWeight: 800,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            margin: '0 auto 0.9rem auto',
            maxWidth: '760px',
            wordBreak: 'break-word',
          }}
        >
          {currentQuestion.question}
        </h2>

        {/* FEEDBACK STATE: Clean Modern Hierarchy without nested heavy green/red boxes */}
        {questionFeedback ? (
          <div
            data-testid="solo-question-feedback"
            style={{
              padding: '0.95rem 1.15rem',
              borderRadius: '14px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderLeft: `4px solid ${
                isExamUnpublished
                  ? '#38bdf8'
                  : questionFeedback.isCorrect
                    ? 'var(--accent-emerald)'
                    : 'var(--accent-rose)'
              }`,
              textAlign: 'left',
              animation: 'popIn 0.2s ease',
            }}
          >
            {isExamUnpublished ? (
              <div data-testid="exam-feedback-recorded" style={{ textAlign: 'center', padding: '0.35rem 0' }}>
                <div
                  style={{
                    fontSize: '1.08rem',
                    fontWeight: 900,
                    color: '#0284c7',
                    marginBottom: '0.35rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.45rem',
                  }}
                >
                  {questionFeedback.timedOut ? (
                    <>
                      <ClockIcon size={20} />
                      <span>Hết thời gian trả lời — Đã ghi nhận tự động (+0 điểm)</span>
                    </>
                  ) : (
                    <>
                      <CheckIcon size={20} />
                      <span>Đã ghi nhận câu trả lời của bạn</span>
                    </>
                  )}
                </div>
                <p
                  style={{
                    margin: '0.2rem auto 0 auto',
                    fontSize: '0.84rem',
                    color: 'var(--text-secondary)',
                    maxWidth: '540px',
                  }}
                >
                  Chế độ Thi nghiêm túc: Đáp án và giải thích được bảo mật cho đến khi kết thúc kỳ thi.
                </p>
              </div>
            ) : (
              <>
                {/* 1. Status, Points & Creator Retest Header Row */}
                <div
                  data-testid="solo-feedback-status-banner"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                    paddingBottom: '0.6rem',
                    marginBottom: '0.6rem',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      fontSize: '1.05rem',
                      fontWeight: 900,
                      color: questionFeedback.isCorrect
                        ? 'var(--accent-emerald)'
                        : 'var(--accent-rose)',
                    }}
                  >
                    <span
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '8px',
                        backgroundColor: questionFeedback.isCorrect
                          ? 'rgba(16, 185, 129, 0.16)'
                          : 'rgba(239, 68, 68, 0.16)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {questionFeedback.isCorrect ? (
                        <CheckIcon size={16} />
                      ) : questionFeedback.timedOut ? (
                        <ClockIcon size={16} />
                      ) : (
                        <XMarkIcon size={16} />
                      )}
                    </span>
                    <span>
                      {questionFeedback.isCorrect
                        ? `Chính Xác! Trả lời đúng (+${questionFeedback.pointsEarned} điểm)`
                        : questionFeedback.timedOut
                          ? 'Hết Thời Gian Trả Lời! (+0 điểm)'
                          : 'Chưa Đúng! Trả lời sai (+0 điểm)'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span
                      data-testid="solo-feedback-points-pill"
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        fontSize: '0.78rem',
                        fontWeight: 900,
                        backgroundColor: questionFeedback.isCorrect
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'var(--bg-surface)',
                        border: `1px solid ${
                          questionFeedback.isCorrect
                            ? 'rgba(16, 185, 129, 0.4)'
                            : 'var(--border-subtle)'
                        }`,
                        color: questionFeedback.isCorrect
                          ? 'var(--accent-emerald)'
                          : 'var(--text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      +{questionFeedback.pointsEarned ?? 0} điểm
                    </span>

                    {playtestMode && !demoMode && (
                      <button
                        type="button"
                        data-testid="playtest-retest-question-btn"
                        onClick={handleRetestCurrentQuestion}
                        title="Làm lại câu hỏi này để kiểm thử đáp án khác"
                        style={{
                          padding: '0.24rem 0.68rem',
                          borderRadius: '999px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        ↻ Kiểm thử lại câu này
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Correct Answer & User Selected Answer Comparison Strip */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                    marginBottom: '0.6rem',
                  }}
                >
                  {!questionFeedback.isCorrect &&
                    !questionFeedback.timedOut &&
                    (questionFeedback.answer || selectedChoice || textAnswerInput) && (
                      <div
                        data-testid="solo-feedback-user-answer"
                        style={{
                          margin: 0,
                          padding: '0.32rem 0.7rem',
                          borderRadius: '9px',
                          backgroundColor: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.28)',
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Câu trả lời của bạn:{' '}
                        <strong style={{ color: 'var(--accent-rose)', fontWeight: 800 }}>
                          {questionFeedback.answer || selectedChoice || textAnswerInput}
                        </strong>
                      </div>
                    )}

                  {questionFeedback.correctAnswer && (
                    <div
                      data-testid="solo-feedback-correct-answer"
                      style={{
                        margin: 0,
                        padding: '0.32rem 0.7rem',
                        borderRadius: '9px',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.28)',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Đáp án chính xác:{' '}
                      <strong style={{ color: 'var(--accent-emerald)', fontWeight: 800 }}>
                        {questionFeedback.correctAnswer}
                      </strong>
                    </div>
                  )}
                </div>

                {/* Balanced 2x2 Choice Review Grid for choice-based questions */}
                {(currentQuestion.type === 'MULTIPLE_CHOICE' ||
                  currentQuestion.type === 'QUIZ' ||
                  currentQuestion.type === 'QUICK_BUTTON' ||
                  currentQuestion.type === 'TRUE_FALSE') &&
                  (() => {
                    const effectiveChoices =
                      Array.isArray(currentQuestion.choices) && currentQuestion.choices.length > 0
                        ? currentQuestion.choices
                        : currentQuestion.type === 'QUICK_BUTTON' || currentQuestion.type === 'TRUE_FALSE'
                          ? ['Đúng', 'Sai']
                          : [];
                    if (effectiveChoices.length === 0) return null;
                    const submittedText = questionFeedback.answer || selectedChoice || '';
                    return (
                      <div
                        data-testid="solo-feedback-choices-grid"
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            currentQuestion.type === 'QUICK_BUTTON' || currentQuestion.type === 'TRUE_FALSE'
                              ? '1fr 1fr'
                              : 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
                          gap: '0.5rem',
                          marginBottom: '0.55rem',
                          textAlign: 'left',
                        }}
                      >
                        {effectiveChoices.map((opt, idx) => {
                          const isCorrectOption = doesChoiceMatchTarget(
                            opt,
                            questionFeedback.correctAnswer,
                            idx,
                            currentQuestion.type
                          );
                          const isSelectedWrongOption =
                            !questionFeedback.isCorrect &&
                            !questionFeedback.timedOut &&
                            Boolean(submittedText) &&
                            doesChoiceMatchTarget(opt, submittedText, idx, currentQuestion.type);
                          const optionLetter = ['A', 'B', 'C', 'D'][idx] || String(idx + 1);

                          return (
                            <div
                              key={idx}
                              data-testid={
                                isCorrectOption
                                  ? `solo-choice-feedback-correct-${idx}`
                                  : isSelectedWrongOption
                                    ? `solo-choice-feedback-wrong-${idx}`
                                    : `solo-choice-feedback-neutral-${idx}`
                              }
                              data-feedback-state={
                                isCorrectOption
                                  ? 'correct'
                                  : isSelectedWrongOption
                                    ? 'wrong'
                                    : 'neutral'
                              }
                              style={{
                                padding: '0.55rem 0.8rem',
                                borderRadius: '11px',
                                backgroundColor: isCorrectOption
                                  ? 'rgba(16, 185, 129, 0.13)'
                                  : isSelectedWrongOption
                                    ? 'rgba(239, 68, 68, 0.13)'
                                    : 'var(--bg-surface)',
                                border: isCorrectOption
                                  ? '1.5px solid var(--accent-emerald)'
                                  : isSelectedWrongOption
                                    ? '1.5px solid var(--accent-rose)'
                                    : '1px solid var(--border-subtle)',
                                color:
                                  isCorrectOption || isSelectedWrongOption
                                    ? 'var(--text-primary)'
                                    : 'var(--text-secondary)',
                                fontWeight: isCorrectOption || isSelectedWrongOption ? 800 : 600,
                                fontSize: '0.86rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.5rem',
                                opacity: isCorrectOption || isSelectedWrongOption ? 1 : 0.72,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                                <span
                                  style={{
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '6px',
                                    backgroundColor: isCorrectOption
                                      ? 'var(--accent-emerald)'
                                      : isSelectedWrongOption
                                        ? 'var(--accent-rose)'
                                        : 'var(--bg-input)',
                                    color:
                                      isCorrectOption || isSelectedWrongOption
                                        ? '#ffffff'
                                        : 'var(--text-secondary)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.74rem',
                                    fontWeight: 900,
                                    flexShrink: 0,
                                  }}
                                >
                                  {optionLetter}
                                </span>
                                <span style={{ wordBreak: 'break-word', lineHeight: 1.35 }}>{opt}</span>
                              </div>
                              {isCorrectOption && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    fontSize: '0.7rem',
                                    fontWeight: 900,
                                    padding: '0.14rem 0.48rem',
                                    borderRadius: '999px',
                                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                                    color: 'var(--accent-emerald)',
                                  }}
                                >
                                  ✓ Đúng
                                </span>
                              )}
                              {isSelectedWrongOption && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    fontSize: '0.7rem',
                                    fontWeight: 900,
                                    padding: '0.14rem 0.48rem',
                                    borderRadius: '999px',
                                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                    color: 'var(--accent-rose)',
                                  }}
                                >
                                  ✕ Bạn chọn
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                {/* 3. Explanation (Clean readable card, scrollable internally if very long) */}
                {typeof questionFeedback.explanation === 'string' &&
                  questionFeedback.explanation.trim().length > 0 && (
                    <div
                      data-testid="solo-feedback-explanation"
                      style={{
                        marginTop: '0.35rem',
                        padding: '0.6rem 0.85rem',
                        borderRadius: '10px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderLeft: '3px solid var(--primary)',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                        maxHeight: '100px',
                        overflowY: 'auto',
                        textAlign: 'left',
                      }}
                    >
                      <strong style={{ color: 'var(--text-primary)' }}>💡 Giải thích:</strong>{' '}
                      {questionFeedback.explanation.trim()}
                    </div>
                  )}
              </>
            )}
          </div>
        ) : isQuestionTimedOut ? (
          <div
            data-testid="solo-timeout-banner"
            style={{
              padding: '1rem 1.15rem',
              borderRadius: '14px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderLeft: '4px solid var(--accent-rose)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div
              style={{
                fontSize: '1.1rem',
                fontWeight: 900,
                color: 'var(--accent-rose)',
                marginBottom: '0.35rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
              }}
            >
              <ClockIcon size={20} />
              <span>Hết Thời Gian Trả Lời! (+0 điểm)</span>
            </div>
            <p
              style={{
                margin: '0.2rem auto 0 auto',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                maxWidth: '560px',
              }}
            >
              Thời gian cho câu hỏi này đã kết thúc. Bấm "Câu tiếp theo →" ở thanh điều hướng bên dưới để tiếp tục.
            </p>
          </div>
        ) : (
          /* ACTIVE ANSWER INPUT / OPTIONS */
          <div>
            {/* MULTIPLE CHOICE / CHOICES — Balanced 2x2 Grid on Laptop/Desktop */}
            {(currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'QUIZ') && currentQuestion.choices && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))',
                  gap: '0.7rem',
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
                      data-testid={`solo-choice-btn-${idx}`}
                      disabled={isSubmitting}
                      onClick={() => {
                        soundManager.playSelect();
                        setSelectedChoice(opt);
                        handleSubmitAnswer(opt);
                      }}
                      className="k-btn"
                      style={{
                        padding: '0.85rem 1.05rem',
                        minHeight: '58px',
                        borderRadius: '14px',
                        border: isSelected ? '3px solid #ffffff' : 'none',
                        backgroundColor: cfg.bg,
                        color: cfg.text,
                        fontWeight: 900,
                        fontSize: '0.98rem',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        gap: '0.75rem',
                        boxShadow: isSelected
                          ? `0 2px 0 ${cfg.dark}`
                          : `0 4px 0 ${cfg.dark}`,
                        transform: isSelected ? 'translateY(3px)' : 'none',
                        transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                      }}
                    >
                      <span
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '9px',
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '0.98rem',
                          flexShrink: 0,
                        }}
                      >
                        {cfg.icon}
                      </span>
                      <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.38 }}>{opt}</span>
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
                  gap: playtestMode ? '1rem' : '1.5rem',
                  maxWidth: '540px',
                  margin: '0 auto',
                }}
              >
                <button
                  type="button"
                  data-testid="solo-quick-true-btn"
                  disabled={isSubmitting}
                  onClick={() => {
                    soundManager.playSelect();
                    handleSubmitAnswer(currentQuestion.choices?.[0] || 'Đúng');
                  }}
                  className="k-btn k-btn-green"
                  style={{
                    minHeight: playtestMode ? '60px' : '74px',
                    borderRadius: '16px',
                    border: 'none',
                    fontWeight: 900,
                    fontSize: playtestMode ? '1.2rem' : '1.35rem',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.6rem',
                  }}
                >
                  <CheckIcon size={24} />
                  <span>{currentQuestion.choices?.[0] || 'ĐÚNG'}</span>
                </button>
                <button
                  type="button"
                  data-testid="solo-quick-false-btn"
                  disabled={isSubmitting}
                  onClick={() => {
                    soundManager.playSelect();
                    handleSubmitAnswer(currentQuestion.choices?.[1] || 'Sai');
                  }}
                  className="k-btn k-btn-red"
                  style={{
                    minHeight: playtestMode ? '60px' : '74px',
                    borderRadius: '16px',
                    border: 'none',
                    fontWeight: 900,
                    fontSize: playtestMode ? '1.2rem' : '1.35rem',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.6rem',
                  }}
                >
                  <XMarkIcon size={24} />
                  <span>{currentQuestion.choices?.[1] || 'SAI'}</span>
                </button>
              </div>
            )}

            {/* FILL IN THE BLANK / CROSSWORD / TEXT */}
            {currentQuestion.type === 'PUZZLE' && (
              <div style={{ maxWidth: '580px', margin: '0 auto', textAlign: 'left' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.55rem', textAlign: 'center' }}>
                  Sắp xếp các bước dưới đây theo đúng thứ tự từ trên xuống dưới:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  {puzzleOrder.map((item, idx) => (
                    <div
                      key={`${idx}_${item}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.65rem',
                        padding: playtestMode ? '0.65rem 0.85rem' : '0.85rem 1rem',
                        borderRadius: '12px',
                        backgroundColor: 'var(--bg-input)',
                        border: '1.5px solid var(--border-strong)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--primary)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '0.84rem',
                          flexShrink: 0,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span style={{ flex: 1, fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                        {item}
                      </span>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          type="button"
                          disabled={isSubmitting || idx === 0}
                          onClick={() => {
                            soundManager.playSelect();
                            handleMovePuzzleItem(idx, -1);
                          }}
                          style={{
                            width: '32px',
                            height: '32px',
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
                          onClick={() => {
                            soundManager.playSelect();
                            handleMovePuzzleItem(idx, 1);
                          }}
                          style={{
                            width: '32px',
                            height: '32px',
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
                  data-testid="solo-puzzle-submit-btn"
                  disabled={isSubmitting || puzzleOrder.length === 0}
                  onClick={() => {
                    soundManager.playSelect();
                    handleSubmitAnswer(puzzleOrder.join(' | '));
                  }}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '0.7rem 1.25rem',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: '0.94rem',
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
                    data-testid="solo-slider-submit-btn"
                    disabled={isSubmitting || !sliderTouched}
                    onClick={() => {
                      if (!sliderTouched) {
                        toast.warning('Vui lòng kéo thanh trượt hoặc chọn một mức giá trị trước khi xác nhận.', 'Chưa chọn giá trị');
                        return;
                      }
                      soundManager.playSelect();
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

      {/* 4. Unified Bottom Question Navigation & Action Bar (Shared across Playtest, Demo, and Real Solo Play) */}
      <div
        data-testid="playtest-question-nav-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.55rem',
          padding: '0.6rem 0.95rem',
          borderRadius: '14px',
          backgroundColor: 'var(--bg-surface)',
          border: '1.5px solid var(--border-strong)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Left: Previous Question (Playtest / Demo) or Question Progress Status (Real Solo Play) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {playtestMode ? (
            <button
              type="button"
              data-testid="playtest-prev-question-btn"
              disabled={currentQuestion.questionIndex <= 0}
              onClick={handlePrevQuestion}
              style={{
                minHeight: '38px',
                padding: '0.4rem 0.85rem',
                borderRadius: '10px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color:
                  currentQuestion.questionIndex <= 0
                    ? 'var(--text-muted)'
                    : 'var(--text-primary)',
                fontWeight: 800,
                fontSize: '0.84rem',
                cursor: currentQuestion.questionIndex <= 0 ? 'not-allowed' : 'pointer',
                opacity: currentQuestion.questionIndex <= 0 ? 0.5 : 1,
              }}
            >
              ← Câu trước
            </button>
          ) : (
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: hasAnsweredOrTimedOut ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                padding: '0.32rem 0.7rem',
                borderRadius: '8px',
                backgroundColor: hasAnsweredOrTimedOut
                  ? 'rgba(16, 185, 129, 0.1)'
                  : 'var(--bg-input)',
              }}
            >
              {hasAnsweredOrTimedOut
                ? '✓ Đã ghi nhận kết quả câu này'
                : '⏳ Chọn hoặc gửi đáp án trước khi hết giờ'}
            </span>
          )}
        </div>

        {/* Center: Question Indicator + Edit Action (Creator Playtest only) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <span
            data-testid="playtest-nav-counter"
            style={{
              fontSize: '0.85rem',
              fontWeight: 900,
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            Câu {currentQuestion.questionIndex + 1} / {currentQuestion.totalQuestions}
          </span>

          {playtestMode && isReviewingPreviousAnswer && (
            <span
              data-testid="playtest-reviewing-prev-badge"
              style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '0.16rem 0.5rem',
                borderRadius: '999px',
                backgroundColor: 'rgba(99, 102, 241, 0.12)',
                color: 'var(--primary)',
              }}
            >
              Đã trả lời
            </span>
          )}

          {playtestMode && !demoMode && (
            <button
              type="button"
              data-testid="playtest-inline-edit-btn"
              onClick={() => handleOpenInlineEditor(currentQuestion.questionIndex)}
              style={{
                minHeight: '36px',
                padding: '0.35rem 0.8rem',
                borderRadius: '9px',
                border: '1.5px solid var(--primary)',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                color: 'var(--primary)',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <span>✎ Chỉnh sửa câu này</span>
            </button>
          )}
        </div>

        {/* Right: Manual Next Question Button (Shared across Playtest, Demo, and Real Solo Play) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {hasAnsweredOrTimedOut ? (
            <button
              type="button"
              data-testid="solo-next-question-btn"
              disabled={isLoading}
              onClick={handleNextQuestion}
              style={{
                minHeight: '40px',
                padding: '0.45rem 1.2rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink)',
                fontWeight: 900,
                fontSize: '0.88rem',
                cursor: isLoading ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 4px 14px var(--primary-subtle)',
              }}
            >
              <span>
                {!isLastQuestion
                  ? 'Câu tiếp theo →'
                  : demoMode
                    ? 'Hoàn thành demo →'
                    : playtestMode
                      ? 'Hoàn thành chơi thử'
                      : 'Hoàn thành — Xem kết quả →'}
              </span>
            </button>
          ) : (
            <span
              data-testid="playtest-awaiting-answer-hint"
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-input)',
              }}
            >
              Chọn / gửi đáp án để tiếp tục
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

