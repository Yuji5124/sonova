/** Freeverb-style stereo reverb (Jezar's public-domain algorithm, reimplemented). */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

class Comb {
  private buf: Float64Array;
  private idx = 0;
  private store = 0;
  constructor(size: number, private feedback: number, private damp: number) {
    this.buf = new Float64Array(size);
  }
  process(x: number): number {
    const y = this.buf[this.idx];
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.idx] = x + this.store * this.feedback;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return y;
  }
}

class Allpass {
  private buf: Float64Array;
  private idx = 0;
  constructor(size: number) {
    this.buf = new Float64Array(size);
  }
  process(x: number): number {
    const b = this.buf[this.idx];
    this.buf[this.idx] = x + b * 0.5;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return b - x;
  }
}

export interface ReverbOptions {
  roomSize: number; // 0–1
  damping: number; // 0–1
  sampleRate: number;
}

/** Wet-only stereo reverb of a stereo input. */
export function reverb(inL: Float32Array, inR: Float32Array, opts: ReverbOptions): [Float32Array, Float32Array] {
  const scale = opts.sampleRate / 44100;
  const feedback = 0.7 + Math.min(0.98, Math.max(0, opts.roomSize)) * 0.28;
  const damp = Math.min(1, Math.max(0, opts.damping)) * 0.4;
  const combsL = COMB_TUNING.map((t) => new Comb(Math.round(t * scale), feedback, damp));
  const combsR = COMB_TUNING.map((t) => new Comb(Math.round((t + STEREO_SPREAD) * scale), feedback, damp));
  const apL = ALLPASS_TUNING.map((t) => new Allpass(Math.round(t * scale)));
  const apR = ALLPASS_TUNING.map((t) => new Allpass(Math.round((t + STEREO_SPREAD) * scale)));
  const outL = new Float32Array(inL.length);
  const outR = new Float32Array(inR.length);
  for (let n = 0; n < inL.length; n++) {
    const x = (inL[n] + inR[n]) * 0.015;
    let l = 0;
    let r = 0;
    for (let i = 0; i < 8; i++) {
      l += combsL[i].process(x);
      r += combsR[i].process(x);
    }
    for (let i = 0; i < 4; i++) {
      l = apL[i].process(l);
      r = apR[i].process(r);
    }
    outL[n] = l;
    outR[n] = r;
  }
  return [outL, outR];
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Remove DC with a one-pole high-pass (~20 Hz). */
export function dcBlock(x: Float32Array, sampleRate: number): void {
  const R = Math.exp((-2 * Math.PI * 20) / sampleRate);
  let x1 = 0;
  let y1 = 0;
  for (let n = 0; n < x.length; n++) {
    const y = x[n] - x1 + R * y1;
    x1 = x[n];
    y1 = y;
    x[n] = y;
  }
}

export interface MasterOptions {
  sampleRate: number;
  /** Target RMS before limiting (dBFS). */
  targetRmsDb: number;
  /** Peak ceiling (dBFS). */
  ceilingDb: number;
  /** Max make-up gain (dB) so near-silent mixes are not blown up. */
  maxGainDb: number;
}

export interface MasterReport {
  inputPeak: number;
  inputRms: number;
  appliedGainDb: number;
  maxReductionDb: number;
  outputPeak: number;
}

/**
 * Safety master: DC removal, loudness gain (bounded), then a look-ahead peak limiter
 * computed offline (forward release + backward attack), then a hard ceiling clamp.
 */
export function master(L: Float32Array, R: Float32Array, opts: MasterOptions): MasterReport {
  dcBlock(L, opts.sampleRate);
  dcBlock(R, opts.sampleRate);
  let peak = 0;
  let sumSq = 0;
  for (let n = 0; n < L.length; n++) {
    peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
    sumSq += L[n] * L[n] + R[n] * R[n];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, 2 * L.length));
  const rmsDb = 20 * Math.log10(rms + 1e-12);
  const gainDb = Math.min(opts.maxGainDb, opts.targetRmsDb - rmsDb);
  const gain = dbToGain(gainDb);
  const ceiling = dbToGain(opts.ceilingDb);
  const n = L.length;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i])) * gain;
    g[i] = a > ceiling ? ceiling / a : 1;
  }
  const rel = 1 - Math.exp(-1 / (0.12 * opts.sampleRate));
  const att = 1 - Math.exp(-1 / (0.004 * opts.sampleRate));
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i], g[i - 1] + (1 - g[i - 1]) * rel);
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + (1 - g[i + 1]) * att);
  let minG = 1;
  let outPeak = 0;
  for (let i = 0; i < n; i++) {
    minG = Math.min(minG, g[i]);
    const k = gain * g[i];
    L[i] = Math.max(-ceiling, Math.min(ceiling, L[i] * k));
    R[i] = Math.max(-ceiling, Math.min(ceiling, R[i] * k));
    outPeak = Math.max(outPeak, Math.abs(L[i]), Math.abs(R[i]));
  }
  return {
    inputPeak: peak,
    inputRms: rms,
    appliedGainDb: gainDb,
    maxReductionDb: 20 * Math.log10(minG),
    outputPeak: outPeak,
  };
}

export function fadeEdges(L: Float32Array, R: Float32Array, sampleRate: number, inSec: number, outSec: number): void {
  const fi = Math.floor(inSec * sampleRate);
  const fo = Math.floor(outSec * sampleRate);
  for (let i = 0; i < fi && i < L.length; i++) {
    const g = i / fi;
    L[i] *= g;
    R[i] *= g;
  }
  for (let i = 0; i < fo && i < L.length; i++) {
    const g = Math.pow(i / fo, 1.5);
    L[L.length - 1 - i] *= g;
    R[R.length - 1 - i] *= g;
  }
}
