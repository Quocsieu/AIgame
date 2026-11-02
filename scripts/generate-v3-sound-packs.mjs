import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAMPLE_RATE = 22050;

/**
 * Decodes a standard PCM WAV buffer (8-bit unsigned or 16-bit signed, mono or stereo)
 * and resamples it to SAMPLE_RATE (22050Hz) mono Float64Array in [-1, 1].
 */
function decodeAndResampleWav(buf, options = {}) {
  let offset = 12;
  let fmt = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(offset + 8),
        numChannels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(size, buf.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (!fmt || !dataOffset || dataSize <= 0) {
    throw new Error('Invalid PCM WAV file');
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameSize = bytesPerSample * fmt.numChannels;
  const numFrames = Math.floor(dataSize / frameSize);
  const srcMono = new Float64Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < fmt.numChannels; ch++) {
      const pos = dataOffset + i * frameSize + ch * bytesPerSample;
      if (fmt.bitsPerSample === 16) {
        sum += buf.readInt16LE(pos) / 32768;
      } else if (fmt.bitsPerSample === 8) {
        sum += (buf.readUInt8(pos) - 128) / 128;
      }
    }
    srcMono[i] = sum / fmt.numChannels;
  }

  // Trim leading/trailing silence if requested
  let startFrame = 0;
  let endFrame = numFrames;
  const threshold = options.silenceThreshold ?? 0.025;
  if (options.trimSilence) {
    while (startFrame < numFrames && Math.abs(srcMono[startFrame]) < threshold) {
      startFrame++;
    }
    startFrame = Math.max(0, startFrame - Math.floor(fmt.sampleRate * 0.015));
    while (endFrame > startFrame && Math.abs(srcMono[endFrame - 1]) < threshold) {
      endFrame--;
    }
    endFrame = Math.min(numFrames, endFrame + Math.floor(fmt.sampleRate * 0.04));
  }

  if (options.startOffsetSec) {
    startFrame = Math.min(
      endFrame,
      startFrame + Math.floor(options.startOffsetSec * fmt.sampleRate)
    );
  }
  if (options.maxDurationSec) {
    endFrame = Math.min(
      endFrame,
      startFrame + Math.floor(options.maxDurationSec * fmt.sampleRate)
    );
  }

  const trimmedLen = Math.max(1, endFrame - startFrame);
  const targetLen = Math.max(
    1,
    Math.floor((trimmedLen * SAMPLE_RATE) / fmt.sampleRate)
  );
  const out = new Float64Array(targetLen);

  for (let i = 0; i < targetLen; i++) {
    const srcPos = startFrame + (i * fmt.sampleRate) / SAMPLE_RATE;
    const idx0 = Math.min(endFrame - 1, Math.floor(srcPos));
    const idx1 = Math.min(endFrame - 1, idx0 + 1);
    const frac = srcPos - idx0;
    out[i] = srcMono[idx0] * (1 - frac) + srcMono[idx1] * frac;
  }

  // Normalize peak
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const targetPeak = options.targetPeak ?? 0.85;
  if (peak > 0.001) {
    const scale = targetPeak / peak;
    for (let i = 0; i < out.length; i++) {
      out[i] *= scale;
    }
  }

  // Apply smooth fade-in and fade-out
  const fadeInSamples = Math.floor((options.fadeInSec ?? 0.012) * SAMPLE_RATE);
  const fadeOutSamples = Math.floor((options.fadeOutSec ?? 0.08) * SAMPLE_RATE);
  for (let i = 0; i < Math.min(fadeInSamples, out.length); i++) {
    out[i] *= i / Math.max(1, fadeInSamples);
  }
  for (let i = 0; i < Math.min(fadeOutSamples, out.length); i++) {
    const idx = out.length - 1 - i;
    out[idx] *= i / Math.max(1, fadeOutSamples);
  }

  return out;
}

/**
 * Encodes a Float64Array of mono samples at SAMPLE_RATE into a 16-bit PCM RIFF WAVE Buffer.
 */
function encodeSamplesToWavBuffer(floatSamples, maxPeak = 0.9) {
  const numSamples = floatSamples.length;
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(floatSamples[i]);
    if (abs > peak) peak = abs;
  }
  const normFactor = peak > maxPeak ? maxPeak / peak : 1.0;

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

/**
 * Renders multi-layered acoustic instrument notes into a Float64Array.
 */
function renderNotesToSamples(notes, totalDurationSec) {
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
        n.freq *
        (1 + (slideRatio - 1) * progress) *
        (1 + (vibHz > 0 ? Math.sin(2 * Math.PI * vibHz * t) * vibDepth : 0));
      phase += (2 * Math.PI * instFreq) / SAMPLE_RATE;

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

  return floatSamples;
}

function synthesizeMultiLayeredWav(notes, totalDurationSec, maxPeak = 0.9) {
  const samples = renderNotesToSamples(notes, totalDurationSec);
  return encodeSamplesToWavBuffer(samples, maxPeak);
}

/**
 * Mixes two Float64Array buffers together with optional offset and gain.
 */
function mixSampleBuffers(baseSamples, overlaySamples, offsetSec = 0, overlayGain = 1.0) {
  const offsetIdx = Math.max(0, Math.floor(offsetSec * SAMPLE_RATE));
  const totalLen = Math.max(baseSamples.length, offsetIdx + overlaySamples.length);
  const mixed = new Float64Array(totalLen);
  for (let i = 0; i < baseSamples.length; i++) {
    mixed[i] += baseSamples[i];
  }
  for (let i = 0; i < overlaySamples.length; i++) {
    mixed[offsetIdx + i] += overlaySamples[i] * overlayGain;
  }
  return mixed;
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

const MUTED_TROMBONE_HARMONICS = [
  [1, 0.75],
  [2, 1.0],
  [3, 0.85],
  [4, 0.55],
  [5, 0.32],
  [6, 0.18],
  [7, 0.09],
];

const WOODBLOCK_HARMONICS = [
  [1, 1.0],
  [2.42, 0.45],
  [3.89, 0.18],
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

const defaultAudioOutputRoots = [
  path.join(projectRoot, 'public', 'audio', 'default'),
  path.join(projectRoot, 'frontend', 'public', 'audio', 'default'),
];

const cc0SourcesDir = path.join(projectRoot, 'public', 'audio', 'sources_cc0');

const manifest = {
  version: '3.1.0',
  generatedAt: new Date().toISOString(),
  license:
    'CC0-1.0 (Public Domain - Wikimedia Commons CC0 Recordings + Original Multi-Harmonic Acoustic Instrument Synthesis)',
  note: 'Includes 4 legacy theme sound packs (28 WAV files) + Unified Default Game Audio Pack (16 WAV files: 3 real CC0 correct variants [applause, wow, cheer], 2 wrong variants [tè-tè, real buzzer], countdown, timeout, start, finish, top3, exam recorded, 3 adventure 2D SFX, and 2 looping BGM tracks).',
  packs: {},
  defaultUnifiedPack: {
    packId: 'UNIFIED_DEFAULT',
    folder: '/audio/default',
    label: 'Bộ âm thanh trò chơi mặc định (Unified Game Audio V3)',
    assets: {},
  },
};

// 1. Generate 4 legacy V3 sound packs (28 WAV files)
for (const [folderName, spec] of Object.entries(SOUND_PACK_Specs)) {
  const packEntry = {
    packId: spec.packId,
    folder: folderName,
    label: spec.label,
    cues: {},
  };

  for (const [cueName, cueDef] of Object.entries(spec.cues)) {
    const wavBuf = synthesizeMultiLayeredWav(cueDef.notes, cueDef.duration);
    const sha256 = crypto.createHash('sha256').update(wavBuf).digest('hex');

    for (const rootDir of outputRoots) {
      const packDir = path.join(rootDir, folderName);
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(path.join(packDir, `${cueName}.wav`), wavBuf);
    }

    packEntry.cues[cueName] = {
      cue: cueName,
      url: `/audio/packs/${folderName}/${cueName}.wav`,
      sizeBytes: wavBuf.length,
      durationSec: cueDef.duration,
      sha256,
    };
  }

  manifest.packs[spec.packId] = packEntry;
}

// 2. Build Unified Default Game Audio Pack (/audio/default/*.wav)
const applauseRawBuf = fs.readFileSync(
  path.join(cc0SourcesDir, 'cc0_applause_sandermotions.wav')
);
const wowRawBuf = fs.readFileSync(path.join(cc0SourcesDir, 'cc0_wow_wodencafe.wav'));
const bravoRawBuf = fs.readFileSync(path.join(cc0SourcesDir, 'cc0_bravo_grendelkhan.wav'));
const buzzerRawBuf = fs.readFileSync(path.join(cc0SourcesDir, 'cc0_buzzer_wikimedia.wav'));

// Variant 1 (Correct — Applause): Real crowd applause + bright celebration chime
const applauseClipSamples = decodeAndResampleWav(applauseRawBuf, {
  startOffsetSec: 0.15,
  maxDurationSec: 1.35,
  targetPeak: 0.78,
  fadeInSec: 0.02,
  fadeOutSec: 0.25,
});
const chimeAccentSamples = renderNotesToSamples(
  [
    { freq: 523.25, startSec: 0.0, durationSec: 0.15, harmonics: BELL_CHIME_HARMONICS, gain: 0.28 },
    { freq: 659.25, startSec: 0.08, durationSec: 0.18, harmonics: BELL_CHIME_HARMONICS, gain: 0.3 },
    { freq: 1046.5, startSec: 0.16, durationSec: 0.35, harmonics: BELL_CHIME_HARMONICS, gain: 0.32 },
  ],
  0.6
);
const correctApplauseBuf = encodeSamplesToWavBuffer(
  mixSampleBuffers(applauseClipSamples, chimeAccentSamples, 0.0, 0.55),
  0.9
);

// Variant 2 (Correct — "Wow!"): Real human voice "Wow!" + sparkling triad chime
const wowVoiceSamples = decodeAndResampleWav(wowRawBuf, {
  trimSilence: true,
  silenceThreshold: 0.02,
  maxDurationSec: 0.85,
  targetPeak: 0.86,
  fadeInSec: 0.01,
  fadeOutSec: 0.08,
});
const wowSparkleSamples = renderNotesToSamples(
  [
    { freq: 587.33, startSec: 0.0, durationSec: 0.12, harmonics: BELL_CHIME_HARMONICS, gain: 0.24 },
    { freq: 880.0, startSec: 0.09, durationSec: 0.22, harmonics: BELL_CHIME_HARMONICS, gain: 0.26 },
  ],
  0.35
);
const correctWowBuf = encodeSamplesToWavBuffer(
  mixSampleBuffers(wowSparkleSamples, wowVoiceSamples, 0.06, 0.95),
  0.9
);

// Variant 3 (Correct — Cheer / "Bravo!"): Real human voice "Bravo!" + real crowd applause + fanfare chord
const bravoVoiceSamples = decodeAndResampleWav(bravoRawBuf, {
  trimSilence: true,
  silenceThreshold: 0.02,
  maxDurationSec: 0.85,
  targetPeak: 0.85,
  fadeInSec: 0.01,
  fadeOutSec: 0.08,
});
const cheerApplauseSamples = decodeAndResampleWav(applauseRawBuf, {
  startOffsetSec: 0.6,
  maxDurationSec: 1.25,
  targetPeak: 0.65,
  fadeInSec: 0.03,
  fadeOutSec: 0.25,
});
const cheerChordSamples = renderNotesToSamples(
  [
    { freq: 523.25, startSec: 0.0, durationSec: 0.12, harmonics: BRASS_QUEST_HARMONICS, gain: 0.25 },
    { freq: 783.99, startSec: 0.1, durationSec: 0.28, harmonics: BRASS_QUEST_HARMONICS, gain: 0.28 },
  ],
  0.42
);
const bravoPlusApplause = mixSampleBuffers(bravoVoiceSamples, cheerApplauseSamples, 0.12, 0.62);
const correctCheerBuf = encodeSamplesToWavBuffer(
  mixSampleBuffers(cheerChordSamples, bravoPlusApplause, 0.04, 0.95),
  0.9
);

// Wrong Variant 1 ("Tè tè"): Classic game-show two-note muted trombone / horn "tè-tè"
const wrongTeteBuf = synthesizeMultiLayeredWav(
  [
    {
      freq: 311.13, // Eb4
      startSec: 0.0,
      durationSec: 0.21,
      harmonics: MUTED_TROMBONE_HARMONICS,
      gain: 0.42,
      pitchSlideRatio: 0.94,
      vibratoHz: 12,
      vibratoDepth: 0.012,
    },
    {
      freq: 155.56,
      startSec: 0.0,
      durationSec: 0.21,
      harmonics: BRASS_QUEST_HARMONICS,
      gain: 0.26,
      pitchSlideRatio: 0.94,
    },
    {
      freq: 233.08, // Bb3 descending
      startSec: 0.23,
      durationSec: 0.32,
      harmonics: MUTED_TROMBONE_HARMONICS,
      gain: 0.46,
      pitchSlideRatio: 0.78,
      vibratoHz: 10,
      vibratoDepth: 0.015,
    },
    {
      freq: 116.54,
      startSec: 0.23,
      durationSec: 0.32,
      harmonics: BRASS_QUEST_HARMONICS,
      gain: 0.3,
      pitchSlideRatio: 0.78,
    },
  ],
  0.56
);

// Wrong Variant 2 (Buzzer): Real recorded buzzer (Wikimedia Commons CC0) + playful low bass drop
const buzzerClipSamples = decodeAndResampleWav(buzzerRawBuf, {
  trimSilence: true,
  silenceThreshold: 0.03,
  maxDurationSec: 0.54,
  targetPeak: 0.72,
  fadeInSec: 0.01,
  fadeOutSec: 0.1,
});
const buzzerBassDrop = renderNotesToSamples(
  [
    {
      freq: 196.0,
      startSec: 0.0,
      durationSec: 0.5,
      harmonics: WARM_PIANO_HARMONICS,
      gain: 0.32,
      pitchSlideRatio: 0.68,
    },
  ],
  0.54
);
const wrongBuzzerBuf = encodeSamplesToWavBuffer(
  mixSampleBuffers(buzzerClipSamples, buzzerBassDrop, 0.0, 0.65),
  0.88
);

// Countdown Tick-Tock + Beep (5 seconds remaining)
const countdownBuf = synthesizeMultiLayeredWav(
  [
    {
      freq: 987.77, // B5 woodblock tick
      startSec: 0.0,
      durationSec: 0.06,
      harmonics: WOODBLOCK_HARMONICS,
      gain: 0.42,
      decayPower: 3.4,
    },
    {
      freq: 783.99, // G5 crisp countdown beep
      startSec: 0.05,
      durationSec: 0.14,
      harmonics: BELL_CHIME_HARMONICS,
      gain: 0.36,
      decayPower: 2.5,
    },
  ],
  0.21
);

// Timeout Horn / Referee Signal
const timeoutBuf = synthesizeMultiLayeredWav(
  [
    {
      freq: 440.0,
      startSec: 0.0,
      durationSec: 0.16,
      harmonics: BRASS_QUEST_HARMONICS,
      gain: 0.38,
    },
    {
      freq: 392.0,
      startSec: 0.17,
      durationSec: 0.16,
      harmonics: BRASS_QUEST_HARMONICS,
      gain: 0.38,
    },
    {
      freq: 311.13,
      startSec: 0.34,
      durationSec: 0.32,
      harmonics: MUTED_TROMBONE_HARMONICS,
      gain: 0.44,
      pitchSlideRatio: 0.78,
    },
  ],
  0.68
);

// Start Game (Ready / Go Fanfare)
const startBuf = synthesizeMultiLayeredWav(
  [
    { freq: 392.0, startSec: 0.0, durationSec: 0.13, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
    { freq: 523.25, startSec: 0.12, durationSec: 0.13, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
    { freq: 659.25, startSec: 0.24, durationSec: 0.14, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
    { freq: 783.99, startSec: 0.37, durationSec: 0.26, harmonics: BRIGHT_SYNTH_HARMONICS, gain: 0.44 },
    { freq: 523.25, startSec: 0.37, durationSec: 0.26, harmonics: BELL_CHIME_HARMONICS, gain: 0.26 },
  ],
  0.65
);

// Finish Game (Victory Completion Music Cue)
const finishBuf = synthesizeMultiLayeredWav(
  [
    { freq: 523.25, startSec: 0.0, durationSec: 0.14, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
    { freq: 659.25, startSec: 0.13, durationSec: 0.14, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
    { freq: 783.99, startSec: 0.26, durationSec: 0.15, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
    { freq: 1046.5, startSec: 0.42, durationSec: 0.52, harmonics: BRASS_QUEST_HARMONICS, gain: 0.45, vibratoHz: 6, vibratoDepth: 0.008 },
    { freq: 659.25, startSec: 0.42, durationSec: 0.52, harmonics: BELL_CHIME_HARMONICS, gain: 0.28 },
    { freq: 523.25, startSec: 0.42, durationSec: 0.52, harmonics: WARM_PIANO_HARMONICS, gain: 0.28 },
  ],
  0.96
);

// Top 3 / Podium Celebration (Grand Fanfare + Real Crowd Applause)
const podiumFanfareSamples = renderNotesToSamples(
  [
    { freq: 523.25, startSec: 0.0, durationSec: 0.14, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
    { freq: 523.25, startSec: 0.15, durationSec: 0.12, harmonics: BRASS_QUEST_HARMONICS, gain: 0.36 },
    { freq: 523.25, startSec: 0.28, durationSec: 0.12, harmonics: BRASS_QUEST_HARMONICS, gain: 0.38 },
    { freq: 659.25, startSec: 0.41, durationSec: 0.22, harmonics: BRASS_QUEST_HARMONICS, gain: 0.4 },
    { freq: 783.99, startSec: 0.64, durationSec: 0.24, harmonics: BRASS_QUEST_HARMONICS, gain: 0.42 },
    { freq: 1046.5, startSec: 0.88, durationSec: 0.85, harmonics: BRASS_QUEST_HARMONICS, gain: 0.45 },
    { freq: 659.25, startSec: 0.88, durationSec: 0.85, harmonics: BELL_CHIME_HARMONICS, gain: 0.28 },
  ],
  1.8
);
const podiumApplauseSamples = decodeAndResampleWav(applauseRawBuf, {
  startOffsetSec: 0.1,
  maxDurationSec: 1.75,
  targetPeak: 0.72,
  fadeInSec: 0.05,
  fadeOutSec: 0.3,
});
const top3Buf = encodeSamplesToWavBuffer(
  mixSampleBuffers(podiumFanfareSamples, podiumApplauseSamples, 0.05, 0.68),
  0.92
);

// Neutral Exam Answer Recorded (Soft Marimba Confirmation)
const recordedBuf = synthesizeMultiLayeredWav(
  [
    { freq: 440.0, startSec: 0.0, durationSec: 0.09, harmonics: WARM_PIANO_HARMONICS, gain: 0.32, decayPower: 2.6 },
    { freq: 554.37, startSec: 0.06, durationSec: 0.12, harmonics: WARM_PIANO_HARMONICS, gain: 0.34, decayPower: 2.8 },
  ],
  0.2
);

// Adventure 2D Jump, Obstacle Hit, Checkpoint Reached
const adventureJumpBuf = synthesizeMultiLayeredWav(
  [
    {
      freq: 329.63,
      startSec: 0.0,
      durationSec: 0.18,
      harmonics: WARM_PIANO_HARMONICS,
      gain: 0.34,
      pitchSlideRatio: 1.65,
      decayPower: 2.2,
    },
  ],
  0.2
);

const adventureHitBuf = synthesizeMultiLayeredWav(
  [
    {
      freq: 185.0,
      startSec: 0.0,
      durationSec: 0.24,
      harmonics: MUTED_TROMBONE_HARMONICS,
      gain: 0.38,
      pitchSlideRatio: 0.58,
      decayPower: 2.4,
    },
  ],
  0.26
);

const adventureCheckpointBuf = synthesizeMultiLayeredWav(
  [
    { freq: 587.33, startSec: 0.0, durationSec: 0.14, harmonics: BELL_CHIME_HARMONICS, gain: 0.34 },
    { freq: 880.0, startSec: 0.11, durationSec: 0.22, harmonics: BELL_CHIME_HARMONICS, gain: 0.38 },
  ],
  0.35
);

// Default Looping Background Music (8.0s seamless loop, 16-beat groove at 120 BPM = 0.5s/beat)
function buildSeamlessBgmWav(isExamFocus = false) {
  const loopDurationSec = 8.0;
  const notes = [];
  if (!isExamFocus) {
    // Upbeat quiz/arcade marimba & warm pad progression (C - Am - F - G, 16 steps of 0.5s)
    const melody = [
      261.63, 329.63, 392.0, 523.25, // C maj
      220.0, 261.63, 329.63, 440.0,  // A min
      174.61, 261.63, 349.23, 440.0, // F maj
      196.0, 246.94, 293.66, 392.0,  // G maj
    ];
    const bass = [130.81, 110.0, 174.61, 196.0];
    for (let i = 0; i < 16; i++) {
      notes.push({
        freq: melody[i],
        startSec: i * 0.5,
        durationSec: 0.44,
        harmonics: WARM_PIANO_HARMONICS,
        gain: 0.22,
        decayPower: 2.1,
      });
      if (i % 4 === 0) {
        notes.push({
          freq: bass[Math.floor(i / 4)],
          startSec: i * 0.5,
          durationSec: 1.9,
          harmonics: [[1, 1.0], [2, 0.2]],
          gain: 0.16,
          decayPower: 1.5,
        });
      }
    }
  } else {
    // Calm neutral focus BGM for Exam Mode (8 steps of 1.0s)
    const calmNotes = [220.0, 261.63, 329.63, 261.63, 196.0, 246.94, 293.66, 246.94];
    for (let i = 0; i < 8; i++) {
      notes.push({
        freq: calmNotes[i],
        startSec: i * 1.0,
        durationSec: 0.92,
        harmonics: [[1, 1.0], [2, 0.15]],
        gain: 0.18,
        decayPower: 1.8,
      });
    }
  }
  return synthesizeMultiLayeredWav(notes, loopDurationSec, 0.42);
}

const bgmDefaultBuf = buildSeamlessBgmWav(false);
const bgmExamBuf = buildSeamlessBgmWav(true);

const defaultAssetsMap = {
  correct_applause: {
    fileName: 'correct_applause.wav',
    buf: correctApplauseBuf,
    category: 'correct',
    variantIndex: 0,
    label: 'Trả lời đúng — Tiếng vỗ tay chúc mừng',
    source: 'Wikimedia Commons: File:277021 sandermotions applause-2.wav (Author: sandermotions) + Original Chime Layer',
    license: 'CC0-1.0 (Public Domain)',
  },
  correct_wow: {
    fileName: 'correct_wow.wav',
    buf: correctWowBuf,
    category: 'correct',
    variantIndex: 1,
    label: 'Trả lời đúng — Tiếng "Wow!" hào hứng',
    source: 'Wikimedia Commons: File:LL-Q1860 (eng)-Wodencafe-wow.wav (Author: Wodencafe) + Original Sparkle Chime',
    license: 'CC0-1.0 (Public Domain)',
  },
  correct_cheer: {
    fileName: 'correct_cheer.wav',
    buf: correctCheerBuf,
    category: 'correct',
    variantIndex: 2,
    label: 'Trả lời đúng — Tiếng reo hò "Bravo!" & vỗ tay',
    source: 'Wikimedia Commons: File:LL-Q1860 (eng)-Grendelkhan-bravo.wav (Author: Grendelkhan) & File:277021 sandermotions applause-2.wav',
    license: 'CC0-1.0 (Public Domain)',
  },
  wrong_tete: {
    fileName: 'wrong_tete.wav',
    buf: wrongTeteBuf,
    category: 'wrong',
    variantIndex: 0,
    label: 'Trả lời sai — Tiếng kèn "tè tè" hai nốt trầm',
    source: 'AI Game Platform V3 Original Multi-Harmonic Muted Trombone Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  wrong_buzzer: {
    fileName: 'wrong_buzzer.wav',
    buf: wrongBuzzerBuf,
    category: 'wrong',
    variantIndex: 1,
    label: 'Trả lời sai — Tiếng còi Buzzer game-show',
    source: 'Wikimedia Commons: File:Buzzer.wav + Original Low Bass Envelope',
    license: 'CC0-1.0 (Public Domain)',
  },
  countdown: {
    fileName: 'countdown.wav',
    buf: countdownBuf,
    category: 'countdown',
    variantIndex: 0,
    label: 'Sắp hết giờ — Tiếng Tick-Tock & Beep đếm ngược 5 giây cuối',
    source: 'AI Game Platform V3 Original Acoustic Woodblock & Bell Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  timeout: {
    fileName: 'timeout.wav',
    buf: timeoutBuf,
    category: 'timeout',
    variantIndex: 0,
    label: 'Hết giờ — Còi báo hết thời gian trả lời',
    source: 'AI Game Platform V3 Original Multi-Harmonic Horn Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  start: {
    fileName: 'start.wav',
    buf: startBuf,
    category: 'start',
    variantIndex: 0,
    label: 'Bắt đầu — Hiệu ứng Ready/Go mở màn trò chơi',
    source: 'AI Game Platform V3 Original Brass & Chime Fanfare Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  finish: {
    fileName: 'finish.wav',
    buf: finishBuf,
    category: 'finish',
    variantIndex: 0,
    label: 'Kết thúc — Nhạc hoàn thành màn chơi',
    source: 'AI Game Platform V3 Original Multi-Chord Victory Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  top3: {
    fileName: 'top3.wav',
    buf: top3Buf,
    category: 'top3',
    variantIndex: 0,
    label: 'Vinh danh Top 3 — Tiếng vỗ tay lớn & kèn Fanfare bục vinh quang',
    source: 'Wikimedia Commons: File:277021 sandermotions applause-2.wav + Original Podium Brass Fanfare',
    license: 'CC0-1.0 (Public Domain)',
  },
  recorded: {
    fileName: 'recorded.wav',
    buf: recordedBuf,
    category: 'recorded',
    variantIndex: 0,
    label: 'Ghi nhận câu trả lời trung tính (Chế độ Thi nghiêm túc)',
    source: 'AI Game Platform V3 Original Neutral Marimba Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  adventure_jump: {
    fileName: 'adventure_jump.wav',
    buf: adventureJumpBuf,
    category: 'adventure_jump',
    variantIndex: 0,
    label: 'Adventure 2D — Hiệu ứng nhảy vượt chướng ngại vật',
    source: 'AI Game Platform V3 Original Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  adventure_hit: {
    fileName: 'adventure_hit.wav',
    buf: adventureHitBuf,
    category: 'adventure_hit',
    variantIndex: 0,
    label: 'Adventure 2D — Hiệu ứng va chạm chướng ngại vật',
    source: 'AI Game Platform V3 Original Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  adventure_checkpoint: {
    fileName: 'adventure_checkpoint.wav',
    buf: adventureCheckpointBuf,
    category: 'adventure_checkpoint',
    variantIndex: 0,
    label: 'Adventure 2D — Hiệu ứng mở khóa trạm Checkpoint',
    source: 'AI Game Platform V3 Original Synthesis',
    license: 'CC0-1.0 (Public Domain)',
  },
  bgm_default: {
    fileName: 'bgm_default.wav',
    buf: bgmDefaultBuf,
    category: 'bgm',
    variantIndex: 0,
    label: 'Nhạc nền trò chơi mặc định (Loop 8s, cân bằng âm lượng nền)',
    source: 'AI Game Platform V3 Original Marimba & Pad Loop Composition',
    license: 'CC0-1.0 (Public Domain)',
  },
  bgm_exam: {
    fileName: 'bgm_exam.wav',
    buf: bgmExamBuf,
    category: 'bgm_exam',
    variantIndex: 0,
    label: 'Nhạc nền phòng thi trung tính (Loop 8s, nhẹ nhàng tập trung)',
    source: 'AI Game Platform V3 Original Ambient Focus Loop Composition',
    license: 'CC0-1.0 (Public Domain)',
  },
};

for (const [assetKey, item] of Object.entries(defaultAssetsMap)) {
  const sha256 = crypto.createHash('sha256').update(item.buf).digest('hex');
  const durationSec = Number(((item.buf.length - 44) / 2 / SAMPLE_RATE).toFixed(2));
  for (const rootDir of defaultAudioOutputRoots) {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, item.fileName), item.buf);
  }
  manifest.defaultUnifiedPack.assets[assetKey] = {
    key: assetKey,
    category: item.category,
    variantIndex: item.variantIndex,
    label: item.label,
    url: `/audio/default/${item.fileName}`,
    sizeBytes: item.buf.length,
    durationSec,
    sha256,
    source: item.source,
    license: item.license,
  };
}

for (const rootDir of outputRoots) {
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}
for (const rootDir of defaultAudioOutputRoots) {
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest.defaultUnifiedPack, null, 2), 'utf-8');
}

console.log(
  'Generated 28 legacy pack WAV files + 16 Unified Default Game Audio WAV files with CC0 provenance.'
);
