/// <reference types="vite/client" />

export type SocketEventHandler = (event: any) => void;
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

function getWebSocketUrl(): string {
  // 1. Ưu tiên biến VITE_WS_URL nếu có cấu hình riêng biệt
  const explicitWsUrl = import.meta.env.VITE_WS_URL;
  if (explicitWsUrl) {
    return explicitWsUrl.trim();
  }

  // 2. Dẫn xuất từ VITE_API_URL nếu là absolute URL
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl && (apiUrl.startsWith('http://') || apiUrl.startsWith('https://'))) {
    const url = new URL(apiUrl);
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${url.host}/ws`;
  }

  // 3. Fallback local/Vite proxy
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

export class GameSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<SocketEventHandler>> = new Map();
  private onOpenCallbacks: Set<() => void> = new Set();
  private onCloseCallbacks: Set<() => void> = new Set();
  private onErrorCallbacks: Set<(err: any) => void> = new Set();
  private onStatusCallbacks: Set<(status: ConnectionStatus) => void> = new Set();

  public status: ConnectionStatus = 'disconnected';
  private isExplicitClose: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimer: any = null;

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.onStatusCallbacks.forEach((cb) => {
        try {
          cb(newStatus);
        } catch {
          // ignore callback error
        }
      });
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isExplicitClose = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const wsUrl = getWebSocketUrl();

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.onOpenCallbacks.forEach((cb) => {
          try {
            cb();
          } catch {}
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type) {
            const handlers = this.listeners.get(msg.type);
            if (handlers) {
              handlers.forEach((h) => {
                try {
                  h(msg);
                } catch {}
              });
            }
          }
          // Also emit to wildcard
          const allHandlers = this.listeners.get('*');
          if (allHandlers) {
            allHandlers.forEach((h) => {
              try {
                h(msg);
              } catch {}
            });
          }
        } catch (err) {
          console.error('Lỗi khi phân tích dữ liệu WebSocket:', err);
        }
      };

      this.ws.onclose = () => {
        this.onCloseCallbacks.forEach((cb) => {
          try {
            cb();
          } catch {}
        });

        if (this.isExplicitClose) {
          this.setStatus('disconnected');
          return;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          this.setStatus('reconnecting');
          const delay = Math.min(5000, 1000 * Math.pow(1.3, this.reconnectAttempts));
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, delay);
        } else {
          this.setStatus('disconnected');
        }
      };

      this.ws.onerror = (err) => {
        this.onErrorCallbacks.forEach((cb) => {
          try {
            cb(err);
          } catch {}
        });
      };
    } catch (err) {
      this.setStatus('disconnected');
      this.onErrorCallbacks.forEach((cb) => {
        try {
          cb(err);
        } catch {}
      });
    }
  }

  public isConnected(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  public send(msg: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch (err) {
        console.warn('Lỗi khi gửi dữ liệu qua WebSocket:', err);
        return false;
      }
    } else {
      console.warn('Không thể gửi tin nhắn WebSocket: Kết nối chưa mở.');
      return false;
    }
  }

  public on(eventType: string, handler: SocketEventHandler): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  public onStatusChange(cb: (status: ConnectionStatus) => void): () => void {
    this.onStatusCallbacks.add(cb);
    cb(this.status);
    return () => {
      this.onStatusCallbacks.delete(cb);
    };
  }

  public onOpen(cb: () => void): () => void {
    this.onOpenCallbacks.add(cb);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      cb();
    }
    return () => {
      this.onOpenCallbacks.delete(cb);
    };
  }

  public onClose(cb: () => void): () => void {
    this.onCloseCallbacks.add(cb);
    return () => {
      this.onCloseCallbacks.delete(cb);
    };
  }

  public onError(cb: (err: any) => void): () => void {
    this.onErrorCallbacks.add(cb);
    return () => {
      this.onErrorCallbacks.delete(cb);
    };
  }

  public close(): void {
    this.isExplicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus('disconnected');
    this.listeners.clear();
    this.onOpenCallbacks.clear();
    this.onCloseCallbacks.clear();
    this.onErrorCallbacks.clear();
    this.onStatusCallbacks.clear();
  }
}
