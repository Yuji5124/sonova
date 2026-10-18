/** Phase 1: three PNG images → three Instrument DNAs → three audition WAVs + explanation tables. */
import { join } from 'node:path';
import { renderInstrumentDemo } from '@sonova/synthesis-engine';
import { decodeWav, verifyAudio } from '@sonova/composition-engine';
import { IMAGE_FEATURE_DESCRIPTIONS } from '@sonova/source-analyzer';
import { PHASE1_SEED, ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const seed = process.argv[2] ?? PHASE1_SEED;
const { sources, dnas } = await buildInstruments(undefined, seed);
const outDir = join(ROOT, 'output/phase1');
const summary = [];
for (const [i, dna] of dnas.entries()) {
  const src = sources[i];
  writeJson(join(ROOT, 'experiments/phase1/dna', `${dna.name}.dna.json`), dna);
  writeJson(join(ROOT, 'experiments/phase1/features', `${dna.name}.features.json`), { source: src.name, sha256: src.sha256, features: src.features, descriptions: IMAGE_FEATURE_DESCRIPTIONS });
  const t0 = Date.now();
  const demo = renderInstrumentDemo(dna);
  const wavPath = join(outDir, `${dna.name}.instrument.wav`);
  const bytes = writeStereoWav(wavPath, demo.buffer, dna.dna_hash);
  const check = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 5, maxPeakDbfs: -0.9, maxSilentRatio: 0.3 });
  summary.push({
    instrument: dna.name,
    instrument_id: dna.instrument_id,
    dna_hash: dna.dna_hash,
    wav: rel(wavPath),
    render_ms: Date.now() - t0,
    verification: check,
    character: {
      pitch_range: dna.pitch_range,
      attack: dna.attack,
      decay: dna.decay,
      brightness: dna.harmonics.brightness,
      noise: dna.noise.amount,
      resonance: dna.resonance.amount,
      rhythm: dna.rhythm,
      responses: dna.interaction_rules.responses.map((r) => `${r.effect}:${r.strength}`),
    },
  });
  console.log(`${dna.name.padEnd(8)} ${dna.instrument_id}  attack ${dna.attack}s  bright ${dna.harmonics.brightness}  res ${dna.resonance.amount}  E(${dna.rhythm.pulses},${dna.rhythm.steps})  → ${dna.interaction_rules.responses.map((r) => r.effect).join('+')}  ${check.ok ? 'OK' : 'NG ' + check.problems.join(',')}  peak ${check.peakDbfs} dBFS`);
}
writeJson(join(ROOT, 'experiments/phase1/summary.json'), { seed, instruments: summary });
