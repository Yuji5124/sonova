/**
 * Listening tools shared by SONOVA 002–004: the music analyses its own rendered audio.
 *  - band energy, chroma, spectral peaks (FFT)
 *  - sensory roughness from spectral peaks (Plomp & Levelt curve in Sethares' parameterisation)
 */
import { fft } from './fft.ts';

export interface Peak {
  hz: number;
  amp: number;
}

function spectrum(x: Float32Array, start: number, length: number, size = 8192): { mag: Float64Array } {
  const N = size;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const len = Math.min(length, N);
  for (let i = 0; i < len; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (len / 4);
  return { mag };
}

/** Average magnitude spectrum over a window, computed in hops (robust for long windows). */
export function averageSpectrum(x: Float32Array, sampleRate: number, start: number, end: number, size = 8192): { mag: Float64Array; binHz: number } {
  const acc = new Float64Array(size / 2);
  let frames = 0;
  for (let s = start; s < end; s += size / 2) {
    const len = Math.min(size, end - s);
    if (len < 1024 && frames > 0) break;
    const { mag } = spectrum(x, s, Math.max(len, 64), size);
    for (let k = 0; k < acc.length; k++) acc[k] += mag[k];
    frames++;
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= Math.max(1, frames);
  return { mag: acc, binHz: sampleRate / size };
}

/** Energy (dB) in [lo, hi) Hz of a window. */
export function bandEnergyDb(spec: { mag: Float64Array; binHz: number }, lo: number, hi: number): number {
  let e = 0;
  for (let k = Math.max(1, Math.floor(lo / spec.binHz)); k < Math.min(spec.mag.length, Math.ceil(hi / spec.binHz)); k++) e += spec.mag[k] * spec.mag[k];
  return 10 * Math.log10(e + 1e-12);
}

/** Energy (dB) within ±cents of given fundamentals (score-informed presence of a part). */
export function energyAtDb(spec: { mag: Float64Array; binHz: number }, freqs: number[], cents = 45): number {
  let e = 0;
  for (const f of freqs) {
    const lo = f * Math.pow(2, -cents / 1200);
    const hi = f * Math.pow(2, cents / 1200);
    for (let k = Math.max(1, Math.floor(lo / spec.binHz)); k <= Math.min(spec.mag.length - 1, Math.ceil(hi / spec.binHz)); k++) e += spec.mag[k] * spec.mag[k];
  }
  return 10 * Math.log10(e + 1e-12);
}

/** Local maxima above a floor, strongest first. */
export function spectralPeaks(spec: { mag: Float64Array; binHz: number }, maxPeaks = 24, fMin = 40, fMax = 5000): Peak[] {
  const peaks: Peak[] = [];
  const kMin = Math.max(2, Math.floor(fMin / spec.binHz));
  const kMax = Math.min(spec.mag.length - 2, Math.ceil(fMax / spec.binHz));
  let max = 0;
  for (let k = kMin; k <= kMax; k++) max = Math.max(max, spec.mag[k]);
  const floor = max * 0.02;
  for (let k = kMin; k <= kMax; k++) {
    const m = spec.mag[k];
    if (m > floor && m > spec.mag[k - 1] && m >= spec.mag[k + 1] && m > spec.mag[k - 2] && m >= spec.mag[k + 2]) {
      // parabolic interpolation for a finer frequency
      const a = spec.mag[k - 1];
      const c = spec.mag[k + 1];
      const d = (a - c) / (2 * (a - 2 * m + c) || 1);
      peaks.push({ hz: (k + d) * spec.binHz, amp: m });
    }
  }
  return peaks.sort((p, q) => q.amp - p.amp).slice(0, maxPeaks);
}

/** Sensory roughness of a set of partials (Sethares 1993 fit of Plomp & Levelt 1965). */
export function roughness(peaks: Peak[]): number {
  let r = 0;
  let norm = 0;
  for (let i = 0; i < peaks.length; i++) {
    norm += peaks[i].amp * peaks[i].amp;
    for (let j = i + 1; j < peaks.length; j++) {
      const f1 = Math.min(peaks[i].hz, peaks[j].hz);
      const f2 = Math.max(peaks[i].hz, peaks[j].hz);
      const s = 0.24 / (0.021 * f1 + 19);
      const d = f2 - f1;
      r += peaks[i].amp * peaks[j].amp * (Math.exp(-3.5 * s * d) - Math.exp(-5.75 * s * d));
    }
  }
  return norm > 0 ? r / norm : 0;
}

/** 12-bin chroma of a spectrum (55 Hz – 4 kHz). */
export function chromaOf(spec: { mag: Float64Array; binHz: number }): number[] {
  const c = new Array(12).fill(0);
  for (let k = 1; k < spec.mag.length; k++) {
    const hz = k * spec.binHz;
    if (hz < 55 || hz > 4000) continue;
    const pc = (((Math.round(12 * Math.log2(hz / 440)) + 9) % 12) + 12) % 12;
    c[pc] += spec.mag[k] * spec.mag[k];
  }
  const total = c.reduce((a, b) => a + b, 0) || 1;
  return c.map((v) => v / total);
}

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
