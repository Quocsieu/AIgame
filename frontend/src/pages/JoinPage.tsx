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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '75vh', padding: '1.5rem' }}>
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '2.25rem', width: '100%', maxWidth: '440px', boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.6)' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(37, 99, 235, 0.15)', border: '1px solid rgba(37, 99, 235, 0.3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', marginBottom: '0.75rem' }}>
            🎮
          </div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#ffffff', fontWeight: 900, letterSpacing: '-0.02em' }}>
            Tham Gia Phòng Đấu
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0.5rem 0 0 0' }}>
            Nhập mã phòng và biệt danh của bạn để tranh tài kiến thức trực tiếp cùng mọi người!
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.45rem', color: '#cbd5e1', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              MÃ PHÒNG (6 KÝ TỰ)
            </label>
            <input
              type="text"
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="VD: ABC123"
              required
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid #334155',
                backgroundColor: '#090d16',
                color: '#38bdf8',
                fontSize: '1.4rem',
                fontWeight: 900,
                textAlign: 'center',
                letterSpacing: '0.15em',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.45rem', color: '#cbd5e1', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid #334155',
                backgroundColor: '#090d16',
                color: '#ffffff',
                fontSize: '1.05rem',
                fontWeight: 600,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '0.85rem',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1.05rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
              transition: 'background-color 0.15s ease',
            }}
          >
            Vào phòng chơi &rarr;
          </button>
        </form>
      </div>
    </div>
  );
};

