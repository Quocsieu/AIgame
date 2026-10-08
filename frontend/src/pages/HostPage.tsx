import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../components/ToastContext.js';
import { GameSocketClient } from '../services/socket.js';
import { createRoom, fetchRoomQr } from '../services/api.js';
import type { LeaderboardEntry, SanitizedQuestion } from '../types/index.js';

interface HostPageProps {
  initialRoomCode?: string;
  initialHostToken?: string;
  initialGameId?: string;
}

export const HostPage: React.FC<HostPageProps> = ({
  initialRoomCode,
  initialHostToken,
  initialGameId,
}) => {
  const toast = useToast();

  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [hostToken, setHostToken] = useState(initialHostToken || '');
  const [gameId, setGameId] = useState(initialGameId || '');
  const [gameTitle, setGameTitle] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Host screens: 'setup' | 'lobby' | 'question' | 'reveal' | 'finish'
  const [viewState, setViewState] = useState<'setup' | 'lobby' | 'question' | 'reveal' | 'finish'>(
    initialRoomCode && initialHostToken ? 'lobby' : 'setup'
  );
  const [isPresentationMode, setIsPresentationMode] = useState(false);

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

  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const socketRef = useRef<GameSocketClient | null>(null);
  const timerIntervalRef = useRef<any>(null);

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startTimer = (durationSec: number) => {
    stopTimer();
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

  const connectToSocket = (code: string, token: string) => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    const client = new GameSocketClient();
    socketRef.current = client;

    client.onOpen(() => {
      client.send({
        type: 'host.join',
        roomCode: code,
        hostToken: token,
      });
    });

    client.on('room.joined', (msg: any) => {
      setGameTitle(msg.title || 'Trò chơi nhiều người');
      toast.info(`Đã kết nối với phòng ${code}`, 'Kết nối thành công');
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
      setViewState('question');
      toast.success('Chủ phòng đã kích hoạt bắt đầu trò chơi!', 'Bắt đầu');
    });

    client.on('question.started', (msg: any) => {
      setCurrentQuestion(msg.question);
      setAnswerCount(0);
      setViewState('question');
      startTimer(msg.question.timePerQuestion || 20);
      toast.info(`Bắt đầu câu hỏi số ${(msg.question.questionIndex || 0) + 1}!`, 'Câu hỏi mới');
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
    if (initialRoomCode && initialHostToken) {
      handleInitExistingRoom(initialRoomCode, initialHostToken);
    }

    return () => {
      stopTimer();
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [initialRoomCode, initialHostToken]);

  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    const toastId = toast.loading('Đang khởi tạo phòng chơi...');

    try {
      const res = await createRoom({
        gameId: gameId.trim() || 'fixture_mc',
        capacity: 300,
      });

      setRoomCode(res.roomCode);
      setHostToken(res.hostToken);
      setJoinUrl(res.joinUrl);

      try {
        const qr = await fetchRoomQr(res.roomCode);
        setQrDataUrl(qr.qrDataUrl);
      } catch {
        // Optional QR fetch fallback
      }

      toast.removeToast(toastId);
      toast.success(`Phòng ${res.roomCode} đã được khởi tạo!`, 'Tạo phòng thành công');
      setViewState('lobby');
      connectToSocket(res.roomCode, res.hostToken);
    } catch (err: any) {
      toast.removeToast(toastId);
      toast.error(err.message || 'Không thể tạo phòng chơi.', 'Lỗi khởi tạo');
    } finally {
      setIsCreatingRoom(false);
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
    setIsPresentationMode(false);
    setRoomCode('');
    setHostToken('');
    setPlayers([]);
    setCurrentQuestion(null);
    setRevealData(null);
    setFinishData(null);
    setViewState('setup');
  };

  // Kahoot color config for 4 choices (A: Red, B: Blue, C: Amber, D: Emerald)
  const choiceColors = [
    { bg: '#ef4444', border: '#dc2626', icon: '▲', label: 'A' },
    { bg: '#2563eb', border: '#1d4ed8', icon: '◆', label: 'B' },
    { bg: '#f59e0b', border: '#d97706', icon: '●', label: 'C' },
    { bg: '#10b981', border: '#059669', icon: '■', label: 'D' },
  ];

  return (
    <div style={{ maxWidth: isPresentationMode ? '1180px' : '1050px', margin: '0 auto', padding: '0.75rem 0.5rem 2rem 0.5rem' }}>
      {/* Host Top Header (Shown in Normal Admin Mode) */}
      {!isPresentationMode && (
        <header
          style={{
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            padding: '1.25rem 1.5rem',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '16px',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div>
            <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.65rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
              Bảng Điều Khiển Chủ Phòng
            </h1>
          </div>

          {viewState === 'lobby' && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsPresentationMode(true)}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--accent-sky)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.7rem 1.25rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  transition: 'all 0.15s ease',
                }}
              >
                📺 Chế độ trình chiếu
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
                  padding: '0.7rem 1.5rem',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  cursor: players.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: players.length === 0 ? 'none' : '0 4px 14px rgba(22, 163, 74, 0.4)',
                  transition: 'all 0.15s ease',
                }}
              >
                🚀 Bắt đầu trận đấu &rarr;
              </button>
            </div>
          )}
        </header>
      )}

      {/* 1. Màn hình Khởi tạo Phòng Chơi (Setup Screen) */}
      {viewState === 'setup' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '2rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.75rem' }}>🎯</span>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '1.45rem', fontWeight: 800, margin: 0 }}>
              Khởi Tạo Phòng Chơi Trực Tuyến
            </h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: '0 0 1.75rem 0', lineHeight: 1.5 }}>
            Nhập mã trò chơi (Game ID) hoặc để trống để sử dụng bộ câu hỏi mẫu. Phòng thi đấu hỗ trợ tối đa 300 người tham gia đồng thời.
          </p>

          <div style={{ maxWidth: '540px' }}>
            <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.45rem' }}>
              Mã trò chơi (Game ID):
            </label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                placeholder="game_... (hoặc để trống)"
                style={{
                  flex: 1,
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={isCreatingRoom}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.85rem 1.5rem',
                  fontWeight: 800,
                  cursor: isCreatingRoom ? 'not-allowed' : 'pointer',
                  fontSize: '0.95rem',
                  boxShadow: 'var(--btn-shadow)',
                  opacity: isCreatingRoom ? 0.7 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {isCreatingRoom ? 'Đang tạo...' : 'Tạo phòng ngay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Màn hình Sảnh Chờ (Lobby) — Chế độ TRÌNH CHIẾU / GAME SHOW (Presentation Mode) */}
      {viewState === 'lobby' && isPresentationMode && (
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
              onClick={() => setIsPresentationMode(false)}
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
              }}
            >
              ← Bảng điều khiển
            </button>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
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
                }}
              >
                ⛶ Toàn màn hình
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
                  boxShadow: players.length === 0 ? 'none' : '0 4px 18px rgba(22, 163, 74, 0.45)',
                  transition: 'all 0.15s ease',
                }}
              >
                🚀 Bắt đầu trò chơi &rarr;
              </button>
            </div>
          </div>

          {/* Tiêu đề Trình Chiếu */}
          <h1
            style={{
              color: 'var(--accent-sky)',
              fontSize: 'clamp(2.2rem, 5vw, 3.2rem)',
              fontWeight: 900,
              margin: '0 0 0.5rem 0',
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            SẴN SÀNG THAM GIA?
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'clamp(1rem, 2.5vw, 1.25rem)', margin: '0 0 2rem 0' }}>
            {gameTitle || 'Quét mã QR bằng điện thoại hoặc nhập mã phòng để bắt đầu tranh tài'}
          </p>

          {/* Khu vực trung tâm: Mã Phòng Lớn & QR Lớn */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '3rem', margin: '2rem 0' }}>
            {/* Cột Trái: Mã phòng & Đường dẫn */}
            <div style={{ minWidth: '280px', maxWidth: '420px', textAlign: 'center' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '0.5rem' }}>
                MÃ PHÒNG THI ĐẤU
              </div>
              <div
                style={{
                  fontSize: 'clamp(3.5rem, 8vw, 5.5rem)',
                  fontWeight: 900,
                  letterSpacing: '8px',
                  color: 'var(--accent-sky)',
                  backgroundColor: 'var(--bg-input)',
                  padding: '0.75rem 2rem',
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
                  marginTop: '1.75rem',
                  backgroundColor: 'var(--bg-card)',
                  padding: '1rem 1.25rem',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>Đường dẫn tham gia:</div>
                <div style={{ color: 'var(--accent-sky)', fontWeight: 700, fontSize: '1.05rem', wordBreak: 'break-all' }}>
                  {joinUrl || `${window.location.origin}/?room=${roomCode}`}
                </div>
              </div>
            </div>

            {/* Cột Phải: QR Lớn */}
            {qrDataUrl && (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '14px',
                    backgroundColor: 'white',
                    borderRadius: '20px',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
                  }}
                >
                  <img
                    src={qrDataUrl}
                    alt="Mã QR tham gia phòng"
                    style={{ width: 'clamp(220px, 28vw, 280px)', height: 'clamp(220px, 28vw, 280px)', display: 'block' }}
                  />
                </div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.05rem', marginTop: '1rem' }}>
                  📱 Quét mã bằng camera điện thoại
                </div>
              </div>
            )}
          </div>

          {/* Thanh trạng thái & Bộ đếm người chơi */}
          <div style={{ margin: '2.5rem 0 1rem 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '0.65rem 1.75rem',
                borderRadius: '30px',
                border: '1px solid var(--border-strong)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.65rem',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>👥</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--accent-sky)' }}>{players.length}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>/ 300 người chơi</span>
            </div>

            <div style={{ color: players.length === 0 ? 'var(--text-muted)' : 'var(--accent-emerald)', fontSize: '1.05rem', fontWeight: 700 }}>
              {players.length === 0 ? '⏳ Đang chờ người chơi tham gia...' : '✨ Đang chờ người chủ trì bấm bắt đầu...'}
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
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                    animation: 'popIn 0.25s ease-out',
                  }}
                >
                  <span>👤</span>
                  <span>{p.displayName}</span>
                </span>
              ))
            )}
          </div>
        </div>
      )}

      {/* 2. Màn hình Sảnh Chờ (Lobby) — Chế độ QUẢN TRỊ (Admin Mode) */}
      {viewState === 'lobby' && !isPresentationMode && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '1.5rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ backgroundColor: 'rgba(56, 189, 248, 0.12)', color: 'var(--accent-sky)', padding: '0.25rem 0.65rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 800 }}>
                PHÒNG CHƠI
              </span>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                {gameTitle || 'Sảnh Chờ Trò Chơi'}
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Sức chứa: <strong style={{ color: 'var(--text-primary)' }}>300 người</strong>
              </span>
              <span
                style={{
                  backgroundColor: players.length === 0 ? 'var(--bg-card)' : 'rgba(16, 185, 129, 0.15)',
                  color: players.length === 0 ? 'var(--text-muted)' : 'var(--accent-emerald)',
                  border: players.length === 0 ? '1px solid var(--border-subtle)' : '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '0.3rem 0.85rem',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                {players.length === 0 ? 'Đang chờ người tham gia' : `Sẵn sàng (${players.length} người)`}
              </span>
            </div>
          </div>

          {/* 2-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', alignItems: 'stretch' }}>
            {/* Left Col: Room ID & QR */}
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '16px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', display: 'block', marginBottom: '0.35rem' }}>
                  MÃ PHÒNG THI ĐẤU
                </span>
                <div
                  style={{
                    fontSize: '2.2rem',
                    fontWeight: 900,
                    letterSpacing: '0.12em',
                    color: 'var(--accent-sky)',
                    padding: '0.4rem 1.25rem',
                    borderRadius: '12px',
                    display: 'inline-block',
                    border: '2px dashed var(--accent-sky)',
                    backgroundColor: 'var(--bg-input)',
                  }}
                >
                  {roomCode}
                </div>
              </div>

              {qrDataUrl && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '12px', display: 'inline-block', flexShrink: 0 }}>
                    <img src={qrDataUrl} alt="Mã QR tham gia phòng" style={{ width: '100px', height: '100px', display: 'block' }} />
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
                    📱 Quét mã bằng camera điện thoại để tham gia ngay
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Đường dẫn tham gia:<br />
                <span style={{ color: 'var(--accent-sky)', wordBreak: 'break-all', fontWeight: 700 }}>
                  {joinUrl || `${window.location.origin}/?room=${roomCode}`}
                </span>
              </div>
            </div>

            {/* Right Col: Player roster & Actions */}
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '16px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                    👥 Danh sách người chơi ({players.length}):
                  </span>
                  <span style={{ fontSize: '0.8rem', color: players.length === 0 ? 'var(--text-muted)' : 'var(--accent-emerald)', fontWeight: 600 }}>
                    {players.length === 0 ? 'Chưa có ai tham gia' : 'Đang trực tuyến'}
                  </span>
                </div>

                <div
                  style={{
                    height: '180px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignContent: 'flex-start',
                    gap: '0.5rem',
                    padding: '0.75rem',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {players.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem', margin: 'auto' }}>
                      Đang đợi người chơi quét mã QR hoặc nhập mã {roomCode}...
                    </div>
                  ) : (
                    players.map((p) => (
                      <span
                        key={p.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.35rem 0.85rem',
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '16px',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span>👤</span>
                        <span>{p.displayName}</span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={handleRestart}
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '8px',
                    padding: '0.55rem 1.15rem',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                    transition: 'all 0.15s ease',
                  }}
                >
                  Hủy / Tạo phòng khác
                </button>
              </div>
            </div>
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
            padding: isPresentationMode ? '2.5rem' : '1.75rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Top question bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <span
              style={{
                color: 'var(--accent-sky)',
                fontWeight: 900,
                fontSize: isPresentationMode ? '1.4rem' : '1.15rem',
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
              <div style={{ fontSize: isPresentationMode ? '2.5rem' : '2rem', fontWeight: 900, color: timeRemaining <= 5 ? '#ef4444' : 'var(--accent-sky)' }}>
                {timeRemaining}s
              </div>
            </div>
          </div>

          {/* Question text */}
          <h2
            style={{
              margin: '1rem 0 2rem 0',
              color: 'var(--text-primary)',
              fontSize: isPresentationMode ? 'clamp(1.6rem, 3.5vw, 2.4rem)' : '1.45rem',
              lineHeight: 1.4,
              fontWeight: 900,
              textAlign: isPresentationMode ? 'center' : 'left',
            }}
          >
            {currentQuestion.question}
          </h2>

          {/* Choice cards grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isPresentationMode ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1rem',
            }}
          >
            {currentQuestion.choices?.map((choice, idx) => {
              const config = choiceColors[idx % choiceColors.length];
              return (
                <div
                  key={idx}
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    padding: isPresentationMode ? '1.5rem' : '1.15rem',
                    borderRadius: '14px',
                    fontSize: isPresentationMode ? '1.25rem' : '1.05rem',
                    color: 'var(--text-primary)',
                    border: `2px solid ${config.bg}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                >
                  <span
                    style={{
                      width: isPresentationMode ? '44px' : '36px',
                      height: isPresentationMode ? '44px' : '36px',
                      borderRadius: '10px',
                      backgroundColor: config.bg,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 900,
                      fontSize: isPresentationMode ? '1.2rem' : '1rem',
                      flexShrink: 0,
                    }}
                  >
                    {config.icon}
                  </span>
                  <span style={{ fontWeight: 700, wordBreak: 'break-word' }}>{choice}</span>
                </div>
              );
            })}

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
                }}
              >
                💡 Gợi ý từ khóa: <strong style={{ color: 'var(--text-primary)' }}>{currentQuestion.crosswordClue}</strong>
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
              Số câu trả lời đã ghi nhận: <strong style={{ color: 'var(--accent-sky)', fontSize: '1.1rem' }}>{answerCount}</strong>
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
              <span>✓</span>
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
                }}
              >
                💡 Giải thích: {revealData.explanation}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.35rem', margin: 0, fontWeight: 900 }}>
              🏆 Bảng Xếp Hạng Hiện Tại
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
                      {entry.rank === 1 ? '🥇 1' : entry.rank === 2 ? '🥈 2' : entry.rank === 3 ? '🥉 3' : `#${entry.rank}`}
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
                      {entry.streak > 1 ? `🔥 ${entry.streak}` : entry.streak}
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
                boxShadow: 'var(--btn-shadow)',
                transition: 'all 0.15s ease',
              }}
            >
              Câu hỏi tiếp theo &rarr;
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
          <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem', animation: 'popIn 0.5s ease-out' }}>
            🏆
          </div>
          <h2 style={{ color: '#facc15', fontSize: '2.4rem', fontWeight: 900, margin: '0 0 1rem 0' }}>
            Trận Đấu Kết Thúc!
          </h2>

          {/* Winner Showcase Podium */}
          {finishData.winner && (
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '2px solid #eab308',
                borderRadius: '20px',
                padding: '1.75rem 2.5rem',
                display: 'inline-block',
                margin: '1rem 0 2rem 0',
                boxShadow: '0 12px 35px -5px rgba(234, 179, 8, 0.3)',
                animation: 'popIn 0.4s ease-out',
              }}
            >
              <div style={{ fontSize: '0.85rem', color: '#facc15', textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.1em' }}>
                👑 NHÀ VÔ ĐỊCH 👑
              </div>
              <div style={{ fontSize: '2.4rem', fontWeight: 900, color: 'var(--accent-sky)', margin: '0.5rem 0' }}>
                {finishData.winner.displayName}
              </div>
              <div style={{ fontSize: '1.4rem', color: 'var(--accent-emerald)', fontWeight: 900 }}>
                {finishData.winner.score} Điểm
              </div>
            </div>
          )}

          <h3 style={{ color: 'var(--text-primary)', fontSize: '1.35rem', margin: '1.5rem 0 1rem 0', fontWeight: 900 }}>
            Bảng Xếp Hạng Chung Cuộc
          </h3>

          <div style={{ maxWidth: '680px', margin: '0 auto', overflowX: 'auto', textAlign: 'left', backgroundColor: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-subtle)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Hạng</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Người chơi</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Điểm</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Số câu đúng</th>
                </tr>
              </thead>
              <tbody>
                {finishData.leaderboard.map((entry) => (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid var(--border-subtle)', fontSize: '0.95rem' }}>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 900, color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#cbd5e1' : entry.rank === 3 ? '#d97706' : 'var(--text-muted)' }}>
                      {entry.rank === 1 ? '🥇 1' : entry.rank === 2 ? '🥈 2' : entry.rank === 3 ? '🥉 3' : `#${entry.rank}`}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '2.5rem' }}>
            <button
              type="button"
              onClick={handleRestart}
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '0.95rem 2.25rem',
                fontSize: '1.05rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: 'var(--btn-shadow)',
                transition: 'all 0.15s ease',
              }}
            >
              Tạo phòng chơi mới &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
