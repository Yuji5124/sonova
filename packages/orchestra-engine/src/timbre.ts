/**
 * TIMBRE BRIDGE — analyse an orchestral recording (partials, attack, release, noise share) so an
 * electronic voice can be built from it, and the reverse: measure an electronic sound's
 * envelope so an orchestral articulation can be chosen for it.
 */
import { fft } from '@sonova/source-analyzer';

export interface TimbreProfile {
  f0: number;
  /** relative amplitudes of harmonics 1..N (max = 1) */
  partials: number[];
  /** 10 %→90 % rise time (s) */
  attack: number;
  /** time to fall 20 dB after the note's sustain (s) */
  release: number;
  /** share of energy between the harmonics */
  noise: number;
  /** spectral centroid in multiples of f0 */
  centroid: number;
}

export function envelope(x: Float32Array, sr: number, winSec = 0.005): Float32Array {
  const w = Math.max(1, Math.round(winSec * sr));
  const out = new Float32Array(Math.ceil(x.length / w));
  for (let j = 0; j < out.length; j++) {
    let s = 0;
    for (let i = j * w; i < Math.min(x.length, (j + 1) * w); i++) s += x[i] * x[i];
    out[j] = Math.sqrt(s / w);
  }
  return out;
}

export function analyseTimbre(x: Float32Array, sr: number, f0Hint: number, nPartials = 24): TimbreProfile {
  const env = envelope(x, sr);
  const peak = Math.max(...env);
  const i10 = env.findIndex((v) => v >= 0.1 * peak);
  const i90 = env.findIndex((v) => v >= 0.9 * peak);
  const attack = Math.max(0.002, ((i90 - i10) * 0.005));
  let iLast = env.length - 1;
  while (iLast > 0 && env[iLast] < 0.1 * peak) iLast--;
  const release = Math.max(0.05, (env.length - 1 - iLast) * 0.005 + 0.1);
  // spectrum over the steady part
  const N = 16384;
  const a = Math.min(Math.max(0, x.length - N), Math.round(Math.max(i90 * 0.005 + 0.05, 0.15) * sr));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[a + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  const bin = (hz: number) => (hz * N) / sr;
  // refine f0 around the hint
  let f0 = f0Hint;
  let best = 0;
  for (let c = -40; c <= 40; c++) {
    const f = f0Hint * Math.pow(2, c / 1200);
    let s = 0;
    for (let k = 1; k <= 6; k++) s += mag(Math.round(bin(f * k)));
    if (s > best) {
      best = s;
      f0 = f;
    }
  }
  const partials: number[] = [];
  let harm = 0;
  for (let k = 1; k <= nPartials; k++) {
    const c = bin(f0 * k);
    if (c >= N / 2 - 3) {
      partials.push(0);
      continue;
    }
    // energy in a band around the harmonic: vibrato and section spread smear the peak (±1.5 %, at least ±3 bins)
    const w = Math.max(3, c * 0.015);
    let e = 0;
    for (let b = Math.floor(c - w); b <= Math.ceil(c + w); b++) e += mag(b) ** 2;
    partials.push(Math.sqrt(e));
    harm += e;
  }
  let total = 0;
  for (let k = Math.round(bin(f0 * 0.5)); k < Math.min(N / 2, Math.round(bin(f0 * (nPartials + 0.5)))); k++) total += mag(k) ** 2;
  const mx = Math.max(...partials) || 1;
  const rel = partials.map((p) => Math.round((p / mx) * 1e4) / 1e4);
  const centroid = rel.reduce((s, p, k) => s + p * (k + 1), 0) / (rel.reduce((s, p) => s + p, 0) || 1);
  return { f0: Math.round(f0 * 100) / 100, partials: rel, attack: Math.round(attack * 1000) / 1000, release: Math.round(release * 1000) / 1000, noise: Math.round(Math.max(0, 1 - harm / (total || 1)) * 1000) / 1000, centroid: Math.round(centroid * 100) / 100 };
}

/** Reverse direction: what orchestral articulation matches an electronic hit's envelope? */
export function articulationFor(x: Float32Array, sr: number): { art: 'pizz' | 'spic' | 'sus' | 'trem'; attack: number; decay: number } {
  const env = envelope(x, sr);
  const peak = Math.max(...env);
  const ip = env.indexOf(peak);
  let j = ip;
  while (j < env.length - 1 && env[j] > peak * 0.1) j++;
  const decay = (j - ip) * 0.005;
  const attack = ip * 0.005;
  const art = decay < 0.12 ? 'spic' : decay < 0.4 ? 'pizz' : attack > 0.08 ? 'sus' : 'trem';
  return { art, attack, decay };
}
