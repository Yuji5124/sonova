/**
 * Orchestra sample library: Versilian Studios Chamber Orchestra 2 – Community Edition (VSCO-2-CE),
 * https://github.com/sgossner/VSCO-2-CE — CC0 1.0 (public domain). The samples are NOT in this
 * repository; `scripts/od-fetch-samples.ts` downloads the folders listed here into vendor/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fft } from '@sonova/source-analyzer';
import { decodeWavAny, type Audio } from './wav.ts';

export interface InstrumentPreset {
  name: string;
  family: 'strings' | 'woodwinds' | 'brass' | 'percussion' | 'plucked';
  /** articulation → folder inside the library */
  arts: Record<string, string>;
  /** articulations that sustain for the note's duration (others play their natural length) */
  sustained: string[];
  release: number;
  /** files to skip inside a folder (regex) */
  skip?: RegExp;
  /**
   * semitones from the file name's note to the sounding pitch. VSCO-2-CE names notes one octave
   * low (a file named A3 sounds A4 = 440 Hz; measured with a harmonic-sum pitch detector for every
   * folder), except the harp, whose names are true pitch. Default 12.
   */
  nameOffset?: number;
}

export const INSTRUMENTS: Record<string, InstrumentPreset> = {
  violins: { name: 'Violins', family: 'strings', arts: { sus: 'Strings/Violin Section/susVib', spic: 'Strings/Violin Section/Spic', pizz: 'Strings/Violin Section/Pizz', trem: 'Strings/Violin Section/Trem' }, sustained: ['sus', 'trem'], release: 0.4 },
  violas: { name: 'Violas', family: 'strings', arts: { sus: 'Strings/Viola Section/susvib', spic: 'Strings/Viola Section/spic', pizz: 'Strings/Viola Section/pizz', trem: 'Strings/Viola Section/trem' }, sustained: ['sus', 'trem'], release: 0.4 },
  celli: { name: 'Celli', family: 'strings', arts: { sus: 'Strings/Cello Section/susvib', spic: 'Strings/Cello Section/spic', pizz: 'Strings/Cello Section/pizzT', trem: 'Strings/Cello Section/trem' }, sustained: ['sus', 'trem'], release: 0.45 },
  contrabass: { name: 'Contrabass', family: 'strings', arts: { sus: 'Strings/Solo Contrabass/SusVib', susnv: 'Strings/Solo Contrabass/SusNV', spic: 'Strings/Solo Contrabass/Spic', pizz: 'Strings/Solo Contrabass/Pizz', trem: 'Strings/Solo Contrabass/Trem' }, sustained: ['sus', 'susnv', 'trem'], release: 0.5 },
  harp: { name: 'Harp', family: 'plucked', arts: { pluck: 'Strings/Harp' }, sustained: [], release: 1.5, nameOffset: 0 },
  flute: { name: 'Flute', family: 'woodwinds', arts: { sus: 'Woodwinds/Flute/susvib', susnv: 'Woodwinds/Flute/susNV', stac: 'Woodwinds/Flute/stac' }, sustained: ['sus', 'susnv'], release: 0.25 },
  oboe: { name: 'Oboe', family: 'woodwinds', arts: { sus: 'Woodwinds/Oboe/Vib', susnv: 'Woodwinds/Oboe/Sus', stac: 'Woodwinds/Oboe/Stacc' }, sustained: ['sus', 'susnv'], release: 0.25 },
  clarinet: { name: 'Clarinet', family: 'woodwinds', arts: { sus: 'Woodwinds/Clarinet/susLong', stac: 'Woodwinds/Clarinet/stac' }, sustained: ['sus'], release: 0.25 },
  bassoon: { name: 'Bassoon', family: 'woodwinds', arts: { sus: 'Woodwinds/Bassoon/sus', stac: 'Woodwinds/Bassoon/stac' }, sustained: ['sus'], release: 0.3 },
  horn: { name: 'Horn', family: 'brass', arts: { sus: 'Brass/F Horn/sus', stac: 'Brass/F Horn/stac' }, sustained: ['sus'], release: 0.35 },
  trumpet: { name: 'Trumpet', family: 'brass', arts: { sus: 'Brass/Trumpet/sus' }, sustained: ['sus'], release: 0.3 },
  trombone: { name: 'Trombone', family: 'brass', arts: { sus: 'Brass/Tenor Trombone/sus' }, sustained: ['sus'], release: 0.35 },
  tuba: { name: 'Tuba', family: 'brass', arts: { sus: 'Brass/Tuba/sus' }, sustained: ['sus'], release: 0.4 },
  timpani: { name: 'Timpani', family: 'percussion', arts: { hit: 'Percussion/Timpani', roll: 'Percussion/Timpani/Rolls' }, sustained: ['roll'], release: 1.2 },
  glock: { name: 'Glockenspiel', family: 'percussion', arts: { hit: 'Percussion/Glock' }, sustained: [], release: 1.5 },
};

export const LIBRARY_FOLDERS = [...new Set(Object.values(INSTRUMENTS).flatMap((p) => Object.values(p.arts)))];

export interface SampleZone {
  path: string;
  midi: number;
  layer: number;
  layers: number;
  rr: number;
  audio?: Audio;
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DYN = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

export function parseSampleName(file: string): { midi?: number; vel?: number; dyn?: number; rr: number } {
  const base = file.replace(/\.wav$/i, '');
  const note = base.match(/(?:^|[_\s-])([A-Ga-g])([#b]?)(-?\d)(?=$|[_\s-])/);
  const midi = note ? 12 * (Number(note[3]) + 1) + NOTE[note[1].toUpperCase()] + (note[2] === '#' ? 1 : note[2] === 'b' ? -1 : 0) : undefined;
  const v = base.match(/_v(\d+)/i);
  const rr = base.match(/rr(\d+)/i);
  const dynWord = base.split(/[_\s-]/).map((w) => DYN.indexOf(w.toLowerCase())).find((i) => i >= 0);
  return { midi, vel: v ? Number(v[1]) : undefined, dyn: dynWord, rr: rr ? Number(rr[1]) : 1 };
}

/** Rough pitch of an unpitched-by-name sample (e.g. timpani): strongest spectral peak 40–700 Hz. */
export function estimateMidi(a: Audio): number {
  const x = a.channels[0];
  const N = 16384;
  const start = Math.min(Math.round(0.05 * a.sampleRate), Math.max(0, x.length - N));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  let best = 0;
  let bk = 1;
  for (let k = Math.ceil((40 * N) / a.sampleRate); k < (700 * N) / a.sampleRate; k++) {
    const m = re[k] * re[k] + im[k] * im[k];
    if (m > best) {
      best = m;
      bk = k;
    }
  }
  const hz = (bk * a.sampleRate) / N;
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

export class SampleLibrary {
  private zones = new Map<string, SampleZone[]>();
  private rrCounter = new Map<string, number>();

  constructor(readonly root: string) {
    if (!existsSync(join(root, 'Strings'))) throw new Error(`VSCO-2-CE samples not found at ${root} — run: npm run od:fetch`);
  }

  zonesFor(inst: string, art: string): SampleZone[] {
    const key = `${inst}/${art}`;
    const hit = this.zones.get(key);
    if (hit) return hit;
    const p = INSTRUMENTS[inst];
    if (!p?.arts[art]) throw new Error(`unknown instrument/articulation ${key}`);
    const dir = join(this.root, p.arts[art]);
    const files = readdirSync(dir).filter((f) => /\.wav$/i.test(f) && statSync(join(dir, f)).isFile() && !(p.skip?.test(f) ?? false)).sort();
    const parsed = files.map((f) => ({ f, ...parseSampleName(f) }));
    const zones: SampleZone[] = parsed.map((q) => {
      const z: SampleZone = { path: join(dir, q.f), midi: q.midi === undefined ? -1 : q.midi + (p.nameOffset ?? 12), layer: 0, layers: 1, rr: q.rr };
      if (z.midi < 0) {
        z.audio = decodeWavAny(readFileSync(z.path));
        z.midi = estimateMidi(z.audio);
      }
      return z;
    });
    // velocity layers per pitch (v-number or dynamic word), lowest = softest
    const byMidi = new Map<number, SampleZone[]>();
    zones.forEach((z) => byMidi.set(z.midi, [...(byMidi.get(z.midi) ?? []), z]));
    for (const [, zs] of byMidi) {
      const levels = [...new Set(zs.map((z) => { const q = parseSampleName(z.path.split('/').pop()!); return q.vel ?? q.dyn ?? 0; }))].sort((a, b) => a - b);
      zs.forEach((z) => {
        const q = parseSampleName(z.path.split('/').pop()!);
        z.layer = levels.indexOf(q.vel ?? q.dyn ?? 0);
        z.layers = levels.length;
      });
    }
    this.zones.set(key, zones);
    return zones;
  }

  /** Nearest pitch, velocity layer from `vel` (0–1), round-robin rotation. Deterministic. */
  pick(inst: string, art: string, midi: number, vel: number): SampleZone {
    const zones = this.zonesFor(inst, art);
    let bestD = Infinity;
    for (const z of zones) bestD = Math.min(bestD, Math.abs(z.midi - midi));
    const near = zones.filter((z) => Math.abs(z.midi - midi) === bestD);
    const sMidi = near.reduce((a, z) => (z.midi >= midi ? Math.min(a, z.midi) : a), Infinity);
    const atPitch = near.filter((z) => z.midi === (Number.isFinite(sMidi) ? sMidi : near[0].midi));
    const layers = atPitch[0].layers;
    const layer = Math.round(Math.max(0, Math.min(1, vel)) * (layers - 1));
    const cands = atPitch.filter((z) => z.layer === layer);
    const pool = cands.length ? cands : atPitch;
    const key = `${inst}/${art}/${pool[0].midi}/${layer}`;
    const n = this.rrCounter.get(key) ?? 0;
    this.rrCounter.set(key, n + 1);
    const z = pool[n % pool.length];
    if (!z.audio) z.audio = decodeWavAny(readFileSync(z.path));
    return z;
  }

  resetRoundRobin(): void {
    this.rrCounter.clear();
  }
}
