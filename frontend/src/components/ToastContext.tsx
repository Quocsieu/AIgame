import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  AlertTriangleIcon,
  CheckIcon,
  InfoIcon,
  SpinnerIcon,
  XMarkIcon,
} from './Icons.js';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  loading: (message: string, title?: string) => string;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>): string => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newToast: ToastItem = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    const duration = toast.duration !== undefined ? toast.duration : (toast.type === 'error' ? 6000 : 4000);
    if (duration > 0 && toast.type !== 'loading') {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  }, [removeToast]);

  const success = useCallback((message: string, title?: string) => {
    return addToast({ type: 'success', message, title: title || 'Thành công' });
  }, [addToast]);

  const error = useCallback((message: string, title?: string) => {
    return addToast({ type: 'error', message, title: title || 'Lỗi xử lý' });
  }, [addToast]);

  const warning = useCallback((message: string, title?: string) => {
    return addToast({ type: 'warning', message, title: title || 'Cảnh báo' });
  }, [addToast]);

  const info = useCallback((message: string, title?: string) => {
    return addToast({ type: 'info', message, title: title || 'Thông báo' });
  }, [addToast]);

  const loading = useCallback((message: string, title?: string) => {
    return addToast({ type: 'loading', message, title: title || 'Đang xử lý', duration: 0 });
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info, loading }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const ToastContainer: React.FC<{ toasts: ToastItem[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Thông báo hệ thống"
      style={{
        position: 'fixed',
        top: '1.25rem',
        right: '1.25rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: '420px',
        width: 'calc(100% - 2.5rem)',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const getStyle = () => {
    switch (toast.type) {
      case 'success':
        return {
          background: 'var(--accent-emerald)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
          icon: <CheckIcon size={18} />,
          shadow: 'var(--shadow-lg)',
        };
      case 'error':
        return {
          background: 'var(--accent-rose)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
          icon: <XMarkIcon size={18} />,
          shadow: 'var(--shadow-lg)',
        };
      case 'warning':
        return {
          background: 'var(--accent-amber)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
          icon: <AlertTriangleIcon size={18} />,
          shadow: 'var(--shadow-lg)',
        };
      case 'loading':
        return {
          background: 'var(--primary)',
          borderColor: 'rgba(255, 255, 255, 0.2)',
          icon: <SpinnerIcon size={18} />,
          shadow: 'var(--shadow-lg)',
        };
      case 'info':
      default:
        return {
          background: 'var(--bg-card)',
          borderColor: 'var(--accent-sky)',
          color: 'var(--text-primary)',
          icon: <InfoIcon size={18} style={{ color: 'var(--accent-sky)' }} />,
          shadow: 'var(--shadow-lg)',
        };
    }
  };

  const style = getStyle();
  const isInfo = toast.type === 'info';

  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        backgroundColor: style.background,
        border: `1px solid ${style.borderColor}`,
        borderRadius: '12px',
        padding: '0.9rem 1.15rem',
        color: isInfo ? 'var(--text-primary)' : '#ffffff',
        boxShadow: style.shadow,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.85rem',
        backdropFilter: 'blur(8px)',
        animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        transition: 'all 0.15s ease',
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          backgroundColor: isInfo ? 'var(--accent-sky-subtle)' : 'rgba(255, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {style.icon}
      </div>
      <div style={{ flex: 1 }}>
        {toast.title && (
          <div style={{ fontWeight: 800, fontSize: '0.92rem', marginBottom: '0.2rem', letterSpacing: '-0.01em' }}>
            {toast.title}
          </div>
        )}
        <div style={{ fontSize: '0.86rem', color: isInfo ? 'var(--text-secondary)' : '#f8fafc', wordBreak: 'break-word', lineHeight: 1.45 }}>
          {toast.message}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Đóng thông báo"
        style={{
          background: isInfo ? 'transparent' : 'rgba(255, 255, 255, 0.15)',
          border: 'none',
          borderRadius: '6px',
          color: isInfo ? 'var(--text-muted)' : '#ffffff',
          cursor: 'pointer',
          minWidth: '32px',
          minHeight: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '0.25rem',
          flexShrink: 0,
          padding: 0,
        }}
      >
        <XMarkIcon size={16} />
      </button>
    </div>
  );
};

