import React, { useState, useEffect, useRef } from 'react';
import { verifyGamePassword } from '../services/api.js';
import {
  AlertTriangleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  SpinnerIcon,
} from './Icons.js';

interface GamePasswordModalProps {
  isOpen: boolean;
  gameId: string;
  gameTitle?: string;
  onClose: () => void;
  onSuccess: (gameAccessToken: string) => void;
}

export const GamePasswordModal: React.FC<GamePasswordModalProps> = ({
  isOpen,
  gameId,
  gameTitle,
  onClose,
  onSuccess,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null;
      setPassword('');
      setError(null);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !loading) {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        clearTimeout(timer);
        previousActiveElement.current?.focus();
      };
    }
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Vui lòng nhập mật khẩu của bộ câu hỏi.');
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyGamePassword(gameId, password.trim());
      if (res.gameAccessToken) {
        onSuccess(res.gameAccessToken);
        onClose();
      } else {
        onSuccess('');
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Mật khẩu bộ câu hỏi không chính xác. Vui lòng thử lại.');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-password-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '16px',
          padding: '2rem',
          maxWidth: '440px',
          width: '100%',
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--border-strong)',
          outline: 'none',
          animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              backgroundColor: 'var(--accent-sky-subtle)',
              color: 'var(--accent-sky)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem auto',
              border: '1px solid var(--accent-sky-subtle)',
            }}
          >
            <LockIcon size={26} />
          </div>
          <h3
            id="game-password-modal-title"
            style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1.3rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Bộ Câu Hỏi Được Bảo Vệ
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {gameTitle ? (
              <span>
                Bộ câu hỏi <strong style={{ color: 'var(--text-primary)' }}>"{gameTitle}"</strong> yêu cầu mật khẩu để tham gia.
              </span>
            ) : (
              'Bộ câu hỏi này yêu cầu mật khẩu của người tạo để mở khóa nội dung và bắt đầu chơi.'
            )}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '10px',
              backgroundColor: 'var(--accent-rose-subtle)',
              border: '1px solid var(--accent-rose)',
              color: 'var(--accent-rose)',
              fontSize: '0.86rem',
              marginBottom: '1.25rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
            }}
          >
            <AlertTriangleIcon size={18} />
            <span style={{ flex: 1 }}>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              htmlFor="game-password-input"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <LockIcon size={15} />
              <span>Mật khẩu bộ câu hỏi</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="game-password-input"
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu do người tạo cung cấp..."
                disabled={loading}
                autoComplete="current-password"
                style={{
                  width: '100%',
                  padding: '0.85rem 3.2rem 0.85rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={0}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  minWidth: '40px',
                  minHeight: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  borderRadius: '6px',
                }}
              >
                {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                flex: 1,
                minHeight: '44px',
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 2,
                minHeight: '44px',
                padding: '0.75rem 1.25rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: 'var(--btn-shadow)',
                opacity: loading ? 0.75 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              {loading ? (
                <>
                  <SpinnerIcon size={18} />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <span>Mở Khóa & Chơi &rarr;</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
