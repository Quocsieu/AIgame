import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/ToastContext.js';
import { DemoPage } from './pages/DemoPage.js';
import { HostPage } from './pages/HostPage.js';
import { JoinPage } from './pages/JoinPage.js';
import { PlayPage } from './pages/PlayPage.js';

type Tab = 'demo' | 'host' | 'join' | 'play';

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('demo');
  const [roomCode, setRoomCode] = useState('');
  const [hostToken, setHostToken] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = (params.get('room') || '').toUpperCase().trim();
    const token = (params.get('token') || '').trim();
    const name = (params.get('name') || '').trim();
    const tab = params.get('tab') as Tab;

    if (room && token) {
      setRoomCode(room);
      setHostToken(token);
      setActiveTab('host');
    } else if (room && name) {
      setRoomCode(room);
      setDisplayName(name);
      setActiveTab('play');
    } else if (room) {
      setRoomCode(room);
      setActiveTab('join');
    } else if (tab && ['demo', 'host', 'join', 'play'].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);

  const handleNavigateToHost = (code: string, token: string) => {
    setRoomCode(code);
    setHostToken(token);
    setActiveTab('host');
  };

  const handleNavigateToPlayFromDemo = (code: string) => {
    setRoomCode(code);
    setActiveTab('join');
  };

  const handleJoinGame = (code: string, name: string) => {
    setRoomCode(code);
    setDisplayName(name);
    setActiveTab('play');
  };

  const handleLeaveGame = () => {
    setActiveTab('join');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#090d16', color: '#f8fafc', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Thanh điều hướng chính */}
      <nav style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', padding: '0.85rem 1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', cursor: 'pointer', userSelect: 'none' }} onClick={() => setActiveTab('demo')}>
          <div style={{ width: '38px', height: '38px', borderRadius: '8px', backgroundColor: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', boxShadow: '0 0 15px rgba(37, 99, 235, 0.4)' }}>
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#ffffff', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              AI GAME PLATFORM
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
              Nền tảng thi đấu kiến thức trực tiếp nhiều người chơi
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: '#090d16', padding: '0.3rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
          <button
            type="button"
            onClick={() => setActiveTab('demo')}
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'demo' ? '#2563eb' : 'transparent',
              color: activeTab === 'demo' ? '#ffffff' : '#94a3b8',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            📋 Bảng Điều Khiển (Demo)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('host')}
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'host' ? '#2563eb' : 'transparent',
              color: activeTab === 'host' ? '#ffffff' : '#94a3b8',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            👑 Quản Trị (Host)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab(roomCode && displayName ? 'play' : 'join')}
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: (activeTab === 'join' || activeTab === 'play') ? '#2563eb' : 'transparent',
              color: (activeTab === 'join' || activeTab === 'play') ? '#ffffff' : '#94a3b8',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            🎮 Người Chơi (Player)
          </button>
        </div>
      </nav>

      {/* Nội dung chính theo tab */}
      <main style={{ flex: 1, padding: '1.25rem' }}>
        {activeTab === 'demo' && (
          <DemoPage
            onNavigateToHost={handleNavigateToHost}
            onNavigateToPlay={handleNavigateToPlayFromDemo}
          />
        )}

        {activeTab === 'host' && (
          <HostPage
            initialRoomCode={roomCode}
            initialHostToken={hostToken}
          />
        )}

        {activeTab === 'join' && (
          <JoinPage
            initialRoomCode={roomCode}
            onJoin={handleJoinGame}
          />
        )}

        {activeTab === 'play' && (
          <PlayPage
            roomCode={roomCode}
            displayName={displayName}
            onLeave={handleLeaveGame}
          />
        )}
      </main>

      {/* Chân trang */}
      <footer style={{ borderTop: '1px solid #1e293b', padding: '1.25rem', textAlign: 'center', color: '#64748b', fontSize: '0.825rem', backgroundColor: '#090d16' }}>
        AI Content &rarr; Question &rarr; Realtime Multiplayer Game Engine &copy; 2026
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};
export default App;

