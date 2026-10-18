/** Phase 2: the three Phase 1 instruments interact for 30 s, three candidates (seed × arc). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '@sonova/music-generator';
import { EXPERIMENT_PRESETS, arrange, decodeWav, generationManifest, renderArrangement, structureDoc, toMidi, verifyAudio, workNumberFor } from '@sonova/composition-engine';
import { PHASE1_SEED, ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const { dnas } = await buildInstruments(undefined, PHASE1_SEED);
const PHASE2_CANDIDATES = EXPERIMENT_PRESETS.map((p) => ({ ...p, workNumber: workNumberFor(p.seed, dnas, undefined, undefined) }));
const createdAt = process.env.SONOVA_CREATED_AT ?? new Date().toISOString();
const results = [];
for (const c of PHASE2_CANDIDATES) {
  const t0 = Date.now();
  const gen = generate(dnas, { seed: c.seed, durationSec: 30, arc: c.arc });
  const arr = arrange(dnas, gen, c.title);
  const render = renderArrangement(arr, dnas);
  const base = join(ROOT, 'output/phase2', c.workNumber);
  const bytes = writeStereoWav(`${base}.wav`, render.buffer, c.seed);
  writeFileSync(`${base}.mid`, toMidi(arr, gen));
  const verification = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 29.9, maxDurationSec: 30.1, maxPeakDbfs: -0.9, maxSilentRatio: 0.12 });
  const jsonBase = join(ROOT, 'experiments/phase2', c.workNumber);
  const manifest = generationManifest(c.title, dnas, gen, createdAt);
  const structure = structureDoc(arr, gen);
  writeJson(`${jsonBase}.structure.json`, structure);
  writeJson(`${jsonBase}.generation.json`, { workNumber: c.workNumber, ...manifest });
  writeJson(`${jsonBase}.events.json`, { workNumber: c.workNumber, bpm: gen.bpm, stepSec: gen.stepSec, events: gen.events, snapshots: gen.snapshots });
  writeJson(`${jsonBase}.verification.json`, { workNumber: c.workNumber, wav: rel(`${base}.wav`), master: render.master, verification });
  results.push({ ...c, bpm: gen.bpm, key: `${gen.key.root_pc}/${gen.key.mode}`, stats: gen.stats, renderMs: render.renderMs, totalMs: Date.now() - t0, verification });
  console.log(
    `${c.workNumber} ${c.title.padEnd(22)} ${gen.bpm}bpm ${gen.key.mode.padEnd(16)} notes ${gen.stats.notes} res ${gen.stats.resonances} mut ${gen.stats.mutations} depth ${gen.stats.maxDepthReached} ` +
      `rules ${JSON.stringify(gen.stats.byRule)} peak ${verification.peakDbfs} rms ${verification.rmsDbfs} ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(',')} (${Date.now() - t0}ms)`,
  );
  for (const ch of gen.chains.slice(0, 3)) console.log(`   ${ch.time.toFixed(2)}s  ${ch.text}`);
}
writeJson(join(ROOT, 'experiments/phase2/summary.json'), { instruments: dnas.map((d) => d.instrument_id), candidates: results });
