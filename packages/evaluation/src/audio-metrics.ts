/**
 * Does the sound actually do what the picture says? One probe note per instrument (A3, 0.8 s) is
 * rendered and measured, then compared with the picture by rank correlation (Spearman) over the corpus:
 * "the picture with the sharpest edges should have the fastest attack", and so on.
 */
import { fft, type ImageFeatures } from '@sonova/source-analyzer';
import type { InstrumentDNA } from '@sonova/instrument-dna';

export interface ProbeDescriptors {
  /** 10% → 90% of the envelope peak (s) */
  attack: number;
  /** after note-off (0.8 s): how long the tail stays above −20 dB of the peak (s) */
  decay: number;
  /** spectral centroid / f0 over 30–330 ms */
  centroid: number;
  /** share of energy away from the harmonics in the first 80 ms (noise burst, clicks) */
  onsetNoise: number;
  /** share of energy away from the harmonics in the held part (FM sidebands, inharmonicity) */
  irregularity: number;
  /** a resonance note: time until −20 dB (s) */
  ring: number;
  /** how much the partials waver in the held part, decay removed (dB): beating, vibrato, shimmer */
  shimmer: number;
}

export type ProbeRenderer = (dna: InstrumentDNA, note: { midi: number; velocity: number; duration: number; timbre: number; kind: 'note' | 'resonance' }, sampleRate: number, seed: string) => Float32Array;

const SR = 44100;
const F0 = 220;

function envelope(x: Float32Array, win = Math.round(0.005 * SR)): Float64Array {
  const e = new Float64Array(Math.ceil(x.length / win));
  for (let k = 0; k < e.length; k++) {
    let s = 0;
    for (let i = k * win; i < Math.min(x.length, (k + 1) * win); i++) s += x[i] * x[i];
    e[k] = Math.sqrt(s / win);
  }
  return e;
}

function harmonicShare(x: Float32Array, start: number, len: number): { centroid: number; offHarmonic: number } {
  const N = 16384;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const n = Math.min(len, N, x.length - start);
  for (let i = 0; i < n; i++) re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  let tot = 0;
  let off = 0;
  let cen = 0;
  const bin = SR / N;
  for (let k = 1; k < N / 2; k++) {
    const hz = k * bin;
    if (hz < 60 || hz > 16000) continue;
    const p = re[k] * re[k] + im[k] * im[k];
    tot += p;
    cen += p * hz;
    const h = hz / F0;
    if (Math.abs(hz - Math.round(h) * F0) > Math.max(15, 0.01 * hz)) off += p;
  }
  return { centroid: tot > 0 ? cen / tot / F0 : 0, offHarmonic: tot > 0 ? off / tot : 0 };
}

/**
 * wavering of the partials: for harmonics 1–10, the log-amplitude over the held part with its straight
 * trend (the decay) removed; RMS of what is left (dB), weighted by each harmonic's level.
 * Beating, vibrato and FM shimmer raise it; a plain decay does not.
 */
function partialWaver(x: Float32Array, start: number, end: number): number {
  const N = 4096;
  const hop = 441;
  const series: number[][] = Array.from({ length: 10 }, () => []);
  for (let a = start; a + N <= Math.min(end, x.length); a += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    for (let h = 1; h <= 10; h++) {
      const k0 = Math.round((h * F0 * N) / SR);
      let m = 0;
      for (let k = k0 - 2; k <= k0 + 2; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
      series[h - 1].push(m);
    }
  }
  let num = 0;
  let den = 0;
  for (const s of series) {
    if (s.length < 4) continue;
    const level = s.reduce((p, q) => p + q, 0) / s.length;
    if (level <= 0) continue;
    const y = s.map((v) => 20 * Math.log10(v + level * 1e-3));
    const n = y.length;
    const mx = (n - 1) / 2;
    const my = y.reduce((p, q) => p + q, 0) / n;
    let sxy = 0;
    let sxx = 0;
    y.forEach((v, i) => {
      sxy += (i - mx) * (v - my);
      sxx += (i - mx) ** 2;
    });
    const b = sxy / sxx;
    const rms = Math.sqrt(y.reduce((p, v, i) => p + (v - my - b * (i - mx)) ** 2, 0) / n);
    num += rms * level;
    den += level;
  }
  return den > 0 ? num / den : 0;
}

export function probe(dna: InstrumentDNA, render: ProbeRenderer): ProbeDescriptors {
  const x = render(dna, { midi: 57, velocity: 0.8, duration: 0.8, timbre: 0, kind: 'note' }, SR, `probe:${dna.dna_hash}`);
  const e = envelope(x);
  let pk = 0;
  for (let k = 0; k < e.length; k++) if (e[k] > e[pk]) pk = k;
  const peak = e[pk] || 1e-9;
  let a10 = 0;
  while (a10 < pk && e[a10] < 0.1 * peak) a10++;
  let a90 = a10;
  while (a90 < pk && e[a90] < 0.9 * peak) a90++;
  // the last moment above −20 dB (a beat or vibrato dip must not end the note early)
  let d = e.length - 1;
  while (d > pk && e[d] <= peak * 0.1) d--;
  const at = Math.round(a10 * 0.005 * SR);
  const body = harmonicShare(x, at + Math.round(0.03 * SR), Math.round(0.3 * SR));
  const onset = harmonicShare(x, at, Math.round(0.08 * SR));
  const held = harmonicShare(x, at + Math.round(0.15 * SR), Math.round(0.5 * SR));
  const r = render(dna, { midi: 57, velocity: 0.6, duration: 0.6, timbre: 0, kind: 'resonance' }, SR, `probe-res:${dna.dna_hash}`);
  const er = envelope(r);
  let rp = 0;
  for (let k = 0; k < er.length; k++) if (er[k] > er[rp]) rp = k;
  let rd = er.length - 1;
  while (rd > rp && er[rd] <= er[rp] * 0.1) rd--;
  const shimmer = partialWaver(x, at + Math.round(0.15 * SR), at + Math.round(0.8 * SR));
  return { attack: (a90 - a10) * 0.005, decay: Math.max(0, d * 0.005 - Math.max(0.8, dna.attack)), centroid: body.centroid, onsetNoise: onset.offHarmonic, irregularity: held.offHarmonic, ring: (rd - rp) * 0.005, shimmer };
}

export interface FidelityPair {
  name: string;
  feature: keyof ImageFeatures;
  descriptor: keyof ProbeDescriptors;
  sign: 1 | -1;
}

export const FIDELITY_PAIRS: FidelityPair[] = [
  { name: '細かい模様 → 明るい音色', feature: 'highFreqRatio', descriptor: 'centroid', sign: 1 },
  { name: '鋭いエッジ → 速い立ち上がり', feature: 'edgeMean', descriptor: 'attack', sign: -1 },
  { name: '滑らかな画像 → 長い余韻', feature: 'edgeMean', descriptor: 'decay', sign: -1 },
  { name: '粗い質感 → ノイズの多い発音', feature: 'textureRoughness', descriptor: 'onsetNoise', sign: 1 },
  { name: '色の豊かさ → 揺らぐ倍音', feature: 'colorfulness', descriptor: 'shimmer', sign: 1 },
  { name: '反復構造 → 長い共鳴', feature: 'repetitionStrength', descriptor: 'ring', sign: 1 },
];

function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export interface FidelityResult {
  pairs: Array<{ name: string; rho: number }>;
  mean: number;
  probes: ProbeDescriptors[];
}

export function evaluateFidelity(items: Array<{ features: ImageFeatures; dna: InstrumentDNA }>, render: ProbeRenderer): FidelityResult {
  const probes = items.map((it) => probe(it.dna, render));
  const pairs = FIDELITY_PAIRS.map((p) => ({ name: p.name, rho: Math.round(p.sign * spearman(items.map((it) => Number(it.features[p.feature])), probes.map((q) => q[p.descriptor])) * 1000) / 1000 }));
  return { pairs, mean: Math.round((pairs.reduce((s, p) => s + p.rho, 0) / pairs.length) * 1000) / 1000, probes };
}
