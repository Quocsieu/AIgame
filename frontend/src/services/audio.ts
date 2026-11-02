import type { AudioPresetId, GameAudioConfig } from '../types/index.js';

export const DEFAULT_AUDIO_CONFIG: GameAudioConfig = {
  enabled: true,
  presetId: 'ENERGETIC_ARENA',
  customAudioUrl: null,
  customAudioName: null,
  customAudioFileName: null,
  customAudioMimeType: null,
  customAudioSizeBytes: null,
  volume: 0.7,
  countdownSoundEnabled: true,
  countdownTriggerSeconds: 5,
  sfxEnabled: true,
};

export const AUDIO_PRESET_CATALOG: Array<{
  id: AudioPresetId;
  presetId: AudioPresetId;
  label: string;
  description: string;
}> = [
  {
    id: 'ENERGETIC_ARENA',
    presetId: 'ENERGETIC_ARENA',
    label: 'Sôi động Đấu trường (Quiz / Live)',
    description: 'Nhịp điệu hào hứng, phù hợp cho game tương tác và thi đua.',
  },
  {
    id: 'EXAM_FOCUS',
    presetId: 'EXAM_FOCUS',
    label: 'Tập trung Phòng thi (Exam Focus)',
    description: 'Âm thanh nhẹ nhàng, giảm xao nhãng cho kỳ thi nghiêm túc.',
  },
  {
    id: 'ADVENTURE_QUEST',
    presetId: 'ADVENTURE_QUEST',
    label: 'Hành trình Phiêu lưu (Adventure 2D)',
    description: 'Giai điệu phiêu lưu nhịp nhàng cho chế độ vượt chướng ngại vật.',
  },
  {
    id: 'CORPORATE_CALM',
    presetId: 'CORPORATE_CALM',
    label: 'Đào tạo Doanh nghiệp (Corporate Calm)',
    description: 'Nhạc nền êm dịu, chuyên nghiệp cho các buổi đào tạo nội bộ.',
  },
  {
    id: 'CUSTOM',
    presetId: 'CUSTOM',
    label: 'Nhạc tải lên từ máy (.mp3 / .wav / .ogg)',
    description: 'Sử dụng tệp âm thanh riêng của Ban Tổ Chức (tối đa 10 MB).',
  },
  {
    id: 'NONE',
    presetId: 'NONE',
    label: 'Tắt nhạc nền',
    description: 'Không phát nhạc nền, chỉ giữ hiệu ứng âm thanh khi cần.',
  },
];

export interface AudioPreviewCallbacks {
  onError?: (message: string) => void;
  onStateChange?: (isPlaying: boolean) => void;
}

export interface AudioDiagnosticsSnapshot {
  contextState: string;
  isPlayingBgm: boolean;
  isPreviewing: boolean;
  muted: boolean;
  volume: number;
  volumeNormalized: number;
  activePresetId: AudioPresetId;
  oscillatorsStartedCount: number;
  activeOscillatorCount: number;
  lastGainValue: number;
  lastToneFrequency: number;
  lastSfxPlayed: string | null;
  customAudioPlaying: boolean;
  customAudioSrc: string | null;
  lastError: string | null;
}

const STORAGE_MUTED_KEY = 'ai_game_audio_muted_v2';
const STORAGE_VOLUME_KEY = 'ai_game_audio_volume_v2';

export function normalizeVolumeToPercent(rawVolume: unknown, fallbackPercent: number = 70): number {
  const num = Number(rawVolume);
  if (!Number.isFinite(num)) return fallbackPercent;
  if (num <= 0) return 0;
  // Values in (0, 1] are normalized floats (e.g. 0.5 -> 50%, 0.7 -> 70%, 1 -> 100%)
  if (num > 0 && num <= 1) {
    return Math.max(1, Math.min(100, Math.round(num * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(num)));
}

class GameAudioManager {
  private ctx: AudioContext | null = null;
  private bgmLoopInterval: number | null = null;
  private customAudioEl: HTMLAudioElement | null = null;
  private isPlayingBgm: boolean = false;
  private isPreviewing: boolean = false;
  private muted: boolean = false;
  private volume: number = 70; // 0..100 integer percentage
  private currentConfig: GameAudioConfig = { ...DEFAULT_AUDIO_CONFIG };
  private lastCountdownSecondPlayed: number | null = null;
  private stepIndex: number = 0;
  private previewCallbacks: AudioPreviewCallbacks | null = null;
  private listeners: Set<() => void> = new Set();
  private unlockListenerAttached: boolean = false;

  // Diagnostic telemetry counters for automated & E2E verification
  private oscillatorsStartedCount: number = 0;
  private activeOscillatorCount: number = 0;
  private lastGainValue: number = 0;
  private lastToneFrequency: number = 0;
  private lastSfxPlayed: string | null = null;
  private lastError: string | null = null;

  constructor() {
    try {
      const savedMuted = localStorage.getItem(STORAGE_MUTED_KEY);
      if (savedMuted === 'true') this.muted = true;
      const savedVol = localStorage.getItem(STORAGE_VOLUME_KEY);
      if (savedVol !== null) {
        const parsed = Number(savedVol);
        // Recover from previous 0..1 rounding bug where 0.5 was saved as "1"
        if (parsed === 1) {
          this.volume = 70;
          localStorage.setItem(STORAGE_VOLUME_KEY, '70');
        } else if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
          this.volume = normalizeVolumeToPercent(parsed, 70);
        }
      }
    } catch {
      // ignore storage errors
    }
    this.attachGlobalGestureUnlock();
  }

  private attachGlobalGestureUnlock(): void {
    if (typeof window === 'undefined' || this.unlockListenerAttached) return;
    this.unlockListenerAttached = true;
    const unlockHandler = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.isPlayingBgm && !this.muted && this.customAudioEl && this.customAudioEl.paused) {
        this.customAudioEl.play().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlockHandler, { passive: true });
    window.addEventListener('keydown', unlockHandler, { passive: true });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      try {
        this.ctx = new AudioCtx();
      } catch (err: any) {
        this.lastError = err?.message || 'Không thể khởi tạo Web Audio Context.';
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err: any) => {
        this.lastError = err?.message || 'AudioContext resume blocked';
      });
    }
    return this.ctx;
  }

  public getMuted(): boolean {
    return this.muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getVolume(): number {
    return this.volume;
  }

  public getVolumeNormalized(): number {
    return Number((this.volume / 100).toFixed(2));
  }

  public getIsPlaying(): boolean {
    return this.isPlayingBgm;
  }

  public getIsPreviewing(): boolean {
    return this.isPreviewing;
  }

  public getDiagnostics(): AudioDiagnosticsSnapshot {
    return {
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
      isPlayingBgm: this.isPlayingBgm,
      isPreviewing: this.isPreviewing,
      muted: this.muted,
      volume: this.volume,
      volumeNormalized: this.getVolumeNormalized(),
      activePresetId: this.currentConfig.presetId,
      oscillatorsStartedCount: this.oscillatorsStartedCount,
      activeOscillatorCount: this.activeOscillatorCount,
      lastGainValue: Number(this.lastGainValue.toFixed(4)),
      lastToneFrequency: Number(this.lastToneFrequency.toFixed(2)),
      lastSfxPlayed: this.lastSfxPlayed,
      customAudioPlaying: Boolean(this.customAudioEl && !this.customAudioEl.paused),
      customAudioSrc: this.customAudioEl ? this.customAudioEl.src : null,
      lastError: this.lastError,
    };
  }

  public configure(partialConfig?: Partial<GameAudioConfig>): void {
    const nextVolPercent =
      partialConfig?.volume !== undefined
        ? normalizeVolumeToPercent(partialConfig.volume, this.volume)
        : this.volume;
    this.volume = nextVolPercent;
    this.currentConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      ...this.currentConfig,
      ...(partialConfig || {}),
      volume: Number((nextVolPercent / 100).toFixed(2)),
    };
    this.notifyListeners();
  }

  public startBackgroundMusic(partialConfig?: Partial<GameAudioConfig>): void {
    this.startSessionAudio(partialConfig || this.currentConfig, false);
  }

  public stopBackgroundMusic(): void {
    this.stopAll();
  }

  public playPreview(config: Partial<GameAudioConfig>, callbacks?: AudioPreviewCallbacks): boolean {
    return this.previewAudio(config, callbacks);
  }

  public playSfx(type: 'correct' | 'wrong' | 'timeout' | 'recorded' | 'finish'): void {
    switch (type) {
      case 'correct':
        this.playCorrect();
        break;
      case 'wrong':
        this.playWrong();
        break;
      case 'timeout':
        this.playTimeout();
        break;
      case 'recorded':
        this.playAnswerRecorded();
        break;
      case 'finish':
        this.playVictory();
        break;
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    try {
      localStorage.setItem(STORAGE_MUTED_KEY, String(this.muted));
    } catch {}
    if (this.customAudioEl) {
      this.customAudioEl.muted = this.muted;
    }
    if (this.muted) {
      this.stopBgmInternal();
    } else {
      this.ensureContext();
      if (this.isPlayingBgm) {
        this.startBgmLoop(this.currentConfig);
      }
    }
    this.notifyListeners();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setVolume(vol: number): void {
    const clamped = normalizeVolumeToPercent(vol, this.volume);
    this.volume = clamped;
    this.currentConfig = {
      ...this.currentConfig,
      volume: Number((clamped / 100).toFixed(2)),
    };
    try {
      localStorage.setItem(STORAGE_VOLUME_KEY, String(clamped));
    } catch {}
    if (this.customAudioEl) {
      this.customAudioEl.volume = clamped / 100;
    }
    this.notifyListeners();
  }

  private getEffectiveGain(multiplier: number = 1): number {
    if (this.muted || !this.currentConfig.enabled || this.volume <= 0) return 0;
    return Math.min(1, Math.max(0, (this.volume / 100) * multiplier));
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    gainMultiplier: number = 0.18,
    delaySec: number = 0
  ): boolean {
    const ctx = this.ensureContext();
    const gainVal = this.getEffectiveGain(gainMultiplier);
    if (gainVal <= 0.001 || !ctx) return false;

    try {
      const now = ctx.currentTime + delaySec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainVal, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(gain);
      gain.connect(ctx.destination);

      this.oscillatorsStartedCount++;
      this.activeOscillatorCount++;
      this.lastGainValue = gainVal;
      this.lastToneFrequency = freq;

      osc.onended = () => {
        this.activeOscillatorCount = Math.max(0, this.activeOscillatorCount - 1);
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start(now);
      osc.stop(now + durationSec + 0.02);
      return true;
    } catch (err: any) {
      this.lastError = err?.message || 'Oscillator playback error';
      return false;
    }
  }

  /**
   * Starts or updates background music for a game session or preview.
   * Ensures any previous loop or HTMLAudioElement is stopped first so tracks never overlap.
   */
  public startSessionAudio(
    partialConfig?: Partial<GameAudioConfig>,
    isPreview: boolean = false,
    callbacks?: AudioPreviewCallbacks
  ): boolean {
    this.stopAll();
    this.lastError = null;
    this.previewCallbacks = isPreview ? callbacks || null : null;

    const resolvedVolPercent =
      partialConfig?.volume !== undefined
        ? normalizeVolumeToPercent(partialConfig.volume, this.volume || 70)
        : this.volume > 0
          ? this.volume
          : 70;
    this.volume = resolvedVolPercent;

    this.currentConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      ...(partialConfig || {}),
      volume: Number((resolvedVolPercent / 100).toFixed(2)),
    };

    if (
      !this.currentConfig.enabled ||
      this.currentConfig.presetId === 'NONE'
    ) {
      this.isPlayingBgm = false;
      this.isPreviewing = false;
      this.previewCallbacks?.onStateChange?.(false);
      this.notifyListeners();
      return false;
    }

    if (this.currentConfig.presetId === 'CUSTOM' && !this.currentConfig.customAudioUrl) {
      this.lastError =
        'Chưa có tệp nhạc tải lên. Vui lòng tải lên tệp .mp3, .wav hoặc .ogg trước khi nghe thử.';
      this.isPlayingBgm = false;
      this.isPreviewing = false;
      this.previewCallbacks?.onStateChange?.(false);
      this.previewCallbacks?.onError?.(this.lastError);
      this.notifyListeners();
      return false;
    }

    // Ensure AudioContext is created/resumed synchronously inside the user click gesture
    this.ensureContext();

    this.isPlayingBgm = true;
    this.isPreviewing = isPreview;
    this.lastCountdownSecondPlayed = null;

    if (!this.muted) {
      this.startBgmLoop(this.currentConfig);
    }

    this.previewCallbacks?.onStateChange?.(this.isPreviewing);
    this.notifyListeners();
    return true;
  }

  public previewAudio(
    config: Partial<GameAudioConfig>,
    callbacks?: AudioPreviewCallbacks
  ): boolean {
    // When user explicitly clicks "Nghe thử", unmute if muted and ensure volume >= 10%
    if (this.muted) {
      this.muted = false;
      try {
        localStorage.setItem(STORAGE_MUTED_KEY, 'false');
      } catch {}
    }
    const rawVol = config.volume !== undefined ? normalizeVolumeToPercent(config.volume, 70) : this.volume;
    const effectiveVol = rawVol <= 0 ? 70 : rawVol;
    return this.startSessionAudio(
      {
        ...config,
        enabled: config.presetId !== 'NONE',
        volume: Number((effectiveVol / 100).toFixed(2)),
      },
      true,
      callbacks
    );
  }

  public stopPreview(): void {
    if (this.isPreviewing) {
      this.stopAll();
    }
  }

  private startBgmLoop(config: GameAudioConfig): void {
    this.stopBgmInternal();
    if (this.muted || !config.enabled || config.presetId === 'NONE') return;

    if (config.presetId === 'CUSTOM') {
      if (!config.customAudioUrl) {
        this.lastError = 'Chưa có đường dẫn tệp âm thanh tải lên.';
        return;
      }
      try {
        const audio = new Audio(config.customAudioUrl);
        audio.loop = true;
        audio.volume = Math.max(0, Math.min(1, this.volume / 100));
        audio.muted = this.muted;
        this.customAudioEl = audio;

        audio.onerror = () => {
          if (this.customAudioEl !== audio) return;
          this.lastError =
            'Không thể tải hoặc giải mã tệp âm thanh. Vui lòng kiểm tra lại định dạng (.mp3, .wav, .ogg).';
          const cb = this.previewCallbacks;
          this.stopAll();
          cb?.onStateChange?.(false);
          cb?.onError?.(this.lastError!);
        };

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((err: any) => {
            if (this.customAudioEl !== audio) return;
            const errName = err?.name || '';
            if (errName === 'NotAllowedError') {
              this.lastError =
                'Trình duyệt đang chặn phát âm thanh tự động. Vui lòng bấm lại nút Nghe thử.';
            } else if (errName === 'NotSupportedError') {
              this.lastError =
                'Định dạng âm thanh không được trình duyệt hỗ trợ. Vui lòng chọn tệp .mp3, .wav hoặc .ogg hợp lệ.';
            } else {
              this.lastError = err?.message || 'Không thể phát tệp âm thanh tải lên.';
            }
            if (this.isPreviewing) {
              const cb = this.previewCallbacks;
              this.stopAll();
              cb?.onStateChange?.(false);
              cb?.onError?.(this.lastError!);
            }
          });
        }
      } catch (err: any) {
        this.lastError = err?.message || 'Lỗi khởi tạo trình phát âm thanh.';
        if (this.isPreviewing) {
          const cb = this.previewCallbacks;
          this.stopAll();
          cb?.onStateChange?.(false);
          cb?.onError?.(this.lastError!);
        }
      }
      return;
    }

    // Built-in synthesized BGM loop with distinct melodic patterns and clearly audible gain
    this.stepIndex = 0;
    const notesByPreset: Record<
      string,
      { notes: number[]; tempoMs: number; wave: OscillatorType; gain: number }
    > = {
      ENERGETIC_ARENA: {
        notes: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23],
        tempoMs: 420,
        wave: 'triangle',
        gain: 0.18,
      },
      EXAM_FOCUS: {
        notes: [220.0, 277.18, 329.63, 277.18, 196.0, 246.94, 293.66, 246.94],
        tempoMs: 880,
        wave: 'sine',
        gain: 0.14,
      },
      ADVENTURE_QUEST: {
        notes: [293.66, 369.99, 440.0, 587.33, 493.88, 440.0, 369.99, 329.63],
        tempoMs: 380,
        wave: 'triangle',
        gain: 0.18,
      },
      CORPORATE_CALM: {
        notes: [261.63, 329.63, 392.0, 493.88, 440.0, 392.0, 329.63, 293.66],
        tempoMs: 680,
        wave: 'sine',
        gain: 0.15,
      },
    };

    const preset = notesByPreset[config.presetId] || notesByPreset.ENERGETIC_ARENA;
    const playStep = () => {
      if (!this.isPlayingBgm || this.muted || !this.currentConfig.enabled) return;
      const note = preset.notes[this.stepIndex % preset.notes.length];
      this.stepIndex++;
      this.playTone(note, (preset.tempoMs / 1000) * 0.82, preset.wave, preset.gain, 0);
    };

    playStep();
    if (typeof window !== 'undefined') {
      this.bgmLoopInterval = window.setInterval(playStep, preset.tempoMs);
    }
  }

  private stopBgmInternal(): void {
    if (this.bgmLoopInterval !== null && typeof window !== 'undefined') {
      window.clearInterval(this.bgmLoopInterval);
      this.bgmLoopInterval = null;
    }
    if (this.customAudioEl) {
      const el = this.customAudioEl;
      this.customAudioEl = null;
      try {
        el.onerror = null;
        el.pause();
        el.currentTime = 0;
        el.removeAttribute('src');
        el.load();
      } catch {}
    }
  }

  /**
   * Stops all background music and resets countdown state (called on unmount/exit/finish).
   */
  public stopAll(): void {
    const wasPreviewing = this.isPreviewing;
    const cb = this.previewCallbacks;
    this.isPlayingBgm = false;
    this.isPreviewing = false;
    this.previewCallbacks = null;
    this.lastCountdownSecondPlayed = null;
    this.stopBgmInternal();
    if (wasPreviewing) {
      cb?.onStateChange?.(false);
    }
    this.notifyListeners();
  }

  public resetCountdownTracker(): void {
    this.lastCountdownSecondPlayed = null;
  }

  public checkCountdownTick(remainingSeconds: number, configOverride?: Partial<GameAudioConfig>): void {
    const cfg = { ...this.currentConfig, ...(configOverride || {}) };
    if (!cfg.enabled || cfg.countdownSoundEnabled === false || this.muted) return;
    const triggerSec = Math.max(3, Math.min(15, cfg.countdownTriggerSeconds || 5));
    const sec = Math.ceil(remainingSeconds);
    if (sec > 0 && sec <= triggerSec && this.lastCountdownSecondPlayed !== sec) {
      this.lastCountdownSecondPlayed = sec;
      this.lastSfxPlayed = `countdown:${sec}`;
      const pitch = sec <= 2 ? 880 : 660;
      this.playTone(pitch, 0.12, 'sine', 0.24, 0);
    }
  }

  public playCorrect(): void {
    if (this.currentConfig.sfxEnabled === false) return;
    this.lastSfxPlayed = 'correct';
    this.playTone(523.25, 0.12, 'triangle', 0.26, 0);
    this.playTone(659.25, 0.18, 'triangle', 0.28, 0.1);
  }

  public playWrong(): void {
    if (this.currentConfig.sfxEnabled === false) return;
    this.lastSfxPlayed = 'wrong';
    this.playTone(246.94, 0.16, 'sawtooth', 0.22, 0);
    this.playTone(196.0, 0.22, 'sawtooth', 0.22, 0.12);
  }

  public playTimeout(): void {
    if (this.currentConfig.sfxEnabled === false) return;
    this.lastSfxPlayed = 'timeout';
    this.playTone(329.63, 0.14, 'sine', 0.24, 0);
    this.playTone(261.63, 0.24, 'sine', 0.24, 0.12);
  }

  public playAnswerRecorded(): void {
    if (this.currentConfig.sfxEnabled === false) return;
    this.lastSfxPlayed = 'recorded';
    this.playTone(440.0, 0.11, 'sine', 0.24, 0);
  }

  public playVictory(): void {
    if (this.currentConfig.sfxEnabled === false) return;
    this.lastSfxPlayed = 'finish';
    this.playTone(523.25, 0.12, 'triangle', 0.26, 0);
    this.playTone(659.25, 0.12, 'triangle', 0.26, 0.11);
    this.playTone(783.99, 0.25, 'triangle', 0.3, 0.22);
  }
}

export const soundManager = new GameAudioManager();

if (typeof window !== 'undefined') {
  (window as any).__aiGameSoundManager = soundManager;
}
