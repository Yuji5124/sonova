/**
 * Electronic voices (own implementations): FM, additive (from an analysed orchestral timbre),
 * granular (grains cut from orchestral recordings), drum-machine voices, glitch processing.
 * All mono Float32Array at `sr`; deterministic for the same seed.
 */
import { Rng } from '@sonova/instrument-dna';
import { Biquad } from '@sonova/synthesis-engine';
import type { TimbreProfile } from './timbre.ts';

const TAU = Math.PI * 2;
export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
}

function adsr(i: number, sr: number, dur: number, e: Env): number {
  const t = i / sr;
  if (t < e.a) return t / Math.max(1e-4, e.a);
  if (t < e.a + e.d) return 1 - (1 - e.s) * ((t - e.a) / Math.max(1e-4, e.d));
  if (t < dur) return e.s;
  return e.s * Math.max(0, 1 - (t - dur) / Math.max(1e-4, e.r));
}

/** 2-operator FM with modulation index decaying from `index` to `index * indexEnd`, plus optional feedback. */
export function fm(midi: number, dur: number, sr: number, o: { ratio?: number; index?: number; indexEnd?: number; indexTime?: number; env?: Env; feedback?: number; detuneCents?: number } = {}): Float32Array {
  const env = o.env ?? { a: 0.005, d: 0.3, s: 0.4, r: 0.3 };
  const n = Math.ceil((dur + env.r) * sr);
  const out = new Float32Array(n);
  const f = midiHz(midi) * Math.pow(2, (o.detuneCents ?? 0) / 1200);
  const ratio = o.ratio ?? 1;
  const I0 = o.index ?? 2;
  const I1 = I0 * (o.indexEnd ?? 0.2);
  const it = o.indexTime ?? 0.4;
  let pm = 0;
  let pc = 0;
  let fb = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const I = I1 + (I0 - I1) * Math.exp(-t / it);
    pm += (f * ratio) / sr;
    pc += f / sr;
    const m = Math.sin(TAU * pm + (o.feedback ?? 0) * fb);
    fb = m;
    out[i] = Math.sin(TAU * pc + I * m) * adsr(i, sr, dur, env);
  }
  return out;
}

/**
 * Additive resynthesis of an analysed timbre. `morph` 0 = the instrument's own partials;
 * towards 1 the partials stretch (inharmonic, like a bar or a bell), the spectrum tilts and
 * a frozen-noise halo grows: the orchestral note becomes a digital one.
 */
export function additive(profile: TimbreProfile, midi: number, dur: number, sr: number, o: { morph?: (t: number) => number; env?: Env; seed?: string; vibrato?: number } = {}): Float32Array {
  const env = o.env ?? { a: profile.attack, d: 0.1, s: 1, r: Math.max(0.2, profile.release) };
  const n = Math.ceil((dur + env.r) * sr);
  const out = new Float32Array(n);
  const rng = new Rng(`add:${o.seed ?? ''}`);
  const f0 = midiHz(midi);
  const parts = profile.partials.map((amp, k) => ({ k: k + 1, amp, ph: rng.next() * TAU, jit: (rng.next() - 0.5) * 0.004 }));
  const noise = new Biquad('bandpass', f0 * 4, 0.7, sr);
  const morph = o.morph ?? (() => 0);
  const vib = o.vibrato ?? 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const m = Math.max(0, Math.min(1, morph(t)));
    const stretch = 1 + 0.035 * m * m;
    const v = 1 + vib * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.4);
    let y = 0;
    for (const p of parts) {
      const fk = f0 * p.k * Math.pow(p.k, Math.log2(stretch)) * (1 + p.jit * m) * v;
      if (fk > sr * 0.45) continue;
      p.ph += (TAU * fk) / sr;
      const tilt = Math.pow(p.k, -0.9 * m) * (1 + 1.5 * m * (p.k % 2 === 0 ? 1 : 0));
      y += p.amp * tilt * Math.sin(p.ph);
    }
    y += noise.process(rng.next() * 2 - 1) * 0.25 * m * profile.noise;
    out[i] = y * adsr(i, sr, dur, env);
  }
  return out;
}

/** A cloud of grains cut from `src` (an orchestral recording). Position, pitch and density move over time. */
export function grains(src: Float32Array, srcSr: number, dur: number, sr: number, o: { position: (t: number) => number; pitch?: (t: number) => number; density?: (t: number) => number; grainSec?: number; spread?: number; seed?: string; reverseProb?: number }): [Float32Array, Float32Array] {
  const n = Math.ceil(dur * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rng = new Rng(`grains:${o.seed ?? ''}`);
  const gs = o.grainSec ?? 0.08;
  let t = 0;
  while (t < dur) {
    const dens = Math.max(1, (o.density ?? (() => 30))(t));
    t += (1 / dens) * (0.5 + rng.next());
    if (t >= dur) break;
    const pos = Math.max(0, Math.min(1, o.position(t) + (rng.next() - 0.5) * (o.spread ?? 0.02)));
    const semis = (o.pitch ?? (() => 0))(t);
    const ratio = Math.pow(2, semis / 12) * (srcSr / sr);
    const len = Math.round(gs * (0.7 + 0.6 * rng.next()) * sr);
    const start = Math.round(pos * Math.max(0, src.length - len * ratio - 2));
    const rev = rng.next() < (o.reverseProb ?? 0);
    const pan = rng.next() * 2 - 1;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const at = Math.round(t * sr);
    for (let i = 0; i < len && at + i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((TAU * i) / len);
      const p = start + (rev ? len - i : i) * ratio;
      const k = Math.floor(p);
      const y = ((src[k] ?? 0) * (1 - (p - k)) + (src[k + 1] ?? 0) * (p - k)) * w;
      L[at + i] += y * gl;
      R[at + i] += y * gr;
    }
  }
  return [L, R];
}

export function kick(sr: number, o: { hz?: number; drop?: number; decay?: number; click?: number } = {}): Float32Array {
  const n = Math.ceil(0.6 * sr);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = (o.hz ?? 46) * (1 + (o.drop ?? 3) * Math.exp(-t / 0.03));
    ph += (TAU * f) / sr;
    out[i] = Math.sin(ph) * Math.exp(-t / (o.decay ?? 0.18)) + (t < 0.002 ? (o.click ?? 0.3) * (1 - t / 0.002) : 0);
  }
  return out;
}

export function noiseHit(sr: number, seed: string, o: { hp?: number; bp?: number; decay?: number; len?: number } = {}): Float32Array {
  const n = Math.ceil((o.len ?? 0.12) * sr);
  const out = new Float32Array(n);
  const rng = new Rng(`nh:${seed}`);
  const f = o.bp ? new Biquad('bandpass', o.bp, 1.2, sr) : new Biquad('highpass', o.hp ?? 7000, 0.7, sr);
  for (let i = 0; i < n; i++) out[i] = f.process(rng.next() * 2 - 1) * Math.exp(-i / sr / (o.decay ?? 0.03));
  return out;
}

/** A single-cycle click — the "digital grain" that appears at the very beginning. */
export function click(sr: number, hz = 3000): Float32Array {
  const n = Math.ceil(sr / hz) * 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((TAU * hz * i) / sr) * (1 - i / n);
  return out;
}

/** Dust: sparse random impulses through a resonant filter (vinyl-like crackle / digital dust). */
export function dust(dur: number, sr: number, seed: string, o: { rate?: (t: number) => number; hz?: number; q?: number } = {}): Float32Array {
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const rng = new Rng(`dust:${seed}`);
  const f = new Biquad('bandpass', o.hz ?? 4200, o.q ?? 6, sr);
  for (let i = 0; i < n; i++) {
    const r = (o.rate ?? (() => 8))(i / sr);
    const imp = rng.next() < r / sr ? (rng.next() * 2 - 1) : 0;
    out[i] = f.process(imp);
  }
  return out;
}

/** Glitch: stutter (repeat a short slice), reverse, and sample-rate reduction, driven by a list of events. */
export function glitch(x: Float32Array, sr: number, events: Array<{ at: number; len: number; kind: 'stutter' | 'reverse' | 'crush'; repeats?: number; slice?: number; hold?: number }>): Float32Array {
  const y = x.slice();
  for (const e of events) {
    const a = Math.round(e.at * sr);
    const n = Math.round(e.len * sr);
    if (e.kind === 'stutter') {
      const s = Math.max(16, Math.round((e.slice ?? 0.06) * sr));
      for (let i = 0; i < n && a + i < y.length; i++) {
        const k = i % s;
        const fade = Math.min(1, k / 32, (s - k) / 32);
        y[a + i] = x[a + k] * fade;
      }
    } else if (e.kind === 'reverse') {
      for (let i = 0; i < n && a + i < y.length; i++) y[a + i] = x[Math.min(x.length - 1, a + n - 1 - i)] * Math.min(1, i / 64, (n - i) / 64);
    } else {
      const hold = Math.max(2, e.hold ?? 8);
      for (let i = 0; i < n && a + i < y.length; i++) y[a + i] = Math.round(x[a + i - (i % hold)] * 24) / 24;
    }
  }
  return y;
}

/** Sub sine with a soft attack — the electronic low end. */
export function sub(midi: number, dur: number, sr: number, env: Env = { a: 0.02, d: 0.1, s: 0.9, r: 0.2 }): Float32Array {
  const n = Math.ceil((dur + env.r) * sr);
  const out = new Float32Array(n);
  const f = midiHz(midi);
  for (let i = 0; i < n; i++) out[i] = Math.sin((TAU * f * i) / sr) * adsr(i, sr, dur, env) + 0.15 * Math.sin((TAU * 2 * f * i) / sr) * adsr(i, sr, dur, env);
  return out;
}
