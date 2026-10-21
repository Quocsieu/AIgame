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
  fetchAdminAiLogs,
  fetchAdminGames,
  fetchAdminOverview,
  fetchAdminRooms,
  fetchAdminUsers,
  updateAdminGameStatus,
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

type AdminTab = 'overview' | 'users' | 'games' | 'ops';

export const AdminPage: React.FC<AdminPageProps> = ({
  currentUser,
  onNavigateHome,
}) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const isUserAdmin = currentUser?.role === 'ADMIN';

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
    if (!currentUser || !isUserAdmin) return;

    if (activeTab === 'overview') {
      loadOverview();
    } else if (activeTab === 'users') {
      loadUsers();
    } else if (activeTab === 'games') {
      loadGames();
    } else if (activeTab === 'ops') {
      loadOps();
    }
  }, [activeTab, currentUser, isUserAdmin]);

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

  const loadOps = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [roomsData, logsData] = await Promise.all([
        fetchAdminRooms(),
        fetchAdminAiLogs(),
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

  // 1. Trường hợp chưa đăng nhập / chưa có phiên Admin
  if (!currentUser) {
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

  // 2. Trường hợp đã đăng nhập nhưng không có vai trò ADMIN
  if (!isUserAdmin) {
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
          Tài khoản hiện tại <strong>{currentUser.email}</strong> có vai trò <strong>{currentUser.role}</strong>. Bạn không có quyền truy cập khu vực Quản trị Admin.
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

  // 3. Trường hợp là ADMIN hợp lệ
  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1rem 0' }}>
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
              color: 'var(--text-primary)',
            }}
          >
            <ShieldIcon size={24} style={{ color: 'var(--primary)' }} />
            <span>Quản Trị Hệ Thống (Admin Panel)</span>
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Quản lý người dùng, kiểm duyệt bộ câu hỏi và theo dõi hạ tầng thời gian thực.
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
          {[
            { id: 'overview', label: 'Tổng Quan', icon: <BarChartIcon size={15} /> },
            { id: 'users', label: 'Người Dùng', icon: <UsersIcon size={15} /> },
            { id: 'games', label: 'Kiểm Duyệt Game', icon: <GamepadIcon size={15} /> },
            { id: 'ops', label: 'Vận Hành & AI', icon: <CpuIcon size={15} /> },
          ].map((tab) => {
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
                  color: isCurrent ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: 700,
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
              { label: 'Tổng Người Dùng', val: overview.totalUsers, icon: <UsersIcon size={20} />, color: '#38bdf8' },
              { label: 'Tổng Bộ Câu Hỏi', val: overview.totalGames, icon: <GamepadIcon size={20} />, color: '#818cf8' },
              { label: 'Game Đã Xuất Bản', val: overview.publishedGames, icon: <GlobeIcon size={20} />, color: '#34d399' },
              { label: 'Bản Nháp (Draft)', val: overview.draftGames, icon: <FileTextIcon size={20} />, color: '#fbbf24' },
              { label: 'Lượt Chơi Đơn', val: overview.totalSessions, icon: <TargetIcon size={20} />, color: '#f472b6' },
              { label: 'Phòng Multiplayer Đang Mở', val: overview.activeRoomsCount, icon: <FlameIcon size={20} />, color: '#fb7185' },
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
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CpuIcon size={20} style={{ color: 'var(--accent-sky)' }} />
              <span>Nhật Ký Hoạt Động AI Gần Đây ({aiLogs.length})</span>
            </h3>
            {aiLogs.length > 0 ? (
              <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      <th style={{ padding: '0.6rem' }}>Thời Gian</th>
                      <th style={{ padding: '0.6rem' }}>Model / Provider</th>
                      <th style={{ padding: '0.6rem' }}>Thao Tác</th>
                      <th style={{ padding: '0.6rem' }}>Trạng Thái</th>
                      <th style={{ padding: '0.6rem' }}>Độ Trễ</th>
                      <th style={{ padding: '0.6rem' }}>Số Câu Tạo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiLogs.map((log) => (
                      <tr key={log.log_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(log.created_at).toLocaleTimeString('vi-VN')}
                        </td>
                        <td style={{ padding: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{log.model}</td>
                        <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{log.operation}</td>
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
                        <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{log.latency_ms} ms</td>
                        <td style={{ padding: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{log.generated_questions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Chưa có nhật ký AI được ghi nhận.
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
