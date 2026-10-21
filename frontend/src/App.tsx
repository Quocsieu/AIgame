import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/ToastContext.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { DemoPage } from './pages/DemoPage.js';
import { HostPage } from './pages/HostPage.js';
import { JoinPage } from './pages/JoinPage.js';
import { PlayPage } from './pages/PlayPage.js';
import { fetchGameById, getOrCreateGuestToken, setStoredAuthToken } from './services/api.js';
import type { GameSpecification } from './types/index.js';

type Tab = 'demo' | 'analytics' | 'host' | 'join' | 'play';

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('demo');
  const [roomCode, setRoomCode] = useState('');
  const [hostToken, setHostToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedSavedSpec, setSelectedSavedSpec] = useState<GameSpecification | null>(null);
  const [autoStartSoloPlay, setAutoStartSoloPlay] = useState(false);
  const [soloPlayLoading, setSoloPlayLoading] = useState(false);
  const [soloPlayError, setSoloPlayError] = useState<string | null>(null);

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

  useEffect(() => {
    // Ensure guest mode token is initialized and no legacy login session overrides guest scope
    setStoredAuthToken(null);
    getOrCreateGuestToken();
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const playGameId = (params.get('play') || '').trim();
    const room = (params.get('room') || '').toUpperCase().trim();
    const token = (params.get('token') || '').trim();
    const name = (params.get('name') || '').trim();
    const tab = params.get('tab') as Tab;

    if (playGameId) {
      setSoloPlayLoading(true);
      setSoloPlayError(null);
      fetchGameById(playGameId, { mode: 'public' })
        .then((spec) => {
          setSelectedSavedSpec(spec);
          setAutoStartSoloPlay(true);
          setActiveTab('demo');
        })
        .catch((err: any) => {
          setSoloPlayError(
            err.message ||
              'Bộ câu hỏi này không tồn tại hoặc chưa được xuất bản để chơi công khai.'
          );
        })
        .finally(() => {
          setSoloPlayLoading(false);
        });
      return;
    }

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
    } else if (tab && ['demo', 'analytics', 'host', 'join', 'play'].includes(tab)) {
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

  const handleSelectSavedGame = (spec: GameSpecification, startSolo: boolean = false) => {
    setSoloPlayError(null);
    setSelectedSavedSpec(spec);
    setAutoStartSoloPlay(startSolo);
    setActiveTab('demo');
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
          onClick={() => {
            setSoloPlayError(null);
            setAutoStartSoloPlay(false);
            setActiveTab('demo');
          }}
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
              onClick={() => {
                setSoloPlayError(null);
                setAutoStartSoloPlay(false);
                setActiveTab('demo');
              }}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === 'demo' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'demo' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'demo' ? 'var(--btn-shadow)' : 'none',
              }}
            >
              📋 Tạo Game
            </button>

            <button
              type="button"
              onClick={() => {
                setSoloPlayError(null);
                setActiveTab('analytics');
              }}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === 'analytics' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'analytics' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'analytics' ? 'var(--btn-shadow)' : 'none',
              }}
            >
              📚 Kho Game
            </button>

            <button
              type="button"
              onClick={() => {
                setSoloPlayError(null);
                setActiveTab(roomCode && displayName ? 'play' : 'join');
              }}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === 'join' || activeTab === 'play' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'join' || activeTab === 'play' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'join' || activeTab === 'play' ? 'var(--btn-shadow)' : 'none',
              }}
            >
              🎮 Người Chơi
            </button>
          </div>
        </div>
      </nav>

      {/* Nội dung chính theo tab */}
      <main style={{ flex: 1, padding: '1.25rem' }}>
        {soloPlayLoading && (
          <div
            style={{
              maxWidth: '520px',
              margin: '3rem auto',
              padding: '2rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              textAlign: 'center',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ fontSize: '2.2rem', marginBottom: '0.6rem' }}>⏳</div>
            <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1.2rem', fontWeight: 900 }}>
              Đang tải trò chơi...
            </h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Hệ thống đang khởi tạo phiên chơi đơn của bạn.
            </p>
          </div>
        )}

        {!soloPlayLoading && soloPlayError && (
          <div
            style={{
              maxWidth: '540px',
              margin: '3rem auto',
              padding: '2rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--accent-rose)',
              textAlign: 'center',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '0.6rem' }}>⚠️</div>
            <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-rose)' }}>
              Không thể mở trò chơi này
            </h2>
            <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
              {soloPlayError}
            </p>
            <button
              type="button"
              onClick={() => {
                setSoloPlayError(null);
                window.history.replaceState({}, '', window.location.pathname);
                setActiveTab('demo');
              }}
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                padding: '0.65rem 1.25rem',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              Về trang chủ
            </button>
          </div>
        )}

        {!soloPlayLoading && !soloPlayError && (
          <>
            {activeTab === 'demo' && (
              <DemoPage
                onNavigateToHost={handleNavigateToHost}
                onNavigateToPlay={handleNavigateToPlayFromDemo}
                initialSpec={selectedSavedSpec}
                autoStartSoloPlay={autoStartSoloPlay}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsPage
                onSelectSavedGame={handleSelectSavedGame}
                onNavigateToHost={handleNavigateToHost}
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
          </>
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
