import type {
  AudioPresetId,
  GameAudioConfig,
  SfxCueType,
  SoundPackId,
} from '../types/index.js';

export const DEFAULT_AUDIO_CONFIG: GameAudioConfig = {
  enabled: true,
  bgmEnabled: true,
  presetId: 'ENERGETIC_ARENA',
  soundPackId: 'ARCADE_FUN',
  customAudioUrl: null,
  customAudioName: null,
  customAudioFileName: null,
  customAudioMimeType: null,
  customAudioSizeBytes: null,
  customSfxOverrides: {},
  volume: 0.7,
  countdownSoundEnabled: true,
  countdownTriggerSeconds: 5,
  sfxEnabled: true,
};

export interface SoundPackDefinition {
  id: SoundPackId;
  packId: SoundPackId;
  presetId: AudioPresetId;
  folder: string;
  label: string;
  description: string;
  cues: Record<SfxCueType, string>;
}

export const SOUND_PACK_CATALOG: SoundPackDefinition[] = [
  {
    id: 'ARCADE_FUN',
    packId: 'ARCADE_FUN',
    presetId: 'ENERGETIC_ARENA',
    folder: 'arcade_fun',
    label: 'Vui nhộn / Arcade (Sôi động)',
    description: 'Tiết tấu nhanh, hiệu ứng tươi sáng, sôi động cho game thi đua.',
    cues: {
      correct: '/audio/packs/arcade_fun/correct.wav',
      wrong: '/audio/packs/arcade_fun/wrong.wav',
      timeout: '/audio/packs/arcade_fun/timeout.wav',
      countdown: '/audio/packs/arcade_fun/countdown.wav',
      start: '/audio/packs/arcade_fun/start.wav',
      finish: '/audio/packs/arcade_fun/finish.wav',
      top3: '/audio/packs/arcade_fun/top3.wav',
    },
  },
  {
    id: 'CLASSROOM_QUIZ',
    packId: 'CLASSROOM_QUIZ',
    presetId: 'EXAM_FOCUS',
    folder: 'classroom_quiz',
    label: 'Học đường / Classroom Quiz (Thân thiện)',
    description: 'Chuông chime rõ ràng, thân thiện, khích lệ học tập và kiểm tra.',
    cues: {
      correct: '/audio/packs/classroom_quiz/correct.wav',
      wrong: '/audio/packs/classroom_quiz/wrong.wav',
      timeout: '/audio/packs/classroom_quiz/timeout.wav',
      countdown: '/audio/packs/classroom_quiz/countdown.wav',
      start: '/audio/packs/classroom_quiz/start.wav',
      finish: '/audio/packs/classroom_quiz/finish.wav',
      top3: '/audio/packs/classroom_quiz/top3.wav',
    },
  },
  {
    id: 'ADVENTURE_QUEST',
    packId: 'ADVENTURE_QUEST',
    presetId: 'ADVENTURE_QUEST',
    folder: 'adventure_quest',
    label: 'Phiêu lưu / Adventure Quest (Kịch tính)',
    description: 'Âm hưởng kèn đồng & hành trình vượt chướng ngại vật kịch tính.',
    cues: {
      correct: '/audio/packs/adventure_quest/correct.wav',
      wrong: '/audio/packs/adventure_quest/wrong.wav',
      timeout: '/audio/packs/adventure_quest/timeout.wav',
      countdown: '/audio/packs/adventure_quest/countdown.wav',
      start: '/audio/packs/adventure_quest/start.wav',
      finish: '/audio/packs/adventure_quest/finish.wav',
      top3: '/audio/packs/adventure_quest/top3.wav',
    },
  },
  {
    id: 'CORPORATE_TRAINING',
    packId: 'CORPORATE_TRAINING',
    presetId: 'CORPORATE_CALM',
    folder: 'corporate_training',
    label: 'Đào tạo Doanh nghiệp / Corporate Training',
    description: 'Âm sắc piano ấm áp, gọn gàng, lịch sự và chuyên nghiệp.',
    cues: {
      correct: '/audio/packs/corporate_training/correct.wav',
      wrong: '/audio/packs/corporate_training/wrong.wav',
      timeout: '/audio/packs/corporate_training/timeout.wav',
      countdown: '/audio/packs/corporate_training/countdown.wav',
      start: '/audio/packs/corporate_training/start.wav',
      finish: '/audio/packs/corporate_training/finish.wav',
      top3: '/audio/packs/corporate_training/top3.wav',
    },
  },
];

export const SFX_CUE_CATALOG: Array<{
  cue: SfxCueType;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    cue: 'correct',
    label: 'Trả lời đúng',
    shortLabel: 'Đúng',
    description: 'Chime/Fanfare tích cực khi chọn đúng đáp án',
  },
  {
    cue: 'wrong',
    label: 'Trả lời sai',
    shortLabel: 'Sai',
    description: 'Âm báo trầm rõ ràng nhưng không chói gắt',
  },
  {
    cue: 'timeout',
    label: 'Hết giờ câu hỏi',
    shortLabel: 'Hết giờ',
    description: 'Tín hiệu kết thúc thời gian làm câu hỏi',
  },
  {
    cue: 'countdown',
    label: 'Đếm ngược giây cuối',
    shortLabel: 'Đếm ngược',
    description: 'Nhịp tick những giây cuối cùng của câu hỏi',
  },
  {
    cue: 'start',
    label: 'Bắt đầu câu hỏi / vòng chơi',
    shortLabel: 'Bắt đầu',
    description: 'Hiệu ứng mở màn câu hỏi hoặc bắt đầu trận đấu',
  },
  {
    cue: 'finish',
    label: 'Hoàn thành màn chơi',
    shortLabel: 'Hoàn thành',
    description: 'Giai điệu tổng kết khi hoàn thành toàn bộ bài',
  },
  {
    cue: 'top3',
    label: 'Vinh danh Top 3 / Kết quả',
    shortLabel: 'Top 3',
    description: 'Fanfare vinh danh bảng vàng Top 3 chung cuộc',
  },
];

export const AUDIO_PRESET_CATALOG: Array<{
  id: AudioPresetId;
  presetId: AudioPresetId;
  soundPackId: SoundPackId;
  label: string;
  description: string;
}> = [
  {
    id: 'ENERGETIC_ARENA',
    presetId: 'ENERGETIC_ARENA',
    soundPackId: 'ARCADE_FUN',
    label: 'Vui nhộn / Arcade — Sôi động Đấu trường',
    description: 'Tiết tấu nhanh, hiệu ứng tươi sáng, sôi động cho game tương tác và thi đua.',
  },
  {
    id: 'EXAM_FOCUS',
    presetId: 'EXAM_FOCUS',
    soundPackId: 'CLASSROOM_QUIZ',
    label: 'Học đường / Classroom Quiz — Tập trung Phòng thi',
    description: 'Âm thanh rõ ràng, thân thiện, giảm xao nhãng cho lớp học & kỳ thi.',
  },
  {
    id: 'ADVENTURE_QUEST',
    presetId: 'ADVENTURE_QUEST',
    soundPackId: 'ADVENTURE_QUEST',
    label: 'Phiêu lưu / Adventure Quest — Hành trình 2D',
    description: 'Giai điệu phiêu lưu kịch tính cho chế độ vượt chướng ngại vật.',
  },
  {
    id: 'CORPORATE_CALM',
    presetId: 'CORPORATE_CALM',
    soundPackId: 'CORPORATE_TRAINING',
    label: 'Đào tạo Doanh nghiệp / Corporate Training',
    description: 'Nhạc nền và hiệu ứng gọn gàng, lịch sự, chuyên nghiệp cho doanh nghiệp.',
  },
  {
    id: 'CUSTOM',
    presetId: 'CUSTOM',
    soundPackId: 'ARCADE_FUN',
    label: 'Nhạc tải lên từ máy (.mp3 / .wav / .ogg)',
    description: 'Sử dụng tệp âm thanh riêng của Ban Tổ Chức (tối đa 10 MB).',
  },
  {
    id: 'NONE',
    presetId: 'NONE',
    soundPackId: 'NONE',
    label: 'Tắt nhạc nền',
    description: 'Không phát nhạc nền, chỉ giữ hiệu ứng âm thanh khi cần.',
  },
];

export function resolveSoundPackDefinition(
  soundPackOrPreset?: SoundPackId | AudioPresetId | string | Partial<GameAudioConfig> | null
): SoundPackDefinition {
  const raw =
    soundPackOrPreset && typeof soundPackOrPreset === 'object'
      ? soundPackOrPreset.soundPackId || soundPackOrPreset.presetId || ''
      : soundPackOrPreset || '';
  const key = String(raw).toUpperCase();
  if (key === 'CLASSROOM_QUIZ' || key === 'EXAM_FOCUS') {
    return SOUND_PACK_CATALOG[1];
  }
  if (key === 'ADVENTURE_QUEST') {
    return SOUND_PACK_CATALOG[2];
  }
  if (key === 'CORPORATE_TRAINING' || key === 'CORPORATE_CALM') {
    return SOUND_PACK_CATALOG[3];
  }
  return SOUND_PACK_CATALOG[0];
}

export function mapSoundPackToPresetId(packId: SoundPackId | AudioPresetId): AudioPresetId {
  switch (packId) {
    case 'ARCADE_FUN':
    case 'ENERGETIC_ARENA':
      return 'ENERGETIC_ARENA';
    case 'CLASSROOM_QUIZ':
    case 'EXAM_FOCUS':
      return 'EXAM_FOCUS';
    case 'ADVENTURE_QUEST':
      return 'ADVENTURE_QUEST';
    case 'CORPORATE_TRAINING':
    case 'CORPORATE_CALM':
      return 'CORPORATE_CALM';
    case 'CUSTOM':
      return 'CUSTOM';
    case 'NONE':
      return 'NONE';
    default:
      return 'ENERGETIC_ARENA';
  }
}

export interface AudioPreviewCallbacks {
  onError?: (message: string) => void;
  onStateChange?: (isPlaying: boolean) => void;
}

export interface AudioDiagnosticsSnapshot {
  contextState: string;
  isPlayingBgm: boolean;
  isPreviewing: boolean;
  isBgmDucked: boolean;
  muted: boolean;
  volume: number;
  volumeNormalized: number;
  activePresetId: AudioPresetId;
  activeSoundPackId: SoundPackId;
  oscillatorsStartedCount: number;
  activeOscillatorCount: number;
  lastGainValue: number;
  lastToneFrequency: number;
  lastSfxPlayed: string | null;
  lastSfxAssetUrl: string | null;
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

interface PackCueNote {
  freq: number;
  dur: number;
  wave: OscillatorType;
  gain: number;
  delay: number;
}

const PACK_SYNTH_PATTERNS: Record<string, Record<SfxCueType, PackCueNote[]>> = {
  ARCADE_FUN: {
    correct: [
      { freq: 523.25, dur: 0.12, wave: 'triangle', gain: 0.25, delay: 0 },
      { freq: 659.25, dur: 0.13, wave: 'triangle', gain: 0.26, delay: 0.08 },
      { freq: 783.99, dur: 0.14, wave: 'triangle', gain: 0.28, delay: 0.16 },
      { freq: 1046.5, dur: 0.22, wave: 'triangle', gain: 0.3, delay: 0.24 },
    ],
    wrong: [
      { freq: 311.13, dur: 0.18, wave: 'sawtooth', gain: 0.22, delay: 0 },
      { freq: 233.08, dur: 0.26, wave: 'sawtooth', gain: 0.24, delay: 0.15 },
    ],
    timeout: [
      { freq: 440.0, dur: 0.12, wave: 'sine', gain: 0.23, delay: 0 },
      { freq: 392.0, dur: 0.12, wave: 'sine', gain: 0.23, delay: 0.12 },
      { freq: 311.13, dur: 0.24, wave: 'triangle', gain: 0.25, delay: 0.24 },
    ],
    countdown: [
      { freq: 880.0, dur: 0.12, wave: 'sine', gain: 0.24, delay: 0 },
    ],
    start: [
      { freq: 392.0, dur: 0.12, wave: 'triangle', gain: 0.24, delay: 0 },
      { freq: 523.25, dur: 0.12, wave: 'triangle', gain: 0.26, delay: 0.1 },
      { freq: 659.25, dur: 0.22, wave: 'triangle', gain: 0.28, delay: 0.2 },
    ],
    finish: [
      { freq: 523.25, dur: 0.12, wave: 'triangle', gain: 0.25, delay: 0 },
      { freq: 659.25, dur: 0.12, wave: 'triangle', gain: 0.26, delay: 0.1 },
      { freq: 783.99, dur: 0.14, wave: 'triangle', gain: 0.28, delay: 0.2 },
      { freq: 1046.5, dur: 0.32, wave: 'triangle', gain: 0.32, delay: 0.32 },
    ],
    top3: [
      { freq: 523.25, dur: 0.12, wave: 'triangle', gain: 0.26, delay: 0 },
      { freq: 523.25, dur: 0.1, wave: 'triangle', gain: 0.26, delay: 0.13 },
      { freq: 659.25, dur: 0.18, wave: 'triangle', gain: 0.28, delay: 0.25 },
      { freq: 783.99, dur: 0.22, wave: 'triangle', gain: 0.3, delay: 0.44 },
      { freq: 1046.5, dur: 0.35, wave: 'triangle', gain: 0.34, delay: 0.66 },
    ],
  },
  CLASSROOM_QUIZ: {
    correct: [
      { freq: 587.33, dur: 0.15, wave: 'sine', gain: 0.26, delay: 0 },
      { freq: 880.0, dur: 0.26, wave: 'sine', gain: 0.28, delay: 0.12 },
    ],
    wrong: [
      { freq: 349.23, dur: 0.16, wave: 'triangle', gain: 0.22, delay: 0 },
      { freq: 293.66, dur: 0.24, wave: 'triangle', gain: 0.22, delay: 0.14 },
    ],
    timeout: [
      { freq: 493.88, dur: 0.14, wave: 'sine', gain: 0.22, delay: 0 },
      { freq: 392.0, dur: 0.26, wave: 'sine', gain: 0.24, delay: 0.14 },
    ],
    countdown: [
      { freq: 740.0, dur: 0.11, wave: 'sine', gain: 0.22, delay: 0 },
    ],
    start: [
      { freq: 440.0, dur: 0.13, wave: 'sine', gain: 0.24, delay: 0 },
      { freq: 554.37, dur: 0.13, wave: 'sine', gain: 0.25, delay: 0.11 },
      { freq: 659.25, dur: 0.2, wave: 'sine', gain: 0.27, delay: 0.22 },
    ],
    finish: [
      { freq: 440.0, dur: 0.13, wave: 'sine', gain: 0.24, delay: 0 },
      { freq: 554.37, dur: 0.13, wave: 'sine', gain: 0.26, delay: 0.12 },
      { freq: 659.25, dur: 0.14, wave: 'sine', gain: 0.27, delay: 0.24 },
      { freq: 880.0, dur: 0.28, wave: 'sine', gain: 0.3, delay: 0.36 },
    ],
    top3: [
      { freq: 587.33, dur: 0.14, wave: 'sine', gain: 0.26, delay: 0 },
      { freq: 739.99, dur: 0.14, wave: 'sine', gain: 0.28, delay: 0.14 },
      { freq: 880.0, dur: 0.18, wave: 'sine', gain: 0.3, delay: 0.28 },
      { freq: 1174.66, dur: 0.32, wave: 'sine', gain: 0.32, delay: 0.46 },
    ],
  },
  ADVENTURE_QUEST: {
    correct: [
      { freq: 440.0, dur: 0.12, wave: 'triangle', gain: 0.26, delay: 0 },
      { freq: 554.37, dur: 0.12, wave: 'triangle', gain: 0.27, delay: 0.1 },
      { freq: 659.25, dur: 0.14, wave: 'triangle', gain: 0.28, delay: 0.2 },
      { freq: 880.0, dur: 0.22, wave: 'triangle', gain: 0.3, delay: 0.3 },
    ],
    wrong: [
      { freq: 261.63, dur: 0.18, wave: 'sawtooth', gain: 0.23, delay: 0 },
      { freq: 196.0, dur: 0.26, wave: 'sawtooth', gain: 0.25, delay: 0.16 },
    ],
    timeout: [
      { freq: 392.0, dur: 0.14, wave: 'triangle', gain: 0.24, delay: 0 },
      { freq: 329.63, dur: 0.14, wave: 'triangle', gain: 0.24, delay: 0.14 },
      { freq: 246.94, dur: 0.24, wave: 'sawtooth', gain: 0.26, delay: 0.28 },
    ],
    countdown: [
      { freq: 659.25, dur: 0.13, wave: 'triangle', gain: 0.25, delay: 0 },
    ],
    start: [
      { freq: 293.66, dur: 0.14, wave: 'triangle', gain: 0.25, delay: 0 },
      { freq: 440.0, dur: 0.14, wave: 'triangle', gain: 0.27, delay: 0.13 },
      { freq: 587.33, dur: 0.24, wave: 'triangle', gain: 0.3, delay: 0.26 },
    ],
    finish: [
      { freq: 392.0, dur: 0.14, wave: 'triangle', gain: 0.26, delay: 0 },
      { freq: 493.88, dur: 0.14, wave: 'triangle', gain: 0.27, delay: 0.12 },
      { freq: 587.33, dur: 0.15, wave: 'triangle', gain: 0.29, delay: 0.24 },
      { freq: 783.99, dur: 0.34, wave: 'triangle', gain: 0.32, delay: 0.38 },
    ],
    top3: [
      { freq: 440.0, dur: 0.14, wave: 'triangle', gain: 0.27, delay: 0 },
      { freq: 554.37, dur: 0.14, wave: 'triangle', gain: 0.28, delay: 0.14 },
      { freq: 659.25, dur: 0.16, wave: 'triangle', gain: 0.3, delay: 0.28 },
      { freq: 880.0, dur: 0.2, wave: 'triangle', gain: 0.32, delay: 0.44 },
      { freq: 1108.73, dur: 0.36, wave: 'triangle', gain: 0.34, delay: 0.64 },
    ],
  },
  CORPORATE_TRAINING: {
    correct: [
      { freq: 523.25, dur: 0.14, wave: 'sine', gain: 0.24, delay: 0 },
      { freq: 783.99, dur: 0.24, wave: 'sine', gain: 0.26, delay: 0.11 },
    ],
    wrong: [
      { freq: 329.63, dur: 0.15, wave: 'sine', gain: 0.21, delay: 0 },
      { freq: 261.63, dur: 0.22, wave: 'sine', gain: 0.22, delay: 0.13 },
    ],
    timeout: [
      { freq: 440.0, dur: 0.14, wave: 'sine', gain: 0.22, delay: 0 },
      { freq: 349.23, dur: 0.24, wave: 'sine', gain: 0.23, delay: 0.13 },
    ],
    countdown: [
      { freq: 659.25, dur: 0.1, wave: 'sine', gain: 0.21, delay: 0 },
    ],
    start: [
      { freq: 392.0, dur: 0.14, wave: 'sine', gain: 0.23, delay: 0 },
      { freq: 523.25, dur: 0.24, wave: 'sine', gain: 0.26, delay: 0.12 },
    ],
    finish: [
      { freq: 523.25, dur: 0.14, wave: 'sine', gain: 0.24, delay: 0 },
      { freq: 659.25, dur: 0.14, wave: 'sine', gain: 0.26, delay: 0.13 },
      { freq: 783.99, dur: 0.3, wave: 'sine', gain: 0.28, delay: 0.26 },
    ],
    top3: [
      { freq: 523.25, dur: 0.14, wave: 'sine', gain: 0.25, delay: 0 },
      { freq: 659.25, dur: 0.14, wave: 'sine', gain: 0.26, delay: 0.13 },
      { freq: 783.99, dur: 0.16, wave: 'sine', gain: 0.28, delay: 0.26 },
      { freq: 1046.5, dur: 0.32, wave: 'sine', gain: 0.3, delay: 0.42 },
    ],
  },
};

class GameAudioManager {
  private ctx: AudioContext | null = null;
  private bgmLoopInterval: number | null = null;
  private customAudioEl: HTMLAudioElement | null = null;
  private activeSfxAudioElements: Map<string, HTMLAudioElement> = new Map();
  private duckTimeoutId: number | null = null;
  private isBgmDucked: boolean = false;
  private isPlayingBgm: boolean = false;
  private isPreviewing: boolean = false;
  private muted: boolean = false;
  private volume: number = 70; // 0..100 integer percentage
  private currentConfig: GameAudioConfig = { ...DEFAULT_AUDIO_CONFIG };
  private lastCountdownSecondPlayed: number | null = null;
  private lastCuePlayedAtMap: Map<string, number> = new Map();
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
  private lastSfxAssetUrl: string | null = null;
  private lastError: string | null = null;

  constructor() {
    try {
      const savedMuted = localStorage.getItem(STORAGE_MUTED_KEY);
      if (savedMuted === 'true') this.muted = true;
      const savedVol = localStorage.getItem(STORAGE_VOLUME_KEY);
      if (savedVol !== null) {
        const parsed = Number(savedVol);
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

  public getActiveSoundPack(): SoundPackDefinition {
    return resolveSoundPackDefinition(
      this.currentConfig.soundPackId || this.currentConfig.presetId
    );
  }

  public getDiagnostics(): AudioDiagnosticsSnapshot {
    const activePack = this.getActiveSoundPack();
    return {
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
      isPlayingBgm: this.isPlayingBgm,
      isPreviewing: this.isPreviewing,
      isBgmDucked: this.isBgmDucked,
      muted: this.muted,
      volume: this.volume,
      volumeNormalized: this.getVolumeNormalized(),
      activePresetId: this.currentConfig.presetId,
      activeSoundPackId: activePack.packId,
      oscillatorsStartedCount: this.oscillatorsStartedCount,
      activeOscillatorCount: this.activeOscillatorCount,
      lastGainValue: Number(this.lastGainValue.toFixed(4)),
      lastToneFrequency: Number(this.lastToneFrequency.toFixed(2)),
      lastSfxPlayed: this.lastSfxPlayed,
      lastSfxAssetUrl: this.lastSfxAssetUrl,
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
    const merged: GameAudioConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      ...this.currentConfig,
      ...(partialConfig || {}),
      volume: Number((nextVolPercent / 100).toFixed(2)),
    };
    if (partialConfig?.soundPackId && !partialConfig?.presetId) {
      merged.presetId = mapSoundPackToPresetId(partialConfig.soundPackId);
    } else if (partialConfig?.presetId && !partialConfig?.soundPackId) {
      merged.soundPackId = resolveSoundPackDefinition(partialConfig.presetId).packId;
    }
    this.currentConfig = merged;
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

  public playSfx(
    type: 'correct' | 'wrong' | 'timeout' | 'recorded' | 'finish' | 'start' | 'top3' | 'countdown'
  ): void {
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
      case 'start':
        this.playStart();
        break;
      case 'finish':
        this.playVictory();
        break;
      case 'top3':
        this.playTop3Celebration();
        break;
      case 'countdown':
        this.playCueFromActivePack('countdown');
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
    for (const el of this.activeSfxAudioElements.values()) {
      el.muted = this.muted;
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
      const duckFactor = this.isBgmDucked ? 0.28 : 1.0;
      this.customAudioEl.volume = Math.max(0, Math.min(1, (clamped / 100) * duckFactor));
    }
    this.notifyListeners();
  }

  private duckBgmTemporarily(durationMs: number = 650): void {
    if (!this.isPlayingBgm) return;
    this.isBgmDucked = true;
    if (this.customAudioEl) {
      this.customAudioEl.volume = Math.max(0, Math.min(1, (this.volume / 100) * 0.28));
    }
    if (this.duckTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.duckTimeoutId);
    }
    if (typeof window !== 'undefined') {
      this.duckTimeoutId = window.setTimeout(() => {
        this.isBgmDucked = false;
        this.duckTimeoutId = null;
        if (this.customAudioEl) {
          this.customAudioEl.volume = Math.max(0, Math.min(1, this.volume / 100));
        }
      }, durationMs);
    }
  }

  private getEffectiveGain(multiplier: number = 1, isBgmTone: boolean = false): number {
    if (this.muted || !this.currentConfig.enabled || this.volume <= 0) return 0;
    const duckFactor = isBgmTone && this.isBgmDucked ? 0.28 : 1.0;
    return Math.min(1, Math.max(0, (this.volume / 100) * multiplier * duckFactor));
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    gainMultiplier: number = 0.18,
    delaySec: number = 0,
    isBgmTone: boolean = false
  ): boolean {
    const ctx = this.ensureContext();
    const gainVal = this.getEffectiveGain(gainMultiplier, isBgmTone);
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

  private playWavAssetFile(assetUrl: string, cueKey: string): void {
    if (typeof window === 'undefined' || typeof Audio === 'undefined' || this.muted || this.volume <= 0) {
      return;
    }
    try {
      // Stop any previous instance of the same cue so identical SFX never overlap
      const existing = this.activeSfxAudioElements.get(cueKey);
      if (existing) {
        try {
          existing.pause();
          existing.currentTime = 0;
        } catch {}
      }

      const audio = new Audio(assetUrl);
      audio.volume = Math.max(0, Math.min(1, this.volume / 100));
      audio.muted = this.muted;
      this.activeSfxAudioElements.set(cueKey, audio);
      this.lastSfxAssetUrl = assetUrl;

      audio.onended = () => {
        if (this.activeSfxAudioElements.get(cueKey) === audio) {
          this.activeSfxAudioElements.delete(cueKey);
        }
      };

      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Synthesized multi-harmonic Web Audio layer already provides guaranteed audible output
        });
      }
    } catch {
      // Ignore HTMLAudioElement errors when running in isolated headless environments
    }
  }

  public resolveCueAssetUrl(cue: SfxCueType, configOverride?: Partial<GameAudioConfig>): string {
    const cfg = { ...this.currentConfig, ...(configOverride || {}) };
    const customOverride = cfg.customSfxOverrides?.[cue] as any;
    const customUrl = customOverride?.url || customOverride?.audioUrl;
    if (customOverride && typeof customUrl === 'string' && customUrl.trim()) {
      return customUrl.trim();
    }
    const pack = resolveSoundPackDefinition(cfg.soundPackId || cfg.presetId);
    return pack.cues[cue] || SOUND_PACK_CATALOG[0].cues[cue];
  }

  private playCueFromActivePack(
    cue: SfxCueType,
    configOverride?: Partial<GameAudioConfig>,
    forcePlayForPreview: boolean = false
  ): boolean {
    const cfg = { ...this.currentConfig, ...(configOverride || {}) };
    if (!forcePlayForPreview) {
      if (this.muted || !cfg.enabled || cfg.sfxEnabled === false || this.volume <= 0) {
        return false;
      }
      // Deduplicate rapid identical SFX triggers within 90ms (e.g. WS reconnect duplicate packets)
      const nowMs = Date.now();
      const prevAt = this.lastCuePlayedAtMap.get(cue) || 0;
      if (nowMs - prevAt < 90) {
        return false;
      }
      this.lastCuePlayedAtMap.set(cue, nowMs);
    }

    const pack = resolveSoundPackDefinition(cfg.soundPackId || cfg.presetId);
    const assetUrl = this.resolveCueAssetUrl(cue, cfg);
    this.lastSfxPlayed = cue;
    this.lastSfxAssetUrl = assetUrl;

    // Duck BGM briefly so the SFX stands out clearly
    const duckMs = cue === 'top3' || cue === 'finish' ? 950 : 520;
    this.duckBgmTemporarily(duckMs);

    // Play real WAV/custom asset file
    this.playWavAssetFile(assetUrl, cue);

    // Also trigger multi-harmonic Web Audio notes for zero-latency response & telemetry
    const packNotes =
      PACK_SYNTH_PATTERNS[pack.packId]?.[cue] || PACK_SYNTH_PATTERNS.ARCADE_FUN[cue];
    let startedAny = false;
    for (const n of packNotes) {
      const ok = this.playTone(n.freq, n.dur, n.wave, n.gain, n.delay, false);
      if (ok) startedAny = true;
    }
    return startedAny;
  }

  /**
   * Previews a single SFX cue (correct, wrong, timeout, countdown, start, finish, top3)
   * when BTC clicks the individual cue preview button in the Sound Pack configurator.
   */
  public previewSfxCue(
    cue: SfxCueType,
    configOverride?: Partial<GameAudioConfig>,
    callbacks?: AudioPreviewCallbacks
  ): boolean {
    if (this.muted) {
      this.muted = false;
      try {
        localStorage.setItem(STORAGE_MUTED_KEY, 'false');
      } catch {}
    }
    const rawVol =
      configOverride?.volume !== undefined
        ? normalizeVolumeToPercent(configOverride.volume, 70)
        : this.volume;
    const effectiveVol = rawVol <= 0 ? 70 : rawVol;
    this.volume = effectiveVol;
    this.configure({
      ...(configOverride || {}),
      enabled: true,
      sfxEnabled: true,
      volume: Number((effectiveVol / 100).toFixed(2)),
    });
    this.ensureContext();
    const ok = this.playCueFromActivePack(cue, this.currentConfig, true);
    if (!ok && callbacks?.onError) {
      callbacks.onError('Không thể phát hiệu ứng âm thanh. Vui lòng kiểm tra thiết bị âm thanh.');
    }
    this.notifyListeners();
    return ok;
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

    const merged: GameAudioConfig = {
      ...DEFAULT_AUDIO_CONFIG,
      ...(partialConfig || {}),
      volume: Number((resolvedVolPercent / 100).toFixed(2)),
    };
    if (partialConfig?.soundPackId && !partialConfig?.presetId) {
      merged.presetId = mapSoundPackToPresetId(partialConfig.soundPackId);
    } else if (partialConfig?.presetId && !partialConfig?.soundPackId) {
      merged.soundPackId = resolveSoundPackDefinition(partialConfig.presetId).packId;
    }
    this.currentConfig = merged;

    const bgmAllowed =
      this.currentConfig.enabled &&
      this.currentConfig.bgmEnabled !== false &&
      this.currentConfig.presetId !== 'NONE';

    if (!bgmAllowed) {
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
        bgmEnabled: config.presetId !== 'NONE',
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
    if (this.muted || !config.enabled || config.bgmEnabled === false || config.presetId === 'NONE') {
      return;
    }

    if (config.presetId === 'CUSTOM' || (config.customAudioUrl && config.customAudioUrl.trim())) {
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
      ARCADE_FUN: {
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
      CLASSROOM_QUIZ: {
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
      CORPORATE_TRAINING: {
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
      this.playTone(note, (preset.tempoMs / 1000) * 0.82, preset.wave, preset.gain, 0, true);
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
   * Stops all background music and active SFX elements (called on unmount/exit/finish).
   */
  public stopAll(): void {
    const wasPreviewing = this.isPreviewing;
    const cb = this.previewCallbacks;
    this.isPlayingBgm = false;
    this.isPreviewing = false;
    this.isBgmDucked = false;
    this.previewCallbacks = null;
    this.lastCountdownSecondPlayed = null;
    if (this.duckTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.duckTimeoutId);
      this.duckTimeoutId = null;
    }
    this.stopBgmInternal();
    for (const el of this.activeSfxAudioElements.values()) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    }
    this.activeSfxAudioElements.clear();
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
      const assetUrl = this.resolveCueAssetUrl('countdown', cfg);
      this.playWavAssetFile(assetUrl, 'countdown');
      const pitch = sec <= 2 ? 880 : 660;
      this.playTone(pitch, 0.12, 'sine', 0.24, 0, false);
    }
  }

  public playStart(): void {
    this.playCueFromActivePack('start');
  }

  public playCorrect(): void {
    this.playCueFromActivePack('correct');
  }

  public playWrong(): void {
    this.playCueFromActivePack('wrong');
  }

  public playTimeout(): void {
    this.playCueFromActivePack('timeout');
  }

  public playAnswerRecorded(): void {
    if (this.currentConfig.sfxEnabled === false || this.muted || !this.currentConfig.enabled) return;
    this.lastSfxPlayed = 'recorded';
    this.duckBgmTemporarily(320);
    this.playTone(440.0, 0.11, 'sine', 0.24, 0, false);
  }

  public playVictory(): void {
    this.playCueFromActivePack('finish');
  }

  public playTop3Celebration(): void {
    this.playCueFromActivePack('top3');
  }
}

export const soundManager = new GameAudioManager();

if (typeof window !== 'undefined') {
  (window as any).__aiGameSoundManager = soundManager;
}
