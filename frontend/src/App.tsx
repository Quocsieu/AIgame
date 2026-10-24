import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/ToastContext.js';
import {
  AlertTriangleIcon,
  BookOpenIcon,
  GamepadIcon,
  HomeIcon,
  MoonIcon,
  ShieldIcon,
  SparklesIcon,
  SpinnerIcon,
  SunIcon,
  UsersIcon,
  XMarkIcon,
} from './components/Icons.js';
import { AdminPage } from './pages/AdminPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { DemoPage } from './pages/DemoPage.js';
import { HomePage } from './pages/HomePage.js';
import { HostPage } from './pages/HostPage.js';
import { JoinPage } from './pages/JoinPage.js';
import { PlayPage } from './pages/PlayPage.js';
import { SoloPlayer } from './components/SoloPlayer.js';
import { SoloPresentationPage } from './pages/SoloPresentationPage.js';
import { fetchCurrentUser, fetchGameById } from './services/api.js';
import type { AuthenticatedUser, GameSpecification, GameType } from './types/index.js';

type Tab = 'home' | 'demo' | 'analytics' | 'host' | 'join' | 'play' | 'admin' | 'solo-present';

export const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [selectedGameType, setSelectedGameType] = useState<GameType>('MULTIPLE_CHOICE');
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);

  const [roomCode, setRoomCode] = useState('');
  const [hostToken, setHostToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedSavedSpec, setSelectedSavedSpec] = useState<GameSpecification | null>(null);
  const [soloGameId, setSoloGameId] = useState<string | null>(null);
  const [soloGameSpec, setSoloGameSpec] = useState<GameSpecification | null>(null);
  const [soloPlayLoading, setSoloPlayLoading] = useState(false);
  const [soloPlayError, setSoloPlayError] = useState<string | null>(null);
  const [autoStartSoloPlay, setAutoStartSoloPlay] = useState(false);

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
    // Check current user session for admin or role display
    fetchCurrentUser()
      .then((res) => {
        if (res?.user) {
          setCurrentUser(res.user);
        }
      })
      .catch(() => {
        setCurrentUser(null);
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const playGameId = (params.get('play') || '').trim();
    let room = (params.get('room') || '').toUpperCase().trim();
    let token = (params.get('token') || '').trim();
    let name = (params.get('name') || '').trim();
    const tab = params.get('tab') as Tab;
    const typeParam = params.get('type') as GameType;

    if (
      typeParam &&
      ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'CROSSWORD', 'MIXED', 'ADVENTURE'].includes(
        typeParam
      )
    ) {
      setSelectedGameType(typeParam);
    }

    const soloPresentGameId = (params.get('gameId') || '').trim();
    if (tab === 'solo-present' && (soloPresentGameId || playGameId)) {
      const gid = soloPresentGameId || playGameId;
      setSoloGameId(gid);
      fetchGameById(gid, { mode: 'manage' })
        .then((spec) => {
          setSoloGameSpec(spec);
          setActiveTab('solo-present');
        })
        .catch(() => {
          setActiveTab('analytics');
        });
      return;
    }

    if (playGameId) {
      handleLoadGameForSoloPlay(playGameId);
      return;
    }

    // F5 Session Recovery: Check sessionStorage if URL parameters are incomplete
    if (!token && (tab === 'host' || !tab)) {
      const storedToken = (sessionStorage.getItem('active_host_token') || '').trim();
      const storedRoom = (sessionStorage.getItem('active_host_room') || '').trim();
      if (storedToken && storedRoom) {
        token = storedToken;
        room = room || storedRoom;
      }
    }

    if (!name && (tab === 'play' || room)) {
      const storedName =
        sessionStorage.getItem(`name_${room}`) ||
        sessionStorage.getItem('active_player_name') ||
        '';
      if (storedName.trim()) {
        name = storedName.trim();
      }
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
    } else if (tab && ['home', 'demo', 'analytics', 'join', 'play', 'admin'].includes(tab)) {
      setActiveTab(tab);
    } else if (tab === 'host') {
      // Direct ?tab=host without active room/token redirects to Kho Game
      setActiveTab('analytics');
    } else if (window.location.pathname.startsWith('/admin')) {
      setActiveTab('admin');
    } else {
      setActiveTab('home');
    }
  }, []);

  const handleLoadGameForSoloPlay = (gameId: string) => {
    setSoloPlayLoading(true);
    setSoloPlayError(null);
    fetchGameById(gameId, { mode: 'public' })
      .then((spec) => {
        setSoloGameId(gameId);
        setSoloGameSpec(spec);
        window.history.replaceState({}, '', `/?play=${gameId}`);
        setActiveTab('play');
      })
      .catch((err: any) => {
        setSoloPlayError(
          err.message || 'Bộ câu hỏi này không tồn tại hoặc chưa được xuất bản để chơi công khai.'
        );
      })
      .finally(() => {
        setSoloPlayLoading(false);
      });
  };

  const handleNavigateToHost = (code: string, token: string) => {
    setRoomCode(code);
    setHostToken(token);
    try {
      sessionStorage.setItem('active_host_room', code);
      sessionStorage.setItem('active_host_token', token);
      window.history.replaceState(
        {},
        '',
        `/?tab=host&room=${code}&token=${encodeURIComponent(token)}`
      );
    } catch {}
    setActiveTab('host');
  };

  const handleNavigateToSoloPresentation = (spec: GameSpecification) => {
    setSoloGameId(spec.gameId);
    setSoloGameSpec(spec);
    window.history.replaceState({}, '', `/?tab=solo-present&gameId=${spec.gameId}`);
    setActiveTab('solo-present');
  };

  const handleNavigateToPlayFromDemo = (code: string) => {
    setRoomCode(code);
    setActiveTab('join');
  };

  const handleJoinGame = (code: string, name: string) => {
    setRoomCode(code);
    setDisplayName(name);
    try {
      sessionStorage.setItem('active_player_room', code);
      sessionStorage.setItem('active_player_name', name);
      sessionStorage.setItem(`name_${code}`, name);
      window.history.replaceState(
        {},
        '',
        `/?tab=play&room=${code}&name=${encodeURIComponent(name)}`
      );
    } catch {}
    setActiveTab('play');
  };

  const handleLeaveGame = () => {
    try {
      const currentRoom = roomCode;
      if (currentRoom) {
        sessionStorage.removeItem(`token_${currentRoom}`);
        sessionStorage.removeItem(`name_${currentRoom}`);
        sessionStorage.removeItem(`room_game_password_${currentRoom}`);
      }
      sessionStorage.removeItem('active_player_room');
      sessionStorage.removeItem('active_player_name');
      window.history.replaceState({}, '', '/?tab=join');
    } catch {}
    setRoomCode('');
    setDisplayName('');
    setActiveTab('join');
  };

  const handleSelectSavedGame = (spec: GameSpecification, startSolo: boolean = false) => {
    setSoloPlayError(null);
    if (startSolo) {
      setSoloGameId(spec.gameId);
      setSoloGameSpec(spec);
      window.history.replaceState({}, '', `/?play=${spec.gameId}`);
      setActiveTab('play');
    } else {
      setSelectedSavedSpec(spec);
      window.history.replaceState({}, '', '/?tab=demo');
      setActiveTab('demo');
    }
  };

  const handleLeaveSoloPlay = () => {
    const targetGameId = soloGameId || soloGameSpec?.gameId;
    if (targetGameId) {
      try {
        sessionStorage.removeItem(`active_solo_session_${targetGameId}`);
      } catch {}
    }
    setSoloGameId(null);
    setSoloGameSpec(null);
    setRoomCode('');
    setDisplayName('');
    window.history.replaceState({}, '', '/?tab=join');
    setActiveTab('join');
  };

  const handleNavigateToCreate = (type?: GameType) => {
    if (type) {
      setSelectedGameType(type);
      window.history.replaceState({}, '', `/?tab=demo&type=${type}`);
    } else {
      window.history.replaceState({}, '', '/?tab=demo');
    }
    setActiveTab('demo');
  };

  const navItems = [
    { id: 'home' as Tab, label: 'Khám Phá', icon: <HomeIcon size={17} /> },
    { id: 'demo' as Tab, label: 'Tạo Game', icon: <SparklesIcon size={17} /> },
    { id: 'analytics' as Tab, label: 'Kho Game', icon: <BookOpenIcon size={17} /> },
    { id: 'join' as Tab, label: 'Nhập mã PIN', icon: <UsersIcon size={17} /> },
  ];

  const isPlayerMode =
    activeTab === 'play' ||
    activeTab === 'join' ||
    activeTab === 'host' ||
    activeTab === 'solo-present' ||
    autoStartSoloPlay;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-body)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* FIXED LEFT-SIDE NAVIGATION (the9bit Cyber Dock for Management Pages on Desktop >= 768px) */}
      {!isPlayerMode && (
        <aside
          aria-label="Điều hướng hệ thống"
          className="app-layout-left-nav"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: '220px',
            backgroundColor: 'var(--bg-surface)',
            borderRight: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '1.5rem 1rem',
            zIndex: 100,
            boxSizing: 'border-box',
          }}
        >
          {/* Top: Brand Header & Main Nav Tabs */}
          <div>
            <div
              role="button"
              tabIndex={0}
              aria-label="Về trang chủ"
              onClick={() => {
                setSoloPlayError(null);
                setAutoStartSoloPlay(false);
                window.history.replaceState({}, '', '/');
                setActiveTab('home');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSoloPlayError(null);
                  setAutoStartSoloPlay(false);
                  window.history.replaceState({}, '', '/');
                  setActiveTab('home');
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                cursor: 'pointer',
                marginBottom: '2rem',
                padding: '0.25rem 0.5rem',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)',
                  flexShrink: 0,
                }}
              >
                <SparklesIcon size={18} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: '1rem',
                    letterSpacing: '-0.02em',
                    color: 'var(--text-primary)',
                    lineHeight: 1.1,
                  }}
                >
                  AI Tạo Game
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                </div>
              </div>
            </div>

            {/* Vertical Tab Navigation */}
            <nav
              aria-label="Các trang chính"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}
            >
              {navItems.map((item) => {
                const isSelected = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSoloPlayError(null);
                      setAutoStartSoloPlay(false);
                      window.history.replaceState({}, '', `/?tab=${item.id}`);
                      setActiveTab(item.id);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '10px',
                      border: 'none',
                      backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                      color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                      fontWeight: isSelected ? 800 : 600,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s ease',
                      minHeight: '40px',
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom: Theme Toggle & Admin Settings */}
          <div
            style={{
              paddingTop: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 700,
                width: '100%',
              }}
            >
              {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              <span>{theme === 'dark' ? 'Giao diện Sáng' : 'Giao diện Tối'}</span>
            </button>
          </div>
        </aside>
      )}

      {/* MAIN CONTENT AREA */}
      <main
        className={isPlayerMode ? '' : 'app-main-content-with-nav'}
        style={{ flex: 1 }}
      >
        {soloPlayLoading && (
          <div
            role="status"
            aria-live="polite"
            style={{
              maxWidth: '520px',
              margin: '3rem auto',
              padding: '2.5rem 2rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              textAlign: 'center',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div style={{ color: 'var(--primary)', marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
              <SpinnerIcon size={36} />
            </div>
            <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1.25rem', fontWeight: 800 }}>
              Đang tải trò chơi...
            </h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Hệ thống đang khởi tạo phiên chơi đơn của bạn.
            </p>
          </div>
        )}

        {!soloPlayLoading && soloPlayError && (
          <div
            role="alert"
            style={{
              maxWidth: '540px',
              margin: '3rem auto',
              padding: '2.5rem 2rem',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--accent-rose)',
              textAlign: 'center',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div style={{ color: 'var(--accent-rose)', marginBottom: '0.85rem', display: 'flex', justifyContent: 'center' }}>
              <AlertTriangleIcon size={40} />
            </div>
            <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-rose)' }}>
              Không thể mở trò chơi này
            </h2>
            <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>
              {soloPlayError}
            </p>
            <button
              type="button"
              onClick={() => {
                setSoloPlayError(null);
                window.history.replaceState({}, '', '/');
                setActiveTab('home');
              }}
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                padding: '0.75rem 1.5rem',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                minHeight: '44px',
              }}
            >
              Về trang chủ
            </button>
          </div>
        )}

        {!soloPlayLoading && !soloPlayError && (
          <>
            {activeTab === 'home' && (
              <HomePage
                onNavigateToCreate={handleNavigateToCreate}
                onNavigateToLibrary={() => {
                  window.history.replaceState({}, '', '/?tab=analytics');
                  setActiveTab('analytics');
                }}
                onNavigateToHost={() => {
                  window.history.replaceState({}, '', '/?tab=host');
                  setActiveTab('host');
                }}
                onNavigateToAdmin={() => {
                  window.history.replaceState({}, '', '/?tab=admin');
                  setActiveTab('admin');
                }}
                onNavigateToJoin={() => {
                  window.history.replaceState({}, '', '/?tab=join');
                  setActiveTab('join');
                }}
              />
            )}

            {activeTab === 'demo' && (
              <DemoPage
                onNavigateToHost={handleNavigateToHost}
                onNavigateToPlay={handleNavigateToPlayFromDemo}
                onNavigateToSoloPlay={(spec) => {
                  setSoloGameId(spec.gameId);
                  setSoloGameSpec(spec);
                  window.history.replaceState({}, '', `/?play=${spec.gameId}`);
                  setActiveTab('play');
                }}
                onNavigateToSoloPresentation={handleNavigateToSoloPresentation}
                initialSpec={selectedSavedSpec}
                initialGameType={selectedGameType}
                onNavigateToLibrary={() => {
                  window.history.replaceState({}, '', '/?tab=analytics');
                  setActiveTab('analytics');
                }}
                onBackToHome={() => {
                  window.history.replaceState({}, '', '/');
                  setActiveTab('home');
                }}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsPage
                onSelectSavedGame={handleSelectSavedGame}
                onNavigateToHost={handleNavigateToHost}
                onNavigateToSoloPresentation={handleNavigateToSoloPresentation}
              />
            )}

            {activeTab === 'host' && (
              <HostPage
                initialRoomCode={roomCode}
                initialHostToken={hostToken}
                onBackToSetup={() => {
                  setRoomCode('');
                  setHostToken('');
                  try {
                    sessionStorage.removeItem('active_host_room');
                    sessionStorage.removeItem('active_host_token');
                  } catch {}
                  window.history.replaceState({}, '', '/?tab=analytics');
                  setActiveTab('analytics');
                }}
              />
            )}

            {activeTab === 'join' && (
              <JoinPage
                initialRoomCode={roomCode}
                onJoin={handleJoinGame}
              />
            )}

            {activeTab === 'play' && (
              soloGameId ? (
                <SoloPlayer
                  gameId={soloGameId}
                  initialSpec={soloGameSpec}
                  onLeave={handleLeaveSoloPlay}
                />
              ) : (
                <PlayPage
                  roomCode={roomCode}
                  displayName={displayName}
                  onLeave={handleLeaveGame}
                />
              )
            )}

            {activeTab === 'solo-present' && (
              <SoloPresentationPage
                gameSpec={soloGameSpec}
                gameId={soloGameId || undefined}
                onStartPlay={(spec) => {
                  setSoloGameId(spec.gameId);
                  setSoloGameSpec(spec);
                  window.history.replaceState({}, '', `/?play=${spec.gameId}`);
                  setActiveTab('play');
                }}
                onBack={() => {
                  window.history.replaceState({}, '', '/?tab=analytics');
                  setActiveTab('analytics');
                }}
              />
            )}

            {activeTab === 'admin' && (
              <AdminPage
                currentUser={currentUser}
                onOpenAuthModal={() => {}}
                onNavigateHome={() => {
                  window.history.replaceState({}, '', '/');
                  setActiveTab('home');
                }}
              />
            )}
          </>
        )}
      </main>

      {/* 3. MOBILE BOTTOM NAVIGATION (the9bit Cyber Dock for screens < 768px) */}
      {!isPlayerMode && (
        <nav
          aria-label="Điều hướng di động"
          className="mobile-bottom-nav"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'var(--bg-surface)',
            padding: '0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0px))',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            zIndex: 90,
          }}
        >
          {navItems.map((item) => {
            const isSelected = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSoloPlayError(null);
                  setAutoStartSoloPlay(false);
                  window.history.replaceState({}, '', `/?tab=${item.id}`);
                  setActiveTab(item.id);
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.2rem',
                  padding: '0.35rem 0.2rem',
                  border: isSelected ? '1px solid var(--border-strong)' : '1px solid transparent',
                  backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                  borderRadius: '10px',
                  color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                  fontSize: '0.74rem',
                  fontWeight: isSelected ? 800 : 600,
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
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
