import type { AudioPresetId, GameAudioConfig } from '../types/index.js';

export const DEFAULT_AUDIO_CONFIG: GameAudioConfig = {
  enabled: true,
  presetId: 'ENERGETIC_ARENA',
  customAudioUrl: null,
  customAudioFileName: null,
  customAudioMimeType: null,
  customAudioSizeBytes: null,
  volume: 70,
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

const STORAGE_MUTED_KEY = 'ai_game_audio_muted_v2';
const STORAGE_VOLUME_KEY = 'ai_game_audio_volume_v2';

class GameAudioManager {
  private ctx: AudioContext | null = null;
  private bgmLoopInterval: number | null = null;
  private customAudioEl: HTMLAudioElement | null = null;
  private isPlayingBgm: boolean = false;
  private isPreviewing: boolean = false;
  private muted: boolean = false;
  private volume: number = 70; // 0..100
  private currentConfig: GameAudioConfig = { ...DEFAULT_AUDIO_CONFIG };
  private lastCountdownSecondPlayed: number | null = null;
  private stepIndex: number = 0;

  constructor() {
    try {
      const savedMuted = localStorage.getItem(STORAGE_MUTED_KEY);
      if (savedMuted === 'true') this.muted = true;
      const savedVol = localStorage.getItem(STORAGE_VOLUME_KEY);
      if (savedVol !== null) {
        const parsed = Number(savedVol);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
          this.volume = Math.round(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public getMuted(): boolean {
    return this.muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public configure(partialConfig?: Partial<GameAudioConfig>): void {
    this.currentConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      ...(partialConfig || {}),
    };
    if (partialConfig?.volume !== undefined && Number.isFinite(partialConfig.volume)) {
      const vol = partialConfig.volume <= 1 ? Math.round(partialConfig.volume * 100) : Math.round(partialConfig.volume);
      this.volume = Math.max(0, Math.min(100, vol));
    }
  }

  public startBackgroundMusic(partialConfig?: Partial<GameAudioConfig>): void {
    this.startSessionAudio(partialConfig || this.currentConfig, false);
  }

  public stopBackgroundMusic(): void {
    this.stopAll();
  }

  public playPreview(config: Partial<GameAudioConfig>): void {
    this.previewAudio(config);
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

  public getVolume(): number {
    return this.volume;
  }

  public getIsPlaying(): boolean {
    return this.isPlayingBgm;
  }

  public getIsPreviewing(): boolean {
    return this.isPreviewing;
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
    } else if (this.isPlayingBgm) {
      this.startBgmLoop(this.currentConfig);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(vol) || 0)));
    this.volume = clamped;
    try {
      localStorage.setItem(STORAGE_VOLUME_KEY, String(clamped));
    } catch {}
    if (this.customAudioEl) {
      this.customAudioEl.volume = clamped / 100;
    }
  }

  private getEffectiveGain(multiplier: number = 1): number {
    if (this.muted || !this.currentConfig.enabled || this.volume <= 0) return 0;
    return Math.min(1, Math.max(0, (this.volume / 100) * multiplier));
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    gainMultiplier: number = 0.12,
    delaySec: number = 0
  ): void {
    const gainVal = this.getEffectiveGain(gainMultiplier);
    if (gainVal <= 0.001) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

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
      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch {
      // ignore audio node errors
    }
  }

  /**
   * Starts or updates background music for a game session or preview.
   * Ensures any previous loop or HTMLAudioElement is stopped first so tracks never overlap.
   */
  public startSessionAudio(partialConfig?: Partial<GameAudioConfig>, isPreview: boolean = false): void {
    this.stopAll();
    this.currentConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      ...(partialConfig || {}),
    };
    if (partialConfig?.volume !== undefined && Number.isFinite(partialConfig.volume)) {
      this.volume = Math.max(0, Math.min(100, Math.round(partialConfig.volume)));
    }
    this.isPlayingBgm = true;
    this.isPreviewing = isPreview;
    this.lastCountdownSecondPlayed = null;

    if (!this.muted && this.currentConfig.enabled && this.currentConfig.presetId !== 'NONE') {
      this.startBgmLoop(this.currentConfig);
    }
  }

  public previewAudio(config: Partial<GameAudioConfig>): void {
    this.startSessionAudio({ ...config, enabled: true }, true);
  }

  public stopPreview(): void {
    if (this.isPreviewing) {
      this.stopAll();
    }
  }

  private startBgmLoop(config: GameAudioConfig): void {
    this.stopBgmInternal();
    if (this.muted || !config.enabled || config.presetId === 'NONE') return;

    if (config.presetId === 'CUSTOM' && config.customAudioUrl) {
      try {
        const audio = new Audio(config.customAudioUrl);
        audio.loop = true;
        audio.volume = Math.max(0, Math.min(1, this.volume / 100));
        audio.muted = this.muted;
        this.customAudioEl = audio;
        audio.play().catch(() => {
          // Browser autoplay policy blocked until next user gesture
        });
      } catch {
        // ignore
      }
      return;
    }

    // Built-in synthesized BGM loop
    this.stepIndex = 0;
    const notesByPreset: Record<string, { notes: number[]; tempoMs: number; wave: OscillatorType; gain: number }> = {
      ENERGETIC_ARENA: {
        notes: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23],
        tempoMs: 420,
        wave: 'triangle',
        gain: 0.06,
      },
      EXAM_FOCUS: {
        notes: [220.0, 277.18, 329.63, 277.18, 196.0, 246.94, 293.66, 246.94],
        tempoMs: 900,
        wave: 'sine',
        gain: 0.035,
      },
      ADVENTURE_QUEST: {
        notes: [293.66, 369.99, 440.0, 587.33, 493.88, 440.0, 369.99, 329.63],
        tempoMs: 380,
        wave: 'triangle',
        gain: 0.055,
      },
      CORPORATE_CALM: {
        notes: [261.63, 329.63, 392.0, 493.88, 440.0, 392.0, 329.63, 293.66],
        tempoMs: 700,
        wave: 'sine',
        gain: 0.04,
      },
    };

    const preset = notesByPreset[config.presetId] || notesByPreset.ENERGETIC_ARENA;
    const playStep = () => {
      if (!this.isPlayingBgm || this.muted || !this.currentConfig.enabled) return;
      const note = preset.notes[this.stepIndex % preset.notes.length];
      this.stepIndex++;
      this.playTone(note, (preset.tempoMs / 1000) * 0.85, preset.wave, preset.gain, 0);
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
      try {
        this.customAudioEl.pause();
        this.customAudioEl.currentTime = 0;
        this.customAudioEl.src = '';
      } catch {}
      this.customAudioEl = null;
    }
  }

  /**
   * Stops all background music and resets countdown state (called on unmount/exit/finish).
   */
  public stopAll(): void {
    this.isPlayingBgm = false;
    this.isPreviewing = false;
    this.lastCountdownSecondPlayed = null;
    this.stopBgmInternal();
  }

  public resetCountdownTracker(): void {
    this.lastCountdownSecondPlayed = null;
  }

  public checkCountdownTick(remainingSeconds: number, configOverride?: Partial<GameAudioConfig>): void {
    const cfg = { ...this.currentConfig, ...(configOverride || {}) };
    if (!cfg.enabled || !cfg.countdownSoundEnabled || this.muted) return;
    const triggerSec = Math.max(3, Math.min(15, cfg.countdownTriggerSeconds || 5));
    const sec = Math.ceil(remainingSeconds);
    if (sec > 0 && sec <= triggerSec && this.lastCountdownSecondPlayed !== sec) {
      this.lastCountdownSecondPlayed = sec;
      const pitch = sec <= 2 ? 880 : 660;
      this.playTone(pitch, 0.12, 'sine', 0.14, 0);
    }
  }

  public playCorrect(): void {
    if (!this.currentConfig.sfxEnabled) return;
    this.playTone(523.25, 0.12, 'triangle', 0.15, 0);
    this.playTone(659.25, 0.18, 'triangle', 0.16, 0.1);
  }

  public playWrong(): void {
    if (!this.currentConfig.sfxEnabled) return;
    this.playTone(246.94, 0.16, 'sawtooth', 0.11, 0);
    this.playTone(196.0, 0.22, 'sawtooth', 0.11, 0.12);
  }

  public playTimeout(): void {
    if (!this.currentConfig.sfxEnabled) return;
    this.playTone(329.63, 0.14, 'sine', 0.13, 0);
    this.playTone(261.63, 0.24, 'sine', 0.13, 0.12);
  }

  public playAnswerRecorded(): void {
    if (!this.currentConfig.sfxEnabled) return;
    this.playTone(440.0, 0.1, 'sine', 0.12, 0);
  }

  public playVictory(): void {
    if (!this.currentConfig.sfxEnabled) return;
    this.playTone(523.25, 0.12, 'triangle', 0.15, 0);
    this.playTone(659.25, 0.12, 'triangle', 0.15, 0.11);
    this.playTone(783.99, 0.25, 'triangle', 0.17, 0.22);
  }
}

export const soundManager = new GameAudioManager();
