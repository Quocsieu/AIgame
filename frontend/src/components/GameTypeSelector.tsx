import React from 'react';
import {
  BookOpenIcon,
  CheckIcon,
  FlameIcon,
  GamepadIcon,
  LayersIcon,
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
    title: 'Trắc nghiệm 4 lựa chọn',
    subtitle: 'Chọn đáp án đúng trong 4 phương án A/B/C/D, tính điểm theo tốc độ và chuỗi đúng.',
    badge: 'Trắc nghiệm',
    badgeColor: 'var(--game-mc)',
    accentColor: 'var(--game-mc-hover)',
    icon: <GamepadIcon size={24} style={{ color: 'var(--game-mc)' }} />,
    tags: ['4 phương án', 'Thưởng tốc độ', 'Chơi nhóm'],
  },
  {
    id: 'QUICK_BUTTON',
    title: 'Đúng hoặc Sai',
    subtitle: 'Phản xạ chọn Đúng hoặc Sai trước các nhận định trọng tâm.',
    badge: 'Đúng / Sai',
    badgeColor: 'var(--game-qb)',
    accentColor: 'var(--game-qb-hover)',
    icon: <FlameIcon size={24} style={{ color: 'var(--game-qb)' }} />,
    tags: ['Đúng / Sai', 'Phản xạ nhanh', 'Kịch tính'],
  },
  {
    id: 'FILL_IN_THE_BLANK',
    title: 'Điền vào chỗ trống',
    subtitle: 'Tự nhập câu trả lời ngắn gọn, hỗ trợ nhiều biến thể đáp án hợp lệ.',
    badge: 'Điền từ',
    badgeColor: 'var(--game-fill)',
    accentColor: 'var(--game-fill-hover)',
    icon: <BookOpenIcon size={24} style={{ color: 'var(--game-fill)' }} />,
    tags: ['Tự nhập đáp án', 'Ghi nhớ sâu', 'Độ chính xác'],
  },
  {
    id: 'CROSSWORD',
    title: 'Ô chữ từ khóa',
    subtitle: 'Giải từ khóa chuyên ngành dựa trên gợi ý ngữ cảnh và số lượng ký tự.',
    badge: 'Ô chữ',
    badgeColor: 'var(--game-cross)',
    accentColor: 'var(--game-cross-hover)',
    icon: <LayersIcon size={24} style={{ color: 'var(--game-cross)' }} />,
    tags: ['Ô chữ từ khóa', 'Gợi ý thuật ngữ', 'Ký tự chuẩn'],
  },
  {
    id: 'PUZZLE',
    title: 'Sắp xếp thứ tự',
    subtitle: 'Sắp xếp các bước quy trình, sự kiện hoặc cấp độ theo đúng trình tự.',
    badge: 'Sắp xếp',
    badgeColor: 'var(--game-cross)',
    accentColor: 'var(--game-cross-hover)',
    icon: <LayersIcon size={24} style={{ color: 'var(--game-cross)' }} />,
    tags: ['Sắp xếp thứ tự', 'Tư duy quy trình', '3–6 mục'],
  },
  {
    id: 'SLIDER',
    title: 'Thanh trượt giá trị',
    subtitle: 'Kéo thanh trượt chọn con số, tỷ lệ hoặc mốc năm với sai số linh hoạt.',
    badge: 'Thanh trượt',
    badgeColor: 'var(--game-mixed)',
    accentColor: 'var(--game-mixed-hover)',
    icon: <CheckIcon size={24} style={{ color: 'var(--game-mixed)' }} />,
    tags: ['Kéo thanh trượt', 'Số liệu định lượng', 'Sai số ±'],
  },
  {
    id: 'MIXED',
    title: 'Hỗn hợp',
    subtitle: 'Phối hợp tỷ lệ phần trăm cho 4 loại câu hỏi: Trắc nghiệm, Đúng/Sai, Điền từ và Ô chữ.',
    badge: 'Hỗn hợp',
    badgeColor: 'var(--game-mixed)',
    accentColor: 'var(--game-mixed-hover)',
    icon: <LayersIcon size={24} style={{ color: 'var(--game-mixed)' }} />,
    tags: ['Phân bổ tỷ lệ %', '4 loại cơ sở', 'Đa dạng câu hỏi'],
  },
  {
    id: 'ADVENTURE',
    title: 'Đi cảnh theo ngành nghề',
    subtitle: 'Vượt chướng ngại vật và trả lời câu hỏi tại các trạm kiểm tra theo bối cảnh ngành nghề.',
    badge: 'Đi cảnh 2D',
    badgeColor: 'var(--game-adventure)',
    accentColor: 'var(--game-adventure-hover)',
    icon: <StarIcon size={24} style={{ color: 'var(--game-adventure)' }} />,
    tags: ['Đi cảnh 2D', 'Vượt vật cản', 'Theo ngành nghề'],
  },
];

function isMatchingSelectorType(optionId: GameType, selectedType: GameType): boolean {
  if (optionId === selectedType) return true;
  if (optionId === 'MULTIPLE_CHOICE' && selectedType === 'QUIZ') return true;
  if (optionId === 'QUICK_BUTTON' && selectedType === 'TRUE_FALSE') return true;
  if (optionId === 'FILL_IN_THE_BLANK' && selectedType === 'TYPE_ANSWER') return true;
  return false;
}

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
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '0.5rem',
          width: '100%',
        }}
      >
        {SUPPORTED_GAME_TYPES.map((item) => {
          const isSelected = isMatchingSelectorType(item.id, selectedType);
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-testid={`game-type-option-${item.id}`}
              onClick={() => onSelectType(item.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 0.75rem',
                height: '42px',
                borderRadius: '10px',
                border: `2px solid ${isSelected ? item.badgeColor : 'var(--border-subtle)'}`,
                backgroundColor: isSelected
                  ? 'var(--bg-card-hover)'
                  : 'var(--bg-surface)',
                color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isSelected ? 800 : 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: item.badgeColor,
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title}
                </span>
              </div>

              <span
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: isSelected ? item.badgeColor : 'transparent',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginLeft: '0.35rem',
                  border: isSelected ? 'none' : '1.5px solid var(--border-subtle)',
                }}
              >
                {isSelected && <CheckIcon size={11} />}
              </span>
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
        const isSelected = isMatchingSelectorType(item.id, selectedType);
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-testid={`game-type-option-${item.id}`}
            onClick={() => onSelectType(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              textAlign: 'left',
              padding: compact ? '0.85rem' : '1.15rem',
              borderRadius: '16px',
              border: `2px solid ${isSelected ? item.badgeColor : 'var(--border-subtle)'}`,
              backgroundColor: isSelected
                ? 'var(--bg-card-hover)'
                : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
              position: 'relative',
              outline: 'none',
              boxSizing: 'border-box',
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
                <div
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: isSelected ? item.badgeColor : 'transparent',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: isSelected ? 'none' : '1.5px solid var(--border-subtle)',
                  }}
                >
                  {isSelected && <CheckIcon size={13} />}
                </div>
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
