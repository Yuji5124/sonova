/** Tracks → stems → one hall → master (peak limiter only; dynamics are kept). Loudness per ITU-R BS.1770. */
import { Biquad } from '@sonova/synthesis-engine';
import { convolve, hallIR, type HallSpec } from './space.ts';
import type { Stereo } from './sampler.ts';

export interface Placement {
  /** -1 left … +1 right */
  pan: number;
  /** 0 = close … 1 = far (less direct sound, darker, more hall) */
  depth: number;
  /** stereo width of a stereo source 0–1 */
  width?: number;
  gainDb?: number;
}

export class Track {
  readonly left: Float32Array;
  readonly right: Float32Array;
  constructor(readonly id: string, readonly name: string, readonly kind: 'orchestra' | 'electronic', public place: Placement, length: number) {
    this.left = new Float32Array(length);
    this.right = new Float32Array(length);
  }
  /** add a mono or stereo voice at time t (s) with gain */
  add(v: Float32Array | Stereo, at: number, sr: number, gain = 1, panOffset = 0): void {
    const i0 = Math.round(at * sr);
    if (v instanceof Float32Array) {
      const p = Math.max(-1, Math.min(1, panOffset));
      const gl = Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2;
      const gr = Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2;
      for (let i = 0; i < v.length && i0 + i < this.left.length; i++) {
        if (i0 + i < 0) continue;
        this.left[i0 + i] += v[i] * gain * gl;
        this.right[i0 + i] += v[i] * gain * gr;
      }
    } else {
      for (let i = 0; i < v.left.length && i0 + i < this.left.length; i++) {
        if (i0 + i < 0) continue;
        this.left[i0 + i] += v.left[i] * gain;
        this.right[i0 + i] += v.right[i] * gain;
      }
    }
  }
  /** multiply by a gain curve g(t) (expression / dynamics bridge) */
  shape(g: (t: number) => number, sr: number): void {
    for (let i = 0; i < this.left.length; i++) {
      const v = g(i / sr);
      this.left[i] *= v;
      this.right[i] *= v;
    }
  }
}

export interface MixResult {
  master: Stereo;
  stems: Array<{ id: string; name: string; kind: string; audio: Stereo }>;
  hallReturn: Stereo;
  report: { peakDbfs: number; lufs: number; lra: number; crestDb: number; masterGainDb: number };
}

/** Place a stem (pan / width / depth) — returns the dry placed stem and its hall send. */
function place(t: Track, sr: number): { dry: Stereo; send: Float32Array[] } {
  const p = t.place;
  const g = Math.pow(10, (p.gainDb ?? 0) / 20);
  const n = t.left.length;
  const dl = new Float32Array(n);
  const dr = new Float32Array(n);
  const width = p.width ?? 1;
  const pan = Math.max(-1, Math.min(1, p.pan));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const directGain = 1 - 0.55 * p.depth;
  const air = new Biquad('highshelf', 5000, 0.7, sr, -9 * p.depth);
  const airR = new Biquad('highshelf', 5000, 0.7, sr, -9 * p.depth);
  for (let i = 0; i < n; i++) {
    const m = (t.left[i] + t.right[i]) / 2;
    const s = ((t.left[i] - t.right[i]) / 2) * width;
    dl[i] = air.process((m + s) * gl) * g * directGain;
    dr[i] = airR.process((m - s) * gr) * g * directGain;
  }
  const send = 0.25 + 0.75 * p.depth;
  const sl = new Float32Array(n);
  const sr2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sl[i] = t.left[i] * g * send * gl;
    sr2[i] = t.right[i] * g * send * gr;
  }
  return { dry: { left: dl, right: dr }, send: [sl, sr2] };
}

export function mixdown(tracks: Track[], sr: number, hall: HallSpec, o: { hallLevel?: number; targetLufs?: number; ceilingDb?: number; tail?: number } = {}): MixResult {
  const n = Math.max(...tracks.map((t) => t.left.length));
  const ML = new Float32Array(n);
  const MR = new Float32Array(n);
  const SL = new Float32Array(n);
  const SR = new Float32Array(n);
  const placed = tracks.map((t) => ({ t, ...place(t, sr) }));
  for (const p of placed)
    for (let i = 0; i < p.t.left.length; i++) {
      ML[i] += p.dry.left[i];
      MR[i] += p.dry.right[i];
      SL[i] += p.send[0][i];
      SR[i] += p.send[1][i];
    }
  const [irL, irR] = hallIR(sr, hall);
  const level = o.hallLevel ?? 0.32;
  // true-stereo-ish: L→L, R→R plus a little cross-feed for envelopment
  const wl = convolve(SL, irL);
  const wr = convolve(SR, irR);
  const xl = convolve(SR, irL);
  const xr = convolve(SL, irR);
  const hL = new Float32Array(n);
  const hR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hL[i] = (wl[i] + 0.35 * xl[i]) * level;
    hR[i] = (wr[i] + 0.35 * xr[i]) * level;
    ML[i] += hL[i];
    MR[i] += hR[i];
  }
  // master: bring to the loudness target, then a look-ahead peak limiter at the ceiling
  const lufs0 = loudness(ML, MR, sr).integrated;
  const target = o.targetLufs ?? -18;
  const gDb = target - lufs0;
  const g = Math.pow(10, gDb / 20);
  for (let i = 0; i < n; i++) {
    ML[i] *= g;
    MR[i] *= g;
  }
  limiter(ML, MR, sr, Math.pow(10, (o.ceilingDb ?? -1) / 20));
  // stems carry the same master gain so they sum (with the hall return) to the master before limiting
  const stems = placed.map((p) => ({ id: p.t.id, name: p.t.name, kind: p.t.kind, audio: { left: p.dry.left.map((v) => v * g), right: p.dry.right.map((v) => v * g) } }));
  const lm = loudness(ML, MR, sr);
  let peak = 0;
  let rms = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(ML[i]), Math.abs(MR[i]));
    rms += ML[i] * ML[i] + MR[i] * MR[i];
  }
  rms = Math.sqrt(rms / (2 * n));
  return {
    master: { left: ML, right: MR },
    stems,
    hallReturn: { left: hL.map((v) => v * g), right: hR.map((v) => v * g) },
    report: { peakDbfs: r1(20 * Math.log10(peak)), lufs: r1(lm.integrated), lra: r1(lm.lra), crestDb: r1(20 * Math.log10(peak / (rms || 1))), masterGainDb: r1(gDb) },
  };
}

function limiter(L: Float32Array, R: Float32Array, sr: number, ceiling: number): void {
  const la = Math.round(0.005 * sr);
  const n = L.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // minimum over the look-ahead window, then smooth release
  const gmin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let j = i; j < Math.min(n, i + la); j++) if (need[j] < m) m = need[j];
    gmin[i] = m;
  }
  let g = 1;
  const rel = 1 - Math.exp(-1 / (0.08 * sr));
  for (let i = 0; i < n; i++) {
    g = gmin[i] < g ? gmin[i] : g + (gmin[i] - g) * rel;
    L[i] *= g;
    R[i] *= g;
  }
  for (let i = 0; i < n; i++) {
    L[i] = Math.max(-ceiling, Math.min(ceiling, L[i]));
    R[i] = Math.max(-ceiling, Math.min(ceiling, R[i]));
  }
}

/** ITU-R BS.1770 integrated loudness (K-weighting, 400 ms blocks, gating) and a loudness range estimate. */
export function loudness(L: Float32Array, R: Float32Array, sr: number): { integrated: number; lra: number; shortTerm: number[] } {
  const k = (x: Float32Array) => {
    const a = new Biquad('highshelf', 1500, 0.71, sr, 4);
    const b = new Biquad('highpass', 38, 0.5, sr);
    return x.map((v) => b.process(a.process(v)));
  };
  const kl = k(L);
  const kr = k(R);
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const ms: number[] = [];
  for (let s = 0; s + block <= kl.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + block; i++) e += kl[i] * kl[i] + kr[i] * kr[i];
    ms.push(e / block);
  }
  const lk = (m: number) => -0.691 + 10 * Math.log10(m + 1e-20);
  const abs = ms.filter((m) => lk(m) > -70);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const rel = lk(mean(abs)) - 10;
  const gated = abs.filter((m) => lk(m) > rel);
  const integrated = lk(mean(gated));
  // short-term (3 s) loudness for LRA
  const st: number[] = [];
  const stb = Math.round(3 / 0.1);
  for (let i = 0; i + stb <= ms.length; i += 10) st.push(lk(mean(ms.slice(i, i + stb))));
  const stg = st.filter((v) => v > -70 && v > integrated - 20).sort((a, b) => a - b);
  const pct = (p: number) => stg[Math.min(stg.length - 1, Math.max(0, Math.floor(p * stg.length)))] ?? integrated;
  return { integrated, lra: pct(0.95) - pct(0.1), shortTerm: st };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
