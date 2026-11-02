import React, { useState, useEffect, useRef } from 'react';
import type { GameSpecification } from '../types/index.js';
import {
  GamepadIcon,
  QrCodeIcon,
  SpinnerIcon,
  UsersIcon,
  XMarkIcon,
} from './Icons.js';

interface GameModeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameSpec: GameSpecification | null;
  onStartSoloPresentation: (spec: GameSpecification) => void;
  onStartPlaytest?: (spec: GameSpecification) => void;
  onCreateMultiplayerRoom: (spec: GameSpecification) => Promise<{ roomCode: string; hostToken: string; joinUrl: string } | null>;
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onPublishGame?: (gameId: string) => Promise<boolean>;
  isOwner?: boolean;
}

export const GameModeSelectionModal: React.FC<GameModeSelectionModalProps> = ({
  isOpen,
  onClose,
  gameSpec,
  onStartSoloPresentation,
  onStartPlaytest,
  onCreateMultiplayerRoom,
  onNavigateToHost,
  onPublishGame,
  isOwner = true,
}) => {
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isPublishingSolo, setIsPublishingSolo] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsCreatingRoom(false);
      setIsPublishingSolo(false);
      setShowPublishConfirm(false);
      previousActiveElement.current = document.activeElement as HTMLElement | null;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      modalRef.current?.focus();

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        previousActiveElement.current?.focus();
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen || !gameSpec) return null;

  const handleSelectPlaytest = () => {
    if (!onStartPlaytest) return;
    onClose();
    onStartPlaytest(gameSpec);
  };

  const handleSelectSolo = async () => {
    if (!gameSpec.isPublic) {
      setShowPublishConfirm(true);
      return;
    }
    onClose();
    onStartSoloPresentation(gameSpec);
  };

  const handleConfirmPublishAndSolo = async () => {
    if (!onPublishGame) {
      onClose();
      onStartSoloPresentation(gameSpec);
      return;
    }
    setIsPublishingSolo(true);
    try {
      const ok = await onPublishGame(gameSpec.gameId);
      if (ok) {
        gameSpec.isPublic = true;
        setShowPublishConfirm(false);
        onClose();
        onStartSoloPresentation({ ...gameSpec, isPublic: true });
      }
    } catch {
      // Handled by parent or toast
    } finally {
      setIsPublishingSolo(false);
    }
  };

  const handleSelectMultiplayer = async () => {
    setIsCreatingRoom(true);
    try {
      const room = await onCreateMultiplayerRoom(gameSpec);
      if (room && onNavigateToHost) {
        onClose();
        onNavigateToHost(room.roomCode, room.hostToken);
      }
    } catch {
      // Handled by parent or toast
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const formatGameTypeName = (type: string) => {
    switch (type) {
      case 'MULTIPLE_CHOICE':
        return 'Trắc nghiệm ABCD';
      case 'FILL_IN_THE_BLANK':
        return 'Điền từ';
      case 'QUICK_BUTTON':
        return 'Đúng / Sai';
      case 'CROSSWORD':
        return 'Ô chữ';
      case 'MIXED':
        return 'Hỗn hợp';
      default:
        return type;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-mode-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCreatingRoom && !isPublishingSolo) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '640px',
          padding: '1.75rem',
          boxShadow: 'var(--shadow-modal)',
          color: 'var(--text-primary)',
          outline: 'none',
          animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', gap: '1rem' }}>
          <div>
            <h2 id="game-mode-modal-title" style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {gameSpec.title}
            </h2>
            <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 800, padding: '0.2rem 0.5rem', borderRadius: '6px', backgroundColor: 'var(--primary-subtle)', color: 'var(--primary)' }}>
                {formatGameTypeName(gameSpec.gameType)}
              </span>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                {gameSpec.questions.length} câu hỏi
              </span>
              <span
                data-testid="mode-modal-publish-status-badge"
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  backgroundColor: gameSpec.isPublic ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.16)',
                  color: gameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                }}
              >
                {gameSpec.isPublic ? 'Đã xuất bản' : 'Bản nháp (Chưa xuất bản)'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isCreatingRoom || isPublishingSolo}
            aria-label="Đóng cửa sổ"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: isCreatingRoom || isPublishingSolo ? 'not-allowed' : 'pointer',
              minWidth: '40px',
              minHeight: '40px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <XMarkIcon size={20} />
          </button>
        </div>

        {/* CẢNH BÁO XÁC NHẬN KHI GAME ĐANG Ở TRẠNG THÁI BẢN NHÁP */}
        {showPublishConfirm && !gameSpec.isPublic && (
          <div
            data-testid="mode-modal-draft-publish-confirm"
            style={{
              marginBottom: '1.1rem',
              padding: '1rem 1.15rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              border: '1.5px solid rgba(245, 158, 11, 0.45)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
            }}
          >
            <div style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--accent-amber)' }}>
              Bộ câu hỏi này đang ở trạng thái Bản nháp (Draft)
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Để mở phiên <strong>Chơi Đơn chính thức</strong> (có lưu lịch sử / điểm thi / phát mã QR công khai), hệ thống cần <strong>Xuất bản</strong> bộ câu hỏi. Nếu bạn chỉ muốn kiểm tra thử nội dung và giữ nguyên trạng thái Bản nháp, hãy chọn <strong>Chơi thử (Playtest)</strong>.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                data-testid="mode-modal-cancel-publish-btn"
                disabled={isPublishingSolo}
                onClick={() => setShowPublishConfirm(false)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Giữ Bản nháp
              </button>
              {onStartPlaytest && (
                <button
                  type="button"
                  data-testid="mode-modal-switch-playtest-btn"
                  disabled={isPublishingSolo}
                  onClick={handleSelectPlaytest}
                  style={{
                    padding: '0.45rem 0.95rem',
                    borderRadius: '8px',
                    border: '1px solid var(--accent-sky)',
                    backgroundColor: 'rgba(56, 189, 248, 0.14)',
                    color: 'var(--accent-sky)',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Chơi thử (Không xuất bản)
                </button>
              )}
              <button
                type="button"
                data-testid="mode-modal-confirm-publish-solo-btn"
                disabled={isPublishingSolo}
                onClick={handleConfirmPublishAndSolo}
                style={{
                  padding: '0.45rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink)',
                  fontWeight: 900,
                  fontSize: '0.8rem',
                  cursor: isPublishingSolo ? 'wait' : 'pointer',
                }}
              >
                {isPublishingSolo ? 'Đang xuất bản...' : 'Xác nhận Xuất bản & Chơi Đơn'}
              </button>
            </div>
          </div>
        )}

        {/* NÚT CHƠI THỬ (PLAYTEST — DÀNH CHO BTC / CHỦ SỞ HỮU) */}
        {isOwner && onStartPlaytest && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.85rem 1rem',
              borderRadius: '14px',
              backgroundColor: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.85rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--accent-sky)' }}>
                Chơi thử kiểm tra đề (Playtest)
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Trải nghiệm đầy đủ câu hỏi, thời gian, điểm số. Không lưu lịch sử, không tính lượt thi, giữ nguyên trạng thái {gameSpec.isPublic ? 'Đã xuất bản' : 'Bản nháp'}.
              </div>
            </div>
            <button
              type="button"
              data-testid="mode-modal-playtest-btn"
              onClick={handleSelectPlaytest}
              style={{
                backgroundColor: 'var(--accent-sky)',
                color: '#08090e',
                border: 'none',
                borderRadius: '9px',
                padding: '0.55rem 1rem',
                fontWeight: 900,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                whiteSpace: 'nowrap',
              }}
            >
              <GamepadIcon size={15} />
              <span>Chơi thử ngay</span>
            </button>
          </div>
        )}

        {/* 2 LỰA CHỌN CHÍNH THỨC: CHƠI ĐƠN VS CHƠI NHÓM */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* THẺ 1: CHƠI ĐƠN */}
          <div
            role="button"
            tabIndex={0}
            data-testid="mode-modal-solo-card"
            onClick={isCreatingRoom || isPublishingSolo ? undefined : handleSelectSolo}
            onKeyDown={(e) => {
              if (!isCreatingRoom && !isPublishingSolo && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleSelectSolo();
              }
            }}
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '2px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '1.25rem',
              cursor: isCreatingRoom || isPublishingSolo ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              userSelect: 'none',
              opacity: isCreatingRoom || isPublishingSolo ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isCreatingRoom && !isPublishingSolo) {
                e.currentTarget.style.borderColor = 'var(--primary)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--primary-subtle)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <GamepadIcon size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Chơi Đơn
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {gameSpec.isPublic ? 'Tự luyện tập / Thi cá nhân' : 'Cần xác nhận xuất bản'}
                </span>
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-ink)',
                padding: '0.7rem 1rem',
                borderRadius: '10px',
                fontWeight: 900,
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
              }}
            >
              <QrCodeIcon size={16} />
              <span>Chơi Đơn →</span>
            </div>
          </div>

          {/* THẺ 2: CHƠI NHÓM */}
          <div
            role="button"
            tabIndex={0}
            data-testid="mode-modal-multiplayer-card"
            onClick={isCreatingRoom || isPublishingSolo ? undefined : handleSelectMultiplayer}
            onKeyDown={(e) => {
              if (!isCreatingRoom && !isPublishingSolo && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleSelectMultiplayer();
              }
            }}
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '2px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '1.25rem',
              cursor: isCreatingRoom || isPublishingSolo ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              userSelect: 'none',
              opacity: isCreatingRoom || isPublishingSolo ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isCreatingRoom && !isPublishingSolo) {
                e.currentTarget.style.borderColor = 'var(--accent-emerald)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: 'var(--accent-emerald)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <UsersIcon size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Chơi Nhóm
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Phòng đấu Game Show
                </span>
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--accent-emerald)',
                color: '#ffffff',
                padding: '0.7rem 1rem',
                borderRadius: '10px',
                fontWeight: 900,
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
              }}
            >
              {isCreatingRoom ? (
                <>
                  <SpinnerIcon size={16} />
                  <span>Đang mở phòng...</span>
                </>
              ) : (
                <>
                  <UsersIcon size={16} />
                  <span>Chơi Nhóm →</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
