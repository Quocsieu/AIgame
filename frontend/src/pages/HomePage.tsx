import React, { useEffect, useMemo, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { useToast } from '../components/ToastContext.js';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BarChartIcon,
  BookOpenIcon,
  CheckIcon,
  FileTextIcon,
  GamepadIcon,
  GlobeIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SparklesIcon,
  SpinnerIcon,
  UploadIcon,
  UsersIcon,
  XMarkIcon,
} from '../components/Icons.js';
import {
  createRoom,
  fetchGameById,
  fetchSavedGames,
  publishGame,
} from '../services/api.js';
import {
  formatGameTypeName,
  GameCoverIllustration,
  GameFormatIllustration,
  type LibraryFilterPreset,
} from './AnalyticsPage.js';
import type {
  AuthenticatedUser,
  GameSpecification,
  GameType,
  PersistedGameSummary,
} from '../types/index.js';

interface HomePageProps {
  currentUser?: AuthenticatedUser | null;
  onNavigateToCreate: (gameType?: GameType, sourceTab?: 'URL' | 'FILE' | 'TOPIC') => void;
  onNavigateToLibrary?: (preset?: LibraryFilterPreset) => void;
  onNavigateToAnalytics?: () => void;
  onNavigateToReports?: () => void;
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToSoloPresentation?: (spec: GameSpecification) => void;
  onSelectSavedGame?: (spec: GameSpecification, autoStartSolo?: boolean) => void;
  onNavigateToAdmin?: () => void;
  onNavigateToJoin?: (roomCode?: string) => void;
}

const MultipleChoiceIllustration: React.FC = () => <GameFormatIllustration type="MULTIPLE_CHOICE" />;
const QuickButtonIllustration: React.FC = () => <GameFormatIllustration type="QUICK_BUTTON" />;
const FillInBlankIllustration: React.FC = () => <GameFormatIllustration type="FILL_IN_THE_BLANK" />;
const PuzzleIllustration: React.FC = () => <GameFormatIllustration type="PUZZLE" />;
const SliderIllustration: React.FC = () => <GameFormatIllustration type="SLIDER" />;
const AdventureIllustration: React.FC = () => <GameFormatIllustration type="ADVENTURE" />;

interface FormatMeta {
  type: GameType;
  title: string;
  shortDesc: string;
  badge: string;
  accent: string;
  badgeBg: string;
  illustration: React.ReactNode;
}

const GAME_FORMATS: FormatMeta[] = [
  {
    type: 'MULTIPLE_CHOICE',
    title: 'Quiz — Trắc nghiệm 4 màu',
    shortDesc: 'Câu hỏi 4 đáp án A/B/C/D trực quan để thi đấu tốc độ hoặc ôn tập lớp học.',
    badge: 'Ưu tiên #1 • Quiz',
    accent: 'var(--accent-rose)',
    badgeBg: 'var(--accent-rose-subtle)',
    illustration: <MultipleChoiceIllustration />,
  },
  {
    type: 'QUICK_BUTTON',
    title: 'True/False — Đúng hoặc Sai',
    shortDesc: 'Phản xạ quyết định nhanh Đúng hoặc Sai với các mệnh đề nhận định trọng tâm.',
    badge: 'Ưu tiên #2 • True/False',
    accent: 'var(--accent-sky)',
    badgeBg: 'var(--accent-sky-subtle)',
    illustration: <QuickButtonIllustration />,
  },
  {
    type: 'FILL_IN_THE_BLANK',
    title: 'Type Answer — Tự nhập đáp án',
    shortDesc: 'Người chơi tự gõ câu trả lời ngắn gọn, ghi nhớ chính xác khái niệm và thuật ngữ.',
    badge: 'Ưu tiên #3 • Type Answer',
    accent: 'var(--accent-amber)',
    badgeBg: 'var(--accent-amber-subtle)',
    illustration: <FillInBlankIllustration />,
  },
  {
    type: 'PUZZLE',
    title: 'Puzzle — Sắp xếp thứ tự',
    shortDesc: 'Sắp xếp các bước quy trình, sự kiện hoặc cấp độ theo đúng trình tự logic.',
    badge: 'Ưu tiên #4 • Puzzle',
    accent: 'var(--accent-emerald)',
    badgeBg: 'var(--accent-emerald-subtle)',
    illustration: <PuzzleIllustration />,
  },
  {
    type: 'SLIDER',
    title: 'Slider — Thanh trượt giá trị',
    shortDesc: 'Kéo thanh trượt để chọn con số, mốc năm, tỷ lệ hoặc thông số định lượng chính xác.',
    badge: 'Ưu tiên #5 • Slider',
    accent: 'var(--accent-violet)',
    badgeBg: 'var(--accent-violet-subtle)',
    illustration: <SliderIllustration />,
  },
  {
    type: 'ADVENTURE',
    title: 'Đi cảnh theo ngành nghề',
    shortDesc: 'Nhập vai xử lý tình huống thực tế theo từng lĩnh vực và ngành nghề.',
    badge: 'Nhập vai 2D',
    accent: 'var(--accent-coral, var(--accent-amber))',
    badgeBg: 'var(--accent-coral-subtle, var(--accent-amber-subtle))',
    illustration: <AdventureIllustration />,
  },
];

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  onNavigateToCreate,
  onNavigateToLibrary,
  onNavigateToAnalytics,
  onNavigateToHost,
  onNavigateToSoloPresentation,
  onSelectSavedGame,
  onNavigateToJoin,
}) => {
  const toast = useToast();

  const [savedGames, setSavedGames] = useState<PersistedGameSummary[]>([]);
  const [myOwnedGames, setMyOwnedGames] = useState<PersistedGameSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [repoCounts, setRepoCounts] = useState<{
    totalAll: number;
    publishedCount: number;
    draftCount: number;
    ownedCount: number;
    activeCount?: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [remoteSearchGames, setRemoteSearchGames] = useState<PersistedGameSummary[] | null>(null);

  // Modal chọn chế độ chơi (Chơi đơn / Mở phòng Multiplayer)
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [modeModalSpec, setModeModalSpec] = useState<GameSpecification | null>(null);
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);

  const canManageGame = (game: { ownerUserId?: string | null } | null | undefined): boolean => {
    if (!game) return false;
    if (currentUser?.role === 'ADMIN') return true;
    if (currentUser?.userId) {
      return game.ownerUserId === currentUser.userId;
    }
    return !game.ownerUserId;
  };

  const loadDashboardGames = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [manageRes, mineRes] = await Promise.all([
        fetchSavedGames({
          limit: 40,
          offset: 0,
          scope: 'manage',
          status: 'ALL',
        }),
        fetchSavedGames({
          limit: 12,
          offset: 0,
          scope: 'mine',
          status: 'ALL',
        }).catch(() => null),
      ]);
      setSavedGames(manageRes.games || []);
      setMyOwnedGames(mineRes?.games || []);
      if (manageRes.counts) {
        setRepoCounts(manageRes.counts);
      }
      setTotalCount(
        manageRes.counts?.totalAll ??
          manageRes.total ??
          (manageRes.games ? manageRes.games.length : 0)
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải dữ liệu bảng điều khiển.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardGames();
  }, [currentUser?.userId]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setRemoteSearchGames(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchSavedGames({
        search: q,
        limit: 24,
        offset: 0,
        scope: 'manage',
      })
        .then((res) => {
          if (!cancelled) {
            setRemoteSearchGames(res.games || []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRemoteSearchGames(null);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleOpenGameModal = async (gameId: string) => {
    setLoadingGameId(gameId);
    try {
      const spec = await fetchGameById(gameId, { mode: 'manage' });
      setModeModalSpec(spec);
      setIsModeModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải bộ câu hỏi để mở game.', 'Lỗi mở game');
    } finally {
      setLoadingGameId(null);
    }
  };

  const handleEditOrInspectGame = async (gameId: string) => {
    setLoadingGameId(gameId);
    try {
      const spec = await fetchGameById(gameId, { mode: 'manage' });
      if (onSelectSavedGame && canManageGame(spec)) {
        onSelectSavedGame(spec, false);
      } else {
        onNavigateToLibrary?.({ search: spec.title, nonce: Date.now() });
      }
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở chi tiết bộ câu hỏi.', 'Lỗi');
    } finally {
      setLoadingGameId(null);
    }
  };

  // Thống kê thực tế từ toàn bộ kho dữ liệu hệ thống (không bị giới hạn ở 40 bản ghi trang đầu)
  const stats = useMemo(() => {
    const published =
      repoCounts?.publishedCount ?? savedGames.filter((g) => g.isPublic).length;
    const draft =
      repoCounts?.draftCount ?? savedGames.filter((g) => !g.isPublic).length;
    const active =
      repoCounts?.activeCount ??
      savedGames.filter(
        (g) => g.activeStatus?.hasActiveRoom || g.activeStatus?.hasActiveSession
      ).length;
    return { published, draft, active };
  }, [repoCounts, savedGames]);

  // Tìm kiếm trực tiếp trên dữ liệu thật (kết hợp backend search và local filter)
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedSearch) return [];
    const localMatches = savedGames.filter((g) => {
      const inTitle = g.title.toLowerCase().includes(trimmedSearch);
      const inDesc = (g.description || '').toLowerCase().includes(trimmedSearch);
      const inIndustry = (g.adventureConfig?.industryLabel || '').toLowerCase().includes(trimmedSearch);
      const inType = formatGameTypeName(g.gameType).toLowerCase().includes(trimmedSearch);
      return inTitle || inDesc || inIndustry || inType;
    });
    if (!remoteSearchGames || remoteSearchGames.length === 0) {
      return localMatches;
    }
    const mergedMap = new Map<string, PersistedGameSummary>();
    for (const g of remoteSearchGames) {
      mergedMap.set(g.gameId, g);
    }
    for (const g of localMatches) {
      if (!mergedMap.has(g.gameId)) {
        mergedMap.set(g.gameId, g);
      }
    }
    return Array.from(mergedMap.values());
  }, [savedGames, remoteSearchGames, trimmedSearch]);

  // Kệ "Thư viện của bạn / Game gần đây": chỉ lấy game thuộc quyền sở hữu của người dùng (hoặc kho demo khi chưa đăng nhập), tuyệt đối không trộn game công khai của người khác
  const recentGames = useMemo(() => {
    const sourcePool =
      myOwnedGames.length > 0
        ? myOwnedGames
        : savedGames.filter((g) =>
            currentUser?.userId
              ? g.ownerUserId === currentUser.userId
              : !g.ownerUserId
          );
    return [...sourcePool]
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      )
      .slice(0, 4);
  }, [myOwnedGames, savedGames, currentUser?.userId]);

  // Nội dung nổi bật / Đã xuất bản sẵn sàng chơi ngay (isPublic === true)
  const publishedReadyGames = useMemo(() => {
    return [...savedGames]
      .filter((g) => g.isPublic)
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      )
      .slice(0, 4);
  }, [savedGames]);

  // Chủ đề ngành nghề thực tế từ các game đã tạo
  const availableIndustries = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>();
    for (const g of savedGames) {
      const id = g.adventureConfig?.industryId;
      const label = g.adventureConfig?.industryLabel;
      if (id && label) {
        const existing = map.get(id);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(id, { id, label, count: 1 });
        }
      }
    }
    return Array.from(map.values());
  }, [savedGames]);

  const handleSearchFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div
      className="home-dashboard-root"
      style={{
        minHeight: 'calc(100vh - 58px)',
        width: '100%',
        maxWidth: '1440px',
        margin: '0 auto',
        boxSizing: 'border-box',
        padding: 'clamp(16px, 2.2vw, 28px) clamp(16px, 2.5vw, 32px) 48px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      <style>{`
        .home-dashboard-root {
          --home-cover-bg: #111628;
          --home-cover-secondary: #182038;
          --home-cover-panel: #1d2642;
          --discover-cover-bg: #111628;
          --discover-cover-secondary: #182038;
          --discover-cover-panel: #1d2642;
          --cover-mc-bg: #191224;
          --cover-mc-secondary: #251936;
          --cover-qb-bg: #0f192f;
          --cover-qb-secondary: #172647;
          --cover-fill-bg: #1d1612;
          --cover-fill-secondary: #2b2018;
          --cover-cross-bg: #0d1f1e;
          --cover-cross-secondary: #142e2c;
          --cover-mixed-bg: #16132b;
          --cover-mixed-secondary: #211c40;
          --cover-adv-bg: #12182b;
          --cover-adv-secondary: #1b243f;
          --cover-ink-strong: #f8fafc;
          --cover-ink-muted: #94a3b8;
          --discover-cover-badge-bg: rgba(9, 12, 21, 0.9);
          --discover-cover-badge-text: #f8fafc;
          --discover-cover-badge-border: rgba(255, 255, 255, 0.18);
          --discover-status-pub-bg: rgba(6, 78, 59, 0.94);
          --discover-status-pub-text: #6ee7b7;
          --discover-status-pub-border: rgba(16, 185, 129, 0.45);
          --discover-status-draft-bg: rgba(120, 53, 15, 0.94);
          --discover-status-draft-text: #fcd34d;
          --discover-status-draft-border: rgba(245, 158, 11, 0.45);
        }
        [data-theme="light"] .home-dashboard-root {
          --primary: #0284c7;
          --primary-hover: #0369a1;
          --primary-active: #075985;
          --primary-subtle: #e0f2fe;
          --primary-ink: #ffffff;
          --accent-sky: #0369a1;
          --accent-sky-subtle: #e0f2fe;
          --accent-emerald: #047857;
          --accent-emerald-subtle: #d1fae5;
          --accent-amber: #b45309;
          --accent-amber-subtle: #fef3c7;
          --accent-rose: #be123c;
          --accent-rose-subtle: #ffe4e6;
          --accent-violet: #862e9c;
          --accent-violet-subtle: #f3d9fa;
          --accent-teal: #0f766e;
          --accent-teal-subtle: #ccfbf1;
          --accent-coral: #c2410c;
          --accent-coral-subtle: #ffedd5;
          --home-cover-bg: #eaf1fb;
          --home-cover-secondary: #dbe6f6;
          --home-cover-panel: #ffffff;
          --discover-cover-bg: #eaf1fb;
          --discover-cover-secondary: #dbe6f6;
          --discover-cover-panel: #ffffff;
          --cover-mc-bg: #fff1f3;
          --cover-mc-secondary: #ffe0e6;
          --cover-qb-bg: #eff6ff;
          --cover-qb-secondary: #dbeafe;
          --cover-fill-bg: #fffbeb;
          --cover-fill-secondary: #fef3c7;
          --cover-cross-bg: #ecfdf5;
          --cover-cross-secondary: #d1fae5;
          --cover-mixed-bg: #f5f3ff;
          --cover-mixed-secondary: #ede9fe;
          --cover-adv-bg: #f0f6ff;
          --cover-adv-secondary: #e0ecff;
          --cover-ink-strong: #0f172a;
          --cover-ink-muted: #475569;
          --discover-cover-badge-bg: rgba(255, 255, 255, 0.96);
          --discover-cover-badge-text: #0b1120;
          --discover-cover-badge-border: #bcc9e0;
          --discover-status-pub-bg: #ecfdf5;
          --discover-status-pub-text: #047857;
          --discover-status-pub-border: #6ee7b7;
          --discover-status-draft-bg: #fffbeb;
          --discover-status-draft-text: #b45309;
          --discover-status-draft-border: #fcd34d;
        }
      `}</style>

      {/* 1. HERO / WELCOME & 2. TÌM KIẾM VÀ KHÁM PHÁ */}
      <section
        aria-label="Chào mừng và tìm kiếm nhanh"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: 'clamp(18px, 2.4vw, 26px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div style={{ maxWidth: '720px' }}>
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color: 'var(--accent-sky)',
                marginBottom: '4px',
              }}
            >
              Bảng điều khiển trung tâm • AI Game Platform
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(1.38rem, 2.1vw, 1.7rem)',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: 'var(--text-primary)',
                lineHeight: 1.22,
              }}
            >
              Biên soạn học liệu tương tác & tổ chức phòng thi đấu trực tiếp
            </h1>
            <p
              style={{
                margin: '6px 0 0 0',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              Chuyển đổi tài liệu hoặc liên kết thành bộ câu hỏi tương tác bằng AI, khởi tạo game đi cảnh theo ngành nghề và mở phòng chơi bằng mã PIN hoặc QR.
            </p>
          </div>

          {/* Cụm CTA Chính & Phụ + Lối tắt thao tác */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              id="home-hero-create-btn"
              type="button"
              onClick={() => onNavigateToCreate()}
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink, #08090e)',
                border: '1px solid var(--primary)',
                borderRadius: '8px',
                padding: '0 16px',
                height: '40px',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <SparklesIcon size={15} />
              <span>Tạo game bằng AI</span>
            </button>

            {onNavigateToAnalytics && (
              <button
                id="home-hero-analytics-btn"
                type="button"
                onClick={onNavigateToAnalytics}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '40px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <GamepadIcon size={15} />
                <span>Khám phá</span>
              </button>
            )}

            {onNavigateToLibrary && (
              <button
                id="home-hero-library-btn"
                type="button"
                onClick={() => onNavigateToLibrary({ tab: 'ALL', nonce: Date.now() })}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '40px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <BookOpenIcon size={15} />
                <span>Thư viện</span>
              </button>
            )}

            {onNavigateToJoin && (
              <button
                id="home-hero-join-btn"
                type="button"
                onClick={() => onNavigateToJoin()}
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '0 12px',
                  height: '40px',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <UsersIcon size={15} />
                <span>Nhập mã PIN</span>
              </button>
            )}
          </div>
        </div>

        {/* 3 Lối tắt khởi tạo nhanh từ Nguồn dữ liệu: URL, File, Chủ đề */}
        <div
          aria-label="Lối tắt tạo game theo nguồn học liệu"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '10px',
          }}
        >
          <button
            id="home-shortcut-url"
            type="button"
            onClick={() => onNavigateToCreate(undefined, 'URL')}
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '7px',
                  backgroundColor: 'var(--accent-sky-subtle)',
                  color: 'var(--accent-sky)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <GlobeIcon size={16} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.83rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Tạo từ đường dẫn URL
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Trích xuất bài viết, tài liệu web
                </div>
              </div>
            </div>
            <ArrowRightIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>

          <button
            id="home-shortcut-file"
            type="button"
            onClick={() => onNavigateToCreate(undefined, 'FILE')}
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '7px',
                  backgroundColor: 'var(--accent-emerald-subtle)',
                  color: 'var(--accent-emerald)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <UploadIcon size={16} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.83rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Tạo từ File tài liệu
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Hỗ trợ PDF, DOCX, XLSX, CSV, TXT
                </div>
              </div>
            </div>
            <ArrowRightIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>

          <button
            id="home-shortcut-topic"
            type="button"
            onClick={() => onNavigateToCreate(undefined, 'TOPIC')}
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '7px',
                  backgroundColor: 'var(--accent-amber-subtle)',
                  color: 'var(--accent-amber)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FileTextIcon size={16} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.83rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Tạo theo Chủ đề học tập
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  AI tự biên soạn từ chủ đề yêu cầu
                </div>
              </div>
            </div>
            <ArrowRightIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        </div>

        {/* Hàng tìm kiếm trực tiếp + Divided KPI Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          <form
            onSubmit={handleSearchFormSubmit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
            }}
          >
            <div style={{ position: 'relative', flex: 1 }}>
              <span
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                  display: 'flex',
                }}
              >
                <SearchIcon size={15} />
              </span>
              <input
                id="home-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm nhanh bộ câu hỏi theo tên game, chủ đề hoặc thể loại..."
                aria-label="Tìm kiếm bộ câu hỏi trên Trang Chủ"
                style={{
                  width: '100%',
                  padding: '0 36px 0 36px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.88rem',
                  height: '40px',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  id="home-clear-search-btn"
                  type="button"
                  aria-label="Xóa từ khóa tìm kiếm"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  <XMarkIcon size={15} />
                </button>
              )}
            </div>
            {searchQuery.trim() && onNavigateToLibrary && (
              <button
                type="button"
                onClick={() => onNavigateToLibrary({ search: searchQuery.trim(), nonce: Date.now() })}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink, #08090e)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '40px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                Mở trong Thư viện
              </button>
            )}
          </form>

          {/* Divided KPI Summary Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '8px 12px', borderRight: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Tổng bộ câu hỏi</div>
              <div
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {totalCount}
              </div>
            </div>
            <div style={{ padding: '8px 12px', borderRight: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Đã xuất bản</div>
              <div
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--accent-emerald)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {stats.published}
              </div>
            </div>
            <div style={{ padding: '8px 12px', borderRight: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Bản nháp</div>
              <div
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: 'var(--accent-amber)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {stats.draft}
              </div>
            </div>
            <div style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Đang hoạt động</div>
              <div
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: stats.active > 0 ? 'var(--accent-sky)' : 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {stats.active}
              </div>
            </div>
          </div>
        </div>

        {/* Kết quả tìm kiếm trực tiếp trên Trang Chủ */}
        {trimmedSearch && (
          <div
            aria-label="Kết quả tìm kiếm nhanh"
            style={{
              paddingTop: '14px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Kết quả tìm kiếm cho "{searchQuery.trim()}" ({searchResults.length} bộ câu hỏi)
              </div>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-sky)',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Xóa tìm kiếm
              </button>
            </div>

            {searchResults.length === 0 ? (
              <div
                style={{
                  padding: '20px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px dashed var(--border-strong)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '0.86rem',
                }}
              >
                Không tìm thấy bộ câu hỏi nào khớp với từ khóa "{searchQuery.trim()}".{' '}
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-sky)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Xóa tìm kiếm
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: '12px',
                }}
              >
                {searchResults.slice(0, 6).map((item) => (
                  <div
                    key={`search-${item.gameId}`}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: 'var(--accent-sky)',
                            backgroundColor: 'var(--accent-sky-subtle)',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatGameTypeName(item.gameType)}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                          {item.questionCount} câu
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {item.title}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: item.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                        }}
                      >
                        {item.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleEditOrInspectGame(item.gameId)}
                          style={{
                            backgroundColor: 'transparent',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '0 8px',
                            height: '28px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {canManageGame(item) ? 'Sửa' : 'Chi tiết'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenGameModal(item.gameId)}
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: 'var(--primary-ink, #08090e)',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0 10px',
                            height: '28px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Mở Game
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Error Alert nếu không tải được danh sách game */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            fontWeight: 600,
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangleIcon size={16} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={loadDashboardGames}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--accent-rose)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* 3. CHỌN LOẠI GAME ĐỂ TẠO (6 ĐỊNH DẠNG THỰC TẾ) */}
      <section aria-label="Chọn thể loại để tạo trò chơi" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Chọn thể loại để bắt đầu tạo trò chơi
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              Nhấn nút Tạo trên bất kỳ loại game nào để mở trình khởi tạo câu hỏi từ tài liệu hoặc liên kết
            </p>
          </div>
          <span
            style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {GAME_FORMATS.length} định dạng hỗ trợ
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '14px',
          }}
        >
          {GAME_FORMATS.map((fmt) => (
            <article
              key={fmt.type}
              data-game-format-card={fmt.type}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigateToCreate(fmt.type)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onNavigateToCreate(fmt.type);
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '108px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    marginBottom: '10px',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  {fmt.illustration}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: fmt.badgeBg,
                      color: fmt.accent,
                    }}
                  >
                    {fmt.badge}
                  </span>
                  {onNavigateToLibrary && (
                    <button
                      type="button"
                      onClick={() => onNavigateToLibrary({ gameType: fmt.type, nonce: Date.now() })}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Xem trong Thư viện
                    </button>
                  )}
                </div>

                <h3 style={{ margin: '0 0 4px 0', fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {fmt.title}
                </h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {fmt.shortDesc}
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  paddingTop: '10px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  id={`create-format-btn-${fmt.type.toLowerCase()}`}
                  type="button"
                  onClick={() => onNavigateToCreate(fmt.type)}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-ink, #08090e)',
                    border: '1px solid var(--primary)',
                    borderRadius: '6px',
                    height: '34px',
                    padding: '0 12px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <PlusIcon size={14} />
                  <span>Tạo game</span>
                  <ArrowRightIcon size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 4. GAME GẦN ĐÂY (DỮ LIỆU THẬT TỪ HỆ THỐNG) */}
      <section
        aria-label="Game gần đây"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {currentUser?.userId ? 'Thư viện của bạn • Game gần đây' : 'Game gần đây (Kho học liệu chung)'}
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {currentUser?.userId
                ? 'Tiếp tục chỉnh sửa hoặc tổ chức chơi từ các bộ câu hỏi do bạn biên soạn'
                : 'Tiếp tục chỉnh sửa hoặc tổ chức chơi từ các bộ câu hỏi vừa được cập nhật'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={loadDashboardGames}
              disabled={isLoading}
              style={{
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '0 10px',
                height: '30px',
                fontSize: '0.76rem',
                fontWeight: 600,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {isLoading ? <SpinnerIcon size={12} /> : <RefreshIcon size={12} />}
              <span>Làm mới</span>
            </button>
            {onNavigateToLibrary && (
              <button
                type="button"
                onClick={() =>
                  onNavigateToLibrary({
                    tab: currentUser?.userId ? 'MINE' : 'ALL',
                    nonce: Date.now(),
                  })
                }
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-sky)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 0,
                }}
              >
                <span>Mở toàn bộ Thư viện</span>
                <ArrowRightIcon size={13} />
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
              gap: '14px',
            }}
          >
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={`recent-skeleton-${idx}`}
                style={{
                  height: '220px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            ))}
          </div>
        ) : recentGames.length === 0 ? (
          <div
            style={{
              padding: '28px 18px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px dashed var(--border-strong)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '0.86rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div>
              {currentUser?.userId
                ? 'Bạn chưa tạo bộ câu hỏi nào trong thư viện cá nhân. Hãy bắt đầu biên soạn game đầu tiên hoặc khám phá các học liệu công khai bên dưới.'
                : 'Chưa có bộ câu hỏi nào được lưu trong hệ thống. Hãy chọn một thể loại phía trên để tạo game đầu tiên.'}
            </div>
            <button
              type="button"
              onClick={() => onNavigateToCreate()}
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink, #08090e)',
                border: 'none',
                borderRadius: '6px',
                padding: '0 14px',
                height: '34px',
                fontSize: '0.8rem',
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
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
              gap: '14px',
            }}
          >
            {recentGames.map((game) => (
              <article
                key={`home-recent-${game.gameId}`}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenGameModal(game.gameId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenGameModal(game.gameId);
                      }
                    }}
                    style={{
                      position: 'relative',
                      height: '116px',
                      width: '100%',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <GameCoverIllustration game={game} />
                    <div
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        right: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '6px',
                        pointerEvents: 'none',
                      }}
                    >
                      <span
                        style={{
                          backgroundColor: 'var(--discover-cover-badge-bg, rgba(8, 9, 14, 0.88))',
                          color: 'var(--discover-cover-badge-text, #f2f4f8)',
                          border: '1px solid var(--discover-cover-badge-border, rgba(255, 255, 255, 0.16))',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        {formatGameTypeName(game.gameType)}
                      </span>
                      <span
                        style={{
                          backgroundColor: game.isPublic
                            ? 'var(--discover-status-pub-bg, rgba(6, 78, 59, 0.92))'
                            : 'var(--discover-status-draft-bg, rgba(120, 53, 15, 0.92))',
                          color: game.isPublic
                            ? 'var(--discover-status-pub-text, #76d6ad)'
                            : 'var(--discover-status-draft-text, #f3c75f)',
                          border: game.isPublic
                            ? '1px solid var(--discover-status-pub-border, rgba(16, 185, 129, 0.42))'
                            : '1px solid var(--discover-status-draft-border, rgba(245, 158, 11, 0.42))',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '4px',
                        }}
                      >
                        {game.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
                      </span>
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px 8px' }}>
                    <h3
                      style={{
                        margin: '0 0 4px 0',
                        fontSize: '0.94rem',
                        fontWeight: 800,
                        color: 'var(--text-primary)',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={game.title}
                    >
                      {game.title}
                    </h3>
                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: 'var(--text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {game.questionCount} câu hỏi • {game.timePerQuestion || 15}s/câu
                      {game.adventureConfig?.industryLabel ? ` • ${game.adventureConfig.industryLabel}` : ''}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: '8px 14px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <button
                    type="button"
                    disabled={loadingGameId === game.gameId}
                    onClick={() => handleOpenGameModal(game.gameId)}
                    style={{
                      flex: 1,
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-ink, #08090e)',
                      border: '1px solid var(--primary)',
                      borderRadius: '6px',
                      height: '32px',
                      padding: '0 10px',
                      fontWeight: 800,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                    }}
                  >
                    <GamepadIcon size={13} />
                    <span>{loadingGameId === game.gameId ? 'Đang nạp...' : 'Mở Game'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEditOrInspectGame(game.gameId)}
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      height: '32px',
                      padding: '0 10px',
                      fontWeight: 700,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <PencilIcon size={12} />
                    <span>{canManageGame(game) ? 'Sửa' : 'Chi tiết'}</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 5. NỘI DUNG NỔI BẬT / KHÁM PHÁ NỘI DUNG SẴN SÀNG TỔ CHỨC THI ĐẤU */}
      <section
        aria-label="Khám phá nội dung đã xuất bản"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Nội dung đã xuất bản & Chủ đề khám phá
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Các bộ câu hỏi công khai sẵn sàng chơi đơn hoặc mở phòng trực tiếp ngay lập tức
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {onNavigateToAnalytics && (
              <button
                type="button"
                onClick={onNavigateToAnalytics}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 0,
                }}
              >
                <span>Mở trang Khám phá</span>
                <ArrowRightIcon size={13} />
              </button>
            )}
            {onNavigateToLibrary && (
              <button
                type="button"
                onClick={() => onNavigateToLibrary({ tab: 'PUBLISHED', nonce: Date.now() })}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-sky)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 0,
                }}
              >
                <span>Xem trong Thư viện</span>
                <ArrowRightIcon size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Các chủ đề ngành nghề thực tế nếu có */}
        {availableIndustries.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Chủ đề ngành nghề:
            </span>
            {availableIndustries.map((ind) => (
              <button
                key={`home-ind-${ind.id}`}
                type="button"
                onClick={() => onNavigateToLibrary?.({ industry: ind.id, nonce: Date.now() })}
                style={{
                  height: '28px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{ind.label}</span>
                <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  ({ind.count})
                </span>
              </button>
            ))}
          </div>
        )}

        {!isLoading && publishedReadyGames.length === 0 ? (
          <div
            style={{
              padding: '22px 16px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px dashed var(--border-strong)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '0.84rem',
            }}
          >
            Hiện chưa có bộ câu hỏi nào ở trạng thái <strong style={{ color: 'var(--text-primary)' }}>Đã xuất bản</strong>. Bạn có thể xuất bản một bản nháp trong Thư viện để tổ chức thi đấu trực tiếp.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              gap: '12px',
            }}
          >
            {publishedReadyGames.map((item) => (
              <div
                key={`home-pub-${item.gameId}`}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenGameModal(item.gameId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenGameModal(item.gameId);
                      }
                    }}
                    style={{
                      position: 'relative',
                      height: '104px',
                      width: '100%',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <GameCoverIllustration game={item} />
                    <span
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: 'var(--discover-status-pub-text, #76d6ad)',
                        backgroundColor: 'var(--discover-status-pub-bg, rgba(6, 78, 59, 0.92))',
                        border: '1px solid var(--discover-status-pub-border, rgba(16, 185, 129, 0.42))',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <CheckIcon size={10} />
                      <span>Sẵn sàng chơi</span>
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '6px',
                        right: '8px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: 'var(--discover-cover-badge-text, #f2f4f8)',
                        backgroundColor: 'var(--discover-cover-badge-bg, rgba(8, 9, 14, 0.88))',
                        border: '1px solid var(--discover-cover-badge-border, rgba(255, 255, 255, 0.16))',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {item.questionCount} câu • {formatGameTypeName(item.gameType)}
                    </span>
                  </div>
                  <div style={{ padding: '12px 14px 6px' }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '6px 14px 12px', display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenGameModal(item.gameId)}
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-ink, #060913)',
                      border: '1px solid var(--primary)',
                      borderRadius: '6px',
                      padding: '0 10px',
                      height: '28px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Chơi / Mở phòng
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal chọn chế độ chơi (Chơi đơn / Mở phòng Multiplayer) */}
      <GameModeSelectionModal
        isOpen={isModeModalOpen}
        onClose={() => setIsModeModalOpen(false)}
        gameSpec={modeModalSpec}
        onStartSoloPresentation={(spec) => {
          setIsModeModalOpen(false);
          if (onNavigateToSoloPresentation) {
            onNavigateToSoloPresentation(spec);
          } else if (onSelectSavedGame) {
            onSelectSavedGame(spec, true);
          }
        }}
        onCreateMultiplayerRoom={async (spec) => {
          try {
            const roomData = await createRoom({
              gameId: spec.gameId,
              capacity: 300,
              requirePublished: true,
            });
            return {
              roomCode: roomData.roomCode,
              hostToken: roomData.hostToken,
              joinUrl: roomData.joinUrl,
            };
          } catch (err: any) {
            toast.error(err.message || 'Không thể tạo phòng chơi.', 'Lỗi tạo phòng');
            return null;
          }
        }}
        onPublishGame={async (gameId) => {
          try {
            await publishGame(gameId);
            toast.success('Đã xuất bản game công khai thành công!', 'Xuất bản thành công');
            loadDashboardGames();
            return true;
          } catch (err: any) {
            toast.error(err.message || 'Không thể xuất bản game.', 'Lỗi xuất bản');
            return false;
          }
        }}
        onNavigateToHost={onNavigateToHost}
        isOwner={canManageGame(modeModalSpec)}
      />
    </div>
  );
};
