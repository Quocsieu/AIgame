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
  onCreateMultiplayerRoom,
  onNavigateToHost,
  onPublishGame,
  isOwner = true,
}) => {
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsCreatingRoom(false);
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

  const handleSelectSolo = async () => {
    if (!gameSpec.isPublic && onPublishGame) {
      try {
        await onPublishGame(gameSpec.gameId);
        gameSpec.isPublic = true;
      } catch {
        // Continue anyway
      }
    }
    onClose();
    onStartSoloPresentation(gameSpec);
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
        if (e.target === e.currentTarget && !isCreatingRoom) {
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
          maxWidth: '620px',
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
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isCreatingRoom}
            aria-label="Đóng cửa sổ"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: isCreatingRoom ? 'not-allowed' : 'pointer',
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

        {/* 2 LỰA CHỌN DUY NHẤT: CHƠI ĐƠN VS CHƠI NHÓM */}
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
            onClick={isCreatingRoom ? undefined : handleSelectSolo}
            onKeyDown={(e) => {
              if (!isCreatingRoom && (e.key === 'Enter' || e.key === ' ')) {
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
              cursor: isCreatingRoom ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              userSelect: 'none',
              opacity: isCreatingRoom ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isCreatingRoom) {
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
                  Tự luyện tập cá nhân
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
            onClick={isCreatingRoom ? undefined : handleSelectMultiplayer}
            onKeyDown={(e) => {
              if (!isCreatingRoom && (e.key === 'Enter' || e.key === ' ')) {
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
              cursor: isCreatingRoom ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              userSelect: 'none',
              opacity: isCreatingRoom ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isCreatingRoom) {
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
