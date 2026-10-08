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
          background: 'rgba(16, 185, 129, 0.95)',
          borderColor: '#059669',
          iconColor: '#ffffff',
          icon: '✓',
          shadow: '0 8px 24px rgba(16, 185, 129, 0.35)',
        };
      case 'error':
        return {
          background: 'rgba(239, 68, 68, 0.95)',
          borderColor: '#dc2626',
          iconColor: '#ffffff',
          icon: '✕',
          shadow: '0 8px 24px rgba(239, 68, 68, 0.35)',
        };
      case 'loading':
        return {
          background: 'rgba(37, 99, 235, 0.95)',
          borderColor: '#1d4ed8',
          iconColor: '#ffffff',
          icon: '⚡',
          shadow: '0 8px 24px rgba(37, 99, 235, 0.35)',
        };
      case 'info':
      default:
        return {
          background: 'rgba(15, 23, 42, 0.95)',
          borderColor: '#38bdf8',
          iconColor: '#38bdf8',
          icon: 'ℹ',
          shadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
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
        borderRadius: '12px',
        padding: '0.9rem 1.25rem',
        color: '#ffffff',
        boxShadow: style.shadow,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.85rem',
        backdropFilter: 'blur(8px)',
        animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: '1rem',
          flexShrink: 0,
        }}
      >
        {style.icon}
      </div>
      <div style={{ flex: 1 }}>
        {toast.title && (
          <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '0.2rem', letterSpacing: '-0.01em' }}>
            {toast.title}
          </div>
        )}
        <div style={{ fontSize: '0.875rem', color: '#f8fafc', wordBreak: 'break-word', lineHeight: 1.4 }}>
          {toast.message}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'rgba(255, 255, 255, 0.15)',
          border: 'none',
          borderRadius: '6px',
          color: '#ffffff',
          cursor: 'pointer',
          fontSize: '1rem',
          fontWeight: 800,
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '0.25rem',
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
};

