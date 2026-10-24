import React from 'react';
import {
  ArrowRightIcon,
  BookOpenIcon,
  SparklesIcon,
} from '../components/Icons.js';
import type { GameType } from '../types/index.js';

interface HomePageProps {
  onNavigateToCreate: (gameType?: GameType) => void;
  onNavigateToLibrary?: () => void;
  onNavigateToHost?: () => void;
  onNavigateToAdmin?: () => void;
  onNavigateToJoin?: (roomCode?: string) => void;
  onSelectGameToPlay?: (gameId: string) => void;
}

const MultipleChoiceIllustration: React.FC = () => (
  <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="115" rx="10" fill="var(--bg-input)" />
    {/* Question Header Card */}
    <rect x="18" y="12" width="164" height="30" rx="7" fill="var(--bg-card)" stroke="var(--border-subtle)" strokeWidth="1.2" />
    <circle cx="32" cy="27" r="6" fill="var(--primary)" opacity="0.9" />
    <rect x="46" y="21" width="80" height="4" rx="2" fill="var(--text-primary)" opacity="0.8" />
    <rect x="46" y="29" width="46" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.6" />
    {/* 4 ABCD Color Answer Quadrants */}
    {/* Choice A - Red Triangle */}
    <rect x="18" y="50" width="78" height="24" rx="6" fill="#e21b3c" />
    <path d="M31 62L27 69H35L31 62Z" fill="#ffffff" />
    <rect x="41" y="60" width="44" height="4" rx="2" fill="#ffffff" opacity="0.9" />
    {/* Choice B - Blue Diamond */}
    <rect x="104" y="50" width="78" height="24" rx="6" fill="#1368ce" />
    <path d="M117 58L121 62L117 66L113 62Z" fill="#ffffff" />
    <rect x="127" y="60" width="44" height="4" rx="2" fill="#ffffff" opacity="0.9" />
    {/* Choice C - Yellow Circle */}
    <rect x="18" y="79" width="78" height="24" rx="6" fill="#d89e00" />
    <circle cx="31" cy="91" r="4" fill="#ffffff" />
    <rect x="41" y="89" width="44" height="4" rx="2" fill="#ffffff" opacity="0.9" />
    {/* Choice D - Green Square */}
    <rect x="104" y="79" width="78" height="24" rx="6" fill="#26890c" />
    <rect x="113" y="87" width="8" height="8" rx="1.5" fill="#ffffff" />
    <rect x="127" y="89" width="44" height="4" rx="2" fill="#ffffff" opacity="0.9" />
  </svg>
);

const QuickButtonIllustration: React.FC = () => (
  <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="115" rx="10" fill="var(--bg-input)" />
    {/* Top Reflex Lightning Badge */}
    <circle cx="100" cy="18" r="11" fill="var(--bg-card)" stroke="var(--accent-amber)" strokeWidth="1.2" />
    <path d="M100 11L97 18H102L100 25" stroke="var(--accent-amber)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    {/* VS center badge */}
    <rect x="88" y="60" width="24" height="15" rx="4" fill="var(--bg-elevated)" stroke="var(--border-strong)" strokeWidth="1" />
    <text x="100" y="71" textAnchor="middle" fill="var(--text-muted)" fontSize="8.5" fontWeight="900">VS</text>
    {/* True Button (Green) */}
    <g transform="translate(18, 38)">
      <rect width="66" height="60" rx="9" fill="var(--accent-emerald)" />
      <circle cx="33" cy="24" r="13" fill="#ffffff" opacity="0.25" />
      <path d="M26 24L31 29L40 19" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <text x="33" y="49" textAnchor="middle" fill="#ffffff" fontSize="10.5" fontWeight="900" letterSpacing="0.06em">ĐÚNG</text>
    </g>
    {/* False Button (Red) */}
    <g transform="translate(116, 38)">
      <rect width="66" height="60" rx="9" fill="var(--accent-rose)" />
      <circle cx="33" cy="24" r="13" fill="#ffffff" opacity="0.25" />
      <path d="M27 18L39 30M39 18L27 30" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <text x="33" y="49" textAnchor="middle" fill="#ffffff" fontSize="10.5" fontWeight="900" letterSpacing="0.06em">SAI</text>
    </g>
  </svg>
);

const FillInBlankIllustration: React.FC = () => (
  <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="115" rx="10" fill="var(--bg-input)" />
    {/* Sentence Bar */}
    <rect x="16" y="20" width="168" height="32" rx="7" fill="var(--bg-card)" stroke="var(--border-subtle)" strokeWidth="1.2" />
    <text x="26" y="40" fill="var(--text-secondary)" fontSize="10.5" fontWeight="700">Việt Nam có</text>
    {/* Blank Slot */}
    <rect x="85" y="25" width="54" height="22" rx="5" fill="var(--game-fill)" opacity="0.18" stroke="var(--game-fill)" strokeWidth="1.5" strokeDasharray="3 2" />
    <text x="112" y="39" textAnchor="middle" fill="var(--game-fill)" fontSize="9.5" fontWeight="900">[ _____ ]</text>
    <text x="146" y="40" fill="var(--text-secondary)" fontSize="10.5" fontWeight="700">tỉnh?</text>
    {/* Letter Capsule */}
    <g transform="translate(60, 66)">
      <rect width="80" height="32" rx="8" fill="var(--game-fill)" />
      <text x="40" y="20" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="900" letterSpacing="0.04em">63</text>
      <path d="M40 -7L35 0H45L40 -7Z" fill="var(--game-fill)" />
    </g>
  </svg>
);

const CrosswordIllustration: React.FC = () => (
  <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="115" rx="10" fill="var(--bg-input)" />
    {/* Crossword Matrix */}
    {/* Horizontal Word: Q - U - I - Z */}
    <g transform="translate(38, 16)">
      <rect x="0" y="0" width="27" height="27" rx="4" fill="var(--bg-card)" stroke="var(--border-subtle)" strokeWidth="1.2" />
      <text x="4" y="9" fill="var(--text-muted)" fontSize="6" fontWeight="700">1</text>
      <text x="13.5" y="19" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="900">Q</text>

      <rect x="31" y="0" width="27" height="27" rx="4" fill="var(--bg-card)" stroke="var(--border-subtle)" strokeWidth="1.2" />
      <text x="44.5" y="19" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="900">U</text>

      {/* Intersection letter I */}
      <rect x="62" y="0" width="27" height="27" rx="4" fill="var(--game-cross)" />
      <text x="66" y="9" fill="#ffffff" opacity="0.8" fontSize="6" fontWeight="700">2</text>
      <text x="75.5" y="19" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="900">I</text>

      <rect x="93" y="0" width="27" height="27" rx="4" fill="var(--bg-card)" stroke="var(--border-subtle)" strokeWidth="1.2" />
      <text x="106.5" y="19" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="900">Z</text>
    </g>
    {/* Vertical Word intersect */}
    <g transform="translate(100, 47)">
      <rect x="0" y="0" width="27" height="27" rx="4" fill="var(--bg-card)" stroke="var(--border-subtle)" strokeWidth="1.2" />
      <text x="13.5" y="19" textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="900">N</text>
    </g>
    <g transform="translate(100, 78)">
      <rect x="0" y="0" width="27" height="27" rx="4" fill="var(--game-cross)" opacity="0.88" />
      <text x="4" y="9" fill="#ffffff" opacity="0.8" fontSize="6" fontWeight="700">3</text>
      <text x="13.5" y="19" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="900">O</text>
    </g>
  </svg>
);

const MixedIllustration: React.FC = () => (
  <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
    <rect width="200" height="115" rx="10" fill="var(--bg-input)" />
    {/* Tournament Arena Orb */}
    <circle cx="100" cy="57" r="42" fill="var(--bg-card)" stroke="var(--accent-lime)" strokeWidth="1.8" strokeDasharray="4 2" />
    <circle cx="100" cy="57" r="30" fill="var(--accent-lime)" opacity="0.12" />
    {/* 4 Floating Badges */}
    {/* Top: MC (Red) */}
    <g transform="translate(89, 18)">
      <circle cx="11" cy="11" r="10" fill="var(--game-mc)" />
      <path d="M11 6L7 14H15L11 6Z" fill="#ffffff" />
    </g>
    {/* Right: QB (Emerald) */}
    <g transform="translate(132, 46)">
      <circle cx="11" cy="11" r="10" fill="var(--game-qb)" />
      <path d="M7 11L10 14L15 8" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    {/* Bottom: Crossword (Purple) */}
    <g transform="translate(89, 72)">
      <circle cx="11" cy="11" r="10" fill="var(--game-cross)" />
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" fill="#ffffff" />
    </g>
    {/* Left: Fill (Amber) */}
    <g transform="translate(46, 46)">
      <circle cx="11" cy="11" r="10" fill="var(--game-fill)" />
      <circle cx="11" cy="11" r="3.5" fill="#ffffff" />
    </g>
    {/* Center Arena Star */}
    <path d="M100 48L103 54L109 57L103 60L100 66L97 60L91 57L97 54L100 48Z" fill="var(--accent-lime)" />
  </svg>
);

interface FormatMeta {
  type: GameType;
  title: string;
  badge: string;
  accent: string;
  illustration: React.ReactNode;
}

const GAME_FORMATS: FormatMeta[] = [
  {
    type: 'MULTIPLE_CHOICE',
    title: 'Trắc nghiệm 4 màu',
    badge: '4 Lựa chọn',
    accent: 'var(--game-mc)',
    illustration: <MultipleChoiceIllustration />,
  },
  {
    type: 'QUICK_BUTTON',
    title: 'Đúng / Sai',
    badge: 'Phản xạ nhanh',
    accent: 'var(--game-qb)',
    illustration: <QuickButtonIllustration />,
  },
  {
    type: 'FILL_IN_THE_BLANK',
    title: 'Điền từ',
    badge: 'Ghi nhớ sâu',
    accent: 'var(--game-fill)',
    illustration: <FillInBlankIllustration />,
  },
  {
    type: 'CROSSWORD',
    title: 'Ô chữ',
    badge: 'Tư duy logic',
    accent: 'var(--game-cross)',
    illustration: <CrosswordIllustration />,
  },
  {
    type: 'MIXED',
    title: 'Đấu trường hỗn hợp',
    badge: 'Đa định dạng',
    accent: 'var(--accent-lime)',
    illustration: <MixedIllustration />,
  },
  {
    type: 'ADVENTURE',
    title: 'Game đi cảnh theo ngành nghề',
    badge: 'Đi cảnh 2D',
    accent: '#F59E0B',
    illustration: (
      <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
        <rect width="200" height="115" rx="10" fill="#0F172A" />
        <rect x="0" y="84" width="200" height="31" rx="4" fill="#1E293B" />
        <line x1="12" y1="98" x2="40" y2="98" stroke="#FACC15" strokeWidth="3" strokeDasharray="8 6" />
        <line x1="65" y1="98" x2="105" y2="98" stroke="#FACC15" strokeWidth="3" strokeDasharray="8 6" />
        <line x1="130" y1="98" x2="175" y2="98" stroke="#FACC15" strokeWidth="3" strokeDasharray="8 6" />
        {/* Rider / Vehicle */}
        <circle cx="42" cy="78" r="8" fill="#334155" stroke="#F97316" strokeWidth="2.5" />
        <circle cx="68" cy="78" r="8" fill="#334155" stroke="#F97316" strokeWidth="2.5" />
        <path d="M38 72L50 58H66L72 72H38Z" fill="#F97316" />
        <circle cx="54" cy="48" r="7" fill="#F8FAFC" />
        {/* Obstacle */}
        <path d="M110 84L118 62L126 84H110Z" fill="#EF4444" />
        {/* Checkpoint Gate */}
        <rect x="154" y="34" width="6" height="50" fill="#10B981" />
        <rect x="142" y="22" width="44" height="16" rx="4" fill="#064E3B" stroke="#10B981" strokeWidth="1.5" />
        <text x="164" y="33" textAnchor="middle" fill="#34D399" fontSize="8" fontWeight="900">TRẠM #1</text>
      </svg>
    ),
  },
];

export const HomePage: React.FC<HomePageProps> = ({
  onNavigateToCreate,
  onNavigateToLibrary,
}) => {
  return (
    <div
      className="explore-page-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '0.85rem 1.5rem',
      }}
    >
      {/* Header khu vực thanh công cụ trên cùng */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <h1
            style={{
              margin: 0,
              color: 'var(--text-primary)',
              fontSize: '1.25rem',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
          >
            <SparklesIcon size={20} style={{ color: 'var(--primary)' }} />
            <span>Khám Phá Thể Loại Trò Chơi</span>
          </h1>
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              padding: '0.15rem 0.5rem',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            5 định dạng tương tác
          </span>
        </div>

        {onNavigateToLibrary && (
          <button
            type="button"
            onClick={onNavigateToLibrary}
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '8px',
              padding: '0 0.85rem',
              height: '34px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <BookOpenIcon size={14} />
            <span>Kho Game</span>
          </button>
        )}
      </header>

      {/* Vùng trung tâm: Lời dẫn & Lưới 5 thẻ game */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
          paddingBottom: '1rem',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.25rem', flexShrink: 0 }}>
          <h2
            style={{
              fontSize: 'clamp(1.4rem, 2.2vw, 1.85rem)',
              fontWeight: 900,
              color: 'var(--text-primary)',
              margin: '0 0 0.35rem 0',
              letterSpacing: '-0.025em',
            }}
          >
            Chọn thể loại để bắt đầu tạo trò chơi
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '0.86rem',
              color: 'var(--text-secondary)',
              maxWidth: '560px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            Mỗi định dạng được tối ưu hóa cho từng mục tiêu học tập, thi đấu và tương tác trực tiếp bằng AI.
          </p>
        </div>

        {/* Lưới 5 thẻ thể loại game */}
        <div
          className="explore-cards-grid"
          style={{
            display: 'grid',
            gap: '1rem',
            width: '100%',
            maxWidth: '1260px',
            margin: '0 auto',
            boxSizing: 'border-box',
          }}
        >
          {GAME_FORMATS.map((fmt) => (
            <div
              key={fmt.type}
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
                backgroundColor: 'var(--bg-surface)',
                borderRadius: '16px',
                padding: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid var(--border-subtle)',
                borderTop: `4px solid ${fmt.accent}`,
                transition: 'transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                outline: 'none',
                boxSizing: 'border-box',
                boxShadow: 'var(--card-shadow)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-elevated)';
                e.currentTarget.style.borderColor = fmt.accent;
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = `0 12px 28px -6px ${fmt.accent}33`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'var(--card-shadow)';
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-elevated)';
                e.currentTarget.style.borderColor = fmt.accent;
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              <div>
                {/* Hình ảnh minh họa đặc thù của thể loại */}
                <div
                  style={{
                    width: '100%',
                    height: '115px',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    marginBottom: '0.75rem',
                    backgroundColor: 'var(--bg-input)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {fmt.illustration}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '0.12rem 0.45rem',
                      borderRadius: '5px',
                      backgroundColor: `${fmt.accent}15`,
                      color: fmt.accent,
                    }}
                  >
                    {fmt.badge}
                  </span>
                </div>

                <h3
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.02em',
                    margin: '0',
                    lineHeight: 1.25,
                  }}
                >
                  {fmt.title}
                </h3>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: fmt.accent,
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  marginTop: '0.85rem',
                  paddingTop: '0.55rem',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span>Tạo game ngay</span>
                <ArrowRightIcon size={14} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
