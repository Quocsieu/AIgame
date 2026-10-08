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
  const isUrgentTime = timeRemaining <= 5;

  // Kahoot color config for 4 choices (A: Red, B: Blue, C: Amber, D: Emerald)
  const choiceColors = [
    { bg: '#ef4444', hover: '#dc2626', icon: '▲', label: 'A' },
    { bg: '#2563eb', hover: '#1d4ed8', icon: '◆', label: 'B' },
    { bg: '#f59e0b', hover: '#d97706', icon: '●', label: 'C' },
    { bg: '#10b981', hover: '#059669', icon: '■', label: 'D' },
  ];

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '0.75rem 0.5rem 2rem 0.5rem' }}>
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
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--primary), var(--accent-sky))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '1.25rem',
              boxShadow: '0 4px 10px rgba(37, 99, 235, 0.3)',
            }}
          >
            🎮
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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

        <div style={{ textAlign: 'right' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block' }}>
            ĐIỂM SỐ
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'flex-end' }}>
            <span style={{ color: '#facc15', fontSize: '1.1rem' }}>⭐</span>
            <strong style={{ color: 'var(--accent-emerald)', fontSize: '1.45rem', fontWeight: 900 }}>
              {playerScore}
            </strong>
          </div>
        </div>
      </div>

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
              background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.2), rgba(56, 189, 248, 0.2))',
              border: '2px solid var(--primary-glow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.75rem',
              animation: 'pulseGlow 2.5s infinite',
            }}
          >
            ⏳
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
        </div>
      )}

      {/* 3. Màn hình Câu hỏi đang diễn ra (Question Screen) */}
      {screen === 'question' && currentQuestion && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '1.5rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {/* Top meta row: Question number & Timer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
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
                animation: isUrgentTime ? 'countdownTick 1s infinite' : 'none',
              }}
            >
              <span>⏱️</span>
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
              margin: '0.75rem 0 1.5rem 0',
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

          {/* Question text */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '14px',
              padding: '1.25rem',
              marginBottom: '1.5rem',
              textAlign: 'center',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '1.25rem',
                color: 'var(--text-primary)',
                lineHeight: 1.45,
                fontWeight: 800,
              }}
            >
              {currentQuestion.question}
            </h3>
          </div>

          {/* Kahoot-style 2x2 Choice Grid for Multiple Choice & Quick Button */}
          {(currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'QUICK_BUTTON') && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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
                    disabled={isAnswerSubmitted}
                    onClick={() => {
                      setSelectedAnswer(choice);
                      submitAnswer(choice);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '1rem 1.15rem',
                      backgroundColor: isSelected ? config.bg : 'var(--bg-card)',
                      color: isSelected ? '#ffffff' : 'var(--text-primary)',
                      border: isSelected ? `2px solid #ffffff` : `2px solid ${config.bg}`,
                      borderRadius: '14px',
                      fontSize: '1rem',
                      fontWeight: isSelected ? 800 : 700,
                      cursor: isAnswerSubmitted ? 'not-allowed' : 'pointer',
                      opacity: isAnswerSubmitted && !isSelected ? 0.45 : 1,
                      transform: isSelected ? 'scale(1.02)' : 'none',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.85rem',
                      boxShadow: isSelected
                        ? `0 0 20px ${config.bg}80, 0 6px 16px rgba(0,0,0,0.3)`
                        : '0 4px 10px rgba(0,0,0,0.15)',
                    }}
                  >
                    <span
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.25)' : config.bg,
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '1.05rem',
                        flexShrink: 0,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                      }}
                    >
                      {config.icon}
                    </span>
                    <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.35 }}>{choice}</span>
                    {isSelected && <span style={{ fontSize: '1.25rem', fontWeight: 900 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Fill in the blank */}
          {currentQuestion.type === 'FILL_IN_THE_BLANK' && (
            <div>
              <input
                type="text"
                disabled={isAnswerSubmitted}
                value={textInputAnswer}
                onChange={(e) => setTextInputAnswer(e.target.value)}
                placeholder="Nhập câu trả lời của bạn..."
                style={{
                  width: '100%',
                  padding: '1rem 1.15rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '1.05rem',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                disabled={isAnswerSubmitted || !textInputAnswer.trim()}
                onClick={() => submitAnswer(textInputAnswer.trim())}
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  padding: '0.95rem',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  cursor: isAnswerSubmitted || !textInputAnswer.trim() ? 'not-allowed' : 'pointer',
                  opacity: isAnswerSubmitted || !textInputAnswer.trim() ? 0.6 : 1,
                  boxShadow: isAnswerSubmitted || !textInputAnswer.trim() ? 'none' : 'var(--btn-shadow)',
                  transition: 'all 0.15s ease',
                }}
              >
                Gửi câu trả lời &rarr;
              </button>
            </div>
          )}

          {/* Crossword */}
          {currentQuestion.type === 'CROSSWORD' && (
            <div>
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
                  }}
                >
                  💡 Gợi ý: <strong style={{ color: 'var(--text-primary)' }}>{currentQuestion.crosswordClue}</strong>
                </div>
              )}
              <input
                type="text"
                disabled={isAnswerSubmitted}
                value={textInputAnswer}
                onChange={(e) => setTextInputAnswer(e.target.value)}
                placeholder="Nhập từ khóa ô chữ..."
                style={{
                  width: '100%',
                  padding: '1rem 1.15rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '1.05rem',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                disabled={isAnswerSubmitted || !textInputAnswer.trim()}
                onClick={() => submitAnswer(textInputAnswer.trim())}
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  padding: '0.95rem',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  cursor: isAnswerSubmitted || !textInputAnswer.trim() ? 'not-allowed' : 'pointer',
                  opacity: isAnswerSubmitted || !textInputAnswer.trim() ? 0.6 : 1,
                  boxShadow: isAnswerSubmitted || !textInputAnswer.trim() ? 'none' : 'var(--btn-shadow)',
                  transition: 'all 0.15s ease',
                }}
              >
                Gửi từ khóa &rarr;
              </button>
            </div>
          )}

          {/* Feedback banner after answer submission */}
          {isAnswerSubmitted && (
            <div
              style={{
                marginTop: '1.5rem',
                textAlign: 'center',
                color: 'var(--accent-sky)',
                fontWeight: 700,
                padding: '0.9rem',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderRadius: '12px',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                animation: 'popIn 0.3s ease-out',
              }}
            >
              ✓ Đã ghi nhận câu trả lời! Đang đợi công bố kết quả...
            </div>
          )}
        </div>
      )}

      {/* 4. Màn hình Công bố Đáp án & Kết quả Cá nhân (Reveal Screen) */}
      {screen === 'reveal' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '20px',
            padding: '2rem 1.5rem',
            textAlign: 'center',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          {personalResult && (
            <div style={{ marginBottom: '1.75rem' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.65rem 1.5rem',
                  borderRadius: '14px',
                  fontWeight: 900,
                  fontSize: '1.25rem',
                  backgroundColor: personalResult.isCorrect ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  border: personalResult.isCorrect ? '2px solid var(--accent-emerald)' : '2px solid #ef4444',
                  color: personalResult.isCorrect ? 'var(--accent-emerald)' : '#ef4444',
                  boxShadow: personalResult.isCorrect ? '0 0 20px rgba(16, 185, 129, 0.25)' : 'none',
                }}
              >
                <span>{personalResult.isCorrect ? '🎉' : '❌'}</span>
                <span>{personalResult.isCorrect ? 'CHÍNH XÁC!' : 'CHƯA ĐÚNG!'}</span>
              </div>

              <div
                style={{
                  marginTop: '0.85rem',
                  fontSize: '1.5rem',
                  fontWeight: 900,
                  color: personalResult.isCorrect ? 'var(--accent-emerald)' : 'var(--text-muted)',
                }}
              >
                {personalResult.pointsEarned > 0 ? `+${personalResult.pointsEarned} điểm` : '+0 điểm'}
              </div>
            </div>
          )}

          {/* Correct answer callout */}
          <div
            style={{
              margin: '1.25rem 0',
              padding: '1.15rem',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '14px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>
              ĐÁP ÁN ĐÚNG
            </span>
            <strong style={{ color: 'var(--accent-emerald)', fontSize: '1.35rem', fontWeight: 900 }}>
              {correctAnswer}
            </strong>

            {explanation && (
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  fontStyle: 'italic',
                  margin: '0.75rem 0 0 0',
                  lineHeight: '1.45',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                💡 {explanation}
              </p>
            )}
          </div>

          {/* Top 10 Mini Leaderboard */}
          <div
            style={{
              marginTop: '1.75rem',
              textAlign: 'left',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '14px',
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>
                🏆 BẢNG XẾP HẠNG (TOP 10)
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
                        <td style={{ padding: '0.6rem 0.5rem', color: entry.rank === 1 ? '#facc15' : entry.rank === 2 ? '#cbd5e1' : entry.rank === 3 ? '#d97706' : 'var(--text-muted)' }}>
                          {entry.rank === 1 ? '🥇 1' : entry.rank === 2 ? '🥈 2' : entry.rank === 3 ? '🥉 3' : `#${entry.rank}`}
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
        </div>
      )}

      {/* 5. Màn hình Kết thúc (Finish Screen) */}
      {screen === 'finish' && (
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
          <div style={{ fontSize: '4rem', marginBottom: '0.5rem', animation: 'popIn 0.5s ease-out' }}>
            🏆
          </div>
          <h2 style={{ color: '#facc15', fontSize: '2rem', margin: '0 0 0.5rem 0', fontWeight: 900 }}>
            Trận Đấu Kết Thúc!
          </h2>

          <div
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
            <div style={{ color: 'var(--accent-emerald)', fontSize: '2.5rem', fontWeight: 900, margin: '0.25rem 0' }}>
              {playerScore}
            </div>

            {finalRank !== null && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 1rem',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent-sky)',
                  fontWeight: 800,
                  fontSize: '1rem',
                  marginTop: '0.5rem',
                }}
              >
                <span>🎯</span>
                <span>Vị trí thứ #{finalRank} / {leaderboard.length} người chơi</span>
              </div>
            )}
          </div>

          <div style={{ marginTop: '1.5rem' }}>
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
                padding: '0.95rem',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1.05rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: 'var(--btn-shadow)',
                transition: 'all 0.15s ease',
              }}
            >
              Tham gia trò chơi khác &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
