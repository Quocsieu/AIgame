import crypto from 'node:crypto';
import type { MultiplayerRoom } from './room.service.js';
import { MULTIPLAYER_CONFIG } from './room.types.js';

class MultiplayerRoomStore {
  private roomsById: Map<string, MultiplayerRoom> = new Map();
  private roomsByCode: Map<string, MultiplayerRoom> = new Map();

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

  public save(room: MultiplayerRoom): void {
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

  /**
   * Cleans up expired rooms based on configured ROOM_TTL_MS.
   */
  public cleanupExpired(now: number = Date.now()): number {
    let cleaned = 0;
    for (const [roomId, room] of this.roomsById.entries()) {
      if (now - room.createdAt > MULTIPLAYER_CONFIG.ROOM_TTL_MS) {
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

