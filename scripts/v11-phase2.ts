/**
 * SONOVA v1.1 Phase 2: the three Phase 1 pictures as v1.1 instruments, 30-second candidates chosen
 * best-of-16 per arc by the piece metrics, compared with the v1.0 candidates (SONOVA-EXP-0001…0003).
 *   npm run v11:phase2   (≈2 min) → output/v11/*.wav|mp3|mid, experiments/v11/*
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { EXPERIMENT_PRESETS, arrange, decodeWav, renderArrangement, structureDoc, toMidi, verifyAudio } from '@sonova/composition-engine';
import { EVALUATION_VERSION, measurePiece, type PieceMetrics } from '@sonova/evaluation';
import { DNA_ENGINE_V11_VERSION, createImageDNAV11, type InstrumentDNA } from '@sonova/instrument-dna';
import { GENERATOR_V11_VERSION, generate, generateV11, type ArcPreset, type GeneratorResult } from '@sonova/music-generator';
import { ANALYZER_V11_VERSION, analyzeImageV11 } from '@sonova/source-analyzer';
import { PHASE1_SEED, PHASE1_SOURCES, ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const N = Number(process.env.V11_CANDIDATES ?? 16);
const OUT = join(ROOT, 'output/v11');
const EXP = join(ROOT, 'experiments/v11');
const silent = { left: new Float32Array(4410), right: new Float32Array(4410), sampleRate: 44100 };

const { dnas: dnas10, sources } = await buildInstruments();
const dnas11: InstrumentDNA[] = sources.map((s, i) => {
  const png = PNG.sync.read(readFileSync(PHASE1_SOURCES[i]));
  return createImageDNAV11({ sourceType: 'image', sourceName: s.name, sourceHash: s.sha256, features: analyzeImageV11({ width: png.width, height: png.height, data: png.data }), seed: PHASE1_SEED });
});
for (const d of dnas11) writeJson(join(EXP, 'dna', `${d.name}.dna.json`), d);

const render = (dnas: InstrumentDNA[], gen: GeneratorResult, title: string) => {
  const arr = arrange(dnas, gen, title);
  return { arr, r: renderArrangement(arr, dnas) };
};
const summary = (m: PieceMetrics) => ({ score: m.score, parts: m.parts, maxGapSec: m.maxGapSec, arcCorrelation: m.arcCorrelation, roughness: m.roughness, motifRecurrence: m.motifRecurrence, interplay: m.interplay, dialogue: m.dialogue, deepChains: m.deepChains, balance: m.balance, endsOnChord: m.endsOnChord, thinningEnd: m.thinningEnd, loudnessRangeDb: m.loudnessRangeDb });

// ---- v1.0: the published candidates, measured the same way ----
const baseline = EXPERIMENT_PRESETS.map((p, k) => {
  const gen = generate(dnas10, { seed: p.seed, durationSec: 30, arc: p.arc });
  const { r } = render(dnas10, gen, p.title);
  const m = measurePiece(gen, r.buffer);
  console.log(`v1.0 SONOVA-EXP-000${k + 1} ${p.arc.padEnd(8)} score ${m.score}`, JSON.stringify(m.parts));
  return { workNumber: `SONOVA-EXP-000${k + 1}`, title: p.title, seed: p.seed, arc: p.arc, notes: gen.stats.notes, metrics: summary(m) };
});

// ---- the distribution over many seeds (symbolic metrics only, the audio part is left out) ----
const seedsFor = (arc: ArcPreset) => Array.from({ length: N }, (_, k) => `sonova-v11-${arc}-${String(k).padStart(2, '0')}`);
const symbolic = (m: PieceMetrics) => {
  const { dynamics, ...rest } = m.parts;
  void dynamics;
  return Object.values(rest).reduce((s, v) => s + v, 0) / Object.keys(rest).length;
};
const distribution: Record<string, { mean: number; p10: number; p90: number }> = {};
const ARCS: Array<{ arc: ArcPreset; title: string }> = [
  { arc: 'bloom', title: 'Rings Answer the Tower' },
  { arc: 'tide', title: 'Facade Dialogue' },
  { arc: 'cascade', title: 'Sunset Resolves' },
];
const pools: Record<string, Array<{ seed: string; gen: GeneratorResult; sym: number }>> = {};
for (const [label, fn, dnas] of [['v1.0', generate, dnas10], ['v1.1', generateV11, dnas11]] as const) {
  const all: number[] = [];
  for (const { arc } of ARCS) {
    const pool = seedsFor(arc).map((seed) => {
      const gen = (fn as typeof generate)(dnas, { seed, durationSec: 30, arc });
      return { seed, gen, sym: symbolic(measurePiece(gen, silent)) };
    });
    all.push(...pool.map((p) => p.sym));
    if (label === 'v1.1') pools[arc] = pool;
  }
  all.sort((a, b) => a - b);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  distribution[label] = { mean: r3(all.reduce((s, x) => s + x, 0) / all.length), p10: r3(all[Math.floor(all.length * 0.1)]), p90: r3(all[Math.floor(all.length * 0.9)]) };
  console.log(`${label} over ${all.length} pieces (symbolic score): mean ${distribution[label].mean} p10 ${distribution[label].p10} p90 ${distribution[label].p90}`);
}

// ---- v1.1 candidates: best 3 by the symbolic score are rendered, the best with the audio wins ----
const candidates = [];
for (const [k, { arc, title }] of ARCS.entries()) {
  const top = [...pools[arc]].sort((a, b) => b.sym - a.sym).slice(0, 3);
  let best: { seed: string; gen: GeneratorResult; m: PieceMetrics; r: ReturnType<typeof render> } | null = null;
  for (const t of top) {
    const rr = render(dnas11, t.gen, title);
    const m = measurePiece(t.gen, rr.r.buffer);
    if (!best || m.score > best.m.score) best = { seed: t.seed, gen: t.gen, m, r: rr };
  }
  const workNumber = `SONOVA-EXP-000${k + 4}`;
  const base = join(OUT, workNumber);
  const bytes = writeStereoWav(`${base}.wav`, best!.r.r.buffer, best!.seed);
  writeFileSync(`${base}.mid`, toMidi(best!.r.arr, best!.gen));
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '256k', `${base}.mp3`]);
  } catch {
    /* no ffmpeg */
  }
  const verification = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 29.9, maxDurationSec: 30.1, maxPeakDbfs: -0.9, maxSilentRatio: 0.12 });
  const g = best!.gen as ReturnType<typeof generateV11>;
  writeJson(join(EXP, `${workNumber}.events.json`), { workNumber, bpm: g.bpm, stepSec: g.stepSec, events: g.events, snapshots: g.snapshots, phrases: g.phrases, finalChord: g.finalChord });
  writeJson(join(EXP, `${workNumber}.structure.json`), structureDoc(best!.r.arr, g));
  const cand = { workNumber, title, seed: best!.seed, arc, bpm: g.bpm, key: `${g.key.root_pc}/${g.key.mode}`, notes: g.stats.notes, stats: g.stats, statsV11: g.statsV11, chains: g.chains.slice(0, 6).map((c) => c.text), metrics: summary(best!.m), verification, wav: rel(`${base}.wav`) };
  candidates.push(cand);
  console.log(`v1.1 ${workNumber} ${arc.padEnd(8)} ${best!.seed} score ${best!.m.score} ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(',')}`, JSON.stringify(best!.m.parts));
}
writeJson(join(EXP, 'phase2.json'), { engines: { analyzer: ANALYZER_V11_VERSION, dna: DNA_ENGINE_V11_VERSION, generator: GENERATOR_V11_VERSION, evaluation: EVALUATION_VERSION }, seedsPerArc: N, instruments: dnas11.map((d) => ({ name: d.name, instrument_id: d.instrument_id, dna_hash: d.dna_hash })), baseline, distribution, candidates });
