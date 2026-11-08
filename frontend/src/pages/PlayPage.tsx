import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useToast } from '../components/ToastContext.js';
import { GameSocketClient, ConnectionStatus } from '../services/socket.js';
import { soundManager } from '../services/audio.js';
import { fetchGameById, fetchRoomLobby } from '../services/api.js';
import {
  AdventureGameEngine,
  resolveAdventureRuntimeAssets,
} from '../components/AdventureGameEngine.js';
import {
  syncAdventureStagesWithQuestions,
} from '../config/adventureThemes.js';
import {
  evaluateFrontendPerformance,
  type GameQuestion,
  type GameSpecification,
  type GameType,
  type LeaderboardEntry,
  type PracticeFinalResult,
  type PracticeQuestionResult,
  type SanitizedQuestion,
  type SessionMode,
} from '../types/index.js';
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  GamepadIcon,
  SparklesIcon,
  SpinnerIcon,
  StarIcon,
  TrophyIcon,
  XMarkIcon,
} from '../components/Icons.js';

interface PlayPageProps {
  roomCode: string;
  displayName: string;
  onLeave?: () => void;
}

const MAX_ANSWER_LENGTH = 500;

const normalizeCrosswordPreview = (text: string): string =>
  text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, '');

export const PlayPage: React.FC<PlayPageProps> = ({ roomCode, displayName, onLeave }) => {
  const toast = useToast();

  const [playerId, setPlayerId] = useState('');
  const playerIdRef = useRef('');
  const [playerScore, setPlayerScore] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [roomError, setRoomError] = useState<string | null>(null);

  // 'lobby' | 'question' | 'reveal' | 'finish'
  const [screen, setScreen] = useState<'lobby' | 'question' | 'reveal' | 'finish'>('lobby');

  const [currentQuestion, setCurrentQuestion] = useState<SanitizedQuestion | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [textInputAnswer, setTextInputAnswer] = useState('');
  const [puzzleOrder, setPuzzleOrder] = useState<string[]>([]);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [sliderTouched, setSliderTouched] = useState<boolean>(false);

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
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const [timeRemaining, setTimeRemaining] = useState(20);
  const [totalQuestionTime, setTotalQuestionTime] = useState(20);

  const [personalResult, setPersonalResult] = useState<{
    isCorrect: boolean;
    pointsEarned: number;
    speedBonus?: number;
    streak?: number;
  } | null>(null);

  const [correctAnswer, setCorrectAnswer] = useState('');
  const [explanation, setExplanation] = useState<string | undefined>();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [finalRank, setFinalRank] = useState<number | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // V2 Session Mode, Exam Redaction & Audio Controls
  const [sessionMode, setSessionMode] = useState<SessionMode>('PLAY');
  const [answersPublished, setAnswersPublished] = useState<boolean>(false);
  const [examClosedByBtc, setExamClosedByBtc] = useState<boolean>(false);
  const [publishedAnswersList, setPublishedAnswersList] = useState<
    Array<{ id: string; question: string; correctAnswer: string; explanation?: string }>
  >([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(() => soundManager.isMuted());

  // Game specification & Adventure Multiplayer 2D state
  const [activeGameId, setActiveGameId] = useState<string>('');
  const [roomGameType, setRoomGameType] = useState<GameType | null>(null);
  const [loadedGameSpec, setLoadedGameSpec] = useState<GameSpecification | null>(null);
  const [submittedAnswerRecord, setSubmittedAnswerRecord] = useState<string>('');
  const [currentStreak, setCurrentStreak] = useState<number>(0);

  // Load room metadata & game specification once (no AI calls — uses saved assets or verified industry fallback pack)
  useEffect(() => {
    let cancelled = false;
    fetchRoomLobby(roomCode)
      .then((lobby) => {
        if (cancelled) return;
        if (lobby?.gameId) {
          setActiveGameId((prev) => prev || lobby.gameId || '');
        }
        if (lobby?.gameType) {
          setRoomGameType((prev) => prev || (lobby.gameType as GameType));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  useEffect(() => {
    if (!activeGameId) return;
    let cancelled = false;
    fetchGameById(activeGameId, { mode: 'public' })
      .catch(() => fetchGameById(activeGameId))
      .then((spec) => {
        if (!cancelled && spec) {
          setLoadedGameSpec(spec);
          if (spec.gameType) {
            setRoomGameType((prev) => prev || spec.gameType);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeGameId]);

  const handleToggleAudioMute = () => {
    const nextMuted = soundManager.toggleMute();
    setIsAudioMuted(nextMuted);
  };

  const confirmLeaveRoom = () => {
    if (isLeaving) return;
    setIsLeaving(true);
    stopTimer();
    soundManager.stopAll();
    const tokenKey = `token_${roomCode}`;
    const savedToken = sessionStorage.getItem(tokenKey);
    if (socketRef.current && savedToken) {
      socketRef.current.send({
        type: 'player.leave',
        playerToken: savedToken,
      });
    }
    if (socketRef.current) {
      socketRef.current.close();
    }
    try {
      sessionStorage.removeItem(tokenKey);
      sessionStorage.removeItem(`name_${roomCode}`);
      sessionStorage.removeItem(`room_game_password_${roomCode}`);
      sessionStorage.removeItem('active_player_room');
      sessionStorage.removeItem('active_player_name');
    } catch {}
    if (onLeave) {
      onLeave();
    }
  };

  const socketRef = useRef<GameSocketClient | null>(null);
  const timerIntervalRef = useRef<any>(null);
  const lastRevealedQuestionIdRef = useRef<string | null>(null);
  const hasPlayedFinishSfxRef = useRef<boolean>(false);

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startTimer = (durationSec: number) => {
    stopTimer();
    soundManager.resetCountdownTracker();
    setTimeRemaining(durationSec);
    setTotalQuestionTime(durationSec);

    timerIntervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          stopTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    if (screen !== 'question' || isAnswerSubmitted || timeRemaining <= 0) return;
    soundManager.checkCountdownTick(timeRemaining);
  }, [screen, isAnswerSubmitted, timeRemaining]);

  const submitAnswer = (ans: string) => {
    if (!socketRef.current || isAnswerSubmitted || isSubmittingAnswer || !currentQuestion) return;

    const clean = ans.trim();
    if (!clean) {
      setAnswerError('Vui lòng chọn hoặc nhập câu trả lời trước khi gửi.');
      toast.warning('Vui lòng chọn hoặc nhập câu trả lời.', 'Chưa có câu trả lời');
      return;
    }

    if (clean.length > MAX_ANSWER_LENGTH) {
      setAnswerError(`Câu trả lời không được vượt quá ${MAX_ANSWER_LENGTH} ký tự.`);
      toast.warning(`Câu trả lời vượt quá ${MAX_ANSWER_LENGTH} ký tự cho phép.`, 'Vượt giới hạn độ dài');
      return;
    }

    setAnswerError(null);
    setSubmittedAnswerRecord(clean);
    setIsSubmittingAnswer(true);

    const sent = socketRef.current.send({
      type: 'player.answer',
      questionId: currentQuestion.id,
      answer: clean,
    });

    if (!sent) {
      setIsSubmittingAnswer(false);
      setAnswerError('Kết nối mạng bị gián đoạn. Đang kết nối lại, vui lòng bấm gửi lại.');
      socketRef.current.connect();
      toast.error('Không thể gửi đáp án do mất kết nối mạng. Vui lòng thử lại.', 'Lỗi kết nối');
    }
  };

  useEffect(() => {
    const client = new GameSocketClient();
    socketRef.current = client;

    client.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    const tokenKey = `token_${roomCode}`;
    const savedToken = sessionStorage.getItem(tokenKey);

    client.onOpen(() => {
      if (savedToken) {
        client.send({
          type: 'player.reconnect',
          roomCode,
          playerToken: savedToken,
        });
      } else {
        const storedPassword = sessionStorage.getItem(`room_game_password_${roomCode}`) || undefined;
        const storedParticipantId = sessionStorage.getItem('active_player_participant_id') || undefined;
        const storedDept = sessionStorage.getItem('active_player_department') || undefined;
        const storedLockToken = sessionStorage.getItem('active_player_lock_token') || undefined;
        client.send({
          type: 'player.join',
          roomCode,
          displayName,
          password: storedPassword,
          participantId: storedParticipantId,
          departmentUnit: storedDept,
          lockToken: storedLockToken,
        });
      }
    });

    client.on('room.joined', (msg: any) => {
      setRoomError(null);
      if (msg.gameId) {
        setActiveGameId(msg.gameId);
      }
      if (msg.gameType) {
        setRoomGameType(msg.gameType as GameType);
      }
      if (msg.sessionMode === 'EXAM' || msg.sessionMode === 'PLAY') {
        setSessionMode(msg.sessionMode);
      }
      if (typeof msg.answersPublished === 'boolean') {
        setAnswersPublished(msg.answersPublished);
      }
      soundManager.setSessionContext({
        sessionMode: msg.sessionMode,
        answersPublished: msg.answersPublished,
      });
      if (msg.audioConfig) {
        soundManager.configure({
          ...msg.audioConfig,
          sessionMode: msg.sessionMode,
          answersPublished: msg.answersPublished,
        });
        if (msg.state === 'QUESTION_ACTIVE') {
          soundManager.startBackgroundMusic(msg.audioConfig);
        }
      } else {
        soundManager.setSessionContext({
          sessionMode: msg.sessionMode,
          answersPublished: msg.answersPublished,
        });
      }
      if (msg.playerToken) {
        sessionStorage.setItem(tokenKey, msg.playerToken);
      }
      if (msg.playerId) {
        playerIdRef.current = msg.playerId;
        setPlayerId(msg.playerId);
      }
      if (typeof msg.score === 'number') {
        setPlayerScore(msg.score);
      }
      if (msg.state === 'WAITING') {
        setScreen('lobby');
      } else if (msg.state === 'QUESTION_ACTIVE') {
        setScreen('question');
      } else if (msg.state === 'QUESTION_REVEAL') {
        setScreen('reveal');
      } else if (msg.state === 'FINISHED') {
        setScreen('finish');
      }
      toast.success(`Đã vào phòng [${roomCode}] thành công!`, 'Tham gia thành công');
    });

    client.on('game.started', () => {
      soundManager.playStart();
      soundManager.startBackgroundMusic();
      setScreen('question');
      toast.info('Trò chơi đã bắt đầu! Chúc bạn thi đấu đạt kết quả cao nhất!', 'Bắt đầu');
    });

    client.on('exam.closed', () => {
      setExamClosedByBtc(true);
      toast.warning(
        'Đợt thi đã kết thúc — Hệ thống đã tự động ghi nhận kết quả của bạn.',
        'Đợt thi kết thúc'
      );
    });

    client.on('room.closed', (msg: any) => {
      stopTimer();
      soundManager.stopAll();
      setRoomError(msg?.reason || 'Phòng chơi đã được đóng bởi chủ phòng.');
      sessionStorage.removeItem(tokenKey);
    });

    client.on('question.started', (msg: any) => {
      hasPlayedFinishSfxRef.current = false;
      if (!soundManager.getIsPlaying()) {
        soundManager.startBackgroundMusic();
      }
      setCurrentQuestion(msg.question);
      setSelectedAnswer(null);
      setTextInputAnswer('');
      setSubmittedAnswerRecord('');
      setIsSubmittingAnswer(false);
      setIsAnswerSubmitted(false);
      setAnswerError(null);
      setPersonalResult(null);
      setScreen('question');

      const duration = msg.question.deadlineAt
        ? Math.max(0, Math.ceil((msg.question.deadlineAt - Date.now()) / 1000))
        : (msg.question.timePerQuestion || 20);
      startTimer(duration || 20);
    });

    client.on('question.answerReceived', () => {
      setIsSubmittingAnswer(false);
      setIsAnswerSubmitted(true);
      setAnswerError(null);
      soundManager.playSfx('recorded');
      toast.info('Đã ghi nhận câu trả lời của bạn.', 'Đã nộp bài');
    });

    client.on('question.timeUp', () => {
      stopTimer();
      setIsSubmittingAnswer(false);
      setIsAnswerSubmitted((prevSubmitted) => {
        if (!prevSubmitted) {
          soundManager.playSfx('timeout');
        }
        return true;
      });
      toast.info('Hết thời gian trả lời!', 'Hết giờ');
    });

    client.on('question.revealed', (msg: any) => {
      stopTimer();
      setIsSubmittingAnswer(false);
      if (msg.sessionMode === 'EXAM' || msg.sessionMode === 'PLAY') {
        setSessionMode(msg.sessionMode);
      }
      if (typeof msg.answersPublished === 'boolean') {
        setAnswersPublished(msg.answersPublished);
      }
      soundManager.setSessionContext({
        sessionMode: msg.sessionMode,
        answersPublished: msg.answersPublished,
      });
      setCorrectAnswer(msg.correctAnswer || '');
      setExplanation(msg.explanation);
      setLeaderboard(msg.leaderboard || []);
      setPersonalResult(msg.personalResult ?? null);
      if (msg.personalResult?.answer) {
        setSubmittedAnswerRecord(msg.personalResult.answer);
      }
      if (typeof msg.personalResult?.streak === 'number') {
        setCurrentStreak(msg.personalResult.streak);
      } else if (msg.personalResult) {
        setCurrentStreak((prev) => (msg.personalResult.isCorrect ? prev + 1 : 0));
      } else {
        setCurrentStreak(0);
      }

      const isExamRedacted =
        (msg.sessionMode === 'EXAM' || sessionMode === 'EXAM') && !msg.answersPublished;
      const revealKey = String(msg.questionId ?? msg.questionIndex ?? 'revealed');

      if (msg.personalResult && !isExamRedacted && lastRevealedQuestionIdRef.current !== revealKey) {
        lastRevealedQuestionIdRef.current = revealKey;
        if (msg.personalResult.isCorrect) {
          soundManager.playSfx('correct');
          toast.success(`Chính xác! Bạn nhận được +${msg.personalResult.pointsEarned} điểm!`, 'Chính xác');
        } else {
          soundManager.playSfx('wrong');
          toast.error('Rất tiếc! Chưa phải đáp án chính xác.', 'Chưa chính xác');
        }
      }

      const myId = playerIdRef.current;
      if (msg.leaderboard && myId) {
        const me = msg.leaderboard.find((e: LeaderboardEntry) => e.playerId === myId);
        if (me) {
          setPlayerScore(me.score);
        }
      }

      setScreen('reveal');
    });

    client.on('game.finished', (msg: any) => {
      stopTimer();
      soundManager.stopBackgroundMusic();
      setIsSubmittingAnswer(false);
      if (msg.sessionMode === 'EXAM' || msg.sessionMode === 'PLAY') {
        setSessionMode(msg.sessionMode);
      }
      if (typeof msg.answersPublished === 'boolean') {
        setAnswersPublished(msg.answersPublished);
      }
      soundManager.setSessionContext({
        sessionMode: msg.sessionMode,
        answersPublished: msg.answersPublished,
      });
      setLeaderboard(msg.leaderboard || []);
      setCorrectAnswer('');
      setExplanation(undefined);
      const effectiveMode = msg.sessionMode === 'EXAM' || msg.sessionMode === 'PLAY' ? msg.sessionMode : sessionMode;
      if (effectiveMode === 'EXAM' && Array.isArray(msg.questions) && msg.questions.length > 0) {
        setPublishedAnswersList(msg.questions);
      } else {
        setPublishedAnswersList([]);
      }
      const myId = playerIdRef.current;
      let myRank: number | null = null;
      if (msg.leaderboard && myId) {
        const me = msg.leaderboard.find((e: LeaderboardEntry) => e.playerId === myId);
        if (me) {
          setPlayerScore(me.score);
          setFinalRank(me.rank);
          myRank = me.rank;
        }
      }
      if (!hasPlayedFinishSfxRef.current) {
        hasPlayedFinishSfxRef.current = true;
        const effectiveMode = msg.sessionMode || sessionMode;
        if (effectiveMode === 'PLAY' && myRank !== null && myRank >= 1 && myRank <= 3) {
          soundManager.playTop3Celebration();
        } else {
          soundManager.playSfx('finish');
        }
      }
      setScreen('finish');
      toast.success('Trò chơi đã kết thúc! Xem kết quả chung cuộc của bạn bên dưới.', 'Kết thúc');
    });

    client.on('answers.published', (msg: any) => {
      setAnswersPublished(true);
      if (Array.isArray(msg.questions)) {
        setPublishedAnswersList(msg.questions);
      }
      toast.success('Ban tổ chức đã công bố đáp án chính thức của kỳ thi!', 'Đã công bố đáp án');
    });

    client.on('error', (msg: any) => {
      setIsSubmittingAnswer(false);
      if (
        msg.code === 'ROOM_NOT_FOUND' ||
        msg.code === 'ROOM_EXPIRED' ||
        msg.code === 'GAME_FINISHED' ||
        msg.code === 'ROOM_LOCKED'
      ) {
        setRoomError(msg.message || 'Phòng chơi không tồn tại, đã kết thúc hoặc đang bị khóa.');
        sessionStorage.removeItem(tokenKey);
      } else if (msg.code === 'QUESTION_ALREADY_ANSWERED' || msg.code === 'ANSWER_TIMEOUT') {
        setIsAnswerSubmitted(true);
      } else {
        setAnswerError(msg.message || 'Câu trả lời không hợp lệ, vui lòng kiểm tra lại.');
      }
      toast.error(msg.message || 'Lỗi kết nối phòng chơi.', 'Thông báo');
    });

    client.connect();

    return () => {
      stopTimer();
      soundManager.stopAll();
      client.close();
    };
  }, [roomCode, displayName]);

  const timerPercentage = totalQuestionTime > 0 ? Math.max(0, (timeRemaining / totalQuestionTime) * 100) : 0;
  const isUrgentTime = timeRemaining <= 5;

  const effectiveGameType: GameType | null = loadedGameSpec?.gameType || roomGameType || null;
  const isAdventureGame = effectiveGameType === 'ADVENTURE';

  const effectiveAdventureGameSpec = useMemo<GameSpecification>(() => {
    const totalCount =
      currentQuestion?.totalQuestions ||
      loadedGameSpec?.questions?.length ||
      5;
    const baseQuestions: GameQuestion[] = Array.isArray(loadedGameSpec?.questions)
      ? [...loadedGameSpec.questions]
      : Array.from({ length: totalCount }, (_, idx) => ({
          id: `mp_adv_q_${idx + 1}`,
          type: 'MULTIPLE_CHOICE' as const,
          question: `Câu hỏi trạm #${idx + 1}`,
          choices: ['A', 'B', 'C', 'D'],
          correctAnswer: 'A',
          explanation: '',
          difficulty: 'MEDIUM' as const,
          sourceReference: {
            sourceId: 'mp_adv_src',
            sourceType: 'TXT' as const,
            sourceLocation: 'Multiplayer Adventure 2D',
          },
        }));

    if (currentQuestion) {
      const qIdx = Math.max(0, Math.min(baseQuestions.length - 1, currentQuestion.questionIndex ?? 0));
      const existingQ = baseQuestions[qIdx];
      baseQuestions[qIdx] = {
        ...existingQ,
        id: currentQuestion.id,
        type: currentQuestion.type,
        question: currentQuestion.question,
        choices: currentQuestion.choices ?? existingQ?.choices,
        crosswordClue: currentQuestion.crosswordClue ?? existingQ?.crosswordClue,
        correctAnswer: existingQ?.correctAnswer || correctAnswer || '',
        explanation: existingQ?.explanation || explanation || '',
        difficulty: existingQ?.difficulty || 'MEDIUM',
        sourceReference: existingQ?.sourceReference || {
          sourceId: 'mp_adv_src',
          sourceType: 'TXT' as const,
          sourceLocation: 'Multiplayer Adventure 2D',
        },
      };
    }

    const syncedAdventureConfig = syncAdventureStagesWithQuestions(
      loadedGameSpec?.settings?.adventureConfig,
      baseQuestions
    );

    const baseSpec: GameSpecification = {
      ...(loadedGameSpec || {
        gameId: activeGameId || `mp_adv_${roomCode}`,
        title: `Phòng thi đấu #${roomCode}`,
        description: 'Chế độ Đi cảnh 2D Nhiều người chơi',
        gameType: 'ADVENTURE',
        questions: baseQuestions,
        settings: {
          questionCount: baseQuestions.length,
          timePerQuestion: 20,
          scoringMode: 'SPEED_BONUS',
          sessionMode,
          answersPublished,
          adventureConfig: syncedAdventureConfig,
        },
        generatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
      gameType: 'ADVENTURE',
      questions: baseQuestions,
      settings: {
        questionCount: baseQuestions.length,
        timePerQuestion: loadedGameSpec?.settings?.timePerQuestion || 20,
        scoringMode: loadedGameSpec?.settings?.scoringMode || 'SPEED_BONUS',
        ...(loadedGameSpec?.settings || {}),
        sessionMode,
        answersPublished,
        adventureConfig: syncedAdventureConfig,
      },
    };

    return baseSpec;
  }, [
    loadedGameSpec,
    activeGameId,
    roomCode,
    currentQuestion,
    correctAnswer,
    explanation,
    sessionMode,
    answersPublished,
  ]);

  const adventurePreviewConfig = useMemo(
    () =>
      effectiveAdventureGameSpec.settings.adventureConfig ||
      syncAdventureStagesWithQuestions(undefined, effectiveAdventureGameSpec.questions),
    [effectiveAdventureGameSpec]
  );

  const adventurePreviewAssets = useMemo(
    () => resolveAdventureRuntimeAssets(adventurePreviewConfig),
    [adventurePreviewConfig]
  );

  const myLeaderboardEntry = useMemo(
    () => leaderboard.find((e) => e.playerId === playerId) || null,
    [leaderboard, playerId]
  );

  const adventureLastResult = useMemo<PracticeQuestionResult | null>(() => {
    if (screen !== 'reveal' || !currentQuestion) return null;
    const isExamUnpublished = sessionMode === 'EXAM' && !answersPublished;
    return {
      questionId: currentQuestion.id,
      questionIndex: currentQuestion.questionIndex ?? 0,
      answer: submittedAnswerRecord || (personalResult as any)?.answer || '',
      isCorrect: Boolean(personalResult?.isCorrect),
      pointsEarned: personalResult?.pointsEarned ?? 0,
      speedBonus: personalResult?.speedBonus ?? 0,
      totalScore: playerScore,
      correctCount: myLeaderboardEntry?.correctCount ?? 0,
      streak: personalResult?.streak ?? currentStreak,
      timedOut: !personalResult && !submittedAnswerRecord,
      responseTimeMs: 0,
      answeredAt: new Date().toISOString(),
      correctAnswer: isExamUnpublished ? '' : correctAnswer,
      explanation: isExamUnpublished ? undefined : explanation,
      sessionMode,
      answersPublished,
      ...(isExamUnpublished ? { examAnswerRecorded: true, examRedacted: true } : {}),
    } as unknown as PracticeQuestionResult;
  }, [
    screen,
    currentQuestion,
    sessionMode,
    answersPublished,
    submittedAnswerRecord,
    personalResult,
    playerScore,
    myLeaderboardEntry,
    currentStreak,
    correctAnswer,
    explanation,
  ]);

  const adventureFinalResult = useMemo<PracticeFinalResult | null>(() => {
    if (screen !== 'finish') return null;
    const totalQs =
      myLeaderboardEntry?.totalQuestions ||
      currentQuestion?.totalQuestions ||
      effectiveAdventureGameSpec.questions.length ||
      5;
    const correctCnt = myLeaderboardEntry?.correctCount ?? 0;
    const maxPossible = myLeaderboardEntry?.maxPossibleScore || totalQs * 100;
    const evalRes = evaluateFrontendPerformance({
      correctAnswers: correctCnt,
      totalQuestions: totalQs,
      sessionMode,
      passThresholdPercent: sessionMode === 'EXAM' ? 50 : undefined,
    });
    return {
      sessionId: `mp_${roomCode}_${playerId}`,
      gameId: effectiveAdventureGameSpec.gameId || activeGameId || `mp_adv_${roomCode}`,
      title: effectiveAdventureGameSpec.title,
      gameType: 'ADVENTURE',
      playerName: displayName,
      totalScore: playerScore,
      maxPossibleScore: maxPossible,
      correctAnswers: correctCnt,
      correctCount: correctCnt,
      totalQuestions: totalQs,
      accuracyPercentage: evalRes.accuracyPercentage,
      completedAt: new Date().toISOString(),
      sessionMode,
      answersPublished,
      canRevealAnswers: sessionMode !== 'EXAM' || answersPublished,
      performanceEvaluation: evalRes,
      questionResults:
        publishedAnswersList.length > 0
          ? publishedAnswersList.map((item, idx) => ({
              questionId: item.id || `q_${idx}`,
              questionIndex: idx,
              answer: '',
              isCorrect: true,
              pointsEarned: 0,
              responseTimeMs: 0,
              answeredAt: new Date().toISOString(),
              correctAnswer: item.correctAnswer,
              explanation: item.explanation,
            }))
          : undefined,
    } as unknown as PracticeFinalResult;
  }, [
    screen,
    myLeaderboardEntry,
    currentQuestion,
    effectiveAdventureGameSpec,
    sessionMode,
    roomCode,
    playerId,
    activeGameId,
    displayName,
    playerScore,
    answersPublished,
    publishedAnswersList,
  ]);

  // Kahoot color config for 4 choices (A: Red, B: Blue, C: Yellow, D: Green)
  const choiceColors = [
    { bg: 'var(--k-red)', dark: 'var(--k-red-dark)', hover: 'var(--k-red-hover)', icon: '▲', label: 'A', text: '#ffffff' },
    { bg: 'var(--k-blue)', dark: 'var(--k-blue-dark)', hover: 'var(--k-blue-hover)', icon: '◆', label: 'B', text: '#ffffff' },
    { bg: 'var(--k-yellow)', dark: 'var(--k-yellow-dark)', hover: 'var(--k-yellow-hover)', icon: '●', label: 'C', text: 'var(--k-yellow-ink)' },
    { bg: 'var(--k-green)', dark: 'var(--k-green-dark)', hover: 'var(--k-green-hover)', icon: '■', label: 'D', text: '#ffffff' },
  ];

  const getQuestionTypeBadgeLabel = (qType?: string): string => {
    if (qType === 'MULTIPLE_CHOICE' || qType === 'QUIZ') return 'Trắc nghiệm';
    if (qType === 'QUICK_BUTTON' || qType === 'TRUE_FALSE') return 'Đúng / Sai';
    if (qType === 'FILL_IN_THE_BLANK' || qType === 'TYPE_ANSWER') return 'Điền từ';
    if (qType === 'CROSSWORD') return 'Ô chữ';
    if (qType === 'PUZZLE') return 'Sắp xếp thứ tự';
    if (qType === 'SLIDER') return 'Thanh trượt';
    return qType || 'Câu hỏi';
  };

  if (roomError) {
    return (
      <div
        role="alert"
        style={{
          maxWidth: '520px',
          margin: '3rem auto',
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--accent-rose)',
          borderRadius: '16px',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div style={{ color: 'var(--accent-rose)', marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}>
          <AlertTriangleIcon size={44} />
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-rose)' }}>
          Không Thể Tham Gia Phòng Chơi
        </h2>
        <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
          {roomError}
        </p>
        <button
          type="button"
          onClick={() => {
            if (onLeave) onLeave();
          }}
          style={{
            backgroundColor: 'var(--primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            padding: '0.75rem 1.25rem',
            minHeight: '44px',
            fontWeight: 800,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Quay lại trang chủ / Tham gia phòng khác
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: isAdventureGame && screen !== 'lobby' ? '1080px' : '760px',
        margin: '0 auto',
        padding: '0.75rem 0.5rem 2rem 0.5rem',
      }}
    >
      {/* Reconnecting Status Banner */}
      {connectionStatus === 'reconnecting' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid var(--accent-amber)',
            color: 'var(--accent-amber)',
            padding: '0.65rem 1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
            fontWeight: 800,
            fontSize: '0.86rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <SpinnerIcon size={16} />
          <span>Đang kết nối lại tới máy chủ phòng chơi...</span>
        </div>
      )}

      {connectionStatus === 'disconnected' && (
        <div
          role="alert"
          style={{
            backgroundColor: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            padding: '0.65rem 1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
            fontWeight: 800,
            fontSize: '0.86rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <AlertTriangleIcon size={16} />
            <span>Mất kết nối tới máy chủ phòng chơi.</span>
          </div>
          <button
            type="button"
            onClick={() => socketRef.current?.connect()}
            style={{
              backgroundColor: 'var(--accent-rose)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.4rem 0.85rem',
              minHeight: '36px',
              fontWeight: 800,
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* 1. Top Player Status Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          padding: '0.85rem 1.25rem',
          marginBottom: '1.25rem',
          boxShadow: 'var(--card-shadow)',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              backgroundColor: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <GamepadIcon size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 800 }}>
                {displayName}
              </span>
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: 'var(--accent-emerald)',
                  fontWeight: 700,
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}
              >
                ● Online
              </span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>
              Phòng: <strong style={{ color: 'var(--accent-sky)', letterSpacing: '0.05em' }}>{roomCode}</strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block' }}>
              ĐIỂM SỐ
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'flex-end' }}>
              <span style={{ color: '#facc15', display: 'flex', alignItems: 'center' }}>
                <StarIcon size={18} />
              </span>
              <strong style={{ color: 'var(--accent-emerald)', fontSize: '1.45rem', fontWeight: 900 }}>
                {playerScore}
              </strong>
            </div>
          </div>

          <button
            type="button"
            data-testid="audio-mute-toggle-btn"
            onClick={handleToggleAudioMute}
            title={isAudioMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            style={{
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '0.45rem 0.7rem',
              fontSize: '0.82rem',
              fontWeight: 800,
              cursor: 'pointer',
              minHeight: '38px',
            }}
          >
            {isAudioMuted ? '🔇 Tắt tiếng' : '🔊 Âm thanh'}
          </button>

          <button
            type="button"
            onClick={() => setShowLeaveConfirm(true)}
            title="Rời khỏi phòng chơi"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--accent-rose)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              padding: '0.45rem 0.85rem',
              fontSize: '0.82rem',
              fontWeight: 800,
              cursor: 'pointer',
              minHeight: '38px',
              transition: 'all 0.15s ease',
            }}
          >
            <XMarkIcon size={15} />
            <span>Rời phòng</span>
          </button>
        </div>
      </div>

      {/* Modal Xác nhận rời phòng an toàn */}
      {showLeaveConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-confirm-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: '20px',
              padding: '1.75rem',
              maxWidth: '440px',
              width: '100%',
              boxShadow: 'var(--shadow-lg)',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-rose)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangleIcon size={22} />
              </div>
              <h3 id="leave-confirm-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
                Xác nhận rời phòng
              </h3>
            </div>
            <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn rời phòng thi đấu <strong>#{roomCode}</strong>? Phiên chơi của bạn sẽ dừng lại. Phòng thi đấu của Host và các người chơi khác vẫn tiếp tục bình thường.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                disabled={isLeaving}
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.25rem',
                  minHeight: '44px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: isLeaving ? 'not-allowed' : 'pointer',
                }}
              >
                Ở lại thi đấu
              </button>
              <button
                type="button"
                onClick={confirmLeaveRoom}
                disabled={isLeaving}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.65rem 1.25rem',
                  minHeight: '44px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: isLeaving ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                }}
              >
                {isLeaving ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang rời...</span>
                  </>
                ) : (
                  <span>Xác nhận rời</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Màn hình Sảnh Chờ (Lobby) */}
      {screen === 'lobby' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 1.25rem auto',
              borderRadius: '24px',
              backgroundColor: 'var(--primary-subtle)',
              border: '1px solid var(--border-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
            }}
          >
            <ClockIcon size={38} />
          </div>

          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.5rem', margin: '0 0 0.5rem 0', fontWeight: 900, letterSpacing: '-0.02em' }}>
            Sẵn Sàng Chiến Đấu!
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: '0 0 1.75rem 0', lineHeight: '1.5' }}>
            Giữ sáng màn hình. Trận đấu sẽ bắt đầu khi chủ phòng bấm Bắt đầu.
          </p>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: 'var(--bg-input)',
              border: '2px dashed var(--primary)',
              borderRadius: '12px',
              padding: '0.75rem 1.5rem',
              color: 'var(--accent-sky)',
              fontWeight: 800,
              letterSpacing: '0.1em',
              fontSize: '1.15rem',
            }}
          >
            <span>MÃ PHÒNG:</span>
            <span>{roomCode}</span>
          </div>

          {isAdventureGame && (
            <div
              data-testid="mp-lobby-adventure-preview"
              style={{
                marginTop: '1.5rem',
                padding: '1.15rem',
                borderRadius: '16px',
                backgroundColor: 'var(--bg-card)',
                border: '1.5px solid var(--border-strong)',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                  marginBottom: '0.65rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.76rem',
                    fontWeight: 900,
                    color: 'var(--accent-emerald)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  🎮 CHẾ ĐỘ ĐI CẢNH 2D NHIỀU NGƯỜI CHƠI · {adventurePreviewConfig.industryLabel}
                </span>
                <span
                  style={{
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    color: 'var(--accent-sky)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(56, 189, 248, 0.14)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                  }}
                >
                  {effectiveAdventureGameSpec.questions.length} Trạm kiểm tra 2D
                </span>
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                {adventurePreviewConfig.environmentTitle}
              </div>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Nhân vật <strong>{adventurePreviewConfig.avatarLabel || 'Nhân vật 2D'}</strong> di chuyển trên màn hình 2D, nhảy vượt qua chướng ngại vật và giải câu hỏi tại từng Trạm kiểm tra theo điều phối của Chủ phòng.
              </p>
              {adventurePreviewAssets.assets?.background?.url && (
                <div
                  style={{
                    position: 'relative',
                    height: '110px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundImage: `url(${adventurePreviewAssets.assets.background.url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center bottom',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    padding: '0.65rem 1.25rem',
                  }}
                >
                  {adventurePreviewAssets.assets.character?.url && (
                    <img
                      src={adventurePreviewAssets.assets.character.url}
                      alt={adventurePreviewConfig.avatarLabel || 'Character 2D'}
                      style={{
                        height: '62px',
                        width: 'auto',
                        objectFit: 'contain',
                        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))',
                      }}
                    />
                  )}
                  {adventurePreviewAssets.assets.obstacle?.url && (
                    <img
                      src={adventurePreviewAssets.assets.obstacle.url}
                      alt="Obstacle 2D"
                      style={{
                        height: '48px',
                        width: 'auto',
                        objectFit: 'contain',
                        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2B. Chế độ Đi cảnh 2D Nhiều Người Chơi (Adventure Multiplayer 2D) */}
      {isAdventureGame && (screen === 'question' || screen === 'reveal' || screen === 'finish') && (
        <div data-testid="mp-adventure-2d-container">
          <AdventureGameEngine
            game={effectiveAdventureGameSpec}
            adventureConfig={adventurePreviewConfig}
            mode="LIVE_SESSION"
            sessionStarted={true}
            isPlaytest={false}
            isMultiplayer={true}
            multiplayerRoomCode={roomCode}
            multiplayerPlayerName={displayName}
            multiplayerPlayerId={playerId}
            multiplayerStreak={currentStreak}
            multiplayerIsAnswerSubmitted={isAnswerSubmitted}
            multiplayerSubmittedAnswerText={submittedAnswerRecord}
            multiplayerIsReconnecting={
              connectionStatus === 'reconnecting' || connectionStatus === 'disconnected'
            }
            multiplayerLeaderboard={leaderboard}
            multiplayerFinalRank={finalRank}
            multiplayerTotalPlayers={leaderboard.length}
            multiplayerShowLeaderboard={
              sessionMode !== 'EXAM' || answersPublished || leaderboard.length > 0
            }
            currentQuestion={currentQuestion}
            currentQuestionIndex={currentQuestion?.questionIndex ?? 0}
            totalQuestions={
              currentQuestion?.totalQuestions ??
              effectiveAdventureGameSpec.questions.length ??
              5
            }
            timeRemaining={timeRemaining}
            liveScore={playerScore}
            liveStreak={currentStreak}
            liveCorrectCount={myLeaderboardEntry?.correctCount ?? 0}
            submittingAnswer={isSubmittingAnswer}
            questionFeedback={adventureLastResult}
            isSessionFinished={screen === 'finish'}
            finalResult={adventureFinalResult}
            onSubmitAnswer={async (answerText: string) => {
              submitAnswer(answerText);
            }}
            onNextQuestion={async () => {}}
            onExit={() => setShowLeaveConfirm(true)}
            audioMuted={isAudioMuted}
            onToggleAudioMute={handleToggleAudioMute}
          />
        </div>
      )}

      {/* 3. Màn hình Câu hỏi đang diễn ra (Question Screen — Non-Adventure) */}
      {!isAdventureGame && screen === 'question' && currentQuestion && (
        <div
          data-testid="mp-question-card"
          data-question-type={currentQuestion.type}
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: 'clamp(1rem, 3vw, 1.5rem)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Top meta row: Question number + Type Badge & Timer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <span
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent-sky)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '8px',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  letterSpacing: '0.05em',
                }}
              >
                CÂU {(currentQuestion.questionIndex || 0) + 1} / {currentQuestion.totalQuestions || 5}
              </span>
              <span
                data-testid="question-type-badge"
                data-question-type={currentQuestion.type}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: '8px',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                {getQuestionTypeBadgeLabel(currentQuestion.type)}
              </span>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.3rem 0.85rem',
                borderRadius: '20px',
                backgroundColor: isUrgentTime ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-input)',
                border: isUrgentTime ? '1px solid #ef4444' : '1px solid var(--border-subtle)',
                color: isUrgentTime ? '#ef4444' : 'var(--accent-sky)',
                fontWeight: 900,
                fontSize: '1.15rem',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <ClockIcon size={18} />
              <span>{timeRemaining}s</span>
            </div>
          </div>

          {/* Animated countdown progress bar */}
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: 'var(--bg-input)',
              borderRadius: '4px',
              overflow: 'hidden',
              margin: '0.75rem 0 1.25rem 0',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                width: `${timerPercentage}%`,
                height: '100%',
                backgroundColor: isUrgentTime ? '#ef4444' : 'var(--accent-emerald)',
                transition: 'width 0.25s linear, background-color 0.25s ease',
              }}
            />
          </div>

          {/* Question text (Unified with SoloPlayer solo-question-box) */}
          <div
            data-testid="solo-question-box"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: '14px',
              padding: 'clamp(1rem, 2.5vw, 1.35rem)',
              marginBottom: '1.25rem',
              textAlign: 'center',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <h3
              data-testid="mp-question-text"
              style={{
                margin: 0,
                fontSize: 'clamp(1.08rem, 2.2vw, 1.3rem)',
                color: 'var(--text-primary)',
                lineHeight: 1.5,
                fontWeight: 800,
                overflowWrap: 'anywhere',
              }}
            >
              {currentQuestion.question}
            </h3>
          </div>

          {/* Kahoot-style 2x2 Choice Grid for Quiz / Multiple Choice */}
          {(currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'QUIZ') && (
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                  gap: '0.85rem',
                }}
              >
                {currentQuestion.choices?.map((choice, idx) => {
                  const config = choiceColors[idx % choiceColors.length];
                  const isSelected = selectedAnswer === choice;
                  return (
                    <button
                      key={idx}
                      type="button"
                      data-testid={`mp-choice-btn-${idx}`}
                      data-choice-letter={config.label}
                      aria-pressed={isSelected}
                      disabled={isAnswerSubmitted || isSubmittingAnswer}
                      onClick={() => {
                        setAnswerError(null);
                        setSelectedAnswer(prev => (prev === choice ? null : choice));
                      }}
                      className="k-btn"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '1rem 1.15rem',
                        backgroundColor: config.bg,
                        color: config.text,
                        border: isSelected ? '3px solid #ffffff' : 'none',
                        borderRadius: '16px',
                        fontSize: '1.02rem',
                        fontWeight: 900,
                        cursor: isAnswerSubmitted || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                        opacity: (isAnswerSubmitted || isSubmittingAnswer) && !isSelected ? 0.35 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.85rem',
                        minHeight: '64px',
                        boxShadow: isSelected
                          ? `0 2px 0 ${config.dark}`
                          : `0 5px 0 ${config.dark}`,
                        transform: isSelected ? 'translateY(3px)' : 'none',
                        transition: 'transform 0.1s ease, box-shadow 0.1s ease, opacity 0.15s ease',
                      }}
                    >
                      <span
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '10px',
                          backgroundColor: 'rgba(0, 0, 0, 0.2)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '1.1rem',
                          flexShrink: 0,
                        }}
                      >
                        {config.icon}
                      </span>
                      <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.38 }}>{choice}</span>
                      {isSelected && (
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: '#ffffff',
                            color: config.bg === 'var(--k-yellow)' ? 'var(--k-yellow-ink)' : config.bg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            flexShrink: 0,
                          }}
                        >
                          <CheckIcon size={18} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {!isAnswerSubmitted && (
                <button
                  type="button"
                  data-testid="mp-submit-answer-btn"
                  className="k-btn"
                  disabled={!selectedAnswer || isSubmittingAnswer || isAnswerSubmitted}
                  onClick={() => {
                    if (selectedAnswer) {
                      submitAnswer(selectedAnswer);
                    }
                  }}
                  style={{
                    width: '100%',
                    marginTop: '1.25rem',
                    padding: '1rem',
                    minHeight: '52px',
                    borderRadius: '14px',
                    fontSize: '1.1rem',
                    fontWeight: 900,
                    cursor: !selectedAnswer || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                    opacity: !selectedAnswer || isSubmittingAnswer ? 0.6 : 1,
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {isSubmittingAnswer ? (
                    <>
                      <SpinnerIcon size={20} />
                      <span>Đang gửi đáp án...</span>
                    </>
                  ) : selectedAnswer ? (
                    <span>Xác nhận gửi đáp án &rarr;</span>
                  ) : (
                    <span>Hãy chọn một đáp án ở trên</span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Unified True/False / Quick Button (Green Check / Red Cross matching SoloPlayer) */}
          {(currentQuestion.type === 'QUICK_BUTTON' || currentQuestion.type === 'TRUE_FALSE') && (
            <div>
              <div
                data-testid="mp-quick-button-group"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                  gap: '1rem',
                  maxWidth: '560px',
                  margin: '0 auto',
                }}
              >
                {(currentQuestion.choices && currentQuestion.choices.length > 0
                  ? currentQuestion.choices
                  : ['Đúng', 'Sai']
                ).map((choice, idx) => {
                  const isTrueBtn = idx === 0;
                  const isSelected = selectedAnswer === choice;
                  const btnBg = isTrueBtn ? 'var(--k-green)' : 'var(--k-red)';
                  const btnDark = isTrueBtn ? 'var(--k-green-dark)' : 'var(--k-red-dark)';
                  return (
                    <button
                      key={idx}
                      type="button"
                      data-testid={`mp-choice-btn-${idx}`}
                      aria-pressed={isSelected}
                      disabled={isAnswerSubmitted || isSubmittingAnswer}
                      onClick={() => {
                        setAnswerError(null);
                        setSelectedAnswer(prev => (prev === choice ? null : choice));
                      }}
                      className={`k-btn ${isTrueBtn ? 'k-btn-green' : 'k-btn-red'}`}
                      style={{
                        width: '100%',
                        padding: '1.35rem 1rem',
                        minHeight: '72px',
                        fontSize: '1.25rem',
                        fontWeight: 900,
                        borderRadius: '16px',
                        backgroundColor: btnBg,
                        color: '#ffffff',
                        border: isSelected ? '3px solid #ffffff' : 'none',
                        cursor: isAnswerSubmitted || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                        opacity: (isAnswerSubmitted || isSubmittingAnswer) && !isSelected ? 0.35 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.6rem',
                        boxShadow: isSelected ? `0 2px 0 ${btnDark}` : `0 5px 0 ${btnDark}`,
                        transform: isSelected ? 'translateY(3px)' : 'none',
                        transition: 'transform 0.1s ease, box-shadow 0.1s ease, opacity 0.15s ease',
                      }}
                    >
                      {isTrueBtn ? <CheckIcon size={24} /> : <XMarkIcon size={24} />}
                      <span>{choice}</span>
                    </button>
                  );
                })}
              </div>

              {!isAnswerSubmitted && (
                <button
                  type="button"
                  data-testid="mp-submit-answer-btn"
                  className="k-btn"
                  disabled={!selectedAnswer || isSubmittingAnswer || isAnswerSubmitted}
                  onClick={() => {
                    if (selectedAnswer) {
                      submitAnswer(selectedAnswer);
                    }
                  }}
                  style={{
                    width: '100%',
                    marginTop: '1.25rem',
                    padding: '1rem',
                    minHeight: '52px',
                    borderRadius: '14px',
                    fontSize: '1.1rem',
                    fontWeight: 900,
                    cursor: !selectedAnswer || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                    opacity: !selectedAnswer || isSubmittingAnswer ? 0.6 : 1,
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {isSubmittingAnswer ? (
                    <>
                      <SpinnerIcon size={20} />
                      <span>Đang gửi đáp án...</span>
                    </>
                  ) : selectedAnswer ? (
                    <span>Xác nhận gửi đáp án &rarr;</span>
                  ) : (
                    <span>Hãy chọn một đáp án ở trên</span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Puzzle sequence ordering */}
          {currentQuestion.type === 'PUZZLE' && (
            <div data-testid="mp-puzzle-group">
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textAlign: 'center' }}>
                Sắp xếp các mục dưới đây theo đúng thứ tự từ trên xuống dưới:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.1rem' }}>
                {puzzleOrder.map((item, idx) => (
                  <div
                    key={`${idx}_${item}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.7rem',
                      padding: '0.8rem 0.95rem',
                      borderRadius: '12px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1.5px solid var(--border-strong)',
                    }}
                  >
                    <span
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '0.85rem',
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ flex: 1, fontWeight: 800, fontSize: '0.96rem', color: 'var(--text-primary)' }}>
                      {item}
                    </span>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        disabled={isAnswerSubmitted || isSubmittingAnswer || idx === 0}
                        onClick={() => handleMovePuzzleItem(idx, -1)}
                        style={{
                          minWidth: '44px',
                          minHeight: '44px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: idx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontWeight: 900,
                          cursor: isAnswerSubmitted || isSubmittingAnswer || idx === 0 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={isAnswerSubmitted || isSubmittingAnswer || idx === puzzleOrder.length - 1}
                        onClick={() => handleMovePuzzleItem(idx, 1)}
                        style={{
                          minWidth: '44px',
                          minHeight: '44px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: idx === puzzleOrder.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontWeight: 900,
                          cursor: isAnswerSubmitted || isSubmittingAnswer || idx === puzzleOrder.length - 1 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {!isAnswerSubmitted && (
                <button
                  type="button"
                  data-testid="mp-submit-answer-btn"
                  disabled={isAnswerSubmitted || isSubmittingAnswer || puzzleOrder.length === 0}
                  onClick={() => submitAnswer(puzzleOrder.join(' | '))}
                  style={{
                    width: '100%',
                    padding: '0.95rem',
                    minHeight: '48px',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    cursor: isAnswerSubmitted || isSubmittingAnswer || puzzleOrder.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmittingAnswer ? 'Đang gửi thứ tự...' : 'Xác nhận thứ tự →'}
                </button>
              )}
            </div>
          )}

          {/* Slider numeric range input */}
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
              <div data-testid="mp-slider-group" style={{ textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '0.8rem 1.65rem',
                    borderRadius: '16px',
                    backgroundColor: 'var(--bg-input)',
                    border: `2px solid ${sliderTouched ? 'var(--primary)' : 'var(--border-strong)'}`,
                    marginBottom: '1rem',
                    minWidth: '175px',
                  }}
                >
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {sliderTouched ? 'Giá trị bạn chọn' : 'Kéo thanh trượt để chọn giá trị'}
                  </span>
                  <span style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                    {sliderValue}{unit}
                  </span>
                </div>

                <div style={{ padding: '0.4rem 0.2rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                    <button
                      type="button"
                      disabled={isAnswerSubmitted || isSubmittingAnswer || sliderValue <= min}
                      onClick={() => {
                        setAnswerError(null);
                        setSliderTouched(true);
                        setSliderValue(prev => clampToSlider(prev - step));
                      }}
                      style={{
                        minWidth: '44px',
                        minHeight: '44px',
                        borderRadius: '10px',
                        border: '1.5px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontWeight: 900,
                        fontSize: '1.15rem',
                        cursor: isAnswerSubmitted || isSubmittingAnswer || sliderValue <= min ? 'not-allowed' : 'pointer',
                        flexShrink: 0,
                      }}
                      aria-label="Giảm 1 bước"
                    >
                      −
                    </button>

                    <div style={{ flex: 1 }}>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={sliderValue}
                        disabled={isAnswerSubmitted || isSubmittingAnswer}
                        onPointerDown={() => setSliderTouched(true)}
                        onTouchStart={() => setSliderTouched(true)}
                        onChange={(e) => {
                          setAnswerError(null);
                          setSliderTouched(true);
                          setSliderValue(clampToSlider(Number(e.target.value)));
                        }}
                        aria-label="Thanh trượt chọn giá trị"
                        style={{
                          width: '100%',
                          height: '12px',
                          cursor: isAnswerSubmitted || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                          accentColor: 'var(--primary)',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        <span>Min: {min}{unit}</span>
                        <span>{Math.round(progressPct)}%</span>
                        <span>Max: {max}{unit}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isAnswerSubmitted || isSubmittingAnswer || sliderValue >= max}
                      onClick={() => {
                        setAnswerError(null);
                        setSliderTouched(true);
                        setSliderValue(prev => clampToSlider(prev + step));
                      }}
                      style={{
                        minWidth: '44px',
                        minHeight: '44px',
                        borderRadius: '10px',
                        border: '1.5px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontWeight: 900,
                        fontSize: '1.15rem',
                        cursor: isAnswerSubmitted || isSubmittingAnswer || sliderValue >= max ? 'not-allowed' : 'pointer',
                        flexShrink: 0,
                      }}
                      aria-label="Tăng 1 bước"
                    >
                      +
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
                    <button
                      type="button"
                      disabled={isAnswerSubmitted || isSubmittingAnswer}
                      onClick={() => {
                        setAnswerError(null);
                        setSliderTouched(true);
                        setSliderValue(min);
                      }}
                      style={{
                        padding: '0.4rem 0.75rem',
                        minHeight: '38px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: sliderTouched && sliderValue === min ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: isAnswerSubmitted || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Chọn Min ({min}{unit})
                    </button>
                    <button
                      type="button"
                      disabled={isAnswerSubmitted || isSubmittingAnswer}
                      onClick={() => {
                        setAnswerError(null);
                        setSliderTouched(true);
                        setSliderValue(clampToSlider(sliderValue));
                      }}
                      style={{
                        padding: '0.4rem 0.75rem',
                        minHeight: '38px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: sliderTouched ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: isAnswerSubmitted || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Giữ mức {sliderValue}{unit}
                    </button>
                    <button
                      type="button"
                      disabled={isAnswerSubmitted || isSubmittingAnswer}
                      onClick={() => {
                        setAnswerError(null);
                        setSliderTouched(true);
                        setSliderValue(max);
                      }}
                      style={{
                        padding: '0.4rem 0.75rem',
                        minHeight: '38px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: sliderTouched && sliderValue === max ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: isAnswerSubmitted || isSubmittingAnswer ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Chọn Max ({max}{unit})
                    </button>
                  </div>
                </div>

                {!isAnswerSubmitted && (
                  <button
                    type="button"
                    data-testid="mp-submit-answer-btn"
                    disabled={isAnswerSubmitted || isSubmittingAnswer || !sliderTouched}
                    onClick={() => {
                      if (!sliderTouched) {
                        setAnswerError('Vui lòng kéo thanh trượt hoặc chọn một mức giá trị trước khi xác nhận.');
                        return;
                      }
                      const safeVal = clampToSlider(sliderValue);
                      submitAnswer(String(safeVal));
                    }}
                    style={{
                      width: '100%',
                      padding: '0.95rem',
                      minHeight: '48px',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '1.05rem',
                      fontWeight: 800,
                      cursor: isAnswerSubmitted || isSubmittingAnswer || !sliderTouched ? 'not-allowed' : 'pointer',
                      opacity: isAnswerSubmitted || isSubmittingAnswer || !sliderTouched ? 0.6 : 1,
                    }}
                  >
                    {isSubmittingAnswer
                      ? 'Đang gửi giá trị...'
                      : sliderTouched
                        ? `Xác nhận giá trị ${sliderValue}${unit} →`
                        : 'Hãy kéo thanh trượt để chọn giá trị'}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Type Answer / Fill in the blank */}
          {(currentQuestion.type === 'FILL_IN_THE_BLANK' || currentQuestion.type === 'TYPE_ANSWER') && (
            <div data-testid="mp-fill-blank-group">
              <label htmlFor="play-blank-input" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Nhập câu trả lời của bạn:
              </label>
              <input
                id="play-blank-input"
                type="text"
                disabled={isAnswerSubmitted || isSubmittingAnswer}
                maxLength={MAX_ANSWER_LENGTH}
                value={textInputAnswer}
                onChange={(e) => {
                  setAnswerError(null);
                  setTextInputAnswer(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitAnswer(textInputAnswer);
                  }
                }}
                placeholder="Gõ đáp án tại đây..."
                style={{
                  width: '100%',
                  padding: '1rem 1.15rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '1.05rem',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              {!isAnswerSubmitted && (
                <button
                  type="button"
                  data-testid="mp-submit-answer-btn"
                  disabled={isAnswerSubmitted || isSubmittingAnswer || !textInputAnswer.trim()}
                  onClick={() => submitAnswer(textInputAnswer)}
                  style={{
                    width: '100%',
                    marginTop: '1rem',
                    padding: '0.95rem',
                    minHeight: '48px',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    cursor: isAnswerSubmitted || isSubmittingAnswer || !textInputAnswer.trim() ? 'not-allowed' : 'pointer',
                    opacity: isAnswerSubmitted || isSubmittingAnswer || !textInputAnswer.trim() ? 0.6 : 1,
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {isSubmittingAnswer ? (
                    <>
                      <SpinnerIcon size={18} />
                      <span>Đang gửi câu trả lời...</span>
                    </>
                  ) : (
                    'Gửi câu trả lời →'
                  )}
                </button>
              )}
            </div>
          )}

          {/* Crossword (Unified with SoloPlayer solo-crossword-box & letter slots) */}
          {currentQuestion.type === 'CROSSWORD' && (() => {
            const specQ =
              loadedGameSpec?.questions?.[currentQuestion.questionIndex || 0] ||
              loadedGameSpec?.questions?.find((item) => item.id === currentQuestion.id);
            const expectedWordLength =
              currentQuestion.crosswordWordLength && currentQuestion.crosswordWordLength > 0
                ? currentQuestion.crosswordWordLength
                : normalizeCrosswordPreview(specQ?.crosswordAnswer || specQ?.correctAnswer || '').length;
            const typedPreview = normalizeCrosswordPreview(textInputAnswer);

            return (
              <div data-testid="solo-crossword-box">
                {currentQuestion.crosswordClue && (
                  <div
                    style={{
                      backgroundColor: 'rgba(56, 189, 248, 0.1)',
                      padding: '0.95rem 1.25rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: 'var(--accent-sky)',
                      marginBottom: '1rem',
                      fontSize: '0.95rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <SparklesIcon size={18} />
                    <span>Gợi ý: <strong style={{ color: 'var(--text-primary)' }}>{currentQuestion.crosswordClue}</strong></span>
                  </div>
                )}

                {expectedWordLength > 0 && expectedWordLength <= 20 && (
                  <div
                    data-testid="solo-crossword-slots"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                      gap: '6px',
                      marginBottom: '0.85rem',
                    }}
                  >
                    {Array.from({ length: expectedWordLength }).map((_, slotIdx) => {
                      const ch = typedPreview[slotIdx] || '';
                      return (
                        <span
                          key={slotIdx}
                          style={{
                            width: '36px',
                            height: '40px',
                            borderRadius: '8px',
                            backgroundColor: ch ? 'var(--bg-surface)' : 'var(--bg-input)',
                            border: `2px solid ${ch ? 'var(--primary)' : 'var(--border-strong)'}`,
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
                    })}
                  </div>
                )}

                <label htmlFor="play-crossword-input" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Nhập từ khóa ô chữ {expectedWordLength > 0 ? `(${expectedWordLength} chữ cái)` : ''}:
                </label>
                <input
                  id="play-crossword-input"
                  type="text"
                  disabled={isAnswerSubmitted || isSubmittingAnswer}
                  maxLength={MAX_ANSWER_LENGTH}
                  value={textInputAnswer}
                  onChange={(e) => {
                    setAnswerError(null);
                    setTextInputAnswer(e.target.value.toUpperCase());
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submitAnswer(textInputAnswer);
                    }
                  }}
                  placeholder="Nhập từ khóa ô chữ (VD: ANTOAN)..."
                  style={{
                    width: '100%',
                    padding: '1rem 1.15rem',
                    backgroundColor: 'var(--bg-input)',
                    border: '1.5px solid var(--border-strong)',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                {textInputAnswer.trim().length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--accent-sky)', fontWeight: 700 }}>
                    Từ khóa chuẩn hóa: <strong>{typedPreview}</strong> ({typedPreview.length} ký tự)
                  </div>
                )}
                {!isAnswerSubmitted && (
                  <button
                    type="button"
                    data-testid="mp-submit-answer-btn"
                    disabled={isAnswerSubmitted || isSubmittingAnswer || !textInputAnswer.trim()}
                    onClick={() => submitAnswer(textInputAnswer)}
                    style={{
                      width: '100%',
                      marginTop: '1rem',
                      padding: '0.95rem',
                      minHeight: '48px',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '1.05rem',
                      fontWeight: 800,
                      cursor: isAnswerSubmitted || isSubmittingAnswer || !textInputAnswer.trim() ? 'not-allowed' : 'pointer',
                      opacity: isAnswerSubmitted || isSubmittingAnswer || !textInputAnswer.trim() ? 0.6 : 1,
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    {isSubmittingAnswer ? (
                      <>
                        <SpinnerIcon size={18} />
                        <span>Đang gửi từ khóa...</span>
                      </>
                    ) : (
                      'Gửi từ khóa →'
                    )}
                  </button>
                )}
              </div>
            );
          })()}

          {answerError && !isAnswerSubmitted && (
            <div
              role="alert"
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
                color: '#ef4444',
                fontSize: '0.88rem',
                fontWeight: 700,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
              }}
            >
              <AlertTriangleIcon size={16} />
              <span>{answerError}</span>
            </div>
          )}

          {/* Feedback banner after answer submission */}
          {isAnswerSubmitted && (
            <div
              role="status"
              style={{
                marginTop: '1.5rem',
                textAlign: 'center',
                color: 'var(--accent-sky)',
                fontWeight: 700,
                padding: '0.9rem',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderRadius: '12px',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
              }}
            >
              <CheckIcon size={18} />
              <span>Đã ghi nhận câu trả lời! Đang đợi công bố kết quả...</span>
            </div>
          )}
        </div>
      )}

      {/* 4. Màn hình Công bố Đáp án & Kết quả Cá nhân (Reveal Screen — Non-Adventure, Unified with SoloPlayer) */}
      {!isAdventureGame && screen === 'reveal' && (
        <div
          data-testid="solo-question-feedback"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '2px solid var(--border-subtle)',
            borderRadius: '24px',
            padding: 'clamp(1.25rem, 3.5vw, 2rem)',
            textAlign: 'center',
            boxShadow: 'var(--card-shadow)',
            animation: 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {sessionMode === 'EXAM' && !answersPublished ? (
            <div data-testid="exam-reveal-redacted" style={{ marginBottom: '1.25rem' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.85rem 1.8rem',
                  borderRadius: '16px',
                  fontWeight: 900,
                  fontSize: '1.2rem',
                  backgroundColor: 'rgba(56, 189, 248, 0.16)',
                  color: 'var(--accent-sky)',
                  border: '1.5px solid rgba(56, 189, 248, 0.45)',
                }}
              >
                <CheckIcon size={22} />
                <span>ĐÃ GHI NHẬN LƯỢT TRẢ LỜI</span>
              </div>
              <p style={{ marginTop: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                Chế độ <strong>Thi nghiêm túc (EXAM)</strong>: Đáp án đúng và giải thích được bảo mật cho đến khi toàn bộ kỳ thi kết thúc và Ban tổ chức công bố.
              </p>
            </div>
          ) : (
            <>
              {personalResult ? (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      padding: '0.75rem 1.75rem',
                      borderRadius: '16px',
                      fontWeight: 900,
                      fontSize: '1.25rem',
                      backgroundColor: personalResult.isCorrect ? 'var(--k-green)' : 'var(--k-red)',
                      color: '#ffffff',
                      boxShadow: personalResult.isCorrect
                        ? '0 4px 0 var(--k-green-dark)'
                        : '0 4px 0 var(--k-red-dark)',
                    }}
                  >
                    {personalResult.isCorrect ? <CheckIcon size={24} /> : <XMarkIcon size={24} />}
                    <span>{personalResult.isCorrect ? 'CHÍNH XÁC!' : 'CHƯA ĐÚNG!'}</span>
                  </div>

                  <div
                    style={{
                      marginTop: '0.9rem',
                      fontSize: '1.65rem',
                      fontWeight: 900,
                      color: personalResult.isCorrect ? 'var(--accent-emerald)' : 'var(--text-muted)',
                    }}
                  >
                    {personalResult.pointsEarned > 0 ? `+${personalResult.pointsEarned.toLocaleString()} điểm` : '+0 điểm'}
                  </div>

                  {personalResult.streak && personalResult.streak > 1 && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        marginTop: '0.6rem',
                        padding: '0.35rem 0.85rem',
                        borderRadius: '20px',
                        backgroundColor: 'rgba(255, 166, 2, 0.2)',
                        border: '1.5px solid var(--k-yellow)',
                        color: 'var(--k-yellow)',
                        fontWeight: 900,
                        fontSize: '0.92rem',
                      }}
                    >
                      <FlameIcon size={16} />
                      <span>Chuỗi đúng liên tiếp x{personalResult.streak}!</span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.75rem 1.75rem',
                      borderRadius: '16px',
                      fontWeight: 900,
                      fontSize: '1.15rem',
                      backgroundColor: 'var(--k-yellow)',
                      color: 'var(--k-yellow-ink)',
                      boxShadow: '0 4px 0 var(--k-yellow-dark)',
                    }}
                  >
                    <ClockIcon size={22} />
                    <span>CHƯA TRẢ LỜI / HẾT GIỜ</span>
                  </div>
                  <div style={{ marginTop: '0.65rem', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                    +0 điểm
                  </div>
                </div>
              )}

              {/* Question Prompt & Answer Comparison Strip (Unified with SoloPlayer) */}
              {currentQuestion?.question && (
                <div
                  style={{
                    margin: '0 0 0.85rem 0',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.94rem',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    lineHeight: 1.4,
                  }}
                >
                  {currentQuestion.question}
                </div>
              )}

              {correctAnswer && (
                <div
                  data-testid="mp-reveal-answer-comparison"
                  style={{
                    margin: '0.85rem 0',
                    padding: '1rem 1.15rem',
                    backgroundColor: 'var(--bg-card)',
                    borderRadius: '14px',
                    border: '1px solid var(--border-subtle)',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.75rem 1.25rem',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.75rem',
                          textTransform: 'uppercase',
                          fontWeight: 800,
                          letterSpacing: '0.04em',
                          display: 'block',
                          marginBottom: '0.2rem',
                        }}
                      >
                        CÂU TRẢ LỜI CỦA BẠN
                      </span>
                      <strong
                        data-testid="mp-reveal-my-answer"
                        style={{
                          color: personalResult?.isCorrect ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          fontSize: '1rem',
                          fontWeight: 900,
                        }}
                      >
                        {submittedAnswerRecord || (personalResult as any)?.answer || 'Chưa trả lời (Hết thời gian)'}
                      </strong>
                    </div>

                    <div>
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.75rem',
                          textTransform: 'uppercase',
                          fontWeight: 800,
                          letterSpacing: '0.04em',
                          display: 'block',
                          marginBottom: '0.2rem',
                        }}
                      >
                        ĐÁP ÁN ĐÚNG
                      </span>
                      <strong
                        data-testid="solo-feedback-correct-answer"
                        style={{
                          color: 'var(--accent-emerald)',
                          fontSize: '1.15rem',
                          fontWeight: 900,
                        }}
                      >
                        {correctAnswer}
                      </strong>
                    </div>
                  </div>

                  {/* Choice Review Grid highlighting Correct vs Wrong Selected (matching SoloPlayer) */}
                  {Array.isArray(currentQuestion?.choices) &&
                    currentQuestion!.choices!.length > 0 &&
                    (currentQuestion!.type === 'MULTIPLE_CHOICE' ||
                      currentQuestion!.type === 'QUIZ' ||
                      currentQuestion!.type === 'QUICK_BUTTON' ||
                      currentQuestion!.type === 'TRUE_FALSE') && (
                      <div
                        data-testid="mp-reveal-choices-review"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
                          gap: '0.5rem',
                          marginTop: '0.85rem',
                          paddingTop: '0.85rem',
                          borderTop: '1px solid var(--border-subtle)',
                        }}
                      >
                        {currentQuestion!.choices!.map((choice, cIdx) => {
                          const myAns = (submittedAnswerRecord || (personalResult as any)?.answer || '').trim();
                          const normChoice = choice.replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '').trim().toLowerCase();
                          const normCorrect = correctAnswer.replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '').trim().toLowerCase();
                          const normMy = myAns.replace(/^[A-Da-d1-4][\.\)\:\-]\s*/, '').trim().toLowerCase();
                          const isCorrectOption =
                            choice.trim().toLowerCase() === correctAnswer.trim().toLowerCase() ||
                            (Boolean(normChoice) && normChoice === normCorrect);
                          const isMySelected =
                            Boolean(myAns) &&
                            (choice.trim().toLowerCase() === myAns.toLowerCase() ||
                              (Boolean(normChoice) && normChoice === normMy));
                          const isWrongSelected = isMySelected && !isCorrectOption;

                          return (
                            <div
                              key={cIdx}
                              data-testid={`mp-reveal-choice-${cIdx}`}
                              data-feedback-state={
                                isCorrectOption ? 'correct' : isWrongSelected ? 'wrong' : 'neutral'
                              }
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '0.5rem',
                                padding: '0.55rem 0.75rem',
                                borderRadius: '10px',
                                backgroundColor: isCorrectOption
                                  ? 'rgba(16, 185, 129, 0.16)'
                                  : isWrongSelected
                                    ? 'rgba(239, 68, 68, 0.16)'
                                    : 'var(--bg-surface)',
                                border: `1.5px solid ${
                                  isCorrectOption
                                    ? '#10b981'
                                    : isWrongSelected
                                      ? '#ef4444'
                                      : 'var(--border-subtle)'
                                }`,
                                color: 'var(--text-primary)',
                                fontSize: '0.86rem',
                                fontWeight: isCorrectOption || isWrongSelected ? 800 : 600,
                                opacity: isCorrectOption || isWrongSelected ? 1 : 0.65,
                              }}
                            >
                              <span style={{ wordBreak: 'break-word' }}>{choice}</span>
                              {isCorrectOption && (
                                <span style={{ color: 'var(--accent-emerald)', fontWeight: 900, fontSize: '0.76rem', flexShrink: 0 }}>
                                  ✓ Đúng
                                </span>
                              )}
                              {isWrongSelected && (
                                <span style={{ color: 'var(--accent-rose)', fontWeight: 900, fontSize: '0.76rem', flexShrink: 0 }}>
                                  ✕ Bạn chọn
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                  {explanation && (
                    <div
                      data-testid="solo-feedback-explanation"
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.88rem',
                        margin: '0.85rem 0 0 0',
                        lineHeight: '1.48',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid var(--border-subtle)',
                        maxHeight: '150px',
                        overflowY: 'auto',
                      }}
                    >
                      <strong style={{ color: 'var(--accent-sky)' }}>💡 Giải thích: </strong>
                      <span>{explanation}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Top 10 Mini Leaderboard */}
          {leaderboard.length > 0 && (
          <div
            style={{
              marginTop: '1.25rem',
              textAlign: 'left',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '14px',
              padding: '1.15rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <TrophyIcon size={16} />
                <span>BẢNG XẾP HẠNG (TOP 10)</span>
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                Tổng {leaderboard.length} thí sinh
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.925rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'left' }}>#</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'left' }}>Người chơi</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 10).map((entry) => {
                    const isMe = entry.playerId === playerId;
                    return (
                      <tr
                        key={entry.playerId}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          backgroundColor: isMe ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                          fontWeight: isMe ? 800 : 500,
                        }}
                      >
                        <td style={{ padding: '0.6rem 0.5rem', color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#cbd5e1' : entry.rank === 3 ? '#d97706' : 'var(--text-muted)', fontWeight: entry.rank <= 3 ? 800 : 600 }}>
                          #{entry.rank}
                        </td>
                        <td style={{ padding: '0.6rem 0.5rem', color: isMe ? 'var(--accent-sky)' : 'var(--text-primary)' }}>
                          {entry.displayName} {isMe ? ' (Bạn)' : ''}
                        </td>
                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', color: 'var(--accent-emerald)', fontWeight: 800 }}>
                          {entry.score}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}

          <div
            data-testid="mp-waiting-host-next"
            style={{
              marginTop: '1rem',
              fontSize: '0.84rem',
              fontWeight: 800,
              color: 'var(--text-muted)',
            }}
          >
            ⏳ Đang chờ Chủ phòng chuyển sang câu tiếp theo...
          </div>
        </div>
      )}

      {/* 5. Màn hình Kết thúc (Finish Screen — Non-Adventure) */}
      {!isAdventureGame && screen === 'finish' && (() => {
        const myEntry = leaderboard.find((e) => e.playerId === playerId);
        const totalQs = myEntry?.totalQuestions || currentQuestion?.totalQuestions || 5;
        const correctCnt = myEntry?.correctCount ?? 0;
        const maxPossible = myEntry?.maxPossibleScore || totalQs * 100;
        const evalRes = evaluateFrontendPerformance(
          correctCnt,
          totalQs,
          sessionMode === 'EXAM' ? 50 : undefined
        );
        const isPassedVal = myEntry?.isPassed !== undefined ? myEntry.isPassed : evalRes.isPassed;

        return (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div style={{ color: '#facc15', marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
            <TrophyIcon size={64} />
          </div>
          <h2 style={{ color: '#facc15', fontSize: '2rem', margin: '0 0 0.5rem 0', fontWeight: 900 }}>
            Trận Đấu Kết Thúc!
          </h2>

          {examClosedByBtc && (
            <div
              data-testid="play-exam-closed-banner"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.14)',
                border: '1.5px solid var(--accent-amber)',
                borderRadius: '12px',
                padding: '0.75rem 1rem',
                margin: '0.75rem 0',
                color: 'var(--accent-amber)',
                fontWeight: 800,
                fontSize: '0.9rem',
              }}
            >
              Đợt thi đã kết thúc — Hệ thống đã tự động ghi nhận kết quả của bạn.
            </div>
          )}

          <div
            data-testid="play-finish-evaluation"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '1.5rem',
              margin: '1.5rem 0',
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>
              TỔNG ĐIỂM CHUNG CUỘC
            </span>
            <div style={{ color: 'var(--accent-emerald)', fontSize: '2.35rem', fontWeight: 900, margin: '0.25rem 0' }}>
              {playerScore} <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>/ {maxPossible}</span>
            </div>

            <div style={{ margin: '0.6rem 0', fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Đúng {correctCnt}/{totalQs} câu ({evalRes.accuracyPercent}%)
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <span
                data-testid="result-tier-label"
                style={{
                  padding: '0.35rem 0.9rem',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(16, 185, 129, 0.14)',
                  color: 'var(--accent-emerald)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  fontSize: '0.88rem',
                  fontWeight: 900,
                }}
              >
                {evalRes.tierLabel}
              </span>

              {sessionMode === 'EXAM' && isPassedVal !== null && (
                <span
                  data-testid="exam-pass-status-badge"
                  style={{
                    padding: '0.35rem 0.9rem',
                    borderRadius: '999px',
                    backgroundColor: isPassedVal ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)',
                    color: isPassedVal ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                    border: isPassedVal
                      ? '1px solid var(--accent-emerald)'
                      : '1px solid var(--accent-rose)',
                    fontSize: '0.88rem',
                    fontWeight: 900,
                  }}
                >
                  {isPassedVal ? 'ĐẠT' : 'CHƯA ĐẠT'}
                </span>
              )}
            </div>

            {finalRank !== null && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.45rem 1rem',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent-sky)',
                  fontWeight: 800,
                  fontSize: '1rem',
                  marginTop: '0.75rem',
                }}
              >
                <TrophyIcon size={16} />
                <span>Vị trí thứ #{finalRank} / {leaderboard.length} người chơi</span>
              </div>
            )}
          </div>

          {sessionMode === 'EXAM' && publishedAnswersList.length > 0 && (
            <div
              data-testid="published-exam-answers-list"
              style={{
                textAlign: 'left',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '14px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--accent-emerald)', marginBottom: '0.5rem' }}>
                Đáp án chính thức đã được Ban tổ chức công bố:
              </div>
              {publishedAnswersList.map((item, idx) => (
                <div key={item.id || idx} style={{ padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.82rem' }}>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                    Câu {idx + 1}: {item.question}
                  </div>
                  <div style={{ color: 'var(--accent-emerald)', fontWeight: 800 }}>
                    Đáp án đúng: {item.correctAnswer}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={confirmLeaveRoom}
              style={{
                width: '100%',
                padding: '0.95rem',
                minHeight: '48px',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1.05rem',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Tham gia trò chơi khác &rarr;
            </button>
          </div>
        </div>
        );
      })()}
    </div>
  );
};
