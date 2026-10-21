import React, { useState, useEffect, useRef } from 'react';
import { verifyGamePassword } from '../services/api.js';

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

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Vui lòng nhập mật khẩu của bộ câu hỏi.');
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '16px',
          padding: '2rem',
          maxWidth: '440px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-subtle)',
          animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: 'var(--accent-sky)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
              margin: '0 auto 1rem auto',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}
          >
            🔒
          </div>
          <h3
            style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1.35rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
            }}
          >
            Bộ Câu Hỏi Được Bảo Vệ
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: '0.88rem',
              color: 'var(--text-muted)',
              lineHeight: 1.45,
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
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              htmlFor="game-password-input"
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                marginBottom: '0.45rem',
              }}
            >
              🔑 MẬT KHẨU BỘ CÂU HỎI
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
                style={{
                  width: '100%',
                  padding: '0.85rem 3rem 0.85rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  right: '0.85rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: '1rem',
                  padding: 0,
                }}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? '👁️' : '🔒'}
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
                padding: '0.85rem',
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
                padding: '0.85rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: 'var(--btn-shadow)',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Đang xác thực...' : 'Mở Khóa & Chơi &rarr;'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

