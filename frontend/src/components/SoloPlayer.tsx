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
  advancePracticeSession,
  createPracticeSession,
  fetchGameById,
  fetchPracticeResult,
  fetchPracticeSessionQuestion,
  fetchPracticeSessionSummary,
  startPracticeSession,
  submitPracticeAnswer,
} from '../services/api.js';
import { AdventureGameEngine } from './AdventureGameEngine.js';
import type {
  GameSpecification,
  PracticeFinalResult,
  PracticeQuestionResult,
  SanitizedQuestion,
} from '../types/index.js';

interface SoloPlayerProps {
  gameId?: string;
  initialSpec?: GameSpecification | null;
  onLeave: () => void;
}

export const SoloPlayer: React.FC<SoloPlayerProps> = ({
  gameId,
  initialSpec,
  onLeave,
}) => {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadedSpec, setLoadedSpec] = useState<GameSpecification | null>(initialSpec || null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<SanitizedQuestion | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [textAnswerInput, setTextAnswerInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [questionFeedback, setQuestionFeedback] = useState<PracticeQuestionResult | null>(null);
  const [finalResult, setFinalResult] = useState<PracticeFinalResult | null>(null);

  const [playerScore, setPlayerScore] = useState(0);
  const [playerStreak, setPlayerStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(20);

  const timerRef = useRef<number | null>(null);

  const handleLeave = () => {
    const targetGameId = gameId || initialSpec?.gameId;
    if (targetGameId) sessionStorage.removeItem(`active_solo_session_${targetGameId}`);
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
    setTimeLeft(durationSec);

    timerRef.current = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const initializeSession = async (forceStart?: boolean | unknown) => {
    const isExplicitStart = forceStart === true;
    setIsLoading(true);
    setErrorMessage(null);
    setFinalResult(null);
    setQuestionFeedback(null);
    setSelectedChoice(null);
    setTextAnswerInput('');
    setPlayerScore(0);
    setPlayerStreak(0);
    stopTimer();

    const targetGameId = gameId || initialSpec?.gameId;
    if (initialSpec) {
      setLoadedSpec(initialSpec);
    } else if (gameId && !loadedSpec) {
      try {
        const fetched = await fetchGameById(gameId, { mode: 'public' }).catch(() =>
          fetchGameById(gameId)
        );
        setLoadedSpec(fetched);
        if (fetched?.gameType === 'ADVENTURE' && !isExplicitStart) {
          const advSessionKey = targetGameId ? `active_solo_session_${targetGameId}` : null;
          if (advSessionKey) sessionStorage.removeItem(advSessionKey);
          setSessionId(null);
          setIsLoading(false);
          return;
        }
      } catch {
        // Ignore if public play only allows session endpoints
      }
    }
    const sessionKey = targetGameId ? `active_solo_session_${targetGameId}` : null;
    if ((initialSpec?.gameType === 'ADVENTURE' || loadedSpec?.gameType === 'ADVENTURE') && !isExplicitStart) {
      if (sessionKey) sessionStorage.removeItem(sessionKey);
      setSessionId(null);
      setIsLoading(false);
      return;
    }
    const savedSessionId = sessionKey ? sessionStorage.getItem(sessionKey) : null;

    // Reload recovery: check if previous in-progress session exists
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
          const questionTime = q.timePerQuestion || 20;
          startCountdown(questionTime);
          setIsLoading(false);
          return;
        }
      } catch {
        // Stale or abandoned session in storage, clear and recreate
        if (sessionKey) sessionStorage.removeItem(sessionKey);
      }
    }

    try {
      let activeSessionId: string;

      if (gameId) {
        const sessionRes = await createPracticeSession({ gameId, publicPlay: true });
        activeSessionId = sessionRes.sessionId;
      } else if (initialSpec?.gameId) {
        const sessionRes = await createPracticeSession({
          gameId: initialSpec.gameId,
          gameSpecification: initialSpec,
        });
        activeSessionId = sessionRes.sessionId;
      } else {
        throw new Error('Không tìm thấy thông tin bộ câu hỏi để bắt đầu chơi.');
      }

      setSessionId(activeSessionId);
      if (sessionKey) {
        sessionStorage.setItem(sessionKey, activeSessionId);
      }
      const startRes = await startPracticeSession(activeSessionId);
      setCurrentQuestion(startRes.question);
      const questionTime = startRes.question.timePerQuestion || 20;
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
    };
  }, [gameId, initialSpec]);

  const handleSubmitAnswer = async (answerVal?: string) => {
    if (!sessionId || !currentQuestion || questionFeedback || isSubmitting) return;

    const finalAnswer = (answerVal !== undefined ? answerVal : (selectedChoice || textAnswerInput)).trim();
    if (!finalAnswer) {
      toast.warning('Vui lòng chọn hoặc nhập đáp án trước khi gửi.', 'Chưa có đáp án');
      return;
    }

    setIsSubmitting(true);
    stopTimer();

    try {
      const res = await submitPracticeAnswer(sessionId, {
        questionId: currentQuestion.id,
        answer: finalAnswer,
      });
      setQuestionFeedback(res);
      setPlayerScore((prev) => prev + res.pointsEarned);
      setPlayerStreak((prev) => (res.isCorrect ? prev + 1 : 0));
    } catch (err: any) {
      if (err.message?.includes('abandoned') || err.message?.includes('đã bị kết thúc')) {
        toast.warning('Phiên luyện tập này đã được kết thúc bởi người tạo. Đang chuyển hướng...', 'Phiên đã đóng');
        setTimeout(() => handleLeave(), 1500);
      } else {
        toast.error(err.message || 'Không thể gửi câu trả lời.', 'Lỗi nộp bài');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextQuestion = async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setQuestionFeedback(null);
    setSelectedChoice(null);
    setTextAnswerInput('');

    try {
      const advanceRes = await advancePracticeSession(sessionId);
      if (advanceRes.finished && advanceRes.result) {
        setFinalResult(advanceRes.result);
        setCurrentQuestion(null);
        stopTimer();
        const targetGameId = gameId || initialSpec?.gameId;
        if (targetGameId) sessionStorage.removeItem(`active_solo_session_${targetGameId}`);
      } else if (advanceRes.question) {
        setCurrentQuestion(advanceRes.question);
        const qTime = advanceRes.question.timePerQuestion || 20;
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
      setIsLoading(false);
    }
  };

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

  const activeGameSpec = loadedSpec || initialSpec;
  if (activeGameSpec && activeGameSpec.gameType === 'ADVENTURE') {
    return (
      <div className="w-full h-full">
        <AdventureGameEngine
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
          questionFeedback={questionFeedback}
          submittingAnswer={isSubmitting}
          onSubmitAnswer={handleSubmitAnswer}
          onNextQuestion={handleNextQuestion}
          finalResult={finalResult}
          onRestartSession={() => initializeSession(true)}
          onExit={handleLeave}
        />
      </div>
    );
  }

  // FINISH SCREEN
  if (finalResult) {
    const accuracy =
      finalResult.accuracy ??
      (finalResult.totalQuestions > 0
        ? Math.round(
            (((finalResult.correctAnswers ?? finalResult.correctCount ?? 0) /
              finalResult.totalQuestions)) *
              100
          )
        : 0);

    const totalPts = finalResult.totalScore ?? finalResult.score ?? 0;
    const correctCount = finalResult.correctAnswers ?? finalResult.correctCount ?? 0;

    return (
      <div
        style={{
          maxWidth: '560px',
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
            marginBottom: '1.25rem',
          }}
        >
          <TrophyIcon size={34} />
        </div>

        <h2 style={{ margin: '0 0 0.35rem 0', fontSize: '1.75rem', fontWeight: 900 }}>
          Hoàn Thành Trận Đấu!
        </h2>
        <p style={{ margin: '0 0 1.75rem 0', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Bạn đã xuất sắc vượt qua tất cả các câu hỏi của bộ đề.
        </p>

        {/* Score cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
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
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem' }}>
              TỔNG ĐIỂM
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--primary)' }}>
              {totalPts.toLocaleString()}
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
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem' }}>
              ĐÚNG
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent-emerald)' }}>
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
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.35rem' }}>
              CHÍNH XÁC
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#f59e0b' }}>
              {accuracy}%
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={initializeSession}
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
            Rời Khỏi
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE QUESTION SCREEN
  if (!currentQuestion) return null;

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '1rem 1rem 3rem' }}>
      {/* Top Bar: Question Index, Score, Streak, Timer, Leave */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Timer Badge */}
          <div
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
            <span>Thoát</span>
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

        {/* FEEDBACK STATE: Reveal Answer and Explanation */}
        {questionFeedback ? (
          <div
            style={{
              padding: '1.75rem',
              borderRadius: '18px',
              backgroundColor: questionFeedback.isCorrect
                ? 'rgba(16, 185, 129, 0.12)'
                : 'rgba(239, 68, 68, 0.12)',
              border: `2px solid ${
                questionFeedback.isCorrect ? 'var(--accent-emerald)' : 'var(--accent-rose)'
              }`,
              marginBottom: '1.5rem',
              animation: 'popIn 0.2s ease',
            }}
          >
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
              <span>Tiếp Tục Câu Kế Tiếp</span>
              <ArrowRightIcon size={16} />
            </button>
          </div>
        ) : (
          /* ACTIVE ANSWER INPUT / OPTIONS */
          <div>
            {/* MULTIPLE CHOICE / CHOICES */}
            {currentQuestion.type === 'MULTIPLE_CHOICE' && currentQuestion.choices && (
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
            {currentQuestion.type === 'QUICK_BUTTON' && (
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
                  onClick={() => handleSubmitAnswer('Đúng')}
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
                  <span>ĐÚNG</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSubmitAnswer('Sai')}
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
                  <span>SAI</span>
                </button>
              </div>
            )}

            {/* FILL IN THE BLANK / CROSSWORD / TEXT */}
            {(currentQuestion.type === 'FILL_IN_THE_BLANK' ||
              currentQuestion.type === 'CROSSWORD') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmitAnswer();
                }}
                style={{ maxWidth: '520px', margin: '0 auto' }}
              >
                <div style={{ display: 'flex', gap: '0.65rem' }}>
                  <input
                    type="text"
                    value={textAnswerInput}
                    onChange={(e) => setTextAnswerInput(e.target.value)}
                    placeholder="Nhập câu trả lời của bạn..."
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
                    Gửi
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

