import React, { useState } from 'react';
import { useToast } from '../components/ToastContext.js';

interface JoinPageProps {
  initialRoomCode?: string;
  onJoin: (roomCode: string, displayName: string) => void;
}

export const JoinPage: React.FC<JoinPageProps> = ({ initialRoomCode = '', onJoin }) => {
  const toast = useToast();
  const [roomCode, setRoomCode] = useState(initialRoomCode.toUpperCase());
  const [displayName, setDisplayName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    const cleanName = displayName.trim();

    if (!cleanCode) {
      toast.error('Vui lòng nhập mã phòng hợp lệ gồm 6 ký tự.', 'Thiếu mã phòng');
      return;
    }
    if (!cleanName) {
      toast.error('Vui lòng nhập tên hoặc biệt danh của bạn.', 'Thiếu tên người chơi');
      return;
    }

    toast.info(`Đang kết nối vào phòng ${cleanCode}...`, 'Tham gia phòng');
    onJoin(cleanCode, cleanName);
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '75vh', padding: '1rem' }}>
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '20px',
          padding: '2.5rem 2rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: 'var(--card-shadow)',
          animation: 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #2563eb, #38bdf8)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              marginBottom: '1rem',
              boxShadow: '0 8px 20px var(--primary-glow)',
              color: '#ffffff',
            }}
          >
            🎮
          </div>
          <h1 style={{ margin: 0, fontSize: '1.85rem', color: 'var(--text-primary)', fontWeight: 900, letterSpacing: '-0.03em' }}>
            Tham Gia Phòng Đấu
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.5rem 0 0 0', lineHeight: 1.45 }}>
            Nhập mã phòng và biệt danh của bạn để tranh tài kiến thức trực tiếp cùng mọi người!
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.45rem', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              MÃ PHÒNG (6 KÝ TỰ)
            </label>
            <input
              type="text"
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="VD: ABC123"
              required
              autoFocus
              style={{
                width: '100%',
                padding: '0.9rem',
                borderRadius: '12px',
                border: '2px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--accent-sky)',
                fontSize: '1.6rem',
                fontWeight: 900,
                textAlign: 'center',
                letterSpacing: '0.2em',
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.15s ease',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.45rem', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              TÊN / BIỆT DANH
            </label>
            <input
              type="text"
              maxLength={30}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="VD: Tuấn Kiệt"
              required
              style={{
                width: '100%',
                padding: '0.9rem 1rem',
                borderRadius: '12px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '1.05rem',
                fontWeight: 700,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '0.95rem 1.25rem',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontSize: '1.1rem',
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: 'var(--btn-shadow)',
              transition: 'transform 0.1s ease, box-shadow 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <span>Vào phòng chiến ngay</span>
            <span>🚀</span>
          </button>
        </form>
      </div>
    </div>
  );
};

