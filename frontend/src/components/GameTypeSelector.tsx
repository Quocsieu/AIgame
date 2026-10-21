import React from 'react';
import {
  BookOpenIcon,
  CheckIcon,
  FlameIcon,
  GamepadIcon,
  LayersIcon,
  SparklesIcon,
  StarIcon,
} from './Icons.js';
import type { GameType } from '../types/index.js';

export interface GameTypeOption {
  id: GameType;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  accentColor: string;
  icon: React.ReactNode;
  tags: string[];
}

export const SUPPORTED_GAME_TYPES: GameTypeOption[] = [
  {
    id: 'MULTIPLE_CHOICE',
    title: 'Trắc Nghiệm 4 Lựa Chọn',
    subtitle: 'Định dạng kinh điển phong cách Kahoot! với 4 khối màu rực rỡ, tính điểm theo tốc độ và chuỗi đúng.',
    badge: 'Phổ biến nhất',
    badgeColor: '#6366f1',
    accentColor: '#4f46e5',
    icon: <GamepadIcon size={24} style={{ color: '#6366f1' }} />,
    tags: ['4 đáp án màu', 'Thưởng tốc độ', 'Multiplayer'],
  },
  {
    id: 'QUICK_BUTTON',
    title: 'Đúng / Sai Thần Tốc',
    subtitle: 'Hai nút bấm phản xạ cực nhanh. Kiểm tra kiến thức cốt lõi và khả năng ra quyết định dưới áp lực thời gian.',
    badge: 'Phản xạ nhanh',
    badgeColor: '#10b981',
    accentColor: '#059669',
    icon: <FlameIcon size={24} style={{ color: '#10b981' }} />,
    tags: ['Đúng/Sai', 'Blitz 5-10s', 'Kịch tính'],
  },
  {
    id: 'FILL_IN_THE_BLANK',
    title: 'Điền Từ Vào Chỗ Trống',
    subtitle: 'Thử thách trí nhớ chính xác với ô nhập từ khóa. Hỗ trợ nhiều đáp án chấp nhận tương đương.',
    badge: 'Ghi nhớ sâu',
    badgeColor: '#0ea5e9',
    accentColor: '#0284c7',
    icon: <BookOpenIcon size={24} style={{ color: '#0ea5e9' }} />,
    tags: ['Từ khóa', 'Chính tả', 'Học thuật'],
  },
  {
    id: 'CROSSWORD',
    title: 'Giải Đố Ô Chữ',
    subtitle: 'Gợi ý giải mã theo hàng ngang và hàng dọc. Rèn luyện tư duy ngôn ngữ và liên tưởng logic.',
    badge: 'Tư duy logic',
    badgeColor: '#f59e0b',
    accentColor: '#d97706',
    icon: <LayersIcon size={24} style={{ color: '#f59e0b' }} />,
    tags: ['Ô chữ', 'Gợi ý từ', 'Khám phá'],
  },
  {
    id: 'MIXED',
    title: 'Bộ Đề Hỗn Hợp (Mixed)',
    subtitle: 'Kết hợp linh hoạt cả 4 định dạng câu hỏi trong cùng một trận đấu, tạo trải nghiệm phong phú bất ngờ.',
    badge: 'Toàn diện',
    badgeColor: '#ec4899',
    accentColor: '#db2777',
    icon: <SparklesIcon size={24} style={{ color: '#ec4899' }} />,
    tags: ['Đa định dạng', 'Thử thách cao', 'Độc đáo'],
  },
];

interface GameTypeSelectorProps {
  selectedType?: GameType;
  onSelectType: (type: GameType) => void;
  compact?: boolean;
  variant?: 'cards' | 'chips';
}

export const GameTypeSelector: React.FC<GameTypeSelectorProps> = ({
  selectedType = 'MULTIPLE_CHOICE',
  onSelectType,
  compact = false,
  variant,
}) => {
  const isChipVariant = variant === 'chips' || (compact && variant !== 'cards');

  if (isChipVariant) {
    return (
      <div
        role="radiogroup"
        aria-label="Chọn định dạng game"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.65rem',
          width: '100%',
        }}
      >
        {SUPPORTED_GAME_TYPES.map((item) => {
          const isSelected = selectedType === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelectType(item.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.6rem 1rem',
                minHeight: '44px',
                borderRadius: '12px',
                border: isSelected
                  ? `2px solid ${item.badgeColor}`
                  : '1.5px solid var(--border-strong)',
                backgroundColor: isSelected
                  ? `${item.badgeColor}15`
                  : 'var(--bg-surface)',
                color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isSelected ? 800 : 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isSelected
                  ? `0 2px 8px ${item.badgeColor}25`
                  : 'none',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: item.badgeColor,
                }}
              >
                {item.icon}
              </span>

              <span>{item.title}</span>

              {isSelected ? (
                <span
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    backgroundColor: item.badgeColor,
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: '0.2rem',
                  }}
                >
                  <CheckIcon size={12} />
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    backgroundColor: 'var(--bg-input)',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '6px',
                    marginLeft: '0.2rem',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Chọn định dạng game"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '1rem',
        width: '100%',
      }}
    >
      {SUPPORTED_GAME_TYPES.map((item) => {
        const isSelected = selectedType === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelectType(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              textAlign: 'left',
              padding: compact ? '1rem' : '1.25rem',
              borderRadius: '16px',
              border: isSelected
                ? `2px solid ${item.badgeColor}`
                : '2px solid var(--border-subtle)',
              backgroundColor: isSelected
                ? 'var(--bg-card-hover)'
                : 'var(--bg-surface)',
              boxShadow: isSelected
                ? `0 0 0 1px ${item.badgeColor}, var(--card-shadow)`
                : 'var(--shadow-sm)',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
              position: 'relative',
              outline: 'none',
              minHeight: '44px',
            }}
          >
            {/* Top row: Icon & Badge */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
                width: '100%',
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--bg-input)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.icon}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '20px',
                    backgroundColor: `${item.badgeColor}20`,
                    color: item.badgeColor,
                    border: `1px solid ${item.badgeColor}40`,
                  }}
                >
                  {item.badge}
                </span>

                {isSelected && (
                  <div
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      backgroundColor: item.badgeColor,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckIcon size={14} />
                  </div>
                )}
              </div>
            </div>

            {/* Title & Description */}
            <h4
              style={{
                margin: '0 0 0.35rem 0',
                fontSize: compact ? '0.98rem' : '1.08rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
              }}
            >
              {item.title}
            </h4>

            <p
              style={{
                margin: '0 0 0.85rem 0',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                flex: 1,
              }}
            >
              {item.subtitle}
            </p>

            {/* Feature tags */}
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {item.tags.map((tag, tagIdx) => (
                <span
                  key={tagIdx}
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
};

