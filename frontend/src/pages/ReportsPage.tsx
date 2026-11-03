import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangleIcon,
  BarChartIcon as ChartBarIcon,
  BookOpenIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/Icons.js';
import { SoloPresentationPage, type ExamBatchQRContext } from './SoloPresentationPage.js';
import {
  closeGameExamApi,
  createRoom,
  downloadGameScoreboardExport,
  downloadPlayExamHistoryExport,
  fetchCreatorReportsGamesApi,
  fetchGameReportsDetailApi,
  fetchLearningAnalytics,
  fetchPlayExamHistoryApi,
  fetchPlayExamHistoryDetailApi,
  fetchPracticeHistory,
  grantParticipantRetakeApi,
  reopenGameExamApi,
  type GameReportsDetailResult,
  type PlayExamHistoryDetail,
  type PlayExamHistoryListResult,
  type PlayExamHistoryQuestionRow,
  type ReportsExamBatchItem,
  type ReportsExamBatchParticipantRow,
  type ReportsGameOverviewItem,
  type ReportsOverviewResult,
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

  // V3 Reports 2.0: Creator Library Games Hub + PLAY/EXAM Detail + Retake & Exam Reopen
  const [reportsGamesData, setReportsGamesData] = useState<ReportsOverviewResult | null>(null);
  const [reportsGamesLoading, setReportsGamesLoading] = useState<boolean>(false);
  const [reportsGamesError, setReportsGamesError] = useState<string | null>(null);
  const [reportsGameModeFilter, setReportsGameModeFilter] = useState<'ALL' | 'PLAY' | 'EXAM'>('ALL');
  const [reportsGameSearch, setReportsGameSearch] = useState<string>('');
  const [reportsGamePage, setReportsGamePage] = useState<number>(1);
  const reportsGameLimit = 10;

  const readReportGameIdFromUrl = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const gid = params.get('reportGameId');
      return gid && gid.trim() ? gid.trim() : null;
    } catch {
      return null;
    }
  };

  const [activeDetailGameId, setActiveDetailGameId] = useState<string | null>(() =>
    readReportGameIdFromUrl()
  );
  const [selectedGameReport, setSelectedGameReport] = useState<GameReportsDetailResult | null>(null);
  const [selectedGameReportLoading, setSelectedGameReportLoading] = useState<boolean>(() =>
    Boolean(readReportGameIdFromUrl())
  );
  const [selectedGameReportError, setSelectedGameReportError] = useState<string | null>(null);

  const [selectedExamBatchId, setSelectedExamBatchId] = useState<string>('LATEST');
  const [examParticipantSearch, setExamParticipantSearch] = useState<string>('');
  const [examParticipantFilter, setExamParticipantFilter] = useState<
    'ALL' | 'COMPLETED' | 'PENDING' | 'IN_PROGRESS' | 'ABANDONED' | 'PASSED' | 'FAILED'
  >('ALL');

  const [participantAttemptsModal, setParticipantAttemptsModal] =
    useState<ReportsExamBatchParticipantRow | null>(null);
  const [expandedAttemptIdInModal, setExpandedAttemptIdInModal] = useState<string | null>(null);

  const [playAttemptBreakdownModal, setPlayAttemptBreakdownModal] = useState<{
    attemptNumber: number;
    playerName: string;
    score: number;
    correctAnswers: number;
    wrongAnswers: number;
    totalQuestions: number;
    durationMs: number;
    questionBreakdown: PlayExamHistoryQuestionRow[];
  } | null>(null);

  const [grantRetakeModal, setGrantRetakeModal] = useState<{
    gameId: string;
    participantId: string;
    fullName: string;
    departmentUnit: string;
    employeeCode: string;
    usedAttempts: number;
    allowedAttempts: number;
    additionalAttempts: number;
    requestId: string;
  } | null>(null);
  const [isGrantingRetake, setIsGrantingRetake] = useState<boolean>(false);
  const [grantRetakeError, setGrantRetakeError] = useState<string | null>(null);
  const [examBatchQrModal, setExamBatchQrModal] = useState<ExamBatchQRContext | null>(null);

  const [isReopeningExam, setIsReopeningExam] = useState<boolean>(false);
  const [isClosingExam, setIsClosingExam] = useState<boolean>(false);
  const [isCreatingRoomPin, setIsCreatingRoomPin] = useState<boolean>(false);
  const [copiedNoticeKey, setCopiedNoticeKey] = useState<string | null>(null);
  const [reportsActionNotice, setReportsActionNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const syncReportGameIdInUrl = useCallback(
    (gameId: string | null, mode: 'push' | 'replace' = 'push') => {
      if (typeof window === 'undefined') return;
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'reports');
        if (gameId && gameId.trim()) {
          url.searchParams.set('reportGameId', gameId.trim());
        } else {
          url.searchParams.delete('reportGameId');
        }
        const nextHref = `${url.pathname}${url.search}${url.hash}`;
        const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextHref !== currentHref) {
          if (mode === 'replace') {
            window.history.replaceState({}, '', nextHref);
          } else {
            window.history.pushState({}, '', nextHref);
          }
        }
      } catch {
        // ignore URL sync errors
      }
    },
    []
  );

  const loadReportsGamesOverview = useCallback(async () => {
    setReportsGamesLoading(true);
    setReportsGamesError(null);
    try {
      const res = await fetchCreatorReportsGamesApi({
        sessionMode: reportsGameModeFilter,
        search: reportsGameSearch,
        page: reportsGamePage,
        limit: reportsGameLimit,
      });
      setReportsGamesData(res);
    } catch (err: any) {
      setReportsGamesError(err?.message || 'Không thể tải danh sách game trong Thư viện.');
    } finally {
      setReportsGamesLoading(false);
    }
  }, [reportsGameModeFilter, reportsGameSearch, reportsGamePage]);

  useEffect(() => {
    loadReportsGamesOverview();
  }, [loadReportsGamesOverview, currentUser?.userId]);

  const handleOpenGameReportsDetail = useCallback(
    async (
      gameId: string,
      preserveBatchSelection: boolean = false,
      skipUrlPush: boolean = false
    ) => {
      const normalizedGameId = gameId.trim();
      setActiveDetailGameId(normalizedGameId);
      if (!skipUrlPush && !preserveBatchSelection) {
        syncReportGameIdInUrl(normalizedGameId, 'push');
      }
      setSelectedGameReportLoading(true);
      setSelectedGameReportError(null);
      setExportErrorMsg(null);
      if (!preserveBatchSelection) {
        setReportsActionNotice(null);
        setSelectedGameReport((prev) => (prev?.gameId === normalizedGameId ? prev : null));
      }
      try {
        const detail = await fetchGameReportsDetailApi(normalizedGameId);
        setSelectedGameReport(detail);
        if (!preserveBatchSelection) {
          if (detail.examBatches && detail.examBatches.length > 0) {
            const latestBatch = detail.examBatches[detail.examBatches.length - 1];
            setSelectedExamBatchId(latestBatch.batchId);
          } else {
            setSelectedExamBatchId('ALL');
          }
          setExamParticipantSearch('');
          setExamParticipantFilter('ALL');
        }
        // Also keep participantAttemptsModal synced if currently open
        setParticipantAttemptsModal((prev) => {
          if (!prev || !prev.participantId) return prev;
          for (const b of detail.examBatches || []) {
            const match = b.participants.find((p) => p.participantId === prev.participantId);
            if (match && (!preserveBatchSelection || b.batchId === selectedExamBatchId)) {
              return match;
            }
          }
          const overallMatch = detail.examOverallBatch?.participants.find(
            (p) => p.participantId === prev.participantId
          );
          return overallMatch || prev;
        });
      } catch (err: any) {
        setSelectedGameReport(null);
        setSelectedGameReportError(
          err?.message || 'Không thể tải chi tiết báo cáo của game (Game không tồn tại hoặc bạn không có quyền truy cập).'
        );
      } finally {
        setSelectedGameReportLoading(false);
      }
    },
    [selectedExamBatchId, syncReportGameIdInUrl]
  );

  const handleBackToReportsOverview = useCallback(
    (skipUrlPush: boolean = false) => {
      setActiveDetailGameId(null);
      setSelectedGameReport(null);
      setSelectedGameReportError(null);
      setSelectedGameReportLoading(false);
      setReportsActionNotice(null);
      setExportErrorMsg(null);
      setParticipantAttemptsModal(null);
      setPlayAttemptBreakdownModal(null);
      setGrantRetakeModal(null);
      setExamBatchQrModal(null);
      if (!skipUrlPush) {
        syncReportGameIdInUrl(null, 'push');
      }
    },
    [syncReportGameIdInUrl]
  );

  useEffect(() => {
    const initialGameId = readReportGameIdFromUrl();
    if (initialGameId) {
      handleOpenGameReportsDetail(initialGameId, false, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.userId]);

  useEffect(() => {
    const onPopState = () => {
      const urlGameId = readReportGameIdFromUrl();
      if (urlGameId) {
        handleOpenGameReportsDetail(urlGameId, false, true);
      } else {
        handleBackToReportsOverview(true);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [handleOpenGameReportsDetail, handleBackToReportsOverview]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const navBtn = document.getElementById('nav-item-reports');
    if (!navBtn) return;
    const onNavClick = () => {
      if (activeDetailGameId) {
        handleBackToReportsOverview(false);
      }
    };
    navBtn.addEventListener('click', onNavClick);
    return () => navBtn.removeEventListener('click', onNavClick);
  }, [activeDetailGameId, handleBackToReportsOverview]);

  const handleExportSelectedGameScoreboard = async (
    gameId: string,
    format: 'csv' | 'xlsx'
  ) => {
    const key = `game:${gameId}:${format}`;
    setExportingKey(key);
    setExportErrorMsg(null);
    try {
      await downloadGameScoreboardExport(gameId, format);
    } catch (err: any) {
      setExportErrorMsg(err?.message || 'Không thể xuất tệp báo cáo của game.');
    } finally {
      setExportingKey(null);
    }
  };

  const handleOpenGrantRetakeModal = (params: {
    gameId: string;
    participantId: string;
    fullName: string;
    departmentUnit?: string;
    employeeCode?: string;
    usedAttempts: number;
    allowedAttempts: number;
  }) => {
    setGrantRetakeError(null);
    setGrantRetakeModal({
      gameId: params.gameId,
      participantId: params.participantId,
      fullName: params.fullName,
      departmentUnit: params.departmentUnit || '',
      employeeCode: params.employeeCode || '',
      usedAttempts: params.usedAttempts,
      allowedAttempts: params.allowedAttempts,
      additionalAttempts: 1,
      requestId: `retake_${params.participantId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
  };

  const handleConfirmGrantRetake = async () => {
    if (!grantRetakeModal || isGrantingRetake) return;
    const count = Number(grantRetakeModal.additionalAttempts);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      setGrantRetakeError('Số lượt cấp thêm phải là số nguyên từ 1 đến 10.');
      return;
    }
    setIsGrantingRetake(true);
    setGrantRetakeError(null);
    try {
      const updated = await grantParticipantRetakeApi(
        grantRetakeModal.gameId,
        grantRetakeModal.participantId,
        {
          additionalAttempts: count,
          requestId: grantRetakeModal.requestId,
        }
      );
      const pInfo = updated.participant || (updated as any);
      setReportsActionNotice({
        type: 'success',
        message: `Đã cấp thêm +${count} lượt cho "${pInfo.fullName || grantRetakeModal.fullName}" (Đã dùng: ${pInfo.usedAttempts ?? grantRetakeModal.usedAttempts}/${pInfo.allowedAttempts ?? grantRetakeModal.allowedAttempts + count} lượt).`,
      });
      const targetGameId = grantRetakeModal.gameId;
      setGrantRetakeModal(null);
      await Promise.all([
        handleOpenGameReportsDetail(targetGameId, true),
        loadReportsGamesOverview(),
        loadHistoryActivities(),
      ]);
    } catch (err: any) {
      setGrantRetakeError(err?.message || 'Không thể cấp thêm lượt cho người tham gia này.');
    } finally {
      setIsGrantingRetake(false);
    }
  };

  const handleOpenBatchQrModal = (batch: ReportsExamBatchItem) => {
    if (!selectedGameReport) return;
    setExamBatchQrModal({
      gameId: selectedGameReport.gameId,
      gameTitle: selectedGameReport.title,
      batchId: batch.batchId,
      batchNumber: batch.batchNumber,
      batchName: batch.batchName,
      status: batch.status,
      pin: batch.pin ?? batch.roomCode ?? null,
      expiredPin: batch.expiredPin ?? null,
      pinStatus: batch.pinStatus ?? (batch.roomCode ? 'ACTIVE' : 'NONE'),
    });
  };

  const handleReopenExamFromReports = async (
    gameId: string,
    options?: { batchId?: string; createNewBatch?: boolean }
  ) => {
    if (isReopeningExam) return;
    setIsReopeningExam(true);
    setReportsActionNotice(null);
    try {
      const isNewBatch = Boolean(options?.createNewBatch);
      const res = await reopenGameExamApi(gameId, {
        batchId: options?.batchId,
        createNewBatch: isNewBatch,
      });
      if (res.batchId) {
        setSelectedExamBatchId(res.batchId);
      }
      setReportsActionNotice({
        type: 'success',
        message:
          (res as any).message ||
          (isNewBatch
            ? `Đã tạo và mở đợt thi mới (${res.batchName || 'Đợt mới'}) thành công.`
            : `Đã mở lại đợt thi (${res.batchName || 'Đợt thi'}) thành công. Lịch sử và điểm các lần thi trước được giữ nguyên.`),
      });
      await Promise.all([
        handleOpenGameReportsDetail(gameId, true),
        loadReportsGamesOverview(),
        loadHistoryActivities(),
      ]);
    } catch (err: any) {
      setReportsActionNotice({
        type: 'error',
        message: err?.message || 'Không thể mở lại đợt thi.',
      });
    } finally {
      setIsReopeningExam(false);
    }
  };

  const handleCloseExamFromReports = async (gameId: string, batchId?: string) => {
    if (isClosingExam) return;
    setIsClosingExam(true);
    setReportsActionNotice(null);
    try {
      const res = await closeGameExamApi(gameId, batchId ? { batchId } : undefined);
      setReportsActionNotice({
        type: 'success',
        message:
          (res as any).message || 'Đã đóng đợt thi hiện tại và lưu kết quả vào lịch sử đợt thi.',
      });
      await Promise.all([
        handleOpenGameReportsDetail(gameId, true),
        loadReportsGamesOverview(),
        loadHistoryActivities(),
      ]);
    } catch (err: any) {
      setReportsActionNotice({
        type: 'error',
        message: err?.message || 'Không thể đóng đợt thi.',
      });
    } finally {
      setIsClosingExam(false);
    }
  };

  const handleCreateRoomPinFromReports = async (gameId: string) => {
    if (isCreatingRoomPin) return;
    setIsCreatingRoomPin(true);
    setReportsActionNotice(null);
    try {
      const created = await createRoom({ gameId, requirePublished: false });
      setReportsActionNotice({
        type: 'success',
        message: `Đã tạo phòng trực tiếp mới thành công • Mã PIN: ${created.roomCode}`,
      });
      await Promise.all([
        handleOpenGameReportsDetail(gameId, true),
        loadReportsGamesOverview(),
      ]);
    } catch (err: any) {
      setReportsActionNotice({
        type: 'error',
        message: err?.message || 'Không thể tạo mã PIN phòng mới.',
      });
    } finally {
      setIsCreatingRoomPin(false);
    }
  };

  const handleCopyText = async (key: string, textToCopy: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      }
      setCopiedNoticeKey(key);
      setTimeout(() => {
        setCopiedNoticeKey((prev) => (prev === key ? null : prev));
      }, 2200);
    } catch {
      setCopiedNoticeKey(key);
    }
  };

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
          loadReportsGamesOverview();
          if (selectedGameReport?.gameId) {
            handleOpenGameReportsDetail(selectedGameReport.gameId, true);
          }
        }
      } catch (err: any) {
        setErrorMessage(err?.message || 'Không thể tải dữ liệu thống kê hoạt động.');
      } finally {
        setIsLoading(false);
      }
    },
    [
      activityRange,
      loadHistoryActivities,
      loadReportsGamesOverview,
      selectedGameReport?.gameId,
      handleOpenGameReportsDetail,
    ]
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
      {activeDetailGameId ? (
        /* =========================================================================
           MÀN HÌNH CHI TIẾT BÁO CÁO GAME RIÊNG BIỆT TRONG REPORTS (PLAY / EXAM)
           ========================================================================= */
        <section
          data-testid="reports-game-detail-screen"
          aria-label="Màn hình chi tiết báo cáo game"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          {/* Thanh điều hướng quay lại Thống kê & Xuất báo cáo */}
          <header
            data-testid="reports-game-detail-topbar"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              paddingBottom: '14px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
              <button
                type="button"
                data-testid="back-to-reports-overview-btn"
                onClick={() => handleBackToReportsOverview(false)}
                style={{
                  padding: '8px 16px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>← Quay lại Thống kê</span>
              </button>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                <span>Thống kê hoạt động</span>
                <span style={{ margin: '0 6px' }}>/</span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {selectedGameReport?.title || `Chi tiết game (${activeDetailGameId})`}
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {selectedGameReport && (
                <>
                  <button
                    type="button"
                    data-testid="detail-export-csv-btn"
                    disabled={exportingKey === `game:${activeDetailGameId}:csv`}
                    onClick={() => handleExportSelectedGameScoreboard(activeDetailGameId, 'csv')}
                    style={{
                      padding: '8px 14px',
                      minHeight: '44px',
                      minWidth: '44px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor:
                        exportingKey === `game:${activeDetailGameId}:csv` ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {exportingKey === `game:${activeDetailGameId}:csv` ? 'Đang xuất...' : 'Xuất CSV'}
                  </button>
                  <button
                    type="button"
                    data-testid="detail-export-xlsx-btn"
                    disabled={exportingKey === `game:${activeDetailGameId}:xlsx`}
                    onClick={() => handleExportSelectedGameScoreboard(activeDetailGameId, 'xlsx')}
                    style={{
                      padding: '8px 14px',
                      minHeight: '44px',
                      minWidth: '44px',
                      borderRadius: '8px',
                      border: '1px solid var(--primary)',
                      backgroundColor: 'var(--primary-subtle)',
                      color: 'var(--primary)',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor:
                        exportingKey === `game:${activeDetailGameId}:xlsx` ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {exportingKey === `game:${activeDetailGameId}:xlsx`
                      ? 'Đang xuất...'
                      : 'Xuất Excel (.xlsx)'}
                  </button>
                </>
              )}

              <button
                type="button"
                data-testid="refresh-selected-game-report-btn"
                onClick={() => handleOpenGameReportsDetail(activeDetailGameId, true, true)}
                disabled={selectedGameReportLoading}
                style={{
                  padding: '8px 14px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: selectedGameReportLoading ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshIcon size={14} />
                <span>Làm mới chi tiết</span>
              </button>

              <button
                type="button"
                data-testid="close-selected-game-report-btn"
                onClick={() => handleBackToReportsOverview(false)}
                style={{
                  padding: '8px 14px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Danh sách game
              </button>
            </div>
          </header>

          {exportErrorMsg && (
            <div
              data-testid="detail-export-error"
              role="alert"
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: 'var(--accent-rose)',
                fontSize: '0.82rem',
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
                  minHeight: '44px',
                  minWidth: '44px',
                  padding: '6px 10px',
                }}
              >
                Đóng
              </button>
            </div>
          )}

          <div
            data-testid="reports-v2-game-detail"
            style={{
              padding: 'clamp(14px, 2.5vw, 20px)',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              minWidth: 0,
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            {selectedGameReportLoading && !selectedGameReport ? (
              <div
                data-testid="reports-game-detail-loading"
                style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}
              >
                Đang tải chi tiết báo cáo của game...
              </div>
            ) : selectedGameReportError ? (
              <div
                data-testid="reports-game-detail-error"
                role="alert"
                style={{
                  padding: '24px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: 'var(--accent-rose)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, fontSize: '0.94rem' }}>
                  <AlertTriangleIcon size={18} />
                  <span>Không thể mở báo cáo chi tiết của game này</span>
                </div>
                <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{selectedGameReportError}</div>
                <button
                  type="button"
                  data-testid="error-back-to-reports-btn"
                  onClick={() => handleBackToReportsOverview(false)}
                  style={{
                    padding: '8px 16px',
                    minHeight: '44px',
                    minWidth: '44px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ← Quay lại Thống kê
                </button>
              </div>
            ) : selectedGameReport ? (
              <>
                {/* Header chi tiết game */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '12px',
                    paddingBottom: '12px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '3px 9px',
                          borderRadius: '999px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          backgroundColor:
                            selectedGameReport.sessionMode === 'EXAM'
                              ? 'rgba(245, 158, 11, 0.18)'
                              : 'rgba(16, 185, 129, 0.16)',
                          color:
                            selectedGameReport.sessionMode === 'EXAM'
                              ? 'var(--accent-amber)'
                              : 'var(--accent-emerald)',
                        }}
                      >
                        {selectedGameReport.sessionMode === 'EXAM'
                          ? 'BÁO CÁO CHẾ ĐỘ THI (EXAM)'
                          : 'BÁO CÁO CHẾ ĐỘ CHƠI (PLAY)'}
                      </span>
                      <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {selectedGameReport.title}
                      </h2>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Mã game: <code>{selectedGameReport.gameId}</code> • Số câu hỏi:{' '}
                      <strong>{selectedGameReport.questionCount}</strong> • Điểm tối đa:{' '}
                      <strong>{selectedGameReport.maxPossibleScore} đ</strong>
                    </div>
                  </div>
                </div>

                {/* Thông báo kết quả thao tác (Cấp lượt / Mở lại đợt thi / Tạo PIN) */}
                {reportsActionNotice && (
                  <div
                    data-testid="reports-action-notice"
                    role="status"
                    style={{
                      padding: '12px 16px',
                      borderRadius: '8px',
                      backgroundColor:
                        reportsActionNotice.type === 'success'
                          ? 'rgba(16, 185, 129, 0.14)'
                          : 'rgba(239, 68, 68, 0.12)',
                      border:
                        reportsActionNotice.type === 'success'
                          ? '1px solid rgba(16, 185, 129, 0.4)'
                          : '1px solid rgba(239, 68, 68, 0.4)',
                      color:
                        reportsActionNotice.type === 'success'
                          ? 'var(--accent-emerald)'
                          : 'var(--accent-rose)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{reportsActionNotice.message}</span>
                    <button
                      type="button"
                      onClick={() => setReportsActionNotice(null)}
                      style={{
                        padding: '6px 12px',
                        minHeight: '44px',
                        minWidth: '44px',
                        borderRadius: '6px',
                        border: '1px solid currentColor',
                        backgroundColor: 'transparent',
                        color: 'inherit',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Đóng
                    </button>
                  </div>
                )}

                {/* Thanh truy cập: PLAY giữ Link tham gia / PIN phòng; EXAM hiển thị QR riêng & quản lý theo từng đợt thi */}
                <div
                  data-testid="reports-game-access-bar"
                  style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  {selectedGameReport.sessionMode === 'PLAY' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Link tham gia:{' '}
                        <code
                          data-testid="reports-solo-play-url"
                          style={{
                            padding: '3px 7px',
                            borderRadius: '5px',
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--primary)',
                            fontWeight: 700,
                          }}
                        >
                          {typeof window !== 'undefined' &&
                          !selectedGameReport.soloPlayUrl.startsWith('http')
                            ? `${window.location.origin}${selectedGameReport.soloPlayUrl}`
                            : selectedGameReport.soloPlayUrl}
                        </code>
                      </div>
                      <button
                        type="button"
                        data-testid="copy-solo-link-btn"
                        onClick={() =>
                          handleCopyText(
                            'solo-link',
                            typeof window !== 'undefined' &&
                              !selectedGameReport.soloPlayUrl.startsWith('http')
                              ? `${window.location.origin}${selectedGameReport.soloPlayUrl}`
                              : selectedGameReport.soloPlayUrl
                          )
                        }
                        style={{
                          padding: '8px 12px',
                          minHeight: '44px',
                          minWidth: '44px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-subtle)',
                          color: 'var(--text-primary)',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {copiedNoticeKey === 'solo-link' ? 'Đã sao chép Link!' : 'Sao chép Link'}
                      </button>

                      {selectedGameReport.activeStatus?.activeRooms &&
                      selectedGameReport.activeStatus.activeRooms.length > 0 ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span
                            data-testid="reports-active-room-pin"
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'var(--primary-subtle)',
                              color: 'var(--primary)',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              fontFamily: 'monospace',
                            }}
                          >
                            PIN: {selectedGameReport.activeStatus.activeRooms[0].roomCode}
                          </span>
                          <button
                            type="button"
                            data-testid="copy-room-pin-btn"
                            onClick={() =>
                              handleCopyText(
                                'room-pin',
                                selectedGameReport.activeStatus.activeRooms[0].roomCode
                              )
                            }
                            style={{
                              padding: '8px 12px',
                              minHeight: '44px',
                              minWidth: '44px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {copiedNoticeKey === 'room-pin' ? 'Đã sao chép PIN!' : 'Sao chép PIN'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid="create-room-pin-btn"
                          disabled={isCreatingRoomPin}
                          onClick={() => handleCreateRoomPinFromReports(selectedGameReport.gameId)}
                          style={{
                            padding: '8px 12px',
                            minHeight: '44px',
                            minWidth: '44px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: isCreatingRoomPin ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isCreatingRoomPin ? 'Đang tạo PIN...' : '+ Tạo mã PIN phòng trực tiếp'}
                        </button>
                      )}
                    </div>
                  ) : (
                    (() => {
                      const managedBatch: ReportsExamBatchItem | null =
                        selectedGameReport.examBatches.find((b) => b.batchId === selectedExamBatchId) ||
                        selectedGameReport.examBatches[selectedGameReport.examBatches.length - 1] ||
                        null;
                      const activeBatchPin =
                        managedBatch?.pinStatus === 'ACTIVE' && managedBatch.pin
                          ? managedBatch.pin
                          : managedBatch?.roomCode || null;
                      const rawTitle = managedBatch
                        ? managedBatch.batchName.replace(/\s*\(Phòng\s+[A-Z0-9]+\)/i, '').trim()
                        : 'Đợt 1';
                      const batchDisplayTitle = activeBatchPin
                        ? `${rawTitle} — Phòng ${activeBatchPin}`
                        : rawTitle;
                      const isBatchClosed = managedBatch
                        ? managedBatch.status === 'CLOSED'
                        : selectedGameReport.examStatus === 'CLOSED';

                      return (
                        <>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', minWidth: 0 }}>
                            <span
                              data-testid="reports-selected-batch-title"
                              style={{
                                fontSize: '0.88rem',
                                fontWeight: 800,
                                color: 'var(--text-primary)',
                              }}
                            >
                              {batchDisplayTitle}
                            </span>

                            <span
                              data-testid="reports-exam-status-badge"
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                backgroundColor: isBatchClosed
                                  ? 'rgba(239, 68, 68, 0.14)'
                                  : 'rgba(16, 185, 129, 0.14)',
                                color: isBatchClosed ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                              }}
                            >
                              {isBatchClosed ? 'Trạng thái: Đã đóng' : 'Trạng thái: Đang mở'}
                            </span>

                            {managedBatch?.pinStatus === 'EXPIRED' && managedBatch.expiredPin && (
                              <span
                                data-testid="reports-expired-pin-badge"
                                style={{
                                  padding: '4px 9px',
                                  borderRadius: '6px',
                                  fontSize: '0.73rem',
                                  fontWeight: 700,
                                  backgroundColor: 'var(--bg-subtle)',
                                  border: '1px dashed var(--border-strong)',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                Mã PIN phòng cũ đã hết hiệu lực
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {managedBatch && (
                              <button
                                type="button"
                                data-testid="open-selected-batch-qr-btn"
                                onClick={() => handleOpenBatchQrModal(managedBatch)}
                                style={{
                                  padding: '8px 14px',
                                  minHeight: '44px',
                                  minWidth: '44px',
                                  borderRadius: '7px',
                                  border: '1px solid var(--primary)',
                                  backgroundColor: 'var(--primary-subtle)',
                                  color: 'var(--primary)',
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <QrCodeIcon size={15} />
                                <span>Mở mã QR đợt {managedBatch.batchNumber}</span>
                              </button>
                            )}

                            {isBatchClosed ? (
                              <button
                                type="button"
                                data-testid="reopen-exam-btn"
                                disabled={isReopeningExam}
                                onClick={() =>
                                  handleReopenExamFromReports(selectedGameReport.gameId, {
                                    batchId: managedBatch?.batchId,
                                    createNewBatch: false,
                                  })
                                }
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
                                  cursor: isReopeningExam ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {isReopeningExam ? 'Đang mở lại...' : 'Mở lại đợt thi'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid="close-exam-from-reports-btn"
                                disabled={isClosingExam}
                                onClick={() =>
                                  handleCloseExamFromReports(
                                    selectedGameReport.gameId,
                                    managedBatch?.batchId
                                  )
                                }
                                style={{
                                  padding: '8px 14px',
                                  minHeight: '44px',
                                  minWidth: '44px',
                                  borderRadius: '7px',
                                  border: '1px solid rgba(239, 68, 68, 0.45)',
                                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                  color: 'var(--accent-rose)',
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  cursor: isClosingExam ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {isClosingExam ? 'Đang đóng...' : 'Đóng đợt thi hiện tại'}
                              </button>
                            )}

                            <button
                              type="button"
                              data-testid="create-new-exam-batch-btn"
                              disabled={isReopeningExam}
                              onClick={() =>
                                handleReopenExamFromReports(selectedGameReport.gameId, {
                                  createNewBatch: true,
                                })
                              }
                              style={{
                                padding: '8px 12px',
                                minHeight: '44px',
                                minWidth: '44px',
                                borderRadius: '7px',
                                border: '1px solid var(--border-strong)',
                                backgroundColor: 'var(--bg-subtle)',
                                color: 'var(--text-primary)',
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                cursor: isReopeningExam ? 'not-allowed' : 'pointer',
                              }}
                            >
                              + Tạo đợt thi mới
                            </button>
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>

                {/* =========================================================
                    CHẾ ĐỘ PLAY: TỔNG QUAN, BẢNG XẾP HẠNG HIGHEST_SCORE, LỊCH SỬ TỪNG LƯỢT & CẤP THÊM LƯỢT
                   ========================================================= */}
                {selectedGameReport.sessionMode === 'PLAY' ? (
                  <div
                    data-testid="reports-play-detail-view"
                    style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}
                  >
                    {/* A. Tổng quan PLAY */}
                    <div
                      data-testid="reports-play-overview"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
                        gap: '12px',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Tổng lượt chơi
                        </div>
                        <div
                          data-testid="play-overview-total-plays"
                          style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}
                        >
                          {selectedGameReport.playOverview.totalPlays}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {selectedGameReport.playOverview.completedPlays} hoàn thành •{' '}
                          {selectedGameReport.playOverview.inProgressPlays} đang chơi •{' '}
                          {selectedGameReport.playOverview.abandonedPlays} bỏ dở
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Số người chơi khác nhau
                        </div>
                        <div
                          data-testid="play-overview-unique-players"
                          style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent-sky)', marginTop: '4px' }}
                        >
                          {selectedGameReport.playOverview.uniquePlayers}
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Điểm trung bình
                        </div>
                        <div
                          data-testid="play-overview-avg-score"
                          style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent-amber)', marginTop: '4px' }}
                        >
                          {selectedGameReport.playOverview.averageScore.toLocaleString('vi-VN')} đ
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Điểm cao nhất
                        </div>
                        <div
                          data-testid="play-overview-highest-score"
                          style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent-emerald)', marginTop: '4px' }}
                        >
                          {selectedGameReport.playOverview.highestScore.toLocaleString('vi-VN')} đ
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '10px',
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Hoạt động gần nhất
                        </div>
                        <div
                          style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '6px' }}
                        >
                          {selectedGameReport.playOverview.lastActivityAt
                            ? new Date(selectedGameReport.playOverview.lastActivityAt).toLocaleString('vi-VN')
                            : 'Chưa có lượt chơi'}
                        </div>
                      </div>
                    </div>

                    {/* B. Bảng xếp hạng PLAY (HIGHEST_SCORE) */}
                    <div
                      data-testid="reports-play-leaderboard"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div>
                          <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            Bảng xếp hạng Người chơi (Chế độ PLAY)
                          </h4>
                          <p
                            data-testid="reports-play-leaderboard-rule"
                            style={{ margin: '4px 0 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}
                          >
                            Quy tắc xếp hạng: <strong>Điểm cao nhất của mỗi người chơi (HIGHEST_SCORE)</strong> — mỗi người chỉ xuất hiện 1 lần, không cộng dồn điểm nhiều lượt. Khi bằng điểm: <em>{selectedGameReport.playLeaderboard.tieBreakingRuleText}</em>
                          </p>
                        </div>
                      </div>

                      {/* Top 3 Podium */}
                      {selectedGameReport.playLeaderboard.top3.length > 0 && (
                        <div
                          data-testid="reports-play-podium"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                            gap: '12px',
                          }}
                        >
                          {selectedGameReport.playLeaderboard.top3.map((top) => (
                            <div
                              key={top.playerKey}
                              data-testid={`play-podium-rank-${top.rank}`}
                              style={{
                                padding: '12px 14px',
                                borderRadius: '10px',
                                border:
                                  top.rank === 1
                                    ? '1px solid var(--accent-amber)'
                                    : '1px solid var(--border-subtle)',
                                backgroundColor:
                                  top.rank === 1 ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-subtle)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '10px',
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--accent-amber)' }}>
                                  TOP {top.rank}
                                </div>
                                <div
                                  style={{
                                    fontSize: '0.9rem',
                                    fontWeight: 800,
                                    color: 'var(--text-primary)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {top.fullName}
                                </div>
                                {(top.employeeCode || top.departmentUnit) && (
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                    {[top.employeeCode, top.departmentUnit].filter(Boolean).join(' • ')}
                                  </div>
                                )}
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {top.attemptsCount} lượt • Chính xác {top.accuracyPercent}% • {formatDuration(top.durationMs)}
                                </div>
                              </div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)', flexShrink: 0 }}>
                                {top.highestScore.toLocaleString('vi-VN')} đ
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Bảng xếp hạng đầy đủ */}
                      {selectedGameReport.playLeaderboard.entries.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                          Chưa có người chơi nào hoàn thành lượt chơi để xếp hạng.
                        </div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table
                            data-testid="reports-play-leaderboard-table"
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
                                <th style={{ padding: '8px' }}>Người chơi</th>
                                <th style={{ padding: '8px' }}>Điểm cao nhất</th>
                                <th style={{ padding: '8px' }}>Số lượt</th>
                                <th style={{ padding: '8px' }}>Độ chính xác</th>
                                <th style={{ padding: '8px' }}>Thời gian</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Thao tác</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedGameReport.playLeaderboard.entries.map((entry) => (
                                <tr
                                  key={entry.playerKey}
                                  data-testid={`play-leaderboard-row-${entry.rank}`}
                                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                                >
                                  <td style={{ padding: '8px', fontWeight: 800 }}>#{entry.rank}</td>
                                  <td style={{ padding: '8px' }}>
                                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{entry.fullName}</div>
                                    {(entry.employeeCode || entry.departmentUnit) && (
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {[entry.employeeCode, entry.departmentUnit].filter(Boolean).join(' • ')}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ padding: '8px', fontWeight: 800, color: 'var(--primary)' }}>
                                    {entry.highestScore.toLocaleString('vi-VN')} đ
                                  </td>
                                  <td style={{ padding: '8px' }}>
                                    {entry.allowedAttempts !== null
                                      ? `${entry.usedAttempts}/${entry.allowedAttempts} lượt (Tổng ${entry.attemptsCount})`
                                      : `${entry.attemptsCount} lượt`}
                                  </td>
                                  <td style={{ padding: '8px' }}>
                                    {entry.correctAnswers}/{entry.totalQuestions} câu ({entry.accuracyPercent}%)
                                  </td>
                                  <td style={{ padding: '8px' }}>{formatDuration(entry.durationMs)}</td>
                                  <td style={{ padding: '8px', textAlign: 'right' }}>
                                    {entry.participantId ? (
                                      <button
                                        type="button"
                                        data-testid={`grant-retake-btn-${entry.participantId}`}
                                        onClick={() =>
                                          handleOpenGrantRetakeModal({
                                            gameId: selectedGameReport.gameId,
                                            participantId: entry.participantId!,
                                            fullName: entry.fullName,
                                            departmentUnit: entry.departmentUnit,
                                            employeeCode: entry.employeeCode,
                                            usedAttempts: entry.usedAttempts,
                                            allowedAttempts: entry.allowedAttempts ?? 1,
                                          })
                                        }
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
                                        + Cấp thêm lượt
                                      </button>
                                    ) : (
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                        Tự do (Không giới hạn)
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* C. Lịch sử từng lượt chơi (Per-Play History) */}
                    <div
                      data-testid="reports-play-attempts-history"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        Lịch sử từng lượt chơi ({selectedGameReport.playAttemptsHistory.length} lượt)
                      </h4>

                      {selectedGameReport.playAttemptsHistory.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                          Chưa có lượt chơi nào phát sinh cho game này.
                        </div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table
                            data-testid="reports-play-attempts-table"
                            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '680px' }}
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
                                <th style={{ padding: '8px' }}>Lần chơi</th>
                                <th style={{ padding: '8px' }}>Người chơi</th>
                                <th style={{ padding: '8px' }}>Hình thức</th>
                                <th style={{ padding: '8px' }}>Thời gian chơi</th>
                                <th style={{ padding: '8px' }}>Điểm đạt được</th>
                                <th style={{ padding: '8px' }}>Số câu đúng / sai</th>
                                <th style={{ padding: '8px' }}>Trạng thái</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Thao tác</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedGameReport.playAttemptsHistory.map((att) => {
                                const statusText =
                                  att.status === 'COMPLETED' || att.status === 'AUTO_SUBMITTED'
                                    ? 'Hoàn thành'
                                    : att.status === 'ABANDONED'
                                      ? 'Bỏ dở'
                                      : 'Đang chơi';
                                return (
                                  <tr
                                    key={att.attemptId}
                                    data-testid={`play-attempt-row-${att.attemptId}`}
                                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                                  >
                                    <td style={{ padding: '8px', fontWeight: 700 }}>Lần {att.attemptNumber}</td>
                                    <td style={{ padding: '8px' }}>
                                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {att.playerName}
                                      </div>
                                      {(att.employeeCode || att.departmentUnit) && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                          {[att.employeeCode, att.departmentUnit].filter(Boolean).join(' • ')}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                      {att.deliveryMode === 'MULTIPLAYER'
                                        ? `Multiplayer${att.roomCode ? ` (PIN ${att.roomCode})` : ''}`
                                        : 'Solo'}
                                    </td>
                                    <td style={{ padding: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                      <div>{new Date(att.finishedAt || att.startedAt).toLocaleString('vi-VN')}</div>
                                      <div>Thời lượng: {formatDuration(att.durationMs)}</div>
                                    </td>
                                    <td style={{ padding: '8px', fontWeight: 800, color: 'var(--primary)' }}>
                                      {att.score.toLocaleString('vi-VN')} đ
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                      <span style={{ color: 'var(--accent-emerald)', fontWeight: 700 }}>
                                        {att.correctAnswers} đúng
                                      </span>{' '}
                                      /{' '}
                                      <span style={{ color: 'var(--accent-rose)', fontWeight: 700 }}>
                                        {att.wrongAnswers} sai
                                      </span>{' '}
                                      ({att.totalQuestions} câu)
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                      <span
                                        style={{
                                          padding: '2px 7px',
                                          borderRadius: '6px',
                                          fontSize: '0.72rem',
                                          fontWeight: 700,
                                          backgroundColor:
                                            att.status === 'COMPLETED' || att.status === 'AUTO_SUBMITTED'
                                              ? 'rgba(16, 185, 129, 0.14)'
                                              : att.status === 'ABANDONED'
                                                ? 'rgba(239, 68, 68, 0.12)'
                                                : 'rgba(14, 165, 233, 0.14)',
                                          color:
                                            att.status === 'COMPLETED' || att.status === 'AUTO_SUBMITTED'
                                              ? 'var(--accent-emerald)'
                                              : att.status === 'ABANDONED'
                                                ? 'var(--accent-rose)'
                                                : 'var(--accent-sky)',
                                        }}
                                      >
                                        {statusText}
                                      </span>
                                    </td>
                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                      {att.questionBreakdown && att.questionBreakdown.length > 0 && (
                                        <button
                                          type="button"
                                          data-testid={`play-attempt-detail-btn-${att.attemptId}`}
                                          onClick={() =>
                                            setPlayAttemptBreakdownModal({
                                              attemptNumber: att.attemptNumber,
                                              playerName: att.playerName,
                                              score: att.score,
                                              correctAnswers: att.correctAnswers,
                                              wrongAnswers: att.wrongAnswers,
                                              totalQuestions: att.totalQuestions,
                                              durationMs: att.durationMs,
                                              questionBreakdown: att.questionBreakdown,
                                            })
                                          }
                                          style={{
                                            padding: '8px 12px',
                                            minHeight: '44px',
                                            minWidth: '44px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-strong)',
                                            backgroundColor: 'var(--bg-subtle)',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.75rem',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          Xem lượt chơi
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* D. Cấp thêm lượt cho PLAY */}
                    <div
                      data-testid="reports-play-retake-section"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        Quản lý giới hạn lượt chơi & Cấp thêm lượt (PLAY)
                      </h4>
                      <p
                        data-testid="play-retake-policy-note"
                        style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}
                      >
                        {selectedGameReport.playOverview.attemptLimitPolicyNote}
                      </p>

                      {selectedGameReport.rosterParticipants.length > 0 && (
                        <div style={{ overflowX: 'auto', marginTop: '4px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '560px' }}>
                            <thead>
                              <tr
                                style={{
                                  borderBottom: '1px solid var(--border-subtle)',
                                  color: 'var(--text-secondary)',
                                  textAlign: 'left',
                                  fontSize: '0.73rem',
                                }}
                              >
                                <th style={{ padding: '8px' }}>Người chơi định danh</th>
                                <th style={{ padding: '8px' }}>Lượt đã dùng / Được phép</th>
                                <th style={{ padding: '8px' }}>Đã cấp thêm</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Thao tác</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedGameReport.rosterParticipants.map((rp) => (
                                <tr key={rp.participantId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                  <td style={{ padding: '8px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {rp.fullName}
                                    {(rp.employeeCode || rp.departmentUnit) && (
                                      <span style={{ marginLeft: '6px', fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                        ({[rp.employeeCode, rp.departmentUnit].filter(Boolean).join(' • ')})
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '8px', fontWeight: 700 }}>
                                    {rp.usedAttempts ?? 0} / {rp.allowedAttempts ?? 1} lượt
                                  </td>
                                  <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>
                                    {(rp.retakeGrantedCount ?? 0) > 0 ? `+${rp.retakeGrantedCount} lượt` : '—'}
                                  </td>
                                  <td style={{ padding: '8px', textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      data-testid={`play-roster-grant-retake-btn-${rp.participantId}`}
                                      onClick={() =>
                                        handleOpenGrantRetakeModal({
                                          gameId: selectedGameReport.gameId,
                                          participantId: rp.participantId,
                                          fullName: rp.fullName,
                                          departmentUnit: rp.departmentUnit,
                                          employeeCode: rp.employeeCode,
                                          usedAttempts: rp.usedAttempts ?? 0,
                                          allowedAttempts: rp.allowedAttempts ?? 1,
                                        })
                                      }
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
                                      + Cấp thêm lượt
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* =========================================================
                     CHẾ ĐỘ EXAM: DANH SÁCH ĐỢT THI, CHI TIẾT TỪNG ĐỢT, LỊCH SỬ NHIỀU LẦN THI & CẤP THÊM LƯỢT
                     ========================================================= */
                  <div
                    data-testid="reports-exam-detail-view"
                    style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}
                  >
                    {/* A. Danh sách các đợt thi (Đợt 1, Đợt 2...) */}
                    <div
                      data-testid="reports-exam-batches-list"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                          Danh sách các đợt thi ({selectedGameReport.examBatches.length} đợt)
                        </h4>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                          Ngưỡng đạt: <strong>&ge; {selectedGameReport.passThresholdPercent}%</strong> • Chính sách tính điểm:{' '}
                          <strong>
                            {selectedGameReport.officialAttemptPolicy === 'HIGHEST_SCORE'
                              ? 'Lần điểm cao nhất'
                              : 'Lần nộp gần nhất'}
                          </strong>
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                          gap: '10px',
                        }}
                      >
                        {selectedGameReport.examBatches.map((batch: ReportsExamBatchItem) => {
                          const isSelectedBatch = selectedExamBatchId === batch.batchId;
                          return (
                            <div
                              key={batch.batchId}
                              data-testid={`exam-batch-card-${batch.batchId}`}
                              style={{
                                padding: '12px 14px',
                                borderRadius: '10px',
                                border: isSelectedBatch
                                  ? '2px solid var(--primary)'
                                  : '1px solid var(--border-subtle)',
                                backgroundColor: isSelectedBatch ? 'var(--primary-subtle)' : 'var(--bg-subtle)',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                gap: '8px',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                <div>
                                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                    {batch.batchName}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    Mở: {new Date(batch.openedAt).toLocaleString('vi-VN')}
                                  </div>
                                </div>
                                <span
                                  style={{
                                    padding: '2px 7px',
                                    borderRadius: '6px',
                                    fontSize: '0.7rem',
                                    fontWeight: 800,
                                    backgroundColor:
                                      batch.status === 'OPEN'
                                        ? 'rgba(16, 185, 129, 0.15)'
                                        : 'rgba(239, 68, 68, 0.12)',
                                    color:
                                      batch.status === 'OPEN' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                                  }}
                                >
                                  {batch.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}
                                </span>
                              </div>

                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                <span>
                                  Đã thi: <strong>{batch.completedCount}/{batch.totalParticipants}</strong>
                                </span>
                                <span>•</span>
                                <span>
                                  Tổng lượt: <strong>{batch.totalAttempts}</strong>
                                </span>
                                <span>•</span>
                                <span style={{ color: 'var(--accent-emerald)', fontWeight: 700 }}>
                                  {batch.passedCount} Đạt
                                </span>
                                <span>/</span>
                                <span style={{ color: 'var(--accent-rose)', fontWeight: 700 }}>
                                  {batch.failedCount} Chưa đạt
                                </span>
                              </div>

                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  data-testid={`select-exam-batch-${batch.batchId}`}
                                  onClick={() => setSelectedExamBatchId(batch.batchId)}
                                  style={{
                                    flex: '1 1 auto',
                                    padding: '8px 12px',
                                    minHeight: '44px',
                                    minWidth: '44px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--primary)',
                                    backgroundColor: isSelectedBatch ? 'var(--primary)' : 'var(--bg-surface)',
                                    color: isSelectedBatch ? 'var(--primary-ink, #060913)' : 'var(--primary)',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {isSelectedBatch ? 'Đang xem đợt này' : 'Xem chi tiết đợt'}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`view-batch-qr-btn-${batch.batchId}`}
                                  onClick={() => handleOpenBatchQrModal(batch)}
                                  style={{
                                    padding: '8px 12px',
                                    minHeight: '44px',
                                    minWidth: '44px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-strong)',
                                    backgroundColor: 'var(--bg-surface)',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '5px',
                                  }}
                                >
                                  <QrCodeIcon size={14} />
                                  <span>Xem mã QR</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {selectedGameReport.examBatches.length > 1 && (
                          <div
                            data-testid="exam-batch-card-all"
                            style={{
                              padding: '12px 14px',
                              borderRadius: '10px',
                              border:
                                selectedExamBatchId === 'ALL'
                                  ? '2px solid var(--primary)'
                                  : '1px solid var(--border-subtle)',
                              backgroundColor:
                                selectedExamBatchId === 'ALL' ? 'var(--primary-subtle)' : 'var(--bg-subtle)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              gap: '8px',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                Tổng hợp tất cả các đợt
                              </div>
                              <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                Tổng lượt làm bài: <strong>{selectedGameReport.examOverallBatch.totalAttempts}</strong> • Đạt:{' '}
                                <strong>{selectedGameReport.examOverallBatch.passedCount}</strong> / Chưa đạt:{' '}
                                <strong>{selectedGameReport.examOverallBatch.failedCount}</strong>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-testid="select-exam-batch-ALL"
                              onClick={() => setSelectedExamBatchId('ALL')}
                              style={{
                                padding: '8px 12px',
                                minHeight: '44px',
                                minWidth: '44px',
                                borderRadius: '6px',
                                border: '1px solid var(--primary)',
                                backgroundColor:
                                  selectedExamBatchId === 'ALL' ? 'var(--primary)' : 'var(--bg-surface)',
                                color:
                                  selectedExamBatchId === 'ALL'
                                    ? 'var(--primary-ink, #060913)'
                                    : 'var(--primary)',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {selectedExamBatchId === 'ALL' ? 'Đang xem tổng hợp' : 'Xem tất cả các đợt'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* B. Chi tiết từng đợt thi & Bảng kết quả thí sinh */}
                    {(() => {
                      const activeBatch: ReportsExamBatchItem =
                        selectedExamBatchId === 'ALL'
                          ? selectedGameReport.examOverallBatch
                          : selectedGameReport.examBatches.find((b) => b.batchId === selectedExamBatchId) ||
                            selectedGameReport.examBatches[selectedGameReport.examBatches.length - 1] ||
                            selectedGameReport.examOverallBatch;

                      const qSearch = examParticipantSearch.trim().toLowerCase();
                      const filteredParticipants = activeBatch.participants.filter((p) => {
                        if (qSearch) {
                          const hay = `${p.fullName} ${p.employeeCode} ${p.departmentUnit}`.toLowerCase();
                          if (!hay.includes(qSearch)) return false;
                        }
                        if (examParticipantFilter === 'COMPLETED') {
                          return p.status === 'COMPLETED' || p.status === 'AUTO_SUBMITTED';
                        }
                        if (examParticipantFilter === 'PENDING') {
                          return p.status === 'PENDING';
                        }
                        if (examParticipantFilter === 'IN_PROGRESS') {
                          return p.status === 'IN_PROGRESS';
                        }
                        if (examParticipantFilter === 'ABANDONED') {
                          return p.status === 'ABANDONED';
                        }
                        if (examParticipantFilter === 'PASSED') {
                          return p.isPassed === true;
                        }
                        if (examParticipantFilter === 'FAILED') {
                          return p.isPassed === false;
                        }
                        return true;
                      });

                      return (
                        <div
                          data-testid="reports-exam-batch-detail"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '10px',
                            padding: '16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '14px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              flexWrap: 'wrap',
                              gap: '10px',
                            }}
                          >
                            <div>
                              <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                Chi tiết: {activeBatch.batchName}
                              </h4>
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                                Mở lúc: <strong>{new Date(activeBatch.openedAt).toLocaleString('vi-VN')}</strong>
                                {activeBatch.closedAt
                                  ? ` • Kết thúc: ${new Date(activeBatch.closedAt).toLocaleString('vi-VN')}`
                                  : ''}{' '}
                                • Trạng thái:{' '}
                                <strong>{activeBatch.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}</strong>
                              </div>
                            </div>
                          </div>

                          {/* 6 chỉ số tổng quan của đợt thi */}
                          <div
                            data-testid="exam-batch-kpis"
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 145px), 1fr))',
                              gap: '10px',
                            }}
                          >
                            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Tổng thí sinh</div>
                              <div data-testid="exam-batch-total-participants" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                                {activeBatch.totalParticipants}
                              </div>
                            </div>
                            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Đã thi / Chưa thi</div>
                              <div data-testid="exam-batch-completed-pending" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-sky)', marginTop: '2px' }}>
                                {activeBatch.completedCount} / {activeBatch.pendingCount}
                              </div>
                            </div>
                            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Số thí sinh Đạt</div>
                              <div data-testid="exam-batch-passed-count" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-emerald)', marginTop: '2px' }}>
                                {activeBatch.passedCount}
                              </div>
                            </div>
                            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Số Chưa đạt</div>
                              <div data-testid="exam-batch-failed-count" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-rose)', marginTop: '2px' }}>
                                {activeBatch.failedCount}
                              </div>
                            </div>
                            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Điểm trung bình</div>
                              <div data-testid="exam-batch-avg-score" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-amber)', marginTop: '2px' }}>
                                {activeBatch.averageScore.toLocaleString('vi-VN')} đ
                              </div>
                            </div>
                            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Điểm cao nhất</div>
                              <div data-testid="exam-batch-highest-score" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--primary)', marginTop: '2px' }}>
                                {activeBatch.highestScore.toLocaleString('vi-VN')} đ
                              </div>
                            </div>
                          </div>

                          {/* Bộ lọc thí sinh trong đợt */}
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '8px',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {(
                                [
                                  { key: 'ALL', label: 'Tất cả' },
                                  { key: 'COMPLETED', label: 'Hoàn thành' },
                                  { key: 'PENDING', label: 'Chưa thi' },
                                  { key: 'IN_PROGRESS', label: 'Đang thi' },
                                  { key: 'ABANDONED', label: 'Bỏ dở' },
                                  { key: 'PASSED', label: 'Đạt' },
                                  { key: 'FAILED', label: 'Chưa đạt' },
                                ] as const
                              ).map((f) => {
                                const active = examParticipantFilter === f.key;
                                return (
                                  <button
                                    key={f.key}
                                    type="button"
                                    data-testid={`exam-participant-filter-${f.key.toLowerCase()}`}
                                    onClick={() => setExamParticipantFilter(f.key)}
                                    style={{
                                      padding: '6px 11px',
                                      minHeight: '44px',
                                      minWidth: '44px',
                                      borderRadius: '6px',
                                      fontSize: '0.75rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      border: active
                                        ? '1px solid var(--primary)'
                                        : '1px solid var(--border-strong)',
                                      backgroundColor: active ? 'var(--primary)' : 'var(--bg-subtle)',
                                      color: active ? 'var(--primary-ink, #060913)' : 'var(--text-primary)',
                                    }}
                                  >
                                    {f.label}
                                  </button>
                                );
                              })}
                            </div>

                            <input
                              type="search"
                              data-testid="exam-participant-search-input"
                              value={examParticipantSearch}
                              onChange={(e) => setExamParticipantSearch(e.target.value)}
                              placeholder="Tìm thí sinh theo tên, mã NV, phòng ban..."
                              style={{
                                padding: '8px 12px',
                                minHeight: '44px',
                                borderRadius: '7px',
                                border: '1px solid var(--border-strong)',
                                backgroundColor: 'var(--bg-subtle)',
                                color: 'var(--text-primary)',
                                fontSize: '0.78rem',
                                minWidth: 'min(100%, 220px)',
                              }}
                            />
                          </div>

                          {/* Bảng kết quả thí sinh: | Thí sinh | Lượt | Điểm | Kết quả | Trạng thái | Thao tác | */}
                          {filteredParticipants.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                              Không có thí sinh nào phù hợp với bộ lọc trong đợt thi này.
                            </div>
                          ) : (
                            <div style={{ overflowX: 'auto' }}>
                              <table
                                data-testid="reports-exam-participants-table"
                                style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '720px' }}
                              >
                                <thead>
                                  <tr
                                    style={{
                                      borderBottom: '1px solid var(--border-subtle)',
                                      color: 'var(--text-secondary)',
                                      textAlign: 'left',
                                      fontSize: '0.74rem',
                                    }}
                                  >
                                    <th style={{ padding: '9px 8px' }}>Thí sinh</th>
                                    <th style={{ padding: '9px 8px' }}>Lượt</th>
                                    <th style={{ padding: '9px 8px' }}>Điểm</th>
                                    <th style={{ padding: '9px 8px' }}>Kết quả</th>
                                    <th style={{ padding: '9px 8px' }}>Trạng thái</th>
                                    <th style={{ padding: '9px 8px', textAlign: 'right' }}>Thao tác</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredParticipants.map((p, idx) => {
                                    const rowKey = p.participantId || `${p.fullName}-${idx}`;
                                    const statusText =
                                      p.status === 'COMPLETED' || p.status === 'AUTO_SUBMITTED'
                                        ? 'Hoàn thành'
                                        : p.status === 'IN_PROGRESS'
                                          ? 'Đang thi'
                                          : p.status === 'ABANDONED'
                                            ? 'Bỏ dở'
                                            : 'Chưa thi';
                                    const resultText =
                                      p.isPassed === true ? 'Đạt' : p.isPassed === false ? 'Chưa đạt' : '—';

                                    return (
                                      <tr
                                        key={rowKey}
                                        data-testid={`exam-participant-row-${p.participantId || idx}`}
                                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                                      >
                                        <td style={{ padding: '10px 8px' }}>
                                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                            {p.fullName}
                                          </div>
                                          {(p.employeeCode || p.departmentUnit) && (
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                              {[p.employeeCode, p.departmentUnit].filter(Boolean).join(' • ')}
                                            </div>
                                          )}
                                        </td>

                                        <td
                                          data-testid={`exam-participant-attempts-cell-${p.participantId || idx}`}
                                          style={{ padding: '10px 8px', fontVariantNumeric: 'tabular-nums' }}
                                        >
                                          <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                                            {p.usedAttempts}/{p.allowedAttempts}
                                          </div>
                                          {p.retakeGrantedCount > 0 && (
                                            <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700 }}>
                                              +{p.retakeGrantedCount} lượt cấp thêm
                                            </div>
                                          )}
                                        </td>

                                        <td
                                          data-testid={`exam-participant-score-cell-${p.participantId || idx}`}
                                          style={{ padding: '10px 8px', fontVariantNumeric: 'tabular-nums' }}
                                        >
                                          {p.score !== null ? (
                                            <div>
                                              <strong style={{ color: 'var(--primary)', fontSize: '0.88rem' }}>
                                                {p.score.toLocaleString('vi-VN')} đ
                                              </strong>
                                              <div style={{ fontSize: '0.71rem', color: 'var(--text-secondary)' }}>
                                                {p.correctAnswers}/{p.totalQuestions} câu ({p.accuracyPercent ?? 0}%)
                                                {p.officialAttemptNumber ? ` • Lần ${p.officialAttemptNumber}` : ''}
                                              </div>
                                            </div>
                                          ) : (
                                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                                          )}
                                        </td>

                                        <td
                                          data-testid={`exam-participant-result-cell-${p.participantId || idx}`}
                                          style={{ padding: '10px 8px' }}
                                        >
                                          {p.isPassed === true ? (
                                            <span
                                              style={{
                                                padding: '3px 8px',
                                                borderRadius: '6px',
                                                fontSize: '0.72rem',
                                                fontWeight: 800,
                                                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                                color: 'var(--accent-emerald)',
                                              }}
                                            >
                                              {resultText}
                                            </span>
                                          ) : p.isPassed === false ? (
                                            <span
                                              style={{
                                                padding: '3px 8px',
                                                borderRadius: '6px',
                                                fontSize: '0.72rem',
                                                fontWeight: 800,
                                                backgroundColor: 'rgba(239, 68, 68, 0.14)',
                                                color: 'var(--accent-rose)',
                                              }}
                                            >
                                              {resultText}
                                            </span>
                                          ) : (
                                            <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>—</span>
                                          )}
                                        </td>

                                        <td
                                          data-testid={`exam-participant-status-cell-${p.participantId || idx}`}
                                          style={{ padding: '10px 8px' }}
                                        >
                                          <span
                                            style={{
                                              padding: '3px 8px',
                                              borderRadius: '6px',
                                              fontSize: '0.72rem',
                                              fontWeight: 700,
                                              backgroundColor:
                                                p.status === 'COMPLETED' || p.status === 'AUTO_SUBMITTED'
                                                  ? 'rgba(16, 185, 129, 0.12)'
                                                  : p.status === 'IN_PROGRESS'
                                                    ? 'rgba(14, 165, 233, 0.14)'
                                                    : p.status === 'ABANDONED'
                                                      ? 'rgba(239, 68, 68, 0.12)'
                                                      : 'var(--bg-subtle)',
                                              color:
                                                p.status === 'COMPLETED' || p.status === 'AUTO_SUBMITTED'
                                                  ? 'var(--accent-emerald)'
                                                  : p.status === 'IN_PROGRESS'
                                                    ? 'var(--accent-sky)'
                                                    : p.status === 'ABANDONED'
                                                      ? 'var(--accent-rose)'
                                                      : 'var(--text-secondary)',
                                              border: '1px solid var(--border-subtle)',
                                            }}
                                          >
                                            {statusText}
                                          </span>
                                        </td>

                                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                          <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <button
                                              type="button"
                                              data-testid={`view-participant-attempts-btn-${p.participantId || idx}`}
                                              onClick={() => {
                                                setParticipantAttemptsModal(p);
                                                setExpandedAttemptIdInModal(
                                                  p.attempts.length > 0 ? p.attempts[p.attempts.length - 1].attemptId : null
                                                );
                                              }}
                                              style={{
                                                padding: '8px 12px',
                                                minHeight: '44px',
                                                minWidth: '44px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--border-strong)',
                                                backgroundColor: 'var(--bg-subtle)',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.74rem',
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                              }}
                                            >
                                              Xem các lần thi ({p.attempts.length})
                                            </button>

                                            {p.participantId && (
                                              <button
                                                type="button"
                                                data-testid={`grant-retake-btn-${p.participantId}`}
                                                onClick={() =>
                                                  handleOpenGrantRetakeModal({
                                                    gameId: selectedGameReport.gameId,
                                                    participantId: p.participantId!,
                                                    fullName: p.fullName,
                                                    departmentUnit: p.departmentUnit,
                                                    employeeCode: p.employeeCode,
                                                    usedAttempts: p.usedAttempts,
                                                    allowedAttempts: p.allowedAttempts,
                                                  })
                                                }
                                                style={{
                                                  padding: '8px 12px',
                                                  minHeight: '44px',
                                                  minWidth: '44px',
                                                  borderRadius: '6px',
                                                  border: '1px solid var(--primary)',
                                                  backgroundColor: 'var(--primary-subtle)',
                                                  color: 'var(--primary)',
                                                  fontSize: '0.74rem',
                                                  fontWeight: 800,
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                + Cấp thêm lượt
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          {/* 1. Header Reports */}
          <header
            data-testid="reports-overview-header"
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
                  padding: '8px 14px',
                  minHeight: '44px',
                  minWidth: '44px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Thử lại
              </button>
            </div>
          )}

          {/* 2. KPI tổng quan: Tổng game, Tổng lượt chơi, Lượt chơi hoàn thành, Điểm trung bình */}
          <section
            data-testid="reports-overview-kpis"
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

          {/* 3. Các biểu đồ thống kê hiện có */}
          <div
            data-testid="reports-overview-charts"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              minWidth: 0,
            }}
          >
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
                  minHeight: '44px',
                  minWidth: '44px',
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
                  minHeight: '44px',
                  minWidth: '44px',
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
                  minHeight: '44px',
                  minWidth: '44px',
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
                  minHeight: '44px',
                  minWidth: '44px',
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
        </>
      )}
          </div>

          {/* 4. Danh sách Game trong Thư viện & Quản lý Lượt Chơi / Thi */}
          <section
            data-testid="reports-v2-game-hub"
            aria-label="Trung tâm Thống kê Game, Bảng xếp hạng, Đợt thi và Quản lý Lượt"
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
              <div style={{ minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.08rem',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <TrophyIcon size={18} />
                  <span>Danh sách Game trong Thư viện & Quản lý Lượt Chơi / Thi</span>
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Tự động đẩy game vừa có hoạt động chơi/thi mới nhất lên đầu. Bấm vào game hoặc bấm <strong>Xem chi tiết</strong> để mở màn hình báo cáo riêng cho từng game.
                </p>
              </div>

              <div
                data-testid="reports-games-sort-badge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-subtle)',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <span>
                  Thư viện: <strong style={{ color: 'var(--text-primary)' }}>{reportsGamesData?.summary.totalGames ?? 0}</strong> game
                </span>
                <span>•</span>
                <span>
                  Chơi: <strong style={{ color: 'var(--accent-emerald)' }}>{reportsGamesData?.summary.playGamesCount ?? 0}</strong>
                </span>
                <span>•</span>
                <span>
                  Thi: <strong style={{ color: 'var(--accent-amber)' }}>{reportsGamesData?.summary.examGamesCount ?? 0}</strong>
                </span>
                <span>•</span>
                <span style={{ color: 'var(--primary)' }}>Sắp xếp: Hoạt động mới nhất lên đầu</span>
              </div>
            </div>

            {/* Bộ lọc chế độ & Tìm kiếm game trong Thư viện */}
            <div
              data-testid="reports-games-filter-bar"
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
              <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginRight: '2px' }}>
                  Loại chế độ:
                </span>
                {(
                  [
                    { key: 'ALL', label: 'Tất cả game' },
                    { key: 'PLAY', label: 'Chế độ Chơi (PLAY)' },
                    { key: 'EXAM', label: 'Chế độ Thi (EXAM)' },
                  ] as const
                ).map((opt) => {
                  const active = reportsGameModeFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`reports-game-filter-${opt.key.toLowerCase()}`}
                      onClick={() => {
                        setReportsGameModeFilter(opt.key);
                        setReportsGamePage(1);
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

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  alignItems: 'center',
                  flex: '1 1 220px',
                  minWidth: 0,
                  maxWidth: '100%',
                  justifyContent: 'flex-end',
                }}
              >
                <input
                  type="search"
                  data-testid="reports-game-search-input"
                  value={reportsGameSearch}
                  onChange={(e) => {
                    setReportsGameSearch(e.target.value);
                    setReportsGamePage(1);
                  }}
                  placeholder="Tìm theo tên game trong Thư viện..."
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
              </div>
            </div>

            {/* Danh sách Game trong Thư viện được sắp theo lastActivityAt DESC NULLS LAST */}
            {reportsGamesLoading ? (
              <div
                data-testid="reports-games-loading"
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Đang tải danh sách game trong Thư viện...
              </div>
            ) : reportsGamesError ? (
              <div
                data-testid="reports-games-error"
                role="alert"
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--accent-rose)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>{reportsGamesError}</span>
                <button
                  type="button"
                  onClick={() => loadReportsGamesOverview()}
                  style={{
                    padding: '8px 14px',
                    minHeight: '44px',
                    minWidth: '44px',
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
            ) : !reportsGamesData || reportsGamesData.games.length === 0 ? (
              <div
                data-testid="reports-games-empty"
                style={{
                  padding: '28px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  borderRadius: '10px',
                  border: '1px dashed var(--border-subtle)',
                  fontSize: '0.85rem',
                }}
              >
                Chưa có game nào trong Thư viện phù hợp với bộ lọc hiện tại.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', width: '100%' }}>
                <table
                  data-testid="reports-games-table"
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
                      <th style={{ padding: '10px 8px' }}>Loại chế độ</th>
                      <th style={{ padding: '10px 8px' }}>Người chơi / Thí sinh</th>
                      <th style={{ padding: '10px 8px' }}>Tổng lượt chơi / thi</th>
                      <th style={{ padding: '10px 8px' }}>Hoạt động gần nhất</th>
                      <th style={{ padding: '10px 8px' }}>Trạng thái phiên / đợt</th>
                      <th style={{ padding: '10px 8px', textAlign: 'right' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportsGamesData.games.map((g: ReportsGameOverviewItem) => {
                      const isExam = g.sessionMode === 'EXAM';
                      const activeRoomCodes = (g.activeStatus?.activeRooms || []).map((r) => r.roomCode);
                      const activeSoloCount = g.activeStatus?.activeSessionCount || 0;
                      const hasLiveActivity = activeRoomCodes.length > 0 || activeSoloCount > 0;
                      return (
                        <tr
                          key={g.gameId}
                          data-testid={`reports-game-row-${g.gameId}`}
                          onClick={() => handleOpenGameReportsDetail(g.gameId, false)}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                          }}
                        >
                          <td style={{ padding: '12px 8px', fontWeight: 700, color: 'var(--text-primary)' }}>
                            <div>{g.title}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, marginTop: '2px' }}>
                              {g.questionCount} câu hỏi • {g.rosterMode === 'PRECONFIGURED' ? 'Danh sách định danh' : 'Nhập tên tự do'}
                            </div>
                          </td>
                          <td style={{ padding: '12px 8px' }}>
                            <span
                              data-testid={`reports-game-mode-badge-${g.gameId}`}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '999px',
                                fontSize: '0.71rem',
                                fontWeight: 800,
                                backgroundColor: isExam ? 'rgba(245, 158, 11, 0.16)' : 'rgba(16, 185, 129, 0.15)',
                                color: isExam ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                              }}
                            >
                              {isExam ? 'THI (EXAM)' : 'CHƠI (PLAY)'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 8px', fontVariantNumeric: 'tabular-nums' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                              {g.participantCount} {isExam ? 'thí sinh' : 'người chơi'}
                            </div>
                            {g.rosterCount > 0 && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                Danh sách: {g.rosterCount} người
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', fontVariantNumeric: 'tabular-nums' }}>
                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                              {g.totalAttempts} lượt
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                              {g.completedAttempts} hoàn thành
                              {isExam && g.completedAttempts > 0
                                ? ` • ${g.passedCount} Đạt / ${g.failedCount} Chưa đạt`
                                : g.highestScore > 0
                                  ? ` • Cao nhất: ${g.highestScore.toLocaleString('vi-VN')} đ`
                                  : ''}
                            </div>
                          </td>
                          <td
                            data-testid={`reports-game-last-activity-${g.gameId}`}
                            style={{ padding: '12px 8px', fontSize: '0.76rem', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {g.lastActivityAt ? (
                              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                {new Date(g.lastActivityAt).toLocaleString('vi-VN')}
                              </span>
                            ) : (
                              <span
                                data-testid={`reports-game-no-activity-${g.gameId}`}
                                style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}
                              >
                                Chưa có lịch sử chơi/thi
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              {isExam ? (
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.71rem',
                                    fontWeight: 700,
                                    backgroundColor:
                                      g.examStatus === 'CLOSED'
                                        ? 'rgba(239, 68, 68, 0.12)'
                                        : 'rgba(16, 185, 129, 0.14)',
                                    color:
                                      g.examStatus === 'CLOSED' ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                                  }}
                                >
                                  {g.examStatus === 'CLOSED' ? 'Đợt thi đã đóng' : 'Đợt thi đang mở'}
                                </span>
                              ) : (
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.71rem',
                                    fontWeight: 700,
                                    backgroundColor: hasLiveActivity
                                      ? 'rgba(14, 165, 233, 0.14)'
                                      : 'var(--bg-subtle)',
                                    color: hasLiveActivity ? 'var(--accent-sky)' : 'var(--text-secondary)',
                                    border: '1px solid var(--border-subtle)',
                                  }}
                                >
                                  {hasLiveActivity ? 'Đang có phiên chơi' : 'Sẵn sàng'}
                                </span>
                              )}
                              {activeRoomCodes.length > 0 && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary)' }}>
                                  PIN: {activeRoomCodes.join(', ')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                            <button
                              type="button"
                              data-testid={`reports-game-detail-btn-${g.gameId}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenGameReportsDetail(g.gameId, false);
                              }}
                              style={{
                                padding: '8px 14px',
                                minHeight: '44px',
                                minWidth: '44px',
                                borderRadius: '7px',
                                border: '1px solid var(--primary)',
                                backgroundColor: 'var(--primary-subtle)',
                                color: 'var(--primary)',
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              Xem chi tiết
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Phân trang danh sách game trong Thư viện */}
            {reportsGamesData && reportsGamesData.total > reportsGameLimit && (
              <div
                data-testid="reports-games-pagination"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  paddingTop: '6px',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>
                  Trang {reportsGamePage} / {Math.max(1, Math.ceil(reportsGamesData.total / reportsGameLimit))}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    disabled={reportsGamePage <= 1}
                    onClick={() => setReportsGamePage((p) => Math.max(1, p - 1))}
                    style={{
                      padding: '8px 14px',
                      minHeight: '44px',
                      minWidth: '44px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      cursor: reportsGamePage <= 1 ? 'not-allowed' : 'pointer',
                      opacity: reportsGamePage <= 1 ? 0.5 : 1,
                    }}
                  >
                    Trang trước
                  </button>
                  <button
                    type="button"
                    disabled={reportsGamePage >= Math.ceil(reportsGamesData.total / reportsGameLimit)}
                    onClick={() => setReportsGamePage((p) => p + 1)}
                    style={{
                      padding: '8px 14px',
                      minHeight: '44px',
                      minWidth: '44px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      cursor:
                        reportsGamePage >= Math.ceil(reportsGamesData.total / reportsGameLimit)
                          ? 'not-allowed'
                          : 'pointer',
                      opacity:
                        reportsGamePage >= Math.ceil(reportsGamesData.total / reportsGameLimit) ? 0.5 : 1,
                    }}
                  >
                    Trang sau
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Modal 1: Lịch sử nhiều lần thi của một thí sinh (Lần 1, Lần 2, Lần 3...) */}
      {participantAttemptsModal && (
        <div
          data-testid="participant-attempts-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Lịch sử các lần thi của thí sinh"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            backgroundColor: 'rgba(6, 9, 19, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setParticipantAttemptsModal(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '880px',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
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
                paddingBottom: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Lịch sử các lần thi: {participantAttemptsModal.fullName}
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {[participantAttemptsModal.employeeCode, participantAttemptsModal.departmentUnit]
                    .filter(Boolean)
                    .join(' • ')}{' '}
                  • Lượt đã dùng:{' '}
                  <strong>
                    {participantAttemptsModal.usedAttempts}/{participantAttemptsModal.allowedAttempts}
                  </strong>
                  {participantAttemptsModal.retakeGrantedCount > 0
                    ? ` (Đã cấp thêm +${participantAttemptsModal.retakeGrantedCount} lượt)`
                    : ''}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {participantAttemptsModal.participantId && selectedGameReport && (
                  <button
                    type="button"
                    data-testid="modal-grant-retake-btn"
                    onClick={() =>
                      handleOpenGrantRetakeModal({
                        gameId: selectedGameReport.gameId,
                        participantId: participantAttemptsModal.participantId!,
                        fullName: participantAttemptsModal.fullName,
                        departmentUnit: participantAttemptsModal.departmentUnit,
                        employeeCode: participantAttemptsModal.employeeCode,
                        usedAttempts: participantAttemptsModal.usedAttempts,
                        allowedAttempts: participantAttemptsModal.allowedAttempts,
                      })
                    }
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
                    + Cấp thêm lượt thi
                  </button>
                )}
                <button
                  type="button"
                  data-testid="close-participant-attempts-modal"
                  onClick={() => setParticipantAttemptsModal(null)}
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
                  Đóng
                </button>
              </div>
            </div>

            {participantAttemptsModal.attempts.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Thí sinh này chưa thực hiện lần thi nào.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table
                    data-testid="participant-attempts-history-table"
                    style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '600px' }}
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
                        <th style={{ padding: '8px' }}>Lần thi</th>
                        <th style={{ padding: '8px' }}>Hình thức</th>
                        <th style={{ padding: '8px' }}>Điểm số</th>
                        <th style={{ padding: '8px' }}>Câu đúng / Tổng</th>
                        <th style={{ padding: '8px' }}>Kết quả</th>
                        <th style={{ padding: '8px' }}>Trạng thái</th>
                        <th style={{ padding: '8px' }}>Thời gian</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Chi tiết bài làm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participantAttemptsModal.attempts.map((att) => {
                        const isOfficial =
                          participantAttemptsModal.officialAttemptNumber === att.attemptNumber;
                        const isExpanded = expandedAttemptIdInModal === att.attemptId;
                        const statusLabel =
                          att.status === 'COMPLETED' || att.status === 'AUTO_SUBMITTED'
                            ? 'Hoàn thành'
                            : att.status === 'IN_PROGRESS'
                              ? 'Đang thi'
                              : 'Bỏ dở';
                        const resultLabel =
                          att.isPassed === true ? 'Đạt' : att.isPassed === false ? 'Chưa đạt' : '—';

                        return (
                          <tr
                            key={att.attemptId}
                            data-testid={`participant-attempt-row-${att.attemptNumber}`}
                            style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          >
                            <td style={{ padding: '8px', fontWeight: 800, color: 'var(--text-primary)' }}>
                              Lần {att.attemptNumber}
                              {isOfficial && (
                                <span
                                  style={{
                                    marginLeft: '6px',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    fontSize: '0.68rem',
                                    backgroundColor: 'var(--primary-subtle)',
                                    color: 'var(--primary)',
                                  }}
                                >
                                  Chính thức
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px' }}>
                              {att.deliveryMode === 'MULTIPLAYER'
                                ? `Phòng PIN ${att.roomCode || ''}`
                                : 'Cá nhân (Solo)'}
                            </td>
                            <td style={{ padding: '8px', fontWeight: 800, color: 'var(--primary)' }}>
                              {att.score.toLocaleString('vi-VN')} đ ({att.accuracyPercent}%)
                            </td>
                            <td style={{ padding: '8px' }}>
                              {att.correctAnswers}/{att.totalQuestions} câu
                            </td>
                            <td style={{ padding: '8px', fontWeight: 800 }}>
                              <span
                                style={{
                                  color:
                                    att.isPassed === true
                                      ? 'var(--accent-emerald)'
                                      : att.isPassed === false
                                        ? 'var(--accent-rose)'
                                        : 'var(--text-muted)',
                                }}
                              >
                                {resultLabel}
                              </span>
                            </td>
                            <td style={{ padding: '8px' }}>{statusLabel}</td>
                            <td style={{ padding: '8px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                              <div>{new Date(att.finishedAt || att.startedAt).toLocaleString('vi-VN')}</div>
                              <div>{formatDuration(att.durationMs)}</div>
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {att.questionBreakdown && att.questionBreakdown.length > 0 && (
                                <button
                                  type="button"
                                  data-testid={`toggle-attempt-questions-${att.attemptNumber}`}
                                  onClick={() =>
                                    setExpandedAttemptIdInModal(isExpanded ? null : att.attemptId)
                                  }
                                  style={{
                                    padding: '6px 11px',
                                    minHeight: '44px',
                                    minWidth: '44px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-strong)',
                                    backgroundColor: isExpanded ? 'var(--primary-subtle)' : 'var(--bg-subtle)',
                                    color: isExpanded ? 'var(--primary)' : 'var(--text-primary)',
                                    fontSize: '0.74rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {isExpanded ? 'Ẩn câu trả lời' : 'Xem câu trả lời'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Chi tiết câu trả lời của lần thi đang chọn */}
                {(() => {
                  const activeAtt = participantAttemptsModal.attempts.find(
                    (a) => a.attemptId === expandedAttemptIdInModal
                  );
                  if (!activeAtt || !activeAtt.questionBreakdown || activeAtt.questionBreakdown.length === 0) {
                    return null;
                  }
                  const canShowCorrectAnswer =
                    selectedGameReport?.sessionMode === 'EXAM' &&
                    Boolean(selectedGameReport?.answersPublished);
                  return (
                    <div
                      data-testid="expanded-attempt-questions-box"
                      style={{
                        padding: '14px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        Chi tiết bài làm Lần {activeAtt.attemptNumber} ({activeAtt.score.toLocaleString('vi-VN')} đ)
                      </h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: '520px' }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: '1px solid var(--border-subtle)',
                                color: 'var(--text-secondary)',
                                textAlign: 'left',
                              }}
                            >
                              <th style={{ padding: '6px' }}>Câu</th>
                              <th style={{ padding: '6px' }}>Nội dung câu hỏi</th>
                              <th style={{ padding: '6px' }}>Câu trả lời đã chọn</th>
                              {canShowCorrectAnswer && <th style={{ padding: '6px' }}>Đáp án đúng</th>}
                              <th style={{ padding: '6px' }}>Kết quả</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeAtt.questionBreakdown.map((q) => (
                              <tr key={q.questionId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td style={{ padding: '6px', fontWeight: 700 }}>#{q.questionIndex}</td>
                                <td style={{ padding: '6px', color: 'var(--text-primary)' }}>{q.questionText}</td>
                                <td style={{ padding: '6px' }}>{q.playerAnswer || '(Bỏ trống)'}</td>
                                {canShowCorrectAnswer && (
                                  <td style={{ padding: '6px', color: 'var(--accent-emerald)', fontWeight: 700 }}>
                                    {q.correctAnswer || '—'}
                                  </td>
                                )}
                                <td
                                  style={{
                                    padding: '6px',
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
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Chi tiết câu trả lời của lượt chơi PLAY (Tuyệt đối ẩn đáp án đúng & giải thích) */}
      {playAttemptBreakdownModal && (
        <div
          data-testid="play-attempt-breakdown-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết lượt chơi"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            backgroundColor: 'rgba(6, 9, 19, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPlayAttemptBreakdownModal(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '760px',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Lượt chơi Lần {playAttemptBreakdownModal.attemptNumber} • {playAttemptBreakdownModal.playerName}
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  Điểm: <strong>{playAttemptBreakdownModal.score.toLocaleString('vi-VN')} đ</strong> •{' '}
                  {playAttemptBreakdownModal.correctAnswers} đúng / {playAttemptBreakdownModal.wrongAnswers} sai •{' '}
                  Thời gian: {formatDuration(playAttemptBreakdownModal.durationMs)}
                </div>
              </div>
              <button
                type="button"
                data-testid="close-play-attempt-breakdown-modal"
                onClick={() => setPlayAttemptBreakdownModal(null)}
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
                Đóng
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table
                data-testid="play-attempt-questions-table"
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem', minWidth: '480px' }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      textAlign: 'left',
                    }}
                  >
                    <th style={{ padding: '8px' }}>Câu</th>
                    <th style={{ padding: '8px' }}>Nội dung câu hỏi</th>
                    <th style={{ padding: '8px' }}>Lựa chọn của người chơi</th>
                    <th style={{ padding: '8px' }}>Kết quả</th>
                    <th style={{ padding: '8px' }}>Điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {playAttemptBreakdownModal.questionBreakdown.map((q) => (
                    <tr key={q.questionId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px', fontWeight: 700 }}>#{q.questionIndex}</td>
                      <td style={{ padding: '8px', color: 'var(--text-primary)' }}>{q.questionText}</td>
                      <td style={{ padding: '8px' }}>{q.playerAnswer || '(Bỏ trống)'}</td>
                      <td
                        style={{
                          padding: '8px',
                          fontWeight: 700,
                          color: q.isCorrect ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                        }}
                      >
                        {q.isCorrect ? 'Đúng' : 'Sai'}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{q.pointsEarned ?? 0} đ</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Xác nhận Cấp thêm lượt thi / lượt chơi (Grant Retake) */}
      {grantRetakeModal && (
        <div
          data-testid="grant-retake-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Cấp thêm lượt cho người tham gia"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            backgroundColor: 'rgba(6, 9, 19, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isGrantingRetake) {
              setGrantRetakeModal(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '480px',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Cấp thêm lượt tham gia
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Tăng số lượt được phép cho đúng người tham gia này. Toàn bộ điểm số và lịch sử các lần trước được giữ nguyên.
              </p>
            </div>

            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '0.82rem',
              }}
            >
              <div>
                Người tham gia: <strong style={{ color: 'var(--text-primary)' }}>{grantRetakeModal.fullName}</strong>
              </div>
              {(grantRetakeModal.employeeCode || grantRetakeModal.departmentUnit) && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
                  {[grantRetakeModal.employeeCode, grantRetakeModal.departmentUnit].filter(Boolean).join(' • ')}
                </div>
              )}
              <div>
                Số lượt hiện tại:{' '}
                <strong data-testid="grant-retake-current-attempts" style={{ color: 'var(--primary)' }}>
                  {grantRetakeModal.usedAttempts} / {grantRetakeModal.allowedAttempts} lượt
                </strong>{' '}
                (Còn lại: {Math.max(0, grantRetakeModal.allowedAttempts - grantRetakeModal.usedAttempts)} lượt)
              </div>
              <div>
                Sau khi cấp thêm:{' '}
                <strong data-testid="grant-retake-next-attempts" style={{ color: 'var(--accent-emerald)' }}>
                  {grantRetakeModal.usedAttempts} / {grantRetakeModal.allowedAttempts + (Number(grantRetakeModal.additionalAttempts) || 1)} lượt
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label
                htmlFor="grant-retake-count-input"
                style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}
              >
                Chọn số lượt muốn cấp thêm (1 - 10):
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {[1, 2, 3].map((num) => {
                  const active = grantRetakeModal.additionalAttempts === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      data-testid={`grant-retake-preset-${num}`}
                      onClick={() =>
                        setGrantRetakeModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                additionalAttempts: num,
                              }
                            : null
                        )
                      }
                      style={{
                        padding: '8px 14px',
                        minHeight: '44px',
                        minWidth: '44px',
                        borderRadius: '7px',
                        border: active ? '1px solid var(--primary)' : '1px solid var(--border-strong)',
                        backgroundColor: active ? 'var(--primary)' : 'var(--bg-subtle)',
                        color: active ? 'var(--primary-ink, #060913)' : 'var(--text-primary)',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      +{num} lượt
                    </button>
                  );
                })}
                <input
                  id="grant-retake-count-input"
                  data-testid="grant-retake-count-input"
                  type="number"
                  min={1}
                  max={10}
                  value={grantRetakeModal.additionalAttempts}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    setGrantRetakeModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            additionalAttempts: Number.isNaN(parsed) ? 1 : parsed,
                          }
                        : null
                    );
                  }}
                  style={{
                    width: '84px',
                    padding: '8px 10px',
                    minHeight: '44px',
                    borderRadius: '7px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {grantRetakeError && (
              <div
                data-testid="grant-retake-error"
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: 'var(--accent-rose)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
              >
                {grantRetakeError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                data-testid="cancel-grant-retake-btn"
                disabled={isGrantingRetake}
                onClick={() => setGrantRetakeModal(null)}
                style={{
                  padding: '8px 16px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '7px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: isGrantingRetake ? 'not-allowed' : 'pointer',
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="confirm-grant-retake-btn"
                disabled={isGrantingRetake}
                onClick={handleConfirmGrantRetake}
                style={{
                  padding: '8px 16px',
                  minHeight: '44px',
                  minWidth: '44px',
                  borderRadius: '7px',
                  border: '1px solid var(--primary)',
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink, #060913)',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  cursor: isGrantingRetake ? 'not-allowed' : 'pointer',
                }}
              >
                {isGrantingRetake
                  ? 'Đang cấp lượt...'
                  : `Xác nhận cấp +${grantRetakeModal.additionalAttempts} lượt`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL QR RIÊNG CHO TỪNG ĐỢT THI EXAM (TÁI SỬ DỤNG SOLOPRESENTATIONPAGE)
         ===================================================================== */}
      {examBatchQrModal && (
        <div
          data-testid="exam-batch-qr-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Mã QR ${examBatchQrModal.batchName}`}
          onClick={() => setExamBatchQrModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            backgroundColor: 'rgba(6, 9, 19, 0.82)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '1040px',
              maxHeight: '92vh',
              overflowY: 'auto',
              backgroundColor: 'var(--bg-main, #0b0f19)',
              borderRadius: '20px',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)',
            }}
          >
            <SoloPresentationPage
              gameSpec={null}
              gameId={examBatchQrModal.gameId}
              examBatchContext={examBatchQrModal}
              onBack={() => setExamBatchQrModal(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
