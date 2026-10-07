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

  return (
    <div style={{ maxWidth: isPresentationMode ? '1140px' : '1050px', margin: '0 auto', padding: '1rem 0' }}>
      {!isPresentationMode && (
        <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #1e293b' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0.6rem', borderRadius: '4px', backgroundColor: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.25)', color: '#38bdf8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.4rem' }}>
              👑 QUẢN TRỊ PHÒNG CHƠI
            </div>
            <h1 style={{ margin: 0, color: '#ffffff', fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
              Bảng Điều Khiển Chủ Phòng
            </h1>
            <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>
              Theo dõi người tham gia thời gian thực, điều khiển tiến trình câu hỏi và công bố bảng vàng
            </p>
          </div>

          {viewState === 'lobby' && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setIsPresentationMode(true)}
                style={{
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.65rem 1.25rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)',
                }}
              >
                📺 Hiển thị phòng chơi
              </button>

              <button
                type="button"
                onClick={handleStartGame}
                disabled={players.length === 0}
                style={{
                  backgroundColor: players.length === 0 ? '#334155' : '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.65rem 1.5rem',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: players.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: players.length === 0 ? 'none' : '0 4px 14px rgba(22, 163, 74, 0.35)',
                }}
              >
                🚀 Bắt đầu trò chơi &rarr;
              </button>
            </div>
          )}
        </header>
      )}

      {/* 1. Màn hình Khởi tạo Phòng Chơi */}
      {viewState === 'setup' && (
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '2rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <h2 style={{ color: '#ffffff', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>
            Khởi Tạo Phòng Chơi Trực Tuyến
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.925rem', margin: '0 0 1.5rem 0' }}>
            Nhập mã trò chơi (Game ID) hoặc để trống để sử dụng bộ câu hỏi mẫu. Phòng chơi hỗ trợ tối đa 300 người tham gia đồng thời.
          </p>

          <div style={{ maxWidth: '520px' }}>
            <label style={{ display: 'block', color: '#e2e8f0', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              Mã trò chơi (Game ID):
            </label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                placeholder="game_... (hoặc để trống)"
                style={{ flex: 1, padding: '0.75rem 0.85rem', backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px', color: '#ffffff', fontSize: '0.95rem' }}
              />
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={isCreatingRoom}
                style={{ backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.75rem 1.5rem', fontWeight: 700, cursor: isCreatingRoom ? 'not-allowed' : 'pointer', fontSize: '0.95rem', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)' }}
              >
                {isCreatingRoom ? 'Đang tạo...' : 'Tạo phòng'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Màn hình Sảnh Chờ (Lobby) — Chế độ TRÌNH CHIẾU / GAME SHOW */}
      {viewState === 'lobby' && isPresentationMode && (
        <div style={{ backgroundColor: '#090d16', border: '2px solid #0284c7', borderRadius: '16px', padding: '2rem', textAlign: 'center', boxShadow: '0 20px 40px -15px rgba(2, 132, 199, 0.3)' }}>
          {/* Top Bar Điều Khiển Trình Chiếu */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid #1e293b' }}>
            <button
              type="button"
              onClick={() => setIsPresentationMode(false)}
              style={{
                backgroundColor: '#1e293b',
                color: '#94a3b8',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '0.6rem 1.1rem',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              ← Quay lại quản lý phòng
            </button>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleToggleFullscreen}
                style={{
                  backgroundColor: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  padding: '0.6rem 1.1rem',
                  fontWeight: 600,
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
                  backgroundColor: players.length === 0 ? '#334155' : '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.65rem 1.75rem',
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: players.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: players.length === 0 ? 'none' : '0 4px 16px rgba(22, 163, 74, 0.4)',
                }}
              >
                🚀 Bắt đầu trò chơi &rarr;
              </button>
            </div>
          </div>

          {/* Tiêu đề Trình Chiếu */}
          <h1 style={{ color: '#38bdf8', fontSize: 'clamp(2.2rem, 5vw, 3rem)', fontWeight: 900, margin: '0 0 0.5rem 0', textTransform: 'uppercase', letterSpacing: '2px' }}>
            SẴN SÀNG THAM GIA?
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 'clamp(1rem, 2.5vw, 1.25rem)', margin: '0 0 2rem 0' }}>
            {gameTitle || 'Quét mã QR bằng điện thoại hoặc nhập mã phòng để bắt đầu tranh tài'}
          </p>

          {/* Khu vực trung tâm: Mã Phòng Lớn & QR Lớn */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '3rem', margin: '2rem 0' }}>
            {/* Cột Trái: Mã phòng & Đường dẫn */}
            <div style={{ minWidth: '280px', maxWidth: '420px', textAlign: 'center' }}>
              <div style={{ color: '#94a3b8', fontSize: '1rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '3px', marginBottom: '0.5rem' }}>
                MÃ PHÒNG
              </div>
              <div
                style={{
                  fontSize: 'clamp(3.5rem, 8vw, 5.5rem)',
                  fontWeight: 900,
                  letterSpacing: '8px',
                  color: '#38bdf8',
                  backgroundColor: '#0f172a',
                  padding: '0.6rem 2rem',
                  borderRadius: '16px',
                  border: '3px dashed #0284c7',
                  display: 'inline-block',
                  textShadow: '0 0 25px rgba(56, 189, 248, 0.4)',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)',
                }}
              >
                {roomCode}
              </div>

              <div style={{ marginTop: '1.5rem', backgroundColor: '#0f172a', padding: '0.85rem 1.25rem', borderRadius: '10px', border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.25rem' }}>Đường dẫn tham gia:</div>
                <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: '1rem', wordBreak: 'break-all' }}>
                  {joinUrl || `${window.location.origin}/?room=${roomCode}`}
                </div>
              </div>
            </div>

            {/* Cột Phải: QR Lớn */}
            {qrDataUrl && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'inline-block', padding: '12px', backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 15px 35px rgba(0, 0, 0, 0.6)' }}>
                  <img
                    src={qrDataUrl}
                    alt="Mã QR tham gia phòng"
                    style={{ width: 'clamp(220px, 28vw, 280px)', height: 'clamp(220px, 28vw, 280px)', display: 'block' }}
                  />
                </div>
                <div style={{ color: '#cbd5e1', fontWeight: 600, fontSize: '1rem', marginTop: '0.85rem' }}>
                  📱 Quét mã bằng camera điện thoại
                </div>
              </div>
            )}
          </div>

          {/* Thanh trạng thái & Bộ đếm người chơi */}
          <div style={{ margin: '2.5rem 0 1rem 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ backgroundColor: '#0f172a', padding: '0.6rem 1.5rem', borderRadius: '30px', border: '1px solid #0284c7', display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.25rem' }}>👥</span>
              <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#38bdf8' }}>{players.length}</span>
              <span style={{ color: '#94a3b8', fontSize: '1rem' }}>/ 300 người chơi</span>
            </div>

            <div style={{ color: players.length === 0 ? '#94a3b8' : '#4ade80', fontSize: '1rem', fontWeight: 600 }}>
              {players.length === 0 ? '⏳ Đang chờ người chơi tham gia...' : '✨ Đang chờ người chủ trì bắt đầu trò chơi...'}
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
              backgroundColor: '#0f172a',
              borderRadius: '12px',
              border: '1px solid #1e293b',
              marginTop: '1rem',
            }}
          >
            {players.length === 0 ? (
              <div style={{ color: '#64748b', fontStyle: 'italic', padding: '0.5rem' }}>
                Chưa có ai vào phòng. Quét mã QR hoặc nhập mã phòng {roomCode} để cùng chơi!
              </div>
            ) : (
              players.map((p) => (
                <span
                  key={p.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.5rem 1.1rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #0284c7',
                    borderRadius: '25px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: '#f8fafc',
                    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3)',
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

      {/* 2. Màn hình Sảnh Chờ (Lobby) — Chế độ QUẢN TRỊ 1-VIEWPORT (FIT WITHOUT SCROLL) */}
      {viewState === 'lobby' && !isPresentationMode && (
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '1.25rem 1.5rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          {/* Hàng thông tin tiêu đề phòng */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', paddingBottom: '1rem', borderBottom: '1px solid #1e293b', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ backgroundColor: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 800 }}>
                PHÒNG CHƠI
              </span>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.35rem', fontWeight: 800 }}>
                {gameTitle || 'Sảnh Chờ Trò Chơi'}
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                Sức chứa: <strong style={{ color: '#f8fafc' }}>300 người</strong>
              </span>
              <span style={{ backgroundColor: players.length === 0 ? '#1e293b' : 'rgba(22, 163, 74, 0.15)', color: players.length === 0 ? '#94a3b8' : '#4ade80', border: players.length === 0 ? '1px solid #334155' : '1px solid rgba(22, 163, 74, 0.3)', padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 700 }}>
                {players.length === 0 ? 'Đang chờ kết nối' : `Sẵn sàng (${players.length} người)`}
              </span>
            </div>
          </div>

          {/* Bố cục 2 Cột thu gọn — Không cần cuộn trang */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: '1.5rem', alignItems: 'stretch' }}>
            {/* Cột Trái: Nhận diện phòng, QR & Link */}
            <div style={{ backgroundColor: '#090d16', border: '1px solid #1e293b', borderRadius: '10px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', display: 'block', marginBottom: '0.35rem' }}>
                  MÃ PHÒNG THI ĐẤU
                </span>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, letterSpacing: '0.12em', color: '#38bdf8', padding: '0.25rem 1rem', borderRadius: '8px', display: 'inline-block', border: '2px dashed #0284c7', backgroundColor: '#0f172a' }}>
                  {roomCode}
                </div>
              </div>

              {qrDataUrl && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ padding: '6px', backgroundColor: 'white', borderRadius: '8px', display: 'inline-block', flexShrink: 0 }}>
                    <img src={qrDataUrl} alt="Mã QR tham gia phòng" style={{ width: '100px', height: '100px', display: 'block' }} />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: '1.4' }}>
                    📱 Quét mã bằng camera điện thoại để vào nhanh
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.825rem', color: '#94a3b8' }}>
                Đường dẫn tham gia:<br />
                <span style={{ color: '#38bdf8', wordBreak: 'break-all', fontWeight: 600 }}>
                  {joinUrl || `${window.location.origin}/?room=${roomCode}`}
                </span>
              </div>
            </div>

            {/* Cột Phải: Trạng thái & Danh sách người chơi */}
            <div style={{ backgroundColor: '#090d16', border: '1px solid #1e293b', borderRadius: '10px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 700 }}>
                    👥 Danh sách người chơi ({players.length}):
                  </span>
                  <span style={{ fontSize: '0.8rem', color: players.length === 0 ? '#94a3b8' : '#34d399', fontWeight: 600 }}>
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
                    backgroundColor: '#0f172a',
                    borderRadius: '8px',
                    border: '1px solid #1e293b',
                  }}
                >
                  {players.length === 0 ? (
                    <div style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.85rem', margin: 'auto' }}>
                      Đang đợi người chơi quét mã QR hoặc nhập mã phòng {roomCode}...
                    </div>
                  ) : (
                    players.map((p) => (
                      <span
                        key={p.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.35rem 0.75rem',
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '16px',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          color: '#f8fafc',
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
                  style={{ backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Hủy / Tạo phòng khác
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Màn hình Câu hỏi đang diễn ra */}
      {viewState === 'question' && currentQuestion && (
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '2rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #1e293b' }}>
            <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: '1.15rem' }}>
              CÂU HỎI {(currentQuestion.questionIndex || 0) + 1} / {currentQuestion.totalQuestions || 5}
            </span>
            <div style={{ backgroundColor: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.5rem 1.25rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Thời gian còn lại</div>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: timeRemaining <= 5 ? '#ef4444' : '#38bdf8' }}>
                {timeRemaining}s
              </div>
            </div>
          </div>

          <h2 style={{ margin: '1rem 0 1.5rem 0', color: '#ffffff', fontSize: '1.5rem', lineHeight: 1.4, fontWeight: 800 }}>
            {currentQuestion.question}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
            {currentQuestion.choices?.map((choice, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#090d16',
                  padding: '1rem 1.25rem',
                  borderRadius: '8px',
                  fontSize: '1.1rem',
                  color: '#f8fafc',
                  border: '1px solid #1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <span style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#1e293b', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem' }}>
                  {String.fromCharCode(65 + idx)}
                </span>
                <span>{choice}</span>
              </div>
            ))}

            {currentQuestion.crosswordClue && (
              <div style={{ backgroundColor: '#090d16', padding: '1rem', borderRadius: '8px', color: '#38bdf8', fontSize: '1.1rem', border: '1px solid #1e293b' }}>
                Gợi ý từ khóa: <strong>{currentQuestion.crosswordClue}</strong>
              </div>
            )}
          </div>

          <div style={{ marginTop: '2rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Số câu trả lời đã ghi nhận: <strong style={{ color: '#38bdf8' }}>{answerCount}</strong></span>
          </div>
        </div>
      )}

      {/* 4. Màn hình Công bố Đáp án & Bảng Xếp Hạng */}
      {viewState === 'reveal' && revealData && (
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '2rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}>
            <h2 style={{ color: '#34d399', margin: '0 0 0.5rem 0', fontSize: '1.3rem', fontWeight: 800 }}>
              ✓ ĐÁP ÁN CHÍNH XÁC:
            </h2>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#ffffff', backgroundColor: '#090d16', padding: '0.75rem 1.25rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)', display: 'inline-block' }}>
              {revealData.correctAnswer}
            </div>
            {revealData.explanation && (
              <p style={{ color: '#94a3b8', marginTop: '0.75rem', fontSize: '0.95rem', fontStyle: 'italic' }}>
                Giải thích: {revealData.explanation}
              </p>
            )}
          </div>

          <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', marginBottom: '1rem', fontWeight: 800 }}>
            Bảng Xếp Hạng Hiện Tại
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.75rem' }}>Hạng</th>
                  <th style={{ padding: '0.75rem' }}>Người chơi</th>
                  <th style={{ padding: '0.75rem' }}>Điểm</th>
                  <th style={{ padding: '0.75rem' }}>Số câu đúng</th>
                  <th style={{ padding: '0.75rem' }}>Chuỗi đúng</th>
                </tr>
              </thead>
              <tbody>
                {revealData.leaderboard.map((entry) => (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 800, color: entry.rank === 1 ? '#facc15' : '#cbd5e1' }}>
                      #{entry.rank}
                    </td>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{entry.displayName}</td>
                    <td style={{ padding: '0.75rem', color: '#38bdf8', fontWeight: 800 }}>{entry.score}</td>
                    <td style={{ padding: '0.75rem' }}>{entry.correctCount}</td>
                    <td style={{ padding: '0.75rem', color: entry.streak > 1 ? '#f97316' : '#cbd5e1' }}>
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
              style={{ backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.85rem 2rem', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)' }}
            >
              Câu hỏi tiếp theo &rarr;
            </button>
          </div>
        </div>
      )}

      {/* 5. Màn hình Kết thúc Chung cuộc (Podium) */}
      {viewState === 'finish' && finishData && (
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '2.5rem', textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <h2 style={{ color: '#facc15', fontSize: '2.4rem', fontWeight: 900, margin: '0 0 1rem 0' }}>
            🏆 Trò Chơi Kết Thúc!
          </h2>

          {finishData.winner && (
            <div style={{ backgroundColor: '#090d16', border: '2px solid #eab308', borderRadius: '12px', padding: '1.5rem', display: 'inline-block', margin: '1rem 0 2rem 0', boxShadow: '0 10px 30px -5px rgba(234, 179, 8, 0.25)' }}>
              <div style={{ fontSize: '0.85rem', color: '#facc15', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em' }}>
                🌟 NHÀ VÔ ĐỊCH 🌟
              </div>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#38bdf8', margin: '0.5rem 0' }}>
                {finishData.winner.displayName}
              </div>
              <div style={{ fontSize: '1.3rem', color: '#4ade80', fontWeight: 800 }}>
                {finishData.winner.score} Điểm
              </div>
            </div>
          )}

          <h3 style={{ color: '#f8fafc', fontSize: '1.3rem', margin: '1rem 0', fontWeight: 800 }}>
            Bảng Xếp Hạng Chung Cuộc
          </h3>

          <div style={{ maxWidth: '650px', margin: '0 auto', overflowX: 'auto', textAlign: 'left' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.75rem' }}>Hạng</th>
                  <th style={{ padding: '0.75rem' }}>Người chơi</th>
                  <th style={{ padding: '0.75rem' }}>Điểm</th>
                  <th style={{ padding: '0.75rem' }}>Số câu đúng</th>
                </tr>
              </thead>
              <tbody>
                {finishData.leaderboard.map((entry) => (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 800, color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#94a3b8' : entry.rank === 3 ? '#b45309' : '#cbd5e1' }}>
                      #{entry.rank}
                    </td>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{entry.displayName}</td>
                    <td style={{ padding: '0.75rem', color: '#38bdf8', fontWeight: 800 }}>{entry.score}</td>
                    <td style={{ padding: '0.75rem' }}>{entry.correctCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '2.5rem' }}>
            <button
              type="button"
              onClick={handleRestart}
              style={{ backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.85rem 2rem', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)' }}
            >
              Tạo phòng chơi mới
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

