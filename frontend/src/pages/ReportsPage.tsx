import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangleIcon,
  BarChartIcon as ChartBarIcon,
  BookOpenIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/Icons.js';
import {
  downloadPlayExamHistoryExport,
  fetchLearningAnalytics,
  fetchPlayExamHistoryApi,
  fetchPlayExamHistoryDetailApi,
  fetchPracticeHistory,
  type PlayExamHistoryDetail,
  type PlayExamHistoryListResult,
} from '../services/api.js';
import type { LibraryFilterPreset } from './AnalyticsPage.js';
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
  onNavigateToLibrary?: (preset?: LibraryFilterPreset) => void;
  onNavigateToSoloPlay?: (spec: GameSpecification) => void;
}

type ActivityRange = '7d' | '30d' | 'all';

const formatDuration = (durationMs: number): string => {
  if (!durationMs || durationMs <= 0) return '0s';
  const totalSec = Math.round(durationMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return secs > 0 ? `${mins}p ${secs}s` : `${mins}p`;
};

const formatShortDateLabel = (isoDate: string): string => {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
};

const buildLocalDateKey = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const computeRangeBounds = (range: ActivityRange): { from?: string; to?: string } => {
  if (range === 'all') {
    return {};
  }
  const days = range === '7d' ? 7 : 30;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  return {
    from: start.toISOString(),
    to: now.toISOString(),
  };
};

export const ReportsPage: React.FC<ReportsPageProps> = ({
  currentUser,
  onNavigateToCreate,
  onNavigateToLibrary,
}) => {
  const [analytics, setAnalytics] = useState<LearningAnalyticsSummary | null>(null);
  const [rangeAnalytics, setRangeAnalytics] = useState<LearningAnalyticsSummary | null>(null);
  const [sessions, setSessions] = useState<PersistedPracticeSessionRecord[]>([]);
  const [activityRange, setActivityRange] = useState<ActivityRange>('7d');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // V3: Play / Exam History State
  const [historyData, setHistoryData] = useState<PlayExamHistoryListResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyModeFilter, setHistoryModeFilter] = useState<'ALL' | 'PLAY' | 'EXAM'>('ALL');
  const [historyDeliveryFilter, setHistoryDeliveryFilter] = useState<'ALL' | 'SOLO' | 'MULTIPLAYER'>('ALL');
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historySortOrder, setHistorySortOrder] = useState<'NEWEST' | 'OLDEST'>('NEWEST');
  const [historyPage, setHistoryPage] = useState<number>(1);
  const historyLimit = 10;

  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<PlayExamHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);

  const loadHistoryActivities = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetchPlayExamHistoryApi({
        sessionMode: historyModeFilter,
        deliveryMode: historyDeliveryFilter,
        search: historySearch,
        sortOrder: historySortOrder,
        page: historyPage,
        limit: historyLimit,
      });
      setHistoryData(res);
    } catch (err: any) {
      setHistoryError(err?.message || 'Không thể tải danh sách lịch sử Chơi / Thi.');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyModeFilter, historyDeliveryFilter, historySearch, historySortOrder, historyPage]);

  useEffect(() => {
    loadHistoryActivities();
  }, [loadHistoryActivities, currentUser?.userId]);

  const handleOpenHistoryDetail = async (historyId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setSelectedHistoryDetail(null);
    try {
      const detail = await fetchPlayExamHistoryDetailApi(historyId);
      setSelectedHistoryDetail(detail);
    } catch (err: any) {
      setDetailError(err?.message || 'Không thể tải chi tiết phiên Chơi / Thi.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExportHistory = async (historyId: string, format: 'csv' | 'xlsx') => {
    const key = `${historyId}:${format}`;
    setExportingKey(key);
    setExportErrorMsg(null);
    try {
      await downloadPlayExamHistoryExport(historyId, format);
    } catch (err: any) {
      setExportErrorMsg(err?.message || 'Không thể xuất tệp kết quả.');
    } finally {
      setExportingKey(null);
    }
  };

  const loadAllStatistics = useCallback(
    async (_selectedRange: ActivityRange = activityRange, alsoReloadHistory: boolean = false) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const allTimeRes = await fetchLearningAnalytics();
        setAnalytics(allTimeRes);
        setRangeAnalytics(allTimeRes);
        if (Array.isArray(allTimeRes.recentPracticeSessions)) {
          setSessions(allTimeRes.recentPracticeSessions);
        } else {
          const sessionsRes = await fetchPracticeHistory(25);
          setSessions(Array.isArray(sessionsRes) ? sessionsRes : []);
        }
        if (alsoReloadHistory) {
          loadHistoryActivities();
        }
      } catch (err: any) {
        setErrorMessage(err?.message || 'Không thể tải dữ liệu thống kê hoạt động.');
      } finally {
        setIsLoading(false);
      }
    },
    [activityRange, loadHistoryActivities]
  );

  useEffect(() => {
    loadAllStatistics(activityRange, false);
  }, [currentUser?.userId]);

  const handleSelectRange = (nextRange: ActivityRange) => {
    setActivityRange(nextRange);
    if (analytics) {
      setRangeAnalytics(analytics);
    }
  };

  const overview = analytics?.overview;
  const totalGames = overview?.totalGamesCreated ?? 0;
  const completedSolo = overview?.completedPracticeSessions ?? 0;
  const completedRooms = overview?.completedMultiplayerRooms ?? 0;
  const completedPlays = overview?.completedPlaysCount ?? completedSolo + completedRooms;
  const totalSolo = overview?.totalPracticeSessions ?? completedSolo;
  const totalRooms = overview?.totalMultiplayerRooms ?? completedRooms;
  const totalPlays = overview?.totalPlaysCount ?? totalSolo + totalRooms;
  const inProgressPlays = overview?.inProgressPlaysCount ?? 0;
  const abandonedPlays = overview?.abandonedPlaysCount ?? 0;
  const inProgressSolo = overview?.inProgressPracticeSessions ?? 0;
  const abandonedSolo = overview?.abandonedPracticeSessions ?? 0;
  const inProgressRooms = overview?.inProgressMultiplayerRooms ?? 0;
  const abandonedRooms = overview?.abandonedMultiplayerRooms ?? 0;
  const personalSolo = overview?.personalPracticeSessions ?? 0;
  const externalSolo = overview?.creatorGamePracticeSessions ?? 0;
  const multiplayerPlayers = overview?.multiplayerPlayersCount ?? 0;
  const averageScore = overview?.averageScorePerSession ?? null;

  // Các chỉ số phân tích tỷ lệ hoàn thành & so sánh Solo vs Multiplayer từ dữ liệu thực
  const completionRatePercent =
    overview?.completionRatePercent !== undefined
      ? overview.completionRatePercent
      : totalPlays > 0
        ? Math.round((completedPlays / totalPlays) * 100)
        : null;

  const inProgressRatePercent =
    totalPlays > 0 ? Math.round((inProgressPlays / totalPlays) * 100) : 0;
  const abandonedRatePercent =
    totalPlays > 0
      ? Math.max(0, 100 - (completionRatePercent ?? 0) - inProgressRatePercent)
      : 0;

  const soloCompletionRatePercent =
    overview?.soloCompletionRatePercent !== undefined
      ? overview.soloCompletionRatePercent
      : totalSolo > 0
        ? Math.round((completedSolo / totalSolo) * 100)
        : null;

  const multiplayerCompletionRatePercent =
    overview?.multiplayerCompletionRatePercent !== undefined
      ? overview.multiplayerCompletionRatePercent
      : totalRooms > 0
        ? Math.round((completedRooms / totalRooms) * 100)
        : null;

  const soloSharePercent =
    totalPlays > 0 ? Math.round((totalSolo / totalPlays) * 100) : 0;
  const roomSharePercent =
    totalPlays > 0 ? 100 - soloSharePercent : 0;

  const soloAverageScore =
    overview?.soloAverageScore !== undefined
      ? overview.soloAverageScore
      : completedSolo > 0 && overview?.soloTotalScoreEarned !== undefined
        ? Math.round(overview.soloTotalScoreEarned / completedSolo)
        : null;

  const multiplayerAverageScore =
    overview?.multiplayerAverageScore !== undefined
      ? overview.multiplayerAverageScore
      : multiplayerPlayers > 0 && overview?.multiplayerTotalScoreEarned !== undefined
        ? Math.round(overview.multiplayerTotalScoreEarned / multiplayerPlayers)
        : null;

  // Chuỗi dữ liệu biểu đồ hoạt động theo ngày từ dữ liệu thực của backend
  const chartSeries = useMemo(() => {
    const activeSummary = rangeAnalytics || analytics;
    const rawPoints = activeSummary?.progressOverTime || [];
    if (rawPoints.length === 0) {
      return [];
    }

    const byDate = new Map(
      rawPoints.map((pt) => [
        pt.date,
        {
          date: pt.date,
          totalPlays: pt.totalPlaysCount ?? pt.sessionsCount ?? 0,
          completedPlays: pt.completedPlaysCount ?? pt.sessionsCount ?? 0,
          soloPlays: pt.soloSessionsCount ?? pt.sessionsCount ?? 0,
          roomPlays: pt.multiplayerRoomsCount ?? 0,
          averageScore: pt.averageScore ?? null,
        },
      ])
    );

    if (activityRange === 'all') {
      return rawPoints.map((pt) => ({
        date: pt.date,
        label: formatShortDateLabel(pt.date),
        totalPlays: pt.totalPlaysCount ?? pt.sessionsCount ?? 0,
        completedPlays: pt.completedPlaysCount ?? pt.sessionsCount ?? 0,
        soloPlays: pt.soloSessionsCount ?? pt.sessionsCount ?? 0,
        roomPlays: pt.multiplayerRoomsCount ?? 0,
        averageScore: pt.averageScore ?? null,
      }));
    }

    const dayCount = activityRange === '7d' ? 7 : 30;
    const now = new Date();
    const fullDays: Array<{
      date: string;
      label: string;
      totalPlays: number;
      completedPlays: number;
      soloPlays: number;
      roomPlays: number;
      averageScore: number | null;
    }> = [];

    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = buildLocalDateKey(d);
      const existing = byDate.get(key);
      fullDays.push({
        date: key,
        label: formatShortDateLabel(key),
        totalPlays: existing?.totalPlays ?? 0,
        completedPlays: existing?.completedPlays ?? 0,
        soloPlays: existing?.soloPlays ?? 0,
        roomPlays: existing?.roomPlays ?? 0,
        averageScore: existing?.averageScore ?? null,
      });
    }

    const totalInWindow = fullDays.reduce((sum, d) => sum + d.totalPlays, 0);
    return totalInWindow > 0 ? fullDays : [];
  }, [rangeAnalytics, analytics, activityRange]);

  const maxDailyPlays = useMemo(() => {
    if (chartSeries.length === 0) return 1;
    return Math.max(1, ...chartSeries.map((d) => d.totalPlays));
  }, [chartSeries]);

  const rangeTotalPlays = useMemo(
    () => chartSeries.reduce((sum, d) => sum + d.totalPlays, 0),
    [chartSeries]
  );

  const rangeCompletedPlays = useMemo(
    () => chartSeries.reduce((sum, d) => sum + d.completedPlays, 0),
    [chartSeries]
  );

  const rangeSoloPlays = useMemo(
    () => chartSeries.reduce((sum, d) => sum + d.soloPlays, 0),
    [chartSeries]
  );

  const rangeRoomPlays = useMemo(
    () => chartSeries.reduce((sum, d) => sum + d.roomPlays, 0),
    [chartSeries]
  );

  return (
    <div
      data-testid="statistics-page"
      style={{
        maxWidth: '1320px',
        margin: '0 auto',
        padding: 'clamp(16px, 2.2vw, 24px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '22px',
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
            <span>Thống kê hoạt động</span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(1.35rem, 2.2vw, 1.72rem)',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Thống kê hiệu quả chơi game
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => loadAllStatistics(activityRange, true)}
            disabled={isLoading}
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '8px',
              padding: '0 14px',
              minHeight: '44px',
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

          {onNavigateToLibrary && (
            <button
              type="button"
              onClick={() => onNavigateToLibrary({ tab: 'MINE', nonce: Date.now() })}
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0 14px',
                minHeight: '44px',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BookOpenIcon size={14} />
              <span>Thư viện của tôi</span>
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
                minHeight: '44px',
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
            onClick={() => loadAllStatistics(activityRange)}
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

      {/* A. 4 KPI Summary Cards: Tổng game, Tổng lượt chơi, Lượt chơi hoàn thành, Điểm trung bình */}
      <section
        aria-label="Các chỉ số tổng quan"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '14px',
          minWidth: 0,
        }}
      >
        {/* 1. Tổng game */}
        <div
          data-testid="kpi-total-games"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Tổng game
          </span>
          <strong
            style={{
              fontSize: '1.68rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading ? '—' : totalGames.toLocaleString('vi-VN')}
          </strong>
        </div>

        {/* 2. Tổng lượt chơi */}
        <div
          data-testid="kpi-total-plays"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Tổng lượt chơi
          </span>
          <strong
            style={{
              fontSize: '1.68rem',
              fontWeight: 800,
              color: 'var(--accent-sky)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading ? '—' : totalPlays.toLocaleString('vi-VN')}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {totalSolo} phiên đơn • {totalRooms} phòng trực tiếp
            {inProgressPlays > 0 ? ` • ${inProgressPlays} đang chơi` : ''}
            {abandonedPlays > 0 ? ` • ${abandonedPlays} bỏ dở` : ''}
          </span>
        </div>

        {/* 3. Lượt chơi hoàn thành */}
        <div
          data-testid="kpi-completed-plays"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Lượt chơi hoàn thành
          </span>
          <strong
            style={{
              fontSize: '1.68rem',
              fontWeight: 800,
              color: 'var(--accent-emerald)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {isLoading ? '—' : completedPlays.toLocaleString('vi-VN')}
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {completedSolo} chơi đơn hoàn thành • {completedRooms} phòng hoàn thành
            {multiplayerPlayers > 0 ? ` (${multiplayerPlayers} người tham gia)` : ''}
          </span>
        </div>

        {/* 4. Điểm trung bình */}
        <div
          data-testid="kpi-average-score"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Điểm trung bình
          </span>
          <strong
            style={{
              fontSize: averageScore !== null ? '1.68rem' : '1.18rem',
              fontWeight: 800,
              color: averageScore !== null ? 'var(--accent-amber)' : 'var(--text-muted)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: averageScore !== null ? 1.15 : 1.55,
            }}
          >
            {isLoading
              ? '—'
              : averageScore !== null
                ? `${averageScore.toLocaleString('vi-VN')} đ`
                : 'Chưa có dữ liệu'}
          </strong>
          {averageScore !== null &&
            overview?.overallAccuracyPercent !== null &&
            overview?.overallAccuracyPercent !== undefined && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                Tỷ lệ đúng: {Math.round(overview.overallAccuracyPercent)}% • Chuỗi cao nhất: {overview?.bestStreak ?? 0}
              </span>
            )}
        </div>
      </section>

      {/* Main Content Body */}
      {isLoading ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '36px 24px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: '0.88rem',
          }}
        >
          Đang tải dữ liệu thống kê...
        </div>
      ) : totalGames === 0 && totalPlays === 0 ? (
        /* Trạng thái 1: Chưa tạo game và chưa có lượt chơi */
        <section
          data-testid="statistics-empty-no-games"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px dashed var(--border-strong)',
            borderRadius: '12px',
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
              borderRadius: '10px',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChartBarIcon size={24} />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Chưa có dữ liệu lượt chơi
          </h2>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
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
                <span>Tạo game bằng AI</span>
              </button>
            )}
            {onNavigateToLibrary && (
              <button
                type="button"
                onClick={() => onNavigateToLibrary({ tab: 'MINE', nonce: Date.now() })}
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
                <BookOpenIcon size={14} />
                <span>Mở Thư viện của tôi</span>
              </button>
            )}
          </div>
        </section>
      ) : totalPlays === 0 ? (
        /* Trạng thái 2: Đã tạo game nhưng chưa có lượt chơi nào */
        <section
          data-testid="statistics-empty-no-plays"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px dashed var(--border-strong)',
            borderRadius: '12px',
            padding: '40px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TrophyIcon size={22} />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Đã tạo {totalGames} game • Chưa có lượt chơi
          </h2>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
            {onNavigateToLibrary && (
              <button
                type="button"
                onClick={() => onNavigateToLibrary({ tab: 'MINE', nonce: Date.now() })}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '38px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <BookOpenIcon size={14} />
                <span>Mở Thư viện của tôi</span>
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
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <PlusIcon size={14} />
                <span>Tạo thêm game mới</span>
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* KHU VỰC PHÂN TÍCH HIỆU QUẢ CHƠI GAME: Tỷ lệ hoàn thành & So sánh Solo vs Multiplayer */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))',
              gap: '20px',
              alignItems: 'stretch',
              minWidth: 0,
            }}
          >
            {/* 1. Phân tích Tỷ lệ phiên chơi hoàn thành */}
            <section
              aria-label="Phân tích tỷ lệ phiên chơi hoàn thành"
              data-testid="statistics-completion-analysis"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: 'clamp(14px, 3vw, 18px) clamp(14px, 3vw, 20px)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '16px',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Tỷ lệ phiên chơi hoàn thành
                    </h2>
                  </div>
                  <strong
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 800,
                      color:
                        (completionRatePercent ?? 0) >= 70
                          ? 'var(--accent-emerald)'
                          : (completionRatePercent ?? 0) >= 40
                            ? 'var(--accent-amber)'
                            : 'var(--accent-rose)',
                      fontVariantNumeric: 'tabular-nums',
                      lineHeight: 1,
                    }}
                  >
                    {completionRatePercent !== null ? `${completionRatePercent}%` : '—'}
                  </strong>
                </div>

                {/* Stacked Bar: Hoàn thành / Đang diễn ra / Bỏ dở */}
                <div
                  role="img"
                  aria-label={`Tỷ lệ hoàn thành ${completionRatePercent ?? 0}%, đang chơi ${inProgressRatePercent}%, bỏ dở ${abandonedRatePercent}%`}
                  style={{
                    width: '100%',
                    height: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-input)',
                    overflow: 'hidden',
                    display: 'flex',
                    marginBottom: '14px',
                  }}
                >
                  {(completionRatePercent ?? 0) > 0 && (
                    <div
                      style={{
                        width: `${completionRatePercent}%`,
                        backgroundColor: 'var(--accent-emerald)',
                        height: '100%',
                      }}
                    />
                  )}
                  {inProgressRatePercent > 0 && (
                    <div
                      style={{
                        width: `${inProgressRatePercent}%`,
                        backgroundColor: 'var(--accent-sky)',
                        height: '100%',
                      }}
                    />
                  )}
                  {abandonedRatePercent > 0 && (
                    <div
                      style={{
                        width: `${abandonedRatePercent}%`,
                        backgroundColor: 'var(--accent-rose)',
                        height: '100%',
                      }}
                    />
                  )}
                </div>

                {/* Breakdown 3 trạng thái phiên chơi */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '10px',
                    marginBottom: '14px',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-emerald)', display: 'inline-block' }} />
                      <span>Hoàn thành</span>
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                      {completedPlays} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>({completionRatePercent ?? 0}%)</span>
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-sky)', display: 'inline-block' }} />
                      <span>Đang diễn ra</span>
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                      {inProgressPlays} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>({inProgressRatePercent}%)</span>
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-rose)', display: 'inline-block' }} />
                      <span>Bị bỏ dở</span>
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                      {abandonedPlays} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>({abandonedRatePercent}%)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tỷ lệ hoàn thành riêng của Solo & Multiplayer */}
              <div
                style={{
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Tỷ lệ hoàn thành Chơi đơn (Solo)
                  </span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {soloCompletionRatePercent !== null
                      ? `${soloCompletionRatePercent}% (${completedSolo}/${totalSolo} phiên)`
                      : 'Chưa có lượt chơi đơn'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Tỷ lệ hoàn thành Phòng trực tiếp (Multiplayer)
                  </span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {multiplayerCompletionRatePercent !== null
                      ? `${multiplayerCompletionRatePercent}% (${completedRooms}/${totalRooms} phòng)`
                      : 'Chưa có phòng trực tiếp'}
                  </strong>
                </div>
              </div>
            </section>

            {/* 2. So sánh lượt chơi Solo và Multiplayer */}
            <section
              aria-label="So sánh lượt chơi Solo và Multiplayer"
              data-testid="statistics-mode-comparison"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: 'clamp(14px, 3vw, 18px) clamp(14px, 3vw, 20px)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '14px',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      So sánh lượt chơi Solo và Multiplayer
                    </h2>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {soloSharePercent}% Solo • {roomSharePercent}% Live
                  </span>
                </div>

                {/* Thanh tỷ trọng Solo vs Multiplayer */}
                <div
                  role="img"
                  aria-label={`Tỷ trọng lượt chơi: Solo ${soloSharePercent}%, Multiplayer ${roomSharePercent}%`}
                  style={{
                    width: '100%',
                    height: '12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-input)',
                    overflow: 'hidden',
                    display: 'flex',
                    marginBottom: '14px',
                  }}
                >
                  {soloSharePercent > 0 && (
                    <div
                      style={{
                        width: `${soloSharePercent}%`,
                        backgroundColor: 'var(--primary)',
                        height: '100%',
                      }}
                    />
                  )}
                  {roomSharePercent > 0 && (
                    <div
                      style={{
                        width: `${roomSharePercent}%`,
                        backgroundColor: 'var(--accent-amber)',
                        height: '100%',
                      }}
                    />
                  )}
                </div>

                {/* Bảng so sánh chi tiết Solo vs Multiplayer */}
                <div
                  role="region"
                  aria-label="Bảng đối chiếu Solo và Multiplayer"
                  tabIndex={0}
                  style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}
                >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.8rem',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.73rem',
                      }}
                    >
                      <th style={{ padding: '6px 0', textAlign: 'left', fontWeight: 700 }}>Chỉ số đối chiếu</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                        Chơi đơn (Solo)
                      </th>
                      <th style={{ padding: '6px 0 6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--accent-amber)' }}>
                        Phòng Live (Multiplayer)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>Tổng phiên / phòng</td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {totalSolo.toLocaleString('vi-VN')} phiên
                        {externalSolo > 0 ? ` (${personalSolo} cá nhân, ${externalSolo} khách)` : ''}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {totalRooms.toLocaleString('vi-VN')} phòng
                        {multiplayerPlayers > 0 ? ` (${multiplayerPlayers} người)` : ''}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>Đã hoàn thành</td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {completedSolo.toLocaleString('vi-VN')}
                        {inProgressSolo + abandonedSolo > 0
                          ? ` (${inProgressSolo} đang chơi, ${abandonedSolo} bỏ dở)`
                          : ''}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {completedRooms.toLocaleString('vi-VN')}
                        {inProgressRooms + abandonedRooms > 0
                          ? ` (${inProgressRooms} đang mở, ${abandonedRooms} đã đóng)`
                          : ''}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>Điểm trung bình</td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {soloAverageScore !== null ? `${soloAverageScore.toLocaleString('vi-VN')} đ` : 'Chưa có dữ liệu'}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {multiplayerAverageScore !== null
                          ? `${multiplayerAverageScore.toLocaleString('vi-VN')} đ`
                          : 'Chưa có dữ liệu'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '8px 0 2px 0', color: 'var(--text-secondary)' }}>Tổng câu trả lời đúng</td>
                      <td style={{ padding: '8px 8px 2px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {(overview?.totalCorrectAnswers ?? 0).toLocaleString('vi-VN')} / {(overview?.totalQuestionsAnswered ?? 0).toLocaleString('vi-VN')} câu
                      </td>
                      <td style={{ padding: '8px 0 2px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {(overview?.multiplayerTotalCorrectAnswers ?? 0).toLocaleString('vi-VN')} câu đúng
                      </td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>
            </section>
          </div>

          {/* 3. Biểu đồ số lượt chơi theo ngày */}
          <section
            aria-label="Biểu đồ hoạt động lượt chơi theo ngày"
            data-testid="statistics-activity-chart"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Số lượt chơi theo ngày
                </h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  Trong khoảng đã chọn: <strong>{rangeTotalPlays}</strong> lượt chơi ({rangeCompletedPlays} hoàn thành • {rangeSoloPlays} Solo • {rangeRoomPlays} Phòng live)
                </p>
              </div>

              {/* Bộ chọn khoảng thời gian: 7 ngày, 30 ngày, Tất cả */}
              <div
                role="group"
                aria-label="Chọn khoảng thời gian thống kê"
                style={{
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '3px',
                  gap: '3px',
                  maxWidth: '100%',
                }}
              >
                {(
                  [
                    { id: '7d' as ActivityRange, label: '7 ngày gần nhất' },
                    { id: '30d' as ActivityRange, label: '30 ngày gần nhất' },
                    { id: 'all' as ActivityRange, label: 'Tất cả thời gian' },
                  ] as const
                ).map((opt) => {
                  const active = activityRange === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectRange(opt.id)}
                      disabled={isChartLoading}
                      style={{
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 11px',
                        minHeight: '44px',
                        fontSize: '0.76rem',
                        fontWeight: active ? 800 : 600,
                        backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
                        color: active ? 'var(--primary)' : 'var(--text-secondary)',
                        cursor: isChartLoading ? 'wait' : 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chú giải 2 chỉ số trên biểu đồ */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                flexWrap: 'wrap',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '2px',
                    backgroundColor: 'var(--primary)',
                    display: 'inline-block',
                  }}
                />
                <span>Lượt chơi hoàn thành</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '2px',
                    backgroundColor: 'var(--border-strong)',
                    display: 'inline-block',
                  }}
                />
                <span>Tổng lượt chơi phát sinh</span>
              </span>
            </div>

            {isChartLoading ? (
              <div
                style={{
                  height: '200px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '0.84rem',
                }}
              >
                Đang cập nhật dữ liệu biểu đồ...
              </div>
            ) : chartSeries.length === 0 ? (
              <div
                style={{
                  padding: '32px 18px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px dashed var(--border-subtle)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '0.84rem',
                }}
              >
                Không có lượt chơi nào phát sinh trong khoảng thời gian này. Hãy chuyển sang mốc thời gian rộng hơn để xem lịch sử trước đó.
              </div>
            ) : (
              <div
                style={{
                  overflowX: 'auto',
                  paddingTop: '8px',
                  paddingBottom: '4px',
                }}
              >
                <div
                  style={{
                    minWidth: chartSeries.length > 14 ? `${chartSeries.length * 42}px` : '100%',
                    height: '210px',
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: chartSeries.length > 20 ? '6px' : '10px',
                    padding: '20px 8px 0 8px',
                    borderBottom: '1px solid var(--border-subtle)',
                    boxSizing: 'border-box',
                  }}
                >
                  {chartSeries.map((point) => {
                    const totalHeightPct =
                      point.totalPlays > 0
                        ? Math.max(8, Math.round((point.totalPlays / maxDailyPlays) * 100))
                        : 0;
                    const completedHeightPct =
                      point.completedPlays > 0
                        ? Math.max(6, Math.round((point.completedPlays / maxDailyPlays) * 100))
                        : 0;

                    return (
                      <div
                        key={point.date}
                        title={`Ngày ${point.date}: ${point.totalPlays} lượt (${point.completedPlays} hoàn thành • ${point.soloPlays} Solo • ${point.roomPlays} Phòng live)`}
                        style={{
                          flex: 1,
                          minWidth: '28px',
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: point.totalPlays > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {point.totalPlays > 0 ? point.totalPlays : ''}
                        </span>

                        <div
                          style={{
                            width: '100%',
                            maxWidth: '34px',
                            height: '140px',
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'center',
                            position: 'relative',
                          }}
                        >
                          {point.totalPlays > 0 ? (
                            <div
                              style={{
                                width: '100%',
                                height: `${totalHeightPct}%`,
                                backgroundColor: 'var(--border-strong)',
                                borderRadius: '4px 4px 0 0',
                                position: 'relative',
                                overflow: 'hidden',
                                display: 'flex',
                                alignItems: 'flex-end',
                              }}
                            >
                              {point.completedPlays > 0 && (
                                <div
                                  style={{
                                    width: '100%',
                                    height: `${Math.min(100, Math.round((completedHeightPct / totalHeightPct) * 100))}%`,
                                    backgroundColor: 'var(--primary)',
                                    borderRadius: '4px 4px 0 0',
                                  }}
                                />
                              )}
                            </div>
                          ) : (
                            <div
                              style={{
                                width: '100%',
                                height: '2px',
                                backgroundColor: 'var(--border-subtle)',
                              }}
                            />
                          )}
                        </div>

                        <span
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                            paddingBottom: '6px',
                          }}
                        >
                          {point.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Lịch sử phiên chơi đơn & phòng chơi trực tiếp gần đây */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))',
              gap: '20px',
              alignItems: 'start',
              minWidth: 0,
            }}
          >
            {/* Lịch sử phiên chơi đơn gần đây */}
            <section
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                overflow: 'hidden',
                minWidth: 0,
                maxWidth: '100%',
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
                <h2 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Phiên chơi đơn gần đây
                </h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {sessions.length} phiên
                </span>
              </div>

              {sessions.length === 0 ? (
                <div style={{ padding: '24px 18px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  Chưa có phiên chơi đơn nào.
                </div>
              ) : (
                <div>
                  {sessions.slice(0, 8).map((sess, idx) => {
                    const acc =
                      sess.totalQuestions > 0
                        ? Math.round((sess.correctAnswers / sess.totalQuestions) * 100)
                        : 0;
                    const isFinished = sess.state === 'FINISHED';
                    const isAbandoned = sess.state === 'ABANDONED';
                    return (
                      <div
                        key={sess.sessionId}
                        style={{
                          padding: '12px 18px',
                          borderBottom:
                            idx < Math.min(sessions.length, 8) - 1
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
                              fontSize: '0.86rem',
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
                                fontSize: '0.67rem',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: isFinished
                                  ? 'rgba(16, 185, 129, 0.14)'
                                  : isAbandoned
                                    ? 'rgba(239, 68, 68, 0.12)'
                                    : 'rgba(14, 165, 233, 0.14)',
                                color: isFinished
                                  ? 'var(--accent-emerald)'
                                  : isAbandoned
                                    ? 'var(--accent-rose)'
                                    : 'var(--accent-sky)',
                              }}
                            >
                              {isFinished ? 'Hoàn thành' : isAbandoned ? 'Bỏ dở' : 'Đang chơi'}
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
                                  Chuỗi {sess.maxStreak}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                          <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--primary)' }}>
                            {sess.totalScore.toLocaleString('vi-VN')} đ
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

            {/* Lịch sử phòng chơi trực tiếp */}
            <section
              data-testid="reports-multiplayer-rooms"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                overflow: 'hidden',
                minWidth: 0,
                maxWidth: '100%',
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
                <h2 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Phòng chơi trực tiếp gần đây
                </h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {analytics?.recentMultiplayerRooms?.length ?? 0} phòng
                </span>
              </div>

              {(analytics?.recentMultiplayerRooms?.length ?? 0) === 0 ? (
                <div style={{ padding: '24px 18px', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  Chưa có phòng chơi trực tiếp nào hoàn thành.
                </div>
              ) : (
                <div>
                  {(analytics?.recentMultiplayerRooms || []).slice(0, 8).map((room, idx, arr) => (
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
                              fontSize: '0.7rem',
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
                          <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                            {room.gameTitle}
                          </strong>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '0.74rem',
                            color: 'var(--text-secondary)',
                            marginTop: '4px',
                            flexWrap: 'wrap',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <UsersIcon size={11} />
                            {room.playerCount} người chơi
                          </span>
                          <span>•</span>
                          <span>{room.totalQuestions} câu hỏi</span>
                          {room.averageScore !== null && room.averageScore !== undefined && (
                            <>
                              <span>•</span>
                              <span>TB: {room.averageScore.toLocaleString('vi-VN')} đ</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--accent-amber)' }}>
                          Cao nhất: {room.topScore.toLocaleString('vi-VN')} đ
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {new Date(room.finishedAt || room.createdAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* E. Lịch sử Chơi / Thi (V3 Unified Play & Exam History + Detail + CSV/Excel Export) */}
      <section
        data-testid="play-exam-history-section"
        aria-label="Lịch sử Chơi và Thi"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: 'clamp(14px, 3vw, 20px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          minWidth: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: '1.08rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <ClockIcon size={18} />
              <span>Lịch sử Chơi / Thi</span>
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Lưu trữ đầy đủ kết quả các phiên Chơi cá nhân, Thi cá nhân, Chơi nhóm và Thi nhóm. Hỗ trợ xem lại chi tiết và xuất báo cáo Excel / CSV.
            </p>
          </div>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-subtle)',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Tổng cộng: <strong style={{ color: 'var(--text-primary)' }}>{historyData?.total ?? 0}</strong> phiên
          </div>
        </div>

        {/* Bộ lọc & Tìm kiếm */}
        <div
          data-testid="history-filters-bar"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px',
            backgroundColor: 'var(--bg-subtle)',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>
            {/* Filter Chế độ: Tất cả / Chơi / Thi */}
            <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginRight: '4px' }}>
                Chế độ:
              </span>
              {(
                [
                  { key: 'ALL', label: 'Tất cả' },
                  { key: 'PLAY', label: 'Chơi' },
                  { key: 'EXAM', label: 'Thi' },
                ] as const
              ).map((opt) => {
                const active = historyModeFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    data-testid={`history-filter-mode-${opt.key.toLowerCase()}`}
                    onClick={() => {
                      setHistoryModeFilter(opt.key);
                      setHistoryPage(1);
                    }}
                    style={{
                      padding: '8px 12px',
                      minHeight: '44px',
                      minWidth: '44px',
                      borderRadius: '6px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: active ? '1px solid var(--primary)' : '1px solid var(--border-strong)',
                      backgroundColor: active ? 'var(--primary)' : 'var(--bg-surface)',
                      color: active ? 'var(--primary-ink, #060913)' : 'var(--text-primary)',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Filter Hình thức: Tất cả / Cá nhân / Nhóm */}
            <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginRight: '4px' }}>
                Hình thức:
              </span>
              {(
                [
                  { key: 'ALL', label: 'Tất cả' },
                  { key: 'SOLO', label: 'Cá nhân' },
                  { key: 'MULTIPLAYER', label: 'Nhóm' },
                ] as const
              ).map((opt) => {
                const active = historyDeliveryFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    data-testid={`history-filter-delivery-${opt.key.toLowerCase()}`}
                    onClick={() => {
                      setHistoryDeliveryFilter(opt.key);
                      setHistoryPage(1);
                    }}
                    style={{
                      padding: '8px 12px',
                      minHeight: '44px',
                      minWidth: '44px',
                      borderRadius: '6px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: active ? '1px solid var(--primary)' : '1px solid var(--border-strong)',
                      backgroundColor: active ? 'var(--primary)' : 'var(--bg-surface)',
                      color: active ? 'var(--primary-ink, #060913)' : 'var(--text-primary)',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search & Sort */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', flex: '1 1 240px', minWidth: 0, maxWidth: '100%', justifyContent: 'flex-end' }}>
            <input
              type="search"
              data-testid="history-search-input"
              value={historySearch}
              onChange={(e) => {
                setHistorySearch(e.target.value);
                setHistoryPage(1);
              }}
              placeholder="Tìm theo tên game hoặc mã phiên..."
              style={{
                padding: '8px 12px',
                minHeight: '44px',
                borderRadius: '7px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                minWidth: 'min(100%, 180px)',
                flex: '1 1 180px',
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            />
            <select
              data-testid="history-sort-select"
              aria-label="Sắp xếp lịch sử"
              value={historySortOrder}
              onChange={(e) => {
                setHistorySortOrder(e.target.value as 'NEWEST' | 'OLDEST');
                setHistoryPage(1);
              }}
              style={{
                padding: '8px 10px',
                minHeight: '44px',
                borderRadius: '7px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxSizing: 'border-box',
              }}
            >
              <option value="NEWEST">Mới nhất</option>
              <option value="OLDEST">Cũ nhất</option>
            </select>
          </div>
        </div>

        {/* Thông báo lỗi xuất file nếu có */}
        {exportErrorMsg && (
          <div
            data-testid="history-export-error"
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: 'var(--accent-rose)',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>{exportErrorMsg}</span>
            <button
              type="button"
              onClick={() => setExportErrorMsg(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-rose)',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Đóng
            </button>
          </div>
        )}

        {/* Loading / Error / Empty / Data Table */}
        {historyLoading ? (
          <div
            data-testid="history-loading-state"
            style={{
              padding: '28px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '0.86rem',
              fontWeight: 600,
            }}
          >
            Đang tải danh sách lịch sử Chơi / Thi...
          </div>
        ) : historyError ? (
          <div
            data-testid="history-error-state"
            style={{
              padding: '20px',
              borderRadius: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--accent-rose)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>{historyError}</span>
            <button
              type="button"
              data-testid="history-retry-btn"
              onClick={() => loadHistoryActivities()}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Thử lại
            </button>
          </div>
        ) : !historyData || historyData.items.length === 0 ? (
          <div
            data-testid="history-empty-state"
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              borderRadius: '10px',
              border: '1px dashed var(--border-subtle)',
              fontSize: '0.85rem',
            }}
          >
            Chưa có phiên Chơi hoặc Thi nào phù hợp với bộ lọc hiện tại.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table
              data-testid="play-exam-history-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.82rem',
                minWidth: '760px',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    textAlign: 'left',
                    fontSize: '0.74rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <th style={{ padding: '10px 8px' }}>Tên game</th>
                  <th style={{ padding: '10px 8px' }}>Chế độ / Hình thức</th>
                  <th style={{ padding: '10px 8px' }}>Mã phiên</th>
                  <th style={{ padding: '10px 8px' }}>Người tham gia</th>
                  <th style={{ padding: '10px 8px' }}>Thời gian</th>
                  <th style={{ padding: '10px 8px' }}>Kết quả / Điểm</th>
                  <th style={{ padding: '10px 8px' }}>Trạng thái</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {historyData.items.map((item) => {
                  const isExam = item.sessionMode === 'EXAM';
                  const isMulti = item.deliveryMode === 'MULTIPLAYER';
                  const isExportingCsv = exportingKey === `${item.historyId}:csv`;
                  const isExportingXlsx = exportingKey === `${item.historyId}:xlsx`;
                  const displayCode =
                    item.roomCode ||
                    (item.sessionId ? item.sessionId.slice(0, 8).toUpperCase() : item.historyId);
                  const statusLabel =
                    item.submittedReason === 'EXAM_CLOSED_BY_HOST' || item.status === 'AUTO_SUBMITTED'
                      ? 'BTC kết thúc (Tự động nộp)'
                      : 'Hoàn tất';
                  return (
                    <tr
                      key={item.historyId}
                      data-testid={`history-row-${item.historyId}`}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <td style={{ padding: '12px 8px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        <div>{item.gameTitle}</div>
                        {item.playerName && !isMulti && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                            Người chơi: {item.playerName}
                            {item.departmentUnit ? ` (${item.departmentUnit})` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: '999px',
                              fontSize: '0.7rem',
                              fontWeight: 800,
                              backgroundColor: isExam ? 'rgba(245, 158, 11, 0.16)' : 'rgba(16, 185, 129, 0.15)',
                              color: isExam ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                            }}
                          >
                            {isExam ? 'Thi' : 'Chơi'}
                          </span>
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: '999px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            {isMulti ? 'Nhóm' : 'Cá nhân'}
                          </span>
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '12px 8px',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: 'var(--primary)',
                        }}
                      >
                        {displayCode}
                      </td>
                      <td style={{ padding: '12px 8px', fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ fontWeight: 700 }}>{item.participantCount}</span> người
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        <div>
                          BĐ:{' '}
                          {item.startedAt
                            ? new Date(item.startedAt).toLocaleString('vi-VN')
                            : new Date(item.createdAt).toLocaleString('vi-VN')}
                        </div>
                        <div>
                          KT:{' '}
                          {item.finishedAt
                            ? new Date(item.finishedAt).toLocaleString('vi-VN')
                            : new Date(item.createdAt).toLocaleString('vi-VN')}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                          Cao nhất: {item.highestScore.toLocaleString('vi-VN')} đ
                        </div>
                        <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                          {isMulti
                            ? `TB: ${item.averageScore.toLocaleString('vi-VN')} đ`
                            : item.passedCount > 0
                              ? 'Đạt'
                              : item.failedCount > 0
                                ? 'Chưa đạt'
                                : `Độ chính xác: ${item.averageAccuracy}%`}
                          {(item.passedCount > 0 || item.failedCount > 0) && isMulti
                            ? ` (${item.passedCount} Đạt / ${item.failedCount} Chưa đạt)`
                            : ''}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            data-testid={`history-view-detail-${item.historyId}`}
                            onClick={() => handleOpenHistoryDetail(item.historyId)}
                            style={{
                              padding: '8px 12px',
                              minHeight: '44px',
                              minWidth: '44px',
                              borderRadius: '6px',
                              border: '1px solid var(--primary)',
                              backgroundColor: 'var(--primary-subtle)',
                              color: 'var(--primary)',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Xem chi tiết
                          </button>
                          <button
                            type="button"
                            data-testid={`history-export-csv-${item.historyId}`}
                            disabled={isExportingCsv}
                            onClick={() => handleExportHistory(item.historyId, 'csv')}
                            style={{
                              padding: '8px 11px',
                              minHeight: '44px',
                              minWidth: '44px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              cursor: isExportingCsv ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isExportingCsv ? 'Đang xuất...' : 'Xuất CSV'}
                          </button>
                          <button
                            type="button"
                            data-testid={`history-export-xlsx-${item.historyId}`}
                            disabled={isExportingXlsx}
                            onClick={() => handleExportHistory(item.historyId, 'xlsx')}
                            style={{
                              padding: '8px 11px',
                              minHeight: '44px',
                              minWidth: '44px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              cursor: isExportingXlsx ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isExportingXlsx ? 'Đang xuất...' : 'Xuất Excel'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Phân trang */}
        {historyData && historyData.total > historyLimit && (
          <div
            data-testid="history-pagination"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '8px',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              Trang {historyPage} / {Math.max(1, Math.ceil(historyData.total / historyLimit))}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: '8px 14px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  cursor: historyPage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: historyPage <= 1 ? 0.5 : 1,
                }}
              >
                Trang trước
              </button>
              <button
                type="button"
                disabled={historyPage >= Math.ceil(historyData.total / historyLimit)}
                onClick={() => setHistoryPage((p) => p + 1)}
                style={{
                  padding: '8px 14px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  cursor: historyPage >= Math.ceil(historyData.total / historyLimit) ? 'not-allowed' : 'pointer',
                  opacity: historyPage >= Math.ceil(historyData.total / historyLimit) ? 0.5 : 1,
                }}
              >
                Trang sau
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal Xem chi tiết phiên Chơi / Thi */}
      {(detailLoading || detailError || selectedHistoryDetail) && (
        <div
          data-testid="history-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết phiên Chơi / Thi"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(6, 9, 19, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedHistoryDetail(null);
              setDetailError(null);
              setDetailLoading(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '980px',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '14px',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {selectedHistoryDetail
                    ? `Chi tiết phiên: ${selectedHistoryDetail.gameTitle}`
                    : 'Chi tiết phiên Chơi / Thi'}
                </h3>
                {selectedHistoryDetail && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Mã phiên:{' '}
                    <strong>
                      {selectedHistoryDetail.roomCode ||
                        (selectedHistoryDetail.sessionId
                          ? selectedHistoryDetail.sessionId.slice(0, 8).toUpperCase()
                          : selectedHistoryDetail.historyId)}
                    </strong>{' '}
                    • Chế độ: <strong>{selectedHistoryDetail.sessionMode === 'EXAM' ? 'Thi' : 'Chơi'}</strong> • Hình thức:{' '}
                    <strong>
                      {selectedHistoryDetail.deliveryMode === 'MULTIPLAYER' ? 'Nhóm' : 'Cá nhân'}
                    </strong>{' '}
                    • Trạng thái:{' '}
                    <strong>
                      {selectedHistoryDetail.submittedReason === 'EXAM_CLOSED_BY_HOST' ||
                      selectedHistoryDetail.status === 'AUTO_SUBMITTED'
                        ? 'BTC kết thúc (Tự động nộp)'
                        : 'Hoàn tất'}
                    </strong>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {selectedHistoryDetail && (
                  <>
                    <button
                      type="button"
                      data-testid="modal-export-csv-btn"
                      disabled={exportingKey === `${selectedHistoryDetail.historyId}:csv`}
                      onClick={() => handleExportHistory(selectedHistoryDetail.historyId, 'csv')}
                      style={{
                        padding: '8px 14px',
                        minHeight: '44px',
                        minWidth: '44px',
                        borderRadius: '7px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {exportingKey === `${selectedHistoryDetail.historyId}:csv`
                        ? 'Đang xuất...'
                        : 'Xuất CSV'}
                    </button>
                    <button
                      type="button"
                      data-testid="modal-export-xlsx-btn"
                      disabled={exportingKey === `${selectedHistoryDetail.historyId}:xlsx`}
                      onClick={() => handleExportHistory(selectedHistoryDetail.historyId, 'xlsx')}
                      style={{
                        padding: '8px 14px',
                        minHeight: '44px',
                        minWidth: '44px',
                        borderRadius: '7px',
                        border: '1px solid var(--primary)',
                        backgroundColor: 'var(--primary)',
                        color: 'var(--primary-ink, #060913)',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {exportingKey === `${selectedHistoryDetail.historyId}:xlsx`
                        ? 'Đang xuất...'
                        : 'Xuất Excel (.xlsx)'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  data-testid="close-history-detail-modal"
                  onClick={() => {
                    setSelectedHistoryDetail(null);
                    setDetailError(null);
                    setDetailLoading(false);
                  }}
                  style={{
                    padding: '8px 14px',
                    minHeight: '44px',
                    minWidth: '44px',
                    borderRadius: '7px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Đóng
                </button>
              </div>
            </div>

            {detailLoading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Đang tải chi tiết phiên...
              </div>
            ) : detailError ? (
              <div style={{ padding: '16px', color: 'var(--accent-rose)', fontWeight: 600 }}>{detailError}</div>
            ) : selectedHistoryDetail ? (
              <>
                {/* Bảng kết quả người chơi / thí sinh */}
                <div>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    Danh sách kết quả người tham gia ({selectedHistoryDetail.participants.length})
                  </h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      data-testid="modal-participants-table"
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '640px' }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                            textAlign: 'left',
                            fontSize: '0.73rem',
                          }}
                        >
                          <th style={{ padding: '8px' }}>Hạng</th>
                          <th style={{ padding: '8px' }}>Họ và tên</th>
                          <th style={{ padding: '8px' }}>Đơn vị / Phòng ban</th>
                          <th style={{ padding: '8px' }}>Điểm số</th>
                          <th style={{ padding: '8px' }}>Số câu đúng</th>
                          <th style={{ padding: '8px' }}>Độ chính xác</th>
                          <th style={{ padding: '8px' }}>Thời gian</th>
                          <th style={{ padding: '8px' }}>Trạng thái nộp</th>
                          <th style={{ padding: '8px' }}>Kết quả</th>
                          <th style={{ padding: '8px' }}>Số lượt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedHistoryDetail.participants.map((p, idx) => {
                          const submissionLabel =
                            p.submittedReason === 'EXAM_CLOSED_BY_HOST' || p.status === 'AUTO_SUBMITTED'
                              ? 'BTC kết thúc'
                              : p.submittedReason === 'TIMER_EXPIRED'
                                ? 'Hết giờ'
                                : p.status === 'COMPLETED'
                                  ? 'Nộp thủ công'
                                  : 'Chưa nộp';
                          const resultLabel =
                            p.isPassed === true
                              ? 'Đạt'
                              : p.isPassed === false
                                ? 'Chưa đạt'
                                : p.status === 'COMPLETED' || p.status === 'AUTO_SUBMITTED'
                                  ? 'Hoàn thành'
                                  : 'Chưa nộp';
                          return (
                            <tr
                              key={`${p.rank ?? idx}-${p.fullName}`}
                              style={{ borderBottom: '1px solid var(--border-subtle)' }}
                            >
                              <td style={{ padding: '8px', fontWeight: 800 }}>#{p.rank ?? idx + 1}</td>
                              <td style={{ padding: '8px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {p.fullName}
                              </td>
                              <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>
                                {p.departmentUnit || '—'}
                              </td>
                              <td style={{ padding: '8px', fontWeight: 800, color: 'var(--primary)' }}>
                                {p.score.toLocaleString('vi-VN')} đ
                              </td>
                              <td style={{ padding: '8px' }}>
                                {p.correctAnswers} / {p.totalQuestions}
                              </td>
                              <td style={{ padding: '8px' }}>{p.accuracyPercent}%</td>
                              <td style={{ padding: '8px' }}>{formatDuration(p.durationMs)}</td>
                              <td style={{ padding: '8px' }}>{submissionLabel}</td>
                              <td style={{ padding: '8px', fontWeight: 700 }}>{resultLabel}</td>
                              <td style={{ padding: '8px' }}>
                                {p.usedAttempts} / {p.allowedAttempts}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Chi tiết từng câu hỏi (nếu có) */}
                {selectedHistoryDetail.questionBreakdown && selectedHistoryDetail.questionBreakdown.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Chi tiết câu trả lời ({selectedHistoryDetail.questionBreakdown.length} câu)
                      {selectedHistoryDetail.sessionMode === 'EXAM' &&
                        !selectedHistoryDetail.answersPublished && (
                          <span
                            style={{
                              marginLeft: '10px',
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              color: 'var(--accent-amber)',
                            }}
                          >
                            (Đáp án chuẩn đang được bảo mật theo quy chế Thi)
                          </span>
                        )}
                    </h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        data-testid="modal-questions-table"
                        style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem', minWidth: '580px' }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: '1px solid var(--border-subtle)',
                              color: 'var(--text-secondary)',
                              textAlign: 'left',
                              fontSize: '0.73rem',
                            }}
                          >
                            <th style={{ padding: '8px' }}>Câu</th>
                            <th style={{ padding: '8px' }}>Nội dung câu hỏi</th>
                            <th style={{ padding: '8px' }}>Câu trả lời đã chọn</th>
                            {selectedHistoryDetail.answersPublished && (
                              <th style={{ padding: '8px' }}>Đáp án đúng</th>
                            )}
                            <th style={{ padding: '8px' }}>Kết quả</th>
                            <th style={{ padding: '8px' }}>Điểm</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedHistoryDetail.questionBreakdown.map((q) => (
                            <tr key={q.questionId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '8px', fontWeight: 700 }}>#{q.questionIndex}</td>
                              <td style={{ padding: '8px', color: 'var(--text-primary)' }}>{q.questionText}</td>
                              <td style={{ padding: '8px' }}>{q.playerAnswer || '(Bỏ trống)'}</td>
                              {selectedHistoryDetail.answersPublished && (
                                <td style={{ padding: '8px', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                                  {q.correctAnswer || '—'}
                                </td>
                              )}
                              <td
                                style={{
                                  padding: '8px',
                                  fontWeight: 700,
                                  color:
                                    q.isCorrect === null || q.isCorrect === undefined
                                      ? 'var(--text-secondary)'
                                      : q.isCorrect
                                        ? 'var(--accent-emerald)'
                                        : 'var(--accent-rose)',
                                }}
                              >
                                {q.isCorrect === null || q.isCorrect === undefined
                                  ? 'Chưa công bố'
                                  : q.isCorrect
                                    ? 'Đúng'
                                    : 'Sai'}
                              </td>
                              <td style={{ padding: '8px', fontWeight: 700 }}>
                                {q.pointsEarned === null || q.pointsEarned === undefined
                                  ? '—'
                                  : `${q.pointsEarned} đ`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
