import React, { useEffect, useMemo, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { useToast } from '../components/ToastContext.js';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  GamepadIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
  TrashIcon,
  UsersIcon,
  XMarkIcon,
} from '../components/Icons.js';
import {
  closeMultiplayerRoom,
  createRoom,
  deleteAllSavedGames,
  deleteSavedGame,
  downloadGameExport,
  endPracticeSession,
  fetchCurrentUser,
  fetchGameById,
  fetchGameQr,
  fetchRoomQr,
  fetchSavedGames,
  fetchWhoAmI,
  publishGame,
  saveEditedQuestions,
} from '../services/api.js';
import type {
  AuthenticatedUser,
  GameQuestion,
  GameSpecification,
  GameType,
  PersistedGameSummary,
  QuestionType,
  ScoringMode,
} from '../types/index.js';

export type DiscoverTabKey = 'ALL' | 'PUBLISHED' | 'DRAFT' | 'MINE';
type SortOptionKey = 'NEWEST' | 'UPDATED' | 'TITLE_ASC' | 'QUESTIONS_DESC';

export interface LibraryFilterPreset {
  search?: string;
  gameType?: string;
  industry?: string;
  tab?: DiscoverTabKey;
  nonce?: number;
}

interface AnalyticsPageProps {
  mode?: 'overview' | 'library';
  initialFilterPreset?: LibraryFilterPreset | null;
  onNavigateToLibrary?: (preset?: LibraryFilterPreset) => void;
  onSelectSavedGame?: (spec: GameSpecification, autoStartSolo?: boolean) => void;
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToSoloPresentation?: (spec: GameSpecification) => void;
  onNavigateToCreate?: (type?: GameType) => void;
}

const PAGE_SIZE = 12;
const OVERVIEW_FETCH_LIMIT = 100;

export const formatGameTypeName = (type: string): string => {
  switch (type) {
    case 'QUIZ':
      return 'Quiz (Trắc nghiệm)';
    case 'MULTIPLE_CHOICE':
      return 'Quiz — Trắc nghiệm ABCD';
    case 'TRUE_FALSE':
      return 'True/False — Đúng / Sai';
    case 'QUICK_BUTTON':
      return 'True/False — Đúng / Sai';
    case 'TYPE_ANSWER':
      return 'Type Answer — Tự nhập đáp án';
    case 'FILL_IN_THE_BLANK':
      return 'Type Answer — Điền từ';
    case 'PUZZLE':
      return 'Puzzle — Sắp xếp thứ tự';
    case 'SLIDER':
      return 'Slider — Thanh trượt giá trị';
    case 'PIN_ANSWER':
      return 'Pin Answer — Ghim vị trí';
    case 'CROSSWORD':
      return 'Ô chữ (Legacy)';
    case 'MIXED':
      return 'Hỗn hợp (Legacy)';
    case 'ADVENTURE':
      return 'Đi cảnh theo ngành nghề';
    default:
      return type;
  }
};

const formatScoringModeName = (mode: string): string => {
  switch (mode) {
    case 'STANDARD':
      return 'Tiêu chuẩn';
    case 'SPEED_BONUS':
      return 'Thưởng tốc độ';
    case 'STREAK':
      return 'Chuỗi trả lời đúng';
    default:
      return mode;
  }
};

interface FormatCollectionItem {
  id: GameType;
  label: string;
  shortDesc: string;
  mechanicTag: string;
  accentColor: string;
  badgeBg: string;
}

const DISCOVER_FORMAT_COLLECTIONS: FormatCollectionItem[] = [
  {
    id: 'MULTIPLE_CHOICE',
    label: 'Quiz — Trắc nghiệm ABCD',
    shortDesc: '4 phương án lựa chọn chuẩn Kahoot, kiểm tra kiến thức nhanh và trực quan.',
    mechanicTag: 'Quiz • 4 lựa chọn',
    accentColor: 'var(--accent-rose)',
    badgeBg: 'var(--accent-rose-subtle)',
  },
  {
    id: 'QUICK_BUTTON',
    label: 'True/False — Đúng / Sai',
    shortDesc: 'Quyết định Đúng hoặc Sai tốc độ cao, phù hợp khởi động lớp học hoặc sự kiện.',
    mechanicTag: 'True/False • 2 nút',
    accentColor: 'var(--accent-sky)',
    badgeBg: 'var(--accent-sky-subtle)',
  },
  {
    id: 'FILL_IN_THE_BLANK',
    label: 'Type Answer — Tự nhập đáp án',
    shortDesc: 'Người chơi tự gõ chính xác thuật ngữ hoặc khái niệm trọng tâm.',
    mechanicTag: 'Type Answer',
    accentColor: 'var(--accent-amber)',
    badgeBg: 'var(--accent-amber-subtle)',
  },
  {
    id: 'PUZZLE',
    label: 'Puzzle — Sắp xếp thứ tự',
    shortDesc: 'Sắp xếp các bước quy trình, sự kiện hoặc cấp độ theo đúng thứ tự chuẩn.',
    mechanicTag: 'Puzzle • Thứ tự',
    accentColor: 'var(--accent-emerald)',
    badgeBg: 'var(--accent-emerald-subtle)',
  },
  {
    id: 'ADVENTURE',
    label: 'Đi cảnh theo ngành',
    shortDesc: 'Nhập vai thực hành bối cảnh nghề nghiệp thực tế kết hợp vượt chướng ngại vật.',
    mechanicTag: 'Nhập vai 2D',
    accentColor: 'var(--accent-coral, var(--accent-amber))',
    badgeBg: 'var(--accent-coral-subtle, var(--accent-amber-subtle))',
  },
];

export const GameFormatIllustration: React.FC<{ type: GameType }> = ({ type }) => {
  const virtualSummary: PersistedGameSummary = {
    gameId: `fmt-${type}`,
    title: type,
    description: '',
    gameType: type,
    scoringMode: 'SPEED_BONUS',
    questionCount: 10,
    timePerQuestion: 15,
    isPublic: true,
    ownerUserId: null,
    sourceCount: 1,
    generatedAt: '',
    createdAt: '',
    updatedAt: '',
  };
  return <GameCoverIllustration game={virtualSummary} isFormatPreview />;
};

export const GameCoverIllustration: React.FC<{
  game: PersistedGameSummary;
  isFormatPreview?: boolean;
}> = ({ game, isFormatPreview = false }) => {
  const isAdventure = game.gameType === 'ADVENTURE';
  const rawIndustry = [
    game.adventureConfig?.industryId || '',
    game.adventureConfig?.themePresetId || '',
    game.adventureConfig?.decorStyle || '',
    game.adventureConfig?.industryLabel || '',
    game.adventureConfig?.subEnvironment || '',
    game.title || '',
  ]
    .join(' ')
    .toLowerCase();
  const palette = game.adventureConfig?.palette;
  const panelFill = 'var(--discover-cover-panel, #1d2642)';
  const inkStrong = 'var(--cover-ink-strong, #f8fafc)';
  const inkMuted = 'var(--cover-ink-muted, #94a3b8)';

  if (isAdventure) {
    const isRestaurant =
      rawIndustry.includes('fnb') ||
      rawIndustry.includes('restaurant') ||
      rawIndustry.includes('kitchen') ||
      rawIndustry.includes('food') ||
      rawIndustry.includes('hotel') ||
      rawIndustry.includes('nhà hàng') ||
      rawIndustry.includes('bếp') ||
      rawIndustry.includes('ẩm thực') ||
      rawIndustry.includes('thực phẩm');
    const isTechOrCyber =
      rawIndustry.includes('it_technology') ||
      rawIndustry.includes('cyber') ||
      rawIndustry.includes('coding') ||
      rawIndustry.includes('datacenter') ||
      rawIndustry.includes('software') ||
      rawIndustry.includes('an ninh mạng') ||
      rawIndustry.includes('lập trình') ||
      rawIndustry.includes('công nghệ') ||
      rawIndustry.includes('phần mềm');
    const isMedical =
      rawIndustry.includes('healthcare') ||
      rawIndustry.includes('med_') ||
      rawIndustry.includes('hospital') ||
      rawIndustry.includes('medical') ||
      rawIndustry.includes('pharma') ||
      rawIndustry.includes('y tế') ||
      rawIndustry.includes('bệnh viện') ||
      rawIndustry.includes('dược') ||
      rawIndustry.includes('lâm sàng');
    const isFinanceOrBiz =
      rawIndustry.includes('finance') ||
      rawIndustry.includes('banking') ||
      rawIndustry.includes('business') ||
      rawIndustry.includes('sales') ||
      rawIndustry.includes('retail') ||
      rawIndustry.includes('showroom') ||
      rawIndustry.includes('tài chính') ||
      rawIndustry.includes('ngân hàng') ||
      rawIndustry.includes('kinh doanh') ||
      rawIndustry.includes('bán hàng');
    const isManufacturing =
      rawIndustry.includes('manufacturing') ||
      rawIndustry.includes('factory') ||
      rawIndustry.includes('warehouse') ||
      rawIndustry.includes('nhà máy') ||
      rawIndustry.includes('sản xuất') ||
      rawIndustry.includes('kho vận') ||
      rawIndustry.includes('5s');
    const isMotoOrTraffic =
      rawIndustry.includes('motorcycle') ||
      rawIndustry.includes('moto_') ||
      rawIndustry.includes('garage') ||
      rawIndustry.includes('traffic') ||
      rawIndustry.includes('xe máy') ||
      rawIndustry.includes('giao thông') ||
      rawIndustry.includes('bảo dưỡng');

    const advAccent = palette?.accentColor || '#f97316';

    return (
      <svg
        viewBox="0 0 320 136"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ display: 'block', backgroundColor: 'var(--cover-adv-bg, #12182b)' }}
      >
        <rect width="320" height="136" fill="var(--cover-adv-bg, #12182b)" />
        {/* Architectural horizon & floor band */}
        <circle cx="272" cy="28" r="46" fill={advAccent} fillOpacity="0.12" />
        <circle cx="52" cy="18" r="32" fill="#38bdf8" fillOpacity="0.1" />
        <rect x="0" y="98" width="320" height="38" fill="var(--cover-adv-secondary, #1b243f)" />
        <line x1="0" y1="98" x2="320" y2="98" stroke={advAccent} strokeWidth="2" strokeOpacity="0.55" />
        <line x1="20" y1="116" x2="300" y2="116" stroke={inkMuted} strokeWidth="1.5" strokeDasharray="8 6" strokeOpacity="0.35" />

        {isFormatPreview ? (
          /* General Multi-Industry Adventure Portal Preview */
          <g>
            {/* Station 1: Cyber / Tech */}
            <rect x="24" y="36" width="72" height="54" rx="6" fill={panelFill} stroke="#38bdf8" strokeWidth="1.6" />
            <rect x="32" y="44" width="56" height="10" rx="3" fill="#38bdf8" fillOpacity="0.2" />
            <circle cx="38" cy="49" r="2.2" fill="#e63946" />
            <circle cx="45" cy="49" r="2.2" fill="#f08c00" />
            <circle cx="52" cy="49" r="2.2" fill="#12b886" />
            <text x="60" y="74" textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="900">&lt;/&gt;</text>

            {/* Station 2: Healthcare / Lab */}
            <rect x="124" y="26" width="72" height="64" rx="6" fill={panelFill} stroke="#12b886" strokeWidth="1.6" />
            <circle cx="160" cy="46" r="11" fill="#12b886" fillOpacity="0.18" />
            <rect x="157" y="39" width="6" height="14" rx="1.5" fill="#12b886" />
            <rect x="153" y="43" width="14" height="6" rx="1.5" fill="#12b886" />
            <polyline points="134,74 148,74 154,64 162,82 168,70 174,74 186,74" fill="none" stroke="#12b886" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Station 3: Business / F&B Service */}
            <rect x="224" y="36" width="72" height="54" rx="6" fill={panelFill} stroke="#f08c00" strokeWidth="1.6" />
            <path d="M242 72 A18 15 0 0 1 278 72 Z" fill="#f08c00" />
            <circle cx="260" cy="54" r="3" fill="#f08c00" />
            <rect x="236" y="72" width="48" height="4" rx="2" fill={inkMuted} />

            {/* Waypoint Route Nodes */}
            <line x1="60" y1="108" x2="260" y2="108" stroke="#f08c00" strokeWidth="2.2" strokeDasharray="5 4" />
            <circle cx="60" cy="108" r="6" fill="#38bdf8" />
            <circle cx="160" cy="108" r="6" fill="#12b886" />
            <circle cx="260" cy="108" r="6" fill="#f08c00" />
          </g>
        ) : isRestaurant ? (
          <g>
            {/* Kitchen Pass & HACCP Station */}
            <rect x="28" y="34" width="118" height="64" rx="6" fill={panelFill} stroke="#f08c00" strokeWidth="1.6" />
            <rect x="38" y="44" width="44" height="22" rx="4" fill="#12b886" fillOpacity="0.18" stroke="#12b886" strokeWidth="1.2" />
            <text x="60" y="59" textAnchor="middle" fill="#12b886" fontSize="9.5" fontWeight="800">HACCP</text>
            <rect x="90" y="44" width="46" height="22" rx="4" fill="#f08c00" fillOpacity="0.18" />
            <text x="113" y="59" textAnchor="middle" fill="#f08c00" fontSize="9.5" fontWeight="800">04°C</text>
            <rect x="38" y="74" width="98" height="12" rx="3" fill="#f08c00" fillOpacity="0.22" />
            {/* Main Serving Cloche Dome */}
            <path d="M174 86 A34 28 0 0 1 242 86 Z" fill="#f08c00" />
            <circle cx="208" cy="54" r="4.5" fill="#fb923c" />
            <rect x="166" y="86" width="84" height="7" rx="3.5" fill={inkStrong} fillOpacity="0.85" />
            {/* Order Check Ticket */}
            <rect x="260" y="32" width="36" height="52" rx="4" fill={panelFill} stroke="#12b886" strokeWidth="1.5" />
            <line x1="268" y1="44" x2="288" y2="44" stroke="#12b886" strokeWidth="2" />
            <line x1="268" y1="54" x2="286" y2="54" stroke={inkMuted} strokeWidth="2" />
            <line x1="268" y1="64" x2="282" y2="64" stroke={inkMuted} strokeWidth="2" />
          </g>
        ) : isTechOrCyber ? (
          <g>
            {/* IDE / Terminal Window */}
            <rect x="26" y="28" width="124" height="66" rx="6" fill={panelFill} stroke="#38bdf8" strokeWidth="1.6" />
            <rect x="26" y="28" width="124" height="14" rx="6" fill="#38bdf8" fillOpacity="0.18" />
            <circle cx="36" cy="35" r="2.8" fill="#e63946" />
            <circle cx="45" cy="35" r="2.8" fill="#f08c00" />
            <circle cx="54" cy="35" r="2.8" fill="#12b886" />
            <line x1="38" y1="52" x2="86" y2="52" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="46" y1="62" x2="118" y2="62" stroke="#12b886" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="46" y1="72" x2="98" y2="72" stroke="#ae3ec9" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="38" y1="82" x2="72" y2="82" stroke={inkMuted} strokeWidth="2.5" strokeLinecap="round" />
            {/* Cyber Shield & SOC Nodes */}
            <line x1="150" y1="60" x2="192" y2="60" stroke="#38bdf8" strokeWidth="1.8" strokeDasharray="4 3" />
            <polygon
              points="224,26 260,39 260,68 224,90 188,68 188,39"
              fill="#12b886"
              fillOpacity="0.18"
              stroke="#12b886"
              strokeWidth="2"
            />
            <polyline points="212,58 221,67 238,49" fill="none" stroke="#12b886" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="284" cy="44" r="8" fill="#38bdf8" fillOpacity="0.25" stroke="#38bdf8" strokeWidth="1.6" />
            <circle cx="284" cy="76" r="8" fill="#ae3ec9" fillOpacity="0.25" stroke="#ae3ec9" strokeWidth="1.6" />
          </g>
        ) : isMedical ? (
          <g>
            {/* Clinical Vital Signs Monitor */}
            <rect x="28" y="30" width="132" height="64" rx="7" fill={panelFill} stroke="#14b8a6" strokeWidth="1.8" />
            <rect x="38" y="40" width="112" height="44" rx="4" fill="#14b8a6" fillOpacity="0.12" />
            <polyline
              points="44,64 68,64 76,46 86,80 96,52 104,64 142,64"
              fill="none"
              stroke="#12b886"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Medical Cross & Ward Badge */}
            <rect x="184" y="32" width="56" height="56" rx="12" fill={panelFill} stroke="#0ea5e9" strokeWidth="1.8" />
            <rect x="206" y="44" width="12" height="32" rx="3" fill="#e63946" />
            <rect x="196" y="54" width="32" height="12" rx="3" fill="#e63946" />
            {/* Clinical Chart */}
            <rect x="254" y="36" width="38" height="52" rx="5" fill={panelFill} stroke="#14b8a6" strokeWidth="1.5" />
            <line x1="262" y1="50" x2="284" y2="50" stroke="#14b8a6" strokeWidth="2" />
            <line x1="262" y1="60" x2="284" y2="60" stroke={inkMuted} strokeWidth="2" />
            <line x1="262" y1="70" x2="278" y2="70" stroke={inkMuted} strokeWidth="2" />
          </g>
        ) : isFinanceOrBiz ? (
          <g>
            {/* Financial & Sales Analytics Board */}
            <rect x="28" y="28" width="136" height="66" rx="6" fill={panelFill} stroke="#3b5bdb" strokeWidth="1.8" />
            <rect x="44" y="66" width="16" height="18" rx="2" fill="#38bdf8" />
            <rect x="68" y="54" width="16" height="30" rx="2" fill="#3b5bdb" />
            <rect x="92" y="46" width="16" height="38" rx="2" fill="#12b886" />
            <rect x="116" y="36" width="16" height="48" rx="2" fill="#f08c00" />
            <polyline points="48,60 76,48 100,40 124,32" fill="none" stroke="#f08c00" strokeWidth="2.2" strokeLinecap="round" />
            {/* Deal / Consultation Milestone */}
            <rect x="184" y="34" width="108" height="58" rx="8" fill={panelFill} stroke="#f08c00" strokeWidth="1.6" />
            <circle cx="212" cy="63" r="14" fill="#f08c00" fillOpacity="0.2" stroke="#f08c00" strokeWidth="1.8" />
            <path d="M206 63L210 67L219 58" stroke="#f08c00" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="234" y="52" width="44" height="7" rx="3" fill={inkStrong} fillOpacity="0.85" />
            <rect x="234" y="65" width="32" height="6" rx="3" fill="#12b886" />
          </g>
        ) : isManufacturing ? (
          <g>
            {/* Factory Plant & Conveyor Line */}
            <rect x="26" y="34" width="134" height="60" rx="6" fill={panelFill} stroke="#f08c00" strokeWidth="1.6" />
            <rect x="38" y="50" width="28" height="24" rx="3" fill="#f08c00" fillOpacity="0.85" />
            <rect x="78" y="50" width="28" height="24" rx="3" fill="#38bdf8" fillOpacity="0.85" />
            <rect x="118" y="50" width="28" height="24" rx="3" fill="#12b886" fillOpacity="0.85" />
            <rect x="34" y="76" width="118" height="8" rx="4" fill={inkMuted} fillOpacity="0.45" />
            {/* QA / 5S Safety Shield */}
            <polygon
              points="232,28 268,40 268,68 232,88 196,68 196,40"
              fill="#f08c00"
              fillOpacity="0.2"
              stroke="#f08c00"
              strokeWidth="2"
            />
            <text x="232" y="63" textAnchor="middle" fill="#f08c00" fontSize="13" fontWeight="900">5S•QA</text>
          </g>
        ) : isMotoOrTraffic ? (
          <g>
            {/* Garage Workbench & Speedometer Gauge */}
            <rect x="28" y="32" width="124" height="62" rx="6" fill={panelFill} stroke="#f97316" strokeWidth="1.6" />
            <circle cx="68" cy="63" r="20" fill="#f97316" fillOpacity="0.16" stroke="#f97316" strokeWidth="2" />
            <line x1="68" y1="63" x2="80" y2="51" stroke="#e63946" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="98" y="46" width="42" height="8" rx="3" fill="#38bdf8" />
            <rect x="98" y="60" width="34" height="8" rx="3" fill="#12b886" />
            <rect x="98" y="74" width="26" height="6" rx="3" fill="#f08c00" />
            {/* Safety Checkpoint Gate & Cone */}
            <rect x="180" y="42" width="110" height="12" rx="4" fill="#e63946" />
            <rect x="196" y="42" width="16" height="12" fill="#ffffff" />
            <rect x="228" y="42" width="16" height="12" fill="#ffffff" />
            <rect x="260" y="42" width="16" height="12" fill="#ffffff" />
            <rect x="188" y="54" width="8" height="44" fill={inkMuted} />
            <polygon points="246,98 258,64 270,98" fill="#f97316" />
            <line x1="250" y1="84" x2="266" y2="84" stroke="#ffffff" strokeWidth="3" />
          </g>
        ) : (
          <g>
            {/* Academy Campus & Interactive Knowledge Checkpoints */}
            <rect x="28" y="34" width="116" height="64" rx="6" fill={panelFill} stroke="#ae3ec9" strokeWidth="1.6" />
            <polygon points="86,20 148,38 24,38" fill="#ae3ec9" fillOpacity="0.3" stroke="#ae3ec9" strokeWidth="1.5" />
            <rect x="44" y="48" width="20" height="34" rx="3" fill="#38bdf8" fillOpacity="0.25" />
            <rect x="76" y="48" width="20" height="34" rx="3" fill="#f08c00" fillOpacity="0.25" />
            <rect x="108" y="48" width="20" height="34" rx="3" fill="#12b886" fillOpacity="0.25" />
            {/* Connected Stage Nodes */}
            <line x1="168" y1="68" x2="274" y2="52" stroke={advAccent} strokeWidth="2.2" strokeDasharray="5 4" />
            <circle cx="182" cy="66" r="15" fill={panelFill} stroke="#38bdf8" strokeWidth="2" />
            <text x="182" y="70" textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="900">C1</text>
            <circle cx="230" cy="58" r="15" fill={panelFill} stroke="#f08c00" strokeWidth="2" />
            <text x="230" y="62" textAnchor="middle" fill="#f08c00" fontSize="11" fontWeight="900">C2</text>
            <circle cx="276" cy="50" r="15" fill="#12b886" />
            <polyline points="270,50 275,55 283,45" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
    );
  }

  if (game.gameType === 'MULTIPLE_CHOICE' || game.gameType === 'QUIZ') {
    return (
      <svg
        viewBox="0 0 320 136"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ display: 'block', backgroundColor: 'var(--cover-mc-bg, #191224)' }}
      >
        <rect width="320" height="136" fill="var(--cover-mc-bg, #191224)" />
        <circle cx="286" cy="24" r="44" fill="#e63946" fillOpacity="0.1" />
        <circle cx="34" cy="116" r="40" fill="#3578d4" fillOpacity="0.1" />
        {/* Top Question Header Bar */}
        <rect x="28" y="14" width="264" height="28" rx="6" fill={panelFill} stroke="#e63946" strokeWidth="1.2" strokeOpacity="0.55" />
        <rect x="36" y="20" width="26" height="16" rx="4" fill="#e63946" />
        <text x="49" y="31" textAnchor="middle" fill="#ffffff" fontSize="9.5" fontWeight="900">Q1</text>
        <rect x="70" y="23" width="116" height="5" rx="2.5" fill={inkStrong} fillOpacity="0.8" />
        <rect x="70" y="31" width="72" height="4" rx="2" fill={inkMuted} fillOpacity="0.6" />
        <rect x="252" y="20" width="32" height="16" rx="8" fill="#3578d4" fillOpacity="0.2" />
        <text x="268" y="31" textAnchor="middle" fill="#3578d4" fontSize="9" fontWeight="800">15s</text>

        {/* 2x2 Vivid Kahoot Geometric Answer Tiles */}
        {/* A: Red Triangle */}
        <rect x="28" y="50" width="127" height="34" rx="6" fill="#e63946" />
        <polygon points="46,60 54,74 38,74" fill="#ffffff" />
        <rect x="64" y="64" width="66" height="6" rx="3" fill="#ffffff" fillOpacity="0.92" />

        {/* B: Blue Diamond (Selected / Correct Highlight) */}
        <rect x="165" y="50" width="127" height="34" rx="6" fill="#3578d4" stroke="#ffffff" strokeWidth="1.5" />
        <polygon points="183,59 191,67 183,75 175,67" fill="#ffffff" />
        <rect x="200" y="64" width="58" height="6" rx="3" fill="#ffffff" fillOpacity="0.95" />
        <circle cx="276" cy="67" r="8" fill="#12b886" stroke="#ffffff" strokeWidth="1.5" />
        <polyline points="272,67 275,70 280,64" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* C: Amber Circle */}
        <rect x="28" y="90" width="127" height="34" rx="6" fill="#f08c00" />
        <circle cx="46" cy="107" r="7" fill="#ffffff" />
        <rect x="64" y="104" width="58" height="6" rx="3" fill="#ffffff" fillOpacity="0.92" />

        {/* D: Emerald Square */}
        <rect x="165" y="90" width="127" height="34" rx="6" fill="#12b886" />
        <rect x="176" y="100" width="14" height="14" rx="2.5" fill="#ffffff" />
        <rect x="200" y="104" width="64" height="6" rx="3" fill="#ffffff" fillOpacity="0.92" />
      </svg>
    );
  }

  if (game.gameType === 'QUICK_BUTTON' || game.gameType === 'TRUE_FALSE') {
    return (
      <svg
        viewBox="0 0 320 136"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ display: 'block', backgroundColor: 'var(--cover-qb-bg, #0f192f)' }}
      >
        <rect width="320" height="136" fill="var(--cover-qb-bg, #0f192f)" />
        {/* Diagonal Split Stage */}
        <polygon points="0,0 172,0 148,136 0,136" fill="var(--cover-qb-secondary, #172647)" />
        {/* Left Reflex Button: ĐÚNG (Emerald) */}
        <rect x="26" y="28" width="114" height="80" rx="10" fill="#059669" />
        <rect x="26" y="24" width="114" height="76" rx="10" fill="#12b886" />
        <circle cx="83" cy="54" r="16" fill="#ffffff" fillOpacity="0.2" />
        <polyline
          points="74,54 81,61 94,47"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="83" y="88" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="900" letterSpacing="0.06em">
          ĐÚNG
        </text>

        {/* Right Reflex Button: SAI (Rose Red) */}
        <rect x="180" y="28" width="114" height="80" rx="10" fill="#be123c" />
        <rect x="180" y="24" width="114" height="76" rx="10" fill="#f43f5e" />
        <circle cx="237" cy="54" r="16" fill="#ffffff" fillOpacity="0.2" />
        <line x1="230" y1="47" x2="244" y2="61" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="244" y1="47" x2="230" y2="61" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
        <text x="237" y="88" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="900" letterSpacing="0.06em">
          SAI
        </text>

        {/* Central Reflex Lightning Medallion */}
        <circle cx="160" cy="64" r="20" fill={panelFill} stroke="#f08c00" strokeWidth="2.5" />
        <polygon points="163,49 152,65 160,65 157,79 169,62 161,62" fill="#f08c00" />
      </svg>
    );
  }

  if (game.gameType === 'FILL_IN_THE_BLANK' || game.gameType === 'TYPE_ANSWER') {
    return (
      <svg
        viewBox="0 0 320 136"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ display: 'block', backgroundColor: 'var(--cover-fill-bg, #1d1612)' }}
      >
        <rect width="320" height="136" fill="var(--cover-fill-bg, #1d1612)" />
        <circle cx="280" cy="30" r="48" fill="#f08c00" fillOpacity="0.12" />
        {/* Elevated Sentence Card */}
        <rect x="26" y="20" width="268" height="58" rx="8" fill={panelFill} stroke="#f08c00" strokeWidth="1.6" />
        <rect x="40" y="33" width="68" height="7" rx="3.5" fill={inkStrong} fillOpacity="0.8" />
        <rect x="116" y="33" width="46" height="7" rx="3.5" fill={inkMuted} fillOpacity="0.55" />
        {/* Context Line + Missing Token Slot */}
        <rect x="40" y="51" width="48" height="8" rx="4" fill={inkMuted} fillOpacity="0.6" />
        <rect
          x="96"
          y="44"
          width="98"
          height="22"
          rx="5"
          fill="#f08c00"
          fillOpacity="0.2"
          stroke="#f08c00"
          strokeWidth="1.8"
          strokeDasharray="4 3"
        />
        <line x1="108" y1="60" x2="182" y2="60" stroke="#f08c00" strokeWidth="2" />
        <rect x="202" y="51" width="64" height="8" rx="4" fill={inkMuted} fillOpacity="0.6" />

        {/* Floating Tactile Word Keycap Snapping into Slot */}
        <rect x="100" y="92" width="120" height="32" rx="7" fill="#b45309" />
        <rect x="100" y="87" width="120" height="32" rx="7" fill="#f08c00" />
        <text x="160" y="107" textAnchor="middle" fill="#090c15" fontSize="11" fontWeight="900" letterSpacing="0.05em">
          TỪ KHÓA
        </text>
        {/* Snap Arrow */}
        <path d="M160 83 L160 69 M155 74 L160 68 L165 74" stroke="#f08c00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (game.gameType === 'CROSSWORD' || game.gameType === 'PUZZLE') {
    const wordLetters = ['T', 'R', 'I', 'T', 'H', 'Ứ', 'C'];
    return (
      <svg
        viewBox="0 0 320 136"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ display: 'block', backgroundColor: 'var(--cover-cross-bg, #0d1f1e)' }}
      >
        <rect width="320" height="136" fill="var(--cover-cross-bg, #0d1f1e)" />
        <circle cx="46" cy="28" r="42" fill="#12b886" fillOpacity="0.1" />
        {/* Clue Prompt Badge */}
        <rect x="28" y="16" width="106" height="22" rx="5" fill={panelFill} stroke="#12b886" strokeWidth="1.3" />
        <circle cx="40" cy="27" r="5" fill="#12b886" />
        <text x="40" y="30" textAnchor="middle" fill="#ffffff" fontSize="7.5" fontWeight="900">1</text>
        <rect x="52" y="24" width="70" height="6" rx="3" fill={inkStrong} fillOpacity="0.75" />

        {/* Vertical Intersecting Column */}
        {[0, 1, 2].map((row) => (
          <g key={`v-${row}`}>
            <rect
              x={144}
              y={16 + row * 34}
              width="32"
              height="30"
              rx="5"
              fill={row === 1 ? '#12b886' : panelFill}
              stroke="#12b886"
              strokeWidth="1.6"
            />
            <text
              x={160}
              y={36 + row * 34}
              textAnchor="middle"
              fill={row === 1 ? '#ffffff' : inkMuted}
              fontSize="12"
              fontWeight="900"
            >
              {row === 0 ? 'K' : row === 1 ? 'T' : 'O'}
            </text>
          </g>
        ))}

        {/* Horizontal Solved Keyword Row */}
        {wordLetters.map((char, col) => {
          const isPivot = col === 3;
          const xPos = 42 + col * 34;
          return (
            <g key={`h-${col}`}>
              <rect
                x={xPos}
                y={50}
                width="32"
                height="30"
                rx="5"
                fill={isPivot ? '#059669' : '#12b886'}
                stroke="#ffffff"
                strokeWidth={isPivot ? '1.8' : '0.8'}
                strokeOpacity={isPivot ? 0.95 : 0.35}
              />
              <text
                x={xPos + 16}
                y={70}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="12"
                fontWeight="900"
              >
                {char}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // MIXED default — Multi-Format Prism Arena
  return (
    <svg
      viewBox="0 0 320 136"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ display: 'block', backgroundColor: 'var(--cover-mixed-bg, #16132b)' }}
    >
      <rect width="320" height="136" fill="var(--cover-mixed-bg, #16132b)" />
      <circle cx="160" cy="68" r="56" fill="#ae3ec9" fillOpacity="0.12" />

      {/* Card 1: Multiple Choice Mini Module */}
      <g transform="translate(26, 28)">
        <rect width="60" height="76" rx="7" fill={panelFill} stroke="#e63946" strokeWidth="1.6" />
        <rect x="8" y="10" width="20" height="16" rx="3" fill="#e63946" />
        <rect x="32" y="10" width="20" height="16" rx="3" fill="#3578d4" />
        <rect x="8" y="30" width="20" height="16" rx="3" fill="#f08c00" />
        <rect x="32" y="30" width="20" height="16" rx="3" fill="#12b886" />
        <rect x="10" y="56" width="40" height="6" rx="3" fill={inkMuted} fillOpacity="0.6" />
      </g>

      {/* Card 2: Quick Button Reflex Module */}
      <g transform="translate(96, 22)">
        <rect width="60" height="82" rx="7" fill={panelFill} stroke="#38bdf8" strokeWidth="1.6" />
        <rect x="8" y="12" width="44" height="22" rx="4" fill="#12b886" />
        <polyline points="25,23 29,27 36,19" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="8" y="40" width="44" height="22" rx="4" fill="#f43f5e" />
        <line x1="26" y1="47" x2="34" y2="55" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="34" y1="47" x2="26" y2="55" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
      </g>

      {/* Card 3: Fill In Blank Module */}
      <g transform="translate(166, 22)">
        <rect width="60" height="82" rx="7" fill={panelFill} stroke="#f08c00" strokeWidth="1.6" />
        <rect x="8" y="16" width="44" height="18" rx="4" fill="#f08c00" fillOpacity="0.2" stroke="#f08c00" strokeWidth="1.4" strokeDasharray="3 2" />
        <rect x="10" y="44" width="40" height="18" rx="4" fill="#f08c00" />
        <text x="30" y="56" textAnchor="middle" fill="#090c15" fontSize="8" fontWeight="900">A B C</text>
      </g>

      {/* Card 4: Crossword Module */}
      <g transform="translate(236, 28)">
        <rect width="58" height="76" rx="7" fill={panelFill} stroke="#12b886" strokeWidth="1.6" />
        <rect x="8" y="14" width="18" height="18" rx="3" fill="#12b886" />
        <rect x="30" y="14" width="18" height="18" rx="3" fill="#12b886" fillOpacity="0.3" stroke="#12b886" strokeWidth="1.2" />
        <rect x="8" y="36" width="18" height="18" rx="3" fill="#12b886" fillOpacity="0.3" stroke="#12b886" strokeWidth="1.2" />
        <rect x="30" y="36" width="18" height="18" rx="3" fill="#12b886" />
      </g>
    </svg>
  );
};

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  mode = 'overview',
  initialFilterPreset,
  onNavigateToLibrary,
  onSelectSavedGame,
  onNavigateToHost,
  onNavigateToSoloPresentation,
  onNavigateToCreate,
}) => {
  const isLibraryMode = mode === 'library';
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [savedGames, setSavedGames] = useState<PersistedGameSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [, setHasMore] = useState(false);

  // Bộ lọc, phân loại & sắp xếp
  const [discoverTab, setDiscoverTab] = useState<DiscoverTabKey>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');
  const [selectedIndustryFilter, setSelectedIndustryFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOptionKey>('NEWEST');
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  // Chi tiết & chỉnh sửa bộ câu hỏi đang mở
  const [activeGameSpec, setActiveGameSpec] = useState<GameSpecification | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTimePerQuestion, setEditTimePerQuestion] = useState<number>(15);
  const [editScoringMode, setEditScoringMode] = useState<ScoringMode>('SPEED_BONUS');
  const [editIsPublic, setEditIsPublic] = useState<boolean>(true);
  const [editQuestions, setEditQuestions] = useState<GameQuestion[]>([]);
  const [isSavingEdits, setIsSavingEdits] = useState(false);

  // Xác nhận xóa bộ câu hỏi
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<PersistedGameSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Xác nhận xóa toàn bộ game
  const [isConfirmDeleteAllOpen, setIsConfirmDeleteAllOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Modal Chia sẻ Chơi Đơn (Link + QR)
  const [soloShareData, setSoloShareData] = useState<{
    gameId: string;
    title: string;
    playUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [isLoadingSoloShare, setIsLoadingSoloShare] = useState(false);

  // Modal Mở phòng Multiplayer (Link + QR + Vào Host)
  const [multiplayerShareData, setMultiplayerShareData] = useState<{
    gameId: string;
    title: string;
    roomCode: string;
    hostToken: string;
    joinUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [isOpeningRoomGameId, setIsOpeningRoomGameId] = useState<string | null>(null);

  // Người dùng hiện tại & Modal chọn chế độ chơi (Luồng 2 & Luồng 3)
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [modeModalSpec, setModeModalSpec] = useState<GameSpecification | null>(null);

  // Modal Kết thúc phiên chơi đơn
  const [confirmEndSessionModal, setConfirmEndSessionModal] = useState<{
    game: PersistedGameSummary;
    sessionId: string;
  } | null>(null);
  const [isEndingSession, setIsEndingSession] = useState(false);

  // Modal Đóng phòng chơi trực tiếp
  const [confirmCloseRoomModal, setConfirmCloseRoomModal] = useState<{
    game: PersistedGameSummary;
    roomCode: string;
  } | null>(null);
  const [isClosingRoom, setIsClosingRoom] = useState(false);

  useEffect(() => {
    Promise.all([fetchWhoAmI().catch(() => null), fetchCurrentUser().catch(() => null)]).then(
      ([whoAmIRes, currentRes]) => {
        setCurrentUser(whoAmIRes?.user || currentRes?.user || null);
      }
    );
  }, []);

  const handleNavigateToCreator = (type?: GameType) => {
    if (onNavigateToCreate) {
      onNavigateToCreate(type);
      return;
    }
    const targetUrl = type ? `/?tab=demo&type=${type}` : '/?tab=demo';
    window.location.href = targetUrl;
  };

  const loadSavedGames = async (
    targetPage = page,
    search = searchQuery,
    gameType = selectedTypeFilter,
    status = statusFilter,
    tab: DiscoverTabKey = discoverTab
  ) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const fetchLimit = isLibraryMode ? PAGE_SIZE : OVERVIEW_FETCH_LIMIT;
      const offset = isLibraryMode ? (targetPage - 1) * PAGE_SIZE : 0;
      const scopeParam: 'manage' | 'public' | 'mine' =
        tab === 'MINE' ? 'mine' : tab === 'PUBLISHED' ? 'manage' : 'manage';
      const effectiveStatus: 'ALL' | 'PUBLISHED' | 'DRAFT' =
        tab === 'PUBLISHED' ? 'PUBLISHED' : tab === 'DRAFT' ? 'DRAFT' : status;

      const data = await fetchSavedGames({
        limit: fetchLimit,
        offset,
        gameType: isLibraryMode && gameType !== 'ALL' ? gameType : undefined,
        search: isLibraryMode ? search.trim() || undefined : undefined,
        status: isLibraryMode ? effectiveStatus : 'ALL',
        scope: isLibraryMode ? scopeParam : 'manage',
      });
      setSavedGames(data.games || []);
      const total = data.total ?? (data.games ? data.games.length : 0);
      setTotalCount(total);
      setHasMore(Boolean(data.hasMore ?? offset + (data.games?.length || 0) < total));
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải danh sách bộ câu hỏi đã tạo.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLibraryMode || !initialFilterPreset) return;
    const nextSearch = initialFilterPreset.search ?? '';
    const nextType = initialFilterPreset.gameType ?? 'ALL';
    const nextIndustry = initialFilterPreset.industry ?? 'ALL';
    const nextTab: DiscoverTabKey = initialFilterPreset.tab ?? 'ALL';
    const nextStatus: 'ALL' | 'PUBLISHED' | 'DRAFT' =
      nextTab === 'PUBLISHED' ? 'PUBLISHED' : nextTab === 'DRAFT' ? 'DRAFT' : 'ALL';

    setSearchQuery(nextSearch);
    setSelectedTypeFilter(nextType);
    setSelectedIndustryFilter(nextIndustry);
    setDiscoverTab(nextTab);
    setStatusFilter(nextStatus);
    setPage(1);
    loadSavedGames(1, nextSearch, nextType, nextStatus, nextTab);
  }, [
    isLibraryMode,
    initialFilterPreset?.nonce,
    initialFilterPreset?.search,
    initialFilterPreset?.gameType,
    initialFilterPreset?.industry,
    initialFilterPreset?.tab,
  ]);

  useEffect(() => {
    setPage(1);
    loadSavedGames(1, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
  }, [isLibraryMode, selectedTypeFilter, statusFilter, discoverTab]);

  const handleTabSelect = (nextTab: DiscoverTabKey) => {
    setDiscoverTab(nextTab);
    if (nextTab === 'PUBLISHED') {
      setStatusFilter('PUBLISHED');
    } else if (nextTab === 'DRAFT') {
      setStatusFilter('DRAFT');
    } else if (nextTab === 'ALL') {
      setStatusFilter('ALL');
    }
  };

  const handleStatusSelectChange = (nextStatus: 'ALL' | 'PUBLISHED' | 'DRAFT') => {
    setStatusFilter(nextStatus);
    if (nextStatus === 'PUBLISHED') {
      setDiscoverTab('PUBLISHED');
    } else if (nextStatus === 'DRAFT') {
      setDiscoverTab('DRAFT');
    } else if (discoverTab !== 'MINE') {
      setDiscoverTab('ALL');
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLibraryMode && onNavigateToLibrary) {
      onNavigateToLibrary({ search: searchQuery.trim(), nonce: Date.now() });
      return;
    }
    setPage(1);
    loadSavedGames(1, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
  };

  const handleResetAllFilters = () => {
    setSearchQuery('');
    setSelectedTypeFilter('ALL');
    setStatusFilter('ALL');
    setDiscoverTab('ALL');
    setSelectedIndustryFilter('ALL');
    setSortBy('NEWEST');
    setPage(1);
    loadSavedGames(1, '', 'ALL', 'ALL', 'ALL');
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1) return;
    setPage(nextPage);
    loadSavedGames(nextPage, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
  };

  const handleDeleteAllGames = async () => {
    setIsDeletingAll(true);
    try {
      const res = await deleteAllSavedGames();
      if (res.skippedActiveCount > 0) {
        toast.warning(
          `Đã xóa thành công ${res.deletedCount} bộ câu hỏi. Còn ${res.skippedActiveCount} game đang có phòng chơi hoặc phiên luyện tập hoạt động nên được giữ lại an toàn.`,
          'Hoàn tất xóa một phần'
        );
      } else {
        toast.success(
          `Đã xóa thành công toàn bộ ${res.deletedCount} bộ câu hỏi khỏi kho game.`,
          'Đã xóa tất cả'
        );
      }
      setIsConfirmDeleteAllOpen(false);
      setActiveGameSpec(null);
      setPage(1);
      await loadSavedGames(1, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
    } catch (err: any) {
      toast.error(err.message || 'Không thể xóa danh sách bộ câu hỏi.', 'Lỗi xóa tất cả');
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleOpenModeModal = async (gameId: string) => {
    setIsDetailLoading(true);
    try {
      const spec = await fetchGameById(gameId);
      setModeModalSpec(spec);
      setIsModeModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở bộ câu hỏi.', 'Lỗi tải game');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const syncEditorFromSpec = (spec: GameSpecification) => {
    setEditTitle(spec.title);
    setEditDescription(spec.description);
    setEditTimePerQuestion(spec.settings.timePerQuestion || 15);
    setEditScoringMode(spec.settings.scoringMode || 'SPEED_BONUS');
    setEditIsPublic(spec.isPublic ?? false);
    setEditQuestions(
      spec.questions.map((q) => ({
        ...q,
        choices: q.choices ? [...q.choices] : undefined,
      }))
    );
  };

  const handleViewOrEditGame = async (gameId: string, startInEditMode: boolean = false) => {
    setIsDetailLoading(true);
    try {
      const spec = await fetchGameById(gameId, { mode: 'manage' });
      setActiveGameSpec(spec);
      syncEditorFromSpec(spec);
      setIsEditMode(startInEditMode);
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải chi tiết bộ câu hỏi.', 'Lỗi');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handlePlaySavedGame = async (gameId: string, autoStartSolo: boolean = false) => {
    try {
      const spec =
        activeGameSpec?.gameId === gameId
          ? activeGameSpec
          : await fetchGameById(gameId, { mode: 'manage' });
      if (onSelectSavedGame) {
        onSelectSavedGame(spec, autoStartSolo);
      }
      toast.success(
        autoStartSolo
          ? `Đang bắt đầu chế độ chơi đơn cho "${spec.title}".`
          : `Đã nạp bộ câu hỏi "${spec.title}" để luyện tập hoặc mở phòng chơi.`,
        'Sẵn sàng chơi'
      );
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở lại bộ câu hỏi.', 'Lỗi');
    }
  };

  const handleOpenSoloShareModal = async (game: { gameId: string; title: string; isPublic?: boolean }) => {
    if (game.isPublic === false) {
      toast.warning(
        'Game này đang ở trạng thái Bản nháp. Vui lòng Xuất bản game trước khi lấy Link / QR chơi đơn.',
        'Chưa xuất bản'
      );
      return;
    }
    setIsLoadingSoloShare(true);
    try {
      const qrData = await fetchGameQr(game.gameId);
      setSoloShareData({
        gameId: qrData.gameId,
        title: qrData.title,
        playUrl: qrData.playUrl,
        qrDataUrl: qrData.qrDataUrl,
      });
    } catch (err: any) {
      toast.error(err.message || 'Không thể tạo Link / QR chơi đơn.', 'Lỗi chia sẻ');
    } finally {
      setIsLoadingSoloShare(false);
    }
  };

  const handleOpenMultiplayerRoom = async (game: { gameId: string; title: string; isPublic?: boolean }) => {
    if (game.isPublic === false) {
      toast.warning(
        'Game này đang ở trạng thái Bản nháp. Vui lòng Xuất bản game trước khi mở phòng Multiplayer.',
        'Chưa xuất bản'
      );
      return;
    }
    setIsOpeningRoomGameId(game.gameId);
    try {
      const created = await createRoom({
        gameId: game.gameId,
        requirePublished: true,
      });
      const qr = await fetchRoomQr(created.roomCode);
      setMultiplayerShareData({
        gameId: game.gameId,
        title: game.title,
        roomCode: created.roomCode,
        hostToken: created.hostToken,
        joinUrl: qr.joinUrl,
        qrDataUrl: qr.qrDataUrl,
      });
      toast.success(`Đã mở phòng Multiplayer #${created.roomCode}!`, 'Mở phòng thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở phòng Multiplayer.', 'Lỗi mở phòng');
    } finally {
      setIsOpeningRoomGameId(null);
    }
  };

  const handleExportGame = async (gameId: string, format: 'csv' | 'json') => {
    try {
      await downloadGameExport(gameId, format);
      toast.success(`Đã xuất bộ câu hỏi sang định dạng ${format.toUpperCase()}`, 'Xuất tệp thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể xuất bộ câu hỏi.', 'Lỗi xuất tệp');
    }
  };

  const handleOpenDeleteModal = (game: PersistedGameSummary) => {
    setConfirmDeleteGame(game);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteGame) return;
    const targetGame = confirmDeleteGame;
    setIsDeleting(true);

    try {
      await deleteSavedGame(targetGame.gameId);
      setSavedGames((prev) => prev.filter((g) => g.gameId !== targetGame.gameId));
      setTotalCount((prev) => Math.max(0, prev - 1));
      if (activeGameSpec?.gameId === targetGame.gameId) {
        setActiveGameSpec(null);
      }
      setConfirmDeleteGame(null);
      toast.success(`Đã xóa bộ câu hỏi "${targetGame.title}" thành công.`, 'Xóa thành công');
      const remainingOnPage = savedGames.length - 1;
      const nextPage = page > 1 && remainingOnPage === 0 ? page - 1 : page;
      setPage(nextPage);
      loadSavedGames(nextPage, searchQuery, selectedTypeFilter, statusFilter, discoverTab).catch(() => {});
    } catch (err: any) {
      toast.error(
        err.message ||
          'Không thể xóa bộ câu hỏi. Vui lòng đảm bảo bạn có quyền xóa và bộ câu hỏi không có phòng chơi đang hoạt động.',
        'Lỗi xóa bộ câu hỏi'
      );
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExecuteEndSession = async () => {
    if (!confirmEndSessionModal) return;
    const { game, sessionId } = confirmEndSessionModal;
    setIsEndingSession(true);
    try {
      await endPracticeSession(sessionId);
      toast.success(
        `Đã kết thúc phiên luyện tập chơi đơn cho "${game.title}". Bạn có thể tiếp tục quản lý hoặc xóa game.`,
        'Kết thúc phiên thành công'
      );
      setConfirmEndSessionModal(null);
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
    } catch (err: any) {
      toast.error(err.message || 'Không thể kết thúc phiên luyện tập.', 'Lỗi kết thúc phiên');
    } finally {
      setIsEndingSession(false);
    }
  };

  const handleExecuteCloseRoom = async () => {
    if (!confirmCloseRoomModal) return;
    const { game, roomCode } = confirmCloseRoomModal;
    setIsClosingRoom(true);
    try {
      await closeMultiplayerRoom(roomCode);
      toast.success(
        `Đã đóng phòng chơi trực tiếp (PIN: ${roomCode}) cho "${game.title}".`,
        'Đóng phòng thành công'
      );
      setConfirmCloseRoomModal(null);
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
    } catch (err: any) {
      toast.error(err.message || 'Không thể đóng phòng chơi trực tiếp.', 'Lỗi đóng phòng');
    } finally {
      setIsClosingRoom(false);
    }
  };

  const handleUpdateEditQuestion = (index: number, patch: Partial<GameQuestion>) => {
    setEditQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== index) return q;
        const updated = { ...q, ...patch };
        if (patch.type) {
          if (patch.type === 'MULTIPLE_CHOICE' && (!updated.choices || updated.choices.length !== 4)) {
            updated.choices = ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'];
            updated.correctAnswer = 'Lựa chọn A';
          } else if (patch.type === 'QUICK_BUTTON' && (!updated.choices || updated.choices.length < 2)) {
            updated.choices = ['Đúng', 'Sai'];
            updated.correctAnswer = 'Đúng';
          } else if (patch.type === 'FILL_IN_THE_BLANK' || patch.type === 'CROSSWORD') {
            updated.choices = undefined;
          }
        }
        return updated;
      })
    );
  };

  const handleMoveEditQuestion = (index: number, direction: 'UP' | 'DOWN') => {
    setEditQuestions((prev) => {
      const targetIndex = direction === 'UP' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handleDuplicateEditQuestion = (index: number) => {
    const target = editQuestions[index];
    if (!target) return;
    const cloned: GameQuestion = {
      ...target,
      id: `q_dup_${Date.now()}_${editQuestions.length + 1}`,
      choices: target.choices ? [...target.choices] : undefined,
    };
    setEditQuestions((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, cloned);
      return next;
    });
    toast.info(`Đã nhân bản Câu #${index + 1}`, 'Đã nhân bản');
  };

  const handleAddEditQuestion = () => {
    if (!activeGameSpec) return;
    const defaultType: QuestionType =
      activeGameSpec.gameType === 'MIXED' || activeGameSpec.gameType === 'ADVENTURE'
        ? 'MULTIPLE_CHOICE'
        : activeGameSpec.gameType;
    const fallbackRef = activeGameSpec.questions[0]?.sourceReference || {
      sourceId: activeGameSpec.sourceSummary?.sources?.[0]?.sourceId || 'src_manual',
      sourceType: activeGameSpec.sourceSummary?.sources?.[0]?.sourceType || 'FILE',
      sourceLocation: activeGameSpec.sourceSummary?.sources?.[0]?.sourceLocation || 'Manual',
    };

    const newQuestion: GameQuestion = {
      id: `q_custom_${Date.now()}_${editQuestions.length + 1}`,
      type: defaultType,
      question:
        defaultType === 'FILL_IN_THE_BLANK'
          ? 'Nhập nội dung câu hỏi có chỗ trống ___ tại đây?'
          : 'Nhập nội dung câu hỏi mới tại đây?',
      choices:
        defaultType === 'MULTIPLE_CHOICE'
          ? ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D']
          : defaultType === 'QUICK_BUTTON'
            ? ['Đúng', 'Sai']
            : undefined,
      correctAnswer:
        defaultType === 'MULTIPLE_CHOICE'
          ? 'Lựa chọn A'
          : defaultType === 'QUICK_BUTTON'
            ? 'Đúng'
            : 'ĐÁP ÁN',
      explanation: 'Giải thích đáp án dựa trên tài liệu nguồn.',
      difficulty: 'MEDIUM',
      sourceReference: fallbackRef,
    };

    setEditQuestions((prev) => [...prev, newQuestion]);
  };

  const handleDeleteEditQuestion = (index: number) => {
    if (editQuestions.length <= 1) {
      toast.warning('Bộ câu hỏi phải có tối thiểu 1 câu hỏi.', 'Không thể xóa');
      return;
    }
    setEditQuestions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveEdits = async () => {
    if (!activeGameSpec) return;
    setIsSavingEdits(true);
    try {
      const updated = await saveEditedQuestions(activeGameSpec.gameId, {
        title: editTitle.trim() || activeGameSpec.title,
        description: editDescription.trim() || activeGameSpec.description,
        questions: editQuestions,
        settings: {
          timePerQuestion: editTimePerQuestion,
          scoringMode: editScoringMode,
        },
        isPublic: editIsPublic,
      });
      setActiveGameSpec(updated);
      syncEditorFromSpec(updated);
      setIsEditMode(false);
      toast.success('Đã lưu cập nhật bộ câu hỏi thành công.', 'Đã lưu');
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu chỉnh sửa câu hỏi.', 'Lỗi lưu');
    } finally {
      setIsSavingEdits(false);
    }
  };

  // Trích xuất danh sách chủ đề / ngành nghề thực tế từ các game đang có
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

  // Áp dụng lọc chủ đề/ngành nghề + từ khóa mở rộng + sắp xếp trên danh sách đã tải
  const displayedGames = useMemo(() => {
    let list = [...savedGames];

    if (selectedIndustryFilter !== 'ALL') {
      list = list.filter((g) => g.adventureConfig?.industryId === selectedIndustryFilter);
    }

    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (trimmedQuery) {
      list = list.filter((g) => {
        const inTitle = g.title.toLowerCase().includes(trimmedQuery);
        const inDesc = (g.description || '').toLowerCase().includes(trimmedQuery);
        const inIndustry = (g.adventureConfig?.industryLabel || '').toLowerCase().includes(trimmedQuery);
        const inSubEnv = (g.adventureConfig?.subEnvironment || '').toLowerCase().includes(trimmedQuery);
        const inOwner = (g.ownerUserId || '').toLowerCase().includes(trimmedQuery);
        return inTitle || inDesc || inIndustry || inSubEnv || inOwner;
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'TITLE_ASC') {
        return a.title.localeCompare(b.title, 'vi');
      }
      if (sortBy === 'QUESTIONS_DESC') {
        return (b.questionCount || 0) - (a.questionCount || 0);
      }
      if (sortBy === 'UPDATED') {
        return (
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
        );
      }
      // NEWEST default
      return (
        new Date(b.createdAt || b.updatedAt || 0).getTime() -
        new Date(a.createdAt || a.updatedAt || 0).getTime()
      );
    });

    return list;
  }, [savedGames, selectedIndustryFilter, searchQuery, sortBy]);

  // Kệ "Mới tạo gần đây" (hiển thị tối đa 4 game mới nhất khi ở chế độ khám phá mặc định)
  const recentlyCreatedShelf = useMemo(() => {
    return [...savedGames]
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.updatedAt || 0).getTime() -
          new Date(a.createdAt || a.updatedAt || 0).getTime()
      )
      .slice(0, 4);
  }, [savedGames]);

  // Các chỉ số thực tế của trang hiện tại
  const summaryStats = useMemo(() => {
    const publishedOnPage = savedGames.filter((g) => g.isPublic).length;
    const draftOnPage = savedGames.filter((g) => !g.isPublic).length;
    const activeLiveCount = savedGames.filter(
      (g) => g.activeStatus?.hasActiveRoom || g.activeStatus?.hasActiveSession
    ).length;
    return {
      publishedOnPage,
      draftOnPage,
      activeLiveCount,
    };
  }, [savedGames]);

  // Đếm số lượng bộ câu hỏi theo từng cách chơi thực tế trong kho
  const formatCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of savedGames) {
      counts[g.gameType] = (counts[g.gameType] || 0) + 1;
    }
    return counts;
  }, [savedGames]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedTypeFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    discoverTab !== 'ALL' ||
    selectedIndustryFilter !== 'ALL' ||
    sortBy !== 'NEWEST';

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const getOwnerBadgeLabel = (game: PersistedGameSummary): string => {
    if (currentUser && game.ownerUserId && game.ownerUserId === currentUser.userId) {
      return 'Game của tôi';
    }
    if (game.ownerUserId) {
      return `Creator • ${game.ownerUserId.slice(0, 8)}`;
    }
    return 'Kho chung AI';
  };

  return (
    <div
      className="kho-game-discover-root"
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
        .kho-game-discover-root {
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
        [data-theme="light"] .kho-game-discover-root {
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
          --accent-lime: #3f6212;
          --accent-lime-subtle: #ecfccb;
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
      {/* 1. KHI ĐANG MỞ XEM CHI TIẾT / CHỈNH SỬA BỘ CÂU HỎI */}
      {activeGameSpec ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '14px',
              borderBottom: '1px solid var(--border-subtle)',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setActiveGameSpec(null);
                  setIsEditMode(false);
                }}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '36px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <ArrowLeftIcon size={14} />
                <span>{isLibraryMode ? 'Quay lại Thư viện' : 'Quay lại Kho Game'}</span>
              </button>

              <span
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                  color: 'var(--accent-sky)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                }}
              >
                {formatGameTypeName(activeGameSpec.gameType)}
              </span>

              <h1
                style={{
                  margin: 0,
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                }}
                title={editTitle || activeGameSpec.title}
              >
                {isEditMode ? 'Chỉnh sửa: ' : 'Chi tiết: '}
                {editTitle || activeGameSpec.title}
              </h1>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '20px',
                paddingBottom: '16px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ flex: '1 1 380px' }}>
                {isEditMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <label
                          htmlFor="edit-spec-title"
                          style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            marginBottom: '6px',
                          }}
                        >
                          Tiêu đề bộ câu hỏi
                        </label>
                        <input
                          id="edit-spec-title"
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            fontWeight: 700,
                            fontSize: '0.92rem',
                            boxSizing: 'border-box',
                            height: '40px',
                          }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="edit-spec-desc"
                          style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            marginBottom: '6px',
                          }}
                        >
                          Mô tả
                        </label>
                        <input
                          id="edit-spec-desc"
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            fontSize: '0.88rem',
                            boxSizing: 'border-box',
                            height: '40px',
                          }}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <label
                          htmlFor="edit-spec-time"
                          style={{
                            display: 'block',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            marginBottom: '6px',
                          }}
                        >
                          Thời gian mỗi câu (5-60 giây)
                        </label>
                        <input
                          id="edit-spec-time"
                          type="number"
                          min={5}
                          max={60}
                          value={editTimePerQuestion}
                          onChange={(e) =>
                            setEditTimePerQuestion(Math.max(5, Math.min(60, Number(e.target.value) || 15)))
                          }
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            fontWeight: 700,
                            boxSizing: 'border-box',
                            height: '40px',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="edit-spec-score"
                          style={{
                            display: 'block',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            marginBottom: '6px',
                          }}
                        >
                          Chế độ tính điểm
                        </label>
                        <select
                          id="edit-spec-score"
                          value={editScoringMode}
                          onChange={(e) => setEditScoringMode(e.target.value as ScoringMode)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            fontWeight: 700,
                            height: '40px',
                          }}
                        >
                          <option value="SPEED_BONUS">Thưởng tốc độ (Speed Bonus)</option>
                          <option value="STANDARD">Tiêu chuẩn (Standard)</option>
                          <option value="STREAK">Chuỗi đúng (Streak)</option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="edit-spec-status"
                          style={{
                            display: 'block',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            marginBottom: '6px',
                          }}
                        >
                          Trạng thái xuất bản
                        </label>
                        <select
                          id="edit-spec-status"
                          value={editIsPublic ? 'PUBLISHED' : 'DRAFT'}
                          onChange={(e) => setEditIsPublic(e.target.value === 'PUBLISHED')}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-input)',
                            color: editIsPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                            fontWeight: 700,
                            height: '40px',
                          }}
                        >
                          <option value="PUBLISHED">Đã xuất bản (Cho phép chơi & mở phòng)</option>
                          <option value="DRAFT">Bản nháp (Ẩn khỏi người chơi)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          backgroundColor: 'rgba(56, 189, 248, 0.14)',
                          color: 'var(--accent-sky)',
                          padding: '3px 10px',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                        }}
                      >
                        {formatGameTypeName(activeGameSpec.gameType)}
                      </span>
                      <span
                        style={{
                          backgroundColor: activeGameSpec.isPublic
                            ? 'rgba(16, 185, 129, 0.14)'
                            : 'rgba(245, 158, 11, 0.15)',
                          color: activeGameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                          padding: '3px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {activeGameSpec.isPublic ? <CheckIcon size={12} /> : <PencilIcon size={12} />}
                        <span>{activeGameSpec.isPublic ? 'Đã xuất bản' : 'Bản nháp'}</span>
                      </span>
                      <span
                        style={{
                          fontSize: '0.82rem',
                          color: 'var(--text-secondary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        • {activeGameSpec.questions.length} câu hỏi • {activeGameSpec.settings.timePerQuestion}s/câu •
                        Điểm: {formatScoringModeName(activeGameSpec.settings.scoringMode)}
                      </span>
                    </div>
                    <h2
                      style={{
                        margin: '10px 0 6px 0',
                        fontSize: '1.35rem',
                        fontWeight: 800,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {activeGameSpec.title}
                    </h2>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {activeGameSpec.description}
                    </p>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {isEditMode ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      disabled={isSavingEdits}
                      style={{
                        backgroundColor: 'var(--accent-emerald)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0 16px',
                        height: '38px',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        cursor: isSavingEdits ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {isSavingEdits ? (
                        <>
                          <SpinnerIcon size={15} />
                          <span>Đang lưu...</span>
                        </>
                      ) : (
                        <>
                          <CheckIcon size={15} />
                          <span>Lưu Thay Đổi</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleAddEditQuestion}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--accent-sky)',
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
                      <PlusIcon size={14} />
                      <span>Thêm câu hỏi</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        syncEditorFromSpec(activeGameSpec);
                        setIsEditMode(false);
                      }}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0 14px',
                        height: '38px',
                        fontWeight: 600,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                      }}
                    >
                      Hủy sửa
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handlePlaySavedGame(activeGameSpec.gameId, true)}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: 'var(--primary-ink, #08090e)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0 16px',
                        height: '38px',
                        fontWeight: 800,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <GamepadIcon size={15} />
                      <span>Chơi đơn</span>
                    </button>
                    {activeGameSpec.isPublic && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenSoloShareModal({
                              gameId: activeGameSpec.gameId,
                              title: activeGameSpec.title,
                              isPublic: activeGameSpec.isPublic,
                            })
                          }
                          disabled={isLoadingSoloShare}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-sky)',
                            border: '1px solid var(--accent-sky)',
                            borderRadius: '8px',
                            padding: '0 14px',
                            height: '38px',
                            fontWeight: 700,
                            fontSize: '0.83rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <QrCodeIcon size={15} />
                          <span>Link / QR Chơi đơn</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenMultiplayerRoom({
                              gameId: activeGameSpec.gameId,
                              title: activeGameSpec.title,
                              isPublic: activeGameSpec.isPublic,
                            })
                          }
                          disabled={isOpeningRoomGameId === activeGameSpec.gameId}
                          style={{
                            backgroundColor: 'var(--accent-emerald)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '0 16px',
                            height: '38px',
                            fontWeight: 700,
                            fontSize: '0.83rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          {isOpeningRoomGameId === activeGameSpec.gameId ? (
                            <>
                              <SpinnerIcon size={15} />
                              <span>Đang mở phòng...</span>
                            </>
                          ) : (
                            <>
                              <UsersIcon size={15} />
                              <span>Mở phòng Multiplayer</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsEditMode(true)}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--accent-amber)',
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
                      <PencilIcon size={14} />
                      <span>Sửa game</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportGame(activeGameSpec.gameId, 'csv')}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--accent-emerald)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0 12px',
                        height: '38px',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      Xuất CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportGame(activeGameSpec.gameId, 'json')}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--accent-sky)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0 12px',
                        height: '38px',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      Xuất JSON
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setActiveGameSpec(null)}
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
                    gap: '4px',
                  }}
                >
                  <XMarkIcon size={14} />
                  <span>Đóng</span>
                </button>
              </div>
            </div>

            {/* Danh sách câu hỏi trong bộ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(isEditMode ? editQuestions : activeGameSpec.questions).map((q, idx) => (
                <div
                  key={q.id || idx}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '10px',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '10px',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontWeight: 800,
                          color: 'var(--accent-sky)',
                          fontSize: '0.88rem',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        Câu #{idx + 1}
                      </span>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(148, 163, 184, 0.14)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {formatGameTypeName(q.type)}
                      </span>
                    </div>

                    {isEditMode && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveEditQuestion(idx, 'UP')}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: idx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: idx === 0 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          ↑ Lên
                        </button>
                        <button
                          type="button"
                          disabled={idx === editQuestions.length - 1}
                          onClick={() => handleMoveEditQuestion(idx, 'DOWN')}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: idx === editQuestions.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: idx === editQuestions.length - 1 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          ↓ Xuống
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateEditQuestion(idx)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--accent-sky)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <CopyIcon size={13} />
                          <span>Nhân bản</span>
                        </button>
                        {activeGameSpec.gameType === 'MIXED' && (
                          <select
                            value={q.type}
                            onChange={(e) =>
                              handleUpdateEditQuestion(idx, { type: e.target.value as QuestionType })
                            }
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                            }}
                          >
                            <option value="MULTIPLE_CHOICE">Trắc nghiệm ABCD</option>
                            <option value="FILL_IN_THE_BLANK">Điền từ</option>
                            <option value="QUICK_BUTTON">Đúng / Sai</option>
                            <option value="CROSSWORD">Ô chữ</option>
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteEditQuestion(idx)}
                          style={{
                            backgroundColor: 'rgba(244, 63, 94, 0.14)',
                            color: 'var(--accent-rose)',
                            border: '1px solid var(--accent-rose)',
                            borderRadius: '6px',
                            padding: '5px 10px',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <TrashIcon size={13} />
                          <span>Xóa câu</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                            marginBottom: '4px',
                          }}
                        >
                          Nội dung câu hỏi
                        </label>
                        <input
                          type="text"
                          value={q.question}
                          onChange={(e) => handleUpdateEditQuestion(idx, { question: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.88rem',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      {(q.type === 'MULTIPLE_CHOICE' || q.type === 'QUICK_BUTTON') && q.choices && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '8px',
                          }}
                        >
                          {q.choices.map((ch, cIdx) => (
                            <div key={cIdx}>
                              <label
                                style={{
                                  display: 'block',
                                  fontSize: '0.73rem',
                                  color: 'var(--text-secondary)',
                                  marginBottom: '4px',
                                }}
                              >
                                Lựa chọn {cIdx + 1}
                              </label>
                              <input
                                type="text"
                                value={ch}
                                onChange={(e) => {
                                  const nextChoices = [...(q.choices || [])];
                                  const oldVal = nextChoices[cIdx];
                                  nextChoices[cIdx] = e.target.value;
                                  const nextPatch: Partial<GameQuestion> = { choices: nextChoices };
                                  if (q.correctAnswer === oldVal) {
                                    nextPatch.correctAnswer = e.target.value;
                                  }
                                  handleUpdateEditQuestion(idx, nextPatch);
                                }}
                                style={{
                                  width: '100%',
                                  padding: '7px 10px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-strong)',
                                  backgroundColor: 'var(--bg-surface)',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.84rem',
                                  boxSizing: 'border-box',
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                          gap: '10px',
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '0.76rem',
                              fontWeight: 600,
                              color: 'var(--accent-emerald)',
                              marginBottom: '4px',
                            }}
                          >
                            Đáp án đúng
                          </label>
                          {(q.type === 'QUICK_BUTTON' || q.type === 'MULTIPLE_CHOICE') && q.choices ? (
                            <select
                              value={q.correctAnswer}
                              onChange={(e) => handleUpdateEditQuestion(idx, { correctAnswer: e.target.value })}
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-strong)',
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                fontWeight: 700,
                              }}
                            >
                              {q.choices.map((ch, cIdx) => (
                                <option key={cIdx} value={ch}>
                                  {ch}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={q.correctAnswer}
                              onChange={(e) =>
                                handleUpdateEditQuestion(idx, {
                                  correctAnswer: e.target.value,
                                  ...(q.type === 'CROSSWORD' ? { crosswordAnswer: e.target.value } : {}),
                                })
                              }
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-strong)',
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                fontSize: '0.84rem',
                                boxSizing: 'border-box',
                              }}
                            />
                          )}
                        </div>

                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '0.76rem',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              marginBottom: '4px',
                            }}
                          >
                            Giải thích (Explanation)
                          </label>
                          <input
                            type="text"
                            value={q.explanation || ''}
                            onChange={(e) => handleUpdateEditQuestion(idx, { explanation: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              fontSize: '0.84rem',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          marginBottom: '8px',
                        }}
                      >
                        {q.question}
                      </div>
                      {q.choices && q.choices.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                          {q.choices.map((ch, cIdx) => {
                            const isCorrect = ch === q.correctAnswer;
                            return (
                              <span
                                key={cIdx}
                                style={{
                                  fontSize: '0.8rem',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  border: isCorrect
                                    ? '1px solid var(--accent-emerald)'
                                    : '1px solid var(--border-subtle)',
                                  backgroundColor: isCorrect
                                    ? 'rgba(16, 185, 129, 0.14)'
                                    : 'var(--bg-surface)',
                                  color: isCorrect ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                                  fontWeight: isCorrect ? 700 : 500,
                                }}
                              >
                                {ch}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: '0.82rem',
                          color: 'var(--accent-emerald)',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <CheckIcon size={14} />
                        <span>Đáp án đúng: {q.correctAnswer}</span>
                      </div>
                      {q.explanation && (
                        <div style={{ fontSize: '0.81rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Giải thích: {q.explanation}
                        </div>
                      )}
                      {q.sourceReference && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Nguồn: {q.sourceReference.sourceLocation}
                          {q.sourceReference.section ? ` — ${q.sourceReference.section}` : ''}
                          {q.sourceReference.page ? ` (Trang ${q.sourceReference.page})` : ''}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* 2. TRẢI NGHIỆM KHÁM PHÁ KHO GAME (KAHOOT DISCOVER + DESIGN TASTE SKILL) */
        <>
          {/* A. HEADER & KHU VỰC TÌM KIẾM TRUNG TÂM */}
          <section
            aria-label={isLibraryMode ? 'Thư viện bộ câu hỏi' : 'Khám phá kho game'}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: 'clamp(18px, 2.2vw, 24px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            {/* Hàng tiêu đề h1 + Hành động chính */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h1
                    style={{
                      margin: 0,
                      fontSize: 'clamp(1.35rem, 2vw, 1.65rem)',
                      fontWeight: 800,
                      letterSpacing: '-0.02em',
                      color: 'var(--text-primary)',
                      lineHeight: 1.2,
                    }}
                  >
                    {isLibraryMode ? 'Thư viện bộ câu hỏi' : 'Kho Game'}
                  </h1>
                  <span
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {totalCount} bộ câu hỏi
                  </span>
                  {isDetailLoading && (
                    <span
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--accent-sky)',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <SpinnerIcon size={14} />
                      <span>Đang nạp game...</span>
                    </span>
                  )}
                </div>
                <p
                  style={{
                    margin: '6px 0 0 0',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}
                >
                  {isLibraryMode
                    ? 'Quản lý toàn bộ các bộ câu hỏi trong kho: lọc theo trạng thái xuất bản, chỉnh sửa, lấy QR hoặc tổ chức phòng chơi trực tiếp.'
                    : 'Tổng quan kho học liệu tương tác theo cách chơi, chủ đề ngành nghề và các bộ câu hỏi vừa được khởi tạo.'}
                </p>
              </div>

              {/* Cụm nút hành động chính: Mở Thư viện (khi ở Kho Game) + Tạo game + Làm mới + Xóa tất cả */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {!isLibraryMode && onNavigateToLibrary && (
                  <button
                    id="overview-open-library-btn"
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

                <button
                  id="discover-create-game-btn"
                  type="button"
                  onClick={() => handleNavigateToCreator()}
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

                <button
                  type="button"
                  onClick={() =>
                    loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab)
                  }
                  disabled={isLoading}
                  title="Làm mới danh sách"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '8px',
                    padding: '0 12px',
                    height: '38px',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isLoading ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
                  <span>Làm mới</span>
                </button>

                {isLibraryMode && (
                  <button
                    type="button"
                    onClick={() => setIsConfirmDeleteAllOpen(true)}
                    disabled={isLoading || totalCount === 0}
                    title="Xóa toàn bộ game trong kho"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--accent-rose)',
                      border: '1px solid rgba(244, 63, 94, 0.35)',
                      borderRadius: '8px',
                      padding: '0 12px',
                      height: '38px',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: isLoading || totalCount === 0 ? 'not-allowed' : 'pointer',
                      opacity: isLoading || totalCount === 0 ? 0.45 : 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <TrashIcon size={13} />
                    <span>Xóa tất cả</span>
                  </button>
                )}
              </div>
            </div>

            {/* Thanh tìm kiếm Kahoot Discover nổi bật + Dải số liệu thực tế */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              <form
                onSubmit={handleSearchSubmit}
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
                    id="analytics-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      isLibraryMode
                        ? 'Tìm bộ câu hỏi theo tên game, chủ đề, ngành nghề hoặc mô tả...'
                        : 'Nhập từ khóa để tìm bộ câu hỏi trong Thư viện...'
                    }
                    aria-label="Tìm kiếm kho game"
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
                      id="analytics-clear-search-btn"
                      type="button"
                      aria-label="Xóa từ khóa tìm kiếm"
                      onClick={() => {
                        setSearchQuery('');
                        if (isLibraryMode) {
                          setPage(1);
                          loadSavedGames(1, '', selectedTypeFilter, statusFilter, discoverTab);
                        }
                      }}
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
                <button
                  type="submit"
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-ink, #08090e)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0 16px',
                    height: '40px',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {isLibraryMode ? 'Tìm kiếm' : 'Tìm trong Thư viện'}
                </button>
              </form>

              {/* Divided KPI Summary Strip (Design Taste Skill §5: 1px hairlines, label above value, tabular-nums) */}
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
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Tổng kho</div>
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
                    {summaryStats.publishedOnPage}
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
                    {summaryStats.draftOnPage}
                  </div>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Đang hoạt động</div>
                  <div
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: summaryStats.activeLiveCount > 0 ? 'var(--accent-sky)' : 'var(--text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {summaryStats.activeLiveCount}
                  </div>
                </div>
              </div>
            </div>

            {/* B. ĐIỀU HƯỚNG TAB & THANH CÔNG CỤ LỌC / SẮP XẾP (TRONG THƯ VIỆN) */}
            {isLibraryMode && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                {/* Tabs phân loại dựa trên dữ liệu thực tế */}
                <div
                  role="tablist"
                  aria-label="Phân loại thư viện bộ câu hỏi"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  {(
                    [
                      { key: 'ALL' as DiscoverTabKey, label: 'Tất cả' },
                      { key: 'PUBLISHED' as DiscoverTabKey, label: 'Đã xuất bản' },
                      { key: 'DRAFT' as DiscoverTabKey, label: 'Bản nháp' },
                      ...(currentUser?.userId ? [{ key: 'MINE' as DiscoverTabKey, label: 'Của tôi' }] : []),
                    ]
                  ).map((tab) => {
                    const isActive = discoverTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        id={`library-tab-${tab.key.toLowerCase()}`}
                        role="tab"
                        aria-selected={isActive}
                        type="button"
                        onClick={() => handleTabSelect(tab.key)}
                        style={{
                          height: '34px',
                          padding: '0 14px',
                          borderRadius: '6px',
                          border: isActive ? '1px solid var(--primary)' : '1px solid transparent',
                          backgroundColor: isActive ? 'var(--primary-subtle)' : 'transparent',
                          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontWeight: isActive ? 700 : 500,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Bộ lọc loại game, trạng thái, ngành nghề, sắp xếp & chuyển đổi Lưới/Bảng */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <select
                    id="analytics-type-filter"
                    aria-label="Lọc theo loại game"
                    value={selectedTypeFilter}
                    onChange={(e) => setSelectedTypeFilter(e.target.value)}
                    style={{
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      height: '34px',
                    }}
                  >
                    <option value="ALL">Tất cả thể loại</option>
                    <option value="MULTIPLE_CHOICE">Trắc nghiệm ABCD</option>
                    <option value="FILL_IN_THE_BLANK">Điền từ</option>
                    <option value="QUICK_BUTTON">Đúng / Sai</option>
                    <option value="CROSSWORD">Ô chữ</option>
                    <option value="MIXED">Hỗn hợp</option>
                    <option value="ADVENTURE">Đi cảnh theo ngành nghề</option>
                  </select>

                  <select
                    id="analytics-status-filter"
                    aria-label="Lọc theo trạng thái xuất bản"
                    value={statusFilter}
                    onChange={(e) =>
                      handleStatusSelectChange(e.target.value as 'ALL' | 'PUBLISHED' | 'DRAFT')
                    }
                    style={{
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      height: '34px',
                    }}
                  >
                    <option value="ALL">Tất cả trạng thái</option>
                    <option value="PUBLISHED">Đã xuất bản</option>
                    <option value="DRAFT">Bản nháp</option>
                  </select>

                  {availableIndustries.length > 0 && (
                    <select
                      id="analytics-industry-filter"
                      aria-label="Lọc theo chủ đề ngành nghề"
                      value={selectedIndustryFilter}
                      onChange={(e) => setSelectedIndustryFilter(e.target.value)}
                      style={{
                        padding: '0 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        height: '34px',
                      }}
                    >
                      <option value="ALL">Tất cả ngành nghề ({availableIndustries.length})</option>
                      {availableIndustries.map((ind) => (
                        <option key={ind.id} value={ind.id}>
                          {ind.label} ({ind.count})
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    id="analytics-sort-select"
                    aria-label="Sắp xếp danh sách game"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOptionKey)}
                    style={{
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      height: '34px',
                    }}
                  >
                    <option value="NEWEST">Sắp xếp: Mới nhất</option>
                    <option value="UPDATED">Sắp xếp: Cập nhật gần đây</option>
                    <option value="TITLE_ASC">Sắp xếp: Tên A–Z</option>
                    <option value="QUESTIONS_DESC">Sắp xếp: Nhiều câu hỏi nhất</option>
                  </select>

                  {/* View Layout Toggle */}
                  <div
                    style={{
                      display: 'inline-flex',
                      backgroundColor: 'var(--bg-input)',
                      padding: '2px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      height: '34px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setViewLayout('grid')}
                      style={{
                        padding: '0 10px',
                        borderRadius: '4px',
                        border: viewLayout === 'grid' ? '1px solid var(--border-strong)' : '1px solid transparent',
                        backgroundColor: viewLayout === 'grid' ? 'var(--bg-elevated)' : 'transparent',
                        color: viewLayout === 'grid' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                        cursor: 'pointer',
                        height: '100%',
                      }}
                    >
                      Lưới
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewLayout('list')}
                      style={{
                        padding: '0 10px',
                        borderRadius: '4px',
                        border: viewLayout === 'list' ? '1px solid var(--border-strong)' : '1px solid transparent',
                        backgroundColor: viewLayout === 'list' ? 'var(--bg-elevated)' : 'transparent',
                        color: viewLayout === 'list' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                        cursor: 'pointer',
                        height: '100%',
                      }}
                    >
                      Bảng
                    </button>
                  </div>

                  {hasActiveFilters && (
                    <button
                      id="analytics-reset-filters-btn"
                      type="button"
                      onClick={handleResetAllFilters}
                      style={{
                        backgroundColor: 'transparent',
                        color: 'var(--accent-sky)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: '6px',
                        padding: '0 10px',
                        height: '34px',
                        fontWeight: 700,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Xóa bộ lọc
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Error Alert */}
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
                onClick={() => loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab)}
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

          {!isLibraryMode ? (
            <>
              {/* C1. KHÁM PHÁ THEO CÁCH CHƠI (BỘ SƯU TẬP 5 ĐỊNH DẠNG BACKEND + ADVENTURE) */}
              <section aria-label="Khám phá theo cách chơi" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Khám phá theo cách chơi
                    </h2>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Chọn định dạng câu hỏi hoặc chế độ nhập vai để mở trong Thư viện hoặc tạo trò chơi mới tương ứng
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {DISCOVER_FORMAT_COLLECTIONS.map((fmt) => {
                    const countInRepo = formatCounts[fmt.id] || 0;
                    return (
                      <div
                        key={fmt.id}
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '10px',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                        }}
                      >
                        {/* Ảnh bìa minh họa cho từng cách chơi */}
                        <div
                          style={{
                            position: 'relative',
                            height: '96px',
                            width: '100%',
                            overflow: 'hidden',
                            borderBottom: '1px solid var(--border-subtle)',
                          }}
                        >
                          <GameFormatIllustration type={fmt.id} />
                          <span
                            style={{
                              position: 'absolute',
                              top: '8px',
                              left: '8px',
                              fontSize: '0.7rem',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--discover-cover-badge-bg)',
                              color: fmt.accentColor,
                              border: '1px solid var(--discover-cover-badge-border)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {fmt.mechanicTag}
                          </span>
                          <span
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              fontSize: '0.7rem',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--discover-cover-badge-bg)',
                              color: 'var(--discover-cover-badge-text)',
                              border: '1px solid var(--discover-cover-badge-border)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {countInRepo} bộ
                          </span>
                        </div>

                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, justifyContent: 'space-between' }}>
                          <div>
                            <h3 style={{ margin: '0 0 4px 0', fontSize: '0.94rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                              {fmt.label}
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.42 }}>
                              {fmt.shortDesc}
                            </p>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateToLibrary
                                  ? onNavigateToLibrary({ gameType: fmt.id, nonce: Date.now() })
                                  : setSelectedTypeFilter(fmt.id)
                              }
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0 10px',
                                height: '30px',
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Xem trong Thư viện
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNavigateToCreator(fmt.id)}
                              style={{
                                backgroundColor: fmt.badgeBg,
                                border: '1px solid transparent',
                                borderRadius: '6px',
                                color: fmt.accentColor,
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                                padding: '0 10px',
                                height: '30px',
                              }}
                            >
                              + Tạo mới
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* C2. KHÁM PHÁ THEO NGÀNH NGHỀ / CHỦ ĐỀ THỰC TẾ (KHI DỮ LIỆU KHO GAME CÓ NGÀNH NGHỀ) */}
              {availableIndustries.length > 0 && (
                <section aria-label="Khám phá theo ngành nghề" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Khám phá theo chủ đề & ngành hàng
                    </h2>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigateToLibrary
                          ? onNavigateToLibrary({ industry: 'ALL', nonce: Date.now() })
                          : setSelectedIndustryFilter('ALL')
                      }
                      style={{
                        height: '32px',
                        padding: '0 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--primary)',
                        backgroundColor: 'var(--accent-sky-subtle)',
                        color: 'var(--accent-sky)',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      Tất cả chủ đề
                    </button>
                    {availableIndustries.map((ind) => (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() =>
                          onNavigateToLibrary
                            ? onNavigateToLibrary({ industry: ind.id, nonce: Date.now() })
                            : setSelectedIndustryFilter(ind.id)
                        }
                        style={{
                          height: '32px',
                          padding: '0 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span>{ind.label}</span>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-secondary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {ind.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* C3. KỆ GAME MỚI TẠO GẦN ĐÂY TRONG KHO GAME */}
              <section
                aria-label="Game mới tạo gần đây"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Mới tạo gần đây
                    </h2>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Các bộ câu hỏi vừa được khởi tạo mới nhất trong hệ thống
                    </p>
                  </div>
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
                      <span>Xem tất cả trong Thư viện</span>
                      <ArrowRightIcon size={13} />
                    </button>
                  )}
                </div>

                {isLoading ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    {Array.from({ length: 4 }).map((_, idx) => (
                      <div
                        key={`overview-skeleton-${idx}`}
                        style={{
                          height: '96px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      />
                    ))}
                  </div>
                ) : recentlyCreatedShelf.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 16px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px dashed var(--border-strong)',
                      textAlign: 'center',
                      color: 'var(--text-secondary)',
                      fontSize: '0.86rem',
                    }}
                  >
                    Chưa có bộ câu hỏi nào trong kho. Hãy nhấn <strong style={{ color: 'var(--text-primary)' }}>Tạo game</strong> để biên soạn bộ câu hỏi đầu tiên.
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    {recentlyCreatedShelf.map((item) => (
                      <div
                        key={`recent-${item.gameId}`}
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
                        <div
                          style={{
                            position: 'relative',
                            height: '96px',
                            width: '100%',
                            overflow: 'hidden',
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
                              color: 'var(--discover-cover-badge-text)',
                              backgroundColor: 'var(--discover-cover-badge-bg)',
                              border: '1px solid var(--discover-cover-badge-border)',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatGameTypeName(item.gameType)}
                          </span>
                          <span
                            style={{
                              position: 'absolute',
                              bottom: '6px',
                              right: '8px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              color: 'var(--discover-cover-badge-text)',
                              backgroundColor: 'var(--discover-cover-badge-bg)',
                              border: '1px solid var(--discover-cover-badge-border)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.questionCount} câu • {item.timePerQuestion || 15}s
                          </span>
                        </div>

                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, justifyContent: 'space-between' }}>
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

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <span
                              style={{
                                fontSize: '0.72rem',
                                color: item.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                                fontWeight: 700,
                              }}
                            >
                              {item.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
                            </span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                onClick={() => handleViewOrEditGame(item.gameId, false)}
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
                                Chi tiết
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenModeModal(item.gameId)}
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
                                Mở nhanh
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            /* D. TRANG THƯ VIỆN: TẤT CẢ BỘ CÂU HỎI TRONG KHO (LƯỚI THẺ GAME HOẶC BẢNG) */
            <section aria-label="Danh sách bộ câu hỏi" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    Tất cả bộ câu hỏi trong kho
                  </h2>
                  {discoverTab !== 'ALL' && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--primary-subtle)',
                        color: 'var(--accent-sky)',
                      }}
                    >
                      {discoverTab === 'PUBLISHED'
                        ? 'Đã xuất bản'
                        : discoverTab === 'DRAFT'
                          ? 'Bản nháp'
                          : 'Của tôi'}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    Hiển thị {displayedGames.length} / {totalCount} bộ
                  </span>
                </div>
              </div>

            {isLoading ? (
              /* Skeleton Loading State theo Design Taste Skill §11: không dùng shimmer lòe loẹt, giữ đúng pitch của thẻ */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px',
                }}
              >
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={`skeleton-${idx}`}
                    style={{
                      borderRadius: '10px',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                      height: '310px',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{ height: '136px', backgroundColor: 'var(--bg-input)' }} />
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                      <div style={{ height: '18px', width: '75%', backgroundColor: 'var(--bg-input)', borderRadius: '4px' }} />
                      <div style={{ height: '14px', width: '50%', backgroundColor: 'var(--bg-input)', borderRadius: '4px' }} />
                      <div style={{ marginTop: 'auto', height: '32px', width: '100%', backgroundColor: 'var(--bg-input)', borderRadius: '6px' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayedGames.length === 0 ? (
              /* Empty State phân biệt rõ giữa kho trống và không khớp bộ lọc */
              <div
                style={{
                  padding: '40px 24px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px dashed var(--border-strong)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                }}
              >
                <div style={{ color: 'var(--text-muted)', marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
                  <BookOpenIcon size={32} />
                </div>
                <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px', fontSize: '1rem' }}>
                  {hasActiveFilters
                    ? 'Không tìm thấy bộ câu hỏi nào khớp với bộ lọc hiện tại'
                    : 'Chưa có bộ câu hỏi nào trong kho'}
                </div>
                <div style={{ fontSize: '0.86rem', maxWidth: '480px', margin: '0 auto 16px', lineHeight: 1.5 }}>
                  {hasActiveFilters
                    ? 'Hãy thử xóa từ khóa tìm kiếm hoặc đặt lại bộ lọc để xem toàn bộ danh sách game có sẵn.'
                    : 'Bắt đầu bằng cách tải tài liệu hoặc nhập chủ đề để AI tự động biên soạn bộ câu hỏi tương tác.'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={handleResetAllFilters}
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0 16px',
                        height: '36px',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                      }}
                    >
                      Xóa bộ lọc
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleNavigateToCreator()}
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-ink, #08090e)',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0 16px',
                      height: '36px',
                      fontWeight: 800,
                      fontSize: '0.84rem',
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
              </div>
            ) : viewLayout === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                  gap: '16px',
                  alignItems: 'stretch',
                }}
              >
                {displayedGames.map((g) => {
                  const isLockedByActive =
                    !g.activeStatus?.isDeletable &&
                    (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom);

                  return (
                    <article
                      key={g.gameId}
                      style={{
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.15s ease, background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-strong)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      }}
                    >
                      {/* Ảnh bìa minh họa nhất quán 136px */}
                      <div
                        style={{
                          position: 'relative',
                          height: '136px',
                          width: '100%',
                          overflow: 'hidden',
                          borderBottom: '1px solid var(--border-subtle)',
                          flexShrink: 0,
                        }}
                      >
                        <GameCoverIllustration game={g} />

                        {/* Top-left: Nhãn loại game */}
                        <span
                          style={{
                            position: 'absolute',
                            top: '10px',
                            left: '10px',
                            backgroundColor: 'var(--discover-cover-badge-bg, rgba(8, 9, 14, 0.88))',
                            color: 'var(--discover-cover-badge-text, #f2f4f8)',
                            border: '1px solid var(--discover-cover-badge-border, rgba(255, 255, 255, 0.16))',
                            padding: '3px 8px',
                            borderRadius: '5px',
                            fontWeight: 700,
                            fontSize: '0.72rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatGameTypeName(g.gameType)}
                        </span>

                        {/* Top-right: Trạng thái Xuất bản / Bản nháp */}
                        <span
                          style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            backgroundColor: g.isPublic
                              ? 'var(--discover-status-pub-bg, rgba(6, 78, 59, 0.92))'
                              : 'var(--discover-status-draft-bg, rgba(120, 53, 15, 0.92))',
                            color: g.isPublic
                              ? 'var(--discover-status-pub-text, #76d6ad)'
                              : 'var(--discover-status-draft-text, #f3c75f)',
                            border: g.isPublic
                              ? '1px solid var(--discover-status-pub-border, rgba(16, 185, 129, 0.42))'
                              : '1px solid var(--discover-status-draft-border, rgba(245, 158, 11, 0.42))',
                            padding: '3px 8px',
                            borderRadius: '5px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {g.isPublic ? <CheckIcon size={11} /> : <PencilIcon size={11} />}
                          <span>{g.isPublic ? 'Đã xuất bản' : 'Bản nháp'}</span>
                        </span>

                        {/* Bottom-right: Số câu hỏi & Thời gian mỗi câu (tabular-nums) */}
                        <span
                          style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '10px',
                            backgroundColor: 'var(--discover-cover-badge-bg, rgba(8, 9, 14, 0.88))',
                            color: 'var(--discover-cover-badge-text, #f2f4f8)',
                            border: '1px solid var(--discover-cover-badge-border, rgba(255, 255, 255, 0.16))',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {g.questionCount} câu hỏi • {g.timePerQuestion || 15}s
                        </span>
                      </div>

                      {/* Nội dung thân thẻ */}
                      <div
                        style={{
                          padding: '14px 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          flex: 1,
                          gap: '8px',
                        }}
                      >
                        {/* Nhãn ngành nghề / chủ đề hoặc cơ chế tính điểm */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: g.adventureConfig?.industryLabel
                              ? 'var(--accent-amber)'
                              : 'var(--accent-sky)',
                          }}
                        >
                          {g.adventureConfig?.industryLabel ? (
                            <>
                              <span>{g.adventureConfig.industryLabel}</span>
                              {g.adventureConfig.subEnvironment && (
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                                  • {g.adventureConfig.subEnvironment}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <span>{formatGameTypeName(g.gameType)}</span>
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                                • Điểm: {formatScoringModeName(g.scoringMode)}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Tiêu đề giới hạn 2 dòng không vỡ khung */}
                        <h3
                          style={{
                            margin: 0,
                            fontSize: '0.98rem',
                            fontWeight: 800,
                            color: 'var(--text-primary)',
                            lineHeight: 1.35,
                            minHeight: '2.65em',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                          }}
                          title={g.title}
                        >
                          {g.title}
                        </h3>

                        {/* Mô tả ngắn */}
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.45,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {g.description ||
                            g.adventureConfig?.learningObjective ||
                            'Bộ câu hỏi tương tác được biên soạn từ học liệu nguồn.'}
                        </p>

                        {/* Cảnh báo / điều khiển nhanh nếu đang có phiên chơi đơn hoặc phòng trực tiếp */}
                        {(g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom) && (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '6px',
                              paddingTop: '4px',
                            }}
                          >
                            {g.activeStatus?.hasActiveSession && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  backgroundColor: 'var(--accent-amber-subtle)',
                                  border: '1px solid rgba(245, 158, 11, 0.35)',
                                  borderRadius: '6px',
                                  padding: '2px 8px',
                                  fontSize: '0.72rem',
                                  color: 'var(--accent-amber)',
                                  fontWeight: 700,
                                }}
                              >
                                <span>Đang chơi đơn ({g.activeStatus.activeSessionCount})</span>
                                {g.activeStatus.activeSessions?.[0] && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmEndSessionModal({
                                        game: g,
                                        sessionId: g.activeStatus!.activeSessions[0].sessionId,
                                      })
                                    }
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--accent-amber)',
                                      textDecoration: 'underline',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      padding: 0,
                                    }}
                                  >
                                    Kết thúc
                                  </button>
                                )}
                              </div>
                            )}
                            {g.activeStatus?.hasActiveRoom && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  backgroundColor: 'var(--accent-sky-subtle)',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  borderRadius: '6px',
                                  padding: '2px 8px',
                                  fontSize: '0.72rem',
                                  color: 'var(--accent-sky)',
                                  fontWeight: 700,
                                }}
                              >
                                <span>
                                  Phòng PIN: {g.activeStatus.activeRooms?.[0]?.roomCode}
                                </span>
                                {g.activeStatus.activeRooms?.[0] && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmCloseRoomModal({
                                        game: g,
                                        roomCode: g.activeStatus!.activeRooms[0].roomCode,
                                      })
                                    }
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--accent-sky)',
                                      textDecoration: 'underline',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      padding: 0,
                                    }}
                                  >
                                    Đóng phòng
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Dòng thông tin Creator & Ngày cập nhật */}
                        <div
                          style={{
                            marginTop: 'auto',
                            paddingTop: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '0.74rem',
                            color: 'var(--text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span>{getOwnerBadgeLabel(g)}</span>
                          <span>
                            Cập nhật: {new Date(g.updatedAt || g.createdAt).toLocaleDateString('vi-VN')}
                          </span>
                        </div>

                        {/* Thanh nút thao tác theo quyền */}
                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            paddingTop: '10px',
                            borderTop: '1px solid var(--border-subtle)',
                            alignItems: 'center',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenModeModal(g.gameId)}
                            style={{
                              flex: 1,
                              backgroundColor: 'var(--primary)',
                              color: 'var(--primary-ink, #08090e)',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '0 10px',
                              height: '34px',
                              fontWeight: 800,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                            }}
                          >
                            <GamepadIcon size={14} />
                            <span>Mở Game</span>
                          </button>

                          {g.isPublic && (
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenSoloShareModal({
                                  gameId: g.gameId,
                                  title: g.title,
                                  isPublic: g.isPublic,
                                })
                              }
                              title="Chia sẻ Link & Mã QR chơi đơn"
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0 9px',
                                height: '34px',
                                fontWeight: 700,
                                fontSize: '0.76rem',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <QrCodeIcon size={13} />
                              <span>QR</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleViewOrEditGame(g.gameId, false)}
                            style={{
                              backgroundColor: 'var(--bg-input)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-strong)',
                              borderRadius: '6px',
                              padding: '0 10px',
                              height: '34px',
                              fontWeight: 700,
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            title="Xem chi tiết & Chỉnh sửa câu hỏi"
                          >
                            <PencilIcon size={13} />
                            <span>Sửa</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenDeleteModal(g)}
                            style={{
                              backgroundColor: 'var(--bg-input)',
                              color: isLockedByActive ? 'var(--text-muted)' : 'var(--accent-rose)',
                              border: `1px solid ${
                                isLockedByActive ? 'var(--border-subtle)' : 'rgba(239, 68, 68, 0.28)'
                              }`,
                              borderRadius: '6px',
                              padding: '0 9px',
                              height: '34px',
                              fontWeight: 700,
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            title={
                              isLockedByActive
                                ? 'Bộ câu hỏi đang có phiên/phòng hoạt động. Bấm để xem chi tiết mở khóa.'
                                : 'Xóa bộ câu hỏi'
                            }
                          >
                            {isLockedByActive ? <LockIcon size={12} /> : <TrashIcon size={13} />}
                            <span>Xóa</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              /* Chế độ xem Bảng / Danh sách (Design Taste Skill §7: rules & alignment, no zebra striping) */
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                {displayedGames.map((g, index) => {
                  const isLockedByActive =
                    !g.activeStatus?.isDeletable &&
                    (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom);

                  return (
                    <div
                      key={g.gameId}
                      style={{
                        padding: '12px 16px',
                        borderBottom:
                          index < displayedGames.length - 1
                            ? '1px solid var(--border-subtle)'
                            : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <div
                        style={{
                          flex: '1 1 300px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            backgroundColor: 'rgba(56, 189, 248, 0.12)',
                            color: 'var(--accent-sky)',
                            padding: '2px 8px',
                            borderRadius: '5px',
                            fontWeight: 700,
                            fontSize: '0.73rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatGameTypeName(g.gameType)}
                        </span>
                        <div
                          style={{
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            fontSize: '0.92rem',
                          }}
                        >
                          {g.title}
                        </div>
                        <span
                          style={{
                            backgroundColor: g.isPublic
                              ? 'rgba(16, 185, 129, 0.12)'
                              : 'rgba(245, 158, 11, 0.12)',
                            color: g.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                            padding: '2px 8px',
                            borderRadius: '5px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {g.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
                        </span>
                        <span
                          style={{
                            fontSize: '0.76rem',
                            color: 'var(--text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {g.questionCount} câu • {g.timePerQuestion || 15}s
                        </span>

                        {g.activeStatus?.hasActiveSession && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                backgroundColor: 'var(--accent-amber-subtle)',
                                color: 'var(--accent-amber)',
                                border: '1px solid rgba(245, 158, 11, 0.35)',
                                padding: '2px 8px',
                                borderRadius: '5px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                              }}
                            >
                              Chơi đơn ({g.activeStatus.activeSessionCount})
                            </span>
                            {g.activeStatus.activeSessions?.[0] && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmEndSessionModal({
                                    game: g,
                                    sessionId: g.activeStatus!.activeSessions[0].sessionId,
                                  })
                                }
                                style={{
                                  backgroundColor: 'var(--accent-amber-subtle)',
                                  color: 'var(--accent-amber)',
                                  border: '1px solid rgba(245, 158, 11, 0.4)',
                                  borderRadius: '5px',
                                  padding: '2px 8px',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                Kết thúc
                              </button>
                            )}
                          </div>
                        )}

                        {g.activeStatus?.hasActiveRoom && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                backgroundColor: 'rgba(56, 189, 248, 0.14)',
                                color: 'var(--accent-sky)',
                                border: '1px solid rgba(56, 189, 248, 0.35)',
                                padding: '2px 8px',
                                borderRadius: '5px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                              }}
                            >
                              Phòng PIN: {g.activeStatus.activeRooms?.[0]?.roomCode}
                            </span>
                            {g.activeStatus.activeRooms?.[0] && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmCloseRoomModal({
                                    game: g,
                                    roomCode: g.activeStatus!.activeRooms[0].roomCode,
                                  })
                                }
                                style={{
                                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                                  color: 'var(--accent-sky)',
                                  border: '1px solid rgba(56, 189, 248, 0.4)',
                                  borderRadius: '5px',
                                  padding: '2px 8px',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                Đóng phòng
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenModeModal(g.gameId)}
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: 'var(--primary-ink, #08090e)',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0 12px',
                            height: '32px',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <GamepadIcon size={14} />
                          <span>Mở Game</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleViewOrEditGame(g.gameId, false)}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 10px',
                            height: '32px',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          Chi tiết
                        </button>
                        <button
                          type="button"
                          onClick={() => handleViewOrEditGame(g.gameId, true)}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-amber)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 10px',
                            height: '32px',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteModal(g)}
                          style={{
                            backgroundColor: isLockedByActive
                              ? 'rgba(100, 116, 139, 0.12)'
                              : 'rgba(244, 63, 94, 0.12)',
                            color: isLockedByActive ? 'var(--text-muted)' : 'var(--accent-rose)',
                            border: `1px solid ${
                              isLockedByActive ? 'var(--border-subtle)' : 'var(--accent-rose)'
                            }`,
                            borderRadius: '6px',
                            padding: '0 10px',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {isLockedByActive ? <LockIcon size={12} /> : null}
                          <span>Xóa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportGame(g.gameId, 'csv')}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-emerald)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 8px',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                          }}
                        >
                          CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportGame(g.gameId, 'json')}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-sky)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 8px',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                          }}
                        >
                          JSON
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Thanh phân trang */}
            {totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '14px',
                  borderTop: '1px solid var(--border-subtle)',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  Trang {page} / {totalPages} • Tổng {totalCount} bộ câu hỏi
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={page <= 1 || isLoading}
                    onClick={() => handlePageChange(page - 1)}
                    style={{
                      padding: '0 12px',
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      cursor: page <= 1 ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <ArrowLeftIcon size={12} />
                    <span>Trước</span>
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((pNum) => pNum === 1 || pNum === totalPages || Math.abs(pNum - page) <= 2)
                    .map((pNum, idx, arr) => {
                      const prev = arr[idx - 1];
                      const hasGap = prev && pNum - prev > 1;
                      const isCurrent = pNum === page;

                      return (
                        <React.Fragment key={pNum}>
                          {hasGap && (
                            <span style={{ padding: '0 4px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              ...
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handlePageChange(pNum)}
                            disabled={isLoading}
                            style={{
                              minWidth: '32px',
                              height: '32px',
                              padding: '0 8px',
                              borderRadius: '6px',
                              border: isCurrent
                                ? '1.5px solid var(--primary)'
                                : '1px solid var(--border-subtle)',
                              backgroundColor: isCurrent ? 'var(--primary)' : 'var(--bg-input)',
                              color: isCurrent ? 'var(--primary-ink, #08090e)' : 'var(--text-primary)',
                              fontWeight: isCurrent ? 800 : 600,
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {pNum}
                          </button>
                        </React.Fragment>
                      );
                    })}

                  <button
                    type="button"
                    disabled={page >= totalPages || isLoading}
                    onClick={() => handlePageChange(page + 1)}
                    style={{
                      padding: '0 12px',
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>Sau</span>
                    <ArrowRightIcon size={12} />
                  </button>
                </div>
              </div>
            )}
          </section>
          )}
        </>
      )}

      {/* Modal Chia Sẻ Link / QR Chơi Đơn */}
      {soloShareData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="solo-share-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSoloShareData(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSoloShareData(null);
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              padding: '24px',
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--shadow-modal)',
              textAlign: 'center',
            }}
          >
            <h3
              id="solo-share-title"
              style={{
                margin: '0 0 6px 0',
                fontSize: '1.15rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <QrCodeIcon size={20} />
              <span>Chia Sẻ Chơi Đơn (Link & QR)</span>
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
              Người chơi có thể quét mã QR hoặc mở đường dẫn dưới đây để tự chơi độc lập game{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{soloShareData.title}"</strong>.
            </p>

            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '12px',
                borderRadius: '10px',
                display: 'inline-block',
                marginBottom: '16px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <img
                src={soloShareData.qrDataUrl}
                alt={`QR chơi đơn ${soloShareData.title}`}
                style={{ width: '200px', height: '200px', display: 'block' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
              <input
                type="text"
                readOnly
                aria-label="Đường dẫn chơi đơn"
                value={soloShareData.playUrl}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  height: '40px',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(soloShareData.playUrl);
                  toast.success('Đã sao chép đường dẫn chơi đơn!', 'Đã sao chép');
                }}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink, #08090e)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '40px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CopyIcon size={14} />
                <span>Copy Link</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  const gameId = soloShareData.gameId;
                  setSoloShareData(null);
                  handlePlaySavedGame(gameId, true);
                }}
                style={{
                  backgroundColor: 'var(--accent-emerald)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 16px',
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
                <span>Chơi đơn ngay</span>
              </button>
              <button
                type="button"
                onClick={() => setSoloShareData(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '40px',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Mở Phòng Multiplayer */}
      {multiplayerShareData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="multi-share-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMultiplayerShareData(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMultiplayerShareData(null);
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              padding: '24px',
              width: '100%',
              maxWidth: '480px',
              boxShadow: 'var(--shadow-modal)',
              textAlign: 'center',
            }}
          >
            <h3
              id="multi-share-title"
              style={{
                margin: '0 0 6px 0',
                fontSize: '1.15rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <UsersIcon size={20} />
              <span>Phòng Chơi Multiplayer Đã Mở!</span>
            </h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
              Game: <strong style={{ color: 'var(--text-primary)' }}>"{multiplayerShareData.title}"</strong>
            </p>

            <div
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid var(--accent-emerald)',
                borderRadius: '8px',
                padding: '8px 16px',
                marginBottom: '16px',
                display: 'inline-block',
              }}
            >
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                MÃ PHÒNG:{' '}
              </span>
              <strong
                style={{
                  fontSize: '1.3rem',
                  color: 'var(--accent-emerald)',
                  letterSpacing: '0.08em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {multiplayerShareData.roomCode}
              </strong>
            </div>

            <div>
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '12px',
                  borderRadius: '10px',
                  display: 'inline-block',
                  marginBottom: '16px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <img
                  src={multiplayerShareData.qrDataUrl}
                  alt={`QR phòng ${multiplayerShareData.roomCode}`}
                  style={{ width: '190px', height: '190px', display: 'block' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
              <input
                type="text"
                readOnly
                aria-label="Đường dẫn tham gia phòng"
                value={multiplayerShareData.joinUrl}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  height: '40px',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(multiplayerShareData.joinUrl);
                  toast.success('Đã sao chép đường dẫn tham gia phòng!', 'Đã sao chép');
                }}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink, #08090e)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '40px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CopyIcon size={14} />
                <span>Copy Link</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              {onNavigateToHost && (
                <button
                  type="button"
                  onClick={() => {
                    const { roomCode, hostToken } = multiplayerShareData;
                    setMultiplayerShareData(null);
                    onNavigateToHost(roomCode, hostToken);
                  }}
                  style={{
                    backgroundColor: 'var(--accent-emerald)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0 16px',
                    height: '40px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <GamepadIcon size={15} />
                  <span>Vào Màn Hình Điều Khiển (Host)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMultiplayerShareData(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '40px',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận xóa bộ câu hỏi */}
      {confirmDeleteGame && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setConfirmDeleteGame(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !isDeleting) {
              setConfirmDeleteGame(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '14px',
              padding: '24px',
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(239, 68, 68, 0.14)',
                  color: 'var(--accent-rose)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <TrashIcon size={18} />
              </div>
              <div>
                <h3
                  id="delete-confirm-title"
                  style={{ margin: 0, fontSize: '1.12rem', fontWeight: 800, color: 'var(--text-primary)' }}
                >
                  Xác Nhận Xóa Bộ Câu Hỏi
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--accent-rose)', fontWeight: 600 }}>
                  Hành động này không thể hoàn tác
                </span>
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                "{confirmDeleteGame.title}"
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>
                  Định dạng: <strong>{confirmDeleteGame.gameType}</strong>
                </span>
                <span>•</span>
                <span>
                  Số lượng: <strong>{confirmDeleteGame.questionCount} câu hỏi</strong>
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Toàn bộ nội dung câu hỏi, phương án trả lời và cài đặt của bộ câu hỏi này sẽ bị xóa hoàn toàn khỏi cơ sở dữ liệu.
            </p>

            {!confirmDeleteGame.activeStatus?.isDeletable &&
              (confirmDeleteGame.activeStatus?.hasActiveSession ||
                confirmDeleteGame.activeStatus?.hasActiveRoom) && (
                <div
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    fontSize: '0.83rem',
                    color: 'var(--accent-amber)',
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                    Bộ câu hỏi đang được sử dụng và tạm khóa xóa:
                  </div>
                  {confirmDeleteGame.activeStatus?.hasActiveSession && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: confirmDeleteGame.activeStatus.hasActiveRoom ? '6px' : 0,
                      }}
                    >
                      <span>
                        • Đang có <strong>{confirmDeleteGame.activeStatus.activeSessionCount}</strong> phiên luyện tập chơi đơn
                      </span>
                      {confirmDeleteGame.activeStatus.activeSessions?.[0] && (
                        <button
                          type="button"
                          onClick={() => {
                            const sessId = confirmDeleteGame.activeStatus!.activeSessions[0].sessionId;
                            const g = confirmDeleteGame;
                            setConfirmDeleteGame(null);
                            setConfirmEndSessionModal({ game: g, sessionId: sessId });
                          }}
                          style={{
                            backgroundColor: 'var(--accent-amber-subtle)',
                            color: 'var(--accent-amber)',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Kết thúc phiên đơn
                        </button>
                      )}
                    </div>
                  )}
                  {confirmDeleteGame.activeStatus?.hasActiveRoom && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span>
                        • Đang có phòng chơi trực tiếp (PIN:{' '}
                        <strong>{confirmDeleteGame.activeStatus.activeRooms?.[0]?.roomCode}</strong>)
                      </span>
                      {confirmDeleteGame.activeStatus.activeRooms?.[0] && (
                        <button
                          type="button"
                          onClick={() => {
                            const rCode = confirmDeleteGame.activeStatus!.activeRooms[0].roomCode;
                            const g = confirmDeleteGame;
                            setConfirmDeleteGame(null);
                            setConfirmCloseRoomModal({ game: g, roomCode: rCode });
                          }}
                          style={{
                            backgroundColor: 'rgba(56, 189, 248, 0.18)',
                            color: 'var(--accent-sky)',
                            border: '1px solid rgba(56, 189, 248, 0.4)',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Đóng phòng chơi
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDeleteGame(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '40px',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '40px',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isDeleting ? (
                  <>
                    <SpinnerIcon size={15} />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <TrashIcon size={15} />
                    <span>Xác nhận xóa vĩnh viễn</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Kết Thúc Phiên Chơi Đơn */}
      {confirmEndSessionModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid rgba(249, 115, 22, 0.5)',
              borderRadius: '14px',
              padding: '24px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.12rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Kết Thúc Phiên Chơi Đơn
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn kết thúc phiên luyện tập chơi đơn cho{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{confirmEndSessionModal.game.title}"</strong> không?
            </p>
            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                marginBottom: '16px',
              }}
            >
              Phiên chơi đơn sẽ chuyển sang trạng thái kết thúc an toàn và mở khóa xóa cho bộ câu hỏi này.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                disabled={isEndingSession}
                onClick={() => setConfirmEndSessionModal(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '38px',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isEndingSession}
                onClick={handleExecuteEndSession}
                style={{
                  backgroundColor: '#e26d2c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: isEndingSession ? 'not-allowed' : 'pointer',
                }}
              >
                {isEndingSession ? 'Đang kết thúc...' : 'Xác nhận kết thúc phiên'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Đóng Phòng Chơi Trực Tiếp */}
      {confirmCloseRoomModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '14px',
              padding: '24px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.12rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Đóng Phòng Chơi Trực Tiếp (PIN: {confirmCloseRoomModal.roomCode})
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn đóng phòng chơi trực tiếp của{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{confirmCloseRoomModal.game.title}"</strong> không?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                disabled={isClosingRoom}
                onClick={() => setConfirmCloseRoomModal(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '38px',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isClosingRoom}
                onClick={handleExecuteCloseRoom}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: isClosingRoom ? 'not-allowed' : 'pointer',
                }}
              >
                {isClosingRoom ? 'Đang đóng phòng...' : 'Xác nhận đóng phòng'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Xóa Toàn Bộ Game */}
      {isConfirmDeleteAllOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-confirm-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '14px',
              padding: '24px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: 'var(--shadow-modal)',
            }}
          >
            <h3
              id="delete-all-confirm-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}
            >
              Xác Nhận Xóa Tất Cả Game
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bạn đang yêu cầu xóa vĩnh viễn toàn bộ <strong style={{ color: 'var(--text-primary)' }}>{totalCount} bộ câu hỏi</strong> trong kho game. Các game đang có phòng hoặc phiên chơi hoạt động sẽ được giữ lại an toàn.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={() => setIsConfirmDeleteAllOpen(false)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0 14px',
                  height: '38px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={handleDeleteAllGames}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 16px',
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: isDeletingAll ? 'not-allowed' : 'pointer',
                }}
              >
                {isDeletingAll ? 'Đang xóa toàn bộ...' : 'Xác nhận xóa tất cả'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CHỌN CHẾ ĐỘ CHƠI (CHƠI ĐƠN VS MULTIPLAYER) */}
      <GameModeSelectionModal
        isOpen={isModeModalOpen}
        onClose={() => setIsModeModalOpen(false)}
        gameSpec={modeModalSpec}
        onStartSoloPresentation={(spec) => {
          setIsModeModalOpen(false);
          if (onNavigateToSoloPresentation) {
            onNavigateToSoloPresentation(spec);
          } else {
            handlePlaySavedGame(spec.gameId, true);
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
            loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter, discoverTab);
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

export const LibraryPage: React.FC<AnalyticsPageProps> = (props) => (
  <AnalyticsPage {...props} mode="library" />
);

export default AnalyticsPage;
