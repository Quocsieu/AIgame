import { GameSpecification } from '../contracts/game.contract.js';
import type { GameSession } from './game.session.js';

class GameSpecificationStore {
  private specs: Map<string, GameSpecification> = new Map();

  public save(spec: GameSpecification): void {
    this.specs.set(spec.gameId, spec);
  }

  public get(gameId: string): GameSpecification | undefined {
    return this.specs.get(gameId);
  }

  public has(gameId: string): boolean {
    return this.specs.has(gameId);
  }

  public clear(): void {
    this.specs.clear();
  }
}

class GameSessionStore {
  private sessions: Map<string, GameSession> = new Map();

  public save(session: GameSession): void {
    this.sessions.set(session.sessionId, session);
  }

  public get(sessionId: string): GameSession | undefined {
    return this.sessions.get(sessionId);
  }

  public has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public clear(): void {
    this.sessions.clear();
  }
}

export const gameStore = new GameSpecificationStore();
export const sessionStore = new GameSessionStore();

