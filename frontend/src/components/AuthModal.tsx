import React, { useState } from 'react';
import { useToast } from './ToastContext.js';
import { adminLogin } from '../services/api.js';
import type { AuthenticatedUser } from '../types/index.js';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: AuthenticatedUser) => void;
  initialMode?: 'login' | 'register';
  title?: string;
  subtitle?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  title,
  subtitle,
}) => {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res = await adminLogin(password);
      toast.success('Xác thực Quản trị viên thành công!', 'Truy cập Admin');
      onSuccess(res.user);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Mật khẩu quản trị viên không chính xác. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          padding: '2rem',
          maxWidth: '440px',
          width: '100%',
          boxShadow: 'var(--card-shadow)',
          position: 'relative',
        }}
      >
        {/* Nút đóng */}
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: '1.25rem',
            cursor: 'pointer',
            padding: '0.25rem 0.5rem',
          }}
        >
          ✕
        </button>

        {/* Tiêu đề */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: '0.4rem' }}>
            🔒
          </div>
          <h2 style={{ margin: '0 0 0.35rem 0', fontSize: '1.35rem', fontWeight: 900 }}>
            {title || 'Xác Thực Quản Trị Viên (Admin)'}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.45 }}>
            {subtitle ||
              'Nhập mật khẩu Admin để truy cập các tính năng tạo, chỉnh sửa và quản lý hệ thống game. Người chơi quét QR hoặc mở link trực tiếp để chơi mà không cần mật khẩu.'}
          </p>
        </div>

        {/* Thông báo lỗi nếu có */}
        {errorMessage && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '8px',
              padding: '0.75rem',
              color: 'var(--accent-rose)',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
              lineHeight: 1.4,
            }}
          >
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Form nhập mật khẩu Admin */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 700,
                marginBottom: '0.45rem',
                color: 'var(--text-secondary)',
              }}
            >
              Mật khẩu Quản trị viên
            </label>
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu Admin của hệ thống"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '0.75rem 0.95rem',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            style={{
              width: '100%',
              padding: '0.85rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.95rem',
              cursor: isLoading ? 'wait' : 'pointer',
              opacity: isLoading || !password.trim() ? 0.7 : 1,
              boxShadow: 'var(--btn-shadow)',
              transition: 'all 0.15s ease',
            }}
          >
            {isLoading ? 'Đang xác thực...' : 'Xác Thực Quyền Admin'}
          </button>
        </form>

        <div
          style={{
            marginTop: '1.25rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          💡 Bạn là người chơi? Hãy quét mã QR do Quản trị viên cung cấp hoặc bấm vào link chia sẻ để bắt đầu chơi ngay lập tức mà không cần mật khẩu.
        </div>
      </div>
    </div>
  );
};
