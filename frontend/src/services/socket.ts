export type SocketEventHandler = (event: any) => void;

export class GameSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<SocketEventHandler>> = new Map();
  private onOpenCallbacks: Set<() => void> = new Set();
  private onCloseCallbacks: Set<() => void> = new Set();
  private onErrorCallbacks: Set<(err: any) => void> = new Set();

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.onOpenCallbacks.forEach(cb => cb());
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type) {
          const handlers = this.listeners.get(msg.type);
          if (handlers) {
            handlers.forEach(h => h(msg));
          }
        }
        // Also emit to wildcard
        const allHandlers = this.listeners.get('*');
        if (allHandlers) {
          allHandlers.forEach(h => h(msg));
        }
      } catch (err) {
        console.error('Lỗi khi phân tích dữ liệu WebSocket:', err);
      }
    };

    this.ws.onclose = () => {
      this.onCloseCallbacks.forEach(cb => cb());
    };

    this.ws.onerror = (err) => {
      this.onErrorCallbacks.forEach(cb => cb(err));
    };
  }

  public send(msg: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('Không thể gửi tin nhắn WebSocket: Kết nối chưa mở.');
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
    this.onOpenCallbacks.clear();
    this.onCloseCallbacks.clear();
    this.onErrorCallbacks.clear();
  }
}

