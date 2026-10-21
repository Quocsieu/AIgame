import React, { useState, useEffect, useRef } from 'react';
import type { GameSpecification } from '../types/index.js';
import { fetchGameQr } from '../services/api.js';
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  GamepadIcon,
  PlayIcon,
  QrCodeIcon,
  SparklesIcon,
  SpinnerIcon,
  UsersIcon,
  XMarkIcon,
} from './Icons.js';

interface GameModeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameSpec: GameSpecification | null;
  onStartSoloPlay: (spec: GameSpecification) => void;
  onCreateMultiplayerRoom: (spec: GameSpecification) => Promise<{ roomCode: string; hostToken: string; joinUrl: string } | null>;
  onPublishGame?: (gameId: string) => Promise<boolean>;
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  isOwner?: boolean;
}

export const GameModeSelectionModal: React.FC<GameModeSelectionModalProps> = ({
  isOpen,
  onClose,
  gameSpec,
  onStartSoloPlay,
  onCreateMultiplayerRoom,
  onPublishGame,
  onNavigateToHost,
  isOwner = true,
}) => {
  const [soloQrData, setSoloQrData] = useState<{ playUrl: string; qrDataUrl: string } | null>(null);
  const [isLoadingSoloQr, setIsLoadingSoloQr] = useState(false);
  const [soloQrError, setSoloQrError] = useState<string | null>(null);

  const [multiplayerRoomData, setMultiplayerRoomData] = useState<{
    roomCode: string;
    hostToken: string;
    joinUrl: string;
  } | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [isPublishing, setIsPublishing] = useState(false);
  const [copiedLink, setCopiedLink] = useState<'solo' | 'room' | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
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

  const handleFetchSoloQr = async () => {
    if (soloQrData) {
      setSoloQrData(null);
      return;
    }
    setIsLoadingSoloQr(true);
    setSoloQrError(null);
    try {
      const res = await fetchGameQr(gameSpec.gameId);
      setSoloQrData({
        playUrl: res.playUrl,
        qrDataUrl: res.qrDataUrl,
      });
    } catch (err: any) {
      setSoloQrError(err.message || 'Không thể tạo mã QR chơi đơn. Game có thể chưa được xuất bản.');
    } finally {
      setIsLoadingSoloQr(false);
    }
  };

  const handleOpenRoom = async () => {
    setIsCreatingRoom(true);
    setRoomError(null);
    try {
      const room = await onCreateMultiplayerRoom(gameSpec);
      if (room) {
        setMultiplayerRoomData(room);
      }
    } catch (err: any) {
      setRoomError(err.message || 'Không thể mở phòng thi đấu Multiplayer.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handlePublish = async () => {
    if (!onPublishGame || isPublishing) return;
    setIsPublishing(true);
    try {
      const success = await onPublishGame(gameSpec.gameId);
      if (success) {
        gameSpec.isPublic = true;
        setSoloQrError(null);
        const res = await fetchGameQr(gameSpec.gameId);
        setSoloQrData({
          playUrl: res.playUrl,
          qrDataUrl: res.qrDataUrl,
        });
      }
    } catch (err: any) {
      setSoloQrError(err.message || 'Xuất bản thất bại.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopy = (text: string, type: 'solo' | 'room') => {
    navigator.clipboard.writeText(text);
    setCopiedLink(type);
    setTimeout(() => setCopiedLink(null), 2500);
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
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
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
          borderRadius: '18px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.75rem',
          boxShadow: 'var(--shadow-modal)',
          color: 'var(--text-primary)',
          outline: 'none',
          animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent-sky)', marginBottom: '0.25rem' }}>
              CHỌN CHẾ ĐỘ CHƠI
            </div>
            <h2 id="game-mode-modal-title" style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {gameSpec.title}
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '6px', backgroundColor: 'var(--accent-sky-subtle)', color: 'var(--accent-sky)' }}>
                {formatGameTypeName(gameSpec.gameType)}
              </span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                {gameSpec.questions.length} câu hỏi
              </span>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  backgroundColor: gameSpec.isPublic ? 'var(--accent-emerald-subtle)' : 'var(--accent-amber-subtle)',
                  color: gameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                  border: `1px solid ${gameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)'}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                {gameSpec.isPublic ? (
                  <>
                    <CheckIcon size={14} />
                    <span>Đã xuất bản công khai</span>
                  </>
                ) : (
                  <span>Bản nháp (DRAFT)</span>
                )}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            title="Đóng (Phím Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              minWidth: '44px',
              minHeight: '44px',
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

        {/* Thông báo nếu game là bản nháp */}
        {!gameSpec.isPublic && (
          <div
            style={{
              padding: '1rem',
              borderRadius: '12px',
              backgroundColor: 'var(--accent-amber-subtle)',
              border: '1px solid var(--accent-amber)',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ fontWeight: 800, color: 'var(--accent-amber)', fontSize: '0.9rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertTriangleIcon size={16} />
                <span>Game đang ở trạng thái Bản nháp (Chưa xuất bản)</span>
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Bạn vẫn có thể tự chơi thử một mình. Để tạo mã QR chia sẻ cho người khác hoặc mở phòng công khai, bạn cần xuất bản game này.
              </div>
            </div>
            {isOwner && onPublishGame && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing}
                style={{
                  backgroundColor: 'var(--accent-emerald)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.6rem 1.1rem',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: isPublishing ? 'not-allowed' : 'pointer',
                  minHeight: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                {isPublishing ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang xuất bản...</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon size={16} />
                    <span>Xuất bản ngay</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Danh sách 2 Chế Độ Chơi Lớn */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
          {/* CHẾ ĐỘ A: CHƠI ĐƠN */}
          <div
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '14px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <GamepadIcon size={20} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Chế độ A: Chơi đơn
                </h3>
              </div>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Tự luyện tập cá nhân theo tiến độ riêng. Người chơi qua link/QR chỉ có quyền trả lời và xem kết quả, không cần đăng nhập.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartSoloPlay(gameSpec);
                }}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  minHeight: '44px',
                }}
              >
                <PlayIcon size={16} />
                <span>Chơi Ngay Trên Trình Duyệt</span>
              </button>

              <button
                type="button"
                onClick={handleFetchSoloQr}
                disabled={isLoadingSoloQr}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--accent-sky)',
                  border: '1px solid var(--accent-sky)',
                  borderRadius: '10px',
                  padding: '0.65rem 1rem',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  minHeight: '40px',
                }}
              >
                {isLoadingSoloQr ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang tạo mã QR...</span>
                  </>
                ) : soloQrData ? (
                  <span>Ẩn Mã QR Chơi Đơn</span>
                ) : (
                  <>
                    <QrCodeIcon size={16} />
                    <span>Chia Sẻ Link & Mã QR Chơi Đơn</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* CHẾ ĐỘ B: MULTIPLAYER */}
          <div
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '14px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--accent-emerald-subtle)', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UsersIcon size={20} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Chế độ B: Chơi nhóm Multiplayer
                </h3>
              </div>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Mở phòng đấu trực tiếp. Người tham gia quét mã QR vào phòng, cùng thi đấu thời gian thực và xem bảng xếp hạng kịch tính.
              </p>
            </div>

            <div>
              {!multiplayerRoomData ? (
                <button
                  type="button"
                  onClick={handleOpenRoom}
                  disabled={isCreatingRoom}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--accent-emerald)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: isCreatingRoom ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    minHeight: '44px',
                  }}
                >
                  {isCreatingRoom ? (
                    <>
                      <SpinnerIcon size={16} />
                      <span>Đang mở phòng đấu...</span>
                    </>
                  ) : (
                    <>
                      <UsersIcon size={18} />
                      <span>Mở Phòng Đấu Multiplayer</span>
                    </>
                  )}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onNavigateToHost) {
                        onNavigateToHost(multiplayerRoomData.roomCode, multiplayerRoomData.hostToken);
                      }
                    }}
                    style={{
                      backgroundColor: 'var(--accent-emerald)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0.75rem 1rem',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      minHeight: '44px',
                    }}
                  >
                    <span>Vào Màn Hình Host ({multiplayerRoomData.roomCode}) &rarr;</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Khối hiển thị chi tiết Solo QR & Link */}
        {soloQrError && (
          <div role="alert" style={{ padding: '0.85rem', borderRadius: '10px', backgroundColor: 'var(--accent-rose-subtle)', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangleIcon size={16} />
            <span>{soloQrError}</span>
          </div>
        )}

        {soloQrData && (
          <div
            style={{
              padding: '1.25rem',
              borderRadius: '14px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--accent-sky)',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <img
                src={soloQrData.qrDataUrl}
                alt="Mã QR Chơi Đơn"
                style={{
                  width: '130px',
                  height: '130px',
                  borderRadius: '10px',
                  border: '2px solid var(--border-subtle)',
                  display: 'block',
                  margin: '0 auto',
                  backgroundColor: '#ffffff',
                }}
              />
              <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--accent-sky)', marginTop: '0.4rem', letterSpacing: '0.04em' }}>
                QUÉT ĐỂ CHƠI ĐƠN
              </div>
            </div>

            <div style={{ flex: '1 1 240px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                LIÊN KẾT CHƠI ĐƠN CÔNG KHAI:
              </div>
              <div
                style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  fontSize: '0.82rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  wordBreak: 'break-all',
                  marginBottom: '0.75rem',
                  color: 'var(--accent-sky)',
                }}
              >
                {soloQrData.playUrl}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(soloQrData.playUrl, 'solo')}
                style={{
                  backgroundColor: copiedLink === 'solo' ? 'var(--accent-emerald)' : 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.6rem 1rem',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  minHeight: '38px',
                }}
              >
                {copiedLink === 'solo' ? (
                  <>
                    <CheckIcon size={16} />
                    <span>Đã sao chép liên kết!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={16} />
                    <span>Sao Chép Link Chơi Đơn</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Khối hiển thị chi tiết Phòng Multiplayer vừa mở */}
        {roomError && (
          <div role="alert" style={{ padding: '0.85rem', borderRadius: '10px', backgroundColor: 'var(--accent-rose-subtle)', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangleIcon size={16} />
            <span>{roomError}</span>
          </div>
        )}

        {multiplayerRoomData && (
          <div
            style={{
              padding: '1.25rem',
              borderRadius: '14px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--accent-emerald)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.85rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  PHÒNG ĐẤU MULTIPLAYER ĐÃ SẴN SÀNG:
                </div>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--accent-emerald)', letterSpacing: '0.12em', fontFamily: "'JetBrains Mono', monospace" }}>
                  {multiplayerRoomData.roomCode}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(multiplayerRoomData.joinUrl, 'room')}
                style={{
                  backgroundColor: copiedLink === 'room' ? 'var(--accent-emerald)' : 'var(--bg-surface)',
                  color: copiedLink === 'room' ? '#ffffff' : 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.6rem 1rem',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  minHeight: '40px',
                }}
              >
                {copiedLink === 'room' ? (
                  <>
                    <CheckIcon size={16} />
                    <span>Đã sao chép link phòng!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={16} />
                    <span>Sao Chép Link Tham Gia</span>
                  </>
                )}
              </button>
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              Link người chơi: <code style={{ color: 'var(--accent-sky)', fontFamily: "'JetBrains Mono', monospace" }}>{multiplayerRoomData.joinUrl}</code>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '10px',
              padding: '0.65rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              minHeight: '42px',
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
