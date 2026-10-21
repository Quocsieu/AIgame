import React, { useState, useEffect } from 'react';
import { GamePasswordModal } from './components/GamePasswordModal.js';
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
import { fetchCurrentUser, fetchGameById } from './services/api.js';
import type { AuthenticatedUser, GameSpecification, GameType } from './types/index.js';

type Tab = 'home' | 'demo' | 'analytics' | 'host' | 'join' | 'play' | 'admin';

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
  const [autoStartSoloPlay, setAutoStartSoloPlay] = useState(false);
  const [soloPlayLoading, setSoloPlayLoading] = useState(false);
  const [soloPlayError, setSoloPlayError] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [protectedGameId, setProtectedGameId] = useState('');
  const [protectedGameTitle, setProtectedGameTitle] = useState('');

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
      ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'CROSSWORD', 'MIXED'].includes(
        typeParam
      )
    ) {
      setSelectedGameType(typeParam);
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
        if (spec.passwordProtected && (!spec.questions || spec.questions.length === 0)) {
          setProtectedGameId(gameId);
          setProtectedGameTitle(spec.title);
          setAutoStartSoloPlay(true);
          setIsPasswordModalOpen(true);
        } else {
          setSoloGameId(gameId);
          setSoloGameSpec(spec);
          window.history.replaceState({}, '', `/?play=${gameId}`);
          setActiveTab('play');
        }
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
      sessionStorage.removeItem('active_player_room');
      sessionStorage.removeItem('active_player_name');
      window.history.replaceState({}, '', '/?tab=join');
    } catch {}
    setDisplayName('');
    setActiveTab('join');
  };

  const handleSelectSavedGame = (spec: GameSpecification, startSolo: boolean = false) => {
    setSoloPlayError(null);
    if (spec.passwordProtected && (!spec.questions || spec.questions.length === 0)) {
      setProtectedGameId(spec.gameId);
      setProtectedGameTitle(spec.title);
      setAutoStartSoloPlay(startSolo);
      setIsPasswordModalOpen(true);
      return;
    }
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

  const handlePasswordVerified = async () => {
    if (!protectedGameId) return;
    setSoloPlayLoading(true);
    try {
      const fullSpec = await fetchGameById(protectedGameId, { mode: 'public' });
      if (autoStartSoloPlay) {
        setSoloGameId(protectedGameId);
        setSoloGameSpec(fullSpec);
        window.history.replaceState({}, '', `/?play=${protectedGameId}`);
        setActiveTab('play');
      } else {
        setSelectedSavedSpec(fullSpec);
        window.history.replaceState({}, '', '/?tab=demo');
        setActiveTab('demo');
      }
    } catch (err: any) {
      setSoloPlayError(err.message || 'Không thể tải câu hỏi sau khi xác thực mật khẩu.');
    } finally {
      setSoloPlayLoading(false);
    }
  };

  const handleLeaveSoloPlay = () => {
    setSoloGameId(null);
    setSoloGameSpec(null);
    window.history.replaceState({}, '', '/');
    setActiveTab('home');
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
    { id: 'join' as Tab, label: 'Nhập PIN', icon: <GamepadIcon size={17} /> },
  ];

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
      {/* 1. TOP NAVBAR (Sticky Kahoot-Style App Header) */}
      <nav
        aria-label="Điều hướng chính"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.65rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          boxShadow: 'var(--shadow-sm)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* Brand Logo & Title */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Về trang chủ"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            cursor: 'pointer',
            userSelect: 'none',
          }}
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
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent-sky) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: 'var(--btn-shadow)',
              flexShrink: 0,
            }}
          >
            <SparklesIcon size={20} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
            <span
              style={{
                fontWeight: 900,
                fontSize: '1.18rem',
                letterSpacing: '-0.03em',
                color: 'var(--text-primary)',
              }}
            >
              AI GAME
            </span>
            <span
              style={{
                fontWeight: 800,
                fontSize: '0.78rem',
                letterSpacing: '0.08em',
                color: 'var(--primary)',
                textTransform: 'uppercase',
              }}
            >
              SHOW
            </span>
          </div>
        </div>

        {/* Desktop Navigation Links (>= 768px) */}
        {!autoStartSoloPlay && (
          <div
            role="tablist"
            aria-label="Các trang chính"
            className="desktop-nav"
            style={{
              display: 'flex',
              gap: '0.3rem',
              backgroundColor: 'var(--bg-input)',
              padding: '0.25rem',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {navItems.map((item) => {
              const isSelected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={isSelected}
                  type="button"
                  onClick={() => {
                    setSoloPlayError(null);
                    setAutoStartSoloPlay(false);
                    window.history.replaceState({}, '', `/?tab=${item.id}`);
                    setActiveTab(item.id);
                  }}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: isSelected ? 'var(--primary)' : 'transparent',
                    color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 800 : 700,
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: isSelected ? 'var(--btn-shadow)' : 'none',
                    minHeight: '38px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Solo Play Exit Banner */}
        {autoStartSoloPlay && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 800,
                padding: '0.35rem 0.75rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                color: '#0ea5e9',
                border: '1px solid #0ea5e9',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <GamepadIcon size={16} />
              <span>Chế Độ Chơi Đơn</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setAutoStartSoloPlay(false);
                setSelectedSavedSpec(null);
                setSoloPlayError(null);
                window.history.replaceState({}, '', '/');
                setActiveTab('home');
              }}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                minHeight: '38px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <XMarkIcon size={14} />
              <span>Thoát</span>
            </button>
          </div>
        )}

        {/* Right Section: Theme Toggle & Admin Link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Nút chuyển đổi Theme (Sáng / Tối) */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            title={theme === 'dark' ? 'Giao diện Sáng' : 'Giao diện Tối'}
            style={{
              padding: '0.5rem',
              borderRadius: '10px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '40px',
              minHeight: '40px',
            }}
          >
            {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>

          {/* Nút tắt Quản trị Admin */}
          {activeTab !== 'admin' && (
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, '', '/?tab=admin');
                setActiveTab('admin');
              }}
              aria-label="Bảng điều khiển Quản trị viên"
              title="Quản trị hệ thống (Admin Panel)"
              style={{
                padding: '0.5rem',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '40px',
                minHeight: '40px',
              }}
            >
              <ShieldIcon size={18} />
            </button>
          )}
        </div>
      </nav>

      {/* 2. MAIN CONTENT AREA */}
      <main style={{ flex: 1, paddingBottom: '4rem' }}>
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

      {/* 3. MOBILE BOTTOM NAVIGATION (Kahoot-style Mobile Bar for screens < 768px) */}
      {!autoStartSoloPlay && activeTab !== 'play' && (
        <nav
          aria-label="Điều hướng di động"
          className="mobile-bottom-nav"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-subtle)',
            padding: '0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0px))',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            zIndex: 90,
            boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.08)',
            backdropFilter: 'blur(10px)',
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
                  border: 'none',
                  backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  borderRadius: '8px',
                  color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: '0.72rem',
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

      {/* 4. MODAL BẢO VỆ MẬT KHẨU BỘ CÂU HỎI */}
      <GamePasswordModal
        isOpen={isPasswordModalOpen}
        gameId={protectedGameId}
        gameTitle={protectedGameTitle}
        onClose={() => {
          setIsPasswordModalOpen(false);
          setProtectedGameId('');
          setProtectedGameTitle('');
          setAutoStartSoloPlay(false);
        }}
        onSuccess={() => {
          setIsPasswordModalOpen(false);
          handlePasswordVerified();
        }}
      />
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
