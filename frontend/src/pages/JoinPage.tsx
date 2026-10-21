import React, { useState } from 'react';
import { useToast } from '../components/ToastContext.js';
import { ArrowRightIcon, LockIcon, UsersIcon } from '../components/Icons.js';

interface JoinPageProps {
  initialRoomCode?: string;
  onJoin: (roomCode: string, displayName: string) => void;
}

export const JoinPage: React.FC<JoinPageProps> = ({ initialRoomCode = '', onJoin }) => {
  const toast = useToast();
  const [roomCode, setRoomCode] = useState(initialRoomCode.toUpperCase());
  const [displayName, setDisplayName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');

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

    if (roomPassword.trim()) {
      try {
        sessionStorage.setItem(`room_game_password_${cleanCode}`, roomPassword.trim());
      } catch {}
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
          boxShadow: 'var(--shadow-lg)',
          animation: 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--primary), var(--accent-sky))',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
              boxShadow: 'var(--btn-shadow)',
              color: '#ffffff',
            }}
          >
            <UsersIcon size={26} />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: 'var(--text-primary)', fontWeight: 800, letterSpacing: '-0.03em' }}>
            Tham Gia Phòng Đấu
          </h1>
          <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Nhập mã phòng 6 ký tự để cùng thi đấu thời gian thực
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              htmlFor="join-room-code"
              style={{
                display: 'block',
                marginBottom: '0.45rem',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Mã phòng (6 ký tự) <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input
              id="join-room-code"
              type="text"
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="VD: ABC123"
              required
              autoFocus
              autoComplete="off"
              spellCheck="false"
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: '12px',
                border: '2px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--accent-sky)',
                fontSize: '1.6rem',
                fontWeight: 900,
                textAlign: 'center',
                letterSpacing: '0.2em',
                fontFamily: "'JetBrains Mono', monospace",
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label
              htmlFor="join-player-name"
              style={{
                display: 'block',
                marginBottom: '0.45rem',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Tên người chơi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input
              id="join-player-name"
              type="text"
              maxLength={30}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="VD: Tuấn Kiệt"
              required
              autoComplete="nickname"
              style={{
                width: '100%',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                fontWeight: 600,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label
              htmlFor="join-room-password"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginBottom: '0.45rem',
                color: 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <LockIcon size={14} />
              <span>Mật khẩu bộ câu hỏi (Nếu có)</span>
            </label>
            <input
              id="join-room-password"
              type="password"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              placeholder="Bỏ trống nếu phòng không yêu cầu..."
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              minHeight: '48px',
              padding: '0.9rem 1.25rem',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontSize: '1.05rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: 'var(--btn-shadow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <span>Vào phòng thi đấu</span>
            <ArrowRightIcon size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};
