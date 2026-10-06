import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

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

  const info = useCallback((message: string, title?: string) => {
    return addToast({ type: 'info', message, title: title || 'Thông báo' });
  }, [addToast]);

  const loading = useCallback((message: string, title?: string) => {
    return addToast({ type: 'loading', message, title: title || 'Đang xử lý', duration: 0 });
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, info, loading }}>
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
      style={{
        position: 'fixed',
        top: '1.25rem',
        right: '1.25rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: '400px',
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
          background: '#064e3b',
          borderColor: '#10b981',
          iconColor: '#34d399',
          icon: '✓',
        };
      case 'error':
        return {
          background: '#7f1d1d',
          borderColor: '#ef4444',
          iconColor: '#f87171',
          icon: '✕',
        };
      case 'loading':
        return {
          background: '#1e3a8a',
          borderColor: '#3b82f6',
          iconColor: '#60a5fa',
          icon: '⟳',
        };
      case 'info':
      default:
        return {
          background: '#0f172a',
          borderColor: '#38bdf8',
          iconColor: '#38bdf8',
          icon: 'ℹ',
        };
    }
  };

  const style = getStyle();

  return (
    <div
      style={{
        pointerEvents: 'auto',
        backgroundColor: style.background,
        border: `1px solid ${style.borderColor}`,
        borderRadius: '8px',
        padding: '0.85rem 1.15rem',
        color: '#f8fafc',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{
          color: style.iconColor,
          fontWeight: 800,
          fontSize: '1.25rem',
          lineHeight: '1.2',
        }}
      >
        {style.icon}
      </div>
      <div style={{ flex: 1 }}>
        {toast.title && (
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' }}>
            {toast.title}
          </div>
        )}
        <div style={{ fontSize: '0.875rem', color: '#e2e8f0', wordBreak: 'break-word' }}>
          {toast.message}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          fontSize: '1rem',
          fontWeight: 700,
          padding: '0 0.25rem',
          marginLeft: '0.25rem',
        }}
      >
        ×
      </button>
    </div>
  );
};

