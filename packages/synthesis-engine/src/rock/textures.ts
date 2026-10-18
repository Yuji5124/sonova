import { sinCycles } from '../voice.ts';

/**
 * Bytebeat: a one-line integer formula of time t is the instrument ("the program is the instrument").
 * Classic technique (viznut 2011); studied in greggman/html5bytebeat (MIT). The formula here is
 * built by SONOVA from the riff, so it plays in tune. Nothing user-supplied is evaluated.
 */
export interface BytebeatSpec {
  /** Riff as semitone offsets per 16th slot (null = rest). */
  riff: Array<number | null>;
  rootHz: number;
  bpm: number;
  /** Bytebeat sample rate (8 kHz is the classic value). */
  rate?: number;
}

/** Human-readable formula that `renderBytebeat` evaluates (recorded in the generation JSON). */
export function bytebeatFormula(spec: BytebeatSpec): string {
  const rate = spec.rate ?? 8000;
  const slot = Math.round((rate * 60) / spec.bpm / 4);
  return `t @ ${rate}Hz; s = riff[floor(t/${slot}) % ${spec.riff.length}]; v = (floor(t * ${spec.rootHz.toFixed(3)}*2^(s/12) * 256/${rate}) & 192) ^ ((t>>6) & (t>>9) & 31)`;
}

export function renderBytebeat(spec: BytebeatSpec, seconds: number, sampleRate: number): Float32Array {
  const rate = spec.rate ?? 8000;
  const slot = Math.round((rate * 60) / spec.bpm / 4);
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  let hold = 0;
  let lastT = -1;
  for (let i = 0; i < out.length; i++) {
    const t = Math.floor((i * rate) / sampleRate); // sample-and-hold upsampling keeps the 8-bit grit
    if (t !== lastT) {
      lastT = t;
      const st = spec.riff[Math.floor(t / slot) % spec.riff.length];
      if (st === null || st === undefined) hold = 0;
      else {
        const f = spec.rootHz * Math.pow(2, st / 12);
        const saw = Math.floor((t * f * 256) / rate) & 255;
        const v = (saw & 192) ^ ((t >> 6) & (t >> 9) & 31);
        hold = (v & 255) / 128 - 1;
      }
    }
    out[i] = hold * 0.5;
  }
  return out;
}

/**
 * Image → spectrogram painting: each image row is a sine at a log-spaced frequency, each column a
 * moment, brightness is amplitude — the picture appears in the song's spectrogram.
 * Technique studied in LeviBorodenko/spectrographic (MIT); reimplemented with log frequency.
 */
export interface SpectroImage {
  width: number;
  height: number;
  /** Luminance 0–1, row-major, row 0 = top. */
  lum: Float64Array;
}

export function renderSpectrogramImage(img: SpectroImage, seconds: number, sampleRate: number, lowHz: number, highHz: number, rows = 72): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const n = out.length;
  const freqs = Array.from({ length: rows }, (_, r) => highHz * Math.pow(lowHz / highHz, r / (rows - 1))); // row 0 (top) = high
  const phases = freqs.map((_, r) => (r * 0.618) % 1);
  // Stretch contrast so the picture's structure (not its average grey) is what gets painted.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of img.lum) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo || 1;
  const lumAt = (row: number, col: number) => {
    const y = Math.min(img.height - 1, Math.floor((row / rows) * img.height));
    const x = Math.min(img.width - 1, Math.max(0, col));
    return Math.pow((img.lum[y * img.width + x] - lo) / span, 2.2);
  };
  for (let r = 0; r < rows; r++) {
    const f = freqs[r];
    let ph = phases[r];
    const inc = f / sampleRate;
    for (let i = 0; i < n; i++) {
      const u = (i / n) * (img.width - 1);
      const c = Math.floor(u);
      const fr = u - c;
      const a = lumAt(r, c) * (1 - fr) + lumAt(r, c + 1) * fr;
      ph += inc;
      out[i] += sinCycles(ph) * a;
    }
  }
  const fade = Math.floor(sampleRate * 0.4);
  let peak = 1e-9;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = (out[i] / peak) * g;
  }
  return out;
}
