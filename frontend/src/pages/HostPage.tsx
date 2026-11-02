import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../components/ToastContext.js';
import { GameSocketClient, ConnectionStatus } from '../services/socket.js';
import {
  fetchRoomQr,
  closeMultiplayerRoom,
  downloadGameScoreboardExport,
  grantParticipantRetakeApi,
  closeGameExamApi,
} from '../services/api.js';
import { soundManager } from '../services/audio.js';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FlameIcon,
  GamepadIcon,
  InfoIcon,
  LockIcon,
  PlayIcon,
  QrCodeIcon,
  RefreshIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/Icons.js';
import {
  evaluateFrontendPerformance,
  type LeaderboardEntry,
  type SanitizedQuestion,
  type SessionMode,
} from '../types/index.js';

interface HostPageProps {
  initialRoomCode?: string;
  initialHostToken?: string;
  initialGameId?: string;
  onBackToSetup?: () => void;
}

export const HostPage: React.FC<HostPageProps> = ({
  initialRoomCode,
  initialHostToken,
  initialGameId,
  onBackToSetup,
}) => {
  const toast = useToast();

  const [roomCode, setRoomCode] = useState(
    initialRoomCode || sessionStorage.getItem('active_host_room') || ''
  );
  const [hostToken, setHostToken] = useState(
    initialHostToken || sessionStorage.getItem('active_host_token') || ''
  );
  const [activeGameId, setActiveGameId] = useState(initialGameId || '');
  const [gameTitle, setGameTitle] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [isLocked, setIsLocked] = useState(false);

  // V2 Host State (Session Mode, Exam Answers Publish, Leaderboard Visibility, Audio)
  const [sessionMode, setSessionMode] = useState<SessionMode>('PLAY');
  const [answersPublished, setAnswersPublished] = useState<boolean>(false);
  const [showExamLeaderboardToPlayers, setShowExamLeaderboardToPlayers] = useState<boolean>(false);
  const [passThresholdPercent, setPassThresholdPercent] = useState<number>(50);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(() => soundManager.isMuted());

  const handleToggleAudioMute = () => {
    const nextMuted = soundManager.toggleMute();
    setIsAudioMuted(nextMuted);
  };

  // Host screens: 'lobby' | 'question' | 'reveal' | 'finish'
  const [viewState, setViewState] = useState<'lobby' | 'question' | 'reveal' | 'finish'>('lobby');
  const [copiedLink, setCopiedLink] = useState(false);
  const [isLinkVisible, setIsLinkVisible] = useState<boolean>(true);

  const [players, setPlayers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [currentQuestion, setCurrentQuestion] = useState<SanitizedQuestion | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [answerCount, setAnswerCount] = useState(0);

  const [revealData, setRevealData] = useState<{
    correctAnswer: string;
    explanation?: string;
    leaderboard: LeaderboardEntry[];
  } | null>(null);

  const [finishData, setFinishData] = useState<{
    winner?: LeaderboardEntry;
    leaderboard: LeaderboardEntry[];
  } | null>(null);

  const socketRef = useRef<GameSocketClient | null>(null);
  const timerIntervalRef = useRef<any>(null);
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
    if (viewState !== 'question' || timeRemaining <= 0) return;
    soundManager.checkCountdownTick(timeRemaining);
  }, [viewState, timeRemaining]);

  const connectToSocket = (code: string, token: string) => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    const client = new GameSocketClient();
    socketRef.current = client;

    client.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    client.onOpen(() => {
      client.send({
        type: 'host.join',
        roomCode: code,
        hostToken: token,
      });
    });

    client.on('room.joined', (msg: any) => {
      setGameTitle(msg.title || 'Trò chơi nhiều người');
      if (msg.gameId) {
        setActiveGameId(msg.gameId);
      }
      if (msg.sessionMode === 'EXAM' || msg.sessionMode === 'PLAY') {
        setSessionMode(msg.sessionMode);
      }
      if (typeof msg.answersPublished === 'boolean') {
        setAnswersPublished(msg.answersPublished);
      }
      if (typeof msg.showExamLeaderboardToPlayers === 'boolean') {
        setShowExamLeaderboardToPlayers(msg.showExamLeaderboardToPlayers);
      }
      if (typeof msg.passThresholdPercent === 'number') {
        setPassThresholdPercent(msg.passThresholdPercent);
      }
      if (msg.audioConfig) {
        soundManager.configure(msg.audioConfig);
        if (msg.state === 'QUESTION_ACTIVE') {
          soundManager.startBackgroundMusic();
        }
      }
      if (Array.isArray(msg.players)) {
        setPlayers(msg.players.map((p: any) => ({ id: p.id, displayName: p.displayName })));
      }
      if (typeof msg.isLocked === 'boolean') {
        setIsLocked(msg.isLocked);
      }
      if (msg.state === 'WAITING') {
        setViewState('lobby');
      } else if (msg.state === 'QUESTION_ACTIVE') {
        setViewState('question');
      } else if (msg.state === 'QUESTION_REVEAL') {
        setViewState('reveal');
      } else if (msg.state === 'FINISHED') {
        setViewState('finish');
      }
      toast.info(`Đã kết nối với phòng ${code}`, 'Kết nối thành công');
    });

    client.on('answers.published', () => {
      setAnswersPublished(true);
      toast.success('Đã công bố đáp án chính thức cho toàn bộ thí sinh!', 'Đã công bố đáp án');
    });

    client.on('leaderboard.visibilityChanged', (msg: any) => {
      if (typeof msg.showExamLeaderboardToPlayers === 'boolean') {
        setShowExamLeaderboardToPlayers(msg.showExamLeaderboardToPlayers);
      }
    });

    client.on('room.lockStateChanged', (msg: any) => {
      if (typeof msg.isLocked === 'boolean') {
        setIsLocked(msg.isLocked);
        toast.info(
          msg.isLocked ? 'Phòng chơi đã được khóa đối với người mới.' : 'Phòng chơi đã mở lại.',
          'Trạng thái phòng'
        );
      }
    });

    client.on('lobby.playerJoined', (msg: any) => {
      if (msg.player) {
        setPlayers((prev) => {
          if (prev.some((p) => p.id === msg.player.id)) return prev;
          return [...prev, { id: msg.player.id, displayName: msg.player.displayName }];
        });
        toast.info(`${msg.player.displayName} đã tham gia phòng.`, 'Người chơi mới');
      }
    });

    client.on('lobby.playerLeft', (msg: any) => {
      if (msg.playerId) {
        setPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
      }
    });

    client.on('game.started', () => {
      soundManager.playStart();
      soundManager.startBackgroundMusic();
      setViewState('question');
      toast.success('Chủ phòng đã kích hoạt bắt đầu trò chơi!', 'Bắt đầu');
    });

    client.on('exam.closed', () => {
      toast.info('Đợt thi đã kết thúc — Hệ thống đã tự động thu bài của toàn bộ thí sinh.', 'Đã thu bài');
    });

    client.on('question.started', (msg: any) => {
      hasPlayedFinishSfxRef.current = false;
      if (!soundManager.getIsPlaying()) {
        soundManager.startBackgroundMusic();
      }
      setCurrentQuestion(msg.question);
      setAnswerCount(typeof msg.answeredCount === 'number' ? msg.answeredCount : 0);
      setViewState('question');
      const remainingSec = msg.question.deadlineAt
        ? Math.max(0, Math.ceil((msg.question.deadlineAt - Date.now()) / 1000))
        : typeof msg.question.remainingTimeSeconds === 'number'
          ? Math.max(0, Math.ceil(msg.question.remainingTimeSeconds))
          : (msg.question.timePerQuestion || 20);
      startTimer(remainingSec || 20);
      toast.info(`Bắt đầu câu hỏi số ${(msg.question.questionIndex || 0) + 1}!`, 'Câu hỏi mới');
    });

    client.on('question.answerCountUpdated', (msg: any) => {
      if (typeof msg.answeredCount === 'number') {
        setAnswerCount(msg.answeredCount);
      } else {
        setAnswerCount((prev) => prev + 1);
      }
    });

    client.on('question.answerReceived', (msg: any) => {
      if (typeof msg.answeredCount === 'number') {
        setAnswerCount(msg.answeredCount);
      }
    });

    client.on('question.revealed', (msg: any) => {
      stopTimer();
      setRevealData({
        correctAnswer: msg.correctAnswer,
        explanation: msg.explanation,
        leaderboard: msg.leaderboard || [],
      });
      setViewState('reveal');
      toast.info('Hết giờ! Đang công bố kết quả và bảng xếp hạng.', 'Công bố kết quả');
    });

    client.on('game.finished', (msg: any) => {
      stopTimer();
      soundManager.stopBackgroundMusic();
      if (!hasPlayedFinishSfxRef.current) {
        hasPlayedFinishSfxRef.current = true;
        soundManager.playSfx('finish');
      }
      setFinishData({
        winner: msg.winner,
        leaderboard: msg.leaderboard || [],
      });
      setViewState('finish');
      toast.success('Trò chơi đã hoàn thành xuất sắc!', 'Kết thúc trò chơi');
    });

    client.on('error', (msg: any) => {
      toast.error(msg.message || 'Lỗi từ máy chủ phòng chơi.', 'Lỗi');
    });

    client.connect();
  };

  const handleInitExistingRoom = async (code: string, token: string) => {
    try {
      const qrData = await fetchRoomQr(code);
      setJoinUrl(qrData.joinUrl);
      setQrDataUrl(qrData.qrDataUrl);
    } catch {
      setJoinUrl(`${window.location.origin}/?room=${code}`);
    }
    setViewState('lobby');
    connectToSocket(code, token);
  };

  useEffect(() => {
    const effCode =
      initialRoomCode || (sessionStorage.getItem('active_host_room') || '').trim();
    const effToken =
      initialHostToken || (sessionStorage.getItem('active_host_token') || '').trim();

    if (effCode && effToken) {
      setRoomCode(effCode);
      setHostToken(effToken);
      handleInitExistingRoom(effCode, effToken);
    } else {
      if (onBackToSetup) {
        onBackToSetup();
      } else {
        window.history.replaceState({}, '', '/?tab=analytics');
        window.location.href = '/?tab=analytics';
      }
    }

    return () => {
      stopTimer();
      soundManager.stopAll();
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [initialRoomCode, initialHostToken, onBackToSetup]);

  const handleToggleLock = () => {
    if (socketRef.current) {
      socketRef.current.send({
        type: isLocked ? 'host.unlock' : 'host.lock', // taste-skill-ignore: protocol message
      });
    }
  };

  const handleStartGame = () => {
    if (socketRef.current) {
      socketRef.current.send({ type: 'host.start' });
    }
  };

  const handleNextQuestion = () => {
    if (socketRef.current) {
      socketRef.current.send({ type: 'host.next' });
    }
  };

  const handlePublishAnswers = () => {
    if (socketRef.current && hostToken) {
      socketRef.current.send({
        type: 'host.publishAnswers',
        hostToken,
      });
    }
  };

  const handleToggleExamLeaderboard = () => {
    if (socketRef.current && hostToken) {
      socketRef.current.send({
        type: 'host.toggleLeaderboard',
        hostToken,
        show: !showExamLeaderboardToPlayers,
      });
    }
  };

  const handleHostGrantRetake = async (participantId: string | null | undefined, displayName: string) => {
    if (!activeGameId || !participantId) return;
    try {
      await grantParticipantRetakeApi(activeGameId, participantId, 1);
      toast.success(`Đã cấp thêm 1 lượt thi lại cho "${displayName}"!`, 'Cấp quyền thi lại');
    } catch (err: any) {
      toast.error(err.message || 'Không thể cấp quyền thi lại.', 'Lỗi');
    }
  };

  const handleHostCloseExam = async () => {
    if (!activeGameId) return;
    try {
      const res = await closeGameExamApi(activeGameId, hostToken || undefined);
      toast.success(
        `Đã kết thúc đợt thi! Tự động nộp bài cho ${res.totalAutoSubmitted} thí sinh.`,
        'Kết thúc đợt thi'
      );
    } catch (err: any) {
      toast.error(err.message || 'Không thể kết thúc đợt thi.', 'Lỗi');
    }
  };

  const handleToggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      // Fallback if browser forbids fullscreen
    }
  };

  const handleRestart = () => {
    stopTimer();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    try {
      sessionStorage.removeItem('active_host_room');
      sessionStorage.removeItem('active_host_token');
    } catch {}
    setRoomCode('');
    setHostToken('');
    setPlayers([]);
    setCurrentQuestion(null);
    setRevealData(null);
    setFinishData(null);
    if (onBackToSetup) {
      onBackToSetup();
    } else {
      window.history.replaceState({}, '', '/?tab=analytics');
      window.location.href = '/?tab=analytics';
    }
  };

  const handleCancelRoom = async () => {
    if (roomCode) {
      try {
        await closeMultiplayerRoom(roomCode, hostToken);
      } catch {
        // Continue clean cleanup even if server call fails
      }
    }
    handleRestart();
  };

  // Kahoot color config for 4 choices (A: Red, B: Blue, C: Yellow, D: Green)
  const choiceColors = [
    { bg: 'var(--k-red)', dark: 'var(--k-red-dark)', border: 'var(--k-red-dark)', icon: '▲', label: 'A', text: '#ffffff' },
    { bg: 'var(--k-blue)', dark: 'var(--k-blue-dark)', border: 'var(--k-blue-dark)', icon: '◆', label: 'B', text: '#ffffff' },
    { bg: 'var(--k-yellow)', dark: 'var(--k-yellow-dark)', border: 'var(--k-yellow-dark)', icon: '●', label: 'C', text: 'var(--k-yellow-ink)' },
    { bg: 'var(--k-green)', dark: 'var(--k-green-dark)', border: 'var(--k-green-dark)', icon: '■', label: 'D', text: '#ffffff' },
  ];

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0.75rem 0.5rem 2rem 0.5rem' }}>
      {/* Reconnect & Connection Status Banners */}
      {connectionStatus === 'reconnecting' && (
        <div
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid var(--accent-amber)',
            color: 'var(--accent-amber)',
            padding: '0.65rem 1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
            fontWeight: 800,
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>⏳</span>
          <span>Đang kết nối lại máy chủ phòng chơi... Vui lòng chờ trong giây lát.</span>
        </div>
      )}

      {connectionStatus === 'disconnected' && (
        <div
          style={{
            backgroundColor: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            padding: '0.65rem 1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
            fontWeight: 800,
            fontSize: '0.88rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <AlertTriangleIcon size={16} /> Mất kết nối tới máy chủ phòng chơi.
          </span>
          <button
            type="button"
            onClick={() => connectToSocket(roomCode, hostToken)}
            style={{
              backgroundColor: 'var(--accent-rose)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.35rem 0.75rem',
              fontWeight: 800,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              minHeight: '36px',
            }}
          >
            <RefreshIcon size={14} /> Kết nối lại
          </button>
        </div>
      )}

      {/* Màn hình Sảnh Chờ (Lobby) — Chế độ TRÌNH CHIẾU / GAME SHOW */}
      {viewState === 'lobby' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '2px solid var(--accent-sky)',
            borderRadius: '24px',
            padding: '2rem 1.5rem',
            textAlign: 'center',
            boxShadow: '0 20px 50px -10px rgba(56, 189, 248, 0.25)',
          }}
        >
          {/* Top Bar Điều Khiển Trình Chiếu */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '2rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid var(--border-subtle)',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <button
              type="button"
              onClick={handleCancelRoom}
              style={{
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '10px',
                padding: '0.65rem 1.25rem',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                minHeight: '44px',
              }}
            >
              <ArrowLeftIcon size={16} /> Quay về Kho Game
            </button>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="host-toggle-lock-btn"
                onClick={handleToggleLock}
                style={{
                  backgroundColor: isLocked ? 'rgba(245, 158, 11, 0.16)' : 'var(--bg-card)',
                  color: isLocked ? 'var(--accent-amber)' : 'var(--text-primary)',
                  border: `1px solid ${isLocked ? 'var(--accent-amber)' : 'var(--border-strong)'}`,
                  borderRadius: '10px',
                  padding: '0.65rem 1.15rem',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  minHeight: '44px',
                }}
                title={
                  isLocked
                    ? 'Mở khóa để cho phép người chơi mới tham gia phòng'
                    : 'Khóa phòng để chặn người chơi mới tham gia'
                }
              >
                <LockIcon size={15} />
                <span>{isLocked ? 'Mở khóa phòng' : 'Khóa phòng'}</span>
              </button>

              <button
                type="button"
                data-testid="audio-mute-toggle-btn"
                onClick={handleToggleAudioMute}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.05rem',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                {isAudioMuted ? '🔇 Bật nhạc' : '🔊 Tắt nhạc'}
              </button>

              {sessionMode === 'EXAM' && activeGameId && (
                <button
                  type="button"
                  data-testid="host-close-exam-btn"
                  onClick={handleHostCloseExam}
                  style={{
                    backgroundColor: 'rgba(244, 63, 94, 0.16)',
                    color: 'var(--accent-rose)',
                    border: '1px solid var(--accent-rose)',
                    borderRadius: '10px',
                    padding: '0.65rem 1.05rem',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  Kết thúc đợt thi &amp; Thu bài
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleFullscreen}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.15rem',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                Toàn màn hình
              </button>

              <button
                type="button"
                onClick={handleStartGame}
                disabled={players.length === 0}
                style={{
                  backgroundColor: players.length === 0 ? 'var(--border-strong)' : '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.7rem 1.75rem',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: players.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  minHeight: '44px',
                }}
              >
                <span>Bắt đầu trò chơi</span>
                <ArrowRightIcon size={16} />
              </button>
            </div>
          </div>

          {/* Tiêu đề Trình Chiếu */}
          <h1
            style={{
              color: 'var(--accent-sky)',
              fontSize: 'clamp(2rem, 4vw, 2.8rem)',
              fontWeight: 900,
              margin: '0 0 1.5rem 0',
              letterSpacing: '-0.02em',
            }}
          >
            {gameTitle || 'Phòng Thi Đấu'}
          </h1>

          {/* Khu vực trung tâm: QR Trọng Tâm & Mã Phòng */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '3rem', margin: '2rem 0' }}>
            {/* Cột Trọng Tâm: Mã QR Lớn để quét ngay */}
            {qrDataUrl && (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '16px',
                    backgroundColor: '#ffffff',
                    borderRadius: '24px',
                    boxShadow: '0 20px 45px rgba(0, 0, 0, 0.4)',
                    border: '3px solid var(--accent-sky)',
                  }}
                >
                  <img
                    src={qrDataUrl}
                    alt="Mã QR tham gia phòng"
                    style={{ width: 'clamp(240px, 30vw, 310px)', height: 'clamp(240px, 30vw, 310px)', display: 'block' }}
                  />
                </div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '1.05rem', marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  <QrCodeIcon size={20} style={{ color: 'var(--accent-sky)' }} />
                  <span>Quét mã để vào phòng</span>
                </div>
              </div>
            )}

            {/* Cột Phụ: Mã phòng & Đường dẫn thứ cấp */}
            <div style={{ minWidth: '280px', maxWidth: '420px', textAlign: 'center' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '0.5rem' }}>
                MÃ PHÒNG THI ĐẤU
              </div>
              <div
                style={{
                  fontSize: 'clamp(3rem, 7vw, 4.8rem)',
                  fontWeight: 900,
                  letterSpacing: '8px',
                  color: 'var(--accent-sky)',
                  backgroundColor: 'var(--bg-input)',
                  padding: '0.65rem 1.8rem',
                  borderRadius: '20px',
                  border: '3px dashed var(--accent-sky)',
                  display: 'inline-block',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
                }}
              >
                {roomCode}
              </div>

              <div
                style={{
                  marginTop: '1.5rem',
                  backgroundColor: 'var(--bg-card)',
                  padding: '1rem 1.25rem',
                  borderRadius: '16px',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.45rem',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Đường dẫn tham gia:
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsLinkVisible(!isLinkVisible)}
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.2rem 0.55rem',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    {isLinkVisible ? (
                      <>
                        <EyeOffIcon size={13} />
                        <span>Ẩn link</span>
                      </>
                    ) : (
                      <>
                        <EyeIcon size={13} />
                        <span>Hiện link</span>
                      </>
                    )}
                  </button>
                </div>

                {isLinkVisible ? (
                  <div
                    style={{
                      color: 'var(--accent-sky)',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      wordBreak: 'break-all',
                      fontFamily: 'monospace',
                      backgroundColor: 'var(--bg-input)',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-strong)',
                      marginBottom: '0.75rem',
                    }}
                  >
                    {joinUrl || `${window.location.origin}/?room=${roomCode}`}
                  </div>
                ) : (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      fontSize: '0.84rem',
                      backgroundColor: 'var(--bg-input)',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px dashed var(--border-strong)',
                      marginBottom: '0.75rem',
                      textAlign: 'center',
                    }}
                  >
                    Liên kết đang được ẩn. Quét mã QR hoặc nhập mã phòng để vào.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const url = joinUrl || `${window.location.origin}/?room=${roomCode}`;
                    navigator.clipboard.writeText(url);
                    setCopiedLink(true);
                    toast.success('Đã sao chép liên kết phòng vào clipboard!', 'Đã chép link');
                    setTimeout(() => setCopiedLink(false), 2500);
                  }}
                  style={{
                    width: '100%',
                    backgroundColor: copiedLink ? 'var(--accent-emerald)' : 'var(--accent-sky)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 1rem',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  {copiedLink ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                  <span>{copiedLink ? 'Đã sao chép!' : 'Sao chép link'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Thanh trạng thái & Bộ đếm người chơi */}
          <div style={{ margin: '2rem 0 1rem 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '0.55rem 1.5rem',
                borderRadius: '30px',
                border: '1px solid var(--border-strong)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.65rem',
              }}
            >
              <UsersIcon size={18} style={{ color: 'var(--accent-sky)' }} />
              <span style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--accent-sky)' }}>{players.length}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>người đã vào</span>
            </div>
          </div>

          {/* Danh sách người chơi tham gia real-time */}
          <div
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '0.75rem',
              padding: '1.25rem',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border-subtle)',
              marginTop: '1rem',
            }}
          >
            {players.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '0.5rem' }}>
                Chưa có ai vào phòng. Quét mã QR hoặc nhập mã phòng {roomCode} để cùng tranh tài!
              </div>
            ) : (
              players.map((p) => (
                <span
                  key={p.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.5rem 1.15rem',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '25px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: 'var(--text-primary)',
                    animation: 'popIn 0.25s ease-out',
                  }}
                >
                  <UsersIcon size={14} style={{ color: 'var(--text-muted)' }} />
                  <span>{p.displayName}</span>
                </span>
              ))
            )}
          </div>
        </div>
      )}

      {/* 3. Màn hình Câu hỏi đang diễn ra (Question Screen) */}
      {viewState === 'question' && currentQuestion && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '2.5rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Top question bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <span
              style={{
                color: 'var(--accent-sky)',
                fontWeight: 900,
                fontSize: '1.4rem',
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                padding: '0.35rem 0.85rem',
                borderRadius: '8px',
              }}
            >
              CÂU HỎI {(currentQuestion.questionIndex || 0) + 1} / {currentQuestion.totalQuestions || 5}
            </span>

            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                border: timeRemaining <= 5 ? '2px solid #ef4444' : '1px solid var(--border-strong)',
                borderRadius: '14px',
                padding: '0.5rem 1.5rem',
                textAlign: 'center',
                animation: timeRemaining <= 5 ? 'countdownTick 1s infinite' : 'none',
              }}
            >
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>Thời gian còn lại</div>
              <div style={{ fontSize: '2.5rem', fontWeight: 900, color: timeRemaining <= 5 ? '#ef4444' : 'var(--accent-sky)' }}>
                {timeRemaining}s
              </div>
            </div>
          </div>

          {/* Question text */}
          <h2
            style={{
              margin: '1rem 0 2rem 0',
              color: 'var(--text-primary)',
              fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
              lineHeight: 1.4,
              fontWeight: 900,
              textAlign: 'center',
            }}
          >
            {currentQuestion.question}
          </h2>

          {/* Choice cards grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '1rem',
            }}
          >
            {currentQuestion.choices?.map((choice, idx) => {
              const config = choiceColors[idx % choiceColors.length];
              return (
                <div
                  key={idx}
                  style={{
                    backgroundColor: config.bg,
                    padding: '1.5rem 1.75rem',
                    borderRadius: '18px',
                    fontSize: '1.35rem',
                    color: config.text,
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    boxShadow: `0 5px 0 ${config.dark}`,
                  }}
                >
                  <span
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(0, 0, 0, 0.2)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 900,
                      fontSize: '1.35rem',
                      flexShrink: 0,
                    }}
                  >
                    {config.icon}
                  </span>
                  <span style={{ fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.35 }}>{choice}</span>
                </div>
              );
            })}

              {currentQuestion.type === 'SLIDER' && currentQuestion.sliderConfig && (
                <div
                  data-testid="host-slider-projection"
                  style={{
                    gridColumn: '1 / -1',
                    backgroundColor: 'var(--bg-card)',
                    border: '2px solid var(--accent-sky)',
                    borderRadius: '18px',
                    padding: '1.75rem 2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.1rem',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--accent-sky)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Thử thách Thanh trượt định lượng (Slider)
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <div style={{ backgroundColor: 'var(--bg-input)', padding: '0.85rem 1.4rem', borderRadius: '12px', border: '1px solid var(--border-strong)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Giá trị tối thiểu (Min)</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {currentQuestion.sliderConfig.min}{currentQuestion.sliderConfig.unit ? ` ${currentQuestion.sliderConfig.unit}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--accent-sky)' }}>⟷</div>
                    <div style={{ backgroundColor: 'var(--bg-input)', padding: '0.85rem 1.4rem', borderRadius: '12px', border: '1px solid var(--border-strong)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Giá trị tối đa (Max)</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {currentQuestion.sliderConfig.max}{currentQuestion.sliderConfig.unit ? ` ${currentQuestion.sliderConfig.unit}` : ''}
                      </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--bg-input)', padding: '0.85rem 1.4rem', borderRadius: '12px', border: '1px solid var(--border-strong)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Bước nhảy (Step)</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-amber)', fontVariantNumeric: 'tabular-nums' }}>
                        {currentQuestion.sliderConfig.step}{currentQuestion.sliderConfig.unit ? ` ${currentQuestion.sliderConfig.unit}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    Người chơi kéo thanh trượt để chọn giá trị chính xác trên thiết bị cá nhân.
                  </div>
                </div>
              )}

              {(currentQuestion.type === 'TYPE_ANSWER' ||
                currentQuestion.type === 'FILL_IN_THE_BLANK' ||
                (!currentQuestion.choices?.length &&
                  currentQuestion.type !== 'SLIDER' &&
                  !currentQuestion.crosswordClue)) && (
                <div
                  data-testid="host-type-answer-projection"
                  style={{
                    gridColumn: '1 / -1',
                    backgroundColor: 'var(--bg-card)',
                    border: '2px dashed var(--accent-amber)',
                    borderRadius: '18px',
                    padding: '1.75rem 2rem',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem',
                  }}
                >
                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--accent-amber)' }}>
                    Câu hỏi tự nhập đáp án (Type Answer)
                  </div>
                  <div style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    Người chơi tự gõ câu trả lời ngắn gọn trực tiếp trên thiết bị của mình.
                  </div>
                </div>
              )}

            {currentQuestion.crosswordClue && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  padding: '1.25rem',
                  borderRadius: '14px',
                  color: 'var(--accent-sky)',
                  fontSize: '1.1rem',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <InfoIcon size={18} /> Gợi ý từ khóa: <strong style={{ color: 'var(--text-primary)' }}>{currentQuestion.crosswordClue}</strong>
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: '2rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-card)',
              padding: '0.85rem 1.25rem',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span>
              Số câu trả lời đã ghi nhận:{' '}
              <strong style={{ color: 'var(--accent-sky)', fontSize: '1.1rem' }}>
                {answerCount}{players.length > 0 ? ` / ${players.length}` : ''}
              </strong>
            </span>
          </div>
        </div>
      )}

      {/* 4. Màn hình Công bố Đáp án & Bảng Xếp Hạng (Reveal Screen) */}
      {viewState === 'reveal' && revealData && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '2rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontSize: '1.15rem', fontWeight: 800, marginBottom: '0.75rem' }}>
              <CheckIcon size={20} />
              <span>ĐÁP ÁN CHÍNH XÁC:</span>
            </div>
            <div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 900,
                  color: 'var(--accent-emerald)',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  padding: '0.85rem 1.5rem',
                  borderRadius: '12px',
                  border: '2px solid var(--accent-emerald)',
                  display: 'inline-block',
                }}
              >
                {revealData.correctAnswer}
              </div>
            </div>
            {revealData.explanation && (
              <p
                style={{
                  color: 'var(--text-secondary)',
                  marginTop: '1rem',
                  fontSize: '0.95rem',
                  fontStyle: 'italic',
                  backgroundColor: 'var(--bg-card)',
                  padding: '0.85rem 1.25rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.4rem',
                }}
              >
                <InfoIcon size={16} style={{ marginTop: '0.2rem', flexShrink: 0 }} />
                <span><strong>Giải thích:</strong> {revealData.explanation}</span>
              </p>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.35rem', margin: 0, fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
              <TrophyIcon size={22} style={{ color: 'var(--accent-amber)' }} /> Bảng Xếp Hạng Hiện Tại
            </h3>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Cập nhật điểm theo thời gian thực
            </span>
          </div>

          <div style={{ overflowX: 'auto', backgroundColor: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-subtle)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Hạng</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Người chơi</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Điểm</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Số câu đúng</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Chuỗi đúng</th>
                </tr>
              </thead>
              <tbody>
                {revealData.leaderboard.map((entry) => (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid var(--border-subtle)', fontSize: '0.95rem' }}>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 900, color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#cbd5e1' : entry.rank === 3 ? '#d97706' : 'var(--text-muted)' }}>
                      {entry.rank === 1 ? '1' : entry.rank === 2 ? '2' : entry.rank === 3 ? '3' : `#${entry.rank}`}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {entry.displayName}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--accent-emerald)', fontWeight: 900 }}>
                      {entry.score}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)' }}>
                      {entry.correctCount}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: entry.streak > 1 ? '#f97316' : 'var(--text-muted)', fontWeight: entry.streak > 1 ? 800 : 500 }}>
                      {entry.streak > 1 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          <FlameIcon size={14} /> {entry.streak}
                        </span>
                      ) : (
                        entry.streak
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <button
              type="button"
              onClick={handleNextQuestion}
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '0.95rem 2.25rem',
                fontSize: '1.05rem',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>Câu hỏi tiếp theo</span>
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 5. Màn hình Kết thúc Chung cuộc (Finish Screen) */}
      {viewState === 'finish' && finishData && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '24px',
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <TrophyIcon size={56} style={{ color: '#facc15', margin: '0 auto 0.5rem auto', display: 'block', animation: 'popIn 0.5s ease-out' }} />
          <h2 style={{ color: '#facc15', fontSize: '2.4rem', fontWeight: 900, margin: '0 0 1rem 0' }}>
            Trận Đấu Kết Thúc!
          </h2>

          {/* Top 3 Podium Showcase */}
          {finishData.leaderboard.length > 0 && (
            <div
              data-testid="host-podium-top3"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.85rem',
                maxWidth: '780px',
                margin: '1rem auto 2rem auto',
              }}
            >
              {finishData.leaderboard.slice(0, 3).map((entry) => (
                <div
                  key={entry.playerId}
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: entry.rank === 1 ? '2px solid #eab308' : '1px solid var(--border-strong)',
                    borderRadius: '18px',
                    padding: '1.25rem',
                    boxShadow: entry.rank === 1 ? '0 12px 35px -5px rgba(234, 179, 8, 0.3)' : 'none',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: entry.rank === 1 ? '#facc15' : 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 900 }}>
                    {entry.rank === 1 ? '🥇 HẠNG #1 — VÔ ĐỊCH' : entry.rank === 2 ? '🥈 HẠNG #2' : '🥉 HẠNG #3'}
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-sky)', margin: '0.35rem 0' }}>
                    {entry.displayName}
                  </div>
                  {entry.departmentUnit && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                      {entry.departmentUnit}
                    </div>
                  )}
                  <div style={{ fontSize: '1.2rem', color: 'var(--accent-emerald)', fontWeight: 900 }}>
                    {entry.score} Điểm ({entry.correctCount}/{entry.totalQuestions || 5} câu)
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Thanh điều khiển BTC / Host sau khi kết thúc */}
          <div
            data-testid="host-finish-controls"
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '0.65rem',
              flexWrap: 'wrap',
              marginBottom: '1.5rem',
            }}
          >
            {sessionMode === 'EXAM' && (
              <>
                <button
                  type="button"
                  data-testid="host-publish-answers-btn"
                  onClick={handlePublishAnswers}
                  disabled={answersPublished}
                  style={{
                    padding: '0.65rem 1.15rem',
                    borderRadius: '10px',
                    border: '1.5px solid rgba(245, 158, 11, 0.5)',
                    backgroundColor: answersPublished
                      ? 'rgba(16, 185, 129, 0.14)'
                      : 'rgba(245, 158, 11, 0.16)',
                    color: answersPublished ? 'var(--accent-emerald)' : '#f59e0b',
                    fontSize: '0.86rem',
                    fontWeight: 900,
                    cursor: answersPublished ? 'not-allowed' : 'pointer',
                  }}
                >
                  {answersPublished ? '✓ Đã công bố đáp án chính thức' : 'Công bố đáp án chính thức'}
                </button>

                <button
                  type="button"
                  data-testid="host-toggle-leaderboard-btn"
                  onClick={handleToggleExamLeaderboard}
                  style={{
                    padding: '0.65rem 1.15rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    fontSize: '0.86rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {showExamLeaderboardToPlayers ? 'Ẩn BXH với thí sinh' : 'Hiện BXH cho thí sinh'}
                </button>
              </>
            )}

            {activeGameId && (
              <>
                <button
                  type="button"
                  data-testid="host-export-csv-btn"
                  onClick={() => downloadGameScoreboardExport(activeGameId, 'csv')}
                  style={{
                    padding: '0.65rem 1.15rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    fontSize: '0.86rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Xuất kết quả CSV
                </button>
                <button
                  type="button"
                  data-testid="host-export-xlsx-btn"
                  onClick={() => downloadGameScoreboardExport(activeGameId, 'xlsx')}
                  style={{
                    padding: '0.65rem 1.15rem',
                    borderRadius: '10px',
                    border: '1.5px solid var(--accent-emerald)',
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    color: 'var(--accent-emerald)',
                    fontSize: '0.86rem',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  Xuất kết quả Excel (.xlsx)
                </button>
              </>
            )}
          </div>

          <h3 style={{ color: 'var(--text-primary)', fontSize: '1.35rem', margin: '1.5rem 0 1rem 0', fontWeight: 900 }}>
            Bảng Xếp Hạng Chung Cuộc
          </h3>

          <div style={{ maxWidth: '860px', margin: '0 auto', overflowX: 'auto', textAlign: 'left', backgroundColor: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-subtle)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Hạng</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Người chơi</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Đơn vị</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Điểm</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Số câu đúng</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Đánh giá</th>
                  {activeGameId && <th style={{ padding: '0.85rem 1rem' }}>Thi lại</th>}
                </tr>
              </thead>
              <tbody>
                {finishData.leaderboard.map((entry) => {
                  const totalQs = entry.totalQuestions || 5;
                  const evalItem = evaluateFrontendPerformance(
                    entry.correctCount,
                    totalQs,
                    sessionMode === 'EXAM' ? passThresholdPercent : undefined
                  );
                  const isPassedVal = entry.isPassed !== undefined ? entry.isPassed : evalItem.isPassed;

                  return (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid var(--border-subtle)', fontSize: '0.92rem' }}>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 900, color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#cbd5e1' : entry.rank === 3 ? '#d97706' : 'var(--text-muted)' }}>
                      {entry.rank === 1 ? '1' : entry.rank === 2 ? '2' : entry.rank === 3 ? '3' : `#${entry.rank}`}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {entry.displayName}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)' }}>
                      {entry.departmentUnit || '—'}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--accent-emerald)', fontWeight: 900 }}>
                      {entry.score}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--text-secondary)' }}>
                      {entry.correctCount}/{totalQs} ({evalItem.accuracyPercent}%)
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 800 }}>
                      <span>{evalItem.tierLabel}</span>
                      {sessionMode === 'EXAM' && isPassedVal !== null && (
                        <span
                          style={{
                            marginLeft: '0.4rem',
                            color: isPassedVal ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          }}
                        >
                          ({isPassedVal ? 'ĐẠT' : 'CHƯA ĐẠT'})
                        </span>
                      )}
                    </td>
                    {activeGameId && (
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {entry.participantId ? (
                          <button
                            type="button"
                            data-testid={`host-grant-retake-btn-${entry.participantId}`}
                            onClick={() => handleHostGrantRetake(entry.participantId, entry.displayName)}
                            style={{
                              padding: '0.25rem 0.55rem',
                              borderRadius: '6px',
                              border: '1px solid var(--accent-emerald)',
                              backgroundColor: 'rgba(16, 185, 129, 0.12)',
                              color: 'var(--accent-emerald)',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            +1 Thi lại
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '2.5rem' }}>
            <button
              type="button"
              onClick={handleCancelRoom}
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '0.95rem 2.25rem',
                fontSize: '1.05rem',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>Tạo phòng chơi mới</span>
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
