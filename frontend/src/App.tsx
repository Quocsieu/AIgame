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
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* Thanh điều hướng chính */}
      <nav style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', padding: '0.75rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={() => setActiveTab('demo')}>
          <span style={{ fontSize: '1.5rem' }}>⚡</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#38bdf8' }}>AI Game Platform</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Nền tảng trò chơi kiến thức tương tác</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setActiveTab('demo')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'demo' ? '#2563eb' : '#334155',
              color: 'white',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            📋 Bảng Điều Khiển (Demo)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('host')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'host' ? '#2563eb' : '#334155',
              color: 'white',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            👑 Quản Trị (Host)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab(roomCode && displayName ? 'play' : 'join')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: (activeTab === 'join' || activeTab === 'play') ? '#2563eb' : '#334155',
              color: 'white',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            🎮 Người Chơi (Player)
          </button>
        </div>
      </nav>

      {/* Nội dung chính theo tab */}
      <main style={{ flex: 1, padding: '1rem' }}>
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
      <footer style={{ borderTop: '1px solid #334155', padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
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

