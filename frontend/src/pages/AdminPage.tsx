import React, { useEffect, useState } from 'react';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BarChartIcon,
  BookOpenIcon,
  CpuIcon,
  FileTextIcon,
  FlameIcon,
  GamepadIcon,
  GlobeIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  SpinnerIcon,
  TargetIcon,
  TrashIcon,
  UsersIcon,
} from '../components/Icons.js';
import { useToast } from '../components/ToastContext.js';
import {
  deleteAdminGame,
  downloadAdminAiCostReportExcel,
  downloadAdminAiLogsExport,
  fetchAdminAiCostReport,
  fetchAdminAiLogs,
  fetchAdminGames,
  fetchAdminOverview,
  fetchAdminRooms,
  fetchAdminUsers,
  isClientAdminDemoModeEnabled,
  updateAdminGameStatus,
  type AdminAiCostReport,
  type AdminAiCostReportFilters,
} from '../services/api.js';
import type {
  AdminAiLogRecord,
  AdminOverviewStats,
  AdminUserRecord,
  AuthenticatedUser,
  PersistedGameSummary,
} from '../types/index.js';

interface AdminPageProps {
  currentUser: AuthenticatedUser | null;
  onOpenAuthModal?: () => void;
  onNavigateHome: () => void;
}

type AdminTab = 'overview' | 'users' | 'games' | 'costs' | 'ops';

export const AdminPage: React.FC<AdminPageProps> = ({
  currentUser,
  onNavigateHome,
}) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>('costs');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoAccessDeniedByServer, setDemoAccessDeniedByServer] = useState(false);

  // Overview stats
  const [overview, setOverview] = useState<AdminOverviewStats | null>(null);

  // Users list
  const [users, setUsers] = useState<AdminUserRecord[]>([]);

  // Games list
  const [games, setGames] = useState<PersistedGameSummary[]>([]);
  const [gameSearch, setGameSearch] = useState('');
  const [gameStatusFilter, setGameStatusFilter] = useState('ALL');
  const [processingGameId, setProcessingGameId] = useState<string | null>(null);
  const [deleteConfirmGame, setDeleteConfirmGame] = useState<PersistedGameSummary | null>(null);

  // Operations: Rooms & AI logs
  const [, setActiveRooms] = useState<any[]>([]);
  const [, setHistoricalRooms] = useState<any[]>([]);
  const [aiLogs, setAiLogs] = useState<AdminAiLogRecord[]>([]);
  const [aiFilterFrom, setAiFilterFrom] = useState('');
  const [aiFilterTo, setAiFilterTo] = useState('');
  const [aiFilterGameId, setAiFilterGameId] = useState('');
  const [aiFilterModel, setAiFilterModel] = useState('ALL');
  const [aiFilterOperation, setAiFilterOperation] = useState('ALL');
  const [isExportingAiLogs, setIsExportingAiLogs] = useState(false);

  // AI Token & Cost Tracking state
  const [costReport, setCostReport] = useState<AdminAiCostReport | null>(null);
  const [costPreset, setCostPreset] = useState<'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'ALL' | 'CUSTOM'>('THIS_MONTH');
  const [costFrom, setCostFrom] = useState('');
  const [costTo, setCostTo] = useState('');
  const [costModel] = useState('ALL');
  const [costGameType] = useState('ALL');
  const [costTaskType] = useState('ALL');
  const [visibleGameCount, setVisibleGameCount] = useState(10);
  const [isExportingCostExcel, setIsExportingCostExcel] = useState(false);

  const isUserAdmin = currentUser?.role === 'ADMIN';
  const isDemoCostAccess =
    !isUserAdmin && isClientAdminDemoModeEnabled() && !demoAccessDeniedByServer;
  const canAccessAdminPanel = isUserAdmin || isDemoCostAccess;

  // Handle ESC key for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && deleteConfirmGame && !processingGameId) {
        setDeleteConfirmGame(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirmGame, processingGameId]);

  useEffect(() => {
    if (!canAccessAdminPanel) return;

    if (activeTab === 'costs') {
      loadCostReport();
    } else if (isUserAdmin) {
      if (activeTab === 'overview') {
        loadOverview();
      } else if (activeTab === 'users') {
        loadUsers();
      } else if (activeTab === 'games') {
        loadGames();
      } else if (activeTab === 'ops') {
        loadOps();
      }
    }
  }, [activeTab, currentUser, isUserAdmin, canAccessAdminPanel]);

  const loadOverview = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchAdminOverview();
      setOverview(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải số liệu tổng quan.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadUsers = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchAdminUsers();
      setUsers(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải danh sách người dùng.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadGames = async (search = gameSearch, status = gameStatusFilter) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchAdminGames({
        limit: 50,
        search: search.trim() || undefined,
        status: status !== 'ALL' ? status : undefined,
      });
      setGames(data.games || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải danh sách game.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadOps = async (overrideFilters?: {
    from?: string;
    to?: string;
    gameId?: string;
    model?: string;
    operation?: string;
  }) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const activeFilters = {
        from: (overrideFilters?.from ?? aiFilterFrom).trim() || undefined,
        to: (overrideFilters?.to ?? aiFilterTo).trim() || undefined,
        gameId: (overrideFilters?.gameId ?? aiFilterGameId).trim() || undefined,
        model: overrideFilters?.model ?? aiFilterModel,
        operation: overrideFilters?.operation ?? aiFilterOperation,
        limit: 100,
      };
      const [roomsData, logsData] = await Promise.all([
        fetchAdminRooms(),
        fetchAdminAiLogs(activeFilters),
      ]);
      setActiveRooms(roomsData.activeRooms || []);
      setHistoricalRooms(roomsData.historicalRooms || []);
      setAiLogs(logsData || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải dữ liệu vận hành.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportAiLogs = async (format: 'csv' | 'xlsx') => {
    setIsExportingAiLogs(true);
    try {
      await downloadAdminAiLogsExport(format, {
        from: aiFilterFrom.trim() || undefined,
        to: aiFilterTo.trim() || undefined,
        gameId: aiFilterGameId.trim() || undefined,
        model: aiFilterModel,
        operation: aiFilterOperation,
      });
      toast.success(
        `Đã xuất nhật ký AI định dạng ${format.toUpperCase()} thành công.`,
        'Xuất báo cáo AI'
      );
    } catch (err: any) {
      toast.error(err.message || 'Không thể xuất nhật ký AI.', 'Lỗi xuất báo cáo');
    } finally {
      setIsExportingAiLogs(false);
    }
  };

  const loadCostReport = async (override?: AdminAiCostReportFilters) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const activePreset = override?.preset ?? costPreset;
      const activeFrom = (override?.from ?? costFrom).trim() || undefined;
      const activeTo = (override?.to ?? costTo).trim() || undefined;
      const activeModel = override?.model ?? costModel;
      const activeGameType = override?.gameType ?? costGameType;
      const activeTaskType = override?.taskType ?? costTaskType;

      const data = await fetchAdminAiCostReport({
        preset: activePreset,
        from: activeFrom,
        to: activeTo,
        model: activeModel,
        gameType: activeGameType,
        taskType: activeTaskType,
      });
      setCostReport(data);
      setDemoAccessDeniedByServer(false);
    } catch (err: any) {
      if (
        !isUserAdmin &&
        (err?.status === 401 ||
          err?.status === 403 ||
          err?.code === 'UNAUTHORIZED' ||
          err?.code === 'ACCESS_DENIED')
      ) {
        setDemoAccessDeniedByServer(true);
      }
      setErrorMessage(err.message || 'Không thể tải thống kê chi phí AI.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCostExcel = async () => {
    setIsExportingCostExcel(true);
    try {
      await downloadAdminAiCostReportExcel({
        preset: costPreset,
        from: costFrom.trim() || undefined,
        to: costTo.trim() || undefined,
        model: costModel,
        gameType: costGameType,
        taskType: costTaskType,
      });
      toast.success(
        'Đã xuất báo cáo chi phí AI (.xlsx) gồm 4 sheet thành công.',
        'Xuất báo cáo Excel'
      );
    } catch (err: any) {
      toast.error(err.message || 'Không thể xuất báo cáo Excel chi phí AI.', 'Lỗi xuất Excel');
    } finally {
      setIsExportingCostExcel(false);
    }
  };

  const formatVndCurrency = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      return 'Chưa xác định';
    }
    return `${new Intl.NumberFormat('vi-VN').format(Math.round(amount))} ₫`;
  };

  const formatCompactTokens = (tokens: number | null | undefined): string => {
    if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) {
      return 'Chưa xác định';
    }
    if (tokens < 1_000) {
      return new Intl.NumberFormat('vi-VN').format(tokens);
    }
    if (tokens < 1_000_000) {
      return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(tokens / 1_000)}K`;
    }
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(tokens / 1_000_000)}M`;
  };

  const formatExactTokens = (tokens: number | null | undefined, hasUnknownUsage?: boolean): string => {
    if (hasUnknownUsage || tokens === null || tokens === undefined || !Number.isFinite(tokens)) {
      return 'Chưa xác định';
    }
    return new Intl.NumberFormat('vi-VN').format(Math.round(tokens));
  };

  const computeLibraryGameCostColumns = (
    g: AdminAiCostReport['byGame'][number],
    defaultExchangeRate: number
  ): {
    tokenInputText: string;
    tokenOutputText: string;
    costInputText: string;
    costOutputText: string;
    costTotalText: string;
    isCostValid: boolean;
    totalTooltip: string | undefined;
  } => {
    const hasIncompleteData =
      g.hasUnknownUsage ||
      g.hasPriceUnavailable ||
      g.status === 'USAGE_UNAVAILABLE' ||
      g.status === 'PRICE_UNAVAILABLE';

    const tokenInputText = formatExactTokens(g.inputTokens, g.hasUnknownUsage);
    const tokenOutputText = formatExactTokens(g.outputTokens, g.hasUnknownUsage);

    let hasAnyTokenReq = false;
    let missingPriceOrUsage = hasIncompleteData;
    let sumInputCostVndExact = 0;
    let sumOutputCostVndExact = 0;
    let hasAdditionalAiCost = false;

    for (const r of g.requests || []) {
      const rate =
        r.exchangeRateUsdVnd && Number.isFinite(r.exchangeRateUsdVnd) && r.exchangeRateUsdVnd > 0
          ? r.exchangeRateUsdVnd
          : defaultExchangeRate;

      const isFailedNoUsage =
        r.status === 'FAILED' && r.inputTokens === null && r.outputTokens === null;

      if (!isFailedNoUsage && (r.pricingStatus === 'PRICE_UNAVAILABLE' || r.pricingStatus === 'USAGE_UNAVAILABLE')) {
        missingPriceOrUsage = true;
      }

      if (r.inputTokens !== null && r.outputTokens !== null) {
        hasAnyTokenReq = true;
        if (
          r.inputCostVnd !== undefined &&
          r.inputCostVnd !== null &&
          r.outputCostVnd !== undefined &&
          r.outputCostVnd !== null
        ) {
          sumInputCostVndExact += r.inputCostVnd;
          sumOutputCostVndExact += r.outputCostVnd;
        } else if (
          r.inputPricePer1MUsd === null ||
          r.inputPricePer1MUsd === undefined ||
          r.outputPricePer1MUsd === null ||
          r.outputPricePer1MUsd === undefined
        ) {
          missingPriceOrUsage = true;
        } else {
          const rawIn = Math.max(0, Math.round(r.inputTokens));
          const rawOut = Math.max(0, Math.round(r.outputTokens));
          const rawCached =
            r.cachedTokens !== null && r.cachedTokens !== undefined && Number.isFinite(r.cachedTokens)
              ? Math.max(0, Math.round(r.cachedTokens))
              : 0;
          const rawThinking =
            r.thinkingTokens !== null && r.thinkingTokens !== undefined && Number.isFinite(r.thinkingTokens)
              ? Math.max(0, Math.round(r.thinkingTokens))
              : 0;
          const effectiveCached = Math.min(rawIn, rawCached);
          const nonCachedInput = Math.max(0, rawIn - effectiveCached);
          const cachedPricePer1M =
            r.cachedPricePer1MUsd !== null && r.cachedPricePer1MUsd !== undefined
              ? r.cachedPricePer1MUsd
              : r.inputPricePer1MUsd * 0.25;

          const reqInUsd =
            (nonCachedInput / 1_000_000) * r.inputPricePer1MUsd +
            (effectiveCached / 1_000_000) * cachedPricePer1M;
          const billableOut = rawOut + rawThinking;
          const reqOutUsd = (billableOut / 1_000_000) * r.outputPricePer1MUsd;

          sumInputCostVndExact += reqInUsd * rate;
          sumOutputCostVndExact += reqOutUsd * rate;
        }

        const rawOutCheck = Math.max(0, Math.round(r.outputTokens));
        if (
          (r.taskType === 'COVER_IMAGE_GENERATION' ||
            r.taskType === 'ADVENTURE_SPRITE_GENERATION' ||
            String(r.model || '').toLowerCase().includes('image')) &&
          r.status === 'SUCCESS' &&
          rawOutCheck === 0 &&
          r.imagePriceUsd &&
          r.imagePriceUsd > 0
        ) {
          hasAdditionalAiCost = true;
        }
      } else if (
        r.pricingStatus === 'OK' &&
        r.paidEquivalentCostVnd !== null &&
        r.paidEquivalentCostVnd > 0
      ) {
        hasAdditionalAiCost = true;
      }
    }

    const inputCostVnd =
      !missingPriceOrUsage && g.inputCostVnd !== undefined && g.inputCostVnd !== null && Number.isFinite(g.inputCostVnd)
        ? Math.round(g.inputCostVnd)
        : !missingPriceOrUsage && hasAnyTokenReq
          ? Math.round(sumInputCostVndExact)
          : null;
    const outputCostVnd =
      !missingPriceOrUsage && g.outputCostVnd !== undefined && g.outputCostVnd !== null && Number.isFinite(g.outputCostVnd)
        ? Math.round(g.outputCostVnd)
        : !missingPriceOrUsage && hasAnyTokenReq
          ? Math.round(sumOutputCostVndExact)
          : null;
    const totalCostVnd =
      !missingPriceOrUsage &&
      g.paidEquivalentCostVnd !== null &&
      g.paidEquivalentCostVnd !== undefined &&
      Number.isFinite(g.paidEquivalentCostVnd)
        ? Math.round(g.paidEquivalentCostVnd)
        : null;

    const isCostValid = totalCostVnd !== null;
    let totalTooltip: string | undefined;
    if (
      totalCostVnd !== null &&
      (hasAdditionalAiCost ||
        (inputCostVnd !== null &&
          outputCostVnd !== null &&
          totalCostVnd !== inputCostVnd + outputCostVnd))
    ) {
      totalTooltip =
        'Tổng chi phí AI quy đổi của game (đã bao gồm Tiền Input, Tiền Output và chi phí tạo ảnh / tác vụ AI bổ sung)';
    }

    return {
      tokenInputText,
      tokenOutputText,
      costInputText: formatVndCurrency(inputCostVnd),
      costOutputText: formatVndCurrency(outputCostVnd),
      costTotalText: formatVndCurrency(totalCostVnd),
      isCostValid,
      totalTooltip,
    };
  };

  const handleToggleStatus = async (game: PersistedGameSummary) => {
    setProcessingGameId(game.gameId);
    try {
      const nextPublic = !game.isPublic;
      await updateAdminGameStatus(game.gameId, nextPublic);
      toast.success(
        nextPublic ? 'Đã xuất bản game công khai.' : 'Đã chuyển game về bản nháp.',
        'Cập nhật thành công'
      );
      loadGames();
    } catch (err: any) {
      toast.error(err.message || 'Không thể thay đổi trạng thái game.', 'Lỗi kiểm duyệt');
    } finally {
      setProcessingGameId(null);
    }
  };

  const executeDeleteGame = async (game: PersistedGameSummary) => {
    setProcessingGameId(game.gameId);
    try {
      await deleteAdminGame(game.gameId);
      toast.success(`Đã xóa thành công game "${game.title}".`, 'Xóa thành công');
      setDeleteConfirmGame(null);
      loadGames();
    } catch (err: any) {
      toast.error(err.message || 'Không thể xóa game.', 'Lỗi xóa');
    } finally {
      setProcessingGameId(null);
    }
  };

  // 1. Trường hợp chưa đăng nhập / chưa có phiên Admin và không ở chế độ Demo Local
  if (!currentUser && !canAccessAdminPanel) {
    return (
      <div
        style={{
          maxWidth: '560px',
          margin: '3rem auto',
          padding: '2.5rem',
          borderRadius: '16px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          textAlign: 'center',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem',
            color: 'var(--accent-sky)',
          }}
        >
          <ShieldIcon size={32} />
        </div>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)' }}>
          Khu Vực Quản Trị Hệ Thống
        </h2>
        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6 }}>
          Hệ thống hiện tại đã chuyển sang cơ chế quản lý phi tập trung: <strong>Mật khẩu bảo vệ riêng cho từng Bộ câu hỏi</strong> trực tiếp tại <strong>Kho Game</strong> và <strong>Tạo Game</strong>. Người tạo có toàn quyền chỉnh sửa và xóa game của mình mà không cần tài khoản Quản trị viên chung.
        </p>
        <p style={{ margin: '0 0 1.75rem 0', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
          Bảng điều khiển Quản trị viên Trung tâm này chỉ mở khi có phiên làm việc Quản trị viên được cấp từ hệ thống máy chủ.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              window.location.search = '?tab=analytics';
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              minHeight: '44px',
              padding: '0.75rem 1.5rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
              boxShadow: 'var(--btn-shadow)',
            }}
          >
            <BookOpenIcon size={18} />
            Đến Kho Game Quản Lý
          </button>
          <button
            type="button"
            onClick={onNavigateHome}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              minHeight: '44px',
              padding: '0.75rem 1.25rem',
              borderRadius: '10px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            <ArrowLeftIcon size={18} />
            Về Trang Chủ
          </button>
        </div>
      </div>
    );
  }

  // 2. Trường hợp đã đăng nhập nhưng không có vai trò ADMIN và không ở chế độ Demo Local
  if (!isUserAdmin && !canAccessAdminPanel) {
    return (
      <div
        style={{
          maxWidth: '540px',
          margin: '3rem auto',
          padding: '2.5rem',
          borderRadius: '16px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--accent-rose)',
          textAlign: 'center',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem',
            color: 'var(--accent-rose)',
          }}
        >
          <AlertTriangleIcon size={32} />
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.4rem', fontWeight: 900, color: 'var(--accent-rose)' }}>
          Truy Cập Bị Từ Chối (403 ACCESS_DENIED)
        </h2>
        <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
          Tài khoản hiện tại <strong>{currentUser?.email}</strong> có vai trò <strong>{currentUser?.role}</strong>. Bạn không có quyền truy cập khu vực Quản trị Admin.
        </p>
        <button
          type="button"
          onClick={onNavigateHome}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            minHeight: '44px',
            padding: '0.75rem 1.5rem',
            borderRadius: '10px',
            border: 'none',
            backgroundColor: 'var(--primary)',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          <ArrowLeftIcon size={18} />
          Quay lại Trang Chủ
        </button>
      </div>
    );
  }

  const visibleAdminTabs = isUserAdmin
    ? [
        { id: 'costs', label: 'Chi phí sử dụng AI', icon: <TargetIcon size={15} /> },
        { id: 'overview', label: 'Tổng Quan', icon: <BarChartIcon size={15} /> },
        { id: 'users', label: 'Người Dùng', icon: <UsersIcon size={15} /> },
        { id: 'games', label: 'Kiểm Duyệt Game', icon: <GamepadIcon size={15} /> },
        { id: 'ops', label: 'Vận Hành & AI', icon: <CpuIcon size={15} /> },
      ]
    : [{ id: 'costs', label: 'Chi phí sử dụng AI', icon: <TargetIcon size={15} /> }];

  // 3. Trường hợp là ADMIN hợp lệ hoặc Chế độ Demo Local (Chi phí sử dụng AI)
  return (
    <div
      className="admin-page-container"
      data-testid="admin-page-container"
      style={{ width: '100%', maxWidth: 'none', margin: 0, boxSizing: 'border-box' }}
    >
      <style>{`
        .admin-page-container {
          padding: 1.25rem 28px;
        }
        @media (max-width: 767px) {
          .admin-page-container {
            padding: 1rem 16px;
          }
        }
      `}</style>
      {/* Header Admin */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <h1
            style={{
              margin: '0 0 0.35rem 0',
              fontSize: '1.6rem',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              flexWrap: 'wrap',
              color: 'var(--text-primary)',
            }}
          >
            <ShieldIcon size={24} style={{ color: 'var(--primary)' }} />
            <span>Quản Trị Hệ Thống (Admin Panel)</span>
            {isDemoCostAccess && (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '0.2rem 0.65rem',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(18, 184, 134, 0.16)',
                  border: '1px solid var(--accent-emerald)',
                  color: 'var(--accent-emerald)',
                }}
              >
                Chế độ Demo Local
              </span>
            )}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            {isUserAdmin
              ? 'Quản lý người dùng, kiểm duyệt bộ câu hỏi, theo dõi chi phí sử dụng AI và hạ tầng thời gian thực.'
              : 'Theo dõi token, chi phí sử dụng AI theo từng game, dự phóng ngân sách 100 / 1.000 / 10.000 lượt và xuất báo cáo Excel 4 sheet.'}
          </p>
        </div>

        {/* Tab Menu */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: '0.35rem',
            backgroundColor: 'var(--bg-input)',
            padding: '0.3rem',
            borderRadius: '10px',
            border: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          {visibleAdminTabs.map((tab) => {
            const isCurrent = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => setActiveTab(tab.id as AdminTab)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  minHeight: '40px',
                  padding: '0.55rem 0.95rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: isCurrent ? 'var(--primary)' : 'transparent',
                  color: isCurrent ? 'var(--primary-ink)' : 'var(--text-secondary)',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease, color 0.15s ease',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Thông báo lỗi nếu có */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--accent-rose)',
            borderRadius: '10px',
            padding: '1rem',
            color: 'var(--accent-rose)',
            marginBottom: '1.5rem',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          <AlertTriangleIcon size={20} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: '0.75rem', color: 'var(--primary)' }}>
            <SpinnerIcon size={32} />
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Đang tải dữ liệu quản trị...</div>
        </div>
      )}

      {/* TAB 1: TỔNG QUAN */}
      {!isLoading && activeTab === 'overview' && overview && (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '2rem',
            }}
          >
            {[
              { label: 'Tổng Người Dùng', val: overview.totalUsers, icon: <UsersIcon size={20} />, color: 'var(--accent-sky)' },
              { label: 'Tổng Bộ Câu Hỏi', val: overview.totalGames, icon: <GamepadIcon size={20} />, color: 'var(--primary)' },
              { label: 'Game Đã Xuất Bản', val: overview.publishedGames, icon: <GlobeIcon size={20} />, color: 'var(--accent-emerald)' },
              { label: 'Bản Nháp (Draft)', val: overview.draftGames, icon: <FileTextIcon size={20} />, color: 'var(--accent-amber)' },
              { label: 'Lượt Chơi Đơn', val: overview.totalSessions, icon: <TargetIcon size={20} />, color: 'var(--game-mixed)' },
              { label: 'Phòng Multiplayer Đang Mở', val: overview.activeRoomsCount, icon: <FlameIcon size={20} />, color: 'var(--game-mc)' },
            ].map((card, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  boxShadow: 'var(--card-shadow)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{card.label}</span>
                  <span style={{ color: card.color }}>{card.icon}</span>
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: card.color }}>
                  {card.val}
                </div>
              </div>
            ))}
          </div>

          {/* Phòng đang hoạt động */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '1.5rem',
            }}
          >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FlameIcon size={20} style={{ color: 'var(--accent-rose)' }} />
              <span>Phòng Multiplayer Đang Hoạt Động</span>
            </h3>
            {overview.activeRooms && overview.activeRooms.length > 0 ? (
              <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      <th style={{ padding: '0.75rem' }}>Mã Phòng</th>
                      <th style={{ padding: '0.75rem' }}>Tên Trò Chơi</th>
                      <th style={{ padding: '0.75rem' }}>Trạng Thái</th>
                      <th style={{ padding: '0.75rem' }}>Người Chơi</th>
                      <th style={{ padding: '0.75rem' }}>Tiến Độ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.activeRooms.map((room) => (
                      <tr key={room.roomId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.75rem', fontWeight: 800, color: 'var(--accent-sky)', whiteSpace: 'nowrap' }}>{room.roomCode}</td>
                        <td style={{ padding: '0.75rem' }}>{room.title}</td>
                        <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>
                          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700, backgroundColor: 'rgba(56, 189, 248, 0.15)', color: 'var(--accent-sky)' }}>
                            {room.state}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{room.playerCount} người</td>
                        <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>{room.currentQuestionIndex + 1} / {room.totalQuestions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Hiện không có phòng chơi nào đang hoạt động.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: NGƯỜI DÙNG */}
      {!isLoading && activeTab === 'users' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UsersIcon size={20} style={{ color: 'var(--accent-sky)' }} />
              <span>Danh Sách Tài Khoản ({users.length})</span>
            </h3>
            <button
              type="button"
              onClick={loadUsers}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                minHeight: '40px',
                padding: '0.5rem 0.95rem',
                borderRadius: '8px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshIcon size={14} />
              <span>Làm mới</span>
            </button>
          </div>

          <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '0.75rem' }}>Tên hiển thị</th>
                  <th style={{ padding: '0.75rem' }}>Email</th>
                  <th style={{ padding: '0.75rem' }}>Vai trò</th>
                  <th style={{ padding: '0.75rem' }}>Game đã tạo</th>
                  <th style={{ padding: '0.75rem' }}>Ngày đăng ký</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{u.displayName}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{u.email}</td>
                    <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          backgroundColor: u.role === 'ADMIN' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                          color: u.role === 'ADMIN' ? 'var(--accent-rose)' : 'var(--accent-sky)',
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{u.gameCount}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(u.createdAt).toLocaleString('vi-VN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: KIỂM DUYỆT GAME */}
      {!isLoading && activeTab === 'games' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '1.5rem',
          }}
        >
          {/* Bộ lọc tìm kiếm */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem', alignItems: 'center' }}>
            <label htmlFor="admin-game-search" className="sr-only">
              Tìm theo tiêu đề game
            </label>
            <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
              <input
                id="admin-game-search"
                type="text"
                value={gameSearch}
                onChange={(e) => setGameSearch(e.target.value)}
                placeholder="Tìm theo tiêu đề game..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: '44px',
                  padding: '0.6rem 0.85rem 0.6rem 2.25rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                }}
              />
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                <SearchIcon size={16} />
              </span>
            </div>

            <label htmlFor="admin-game-status" className="sr-only">
              Lọc theo trạng thái game
            </label>
            <select
              id="admin-game-status"
              value={gameStatusFilter}
              onChange={(e) => setGameStatusFilter(e.target.value)}
              style={{
                minHeight: '44px',
                padding: '0.6rem 0.85rem',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
              }}
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="PUBLISHED">Chỉ đã xuất bản</option>
              <option value="DRAFT">Chỉ bản nháp</option>
            </select>

            <button
              type="button"
              onClick={() => loadGames(gameSearch, gameStatusFilter)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                minHeight: '44px',
                padding: '0.6rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              <SearchIcon size={16} />
              <span>Lọc</span>
            </button>
          </div>

          {/* Bảng game */}
          <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '0.75rem' }}>Tiêu Đề Game</th>
                  <th style={{ padding: '0.75rem' }}>Thể Loại</th>
                  <th style={{ padding: '0.75rem' }}>Số Câu</th>
                  <th style={{ padding: '0.75rem' }}>Trạng Thái</th>
                  <th style={{ padding: '0.75rem' }}>Ngày Tạo</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Hành Động</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => (
                  <tr key={g.gameId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 700 }}>
                      <div style={{ color: 'var(--text-primary)' }}>{g.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {g.gameId}</div>
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{g.gameType}</td>
                    <td style={{ padding: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{g.questionCount} câu</td>
                    <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          backgroundColor: g.isPublic ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                          color: g.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                        }}
                      >
                        {g.isPublic ? <GlobeIcon size={12} /> : <FileTextIcon size={12} />}
                        {g.isPublic ? 'ĐÃ XUẤT BẢN' : 'BẢN NHÁP'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(g.createdAt).toLocaleDateString('vi-VN')}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          disabled={processingGameId === g.gameId}
                          onClick={() => handleToggleStatus(g)}
                          style={{
                            minHeight: '40px',
                            padding: '0.45rem 0.85rem',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-input)',
                            color: g.isPublic ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {g.isPublic ? 'Ẩn về nháp' : 'Duyệt xuất bản'}
                        </button>
                        <button
                          type="button"
                          disabled={processingGameId === g.gameId}
                          onClick={() => setDeleteConfirmGame(g)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            minHeight: '40px',
                            padding: '0.45rem 0.75rem',
                            borderRadius: '8px',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            color: 'var(--accent-rose)',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <TrashIcon size={14} />
                          <span>Xóa</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CHI PHÍ SỬ DỤNG AI (REDESIGNED EXECUTIVE DASHBOARD V2) */}
      {!isLoading && activeTab === 'costs' && costReport && (() => {
        // Chỉ hiển thị những game đã lưu và hiện còn trong Thư viện (liên kết theo gameId ổn định)
        const libraryGames = [...costReport.byGame]
          .filter(
            (g) =>
              g.isSavedInLibrary === true &&
              typeof g.gameId === 'string' &&
              g.gameId.trim().length > 0 &&
              g.generationKey === `game:${g.gameId.trim()}`
          )
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const visibleGames = libraryGames.slice(0, visibleGameCount);
        const hasMoreGames = libraryGames.length > visibleGameCount;

        const isAllCostUnknown =
          costReport.summary.totalAiRequests > 0 &&
          costReport.summary.eligibleGenerationsForAverage === 0 &&
          (costReport.summary.requestsWithUnknownUsage > 0 ||
            costReport.summary.requestsWithPriceUnavailable > 0) &&
          costReport.summary.paidEquivalentCostVnd === 0;

        const totalPaidVndDisplay = isAllCostUnknown
          ? 'Chưa xác định'
          : formatVndCurrency(costReport.summary.paidEquivalentCostVnd);

        const avgCostPerGameVndDisplay =
          costReport.summary.avgPaidEquivalentCostPerGameVnd !== null
            ? formatVndCurrency(costReport.summary.avgPaidEquivalentCostPerGameVnd)
            : 'Chưa xác định';

        const isAllTokensUnknown =
          costReport.summary.totalAiRequests > 0 &&
          costReport.summary.requestsWithReportedTokens === 0;

        const compactTokensDisplay = isAllTokensUnknown
          ? 'Chưa xác định'
          : formatCompactTokens(costReport.summary.totalTokens);

        const exactTokensTooltip = isAllTokensUnknown
          ? 'Chưa xác định số token từ API'
          : `${new Intl.NumberFormat('vi-VN').format(costReport.summary.totalTokens)} token`;

        return (
          <div
            className="admin-ai-cost-panel"
            data-testid="admin-ai-cost-panel"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}
          >
            <style>{`
              .admin-ai-cost-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 1rem;
              }
              .admin-ai-cost-controls {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 0.65rem;
              }
              .admin-ai-cost-kpi-grid {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 0.9rem;
              }
              @media (max-width: 1023px) {
                .admin-ai-cost-kpi-grid {
                  grid-template-columns: repeat(2, minmax(0, 1fr));
                }
              }
              @media (max-width: 480px) {
                .admin-ai-cost-kpi-grid {
                  grid-template-columns: repeat(2, minmax(0, 1fr));
                  gap: 0.65rem;
                }
                .admin-ai-cost-controls {
                  width: 100%;
                  justify-content: space-between;
                }
              }
            `}</style>

            {costReport.persistenceStatus.isEphemeralWarning &&
              costReport.persistenceStatus.warningMessage && (
                <div
                  style={{
                    padding: '0.85rem 1.1rem',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: 'var(--accent-amber)',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                  }}
                >
                  <AlertTriangleIcon size={18} />
                  <span>{costReport.persistenceStatus.warningMessage}</span>
                </div>
              )}

            {/* 1. HEADER & BỘ LỌC THỜI GIAN TỐI GIẢN */}
            <div
              className="admin-ai-cost-header"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '1.15rem 1.35rem',
              }}
            >
              <div>
                <h2
                  data-testid="ai-cost-header-title"
                  style={{
                    margin: '0 0 0.2rem 0',
                    fontSize: '1.25rem',
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                  }}
                >
                  Chi phí sử dụng AI
                </h2>
                <p
                  data-testid="ai-cost-header-subtitle"
                  style={{
                    margin: 0,
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Theo dõi chi phí tạo game
                </p>
              </div>

              <div className="admin-ai-cost-controls">
                {/* Bộ lọc thời gian: chỉ 3 lựa chọn (7 ngày, Tháng này, Tất cả) */}
                <div
                  role="group"
                  aria-label="Bộ lọc thời gian chi phí AI"
                  data-testid="ai-cost-time-filter-group"
                  style={{
                    display: 'inline-flex',
                    backgroundColor: 'var(--bg-input)',
                    padding: '0.25rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                    gap: '0.2rem',
                  }}
                >
                  {[
                    { id: 'LAST_7_DAYS', label: '7 ngày' },
                    { id: 'THIS_MONTH', label: 'Tháng này' },
                    { id: 'ALL', label: 'Tất cả' },
                  ].map((p) => {
                    const active = costPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={active}
                        data-testid={`cost-preset-${p.id.toLowerCase()}`}
                        onClick={() => {
                          setCostPreset(p.id as any);
                          setCostFrom('');
                          setCostTo('');
                          setVisibleGameCount(10);
                          loadCostReport({
                            preset: p.id as any,
                            from: '',
                            to: '',
                            model: 'ALL',
                            gameType: 'ALL',
                            taskType: 'ALL',
                          });
                        }}
                        style={{
                          minHeight: '36px',
                          padding: '0.35rem 0.75rem',
                          borderRadius: '8px',
                          border: active ? '1px solid var(--primary)' : '1px solid transparent',
                          backgroundColor: active ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                          color: active ? 'var(--primary)' : 'var(--text-secondary)',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                {/* Nút Xuất Excel duy nhất */}
                <button
                  type="button"
                  disabled={isExportingCostExcel}
                  onClick={handleExportCostExcel}
                  data-testid="admin-export-ai-cost-excel-btn"
                  style={{
                    minHeight: '40px',
                    padding: '0.5rem 1rem',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-ink)',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: isExportingCostExcel ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: 'var(--btn-shadow)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isExportingCostExcel ? <SpinnerIcon size={16} /> : <FileTextIcon size={16} />}
                  <span>{isExportingCostExcel ? 'Đang xuất...' : 'Xuất Excel'}</span>
                </button>
              </div>
            </div>

            {/* 2. 4 THẺ KPI CHÍNH */}
            <div className="admin-ai-cost-kpi-grid" data-testid="ai-cost-kpi-grid">
              {/* KPI 1 — Game đã tạo */}
              <div
                data-testid="kpi-games-created"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '1.1rem 1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: '0.4rem',
                  }}
                >
                  Game đã tạo
                </div>
                <div
                  data-testid="kpi-games-created-value"
                  style={{
                    fontSize: '1.55rem',
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                    lineHeight: 1.2,
                    wordBreak: 'break-word',
                  }}
                >
                  {new Intl.NumberFormat('vi-VN').format(costReport.summary.totalGameGenerations)}
                </div>
              </div>

              {/* KPI 2 — Tổng chi phí AI quy đổi (Nổi bật nhất) */}
              <div
                data-testid="kpi-total-paid-cost-vnd"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  borderRadius: '12px',
                  padding: '1.1rem 1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    marginBottom: '0.4rem',
                  }}
                >
                  Tổng chi phí AI quy đổi
                </div>
                <div
                  data-testid="kpi-total-paid-cost-vnd-value"
                  style={{
                    fontSize: '1.6rem',
                    fontWeight: 900,
                    color: 'var(--accent-emerald)',
                    lineHeight: 1.2,
                    wordBreak: 'break-word',
                  }}
                >
                  {totalPaidVndDisplay}
                </div>
                <div
                  style={{
                    fontSize: '0.74rem',
                    color: 'var(--text-muted)',
                    marginTop: '0.3rem',
                    fontWeight: 600,
                  }}
                >
                  Ước tính theo giá trả phí
                </div>
              </div>

              {/* KPI 3 — Trung bình / game */}
              <div
                data-testid="kpi-avg-cost-per-game-vnd"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '1.1rem 1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: '0.4rem',
                  }}
                >
                  Trung bình / game
                </div>
                <div
                  data-testid="kpi-avg-cost-per-game-vnd-value"
                  style={{
                    fontSize: '1.55rem',
                    fontWeight: 900,
                    color: 'var(--accent-amber)',
                    lineHeight: 1.2,
                    wordBreak: 'break-word',
                  }}
                >
                  {avgCostPerGameVndDisplay}
                </div>
              </div>

              {/* KPI 4 — Token đã dùng */}
              <div
                data-testid="kpi-total-tokens"
                title={exactTokensTooltip}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '1.1rem 1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: '0.4rem',
                  }}
                >
                  Token đã dùng
                </div>
                <div
                  data-testid="kpi-total-tokens-value"
                  style={{
                    fontSize: '1.55rem',
                    fontWeight: 900,
                    color: 'var(--accent-sky)',
                    lineHeight: 1.2,
                    wordBreak: 'break-word',
                  }}
                >
                  {compactTokensDisplay}
                </div>
              </div>
            </div>

            {/* 3. BẢNG CHI PHÍ CÁC GAME TRONG THƯ VIỆN (6 CỘT) */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '1.25rem 1.35rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <h3
                    data-testid="ai-cost-per-game-heading"
                    style={{
                      margin: '0 0 0.25rem 0',
                      fontSize: '1.05rem',
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                    }}
                  >
                    Chi phí các game trong Thư viện
                  </h3>
                  <p
                    data-testid="ai-cost-per-game-description"
                    style={{
                      margin: 0,
                      fontSize: '0.83rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Chi tiết token và chi phí AI của từng game đã lưu.
                  </p>
                </div>
                <div
                  data-testid="ai-cost-kpi-library-note"
                  style={{
                    fontSize: '0.77rem',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    padding: '0.3rem 0.65rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  Lưu ý: 4 chỉ số tổng quan phía trên tính toàn bộ lượt tạo AI trong kỳ; bảng dưới chỉ hiển thị game đang lưu trong Thư viện ({libraryGames.length} game).
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  className="admin-ai-cost-game-table"
                  data-testid="ai-cost-per-game-table"
                  style={{
                    width: '100%',
                    minWidth: '700px',
                    borderCollapse: 'collapse',
                    textAlign: 'left',
                    fontSize: '0.88rem',
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                      }}
                    >
                      <th style={{ padding: '0.7rem 0.6rem', fontWeight: 700, textAlign: 'left' }}>
                        Tên game
                      </th>
                      <th style={{ padding: '0.7rem 0.6rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        Token Input
                      </th>
                      <th style={{ padding: '0.7rem 0.6rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        Token Output
                      </th>
                      <th style={{ padding: '0.7rem 0.6rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        Tiền Input
                      </th>
                      <th style={{ padding: '0.7rem 0.6rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        Tiền Output
                      </th>
                      <th style={{ padding: '0.7rem 0.6rem', fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                        Tổng cộng
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGames.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          data-testid="ai-cost-per-game-empty"
                          style={{
                            padding: '2rem 0.75rem',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontSize: '0.88rem',
                          }}
                        >
                          Chưa có game nào trong Thư viện có dữ liệu chi phí AI ở khoảng thời gian này.
                        </td>
                      </tr>
                    ) : (
                      visibleGames.map((g) => {
                        const cols = computeLibraryGameCostColumns(
                          g,
                          costReport.exchangeRate.usdToVndRate
                        );
                        const rowKey = g.gameId ? g.gameId : g.generationKey;

                        return (
                          <tr
                            key={rowKey}
                            data-testid="ai-cost-game-row"
                            data-game-id={g.gameId || ''}
                            style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          >
                            {/* Cột 1: Tên game */}
                            <td
                              data-testid="ai-cost-cell-game-title"
                              style={{
                                padding: '0.8rem 0.6rem',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                textAlign: 'left',
                                wordBreak: 'break-word',
                              }}
                            >
                              {g.gameTitle}
                            </td>

                            {/* Cột 2: Token Input */}
                            <td
                              data-testid="ai-cost-cell-input-tokens"
                              style={{
                                padding: '0.8rem 0.6rem',
                                textAlign: 'right',
                                fontWeight: 600,
                                color:
                                  cols.tokenInputText === 'Chưa xác định'
                                    ? 'var(--text-muted)'
                                    : 'var(--text-primary)',
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {cols.tokenInputText}
                            </td>

                            {/* Cột 3: Token Output */}
                            <td
                              data-testid="ai-cost-cell-output-tokens"
                              style={{
                                padding: '0.8rem 0.6rem',
                                textAlign: 'right',
                                fontWeight: 600,
                                color:
                                  cols.tokenOutputText === 'Chưa xác định'
                                    ? 'var(--text-muted)'
                                    : 'var(--text-primary)',
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {cols.tokenOutputText}
                            </td>

                            {/* Cột 4: Tiền Input */}
                            <td
                              data-testid="ai-cost-cell-input-cost"
                              style={{
                                padding: '0.8rem 0.6rem',
                                textAlign: 'right',
                                fontWeight: 600,
                                color:
                                  cols.costInputText === 'Chưa xác định'
                                    ? 'var(--text-muted)'
                                    : 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {cols.costInputText}
                            </td>

                            {/* Cột 5: Tiền Output */}
                            <td
                              data-testid="ai-cost-cell-output-cost"
                              style={{
                                padding: '0.8rem 0.6rem',
                                textAlign: 'right',
                                fontWeight: 600,
                                color:
                                  cols.costOutputText === 'Chưa xác định'
                                    ? 'var(--text-muted)'
                                    : 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {cols.costOutputText}
                            </td>

                            {/* Cột 6: Tổng cộng (Nổi bật nhất) */}
                            <td
                              data-testid="ai-cost-cell-total-cost"
                              title={cols.totalTooltip}
                              style={{
                                padding: '0.8rem 0.6rem',
                                textAlign: 'right',
                                fontWeight: 900,
                                fontSize: '0.92rem',
                                color: cols.isCostValid
                                  ? 'var(--accent-emerald)'
                                  : 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {cols.costTotalText}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {hasMoreGames && (
                <div style={{ marginTop: '0.9rem', textAlign: 'center' }}>
                  <button
                    type="button"
                    data-testid="ai-cost-load-more-games"
                    onClick={() => setVisibleGameCount((prev) => prev + 10)}
                    style={{
                      minHeight: '38px',
                      padding: '0.45rem 1.15rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Xem thêm ({libraryGames.length - visibleGameCount} game)
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* TAB 4: VẬN HÀNH & AI LOGS */}
      {!isLoading && activeTab === 'ops' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* AI Logs */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '1.5rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CpuIcon size={20} style={{ color: 'var(--accent-sky)' }} />
                <span>Nhật Ký Hoạt Động AI & Token Usage ({aiLogs.length})</span>
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={isExportingAiLogs}
                  onClick={() => handleExportAiLogs('csv')}
                  data-testid="admin-export-ai-csv"
                  style={{
                    minHeight: '44px',
                    padding: '0.55rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <FileTextIcon size={15} />
                  <span>Xuất CSV</span>
                </button>
                <button
                  type="button"
                  disabled={isExportingAiLogs}
                  onClick={() => handleExportAiLogs('xlsx')}
                  data-testid="admin-export-ai-xlsx"
                  style={{
                    minHeight: '44px',
                    padding: '0.55rem 1rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-ink)',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <FileTextIcon size={15} />
                  <span>Xuất Excel (.xlsx)</span>
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
                gap: '0.65rem',
                marginBottom: '1.15rem',
                padding: '0.85rem',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <input
                type="text"
                value={aiFilterGameId}
                onChange={(e) => setAiFilterGameId(e.target.value)}
                placeholder="Lọc theo Mã / Tên Game..."
                style={{
                  minHeight: '44px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                }}
              />
              <select
                value={aiFilterOperation}
                onChange={(e) => setAiFilterOperation(e.target.value)}
                style={{
                  minHeight: '44px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                }}
              >
                <option value="ALL">Tất cả thao tác AI</option>
                <option value="GENERATE_QUESTIONS">Tạo câu hỏi (GENERATE_QUESTIONS)</option>
                <option value="GENERATE_COVER_IMAGE">Tạo ảnh bìa (GENERATE_COVER_IMAGE)</option>
                <option value="GENERATE_ADVENTURE_SPRITE">Tạo sprite 2D (GENERATE_ADVENTURE_SPRITE)</option>
              </select>
              <input
                type="text"
                value={aiFilterModel === 'ALL' ? '' : aiFilterModel}
                onChange={(e) => setAiFilterModel(e.target.value.trim() ? e.target.value : 'ALL')}
                placeholder="Lọc theo Model (vd: gemini-2.5)..."
                style={{
                  minHeight: '44px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                }}
              />
              <input
                type="date"
                value={aiFilterFrom}
                onChange={(e) => setAiFilterFrom(e.target.value)}
                aria-label="Từ ngày"
                style={{
                  minHeight: '44px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                }}
              />
              <input
                type="date"
                value={aiFilterTo}
                onChange={(e) => setAiFilterTo(e.target.value)}
                aria-label="Đến ngày"
                style={{
                  minHeight: '44px',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                }}
              />
              <button
                type="button"
                onClick={() => loadOps()}
                style={{
                  minHeight: '44px',
                  padding: '0.5rem 0.9rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                }}
              >
                <RefreshIcon size={14} />
                <span>Lọc Nhật Ký</span>
              </button>
            </div>

            {aiLogs.length > 0 ? (
              <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      <th style={{ padding: '0.6rem' }}>Thời Gian</th>
                      <th style={{ padding: '0.6rem' }}>Game</th>
                      <th style={{ padding: '0.6rem' }}>Model / Provider</th>
                      <th style={{ padding: '0.6rem' }}>Thao Tác</th>
                      <th style={{ padding: '0.6rem' }}>Trạng Thái</th>
                      <th style={{ padding: '0.6rem' }}>Tokens (In / Out / Tổng)</th>
                      <th style={{ padding: '0.6rem' }}>Chi Phí (USD)</th>
                      <th style={{ padding: '0.6rem' }}>Độ Trễ</th>
                      <th style={{ padding: '0.6rem' }}>Số Câu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiLogs.map((log) => {
                      const hasTokens =
                        log.total_tokens !== null && log.total_tokens !== undefined;
                      const hasCost =
                        log.estimated_cost_usd !== null && log.estimated_cost_usd !== undefined;
                      return (
                        <tr key={log.log_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {new Date(log.created_at).toLocaleString('vi-VN')}
                          </td>
                          <td style={{ padding: '0.6rem', maxWidth: '200px' }}>
                            {log.game_id ? (
                              <div>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {log.game_title || log.game_id}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  {log.game_id}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>Chưa gắn game</span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            <div>{log.model}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{log.provider}</div>
                          </td>
                          <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 700 }}>{log.operation}</div>
                            {log.asset_slot && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--accent-sky)', fontWeight: 700 }}>
                                Slot: {log.asset_slot}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                padding: '0.15rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                backgroundColor: log.status === 'SUCCESS' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: log.status === 'SUCCESS' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                              }}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td style={{ padding: '0.6rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                            {hasTokens ? (
                              <span>
                                {log.input_tokens ?? '?'} / {log.output_tokens ?? '?'} / <strong>{log.total_tokens}</strong>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>Chưa xác định</span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                            {hasCost ? (
                              <span>${Number(log.estimated_cost_usd).toFixed(6)}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>Chưa xác định</span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{log.latency_ms} ms</td>
                          <td style={{ padding: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{log.generated_questions}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Chưa có nhật ký AI được ghi nhận theo bộ lọc hiện tại.
              </p>
            )}
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA GAME (Thay thế window.confirm - Issue UX-03) */}
      {deleteConfirmGame && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !processingGameId) {
              setDeleteConfirmGame(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              maxWidth: '460px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-rose)',
                  flexShrink: 0,
                }}
              >
                <TrashIcon size={22} />
              </div>
              <h3 id="confirm-delete-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Xác Nhận Xóa Bộ Câu Hỏi
              </h3>
            </div>
            <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn xóa vĩnh viễn bộ câu hỏi <strong>"{deleteConfirmGame.title}"</strong> (ID: {deleteConfirmGame.gameId}) không? Thao tác này không thể hoàn tác.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={Boolean(processingGameId)}
                onClick={() => setDeleteConfirmGame(null)}
                style={{
                  minHeight: '44px',
                  padding: '0.65rem 1.25rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                }}
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                disabled={Boolean(processingGameId)}
                onClick={() => executeDeleteGame(deleteConfirmGame)}
                style={{
                  minHeight: '44px',
                  padding: '0.65rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {processingGameId ? <SpinnerIcon size={16} /> : <TrashIcon size={16} />}
                {processingGameId ? 'Đang Xóa...' : 'Xác Nhận Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
