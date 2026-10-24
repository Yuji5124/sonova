import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { analyzeImage, analyzeImageV11, estimateNoise } from '@sonova/source-analyzer';
import { createImageDNA, createImageDNAV11, Rng } from '@sonova/instrument-dna';
import { generate, generateV11, midiToDegree } from '@sonova/music-generator';
import { arrange, renderArrangement, EXPERIMENT_PRESETS, PHASE1_SEED, PHASE1_SOURCE_NAMES } from '@sonova/composition-engine';
import { MATERIALS, TRANSFORMS, measurePiece, renderMaterial, spearman } from '@sonova/evaluation';

const ROOT = join(import.meta.dirname, '..');
const loadPhase1 = () =>
  PHASE1_SOURCE_NAMES.map((name) => {
    const png = PNG.sync.read(readFileSync(join(ROOT, 'experiments/sources', name)));
    return { name, img: { width: png.width, height: png.height, data: png.data } };
  });
const flat = (v: number, noise = 0) => {
  const rng = new Rng('flat');
  const data = new Uint8ClampedArray(128 * 128 * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : Math.round(v * 255 + (noise ? (rng.next() * 2 - 1) * noise * 1.732 * 255 : 0));
  return { width: 128, height: 128, data };
};

describe('v1.0 stays reproducible', () => {
  it('the Phase 1 instruments keep their DNA hashes', () => {
    const sha = (n: string) => JSON.parse(readFileSync(join(ROOT, 'experiments/phase1/dna', n.replace('.png', '.dna.json')), 'utf8'));
    for (const { name, img } of loadPhase1()) {
      const stored = sha(name);
      const dna = createImageDNA({ sourceType: 'image', sourceName: name, sourceHash: stored.source_hash, features: analyzeImage(img), seed: PHASE1_SEED });
      expect(dna.dna_hash).toBe(stored.dna_hash);
      expect(dna.shimmer).toBeUndefined();
      expect(dna.interaction_rules.responses_v11).toBeUndefined();
    }
  });
  it('SONOVA-EXP-0001 renders to the same signal as published', () => {
    const dnas = loadPhase1().map(({ name, img }) => {
      const stored = JSON.parse(readFileSync(join(ROOT, 'experiments/phase1/dna', name.replace('.png', '.dna.json')), 'utf8'));
      return createImageDNA({ sourceType: 'image', sourceName: name, sourceHash: stored.source_hash, features: analyzeImage(img), seed: PHASE1_SEED });
    });
    const p = EXPERIMENT_PRESETS[0];
    const gen = generate(dnas, { seed: p.seed, durationSec: 30, arc: p.arc });
    const r = renderArrangement(arrange(dnas, gen, p.title), dnas);
    const stored = JSON.parse(readFileSync(join(ROOT, 'experiments/phase2/SONOVA-EXP-0001.verification.json'), 'utf8'));
    expect(r.master.inputRms).toBe(stored.master.inputRms);
    expect(r.master.inputPeak).toBe(stored.master.inputPeak);
  });
});

describe('analyzer v1.1', () => {
  it('estimates the noise level and keeps it out of roughness and colour', () => {
    const sigma = 0.02;
    const noisy = flat(0.5, sigma);
    expect(estimateNoise(Float64Array.from({ length: 128 * 128 }, (_, i) => noisy.data[i * 4] / 255), 128)).toBeGreaterThan(sigma * 0.6);
    const v10 = analyzeImage(noisy);
    const v11 = analyzeImageV11(noisy);
    expect(v11.textureRoughness).toBeLessThan(v10.textureRoughness * 0.5);
    expect(v11.meanSaturation).toBeLessThan(0.02);
  });
  it('the dominant hue is continuous (a weighted circular mean, not a 30° bin)', () => {
    const solid = (h: number) => {
      const data = new Uint8ClampedArray(64 * 64 * 4);
      // a hue between red (0°) and yellow (60°)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 230;
        data[i + 1] = Math.round(230 * (h / 60));
        data[i + 2] = 20;
        data[i + 3] = 255;
      }
      return { width: 64, height: 64, data };
    };
    const a = analyzeImageV11(solid(20)).dominantHue;
    const b = analyzeImageV11(solid(25)).dominantHue;
    // r 230, b 20: hue = 60·(g − 20)/210 → 16.3° and 21.7°
    expect(a).toBeCloseTo(16.3, 0);
    expect(b).toBeCloseTo(21.7, 0);
  });
  it('sensor noise on smooth pictures moves v1.1 roughness much less than v1.0 roughness', () => {
    const noise = TRANSFORMS.find((t) => t.name === 'noise')!;
    for (const name of ['clouds', 'sunset', 'dunes']) {
      const img = renderMaterial(MATERIALS.find((m) => m.name === name)!, 0).image;
      const d10 = Math.abs(analyzeImage(noise.apply(img)).textureRoughness - analyzeImage(img).textureRoughness);
      const d11 = Math.abs(analyzeImageV11(noise.apply(img)).textureRoughness - analyzeImageV11(img).textureRoughness);
      expect(d11).toBeLessThan(d10 * 0.75);
    }
  });
});

describe('DNA v1.1', () => {
  it('is deterministic, adds shimmer and the v1.1 listening rules, and a smoother picture rings longer', () => {
    const mk = (name: string) => {
      const m = MATERIALS.find((x) => x.name === name)!;
      return createImageDNAV11({ sourceType: 'image', sourceName: `${name}.png`, sourceHash: name.padEnd(16, '0'), features: analyzeImageV11(renderMaterial(m, 0).image), seed: 's' });
    };
    expect(mk('clouds')).toEqual(mk('clouds'));
    const clouds = mk('clouds');
    const gravel = mk('gravel');
    expect(clouds.release).toBeGreaterThan(gravel.release);
    expect(clouds.attack).toBeGreaterThan(gravel.attack);
    expect(gravel.noise.amount).toBeGreaterThan(clouds.noise.amount);
    expect(mk('mosaic').shimmer!.cents).toBeGreaterThan(mk('metal').shimmer!.cents);
    expect(clouds.interaction_rules.responses_v11!.map((r) => r.effect).sort()).toEqual(['imitate', 'yield']);
    expect(clouds.engine_version).toBe('sonova-dna/1.1.0');
  });
  it('spearman is +1 / −1 on monotone data', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 9);
  });
});

describe('generator v1.1', () => {
  const dnas = () =>
    loadPhase1().map(({ name, img }) => createImageDNAV11({ sourceType: 'image', sourceName: name, sourceHash: name.padEnd(16, '0'), features: analyzeImageV11(img), seed: PHASE1_SEED }));
  it('is deterministic, ends on a chord of the key, and answers phrases with their own shape', () => {
    const d = dnas();
    const g = generateV11(d, { seed: 'v11-test', durationSec: 30, arc: 'tide' });
    expect(generateV11(d, { seed: 'v11-test', durationSec: 30, arc: 'tide' }).events).toEqual(g.events);
    expect(g.finalChord).not.toBeNull();
    const third = g.key.scale.find((x) => x === 3 || x === 4)!;
    const triad = [0, third, 7].map((x) => (g.key.root_pc + x) % 12);
    for (const m of g.finalChord!.midis) expect(triad).toContain(m % 12);
    expect(g.finalChord!.time).toBeGreaterThan(23);
    // imitation: the answer keeps the sender's melodic shape in scale steps
    const deg = (m: number) => midiToDegree(g.key.root_pc, g.key.scale, m);
    const imit = g.events.filter((e) => e.param === 'imitate');
    for (const e of imit) {
      const from = String(e.from).split(' ').map(Number);
      const to = String(e.to).split(' ').map(Number);
      expect(to.map((m, i) => (i ? deg(m) - deg(to[i - 1]) : 0))).toEqual(from.map((m, i) => (i ? deg(m) - deg(from[i - 1]) : 0)));
    }
    // nothing new starts after the final chord
    expect(g.events.filter((e) => e.kind === 'note' && e.step > g.finalChord!.step).length).toBe(0);
  });
  it('sounds less rough and ends on the key more often than v1.0 over a handful of seeds', () => {
    const d = dnas();
    const silent = { left: new Float32Array(4410), right: new Float32Array(4410), sampleRate: 44100 };
    let r10 = 0;
    let r11 = 0;
    let e10 = 0;
    let e11 = 0;
    for (let k = 0; k < 6; k++) {
      const a = measurePiece(generate(d, { seed: `t${k}`, durationSec: 30, arc: 'tide' }), silent);
      const b = measurePiece(generateV11(d, { seed: `t${k}`, durationSec: 30, arc: 'tide' }), silent);
      r10 += a.roughness;
      r11 += b.roughness;
      e10 += a.endsOnChord ? 1 : 0;
      e11 += b.endsOnChord ? 1 : 0;
    }
    expect(r11).toBeLessThan(r10);
    expect(e11).toBeGreaterThan(e10);
  });
});
