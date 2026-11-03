import React, { useState, useEffect } from 'react';
import type { GameSpecification } from '../types/index.js';
import {
  fetchExamBatchQrApi,
  fetchGameQr,
  publishGame,
  type ExamBatchQrApiResult,
} from '../services/api.js';
import { useToast } from '../components/ToastContext.js';
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  GamepadIcon,
  QrCodeIcon,
  SpinnerIcon,
} from '../components/Icons.js';

export interface ExamBatchQRContext {
  gameId: string;
  gameTitle: string;
  batchId: string;
  batchNumber: number;
  batchName: string;
  status: 'OPEN' | 'CLOSED';
  pin?: string | null;
  expiredPin?: string | null;
  pinStatus?: 'ACTIVE' | 'EXPIRED' | 'NONE';
}

interface SoloPresentationPageProps {
  gameSpec: GameSpecification | null;
  gameId?: string;
  onStartPlay?: (spec: GameSpecification) => void;
  onBack: () => void;
  examBatchContext?: ExamBatchQRContext | null;
}

export const SoloPresentationPage: React.FC<SoloPresentationPageProps> = ({
  gameSpec,
  gameId,
  onBack,
  examBatchContext,
}) => {
  const toast = useToast();
  const effectiveGameId = examBatchContext?.gameId || gameSpec?.gameId || gameId || '';

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [playUrl, setPlayUrl] = useState<string>('');
  const [batchQrData, setBatchQrData] = useState<ExamBatchQrApiResult | null>(null);
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
        if (examBatchContext?.batchId) {
          const data = await fetchExamBatchQrApi(effectiveGameId, examBatchContext.batchId);
          if (isMounted) {
            setBatchQrData(data);
            setQrDataUrl(data.qrDataUrl);
            setPlayUrl(
              data.joinUrl ||
                data.playUrl ||
                `${window.location.origin}/?play=${effectiveGameId}&batch=${encodeURIComponent(examBatchContext.batchId)}`
            );
          }
          return;
        }

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
          setBatchQrData(null);
          setQrDataUrl(data.qrDataUrl);
          setPlayUrl(data.playUrl || `${window.location.origin}/?play=${effectiveGameId}`);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Không thể tạo mã QR cho trò chơi.');
          setPlayUrl(
            examBatchContext?.batchId
              ? `${window.location.origin}/?play=${effectiveGameId}&batch=${encodeURIComponent(examBatchContext.batchId)}`
              : `${window.location.origin}/?play=${effectiveGameId}`
          );
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
  }, [effectiveGameId, gameSpec, examBatchContext?.batchId]);

  const effectiveBatchStatus = batchQrData?.status || examBatchContext?.status || 'OPEN';
  const effectiveBatchName = batchQrData?.batchName || examBatchContext?.batchName || '';
  const effectiveActivePin =
    batchQrData?.pinStatus === 'ACTIVE'
      ? batchQrData.pin
      : examBatchContext?.pinStatus === 'ACTIVE'
        ? examBatchContext.pin
        : null;
  const effectiveExpiredPin =
    batchQrData?.pinStatus === 'EXPIRED'
      ? batchQrData.expiredPin
      : examBatchContext?.pinStatus === 'EXPIRED'
        ? examBatchContext.expiredPin
        : null;

  const handleCopyLink = () => {
    if (!playUrl) return;
    navigator.clipboard.writeText(playUrl);
    setCopied(true);
    toast.success('Đã sao chép liên kết vào clipboard!', 'Đã chép link');
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
          data-testid="exam-batch-qr-close-btn"
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
          <ArrowLeftIcon size={16} /> {examBatchContext ? 'Đóng QR' : 'Quay lại'}
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
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginBottom: '0.75rem',
          }}
        >
          <div
            data-testid="exam-batch-qr-badge"
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
            }}
          >
            <GamepadIcon size={14} />{' '}
            {examBatchContext ? `THI / KIỂM TRA — ${effectiveBatchName}` : 'CHƠI ĐƠN'}
          </div>
          {examBatchContext && (
            <span
              data-testid="exam-batch-qr-status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.85rem',
                borderRadius: '20px',
                fontSize: '0.8rem',
                fontWeight: 800,
                backgroundColor:
                  effectiveBatchStatus === 'OPEN'
                    ? 'var(--accent-emerald-subtle)'
                    : 'rgba(244, 63, 94, 0.14)',
                color:
                  effectiveBatchStatus === 'OPEN'
                    ? 'var(--accent-emerald)'
                    : 'var(--accent-rose)',
                border:
                  effectiveBatchStatus === 'OPEN'
                    ? '1px solid var(--accent-emerald)'
                    : '1px solid var(--accent-rose)',
              }}
            >
              Trạng thái: {effectiveBatchStatus === 'OPEN' ? 'Đang mở' : 'Đã đóng'}
            </span>
          )}
        </div>

        <h1
          data-testid="exam-batch-qr-title"
          style={{
            color: 'var(--text-primary)',
            fontSize: 'clamp(1.75rem, 4vw, 2.6rem)',
            fontWeight: 900,
            margin: '0 0 0.5rem 0',
            letterSpacing: '-0.02em',
          }}
        >
          {batchQrData?.title ||
            examBatchContext?.gameTitle ||
            gameSpec?.title ||
            'Trò Chơi Trắc Nghiệm'}
        </h1>

        {examBatchContext && (
          <div
            data-testid="exam-batch-qr-batch-name"
            style={{
              color: 'var(--text-secondary)',
              fontSize: '1.05rem',
              fontWeight: 800,
              marginBottom: '1.25rem',
            }}
          >
            Mã QR riêng của {effectiveBatchName}
          </div>
        )}

        {examBatchContext && effectiveBatchStatus === 'CLOSED' && (
          <div
            data-testid="exam-batch-qr-closed-notice"
            style={{
              padding: '0.85rem 1.15rem',
              backgroundColor: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '12px',
              color: 'var(--accent-rose)',
              fontWeight: 700,
              fontSize: '0.88rem',
              maxWidth: '680px',
              margin: '0 auto 1.25rem auto',
            }}
          >
            Đợt thi này đang ở trạng thái Đã đóng. Thí sinh quét mã QR hoặc mở liên kết sẽ không thể bắt đầu lượt thi mới cho đến khi Ban Tổ Chức mở lại đợt thi.
          </div>
        )}

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
                  data-testid="exam-batch-qr-image"
                  src={qrDataUrl}
                  alt={examBatchContext ? `Mã QR ${effectiveBatchName}` : 'Mã QR Chơi Đơn'}
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
                <span>
                  {examBatchContext ? `Quét mã để vào ${effectiveBatchName}` : 'Quét mã để chơi'}
                </span>
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
              {examBatchContext && effectiveActivePin && (
                <div
                  data-testid="exam-batch-qr-active-pin"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    padding: '1rem 1.25rem',
                    borderRadius: '16px',
                    border: '1px solid var(--accent-emerald)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.84rem',
                      fontWeight: 800,
                    }}
                  >
                    MÃ PIN PHÒNG THI:
                  </span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '1.3rem',
                      fontWeight: 900,
                      letterSpacing: '0.1em',
                      color: 'var(--accent-emerald)',
                    }}
                  >
                    {effectiveActivePin}
                  </span>
                </div>
              )}

              {examBatchContext && !effectiveActivePin && effectiveExpiredPin && (
                <div
                  data-testid="exam-batch-qr-expired-pin-notice"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    padding: '0.9rem 1.15rem',
                    borderRadius: '14px',
                    border: '1px dashed var(--border-strong)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                  }}
                >
                  Mã PIN phòng cũ đã hết hiệu lực khi đợt thi đóng. Bấm &ldquo;Mở lại đợt thi&rdquo; trong Reports để cấp mã PIN mới cho đợt này.
                </div>
              )}

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
                    {examBatchContext ? 'Liên kết tham gia đợt thi:' : 'Liên kết chơi:'}
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
                    data-testid="exam-batch-qr-join-url"
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
                  data-testid="exam-batch-qr-copy-btn"
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
