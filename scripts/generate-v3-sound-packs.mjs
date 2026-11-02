import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAMPLE_RATE = 22050;

/**
 * Renders a multi-layered acoustic instrument note/chord sequence into 16-bit PCM WAV buffer.
 * Each note has:
 * - freq: fundamental frequency (Hz)
 * - startSec: start offset (s)
 * - durationSec: note length (s)
 * - harmonics: array of [multiple, relativeAmplitude]
 * - attackSec: envelope attack
 * - decayPower: exponential decay shaping
 * - vibratoHz / vibratoDepth: subtle musical modulation
 * - pitchSlideRatio: end frequency ratio (e.g. 0.75 for downward slide)
 */
function synthesizeMultiLayeredWav(notes, totalDurationSec) {
  const numSamples = Math.max(256, Math.floor(SAMPLE_RATE * totalDurationSec));
  const floatSamples = new Float64Array(numSamples);

  for (const n of notes) {
    const startIdx = Math.max(0, Math.floor(n.startSec * SAMPLE_RATE));
    const endIdx = Math.min(numSamples, Math.floor((n.startSec + n.durationSec) * SAMPLE_RATE));
    const len = Math.max(1, endIdx - startIdx);
    const attackSamples = Math.max(1, Math.floor((n.attackSec ?? 0.008) * SAMPLE_RATE));
    const harmonics = n.harmonics || [
      [1, 1.0],
      [2, 0.35],
      [3, 0.15],
    ];
    const amp = n.gain ?? 0.35;
    const decayPower = n.decayPower ?? 1.8;
    const slideRatio = n.pitchSlideRatio ?? 1.0;
    const vibHz = n.vibratoHz ?? 0;
    const vibDepth = n.vibratoDepth ?? 0;

    let phase = 0;
    for (let i = 0; i < len; i++) {
      const progress = i / len;
      const t = i / SAMPLE_RATE;
      const instFreq =
        n.freq * (1 + (slideRatio - 1) * progress) * (1 + (vibHz > 0 ? Math.sin(2 * Math.PI * vibHz * t) * vibDepth : 0));
      phase += (2 * Math.PI * instFreq) / SAMPLE_RATE;

      // Envelope
      let env = 1.0;
      if (i < attackSamples) {
        env = i / attackSamples;
      } else {
        const rem = 1.0 - (i - attackSamples) / Math.max(1, len - attackSamples);
        env = Math.pow(Math.max(0, rem), decayPower);
      }

      let sampleVal = 0;
      for (const [mult, hAmp] of harmonics) {
        sampleVal += Math.sin(phase * mult) * hAmp;
      }

      floatSamples[startIdx + i] += sampleVal * env * amp;
    }
  }

  // Normalize to prevent clipping while keeping crisp loudness
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(floatSamples[i]);
    if (abs > peak) peak = abs;
  }
  const normFactor = peak > 0.92 ? 0.9 / peak : 1.0;

  const dataByteLength = numSamples * 2;
  const wavBuffer = Buffer.alloc(44 + dataByteLength);

  // RIFF WAVE Header
  wavBuffer.write('RIFF', 0, 'ascii');
  wavBuffer.writeUInt32LE(36 + dataByteLength, 4);
  wavBuffer.write('WAVE', 8, 'ascii');
  wavBuffer.write('fmt ', 12, 'ascii');
  wavBuffer.writeUInt32LE(16, 16); // PCM chunk size
  wavBuffer.writeUInt16LE(1, 20); // PCM format = 1
  wavBuffer.writeUInt16LE(1, 22); // Mono = 1 channel
  wavBuffer.writeUInt32LE(SAMPLE_RATE, 24);
  wavBuffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // ByteRate
  wavBuffer.writeUInt16LE(2, 32); // BlockAlign
  wavBuffer.writeUInt16LE(16, 34); // BitsPerSample
  wavBuffer.write('data', 36, 'ascii');
  wavBuffer.writeUInt32LE(dataByteLength, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i] * normFactor));
    const int16 = Math.round(clamped * 32767);
    wavBuffer.writeInt16LE(int16, 44 + i * 2);
  }

  return wavBuffer;
}

const BRIGHT_SYNTH_HARMONICS = [
  [1, 1.0],
  [2, 0.55],
  [3, 0.35],
  [4, 0.18],
  [5, 0.09],
];

const BELL_CHIME_HARMONICS = [
  [1, 1.0],
  [2.0, 0.42],
  [3.01, 0.25],
  [4.02, 0.12],
];

const BRASS_QUEST_HARMONICS = [
  [1, 1.0],
  [2, 0.72],
  [3, 0.52],
  [4, 0.34],
  [5, 0.2],
  [6, 0.1],
];

const WARM_PIANO_HARMONICS = [
  [1, 1.0],
  [2, 0.28],
  [3, 0.09],
  [4, 0.03],
];

const SOUND_PACK_Specs = {
  arcade_fun: {
    packId: 'ARCADE_FUN',
    label: 'Vui nhộn / Arcade (Sôi động)',
    cues: {
      correct: {
        duration: 0.52,
        notes: [
          { freq: 523.25, startSec: 0.0, durationSec: 0.14, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.35 },
          { freq: 659.25, startSec: 0.09, durationSec: 0.15, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.38 },
          { freq: 783.99, startSec: 0.18, durationSec: 0.16, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.4 },
          { freq: 1046.5, startSec: 0.27, durationSec: 0.24, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.44, vibratoHz: 8, vibratoDepth: 0.01 },
          { freq: 523.25, startSec: 0.27, durationSec: 0.24, harmonics: BELL_CHIME_HARMONICS, gain: 0.22 },
        ],
      },
      wrong: {
        duration: 0.48,
        notes: [
          { freq: 311.13, startSec: 0.0, durationSec: 0.2, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.36, pitchSlideRatio: 0.88 },
          { freq: 233.08, startSec: 0.18, durationSec: 0.28, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.38, pitchSlideRatio: 0.76 },
          { freq: 116.54, startSec: 0.18, durationSec: 0.28, harmonics: [[1, 1], [2, 0.5]], gain: 0.24 },
        ],
      },
      timeout: {
        duration: 0.56,
        notes: [
          { freq: 440.0, startSec: 0.0, durationSec: 0.13, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.35 },
          { freq: 392.0, startSec: 0.13, durationSec: 0.13, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.35 },
          { freq: 349.23, startSec: 0.26, durationSec: 0.28, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.38, pitchSlideRatio: 0.72 },
        ],
      },
      countdown: {
        duration: 0.18,
        notes: [
          { freq: 880.0, startSec: 0.0, durationSec: 0.15, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.36, decayPower: 2.6 },
          { freq: 1760.0, startSec: 0.0, durationSec: 0.08, harmonics: [[1, 0.6]], gain: 0.18, decayPower: 3.2 },
        ],
      },
      start: {
        duration: 0.55,
        notes: [
          { freq: 392.0, startSec: 0.0, durationSec: 0.14, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.35 },
          { freq: 523.25, startSec: 0.12, durationSec: 0.14, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.38 },
          { freq: 659.25, startSec: 0.24, durationSec: 0.28, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.42 },
          { freq: 329.63, startSec: 0.24, durationSec: 0.28, harmonics: WARM_PIANO_HARMONICS, gain: 0.25 },
        ],
      },
      finish: {
        duration: 0.85,
        notes: [
          { freq: 523.25, startSec: 0.0, durationSec: 0.14, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.36 },
          { freq: 659.25, startSec: 0.12, durationSec: 0.14, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.38 },
          { freq: 783.99, startSec: 0.24, durationSec: 0.16, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.4 },
          { freq: 1046.5, startSec: 0.38, durationSec: 0.44, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.45, vibratoHz: 6, vibratoDepth: 0.008 },
          { freq: 659.25, startSec: 0.38, durationSec: 0.44, harmonics: BELL_CHIME_HARMONICS, gain: 0.25 },
          { freq: 523.25, startSec: 0.38, durationSec: 0.44, harmonics: WARM_PIANO_HARMONICS, gain: 0.25 },
        ],
      },
      top3: {
        duration: 1.05,
        notes: [
          { freq: 523.25, startSec: 0.0, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.35 },
          { freq: 523.25, startSec: 0.16, durationSec: 0.12, harmonics: BRASS_QUEST_HARMONICS, gain: 0.35 },
          { freq: 523.25, startSec: 0.29, durationSec: 0.12, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
          { freq: 659.25, startSec: 0.42, durationSec: 0.22, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
          { freq: 783.99, startSec: 0.64, durationSec: 0.38, harmonics: BRASS_QUEST_HARMONICS, gain: 0.44 },
          { freq: 1046.5, startSec: 0.64, durationSec: 0.38, harmonics: BELL_CHIME_HARMONICS, gain: 0.3 },
        ],
      },
    },
  },
  classroom_quiz: {
    packId: 'CLASSROOM_QUIZ',
    label: 'Học đường / Classroom Quiz (Thân thiện)',
    cues: {
      correct: {
        duration: 0.48,
        notes: [
          { freq: 587.33, startSec: 0.0, durationSec: 0.18, harmonics: BELL_CHIME_HARMONICS, gain: 0.38 },
          { freq: 880.0, startSec: 0.14, durationSec: 0.32, harmonics: BELL_CHIME_HARMONICS, gain: 0.44 },
          { freq: 440.0, startSec: 0.14, durationSec: 0.32, harmonics: WARM_PIANO_HARMONICS, gain: 0.24 },
        ],
      },
      wrong: {
        duration: 0.44,
        notes: [
          { freq: 349.23, startSec: 0.0, durationSec: 0.18, harmonics: WARM_PIANO_HARMONICS, gain: 0.36 },
          { freq: 293.66, startSec: 0.16, durationSec: 0.26, harmonics: WARM_PIANO_HARMONICS, gain: 0.38, pitchSlideRatio: 0.92 },
        ],
      },
      timeout: {
        duration: 0.5,
        notes: [
          { freq: 493.88, startSec: 0.0, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.34 },
          { freq: 392.0, startSec: 0.16, durationSec: 0.32, harmonics: BELL_CHIME_HARMONICS, gain: 0.36 },
        ],
      },
      countdown: {
        duration: 0.16,
        notes: [
          { freq: 740.0, startSec: 0.0, durationSec: 0.14, harmonics: WARM_PIANO_HARMONICS, gain: 0.36, decayPower: 2.8 },
        ],
      },
      start: {
        duration: 0.5,
        notes: [
          { freq: 440.0, startSec: 0.0, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.35 },
          { freq: 554.37, startSec: 0.13, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.38 },
          { freq: 659.25, startSec: 0.26, durationSec: 0.22, harmonics: BELL_CHIME_HARMONICS, gain: 0.42 },
        ],
      },
      finish: {
        duration: 0.78,
        notes: [
          { freq: 440.0, startSec: 0.0, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.35 },
          { freq: 554.37, startSec: 0.14, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.38 },
          { freq: 659.25, startSec: 0.28, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.4 },
          { freq: 880.0, startSec: 0.42, durationSec: 0.34, harmonics: BELL_CHIME_HARMONICS, gain: 0.44 },
          { freq: 554.37, startSec: 0.42, durationSec: 0.34, harmonics: WARM_PIANO_HARMONICS, gain: 0.24 },
        ],
      },
      top3: {
        duration: 0.95,
        notes: [
          { freq: 587.33, startSec: 0.0, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.38 },
          { freq: 739.99, startSec: 0.16, durationSec: 0.16, harmonics: BELL_CHIME_HARMONICS, gain: 0.4 },
          { freq: 880.0, startSec: 0.32, durationSec: 0.2, harmonics: BELL_CHIME_HARMONICS, gain: 0.42 },
          { freq: 1174.66, startSec: 0.52, durationSec: 0.4, harmonics: BELL_CHIME_HARMONICS, gain: 0.45 },
          { freq: 739.99, startSec: 0.52, durationSec: 0.4, harmonics: WARM_PIANO_HARMONICS, gain: 0.25 },
        ],
      },
    },
  },
  adventure_quest: {
    packId: 'ADVENTURE_QUEST',
    label: 'Phiêu lưu / Adventure Quest (Kịch tính)',
    cues: {
      correct: {
        duration: 0.54,
        notes: [
          { freq: 440.0, startSec: 0.0, durationSec: 0.13, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
          { freq: 554.37, startSec: 0.11, durationSec: 0.14, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
          { freq: 659.25, startSec: 0.22, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
          { freq: 880.0, startSec: 0.34, durationSec: 0.19, harmonics: BRASS_QUEST_HARMONICS, gain: 0.44 },
        ],
      },
      wrong: {
        duration: 0.5,
        notes: [
          { freq: 261.63, startSec: 0.0, durationSec: 0.22, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38, pitchSlideRatio: 0.85 },
          { freq: 196.0, startSec: 0.2, durationSec: 0.28, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4, pitchSlideRatio: 0.78 },
        ],
      },
      timeout: {
        duration: 0.58,
        notes: [
          { freq: 392.0, startSec: 0.0, durationSec: 0.16, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
          { freq: 329.63, startSec: 0.16, durationSec: 0.16, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
          { freq: 246.94, startSec: 0.32, durationSec: 0.25, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4, pitchSlideRatio: 0.8 },
        ],
      },
      countdown: {
        duration: 0.19,
        notes: [
          { freq: 659.25, startSec: 0.0, durationSec: 0.16, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36, decayPower: 2.4 },
        ],
      },
      start: {
        duration: 0.58,
        notes: [
          { freq: 293.66, startSec: 0.0, durationSec: 0.16, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
          { freq: 440.0, startSec: 0.15, durationSec: 0.16, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
          { freq: 587.33, startSec: 0.3, durationSec: 0.26, harmonics: BRASS_QUEST_HARMONICS, gain: 0.44 },
        ],
      },
      finish: {
        duration: 0.9,
        notes: [
          { freq: 392.0, startSec: 0.0, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
          { freq: 493.88, startSec: 0.14, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
          { freq: 587.33, startSec: 0.28, durationSec: 0.16, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
          { freq: 783.99, startSec: 0.44, durationSec: 0.44, harmonics: BRASS_QUEST_HARMONICS, gain: 0.45 },
          { freq: 392.0, startSec: 0.44, durationSec: 0.44, harmonics: WARM_PIANO_HARMONICS, gain: 0.26 },
        ],
      },
      top3: {
        duration: 1.1,
        notes: [
          { freq: 440.0, startSec: 0.0, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
          { freq: 554.37, startSec: 0.15, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
          { freq: 659.25, startSec: 0.3, durationSec: 0.18, harmonics: BRASS_QUEST_HARMONICS, gain: 0.42 },
          { freq: 880.0, startSec: 0.48, durationSec: 0.22, harmonics: BRASS_QUEST_HARMONICS, gain: 0.44 },
          { freq: 1108.73, startSec: 0.7, durationSec: 0.38, harmonics: BRASS_QUEST_HARMONICS, gain: 0.46 },
          { freq: 659.25, startSec: 0.7, durationSec: 0.38, harmonics: BELL_CHIME_HARMONICS, gain: 0.28 },
        ],
      },
    },
  },
  corporate_training: {
    packId: 'CORPORATE_TRAINING',
    label: 'Đào tạo Doanh nghiệp / Corporate Training (Chuyên nghiệp)',
    cues: {
      correct: {
        duration: 0.44,
        notes: [
          { freq: 523.25, startSec: 0.0, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.36 },
          { freq: 783.99, startSec: 0.12, durationSec: 0.3, harmonics: WARM_PIANO_HARMONICS, gain: 0.4 },
          { freq: 392.0, startSec: 0.12, durationSec: 0.3, harmonics: WARM_PIANO_HARMONICS, gain: 0.22 },
        ],
      },
      wrong: {
        duration: 0.42,
        notes: [
          { freq: 329.63, startSec: 0.0, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.34 },
          { freq: 261.63, startSec: 0.14, durationSec: 0.26, harmonics: WARM_PIANO_HARMONICS, gain: 0.36 },
        ],
      },
      timeout: {
        duration: 0.46,
        notes: [
          { freq: 440.0, startSec: 0.0, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.34 },
          { freq: 349.23, startSec: 0.15, durationSec: 0.29, harmonics: WARM_PIANO_HARMONICS, gain: 0.36 },
        ],
      },
      countdown: {
        duration: 0.15,
        notes: [
          { freq: 659.25, startSec: 0.0, durationSec: 0.13, harmonics: WARM_PIANO_HARMONICS, gain: 0.32, decayPower: 3.0 },
        ],
      },
      start: {
        duration: 0.46,
        notes: [
          { freq: 392.0, startSec: 0.0, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.35 },
          { freq: 523.25, startSec: 0.14, durationSec: 0.3, harmonics: WARM_PIANO_HARMONICS, gain: 0.4 },
        ],
      },
      finish: {
        duration: 0.72,
        notes: [
          { freq: 523.25, startSec: 0.0, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.36 },
          { freq: 659.25, startSec: 0.15, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.38 },
          { freq: 783.99, startSec: 0.3, durationSec: 0.4, harmonics: WARM_PIANO_HARMONICS, gain: 0.42 },
          { freq: 523.25, startSec: 0.3, durationSec: 0.4, harmonics: BELL_CHIME_HARMONICS, gain: 0.22 },
        ],
      },
      top3: {
        duration: 0.88,
        notes: [
          { freq: 523.25, startSec: 0.0, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.36 },
          { freq: 659.25, startSec: 0.15, durationSec: 0.16, harmonics: WARM_PIANO_HARMONICS, gain: 0.38 },
          { freq: 783.99, startSec: 0.3, durationSec: 0.18, harmonics: WARM_PIANO_HARMONICS, gain: 0.4 },
          { freq: 1046.5, startSec: 0.48, durationSec: 0.38, harmonics: WARM_PIANO_HARMONICS, gain: 0.44 },
          { freq: 659.25, startSec: 0.48, durationSec: 0.38, harmonics: BELL_CHIME_HARMONICS, gain: 0.24 },
        ],
      },
    },
  },
};

const projectRoot = process.cwd();
const outputRoots = [
  path.join(projectRoot, 'public', 'audio', 'packs'),
  path.join(projectRoot, 'frontend', 'public', 'audio', 'packs'),
];

const manifest = {
  version: '3.0.0',
  generatedAt: new Date().toISOString(),
  license: 'CC0-1.0 (Public Domain - Original Multi-Harmonic Acoustic Instrument Synthesis for AI Game Platform V3)',
  note: 'All 28 WAV files are 22050Hz 16-bit PCM mono multi-harmonic musical instrument cues (synth, bell chime, brass fanfare, warm piano). No oscillator-simulated human voices or fake crowd applause are used.',
  packs: {},
};

for (const [folderName, packSpec] of Object.entries(SOUND_PACK_Specs)) {
  manifest.packs[packSpec.packId] = {
    packId: packSpec.packId,
    folder: folderName,
    label: packSpec.label,
    cues: {},
  };

  for (const [cueName, cueSpec] of Object.entries(packSpec.cues)) {
    const wavBuf = synthesizeMultiLayeredWav(cueSpec.notes, cueSpec.duration);
    const sha256 = crypto.createHash('sha256').update(wavBuf).digest('hex');
    const relUrl = `/audio/packs/${folderName}/${cueName}.wav`;

    for (const rootDir of outputRoots) {
      const dir = path.join(rootDir, folderName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${cueName}.wav`), wavBuf);
    }

    manifest.packs[packSpec.packId].cues[cueName] = {
      cue: cueName,
      url: relUrl,
      sizeBytes: wavBuf.length,
      durationSec: cueSpec.duration,
      sha256,
    };
  }
}

for (const rootDir of outputRoots) {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

console.log(`Generated ${Object.keys(SOUND_PACK_Specs).length} sound packs (28 WAV files) successfully.`);

