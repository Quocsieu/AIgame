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

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('app_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('app_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

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
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-body)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'background-color 0.2s ease, color 0.2s ease',
      }}
    >
      {/* Thanh điều hướng chính */}
      <nav
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.85rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          boxShadow: 'var(--card-shadow)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => setActiveTab('demo')}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb, #38bdf8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
              boxShadow: '0 4px 14px var(--primary-glow)',
              color: '#ffffff',
            }}
          >
            ⚡
          </div>
          <div>
            <div
              style={{
                fontWeight: 900,
                fontSize: '1.25rem',
                letterSpacing: '-0.02em',
              }}
            >
              AI GAME PLATFORM
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          {/* Nút chuyển đổi Theme */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              transition: 'all 0.15s ease',
            }}
          >
            {theme === 'dark' ? '☀️ Sáng' : '🌙 Tối'}
          </button>

          {/* Nhóm tab điều hướng */}
          <div
            style={{
              display: 'flex',
              gap: '0.35rem',
              backgroundColor: 'var(--bg-input)',
              padding: '0.25rem',
              borderRadius: '10px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('demo')}
              style={{
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === 'demo' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'demo' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'demo' ? 'var(--btn-shadow)' : 'none',
              }}
            >
              📋 Tạo Game (Demo)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab(roomCode && displayName ? 'play' : 'join')}
              style={{
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === 'join' || activeTab === 'play' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'join' || activeTab === 'play' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'join' || activeTab === 'play' ? 'var(--btn-shadow)' : 'none',
              }}
            >
              🎮 Người Chơi (Player)
            </button>
          </div>
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
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '1.25rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.825rem',
          backgroundColor: 'var(--bg-surface)',
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
        }}
      >
        Nội dung AI &rarr; Bộ câu hỏi &rarr; Đấu trường trực tiếp thời gian thực &copy; 2026
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

