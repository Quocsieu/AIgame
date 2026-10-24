import crypto from 'node:crypto';
import { LIMITS } from '../config/limits.js';
import { AppError } from '../utils/errors.js';
import type { MultiplayerRoom } from './room.service.js';
import { MULTIPLAYER_CONFIG } from './room.types.js';

export class MultiplayerRoomStore {
  private roomsById: Map<string, MultiplayerRoom> = new Map();
  private roomsByCode: Map<string, MultiplayerRoom> = new Map();
  private ttlMs: number = MULTIPLAYER_CONFIG.ROOM_TTL_MS;
  private maxRooms: number = LIMITS.MAX_ACTIVE_ROOMS;
  private cleanupTimer: NodeJS.Timeout | null = null;

  public configure(options: { ttlMs?: number; maxRooms?: number }): void {
    if (options.ttlMs !== undefined && options.ttlMs > 0) {
      this.ttlMs = options.ttlMs;
    }
    if (options.maxRooms !== undefined && options.maxRooms > 0) {
      this.maxRooms = options.maxRooms;
    }
  }

  public startCleanupTimer(intervalMs: number = LIMITS.STORE_CLEANUP_INTERVAL_MS): void {
    if (this.cleanupTimer) {
      return;
    }
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, intervalMs);
    this.cleanupTimer.unref();
  }

  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public isRoomActive(room: MultiplayerRoom): boolean {
    return (
      room.state === 'WAITING' ||
      room.state === 'QUESTION_ACTIVE' ||
      room.state === 'QUESTION_REVEAL'
    );
  }

  public countActiveRoomsForUser(userId: string, now: number = Date.now()): number {
    let activeCount = 0;
    for (const room of this.roomsById.values()) {
      if (
        room.ownerUserId === userId &&
        this.isRoomActive(room) &&
        now - room.updatedAt <= this.ttlMs
      ) {
        activeCount++;
      }
    }
    return activeCount;
  }

  public hasActiveRoomForGame(gameId: string, now: number = Date.now()): boolean {
    for (const room of this.roomsById.values()) {
      if (
        room.gameSpecification.gameId === gameId &&
        this.isRoomActive(room) &&
        now - room.updatedAt <= this.ttlMs
      ) {
        return true;
      }
    }
    return false;
  }

  public getActiveRoomsForGame(gameId: string, now: number = Date.now()): MultiplayerRoom[] {
    const active: MultiplayerRoom[] = [];
    for (const room of this.roomsById.values()) {
      if (
        room.gameSpecification.gameId === gameId &&
        this.isRoomActive(room) &&
        now - room.updatedAt <= this.ttlMs
      ) {
        active.push(room);
      }
    }
    return active;
  }

  /**
   * Generates a 6-character uppercase room code avoiding ambiguous characters.
   * Guarantees uniqueness among active rooms.
   */
  public generateUniqueRoomCode(): string {
    const alphabet = MULTIPLAYER_CONFIG.ROOM_CODE_ALPHABET;
    const len = MULTIPLAYER_CONFIG.ROOM_CODE_LENGTH;
    const maxAttempts = 10000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const bytes = crypto.randomBytes(len);
      let code = '';
      for (let i = 0; i < len; i++) {
        code += alphabet[bytes[i] % alphabet.length];
      }

      if (!this.roomsByCode.has(code)) {
        return code;
      }
    }

    throw new Error('Failed to generate a unique room code. Active room pool may be exhausted.');
  }

  public save(room: MultiplayerRoom, now: number = Date.now()): void {
    this.cleanupExpired(now);

    if (!this.roomsById.has(room.roomId) && this.roomsById.size >= this.maxRooms) {
      // Only evict inactive (FINISHED or CLOSED) rooms; never evict an active room
      let evictRoomId: string | null = null;
      let oldestTime = Infinity;

      for (const [id, existingRoom] of this.roomsById.entries()) {
        if (!this.isRoomActive(existingRoom) && existingRoom.updatedAt < oldestTime) {
          oldestTime = existingRoom.updatedAt;
          evictRoomId = id;
        }
      }

      if (evictRoomId) {
        const toEvict = this.roomsById.get(evictRoomId);
        toEvict?.close();
        this.delete(evictRoomId);
      } else {
        throw new AppError(
          'ROOM_CAPACITY_EXCEEDED',
          'Maximum number of active multiplayer rooms reached. Please try again later.',
          503
        );
      }
    }

    this.roomsById.set(room.roomId, room);
    this.roomsByCode.set(room.roomCode.toUpperCase(), room);
  }

  public getByRoomId(roomId: string): MultiplayerRoom | undefined {
    return this.roomsById.get(roomId);
  }

  public getByRoomCode(roomCode: string): MultiplayerRoom | undefined {
    return this.roomsByCode.get(roomCode.trim().toUpperCase());
  }

  public delete(roomId: string): boolean {
    const room = this.roomsById.get(roomId);
    if (!room) return false;

    this.roomsById.delete(roomId);
    this.roomsByCode.delete(room.roomCode.toUpperCase());
    return true;
  }

  public count(): number {
    return this.roomsById.size;
  }

  public getAll(): MultiplayerRoom[] {
    return Array.from(this.roomsById.values());
  }

  /**
   * Cleans up expired rooms based on configured ROOM_TTL_MS.
   */
  public cleanupExpired(now: number = Date.now(), ttlMs: number = this.ttlMs): number {
    let cleaned = 0;
    for (const [roomId, room] of this.roomsById.entries()) {
      const lastActivity = Math.max(room.createdAt, room.updatedAt);
      if (room.state === 'CLOSED' || now - lastActivity > ttlMs) {
        room.close();
        this.delete(roomId);
        cleaned++;
      }
    }
    return cleaned;
  }

  public clear(): void {
    for (const room of this.roomsById.values()) {
      room.close();
    }
    this.roomsById.clear();
    this.roomsByCode.clear();
  }
}

export const roomStore = new MultiplayerRoomStore();
roomStore.startCleanupTimer();


