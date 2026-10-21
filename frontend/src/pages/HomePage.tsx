import React, { useState } from 'react';
import { GameTypeSelector } from '../components/GameTypeSelector.js';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  FlameIcon,
  GamepadIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
} from '../components/Icons.js';
import type { GameType } from '../types/index.js';

interface HomePageProps {
  onNavigateToCreate: (gameType?: GameType) => void;
  onNavigateToLibrary: () => void;
  onNavigateToHost?: () => void;
  onNavigateToAdmin?: () => void;
  onNavigateToJoin?: (roomCode?: string) => void;
  onSelectGameToPlay?: (gameId: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onNavigateToCreate,
  onNavigateToLibrary,
  onNavigateToHost,
  onNavigateToAdmin,
}) => {
  const [selectedGameType, setSelectedGameType] = useState<GameType>('MULTIPLE_CHOICE');

  const handleSelectFormatAndCreate = (type: GameType) => {
    setSelectedGameType(type);
    onNavigateToCreate(type);
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      {/* 1. HERO SECTION (Kahoot-inspired Engaging Banner) */}
      <section
        style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(14, 165, 233, 0.08) 100%)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '24px',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
          marginBottom: '2.5rem',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        {/* Glow decoration */}
        <div
          style={{
            position: 'absolute',
            top: '-50%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '300px',
            background: 'radial-gradient(ellipse at center, rgba(99, 102, 241, 0.2) 0%, rgba(99, 102, 241, 0) 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.35rem 0.85rem',
            borderRadius: '999px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            color: 'var(--primary)',
            fontSize: '0.82rem',
            fontWeight: 800,
            marginBottom: '1.25rem',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <SparklesIcon size={16} />
          <span>Nền Tảng Trắc Nghiệm Tương Tác & Game Show Bằng Trí Tuệ Nhân Tạo</span>
        </div>

        {/* Hero Title */}
        <h1
          style={{
            fontSize: 'clamp(1.8rem, 4vw, 2.75rem)',
            fontWeight: 900,
            lineHeight: 1.25,
            margin: '0 auto 1rem auto',
            maxWidth: '850px',
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          Biến Mọi Tài Liệu Thành{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #0ea5e9 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Đấu Trường Kiến Thức
          </span>{' '}
          Sống Động
        </h1>

        <p
          style={{
            fontSize: 'clamp(0.95rem, 2vw, 1.12rem)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            maxWidth: '680px',
            margin: '0 auto 2.25rem auto',
          }}
        >
          Tự động trích xuất thông tin từ Website, File Word, PDF hoặc chủ đề yêu cầu để tạo nên
          những bộ câu hỏi Kahoot-style kịch tính trong 10 giây.
        </p>

        {/* Hero Quick Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => onNavigateToCreate(selectedGameType)}
            style={{
              minHeight: '48px',
              padding: '0.85rem 1.75rem',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '1rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.6rem',
              boxShadow: 'var(--btn-shadow)',
              transition: 'transform 0.15s ease, opacity 0.15s ease',
            }}
          >
            <SparklesIcon size={20} />
            <span>Tạo Game Bằng AI Ngay</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToLibrary}
            style={{
              minHeight: '48px',
              padding: '0.85rem 1.5rem',
              borderRadius: '12px',
              border: '1.5px solid var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'background-color 0.15s ease',
            }}
          >
            <BookOpenIcon size={20} />
            <span>Khám Phá Kho Game</span>
          </button>
        </div>
      </section>

      {/* 2. 5 GAME TYPES SELECTION SHOWCASE */}
      <section style={{ marginBottom: '3.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.35rem',
                fontWeight: 900,
                color: 'var(--text-primary)',
                margin: '0 0 0.35rem 0',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <GamepadIcon size={22} style={{ color: 'var(--primary)' }} />
              <span>5 Định Dạng Game Show Được Hỗ Trợ</span>
            </h2>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Nhấp trực tiếp vào định dạng bạn muốn để chuyển ngay sang trang tạo bộ câu hỏi.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateToCreate(selectedGameType)}
            style={{
              minHeight: '40px',
              padding: '0.5rem 1.15rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
          >
            <span>Tạo với định dạng này</span>
            <ArrowRightIcon size={16} />
          </button>
        </div>

        <GameTypeSelector
          selectedType={selectedGameType}
          variant="cards"
          onSelectType={handleSelectFormatAndCreate}
        />
      </section>

      {/* 3. HOW IT WORKS SECTION (Simple 3-step Visual Walkthrough - Placed ABOVE Activities) */}
      <section
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '20px',
          padding: '2.25rem 1.75rem',
          boxShadow: 'var(--card-shadow)',
          marginBottom: '3.5rem',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, margin: '0 0 0.35rem 0' }}>
            Quy Trình 3 Bước Đơn Giản Chuẩn Kahoot!
          </h2>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Từ nội dung thô đến trận đấu trực tiếp chỉ mất chưa đầy một phút.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {/* Step 1 */}
          <div
            style={{
              textAlign: 'center',
              padding: '1.25rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--primary)',
                fontWeight: 900,
                fontSize: '1.1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 0.85rem auto',
              }}
            >
              1
            </div>
            <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1rem', fontWeight: 800 }}>
              Nạp Tài Liệu / Ý Tưởng
            </h3>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Tải lên tài liệu PDF, Word, dán đường dẫn Website hoặc chỉ cần nhập một chủ đề bài giảng.
            </p>
          </div>

          {/* Step 2 */}
          <div
            style={{
              textAlign: 'center',
              padding: '1.25rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                color: '#0ea5e9',
                fontWeight: 900,
                fontSize: '1.1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 0.85rem auto',
              }}
            >
              2
            </div>
            <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1rem', fontWeight: 800 }}>
              AI Biên Soạn & Tinh Chỉnh
            </h3>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              AI tự động sinh câu hỏi, đáp án, giải thích và trích dẫn. Bạn toàn quyền thêm sửa xóa câu hỏi theo ý muốn.
            </p>
          </div>

          {/* Step 3 */}
          <div
            style={{
              textAlign: 'center',
              padding: '1.25rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                fontWeight: 900,
                fontSize: '1.1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 0.85rem auto',
              }}
            >
              3
            </div>
            <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1rem', fontWeight: 800 }}>
              Tổ Chức & Tranh Tài
            </h3>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Host phòng thi đấu màn hình lớn, cấp mã PIN & QR code cho người chơi tham gia tranh tài trực tiếp.
            </p>
          </div>
        </div>
      </section>

      {/* 4. CORE ACTIVITIES GRID (Streamlined 2-Pillar Creator & Library Hub) */}
      <section style={{ marginBottom: '3.5rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h2
            style={{
              fontSize: '1.35rem',
              fontWeight: 900,
              color: 'var(--text-primary)',
              margin: '0 0 0.35rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <FlameIcon size={22} style={{ color: 'var(--primary)' }} />
            <span>Hành Trình Tương Tác Của Bạn</span>
          </h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Chọn ngay khu vực bạn muốn thao tác hôm nay.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {/* Card 1: Tạo game AI */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '20px',
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--card-shadow)',
              transition: 'border-color 0.15s ease, transform 0.15s ease',
            }}
          >
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '16px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.25rem',
              }}
            >
              <SparklesIcon size={28} />
            </div>
            <h3 style={{ margin: '0 0 0.45rem 0', fontSize: '1.25rem', fontWeight: 800 }}>
              Tạo Game Tự Động Bằng AI
            </h3>
            <p
              style={{
                margin: '0 0 1.5rem 0',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                flex: 1,
              }}
            >
              Nạp tài liệu PDF, Word, Website hoặc gõ chủ đề bất kỳ. Trí tuệ nhân tạo sẽ trích xuất
              và biên soạn trắc nghiệm chất lượng cao kèm trích dẫn nguồn.
            </p>
            <button
              type="button"
              onClick={() => onNavigateToCreate(selectedGameType)}
              style={{
                minHeight: '46px',
                padding: '0.75rem 1.25rem',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: 'var(--btn-shadow)',
              }}
            >
              <span>Bắt Đầu Tạo Ngay</span>
              <ArrowRightIcon size={16} />
            </button>
          </div>

          {/* Card 2: Thư viện Kho game */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '20px',
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--card-shadow)',
              transition: 'border-color 0.15s ease, transform 0.15s ease',
            }}
          >
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '16px',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                color: '#0ea5e9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.25rem',
              }}
            >
              <BookOpenIcon size={28} />
            </div>
            <h3 style={{ margin: '0 0 0.45rem 0', fontSize: '1.25rem', fontWeight: 800 }}>
              Thư Viện Kho Game
            </h3>
            <p
              style={{
                margin: '0 0 1.5rem 0',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                flex: 1,
              }}
            >
              Khám phá các bộ câu hỏi đã lưu. Dễ dàng xem lại, tinh chỉnh nội dung câu hỏi, quản lý
              mật khẩu bảo vệ và xuất dữ liệu game ra định dạng CSV/JSON.
            </p>
            <button
              type="button"
              onClick={onNavigateToLibrary}
              style={{
                minHeight: '46px',
                padding: '0.75rem 1.25rem',
                borderRadius: '12px',
                border: '1.5px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <span>Vào Thư Viện Game</span>
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* 5. CLEAN FOOTER */}
      <footer
        style={{
          marginTop: '4rem',
          paddingTop: '2rem',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
        }}
      >
        <div>
          © 2026 <strong>AI GAME PLATFORM</strong> — Nền tảng học tập & giải trí tương tác thế hệ mới.
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={onNavigateToLibrary}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Kho Game
          </button>
          {onNavigateToHost && (
            <button
              type="button"
              onClick={onNavigateToHost}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Host Phòng
            </button>
          )}
          {onNavigateToAdmin && (
            <button
              type="button"
              onClick={onNavigateToAdmin}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <ShieldIcon size={12} />
              <span>Quản trị viên</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};
