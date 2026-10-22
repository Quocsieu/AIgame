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
    badgeColor: 'var(--game-mc)',
    accentColor: 'var(--game-mc-hover)',
    icon: <GamepadIcon size={24} style={{ color: 'var(--game-mc)' }} />,
    tags: ['4 đáp án màu', 'Thưởng tốc độ', 'Multiplayer'],
  },
  {
    id: 'QUICK_BUTTON',
    title: 'Đúng / Sai Thần Tốc',
    subtitle: 'Hai nút bấm phản xạ cực nhanh. Kiểm tra kiến thức cốt lõi và khả năng ra quyết định dưới áp lực thời gian.',
    badge: 'Phản xạ nhanh',
    badgeColor: 'var(--game-qb)',
    accentColor: 'var(--game-qb-hover)',
    icon: <FlameIcon size={24} style={{ color: 'var(--game-qb)' }} />,
    tags: ['Đúng/Sai', 'Blitz 5-10s', 'Kịch tính'],
  },
  {
    id: 'FILL_IN_THE_BLANK',
    title: 'Điền Từ Vào Chỗ Trống',
    subtitle: 'Thử thách trí nhớ chính xác với ô nhập từ khóa. Hỗ trợ nhiều đáp án chấp nhận tương đương.',
    badge: 'Ghi nhớ sâu',
    badgeColor: 'var(--game-fill)',
    accentColor: 'var(--game-fill-hover)',
    icon: <BookOpenIcon size={24} style={{ color: 'var(--game-fill)' }} />,
    tags: ['Từ khóa', 'Chính tả', 'Học thuật'],
  },
  {
    id: 'CROSSWORD',
    title: 'Giải Đố Ô Chữ',
    subtitle: 'Gợi ý giải mã theo hàng ngang và hàng dọc. Rèn luyện tư duy ngôn ngữ và liên tưởng logic.',
    badge: 'Tư duy logic',
    badgeColor: 'var(--game-cross)',
    accentColor: 'var(--game-cross-hover)',
    icon: <LayersIcon size={24} style={{ color: 'var(--game-cross)' }} />,
    tags: ['Ô chữ', 'Gợi ý từ', 'Khám phá'],
  },
  {
    id: 'MIXED',
    title: 'Bộ Đề Hỗn Hợp (Mixed)',
    subtitle: 'Kết hợp linh hoạt cả 4 định dạng câu hỏi trong cùng một trận đấu, tạo trải nghiệm phong phú bất ngờ.',
    badge: 'Toàn diện',
    badgeColor: 'var(--game-mixed)',
    accentColor: 'var(--game-mixed-hover)',
    icon: <SparklesIcon size={24} style={{ color: 'var(--game-mixed)' }} />,
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
                  ? 'var(--bg-card-hover)'
                  : 'var(--bg-surface)',
                color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isSelected ? 800 : 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
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

              {isSelected && (
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.85rem',
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
                : '1.5px solid var(--border-subtle)',
              backgroundColor: isSelected
                ? 'var(--bg-card-hover)'
                : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
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
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--bg-input)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.icon}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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
                margin: 0,
                fontSize: '0.84rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                flex: 1,
              }}
            >
              {item.subtitle}
            </p>
          </button>
        );
      })}
    </div>
  );
};

