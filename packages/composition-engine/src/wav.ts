import { Rng } from '@sonova/instrument-dna';

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  frames: number;
  data: Float32Array[];
}

/** 16-bit PCM WAV with deterministic TPDF dither. */
export function encodeWav16(channels: Float32Array[], sampleRate: number, ditherSeed = 'sonova'): Uint8Array {
  const frames = channels[0].length;
  const nCh = channels.length;
  const dataBytes = frames * nCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  const rng = new Rng(`dither:${ditherSeed}`);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const d = (rng.next() - rng.next()) / 32768;
      const s = Math.max(-1, Math.min(1, channels[c][i] + d));
      v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Minimal PCM WAV reader (16/24/32-bit int, 32-bit float) used for verification. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let o = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (o + 8 <= bytes.byteLength) {
    const id = tag(o);
    const len = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') {
      dataOffset = o + 8;
      dataLen = Math.min(len, bytes.byteLength - dataOffset);
      break;
    }
    o += 8 + len + (len & 1);
  }
  if (!fmt || dataOffset < 0) throw new Error('Missing fmt or data chunk');
  const bps = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bps * fmt.channels));
  const data = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOffset + (i * fmt.channels + c) * bps;
      let s: number;
      if (fmt.format === 3 && fmt.bits === 32) s = v.getFloat32(p, true);
      else if (fmt.bits === 16) s = v.getInt16(p, true) / 32768;
      else if (fmt.bits === 24) s = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608);
      else if (fmt.bits === 32) s = v.getInt32(p, true) / 2147483648;
      else throw new Error(`Unsupported bit depth ${fmt.bits}`);
      data[c][i] = s;
    }
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, frames, data };
}

export interface AudioVerification {
  ok: boolean;
  problems: string[];
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSec: number;
  peakDbfs: number;
  rmsDbfs: number;
  clippedSamples: number;
  dcOffset: number;
  /** Silent stretches (≥ minSilenceSec below −60 dBFS) as [start, end] seconds. */
  silences: Array<[number, number]>;
  silentRatio: number;
  stereoCorrelation: number;
}

export interface VerifyExpectations {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  maxPeakDbfs?: number;
  minRmsDbfs?: number;
  /** Allowed share of silence (the final ring-out counts). */
  maxSilentRatio?: number;
  minSilenceSec?: number;
}

export function verifyAudio(wav: DecodedWav, expect: VerifyExpectations = {}): AudioVerification {
  const problems: string[] = [];
  const sr = wav.sampleRate;
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  const win = Math.max(1, Math.floor(sr * 0.05));
  const silences: Array<[number, number]> = [];
  const minSil = expect.minSilenceSec ?? 0.5;
  const silentThresh = Math.pow(10, -60 / 20);
  let silentStart = -1;
  let silentFrames = 0;
  for (let w = 0; w < wav.frames; w += win) {
    let wPeak = 0;
    for (let i = w; i < Math.min(wav.frames, w + win); i++) {
      for (let c = 0; c < wav.channels; c++) {
        const s = wav.data[c][i];
        const a = Math.abs(s);
        if (a > peak) peak = a;
        if (a > wPeak) wPeak = a;
        if (a >= 0.9999) clipped++;
        sumSq += s * s;
        sum += s;
      }
      if (wav.channels >= 2) {
        const l = wav.data[0][i];
        const r = wav.data[1][i];
        lr += l * r;
        ll += l * l;
        rr += r * r;
      }
    }
    const silent = wPeak < silentThresh;
    if (silent && silentStart < 0) silentStart = w;
    if ((!silent || w + win >= wav.frames) && silentStart >= 0) {
      const end = silent ? wav.frames : w;
      if ((end - silentStart) / sr >= minSil) {
        silences.push([round(silentStart / sr), round(end / sr)]);
        silentFrames += end - silentStart;
      }
      silentStart = -1;
    }
  }
  const n = wav.frames * wav.channels;
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const rmsDb = 10 * Math.log10(sumSq / Math.max(1, n) + 1e-24);
  const duration = wav.frames / sr;
  const silentRatio = silentFrames / Math.max(1, wav.frames);
  if (expect.sampleRate && sr !== expect.sampleRate) problems.push(`sample rate ${sr} ≠ ${expect.sampleRate}`);
  if (expect.channels && wav.channels !== expect.channels) problems.push(`channels ${wav.channels} ≠ ${expect.channels}`);
  if (expect.bitsPerSample && wav.bitsPerSample !== expect.bitsPerSample) problems.push(`bit depth ${wav.bitsPerSample} ≠ ${expect.bitsPerSample}`);
  if (expect.minDurationSec !== undefined && duration < expect.minDurationSec) problems.push(`duration ${duration.toFixed(2)}s < ${expect.minDurationSec}s`);
  if (expect.maxDurationSec !== undefined && duration > expect.maxDurationSec) problems.push(`duration ${duration.toFixed(2)}s > ${expect.maxDurationSec}s`);
  if (peakDb > (expect.maxPeakDbfs ?? -0.1)) problems.push(`peak ${peakDb.toFixed(2)} dBFS too hot`);
  if (clipped > 0) problems.push(`${clipped} clipped samples`);
  if (rmsDb < (expect.minRmsDbfs ?? -40)) problems.push(`RMS ${rmsDb.toFixed(1)} dBFS too quiet`);
  if (silentRatio > (expect.maxSilentRatio ?? 0.25)) problems.push(`${(silentRatio * 100).toFixed(0)}% silence`);
  const dc = sum / Math.max(1, n);
  if (Math.abs(dc) > 0.01) problems.push(`DC offset ${dc.toFixed(4)}`);
  if (!Number.isFinite(peak)) problems.push('non-finite samples');
  return {
    ok: problems.length === 0,
    problems,
    sampleRate: sr,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    durationSec: round(duration),
    peakDbfs: round(peakDb),
    rmsDbfs: round(rmsDb),
    clippedSamples: clipped,
    dcOffset: Number(dc.toExponential(3)),
    silences,
    silentRatio: round(silentRatio),
    stereoCorrelation: round(ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1),
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
