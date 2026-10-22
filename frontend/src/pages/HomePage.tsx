import React from 'react';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CircleShapeIcon,
  DiamondIcon,
  SparklesIcon,
  SquareShapeIcon,
  TriangleIcon,
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

interface FormatMeta {
  type: GameType;
  title: string;
  badge: string;
  accent: string;
  icon: React.ReactNode;
}

const GAME_FORMATS: FormatMeta[] = [
  {
    type: 'MULTIPLE_CHOICE',
    title: 'Trắc nghiệm 4 màu',
    badge: '4 Lựa chọn',
    accent: 'var(--game-mc)',
    icon: <TriangleIcon size={22} />,
  },
  {
    type: 'QUICK_BUTTON',
    title: 'Đúng / Sai',
    badge: 'Phản xạ nhanh',
    accent: 'var(--game-qb)',
    icon: <DiamondIcon size={22} />,
  },
  {
    type: 'FILL_IN_THE_BLANK',
    title: 'Điền từ',
    badge: 'Ghi nhớ sâu',
    accent: 'var(--game-fill)',
    icon: <CircleShapeIcon size={22} />,
  },
  {
    type: 'CROSSWORD',
    title: 'Ô chữ',
    badge: 'Tư duy logic',
    accent: 'var(--game-cross)',
    icon: <SquareShapeIcon size={22} />,
  },
  {
    type: 'MIXED',
    title: 'Đấu trường hỗn hợp',
    badge: 'Đa định dạng',
    accent: 'var(--accent-lime)',
    icon: <SparklesIcon size={22} />,
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
        <div style={{ textAlign: 'center', marginBottom: '1.5rem', flexShrink: 0 }}>
          <h2
            style={{
              fontSize: 'clamp(1.5rem, 2.3vw, 2rem)',
              fontWeight: 900,
              color: 'var(--text-primary)',
              margin: '0 0 0.4rem 0',
              letterSpacing: '-0.025em',
            }}
          >
            Chọn thể loại để bắt đầu tạo trò chơi
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '0.88rem',
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
            maxWidth: '1240px',
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
                padding: '1.35rem 1.15rem',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '210px',
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
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: `${fmt.accent}18`,
                      color: fmt.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {fmt.icon}
                  </div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '6px',
                      backgroundColor: `${fmt.accent}15`,
                      color: fmt.accent,
                    }}
                  >
                    {fmt.badge}
                  </span>
                </div>

                <h3
                  style={{
                    fontSize: '1.15rem',
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.02em',
                    margin: '0 0 0.35rem 0',
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
                  gap: '0.35rem',
                  color: fmt.accent,
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  marginTop: '1.25rem',
                  paddingTop: '0.65rem',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span>Bắt đầu tạo</span>
                <ArrowRightIcon size={14} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
