import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangleIcon,
  BarChartIcon as ChartBarIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  GamepadIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  TrophyIcon,
} from '../components/Icons.js';
import {
  fetchGameById,
  fetchLearningAnalytics,
  fetchPracticeHistory,
} from '../services/api.js';
import type {
  AuthenticatedUser,
  GameSpecification,
  LearningAnalyticsSummary,
  PersistedPracticeSessionRecord,
} from '../types/index.js';

interface ReportsPageProps {
  currentUser?: AuthenticatedUser | null;
  onNavigateToCreate?: () => void;
  onNavigateToDiscover?: () => void;
  onNavigateToLibrary?: () => void;
  onNavigateToSoloPlay?: (spec: GameSpecification) => void;
}

const formatGameTypeBadge = (gameType: string): string => {
  switch (gameType) {
    case 'QUIZ':
    case 'MULTIPLE_CHOICE':
      return 'Quiz (Trắc nghiệm)';
    case 'TRUE_FALSE':
    case 'QUICK_BUTTON':
      return 'True/False (Đúng/Sai)';
    case 'TYPE_ANSWER':
    case 'FILL_IN_THE_BLANK':
      return 'Type Answer (Nhập đáp án)';
    case 'PUZZLE':
      return 'Puzzle (Sắp xếp)';
    case 'SLIDER':
      return 'Slider (Thanh trượt)';
    case 'ADVENTURE':
      return 'Game đi cảnh';
    default:
      return gameType;
  }
};

const formatDuration = (durationMs: number): string => {
  if (!durationMs || durationMs <= 0) return '0s';
  const totalSec = Math.round(durationMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return secs > 0 ? `${mins}p ${secs}s` : `${mins}p`;
};

export const ReportsPage: React.FC<ReportsPageProps> = ({
  onNavigateToCreate,
  onNavigateToDiscover,
  onNavigateToSoloPlay,
}) => {
  const [analytics, setAnalytics] = useState<LearningAnalyticsSummary | null>(null);
  const [sessions, setSessions] = useState<PersistedPracticeSessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadReportData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [analyticsRes, sessionsRes] = await Promise.all([
        fetchLearningAnalytics(),
        fetchPracticeHistory(30),
      ]);
      setAnalytics(analyticsRes);
      setSessions(Array.isArray(sessionsRes) ? sessionsRes : []);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể tải dữ liệu báo cáo học tập.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const handleReplayGame = async (gameId: string) => {
    if (!onNavigateToSoloPlay) return;
    try {
      const spec = await fetchGameById(gameId);
      onNavigateToSoloPlay(spec);
    } catch {
      // Fallback to URL play
      window.location.href = `/?play=${encodeURIComponent(gameId)}`;
    }
  };

  const overview = analytics?.overview;

  return (
    <div
      style={{
        maxWidth: '1320px',
        margin: '0 auto',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.74rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--primary)',
              marginBottom: '4px',
            }}
          >
            <ChartBarIcon size={14} />
            <span>Báo cáo & Phân tích kết quả</span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(1.35rem, 2.2vw, 1.75rem)',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Báo cáo phiên chơi & Hiệu suất học tập
          </h1>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: '0.86rem',
              color: 'var(--text-secondary)',
            }}
          >
            Số liệu thực tế từ các bộ câu hỏi đã tạo, phiên luyện tập cá nhân và phòng chơi trực tiếp.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={loadReportData}
            disabled={isLoading}
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '8px',
              padding: '0 14px',
              height: '38px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshIcon size={14} />
            <span>Làm mới</span>
          </button>

          {onNavigateToCreate && (
            <button
              type="button"
              onClick={onNavigateToCreate}
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink, #060913)',
                border: '1px solid var(--primary)',
                borderRadius: '8px',
                padding: '0 16px',
                height: '38px',
                fontSize: '0.83rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <SparklesIcon size={14} />
              <span>Tạo game bằng AI</span>
            </button>
          )}
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            borderRadius: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: 'var(--accent-rose)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem', fontWeight: 600 }}>
            <AlertTriangleIcon size={16} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={loadReportData}
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* 4 KPI Summary Cards */}
      <section
        aria-label="Chỉ số tổng quan"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Game đã tạo
          </span>
          <strong
            style={{
              fontSize: '1.65rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading ? '—' : overview?.totalGamesCreated ?? 0}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Bộ câu hỏi trong kho của bạn
          </span>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Phiên chơi hoàn thành
          </span>
          <strong
            style={{
              fontSize: '1.65rem',
              fontWeight: 800,
              color: 'var(--accent-sky)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading
              ? '—'
              : (overview?.completedPracticeSessions ?? 0) + (overview?.completedMultiplayerRooms ?? 0)}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {overview?.completedPracticeSessions ?? 0} chơi đơn
            {(overview?.creatorGamePracticeSessions ?? 0) > 0
              ? ` (${overview?.personalPracticeSessions ?? 0} cá nhân, ${overview?.creatorGamePracticeSessions ?? 0} khách chơi)`
              : ''}{' '}
            • {overview?.completedMultiplayerRooms ?? 0} phòng live
            {(overview?.multiplayerPlayersCount ?? 0) > 0
              ? ` (${overview?.multiplayerPlayersCount ?? 0} người chơi)`
              : ''}
          </span>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Tỷ lệ trả lời đúng
          </span>
          <strong
            style={{
              fontSize: '1.65rem',
              fontWeight: 800,
              color: 'var(--accent-emerald)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading
              ? '—'
              : overview?.overallAccuracyPercent !== null && overview?.overallAccuracyPercent !== undefined
                ? `${Math.round(overview.overallAccuracyPercent)}%`
                : 'Chưa có'}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {overview?.totalCorrectAnswers ?? 0} đúng / {overview?.totalQuestionsAnswered ?? 0} câu chơi đơn
            {(overview?.multiplayerTotalCorrectAnswers ?? 0) > 0
              ? ` • +${overview?.multiplayerTotalCorrectAnswers ?? 0} câu đúng phòng live`
              : ''}
          </span>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Tổng điểm & Chuỗi cao nhất
          </span>
          <strong
            style={{
              fontSize: '1.65rem',
              fontWeight: 800,
              color: 'var(--accent-amber)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading ? '—' : (overview?.totalScoreEarned ?? 0).toLocaleString('vi-VN')}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            Chuỗi đúng cao nhất: {overview?.bestStreak ?? 0} câu liên tiếp
            {(overview?.multiplayerTotalScoreEarned ?? 0) > 0
              ? ` • Phòng live: ${(overview?.multiplayerTotalScoreEarned ?? 0).toLocaleString('vi-VN')} đ`
              : ''}
          </span>
        </div>
      </section>

      {/* Breakdown by Game Topic & Recent Practice Sessions */}
      {isLoading ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '32px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: '0.88rem',
          }}
        >
          Đang tải báo cáo chi tiết...
        </div>
      ) : !analytics?.hasData && sessions.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px dashed var(--border-strong)',
            borderRadius: '14px',
            padding: '44px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TrophyIcon size={24} />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Chưa có dữ liệu phiên chơi nào được ghi nhận
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '0.86rem',
              color: 'var(--text-secondary)',
              maxWidth: '480px',
              lineHeight: 1.5,
            }}
          >
            Khi bạn hoặc người chơi hoàn thành một lượt chơi đơn hoặc phòng chơi trực tiếp, kết quả điểm số và độ chính xác theo từng bộ câu hỏi sẽ hiển thị tại đây.
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
            {onNavigateToDiscover && (
              <button
                type="button"
                onClick={onNavigateToDiscover}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '38px',
                  fontSize: '0.83rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <GamepadIcon size={14} />
                <span>Khám phá game có sẵn</span>
              </button>
            )}
            {onNavigateToCreate && (
              <button
                type="button"
                onClick={onNavigateToCreate}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink, #060913)',
                  border: '1px solid var(--primary)',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '38px',
                  fontSize: '0.83rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <PlusIcon size={14} />
                <span>Tạo game mới</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '20px',
            alignItems: 'start',
          }}
        >
          {/* Left: Performance by Game */}
          <section
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Hiệu suất theo bộ câu hỏi
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {analytics?.byGameTopic?.length ?? 0} game
              </span>
            </div>

            {(!analytics?.byGameTopic || analytics.byGameTopic.length === 0) ? (
              <div style={{ padding: '24px 18px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                Chưa có thống kê theo bộ câu hỏi.
              </div>
            ) : (
              <div>
                {analytics.byGameTopic.map((topic, idx) => (
                  <div
                    key={topic.gameId}
                    style={{
                      padding: '12px 18px',
                      borderBottom:
                        idx < analytics.byGameTopic.length - 1
                          ? '1px solid var(--border-subtle)'
                          : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={topic.gameTitle}
                      >
                        {topic.gameTitle}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          marginTop: '3px',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <span>{formatGameTypeBadge(topic.gameType)}</span>
                        <span>•</span>
                        <span>
                          {topic.sessionsCount} chơi đơn
                          {(topic.publicSessionsCount ?? 0) > 0
                            ? ` (${topic.publicSessionsCount} khách chơi)`
                            : ''}
                        </span>
                        {(topic.multiplayerRoomsCount ?? 0) > 0 && (
                          <>
                            <span>•</span>
                            <span>
                              {topic.multiplayerRoomsCount} phòng live ({topic.multiplayerPlayersCount ?? 0} người)
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span>Điểm cao nhất: {topic.bestScore}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          color:
                            (topic.accuracyPercent ?? 0) >= 70
                              ? 'var(--accent-emerald)'
                              : (topic.accuracyPercent ?? 0) >= 40
                                ? 'var(--accent-amber)'
                                : 'var(--accent-rose)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {topic.accuracyPercent !== null ? `${Math.round(topic.accuracyPercent)}%` : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleReplayGame(topic.gameId)}
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '6px',
                          padding: '0 10px',
                          height: '30px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <PlayIcon size={11} />
                        <span>Chơi lại</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Right: Recent Completed Sessions */}
          <section
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Lịch sử phiên luyện tập gần đây
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {sessions.length} phiên
              </span>
            </div>

            {sessions.length === 0 ? (
              <div style={{ padding: '24px 18px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                Chưa có phiên luyện tập nào hoàn thành.
              </div>
            ) : (
              <div>
                {sessions.slice(0, 12).map((sess, idx) => {
                  const acc =
                    sess.totalQuestions > 0
                      ? Math.round((sess.correctAnswers / sess.totalQuestions) * 100)
                      : 0;
                  return (
                    <div
                      key={sess.sessionId}
                      style={{
                        padding: '12px 18px',
                        borderBottom:
                          idx < Math.min(sessions.length, 12) - 1
                            ? '1px solid var(--border-subtle)'
                            : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '0.87rem',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                          title={sess.gameTitle}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sess.gameTitle}
                          </span>
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: sess.isExternalPlayOnOwnedGame
                                ? 'rgba(14, 165, 233, 0.14)'
                                : 'var(--primary-subtle)',
                              color: sess.isExternalPlayOnOwnedGame
                                ? 'var(--accent-sky)'
                                : 'var(--primary)',
                            }}
                          >
                            {sess.isExternalPlayOnOwnedGame ? 'Khách chơi game của bạn' : 'Cá nhân'}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '0.74rem',
                            color: 'var(--text-secondary)',
                            marginTop: '3px',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <CheckIcon size={11} />
                            {sess.correctAnswers}/{sess.totalQuestions} câu ({acc}%)
                          </span>
                          <span>•</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <ClockIcon size={11} />
                            {formatDuration(sess.durationMs)}
                          </span>
                          {sess.maxStreak > 1 && (
                            <>
                              <span>•</span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--accent-amber)' }}>
                                <FlameIcon size={11} />
                                Streak {sess.maxStreak}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary)' }}>
                          {sess.totalScore} đ
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {new Date(sess.finishedAt || sess.createdAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Multiplayer Live Rooms History */}
          {(analytics?.recentMultiplayerRooms?.length ?? 0) > 0 && (
            <section
              data-testid="reports-multiplayer-rooms"
              style={{
                gridColumn: '1 / -1',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Lịch sử phòng chơi trực tiếp (Multiplayer Live)
                </h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {analytics?.recentMultiplayerRooms?.length ?? 0} phòng đã hoàn thành
                </span>
              </div>
              <div>
                {(analytics?.recentMultiplayerRooms || []).slice(0, 10).map((room, idx, arr) => (
                  <div
                    key={room.roomId}
                    style={{
                      padding: '12px 18px',
                      borderBottom: idx < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '5px',
                            backgroundColor: 'var(--primary-subtle)',
                            color: 'var(--primary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          PIN: {room.roomCode}
                        </span>
                        <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                          {room.gameTitle}
                        </strong>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          marginTop: '4px',
                          flexWrap: 'wrap',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <span>{formatGameTypeBadge(room.gameType)}</span>
                        <span>•</span>
                        <span>{room.playerCount} người chơi</span>
                        <span>•</span>
                        <span>{room.totalQuestions} câu hỏi</span>
                        <span>•</span>
                        <span>Tổng câu đúng: {room.totalCorrectAnswers}</span>
                        {room.leaderboard.length > 0 && (
                          <>
                            <span>•</span>
                            <span>
                              Top 1: {room.leaderboard[0].displayName} ({room.leaderboard[0].score} đ)
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--accent-amber)' }}>
                        Cao nhất: {room.topScore} đ
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {new Date(room.finishedAt || room.createdAt).toLocaleDateString('vi-VN')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
