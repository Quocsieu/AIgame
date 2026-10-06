export type ClockFunction = () => number;

/**
 * Deterministic local question timer.
 * Accepts an injectable clock function to allow fully deterministic unit testing.
 */
export class GameTimer {
  private startedAt: number | null = null;
  private durationMs: number = 0;
  private clock: ClockFunction;

  constructor(clock: ClockFunction = () => Date.now()) {
    this.clock = clock;
  }

  public setClock(clock: ClockFunction): void {
    this.clock = clock;
  }

  public start(durationSeconds: number): void {
    this.startedAt = this.clock();
    this.durationMs = durationSeconds * 1000;
  }

  public getStartTime(): number | null {
    return this.startedAt;
  }

  public getDeadline(): number | null {
    if (this.startedAt === null) return null;
    return this.startedAt + this.durationMs;
  }

  public getRemainingTimeMs(): number {
    if (this.startedAt === null) return 0;
    const elapsed = this.clock() - this.startedAt;
    return Math.max(0, this.durationMs - elapsed);
  }

  public getResponseTimeMs(): number {
    if (this.startedAt === null) return 0;
    return Math.max(0, this.clock() - this.startedAt);
  }

  public isExpired(gracePeriodMs: number = 0): boolean {
    if (this.startedAt === null) return false;
    return (this.clock() - this.startedAt) > (this.durationMs + gracePeriodMs);
  }

  public reset(): void {
    this.startedAt = null;
    this.durationMs = 0;
  }
}

