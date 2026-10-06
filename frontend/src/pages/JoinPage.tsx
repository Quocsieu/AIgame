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
      <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '420px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}>
        <h1 style={{ marginTop: 0, fontSize: '1.75rem', textAlign: 'center', color: '#38bdf8', fontWeight: 800 }}>
          🎮 Tham Gia Trò Chơi
        </h1>
        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          Nhập mã phòng và biệt danh để tranh tài trực tiếp cùng bạn bè!
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', color: '#cbd5e1', fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase' }}>
              MÃ PHÒNG
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
                padding: '0.75rem',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: 'white',
                fontSize: '1.25rem',
                fontWeight: 700,
                textAlign: 'center',
                letterSpacing: '3px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.4rem', color: '#cbd5e1', fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase' }}>
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
                padding: '0.75rem',
                borderRadius: '6px',
                border: '1px solid #475569',
                backgroundColor: '#0f172a',
                color: 'white',
                fontSize: '1.1rem',
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
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '1.1rem',
              fontWeight: 700,
              cursor: 'pointer',
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

