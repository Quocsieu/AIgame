import React, { useEffect, useMemo, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { useToast } from '../components/ToastContext.js';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BarChartIcon,
  BookOpenIcon,
  CheckIcon,
  GamepadIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
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
  type LibraryFilterPreset,
} from './AnalyticsPage.js';
import type {
  GameSpecification,
  GameType,
  PersistedGameSummary,
} from '../types/index.js';

interface HomePageProps {
  onNavigateToCreate: (gameType?: GameType) => void;
  onNavigateToLibrary?: (preset?: LibraryFilterPreset) => void;
  onNavigateToAnalytics?: () => void;
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToSoloPresentation?: (spec: GameSpecification) => void;
  onSelectSavedGame?: (spec: GameSpecification, autoStartSolo?: boolean) => void;
  onNavigateToAdmin?: () => void;
  onNavigateToJoin?: (roomCode?: string) => void;
}

const MultipleChoiceIllustration: React.FC = () => (
  <svg viewBox="0 0 200 108" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="108" rx="6" fill="var(--home-cover-bg, #12151c)" />
    <rect x="18" y="12" width="164" height="26" rx="5" fill="var(--home-cover-panel, #191e28)" stroke="var(--border-subtle)" strokeWidth="1.2" />
    <circle cx="31" cy="25" r="5" fill="#3578d4" />
    <rect x="44" y="20" width="76" height="4" rx="2" fill="#94a3b8" />
    <rect x="44" y="27" width="44" height="3" rx="1.5" fill="#64748b" />
    <rect x="18" y="46" width="78" height="22" rx="4" fill="#e09b2d" fillOpacity="0.9" />
    <path d="M30 53L26 60H34L30 53Z" fill="#ffffff" />
    <rect x="40" y="55" width="42" height="4" rx="2" fill="#ffffff" fillOpacity="0.9" />
    <rect x="104" y="46" width="78" height="22" rx="4" fill="#3578d4" fillOpacity="0.9" />
    <path d="M116 53L120 57L116 61L112 57Z" fill="#ffffff" />
    <rect x="126" y="55" width="42" height="4" rx="2" fill="#ffffff" fillOpacity="0.9" />
    <rect x="18" y="74" width="78" height="22" rx="4" fill="var(--home-cover-panel, #191e28)" stroke="#64748b" strokeWidth="1.2" />
    <circle cx="30" cy="85" r="4" fill="#64748b" />
    <rect x="40" y="83" width="42" height="4" rx="2" fill="#64748b" />
    <rect x="104" y="74" width="78" height="22" rx="4" fill="#2ea87e" fillOpacity="0.9" />
    <rect x="112" y="81" width="8" height="8" rx="1.5" fill="#ffffff" />
    <rect x="126" y="83" width="42" height="4" rx="2" fill="#ffffff" fillOpacity="0.9" />
  </svg>
);

const QuickButtonIllustration: React.FC = () => (
  <svg viewBox="0 0 200 108" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="108" rx="6" fill="var(--home-cover-bg, #12151c)" />
    <g transform="translate(20, 26)">
      <rect width="74" height="56" rx="6" fill="#2ea87e" fillOpacity="0.9" />
      <path d="M46 25L53 32L66 19" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" transform="translate(-18, 0)" />
      <text x="37" y="46" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="800" letterSpacing="0.05em">ĐÚNG</text>
    </g>
    <g transform="translate(106, 26)">
      <rect width="74" height="56" rx="6" fill="#e09b2d" fillOpacity="0.9" />
      <path d="M31 19L43 31M43 19L31 31" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <text x="37" y="46" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="800" letterSpacing="0.05em">SAI</text>
    </g>
  </svg>
);

const FillInBlankIllustration: React.FC = () => (
  <svg viewBox="0 0 200 108" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="108" rx="6" fill="var(--home-cover-bg, #12151c)" />
    <rect x="18" y="22" width="164" height="32" rx="6" fill="var(--home-cover-panel, #191e28)" stroke="#e09b2d" strokeWidth="1.2" />
    <rect x="28" y="35" width="44" height="6" rx="3" fill="#64748b" />
    <rect x="80" y="28" width="52" height="20" rx="4" fill="#e09b2d" fillOpacity="0.2" stroke="#e09b2d" strokeWidth="1.4" strokeDasharray="3 2" />
    <rect x="140" y="35" width="30" height="6" rx="3" fill="#64748b" />
    <g transform="translate(64, 66)">
      <rect width="72" height="26" rx="5" fill="#e09b2d" />
      <text x="36" y="17" textAnchor="middle" fill="#08090e" fontSize="10" fontWeight="800">ĐÁP ÁN</text>
    </g>
  </svg>
);

const CrosswordIllustration: React.FC = () => (
  <svg viewBox="0 0 200 108" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="108" rx="6" fill="var(--home-cover-bg, #12151c)" />
    <g transform="translate(40, 16)">
      <rect x="0" y="0" width="26" height="26" rx="4" fill="var(--home-cover-panel, #191e28)" stroke="#2ea87e" strokeWidth="1.2" />
      <text x="13" y="18" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="800">Q</text>
      <rect x="30" y="0" width="26" height="26" rx="4" fill="var(--home-cover-panel, #191e28)" stroke="#2ea87e" strokeWidth="1.2" />
      <text x="43" y="18" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="800">U</text>
      <rect x="60" y="0" width="26" height="26" rx="4" fill="#2ea87e" />
      <text x="73" y="18" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="800">I</text>
      <rect x="90" y="0" width="26" height="26" rx="4" fill="var(--home-cover-panel, #191e28)" stroke="#2ea87e" strokeWidth="1.2" />
      <text x="103" y="18" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="800">Z</text>
    </g>
    <g transform="translate(100, 46)">
      <rect x="0" y="0" width="26" height="24" rx="4" fill="var(--home-cover-panel, #191e28)" stroke="#2ea87e" strokeWidth="1.2" />
      <text x="13" y="16" textAnchor="middle" fill="#64748b" fontSize="11" fontWeight="800">N</text>
    </g>
    <g transform="translate(100, 74)">
      <rect x="0" y="0" width="26" height="22" rx="4" fill="#2ea87e" fillOpacity="0.85" />
      <text x="13" y="15" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="800">O</text>
    </g>
  </svg>
);

const MixedIllustration: React.FC = () => (
  <svg viewBox="0 0 200 108" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="108" rx="6" fill="var(--home-cover-bg, #12151c)" />
    <rect x="24" y="28" width="46" height="52" rx="5" fill="#3578d4" fillOpacity="0.32" stroke="#3578d4" strokeWidth="1.4" />
    <rect x="77" y="28" width="46" height="52" rx="5" fill="#e09b2d" fillOpacity="0.4" stroke="#e09b2d" strokeWidth="1.4" />
    <rect x="130" y="28" width="46" height="52" rx="5" fill="#2ea87e" fillOpacity="0.32" stroke="#2ea87e" strokeWidth="1.4" />
  </svg>
);

const AdventureIllustration: React.FC = () => (
  <svg viewBox="0 0 200 108" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="108" rx="6" fill="var(--home-cover-bg, #12151c)" />
    <rect x="0" y="76" width="200" height="32" fill="var(--home-cover-secondary, #1b202b)" />
    <line x1="0" y1="76" x2="200" y2="76" stroke="#e09b2d" strokeWidth="1.5" strokeOpacity="0.5" />
    <rect x="22" y="34" width="38" height="42" rx="3" fill="var(--home-cover-panel, #191e28)" stroke="#e09b2d" strokeWidth="1.2" />
    <rect x="68" y="24" width="44" height="52" rx="3" fill="var(--home-cover-panel, #191e28)" stroke="#3578d4" strokeWidth="1.2" />
    <circle cx="144" cy="54" r="11" fill="#e09b2d" fillOpacity="0.22" stroke="#e09b2d" strokeWidth="1.5" />
    <circle cx="176" cy="46" r="9" fill="#2ea87e" />
    <line x1="155" y1="52" x2="167" y2="48" stroke="#e09b2d" strokeWidth="1.8" strokeDasharray="3 2" />
  </svg>
);

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
    title: 'Trắc nghiệm 4 màu',
    shortDesc: 'Câu hỏi 4 đáp án A/B/C/D trực quan để thi đấu tốc độ hoặc ôn tập lớp học.',
    badge: '4 Lựa chọn',
    accent: 'var(--accent-sky)',
    badgeBg: 'var(--accent-sky-subtle)',
    illustration: <MultipleChoiceIllustration />,
  },
  {
    type: 'QUICK_BUTTON',
    title: 'Đúng / Sai',
    shortDesc: 'Phản xạ quyết định nhanh với các mệnh đề nhận định ngắn gọn.',
    badge: 'Phản xạ nhanh',
    accent: 'var(--accent-emerald)',
    badgeBg: 'var(--accent-emerald-subtle)',
    illustration: <QuickButtonIllustration />,
  },
  {
    type: 'FILL_IN_THE_BLANK',
    title: 'Điền từ khuyết',
    shortDesc: 'Ghi nhớ chính xác khái niệm, thuật ngữ và định nghĩa trọng tâm.',
    badge: 'Ghi nhớ sâu',
    accent: 'var(--accent-amber)',
    badgeBg: 'var(--accent-amber-subtle)',
    illustration: <FillInBlankIllustration />,
  },
  {
    type: 'CROSSWORD',
    title: 'Giải ô chữ',
    shortDesc: 'Mở khóa các hàng từ khóa kiến thức qua hệ thống gợi ý suy luận.',
    badge: 'Tư duy logic',
    accent: 'var(--accent-emerald)',
    badgeBg: 'var(--accent-emerald-subtle)',
    illustration: <CrosswordIllustration />,
  },
  {
    type: 'MIXED',
    title: 'Đấu trường hỗn hợp',
    shortDesc: 'Kết hợp linh hoạt nhiều dạng câu hỏi trong cùng một kịch bản thi đấu.',
    badge: 'Đa định dạng',
    accent: 'var(--accent-sky)',
    badgeBg: 'var(--accent-sky-subtle)',
    illustration: <MixedIllustration />,
  },
  {
    type: 'ADVENTURE',
    title: 'Đi cảnh theo ngành nghề',
    shortDesc: 'Nhập vai xử lý tình huống thực tế theo từng lĩnh vực và ngành nghề.',
    badge: 'Nhập vai 2D',
    accent: 'var(--accent-amber)',
    badgeBg: 'var(--accent-amber-subtle)',
    illustration: <AdventureIllustration />,
  },
];

export const HomePage: React.FC<HomePageProps> = ({
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
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  // Modal chọn chế độ chơi (Chơi đơn / Mở phòng Multiplayer)
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [modeModalSpec, setModeModalSpec] = useState<GameSpecification | null>(null);
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);

  const loadDashboardGames = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchSavedGames({
        limit: 40,
        offset: 0,
        scope: 'manage',
        status: 'ALL',
      });
      setSavedGames(res.games || []);
      setTotalCount(res.total ?? (res.games ? res.games.length : 0));
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải dữ liệu bảng điều khiển.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardGames();
  }, []);

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
      if (onSelectSavedGame) {
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

  // Thống kê thực tế từ dữ liệu hệ thống
  const stats = useMemo(() => {
    const published = savedGames.filter((g) => g.isPublic).length;
    const draft = savedGames.filter((g) => !g.isPublic).length;
    const active = savedGames.filter(
      (g) => g.activeStatus?.hasActiveRoom || g.activeStatus?.hasActiveSession
    ).length;
    return { published, draft, active };
  }, [savedGames]);

  // Tìm kiếm trực tiếp trên dữ liệu thật
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedSearch) return [];
    return savedGames.filter((g) => {
      const inTitle = g.title.toLowerCase().includes(trimmedSearch);
      const inDesc = (g.description || '').toLowerCase().includes(trimmedSearch);
      const inIndustry = (g.adventureConfig?.industryLabel || '').toLowerCase().includes(trimmedSearch);
      const inType = formatGameTypeName(g.gameType).toLowerCase().includes(trimmedSearch);
      return inTitle || inDesc || inIndustry || inType;
    });
  }, [savedGames, trimmedSearch]);

  // Game gần đây (sắp xếp theo updatedAt hoặc createdAt mới nhất)
  const recentGames = useMemo(() => {
    return [...savedGames]
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      )
      .slice(0, 4);
  }, [savedGames]);

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
          --home-cover-bg: #12151c;
          --home-cover-secondary: #1b202b;
          --home-cover-panel: #191e28;
          --discover-cover-bg: #12151c;
          --discover-cover-secondary: #1b202b;
          --discover-cover-panel: #191e28;
          --discover-cover-badge-bg: rgba(8, 9, 14, 0.88);
          --discover-cover-badge-text: #f2f4f8;
          --discover-cover-badge-border: rgba(255, 255, 255, 0.16);
          --discover-status-pub-bg: rgba(6, 78, 59, 0.92);
          --discover-status-pub-text: #76d6ad;
          --discover-status-pub-border: rgba(16, 185, 129, 0.42);
          --discover-status-draft-bg: rgba(120, 53, 15, 0.92);
          --discover-status-draft-text: #f3c75f;
          --discover-status-draft-border: rgba(245, 158, 11, 0.42);
        }
        [data-theme="light"] .home-dashboard-root {
          --primary: #0369a1;
          --primary-hover: #075985;
          --primary-active: #0c4a6e;
          --primary-subtle: rgba(3, 105, 161, 0.1);
          --primary-ink: #ffffff;
          --accent-sky: #0369a1;
          --accent-sky-subtle: rgba(3, 105, 161, 0.1);
          --accent-emerald: #047857;
          --accent-emerald-subtle: rgba(4, 120, 87, 0.1);
          --accent-amber: #b45309;
          --accent-amber-subtle: rgba(180, 83, 9, 0.1);
          --accent-rose: #be123c;
          --accent-rose-subtle: rgba(190, 18, 60, 0.1);
          --home-cover-bg: #eef2f6;
          --home-cover-secondary: #e2e8f0;
          --home-cover-panel: #ffffff;
          --discover-cover-bg: #eef2f6;
          --discover-cover-secondary: #e2e8f0;
          --discover-cover-panel: #ffffff;
          --discover-cover-badge-bg: rgba(255, 255, 255, 0.95);
          --discover-cover-badge-text: #090a0f;
          --discover-cover-badge-border: #cbd5e1;
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
                height: '38px',
                fontWeight: 800,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <PlusIcon size={15} />
              <span>Tạo game</span>
            </button>

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
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <BookOpenIcon size={15} />
                <span>Mở Thư viện</span>
              </button>
            )}

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
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <BarChartIcon size={15} />
                <span>Kho Game</span>
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
                  height: '38px',
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
                          Sửa
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
              Game gần đây
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Tiếp tục chỉnh sửa hoặc tổ chức chơi từ các bộ câu hỏi vừa được cập nhật
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
                onClick={() => onNavigateToLibrary({ tab: 'ALL', nonce: Date.now() })}
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
            }}
          >
            Chưa có bộ câu hỏi nào được lưu trong hệ thống. Hãy chọn một thể loại phía trên để tạo game đầu tiên.
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
                    <span>Sửa</span>
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
              <span>Xem tất cả game đã xuất bản</span>
              <ArrowRightIcon size={13} />
            </button>
          )}
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
                        color: 'var(--accent-emerald)',
                        backgroundColor: 'var(--accent-emerald-subtle)',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <CheckIcon size={11} />
                      <span>Sẵn sàng chơi</span>
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {item.questionCount} câu • {formatGameTypeName(item.gameType)}
                    </span>
                  </div>
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

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenGameModal(item.gameId)}
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-strong)',
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
        isOwner={true}
      />
    </div>
  );
};
