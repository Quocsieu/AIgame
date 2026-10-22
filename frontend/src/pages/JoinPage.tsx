import React, { useState, useEffect } from 'react';
import { useToast } from '../components/ToastContext.js';
import { ArrowRightIcon, LinkIcon, QrCodeIcon, UsersIcon } from '../components/Icons.js';

interface JoinPageProps {
  initialRoomCode?: string;
  onJoin: (roomCode: string, displayName: string) => void;
}

export const JoinPage: React.FC<JoinPageProps> = ({ initialRoomCode = '', onJoin }) => {
  const toast = useToast();

  // Extract roomCode from props or current URL query (?room=...)
  const getInitialCode = () => {
    if (initialRoomCode.trim()) return initialRoomCode.trim().toUpperCase();
    try {
      const params = new URLSearchParams(window.location.search);
      const qRoom = params.get('room');
      if (qRoom?.trim()) return qRoom.trim().toUpperCase();
    } catch {}
    return '';
  };

  const [roomCode, setRoomCode] = useState(getInitialCode);
  const [displayName, setDisplayName] = useState(() => {
    try {
      return sessionStorage.getItem('active_player_name') || '';
    } catch {
      return '';
    }
  });

  // State for fallback link/QR paste when navigated directly without URL room
  const [pasteInput, setPasteInput] = useState('');

  useEffect(() => {
    if (initialRoomCode.trim()) {
      setRoomCode(initialRoomCode.trim().toUpperCase());
    }
  }, [initialRoomCode]);

  const handleExtractFromPaste = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = pasteInput.trim();
    if (!raw) {
      toast.error('Vui lòng dán liên kết hoặc mã phòng chơi.', 'Thiếu liên kết');
      return;
    }

    let extracted = '';
    // Try URL parsing
    try {
      if (raw.includes('room=')) {
        const url = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
        extracted = url.searchParams.get('room') || '';
      }
    } catch {}

    if (!extracted) {
      // If 6 alphanumeric characters or raw text
      const match = raw.match(/[A-Za-z0-9]{6}/);
      if (match) {
        extracted = match[0];
      } else {
        extracted = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
      }
    }

    if (extracted && extracted.length >= 4) {
      const code = extracted.toUpperCase();
      setRoomCode(code);
      setPasteInput('');
      toast.success(`Đã nhận diện phòng chơi: ${code}`, 'Kết nối thành công');
    } else {
      toast.error('Không tìm thấy mã phòng hợp lệ trong liên kết vừa dán.', 'Liên kết không hợp lệ');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    const cleanName = displayName.trim();

    if (!cleanCode) {
      toast.error('Chưa có mã phòng chơi. Vui lòng quét mã QR hoặc mở link từ Host.', 'Thiếu mã phòng');
      return;
    }
    if (!cleanName) {
      toast.error('Vui lòng nhập tên hoặc biệt danh của bạn.', 'Thiếu tên người chơi');
      return;
    }

    try {
      sessionStorage.setItem('active_player_name', cleanName);
    } catch {}

    toast.info(`Đang kết nối vào phòng ${cleanCode}...`, 'Tham gia phòng');
    onJoin(cleanCode, cleanName);
  };

  const isRoomReady = Boolean(roomCode && roomCode.length >= 4);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '78vh', padding: '1rem' }}>
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '2px solid var(--border-subtle)',
          borderRadius: '24px',
          padding: '2.5rem 2rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: 'var(--shadow-lg)',
          animation: 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1.5px solid var(--primary)',
              boxShadow: '0 0 16px var(--primary-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
              color: 'var(--primary)',
            }}
          >
            <UsersIcon size={28} />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.85rem', color: 'var(--text-primary)', fontWeight: 900, letterSpacing: '-0.03em' }}>
            Tham Gia Phòng Đấu
          </h1>
          <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
            {isRoomReady
              ? 'Tự động nhận diện phòng qua QR/Link. Nhập tên để vào tranh tài!'
              : 'Quét mã QR từ màn hình Host hoặc dán liên kết để vào phòng'}
          </p>
        </div>

        {isRoomReady ? (
          /* Luồng ưu tiên: Đã quét QR hoặc mở Link, mã phòng tự động nhận diện, KHÔNG CẦN NHẬP PIN */
          <form onSubmit={handleSubmit}>
            {/* Huy hiệu phòng chơi đã liên kết */}
            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1.5px solid var(--border-strong)',
                borderRadius: '16px',
                padding: '0.85rem 1.1rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                  Phòng thi đấu đã kết nối
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', fontVariantNumeric: 'tabular-nums' }}>
                  {roomCode}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                <span
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    color: '#16a34a',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#16a34a' }} />
                  Sẵn sàng
                </span>
                <button
                  type="button"
                  onClick={() => setRoomCode('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Đổi phòng
                </button>
              </div>
            </div>

            {/* Ô nhập duy nhất: Tên hoặc biệt danh người chơi */}
            <div style={{ marginBottom: '1.75rem' }}>
              <label
                htmlFor="join-player-name"
                style={{
                  display: 'block',
                  marginBottom: '0.45rem',
                  color: 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                }}
              >
                Tên hoặc biệt danh của bạn <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <input
                id="join-player-name"
                type="text"
                maxLength={30}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="VD: Tia Chớp, Tuấn Kiệt"
                required
                autoFocus
                autoComplete="nickname"
                style={{
                  width: '100%',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '14px',
                  border: '2px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              className="k-btn k-btn-green"
              style={{
                width: '100%',
                minHeight: '52px',
                padding: '0.95rem 1.25rem',
                borderRadius: '14px',
                fontSize: '1.1rem',
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 0 var(--k-green-dark)',
              }}
            >
              <span>Vào phòng thi đấu</span>
              <ArrowRightIcon size={20} />
            </button>
          </form>
        ) : (
          /* Trường hợp chưa có link/QR: Hướng dẫn quét QR và hỗ trợ dán liên kết */
          <div>
            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px dashed var(--border-strong)',
                borderRadius: '16px',
                padding: '1.5rem 1.25rem',
                textAlign: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(99, 102, 241, 0.12)',
                  color: 'var(--brand-purple)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '0.75rem',
                }}
              >
                <QrCodeIcon size={26} />
              </div>
              <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Quét mã QR để tham gia
              </h3>
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Dùng camera điện thoại quét mã QR trên màn hình của người tổ chức (Host) để tự động vào phòng mà không cần gõ mã.
              </p>
            </div>

            <form onSubmit={handleExtractFromPaste}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  htmlFor="join-paste-url"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    marginBottom: '0.45rem',
                    color: 'var(--text-primary)',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                  }}
                >
                  <LinkIcon size={14} />
                  <span>Hoặc dán liên kết phòng chơi:</span>
                </label>
                <input
                  id="join-paste-url"
                  type="text"
                  value={pasteInput}
                  onChange={(e) => setPasteInput(e.target.value)}
                  placeholder="Dán link phòng (VD: http://.../?room=ABC123)..."
                  autoComplete="off"
                  spellCheck="false"
                  style={{
                    width: '100%',
                    padding: '0.85rem 1rem',
                    borderRadius: '12px',
                    border: '1.5px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '0.92rem',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                className="k-btn k-btn-blue"
                style={{
                  width: '100%',
                  minHeight: '48px',
                  padding: '0.85rem 1.25rem',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                <span>Nhận diện phòng chơi</span>
                <ArrowRightIcon size={18} />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
