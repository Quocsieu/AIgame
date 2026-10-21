import React, { useState } from 'react';
import type { GameSpecification } from '../types/index.js';
import { fetchGameQr } from '../services/api.js';

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
        // Automatically fetch QR after successful publish
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
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '18px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.75rem',
          boxShadow: 'var(--card-shadow)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent-sky)', marginBottom: '0.25rem' }}>
              CHỌN CHẾ ĐỘ CHƠI
            </div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              {gameSpec.title}
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, padding: '0.2rem 0.55rem', borderRadius: '6px', backgroundColor: 'rgba(56, 189, 248, 0.15)', color: 'var(--accent-sky)' }}>
                {formatGameTypeName(gameSpec.gameType)}
              </span>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, padding: '0.2rem 0.55rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                {gameSpec.questions.length} câu hỏi
              </span>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  backgroundColor: gameSpec.isPublic ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: gameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                  border: `1px solid ${gameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)'}`,
                }}
              >
                {gameSpec.isPublic ? '🚀 Đã xuất bản công khai' : '📝 Bản nháp (DRAFT)'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.6rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0.2rem',
            }}
            title="Đóng"
          >
            &times;
          </button>
        </div>

        {/* Thông báo nếu game là bản nháp */}
        {!gameSpec.isPublic && (
          <div
            style={{
              padding: '1rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
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
              <div style={{ fontWeight: 800, color: 'var(--accent-amber)', fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                ⚠️ Game đang ở trạng thái Bản nháp (Chưa xuất bản)
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
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
                  padding: '0.55rem 1rem',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: isPublishing ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                }}
              >
                {isPublishing ? '⏳ Đang xuất bản...' : '🚀 Xuất bản ngay'}
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
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '1.5rem' }}>🎮</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Chế độ A: Chơi đơn
                </h3>
              </div>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Tự luyện tập cá nhân theo tiến độ riêng. Người chơi qua link/QR chỉ có quyền trả lời và xem kết quả, không cần đăng nhập.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
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
                  fontSize: '0.92rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  boxShadow: 'var(--btn-shadow)',
                }}
              >
                🎯 Chơi Ngay Trên Trình Duyệt
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
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                }}
              >
                {isLoadingSoloQr
                  ? '⏳ Đang tạo mã QR...'
                  : soloQrData
                  ? 'Ẩn Mã QR Chơi Đơn'
                  : '🔗 Chia Sẻ Link & Mã QR Chơi Đơn'}
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
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '1.5rem' }}>🏟️</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Chế độ B: Chơi nhóm Multiplayer
                </h3>
              </div>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
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
                    fontWeight: 900,
                    fontSize: '0.92rem',
                    cursor: isCreatingRoom ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                  }}
                >
                  {isCreatingRoom ? '⏳ Đang mở phòng đấu...' : '🏟️ Mở Phòng Đấu Multiplayer'}
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
                      fontWeight: 900,
                      fontSize: '0.92rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                    }}
                  >
                    🚀 Vào Màn Hình Host ({multiplayerRoomData.roomCode})
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Khối hiển thị chi tiết Solo QR & Link */}
        {soloQrError && (
          <div style={{ padding: '0.85rem', borderRadius: '10px', backgroundColor: 'rgba(244, 63, 94, 0.12)', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            ⚠️ {soloQrError}
          </div>
        )}

        {soloQrData && (
          <div
            style={{
              padding: '1.25rem',
              borderRadius: '14px',
              backgroundColor: 'var(--bg-input)',
              border: '2px solid var(--accent-sky)',
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
                  width: '140px',
                  height: '140px',
                  borderRadius: '10px',
                  border: '3px solid #ffffff',
                  display: 'block',
                  margin: '0 auto',
                  backgroundColor: '#ffffff',
                }}
              />
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-sky)', marginTop: '0.4rem' }}>
                QUÉT ĐỂ CHƠI ĐƠN
              </div>
            </div>

            <div style={{ flex: '1 1 240px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                LIÊN KẾT CHƠI ĐƠN CÔNG KHAI:
              </div>
              <div
                style={{
                  padding: '0.55rem 0.8rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
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
                  padding: '0.55rem 1rem',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                {copiedLink === 'solo' ? '✓ Đã sao chép liên kết!' : '📋 Sao Chép Link Chơi Đơn'}
              </button>
            </div>
          </div>
        )}

        {/* Khối hiển thị chi tiết Phòng Multiplayer vừa mở */}
        {roomError && (
          <div style={{ padding: '0.85rem', borderRadius: '10px', backgroundColor: 'rgba(244, 63, 94, 0.12)', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            ⚠️ {roomError}
          </div>
        )}

        {multiplayerRoomData && (
          <div
            style={{
              padding: '1.25rem',
              borderRadius: '14px',
              backgroundColor: 'var(--bg-input)',
              border: '2px solid var(--accent-emerald)',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  PHÒNG ĐẤU MULTIPLAYER ĐÃ SẴN SÀNG:
                </div>
                <div style={{ fontSize: '2.4rem', fontWeight: 900, color: 'var(--accent-emerald)', letterSpacing: '0.12em' }}>
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
                  padding: '0.55rem 1rem',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                {copiedLink === 'room' ? '✓ Đã sao chép link phòng!' : '📋 Sao Chép Link Tham Gia'}
              </button>
            </div>
            <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              Link người chơi: <code style={{ color: 'var(--accent-sky)' }}>{multiplayerRoomData.joinUrl}</code>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '10px',
              padding: '0.65rem 1.25rem',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: 'pointer',
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
