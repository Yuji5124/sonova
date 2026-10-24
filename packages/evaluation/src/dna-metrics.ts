/**
 * How faithfully and how robustly a picture becomes an instrument.
 *  - robustness: a nuisance transform (resize, noise, crop, exposure, compression) should leave the DNA close
 *  - discrimination: different materials should give clearly different DNA
 *  - identification: after a nuisance transform, the nearest original DNA should be the picture's own
 *  - category: the nearest other picture should be the same material (two brick walls sound alike)
 *  - flips: discrete choices (key, rhythm grid, response rules) that jump under a nuisance transform
 */
import type { InstrumentDNA } from '@sonova/instrument-dna';

export interface DnaParam {
  key: string;
  get: (d: InstrumentDNA) => number;
  /** log-scaled (times, ratios) */
  log?: boolean;
  /** circular with this period (pitch class) */
  period?: number;
}

/** the musically meaningful DNA parameters (seeded ones such as rhythm.rotation and pan are left out) */
export const DNA_PARAMS: DnaParam[] = [
  { key: 'pitch.center', get: (d) => d.pitch_range.center },
  { key: 'pitch.width', get: (d) => d.pitch_range.high - d.pitch_range.low },
  { key: 'pitch.root_pc', get: (d) => d.pitch_range.root_pc, period: 12 },
  { key: 'harmonics.brightness', get: (d) => d.harmonics.brightness },
  { key: 'harmonics.damping', get: (d) => d.harmonics.damping },
  { key: 'harmonics.inharmonicity', get: (d) => d.harmonics.inharmonicity },
  { key: 'harmonics.centroid', get: (d) => d.harmonics.amplitudes.reduce((s, a, k) => s + a * (k + 1), 0) / d.harmonics.amplitudes.reduce((s, a) => s + a, 0) },
  { key: 'attack', get: (d) => d.attack, log: true },
  { key: 'decay', get: (d) => d.decay, log: true },
  { key: 'sustain', get: (d) => d.sustain },
  { key: 'release', get: (d) => d.release, log: true },
  { key: 'resonance.amount', get: (d) => d.resonance.amount },
  { key: 'resonance.q', get: (d) => d.resonance.q, log: true },
  { key: 'noise.amount', get: (d) => d.noise.amount },
  { key: 'noise.color', get: (d) => d.noise.color },
  { key: 'fm.ratio', get: (d) => d.modulation.fm_ratio, log: true },
  { key: 'fm.index', get: (d) => d.modulation.fm_index },
  { key: 'vibrato.rate', get: (d) => d.modulation.vibrato_rate, log: true },
  { key: 'vibrato.depth', get: (d) => d.modulation.vibrato_depth },
  { key: 'filter.cutoff', get: (d) => d.filter.cutoff_ratio, log: true },
  { key: 'rhythm.steps', get: (d) => d.rhythm.steps },
  { key: 'rhythm.pulses', get: (d) => d.rhythm.pulses },
  { key: 'rhythm.rate', get: (d) => d.rhythm.rate, log: true },
  { key: 'interaction.emission', get: (d) => d.interaction_rules.emission },
  { key: 'interaction.sensitivity', get: (d) => d.interaction_rules.sensitivity },
];

/** discrete choices whose change is audible as "another instrument" */
export const DISCRETE: Array<{ key: string; get: (d: InstrumentDNA) => string | number }> = [
  { key: 'root_pc', get: (d) => d.pitch_range.root_pc },
  { key: 'rhythm.steps', get: (d) => d.rhythm.steps },
  { key: 'rhythm.pulses', get: (d) => d.rhythm.pulses },
  { key: 'rhythm.rate', get: (d) => d.rhythm.rate },
  { key: 'fm.ratio', get: (d) => d.modulation.fm_ratio },
  { key: 'responses', get: (d) => d.interaction_rules.responses.map((r) => r.effect).sort().join('+') },
];

const value = (p: DnaParam, d: InstrumentDNA) => (p.log ? Math.log(Math.max(1e-6, p.get(d))) : p.get(d));
const diff = (p: DnaParam, a: number, b: number) => {
  const x = Math.abs(a - b);
  return p.period ? Math.min(x, p.period - x) : x;
};

/** per-parameter scale = spread of that parameter over the reference set (so every parameter counts alike) */
export function paramScales(ref: InstrumentDNA[]): number[] {
  return DNA_PARAMS.map((p) => {
    const xs = ref.map((d) => value(p, d));
    // mean absolute pairwise difference (robust and works for circular parameters)
    let s = 0;
    let n = 0;
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) {
        s += diff(p, xs[i], xs[j]);
        n++;
      }
    return Math.max(1e-9, s / Math.max(1, n));
  });
}

/** distance in "typical differences between two pictures": 1 ≈ as different as two random pictures */
export function dnaDistance(a: InstrumentDNA, b: InstrumentDNA, scales: number[]): number {
  let s = 0;
  DNA_PARAMS.forEach((p, k) => {
    const d = diff(p, value(p, a), value(p, b)) / scales[k];
    s += d * d;
  });
  return Math.sqrt(s / DNA_PARAMS.length);
}

export interface DnaEvaluation {
  /** mean distance original ↔ transformed, per transform */
  nuisance: Record<string, number>;
  nuisanceMean: number;
  /** mean distance between pictures of different materials */
  between: number;
  /** mean distance between the two pictures of the same material */
  sameMaterial: number;
  /** nuisance / between: lower = more robust relative to how different pictures are */
  robustnessRatio: number;
  identification: number;
  category: number;
  flips: Record<string, number>;
  flipRate: number;
  /** how many distinct values the discrete choices take over the corpus (variety) */
  variety: Record<string, number>;
  /** the parameters that move most under the nuisance transforms (in scale units) */
  unstable: Array<{ key: string; meanShift: number }>;
}

export function evaluateDna(originals: Array<{ id: string; material: string; dna: InstrumentDNA }>, transformed: Array<{ id: string; transform: string; dna: InstrumentDNA }>): DnaEvaluation {
  const scales = paramScales(originals.map((o) => o.dna));
  const byId = new Map(originals.map((o) => [o.id, o]));
  const nuisance: Record<string, number[]> = {};
  let correct = 0;
  const flips: Record<string, number> = Object.fromEntries(DISCRETE.map((d) => [d.key, 0]));
  const shift = DNA_PARAMS.map(() => 0);
  for (const t of transformed) {
    const o = byId.get(t.id)!;
    (nuisance[t.transform] ??= []).push(dnaDistance(o.dna, t.dna, scales));
    let best = '';
    let bd = Infinity;
    for (const c of originals) {
      const d = dnaDistance(c.dna, t.dna, scales);
      if (d < bd) {
        bd = d;
        best = c.id;
      }
    }
    if (best === t.id) correct++;
    for (const d of DISCRETE) if (String(d.get(o.dna)) !== String(d.get(t.dna))) flips[d.key]++;
    DNA_PARAMS.forEach((p, k) => (shift[k] += diff(p, value(p, o.dna), value(p, t.dna)) / scales[k]));
  }
  let between = 0;
  let nb = 0;
  let same = 0;
  let ns = 0;
  let cat = 0;
  for (const a of originals) {
    let best: (typeof originals)[number] | null = null;
    let bd = Infinity;
    for (const b of originals) {
      if (a === b) continue;
      const d = dnaDistance(a.dna, b.dna, scales);
      if (a.material === b.material) {
        same += d;
        ns++;
      } else {
        between += d;
        nb++;
      }
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best && best.material === a.material) cat++;
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const nuis = Object.fromEntries(Object.entries(nuisance).map(([k, v]) => [k, r4(mean(v))]));
  const nuisanceMean = mean(Object.values(nuisance).flat());
  const b = between / Math.max(1, nb);
  const n = transformed.length;
  return {
    nuisance: nuis,
    nuisanceMean: r4(nuisanceMean),
    between: r4(b),
    sameMaterial: r4(same / Math.max(1, ns)),
    robustnessRatio: r4(nuisanceMean / b),
    identification: r4(correct / n),
    category: r4(cat / originals.length),
    flips: Object.fromEntries(Object.entries(flips).map(([k, v]) => [k, r4(v / n)])),
    flipRate: r4(Object.values(flips).reduce((s, v) => s + v, 0) / (n * DISCRETE.length)),
    variety: Object.fromEntries(DISCRETE.map((d) => [d.key, new Set(originals.map((o) => String(d.get(o.dna)))).size])),
    unstable: DNA_PARAMS.map((p, k) => ({ key: p.key, meanShift: r4(shift[k] / n) }))
      .sort((x, y) => y.meanShift - x.meanShift)
      .slice(0, 6),
  };
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
