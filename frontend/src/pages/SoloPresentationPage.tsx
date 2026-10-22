import React, { useState, useEffect } from 'react';
import type { GameSpecification } from '../types/index.js';
import { fetchGameQr, publishGame } from '../services/api.js';
import { useToast } from '../components/ToastContext.js';
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  GamepadIcon,
  PlayIcon,
  QrCodeIcon,
  SpinnerIcon,
} from '../components/Icons.js';

interface SoloPresentationPageProps {
  gameSpec: GameSpecification | null;
  gameId?: string;
  onStartPlay: (spec: GameSpecification) => void;
  onBack: () => void;
}

export const SoloPresentationPage: React.FC<SoloPresentationPageProps> = ({
  gameSpec,
  gameId,
  onStartPlay,
  onBack,
}) => {
  const toast = useToast();
  const effectiveGameId = gameSpec?.gameId || gameId || '';

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [playUrl, setPlayUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isLinkVisible, setIsLinkVisible] = useState<boolean>(true);

  useEffect(() => {
    if (!effectiveGameId) {
      setError('Không tìm thấy thông tin trò chơi.');
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const loadQrAndUrl = async () => {
      setIsLoading(true);
      setError(null);
      try {
        if (gameSpec && !gameSpec.isPublic) {
          try {
            await publishGame(effectiveGameId);
            gameSpec.isPublic = true;
          } catch {
            // Ignore if already published or guest mode
          }
        }

        const data = await fetchGameQr(effectiveGameId);
        if (isMounted) {
          setQrDataUrl(data.qrDataUrl);
          setPlayUrl(data.playUrl || `${window.location.origin}/?play=${effectiveGameId}`);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Không thể tạo mã QR cho trò chơi.');
          setPlayUrl(`${window.location.origin}/?play=${effectiveGameId}`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadQrAndUrl();

    return () => {
      isMounted = false;
    };
  }, [effectiveGameId, gameSpec]);

  const handleCopyLink = () => {
    if (!playUrl) return;
    navigator.clipboard.writeText(playUrl);
    setCopied(true);
    toast.success('Đã sao chép liên kết chơi đơn vào clipboard!', 'Đã chép link');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleToggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '1.5rem 1rem 3rem 1rem',
      }}
    >
      {/* Top Bar Điều Khiển */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-strong)',
            borderRadius: '10px',
            padding: '0.65rem 1.25rem',
            fontWeight: 700,
            fontSize: '0.9rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            minHeight: '44px',
          }}
        >
          <ArrowLeftIcon size={16} /> Quay lại
        </button>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            style={{
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
              borderRadius: '10px',
              padding: '0.65rem 1.15rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            Toàn màn hình
          </button>
        </div>
      </div>

      {/* Main Presentation Box */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '2px solid var(--primary)',
          borderRadius: '24px',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          boxShadow: '0 20px 50px -10px rgba(245, 158, 11, 0.25)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            backgroundColor: 'var(--primary-subtle)',
            color: 'var(--primary)',
            padding: '0.35rem 0.85rem',
            borderRadius: '20px',
            fontSize: '0.8rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '0.75rem',
          }}
        >
          <GamepadIcon size={14} /> CHƠI ĐƠN
        </div>

        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: 'clamp(2rem, 4.5vw, 2.8rem)',
            fontWeight: 900,
            margin: '0 0 1.5rem 0',
            letterSpacing: '-0.02em',
          }}
        >
          {gameSpec?.title || 'Trò Chơi Trắc Nghiệm'}
        </h1>

        {isLoading && (
          <div style={{ padding: '3.5rem 1rem' }}>
            <SpinnerIcon size={40} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
              Đang tạo mã QR trình chiếu...
            </div>
          </div>
        )}

        {error && !isLoading && (
          <div
            style={{
              padding: '1.25rem',
              backgroundColor: 'var(--accent-rose-subtle)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '12px',
              color: 'var(--accent-rose)',
              maxWidth: '500px',
              margin: '0 auto 2rem auto',
            }}
          >
            {error}
          </div>
        )}

        {!isLoading && qrDataUrl && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '3rem',
              margin: '1.5rem 0 2.5rem 0',
            }}
          >
            {/* Cột QR Code To */}
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  display: 'inline-block',
                  padding: '16px',
                  backgroundColor: '#ffffff',
                  borderRadius: '24px',
                  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.35)',
                }}
              >
                <img
                  src={qrDataUrl}
                  alt="Mã QR Chơi Đơn"
                  style={{
                    width: 'clamp(230px, 30vw, 300px)',
                    height: 'clamp(230px, 30vw, 300px)',
                    display: 'block',
                  }}
                />
              </div>
              <div
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '1.05rem',
                  marginTop: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                }}
              >
                <QrCodeIcon size={20} style={{ color: 'var(--primary)' }} />
                <span>Quét mã để chơi</span>
              </div>
            </div>

            {/* Cột Thông Tin Đường Dẫn & Nút Mở */}
            <div
              style={{
                minWidth: '280px',
                maxWidth: '440px',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div
                style={{
                  backgroundColor: 'var(--bg-card)',
                  padding: '1.25rem',
                  borderRadius: '16px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.45rem',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Liên kết chơi:
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsLinkVisible(!isLinkVisible)}
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.2rem 0.55rem',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    {isLinkVisible ? (
                      <>
                        <EyeOffIcon size={13} />
                        <span>Ẩn link</span>
                      </>
                    ) : (
                      <>
                        <EyeIcon size={13} />
                        <span>Hiện link</span>
                      </>
                    )}
                  </button>
                </div>

                {isLinkVisible ? (
                  <div
                    style={{
                      color: 'var(--accent-sky)',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      wordBreak: 'break-all',
                      fontFamily: 'monospace',
                      backgroundColor: 'var(--bg-input)',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-strong)',
                      marginBottom: '0.75rem',
                    }}
                  >
                    {playUrl}
                  </div>
                ) : (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      fontSize: '0.84rem',
                      backgroundColor: 'var(--bg-input)',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px dashed var(--border-strong)',
                      marginBottom: '0.75rem',
                      textAlign: 'center',
                    }}
                  >
                    Liên kết đang được ẩn. Quét mã QR bên cạnh để chơi.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCopyLink}
                  style={{
                    width: '100%',
                    backgroundColor: copied ? 'var(--accent-emerald)' : 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 1rem',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                  <span>{copied ? 'Đã sao chép!' : 'Sao chép link'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
