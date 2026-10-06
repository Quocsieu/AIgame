import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../components/ToastContext.js';
import { GameSocketClient } from '../services/socket.js';
import type { LeaderboardEntry, SanitizedQuestion } from '../types/index.js';

interface PlayPageProps {
  roomCode: string;
  displayName: string;
  onLeave?: () => void;
}

export const PlayPage: React.FC<PlayPageProps> = ({ roomCode, displayName, onLeave }) => {
  const toast = useToast();

  const [playerId, setPlayerId] = useState('');
  const [playerScore, setPlayerScore] = useState(0);

  // 'lobby' | 'question' | 'reveal' | 'finish'
  const [screen, setScreen] = useState<'lobby' | 'question' | 'reveal' | 'finish'>('lobby');

  const [currentQuestion, setCurrentQuestion] = useState<SanitizedQuestion | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [textInputAnswer, setTextInputAnswer] = useState('');
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);

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

  const submitAnswer = (ans: string) => {
    if (!socketRef.current || isAnswerSubmitted || !currentQuestion) return;

    setIsAnswerSubmitted(true);
    socketRef.current.send({
      type: 'player.answer',
      questionId: currentQuestion.id,
      answer: ans,
    });
  };

  useEffect(() => {
    const client = new GameSocketClient();
    socketRef.current = client;

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
        client.send({
          type: 'player.join',
          roomCode,
          displayName,
        });
      }
    });

    client.on('room.joined', (msg: any) => {
      if (msg.playerToken) {
        sessionStorage.setItem(tokenKey, msg.playerToken);
      }
      if (msg.playerId) {
        setPlayerId(msg.playerId);
      }
      toast.success(`Đã vào phòng [${roomCode}] thành công!`, 'Tham gia thành công');
    });

    client.on('game.started', () => {
      setScreen('question');
      toast.info('Trò chơi đã bắt đầu! Chúc bạn thi đấu đạt kết quả cao nhất!', 'Bắt đầu');
    });

    client.on('question.started', (msg: any) => {
      setCurrentQuestion(msg.question);
      setSelectedAnswer(null);
      setTextInputAnswer('');
      setIsAnswerSubmitted(false);
      setScreen('question');

      const duration = msg.question.timePerQuestion || 20;
      startTimer(duration);
    });

    client.on('question.answerReceived', () => {
      toast.info('Đã ghi nhận câu trả lời của bạn.', 'Đã nộp bài');
    });

    client.on('question.timeUp', () => {
      stopTimer();
      setIsAnswerSubmitted(true);
      toast.info('Hết thời gian trả lời!', 'Hết giờ');
    });

    client.on('question.revealed', (msg: any) => {
      stopTimer();
      setCorrectAnswer(msg.correctAnswer);
      setExplanation(msg.explanation);
      setLeaderboard(msg.leaderboard || []);

      if (msg.personalResult) {
        setPersonalResult(msg.personalResult);
        if (msg.personalResult.isCorrect) {
          toast.success(`Chính xác! Bạn nhận được +${msg.personalResult.pointsEarned} điểm!`, 'Chính xác');
        } else {
          toast.error('Rất tiếc! Chưa phải đáp án chính xác.', 'Chưa chính xác');
        }
      }

      if (msg.leaderboard && playerId) {
        const me = msg.leaderboard.find((e: LeaderboardEntry) => e.playerId === playerId);
        if (me) {
          setPlayerScore(me.score);
        }
      }

      setScreen('reveal');
    });

    client.on('game.finished', (msg: any) => {
      stopTimer();
      setLeaderboard(msg.leaderboard || []);
      if (msg.leaderboard && playerId) {
        const me = msg.leaderboard.find((e: LeaderboardEntry) => e.playerId === playerId);
        if (me) {
          setPlayerScore(me.score);
          setFinalRank(me.rank);
        }
      }
      setScreen('finish');
      toast.success('Trò chơi đã kết thúc! Xem kết quả chung cuộc của bạn bên dưới.', 'Kết thúc');
    });

    client.on('error', (msg: any) => {
      toast.error(msg.message || 'Lỗi kết nối phòng chơi.', 'Thông báo');
    });

    client.connect();

    return () => {
      stopTimer();
      client.close();
    };
  }, [roomCode, displayName]);

  const timerPercentage = totalQuestionTime > 0 ? Math.max(0, (timeRemaining / totalQuestionTime) * 100) : 0;

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
      {/* Thanh thông tin người chơi */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '0.75rem 1.25rem', marginBottom: '1rem' }}>
        <div>
          <span style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>
            Người chơi:
          </span>
          <strong style={{ color: '#38bdf8', fontSize: '1.1rem' }}>{displayName}</strong>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>
            Điểm số:
          </span>
          <strong style={{ color: '#4ade80', fontSize: '1.3rem' }}>{playerScore}</strong>
        </div>
      </div>

      {/* 1. Màn hình Sảnh Chờ */}
      {screen === 'lobby' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '3rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          <h2 style={{ color: '#38bdf8', fontSize: '1.5rem', margin: '0 0 0.5rem 0' }}>
            Bạn đã vào phòng chơi thành công!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '1rem', margin: '0 0 2rem 0' }}>
            Vui lòng giữ màn hình mở, trò chơi sẽ tự động bắt đầu khi chủ phòng kích hoạt...
          </p>
          <div style={{ display: 'inline-block', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', padding: '0.5rem 1.25rem', color: '#38bdf8', fontWeight: 700, letterSpacing: '2px', fontSize: '1.1rem' }}>
            PHÒNG: {roomCode}
          </div>
        </div>
      )}

      {/* 2. Màn hình Câu hỏi đang diễn ra */}
      {screen === 'question' && currentQuestion && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ backgroundColor: '#334155', color: '#38bdf8', padding: '0.25rem 0.6rem', borderRadius: '4px', fontWeight: 700, fontSize: '0.85rem' }}>
              Câu {(currentQuestion.questionIndex || 0) + 1} / {currentQuestion.totalQuestions || 5}
            </span>
            <span style={{ color: timeRemaining <= 5 ? '#ef4444' : '#38bdf8', fontWeight: 800, fontSize: '1.1rem' }}>
              {timeRemaining}s
            </span>
          </div>

          {/* Thanh đếm ngược thời gian */}
          <div style={{ width: '100%', height: '6px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden', margin: '0.5rem 0 1.25rem 0' }}>
            <div
              style={{
                width: `${timerPercentage}%`,
                height: '100%',
                backgroundColor: timeRemaining <= 5 ? '#ef4444' : '#22c55e',
                transition: 'width 0.25s linear, background-color 0.25s ease',
              }}
            />
          </div>

          <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.25rem', color: '#f8fafc', lineHeight: 1.4 }}>
            {currentQuestion.question}
          </h3>

          {/* Câu hỏi trắc nghiệm hoặc nút bấm nhanh */}
          {(currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'QUICK_BUTTON') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {currentQuestion.choices?.map((choice, idx) => {
                const isSelected = selectedAnswer === choice;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isAnswerSubmitted}
                    onClick={() => {
                      setSelectedAnswer(choice);
                      submitAnswer(choice);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '1rem 1.25rem',
                      backgroundColor: isSelected ? '#1e3a8a' : '#334155',
                      color: isSelected ? '#38bdf8' : 'white',
                      border: isSelected ? '2px solid #38bdf8' : '2px solid #475569',
                      borderRadius: '8px',
                      fontSize: '1.05rem',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: isAnswerSubmitted ? 'not-allowed' : 'pointer',
                      opacity: isAnswerSubmitted && !isSelected ? 0.6 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          )}

          {/* Câu hỏi điền vào chỗ trống */}
          {currentQuestion.type === 'FILL_IN_THE_BLANK' && (
            <div>
              <input
                type="text"
                disabled={isAnswerSubmitted}
                value={textInputAnswer}
                onChange={(e) => setTextInputAnswer(e.target.value)}
                placeholder="Nhập câu trả lời của bạn..."
                style={{ width: '100%', padding: '0.85rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white', fontSize: '1.1rem', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                disabled={isAnswerSubmitted || !textInputAnswer.trim()}
                onClick={() => submitAnswer(textInputAnswer.trim())}
                style={{
                  width: '100%',
                  marginTop: '0.75rem',
                  padding: '0.85rem',
                  backgroundColor: '#16a34a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  cursor: (isAnswerSubmitted || !textInputAnswer.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                Gửi câu trả lời
              </button>
            </div>
          )}

          {/* Câu hỏi ô chữ */}
          {currentQuestion.type === 'CROSSWORD' && (
            <div>
              {currentQuestion.crosswordClue && (
                <div style={{ backgroundColor: '#0f172a', padding: '0.75rem 1rem', borderRadius: '6px', border: '1px solid #334155', color: '#38bdf8', marginBottom: '1rem', fontSize: '1rem' }}>
                  Gợi ý: <strong>{currentQuestion.crosswordClue}</strong>
                </div>
              )}
              <input
                type="text"
                disabled={isAnswerSubmitted}
                value={textInputAnswer}
                onChange={(e) => setTextInputAnswer(e.target.value)}
                placeholder="Nhập từ khóa ô chữ..."
                style={{ width: '100%', padding: '0.85rem', backgroundColor: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: 'white', fontSize: '1.1rem', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                disabled={isAnswerSubmitted || !textInputAnswer.trim()}
                onClick={() => submitAnswer(textInputAnswer.trim())}
                style={{
                  width: '100%',
                  marginTop: '0.75rem',
                  padding: '0.85rem',
                  backgroundColor: '#16a34a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  cursor: (isAnswerSubmitted || !textInputAnswer.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                Gửi từ khóa
              </button>
            </div>
          )}

          {isAnswerSubmitted && (
            <div style={{ marginTop: '1.5rem', textAlign: 'center', color: '#38bdf8', fontWeight: 600, padding: '0.75rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #0284c7' }}>
              ✓ Đã ghi nhận câu trả lời! Đang đợi công bố kết quả...
            </div>
          )}
        </div>
      )}

      {/* 3. Màn hình Công bố Đáp án & Kết quả Cá nhân */}
      {screen === 'reveal' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2rem 1.5rem', textAlign: 'center' }}>
          {personalResult && (
            <div style={{ marginBottom: '1.25rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '0.4rem 1rem',
                  borderRadius: '6px',
                  fontWeight: 800,
                  fontSize: '1.1rem',
                  backgroundColor: personalResult.isCorrect ? '#14532d' : '#7f1d1d',
                  color: personalResult.isCorrect ? '#4ade80' : '#f87171',
                }}
              >
                {personalResult.isCorrect ? '✓ CHÍNH XÁC' : '✗ CHƯA ĐÚNG'}
              </span>
              <div style={{ marginTop: '0.75rem', fontSize: '1.3rem', fontWeight: 800, color: personalResult.isCorrect ? '#4ade80' : '#94a3b8' }}>
                {personalResult.pointsEarned > 0 ? `+${personalResult.pointsEarned} điểm` : '+0 điểm'}
              </div>
            </div>
          )}

          <div style={{ margin: '1rem 0', color: '#cbd5e1', fontSize: '1rem' }}>
            Đáp án đúng: <strong style={{ color: '#4ade80' }}>{correctAnswer}</strong>
          </div>

          {explanation && (
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic', margin: '0.5rem 0 1.5rem 0' }}>
              ({explanation})
            </p>
          )}

          {/* Bảng xếp hạng thu gọn */}
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <h4 style={{ color: '#94a3b8', margin: '0 0 0.5rem 0', fontSize: '0.9rem', textTransform: 'uppercase' }}>
              Bảng xếp hạng (Top 10):
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>#</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Người chơi</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 10).map((entry) => {
                    const isMe = entry.playerId === playerId;
                    return (
                      <tr
                        key={entry.playerId}
                        style={{
                          borderBottom: '1px solid #334155',
                          backgroundColor: isMe ? '#1e3a8a' : 'transparent',
                          fontWeight: isMe ? 700 : 400,
                        }}
                      >
                        <td style={{ padding: '0.5rem' }}>{entry.rank}</td>
                        <td style={{ padding: '0.5rem', color: isMe ? '#38bdf8' : '#f8fafc' }}>
                          {entry.displayName} {isMe ? '(Bạn)' : ''}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', color: '#4ade80' }}>{entry.score}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. Màn hình Kết thúc */}
      {screen === 'finish' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🏆</div>
          <h2 style={{ color: '#facc15', fontSize: '1.8rem', margin: '0 0 0.5rem 0' }}>
            Trò Chơi Kết Thúc!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem', margin: '0.5rem 0' }}>
            Điểm chung cuộc: <strong style={{ color: '#4ade80', fontSize: '1.5rem' }}>{playerScore}</strong> điểm
          </p>
          {finalRank !== null && (
            <p style={{ color: '#38bdf8', fontSize: '1.2rem', fontWeight: 700, margin: '0.5rem 0 1.5rem 0' }}>
              Bạn đạt vị trí thứ #{finalRank} trên tổng số {leaderboard.length} người chơi!
            </p>
          )}

          <div style={{ marginTop: '2rem' }}>
            <button
              type="button"
              onClick={() => {
                if (onLeave) {
                  onLeave();
                } else {
                  window.location.reload();
                }
              }}
              style={{
                width: '100%',
                padding: '0.85rem',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1.1rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Tham gia trò chơi khác
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

