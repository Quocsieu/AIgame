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

  const handleRestart = () => {
    stopTimer();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setRoomCode('');
    setHostToken('');
    setPlayers([]);
    setCurrentQuestion(null);
    setRevealData(null);
    setFinishData(null);
    setViewState('setup');
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, color: '#38bdf8', fontSize: '1.75rem', fontWeight: 800 }}>
            Màn Hình Quản Trị Trò Chơi (Chủ Phòng)
          </h1>
          <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0', fontSize: '0.95rem' }}>
            Điều khiển tiến trình trò chơi, theo dõi người tham gia và công bố kết quả
          </p>
        </div>
      </header>

      {/* 1. Màn hình Khởi tạo Phòng Chơi */}
      {viewState === 'setup' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2rem' }}>
          <h2 style={{ color: '#f8fafc', fontSize: '1.3rem', marginTop: 0 }}>Khởi tạo Phòng Chơi Trực Tuyến</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
            Nhập mã trò chơi (Game ID) hoặc để trống để sử dụng bộ câu hỏi mẫu. Phòng chơi hỗ trợ tối đa 300 người tham gia đồng thời.
          </p>

          <div style={{ marginTop: '1.5rem', maxWidth: '500px' }}>
            <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              Mã trò chơi (Game ID):
            </label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                placeholder="game_... (hoặc để trống)"
                style={{ flex: 1, padding: '0.75rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white', fontSize: '1rem' }}
              />
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={isCreatingRoom}
                style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', padding: '0.75rem 1.5rem', fontWeight: 700, cursor: isCreatingRoom ? 'not-allowed' : 'pointer', fontSize: '1rem' }}
              >
                {isCreatingRoom ? 'Đang tạo...' : 'Tạo phòng'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Màn hình Sảnh Chờ (Lobby) */}
      {viewState === 'lobby' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <h2 style={{ color: '#f8fafc', margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>
                {gameTitle || 'Sảnh chờ trò chơi'}
              </h2>
              <div style={{ margin: '1rem 0' }}>
                <span style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>
                  MÃ PHÒNG:
                </span>
                <span style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '4px', color: '#38bdf8', backgroundColor: '#0f172a', padding: '0.4rem 1.5rem', borderRadius: '8px', display: 'inline-block', border: '2px dashed #0284c7', marginTop: '0.3rem' }}>
                  {roomCode}
                </span>
              </div>
              <p style={{ color: '#94a3b8', margin: '0.5rem 0' }}>
                Tham gia tại: <strong style={{ color: '#38bdf8' }}>{joinUrl || `${window.location.origin}/?room=${roomCode}`}</strong>
              </p>
            </div>

            {qrDataUrl && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={qrDataUrl}
                  alt="Mã QR tham gia phòng"
                  style={{ width: '180px', height: '180px', borderRadius: '8px', border: '4px solid white', backgroundColor: 'white' }}
                />
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                  Quét mã bằng điện thoại để vào phòng
                </p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem 1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Người chơi đã kết nối</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#38bdf8' }}>{players.length}</div>
            </div>

            <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem 1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Sức chứa tối đa</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#94a3b8' }}>300</div>
            </div>

            <button
              type="button"
              onClick={handleStartGame}
              disabled={players.length === 0}
              style={{
                backgroundColor: players.length === 0 ? '#475569' : '#16a34a',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '0.85rem 2rem',
                fontSize: '1.1rem',
                fontWeight: 700,
                cursor: players.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Bắt đầu trò chơi &rarr;
            </button>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
              Danh sách người chơi ({players.length}):
            </h3>
            <div style={{ minHeight: '50px', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '1rem', backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155' }}>
              {players.length === 0 ? (
                <span style={{ color: '#64748b', fontStyle: 'italic' }}>Đang đợi người chơi quét mã hoặc nhập mã phòng tham gia...</span>
              ) : (
                players.map((p) => (
                  <span
                    key={p.id}
                    style={{
                      display: 'inline-block',
                      padding: '0.4rem 0.8rem',
                      backgroundColor: '#334155',
                      borderRadius: '20px',
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      color: '#f8fafc',
                    }}
                  >
                    {p.displayName}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Màn hình Câu hỏi đang diễn ra */}
      {viewState === 'question' && currentQuestion && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '1.1rem' }}>
              Câu hỏi {(currentQuestion.questionIndex || 0) + 1} / {currentQuestion.totalQuestions || 5}
            </span>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.5rem 1.25rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Thời gian còn lại</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: timeRemaining <= 5 ? '#ef4444' : '#38bdf8' }}>
                {timeRemaining}s
              </div>
            </div>
          </div>

          <h2 style={{ margin: '1rem 0 1.5rem 0', color: '#f8fafc', fontSize: '1.5rem', lineHeight: 1.4 }}>
            {currentQuestion.question}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
            {currentQuestion.choices?.map((choice, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#334155',
                  padding: '1rem 1.25rem',
                  borderRadius: '8px',
                  fontSize: '1.1rem',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                }}
              >
                {choice}
              </div>
            ))}

            {currentQuestion.crosswordClue && (
              <div style={{ backgroundColor: '#334155', padding: '1rem', borderRadius: '8px', color: '#38bdf8', fontSize: '1.1rem' }}>
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
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2rem' }}>
          <div style={{ borderBottom: '1px solid #334155', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}>
            <h2 style={{ color: '#22c55e', margin: '0 0 0.5rem 0', fontSize: '1.4rem' }}>Đáp án chính xác:</h2>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#4ade80' }}>
              {revealData.correctAnswer}
            </div>
            {revealData.explanation && (
              <p style={{ color: '#94a3b8', marginTop: '0.5rem', fontSize: '0.95rem', fontStyle: 'italic' }}>
                Giải thích: {revealData.explanation}
              </p>
            )}
          </div>

          <h3 style={{ color: '#f8fafc', fontSize: '1.2rem', marginBottom: '1rem' }}>
            Bảng Xếp Hạng Hiện Tại
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: '0.9rem' }}>
                  <th style={{ padding: '0.75rem' }}>Hạng</th>
                  <th style={{ padding: '0.75rem' }}>Người chơi</th>
                  <th style={{ padding: '0.75rem' }}>Điểm</th>
                  <th style={{ padding: '0.75rem' }}>Số câu đúng</th>
                  <th style={{ padding: '0.75rem' }}>Chuỗi đúng</th>
                </tr>
              </thead>
              <tbody>
                {revealData.leaderboard.map((entry) => (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 700, color: entry.rank === 1 ? '#facc15' : '#cbd5e1' }}>
                      #{entry.rank}
                    </td>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{entry.displayName}</td>
                    <td style={{ padding: '0.75rem', color: '#38bdf8', fontWeight: 700 }}>{entry.score}</td>
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
              style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', padding: '0.85rem 2rem', fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Câu hỏi tiếp theo &rarr;
            </button>
          </div>
        </div>
      )}

      {/* 5. Màn hình Kết thúc Chung cuộc (Podium) */}
      {viewState === 'finish' && finishData && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2.5rem', textAlign: 'center' }}>
          <h2 style={{ color: '#facc15', fontSize: '2.2rem', margin: '0 0 1rem 0' }}>
            🏆 Trò Chơi Kết Thúc!
          </h2>

          {finishData.winner && (
            <div style={{ backgroundColor: '#0f172a', border: '2px solid #eab308', borderRadius: '12px', padding: '1.5rem', display: 'inline-block', margin: '1rem 0 2rem 0' }}>
              <div style={{ fontSize: '0.9rem', color: '#facc15', textTransform: 'uppercase', fontWeight: 700 }}>Nhà vô địch</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#38bdf8', margin: '0.5rem 0' }}>
                {finishData.winner.displayName}
              </div>
              <div style={{ fontSize: '1.3rem', color: '#4ade80', fontWeight: 700 }}>
                {finishData.winner.score} Điểm
              </div>
            </div>
          )}

          <h3 style={{ color: '#f8fafc', fontSize: '1.3rem', margin: '1rem 0' }}>
            Bảng Xếp Hạng Chung Cuộc
          </h3>

          <div style={{ maxWidth: '650px', margin: '0 auto', overflowX: 'auto', textAlign: 'left' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ padding: '0.75rem' }}>Hạng</th>
                  <th style={{ padding: '0.75rem' }}>Người chơi</th>
                  <th style={{ padding: '0.75rem' }}>Điểm</th>
                  <th style={{ padding: '0.75rem' }}>Số câu đúng</th>
                </tr>
              </thead>
              <tbody>
                {finishData.leaderboard.map((entry) => (
                  <tr key={entry.playerId} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 700, color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#94a3b8' : entry.rank === 3 ? '#b45309' : '#cbd5e1' }}>
                      #{entry.rank}
                    </td>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{entry.displayName}</td>
                    <td style={{ padding: '0.75rem', color: '#38bdf8', fontWeight: 700 }}>{entry.score}</td>
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
              style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', padding: '0.85rem 2rem', fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Tạo phòng chơi mới
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

