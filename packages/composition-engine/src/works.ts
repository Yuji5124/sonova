import type { InstrumentDNA } from '@sonova/instrument-dna';
import { canonicalJson, hashHex } from '@sonova/instrument-dna';
import type { ArcPreset, GeneratorResult } from '@sonova/music-generator';
import type { Arrangement, TrackEdit } from './index.ts';
import { engineVersions } from './index.ts';

/** The Phase 2 candidate set: same seeds in the CLI and in SONOVA LAB, so both produce the same audio. */
export const EXPERIMENT_PRESETS: Array<{ title: string; seed: string; arc: ArcPreset }> = [
  { title: 'Rings Wake the Tower', seed: 'sonova-exp-0001', arc: 'bloom' },
  { title: 'Facade Tide', seed: 'sonova-exp-0002', arc: 'tide' },
  { title: 'Sunset Cascade', seed: 'sonova-exp-0003', arc: 'cascade' },
];

export const PHASE1_SEED = 'sonova-001';
export const PHASE1_SOURCE_NAMES = ['bark.png', 'tower.png', 'sunset.png'];

/**
 * SONOVA work number. Canonical seeds (`sonova-exp-0001`) with unedited instruments and mix keep
 * their series number; anything else gets a content-derived number so identical renders dedupe.
 */
export function workNumberFor(seed: string, dnas: InstrumentDNA[], ruleGain: Record<string, number> | undefined, edits: TrackEdit[] | undefined, extra: unknown = null): string {
  const m = /^sonova-exp-(\d{4})$/.exec(seed);
  const editsDefault = !edits || edits.every((e) => !e || ((e.mute ?? false) === false && (e.gain ?? 1) === 1));
  const gainDefault = !ruleGain || Object.values(ruleGain).every((g) => g === 1);
  const canonicalDna = dnas.every((d) => d.seed === PHASE1_SEED) && dnas.map((d) => d.source_name).join() === PHASE1_SOURCE_NAMES.join();
  if (m && editsDefault && gainDefault && canonicalDna && extra === null) return `SONOVA-EXP-${m[1]}`;
  const h = hashHex(canonicalJson({ seed, dna: dnas.map((d) => d.dna_hash), ruleGain, edits, extra })).slice(0, 8).toUpperCase();
  return `SONOVA-EXP-H${h}`;
}

export function experimentMetadata(workNumber: string, arr: Arrangement, gen: GeneratorResult, dnas: InstrumentDNA[], createdAt: string, sonovaFiles: string[]) {
  return {
    workNumber,
    title: arr.title,
    type: 'EXPERIMENT' as const,
    bpm: gen.bpm,
    materialIds: dnas.map((d) => d.source_hash),
    sources: dnas.map((d) => ({ name: d.source_name, type: d.source_type, sha256: d.source_hash })),
    instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, dna_hash: d.dna_hash, name: d.name })),
    seed: gen.config.seed,
    algorithms: ['image→Instrument DNA', 'additive+FM+noise synthesis', `interaction generator (${gen.config.arc})`, 'look-ahead limiter'],
    engines: engineVersions(),
    license: 'Original',
    createdAt,
    description: `${dnas.map((d) => d.name).join('・')} の3楽器が相互作用する ${Math.round(arr.durationSec)} 秒の実験。${gen.key.mode}、${gen.stats.notes} 音、共鳴 ${gen.stats.resonances}、変化 ${gen.stats.mutations}。`,
    tags: ['experiment', gen.config.arc, gen.key.mode, ...dnas.map((d) => d.name)],
    sonovaFiles,
  };
}

export function instrumentMetadata(workNumber: string, dna: InstrumentDNA, createdAt: string, sonovaFiles: string[]) {
  return {
    workNumber,
    title: `${dna.name} instrument`,
    type: 'INSTRUMENT' as const,
    materialIds: [dna.source_hash],
    sources: [{ name: dna.source_name, type: dna.source_type, sha256: dna.source_hash }],
    instruments: [{ instrument_id: dna.instrument_id, dna_hash: dna.dna_hash, name: dna.name }],
    seed: dna.seed,
    algorithms: ['image→Instrument DNA', 'additive+FM+noise synthesis'],
    engines: engineVersions(),
    license: 'Original',
    createdAt,
    description: `${dna.source_name} から生成した独自楽器の試聴フレーズ。`,
    tags: ['instrument', dna.name, ...dna.interaction_rules.responses.map((r) => r.effect)],
    sonovaFiles,
  };
}
