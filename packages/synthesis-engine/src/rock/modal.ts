/**
 * Modal drum synthesis: drums as sums of decaying vibration modes.
 *  - Ideal circular membrane: f_mn ∝ j_mn (zeros of the Bessel function J_m), mode shape J_m(j_mn·r)
 *  - Simply supported rectangular plate (cymbals/hats): f_mn ∝ m² + (a·n)², a = plate aspect ratio
 *  - Tension modulation: pitch drops as the vibration decays (a cheap non-linear modal effect)
 * The Bessel zeros are computed here, not copied. Idea studied in baconpaul/ripplerx (GPL-3, ideas only)
 * and rodrigodzf/nlm (non-linear modal synthesis).
 */
import { Rng } from '@sonova/instrument-dna';
import { sinCycles } from '../voice.ts';
import { Biquad } from './filters.ts';

/** J_m(x) by its integral representation (trapezoid rule, deterministic). */
export function besselJ(m: number, x: number): number {
  const N = 256;
  let s = 0;
  for (let k = 0; k <= N; k++) {
    const tau = (Math.PI * k) / N;
    const w = k === 0 || k === N ? 0.5 : 1;
    s += w * Math.cos(m * tau - x * Math.sin(tau));
  }
  return s / N;
}

/** First `count` positive zeros of J_m. */
export function besselZeros(m: number, count: number): number[] {
  const zeros: number[] = [];
  let x = 0.5;
  let prev = besselJ(m, x);
  while (zeros.length < count && x < 60) {
    const nx = x + 0.05;
    const v = besselJ(m, nx);
    if (prev === 0 || prev * v < 0) {
      let lo = x;
      let hi = nx;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (besselJ(m, lo) * besselJ(m, mid) <= 0) hi = mid;
        else lo = mid;
      }
      zeros.push((lo + hi) / 2);
    }
    x = nx;
    prev = v;
  }
  return zeros;
}

export interface Mode {
  ratio: number;
  amp: number;
  /** decay time constant multiplier (higher modes decay faster) */
  decay: number;
}

const MEMBRANE_CACHE = new Map<string, Mode[]>();

/** Circular membrane modes struck at radius r (0 = centre, 1 = rim). */
export function membraneModes(strike: number, maxM = 4, maxN = 3): Mode[] {
  const key = `${strike}:${maxM}:${maxN}`;
  const hit = MEMBRANE_CACHE.get(key);
  if (hit) return hit;
  const j01 = besselZeros(0, 1)[0];
  const modes: Mode[] = [];
  for (let m = 0; m <= maxM; m++) {
    const zs = besselZeros(m, maxN);
    for (const z of zs) {
      const shape = Math.abs(besselJ(m, z * strike));
      const ratio = z / j01;
      modes.push({ ratio, amp: shape / Math.sqrt(ratio), decay: 1 / Math.pow(ratio, 0.9) });
    }
  }
  const max = Math.max(...modes.map((m) => m.amp));
  const out = modes.map((m) => ({ ...m, amp: m.amp / max })).sort((a, b) => a.ratio - b.ratio);
  MEMBRANE_CACHE.set(key, out);
  return out;
}

/** Rectangular plate modes, aspect ratio a; returns modes sorted by ratio up to maxRatio. */
export function plateModes(aspect: number, maxRatio: number, rng: Rng): Mode[] {
  const base = 1 + aspect * aspect;
  const modes: Mode[] = [];
  for (let m = 1; m <= 24; m++) {
    for (let n = 1; n <= 24; n++) {
      const ratio = (m * m + aspect * aspect * n * n) / base;
      if (ratio > maxRatio) continue;
      modes.push({ ratio, amp: (0.4 + 0.6 * rng.next()) / Math.pow(ratio, 0.25), decay: 1 / Math.pow(ratio, 0.35) });
    }
  }
  return modes.sort((a, b) => a.ratio - b.ratio);
}

export type DrumName = 'kick' | 'snare' | 'hat' | 'hatOpen' | 'crash' | 'ride' | 'tom1' | 'tom2' | 'tom3';

export interface ModalKit {
  kickHz: number;
  snareHz: number;
  tomHz: [number, number, number];
  /** Plate aspect ratio for cymbals (from a source's geometry). */
  plateAspect: number;
  cymbalBaseHz: number;
  /** Overall decay scale */
  decay: number;
  /** 0–1 snare wire amount */
  snares: number;
}

/** Render one drum hit (mono). */
export function renderDrumHit(kit: ModalKit, drum: DrumName, velocity: number, sampleRate: number, seed: string): Float32Array {
  const rng = new Rng(`drum:${seed}`);
  const v = Math.max(0.05, Math.min(1, velocity));
  const dt = 1 / sampleRate;
  if (drum === 'kick' || drum === 'snare' || drum.startsWith('tom')) {
    const f0 = drum === 'kick' ? kit.kickHz : drum === 'snare' ? kit.snareHz : kit.tomHz[Number(drum.slice(3)) - 1];
    const strike = drum === 'kick' ? 0.08 : drum === 'snare' ? 0.35 : 0.3;
    const modes = membraneModes(strike).filter((m) => f0 * m.ratio < 9000).slice(0, drum === 'kick' ? 6 : 14);
    const baseDecay = (drum === 'kick' ? 0.22 : drum === 'snare' ? 0.15 : 0.38) * kit.decay;
    const len = Math.ceil((baseDecay * 5 + 0.05) * sampleRate);
    const out = new Float32Array(len);
    const bend = drum === 'kick' ? 1.6 : drum === 'snare' ? 0.25 : 0.45; // tension modulation depth
    const phases = modes.map(() => rng.next());
    const clickLp = new Biquad('highpass', drum === 'kick' ? 2500 : 1200, 0.7, sampleRate);
    const wireBp = new Biquad('bandpass', 4200, 0.6, sampleRate);
    const wireHp = new Biquad('highpass', 1800, 0.7, sampleRate);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i * dt;
      const ampEnv = Math.exp(-t / baseDecay);
      const pitch = f0 * (1 + bend * v * Math.exp(-t / (drum === 'kick' ? 0.035 : 0.05)));
      phase += pitch * dt;
      let s = 0;
      for (let k = 0; k < modes.length; k++) s += modes[k].amp * Math.exp(-t / (baseDecay * modes[k].decay)) * sinCycles(phases[k] + phase * modes[k].ratio);
      s *= 0.6;
      const click = clickLp.process((rng.next() * 2 - 1) * Math.exp(-t / 0.004)) * (drum === 'kick' ? 0.5 : 0.35);
      let wires = 0;
      if (drum === 'snare') wires = wireHp.process(wireBp.process(rng.next() * 2 - 1)) * kit.snares * 1.6 * Math.exp(-t / (baseDecay * 1.3)) * (0.6 + 0.4 * Math.abs(s));
      out[i] = Math.tanh((s * ampEnv + click + wires) * (1 + v)) * v;
    }
    return out;
  }
  // Plates: hats and cymbals
  const isHat = drum === 'hat' || drum === 'hatOpen';
  const base = kit.cymbalBaseHz * (isHat ? 1.9 : drum === 'ride' ? 1.2 : 1);
  const modes = plateModes(kit.plateAspect, 15000 / base, rng.fork(drum)).slice(0, isHat ? 70 : 110);
  const decay = (drum === 'hat' ? 0.045 : drum === 'hatOpen' ? 0.32 : drum === 'ride' ? 1.4 : 1.9) * kit.decay;
  const len = Math.ceil((decay * 4.5 + 0.02) * sampleRate);
  const out = new Float32Array(len);
  // Resonator bank excited by a short mallet pulse.
  const res = modes.map((m) => {
    const f = base * m.ratio;
    const r = Math.exp(-1 / (decay * m.decay * 0.4 * sampleRate));
    return { c: 2 * r * Math.cos((2 * Math.PI * f) / sampleRate), r2: r * r, y1: 0, y2: 0, amp: m.amp * Math.sin((2 * Math.PI * f) / sampleRate) };
  });
  const hp = new Biquad('highpass', isHat ? 6500 : 3000, 0.7, sampleRate);
  const hp2 = new Biquad('highpass', isHat ? 5000 : 900, 0.7, sampleRate);
  const pulseLen = Math.max(2, Math.round(sampleRate * (isHat ? 0.002 : 0.012)));
  const ping = drum === 'ride';
  for (let i = 0; i < len; i++) {
    const t = i * dt;
    const x = i < pulseLen ? (rng.next() * 2 - 1) * Math.sin((Math.PI * i) / pulseLen) : 0;
    let s = 0;
    for (const q of res) {
      const y = q.c * q.y1 - q.r2 * q.y2 + x * q.amp;
      q.y2 = q.y1;
      q.y1 = y;
      s += y;
    }
    const noise = (rng.next() * 2 - 1) * Math.exp(-t / (decay * 0.7)) * (isHat ? 0.9 : 0.7) * (0.75 + 0.25 * Math.tanh(s * 4));
    let y = hp2.process(hp.process(s * 0.25 + noise));
    if (ping) y += Math.sin(2 * Math.PI * base * 2.71 * t) * Math.exp(-t / 0.25) * 0.08;
    out[i] = Math.tanh(y * 1.5) * v;
  }
  return out;
}
