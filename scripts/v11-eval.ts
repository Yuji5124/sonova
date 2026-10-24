/**
 * SONOVA v1.1 evaluation: how faithfully and robustly pictures become instruments.
 *   npm run v11:eval      (≈1 min) → experiments/v11/evaluation.json + EVALUATION.md
 */
import { join } from 'node:path';
import { corpus, evaluateDna, evaluateFidelity, MATERIALS, TRANSFORMS } from '@sonova/evaluation';
import { analyzeImage, analyzeImageV11, type RGBAImage } from '@sonova/source-analyzer';
import { createImageDNA, createImageDNAV11, type InstrumentDNA } from '@sonova/instrument-dna';
import { renderVoice } from '@sonova/synthesis-engine';
import { ROOT, writeJson } from './lib.ts';

export interface Pipeline {
  name: string;
  dna: (img: RGBAImage, name: string) => InstrumentDNA;
  render: Parameters<typeof evaluateFidelity>[1];
}

export const PIPELINES: Pipeline[] = [
  {
    name: 'v1.0',
    dna: (img, name) => createImageDNA({ sourceType: 'image', sourceName: `${name}.png`, sourceHash: name.padEnd(16, '0'), features: analyzeImage(img), seed: 'sonova-eval' }),
    render: (dna, note, sr, seed) => renderVoice(dna, note, sr, seed),
  },
  {
    name: 'analyzer v1.1 + DNA v1.0',
    dna: (img, name) => createImageDNA({ sourceType: 'image', sourceName: `${name}.png`, sourceHash: name.padEnd(16, '0'), features: analyzeImageV11(img), seed: 'sonova-eval' }),
    render: (dna, note, sr, seed) => renderVoice(dna, note, sr, seed),
  },
  {
    name: 'v1.1',
    dna: (img, name) => createImageDNAV11({ sourceType: 'image', sourceName: `${name}.png`, sourceHash: name.padEnd(16, '0'), features: analyzeImageV11(img), seed: 'sonova-eval' }),
    render: (dna, note, sr, seed) => renderVoice(dna, note, sr, seed),
  },
];

export function runEvaluation(pipelines = PIPELINES) {
  const items = corpus(2);
  const out: Record<string, unknown> = {};
  for (const p of pipelines) {
    const t0 = Date.now();
    const originals = items.map((it) => ({ id: it.id, material: it.material, features: analyzeImage(it.image), dna: p.dna(it.image, it.id) }));
    const transformed = items.flatMap((it) => TRANSFORMS.map((t) => ({ id: it.id, transform: t.name, dna: p.dna(t.apply(it.image), it.id) })));
    const dna = evaluateDna(originals, transformed);
    const fidelity = evaluateFidelity(originals, p.render);
    out[p.name] = { dna, fidelity: { pairs: fidelity.pairs, mean: fidelity.mean }, ms: Date.now() - t0 };
    console.log(`${p.name}: robustness ${dna.robustnessRatio} · identification ${dna.identification} · category ${dna.category} · flips ${dna.flipRate} · fidelity ${fidelity.mean} (${Date.now() - t0} ms)`);
    console.log('  nuisance', JSON.stringify(dna.nuisance), 'flips', JSON.stringify(dna.flips));
    console.log('  unstable', dna.unstable.map((u) => `${u.key} ${u.meanShift}`).join(', '));
    console.log('  fidelity', fidelity.pairs.map((q) => `${q.name} ${q.rho}`).join(' | '));
    console.log('  variety', JSON.stringify(dna.variety));
  }
  return { corpus: { materials: MATERIALS.map((m) => ({ name: m.name, description: m.description })), instances: 2, transforms: TRANSFORMS.map((t) => ({ name: t.name, description: t.description })) }, results: out };
}

if (process.argv[1]?.endsWith('v11-eval.ts')) {
  const r = runEvaluation();
  writeJson(join(ROOT, 'experiments/v11/evaluation.json'), r);
}
