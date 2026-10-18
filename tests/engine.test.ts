import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import * as TonejsMidi from '@tonejs/midi';
import { analyzeImage, sha256Hex, type RGBAImage } from '@sonova/source-analyzer';
import { createImageDNA, euclid, verifyDNA, Rng, applyOverrides } from '@sonova/instrument-dna';
import { renderVoice, renderInstrumentDemo, master } from '@sonova/synthesis-engine';
import { generate, arcAt, degreeToMidi, midiToDegree, MODES } from '@sonova/music-generator';
import { arrange, decodeWav, encodeWav16, renderArrangement, toMidi, verifyAudio, workNumberFor } from '@sonova/composition-engine';

const ROOT = join(import.meta.dirname, '..');
const loadPng = (name: string): { img: RGBAImage; bytes: Uint8Array } => {
  const bytes = new Uint8Array(readFileSync(join(ROOT, 'experiments/sources', name)));
  const png = PNG.sync.read(Buffer.from(bytes));
  return { img: { width: png.width, height: png.height, data: png.data }, bytes };
};
const names = ['bark.png', 'tower.png', 'sunset.png'];
const sources = await Promise.all(
  names.map(async (n) => {
    const { img, bytes } = loadPng(n);
    return { name: n, img, sha: await sha256Hex(bytes), features: analyzeImage(img) };
  }),
);
const dnaFor = (i: number, seed = 'sonova-001') =>
  createImageDNA({ sourceType: 'image', sourceName: sources[i].name, sourceHash: sources[i].sha, features: sources[i].features, seed });
const dnas = [0, 1, 2].map((i) => dnaFor(i));

function solid(w: number, h: number, rgb: [number, number, number]): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
}

describe('source analyzer', () => {
  it('is deterministic and resolution-independent in range', () => {
    expect(analyzeImage(sources[0].img)).toEqual(sources[0].features);
    const f = sources[1].features;
    for (const k of ['meanLuminance', 'contrast', 'edgeDensity', 'repetitionStrength', 'highFreqRatio'] as const) {
      expect(f[k]).toBeGreaterThanOrEqual(0);
      expect(f[k]).toBeLessThanOrEqual(1);
    }
    expect(f.radialSpectrum.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  });

  it('captures structure, not just bytes', () => {
    const [bark, tower, sunset] = sources.map((s) => s.features);
    expect(tower.repetitionStrength).toBeGreaterThan(sunset.repetitionStrength); // facade grid repeats
    expect(tower.meanSaturation).toBeLessThan(sunset.meanSaturation); // concrete is grey
    expect(bark.textureRoughness).toBeGreaterThan(sunset.textureRoughness * 5); // wood grain
    expect(sunset.edgeMean).toBeLessThan(bark.edgeMean / 3); // smooth gradients
    const flat = analyzeImage(solid(32, 32, [120, 120, 120]));
    expect(flat.edgeMean).toBe(0);
    expect(flat.repetitionStrength).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => analyzeImage({ width: 4, height: 4, data: new Uint8Array(10) })).toThrow();
  });
});

describe('instrument DNA', () => {
  it('regenerates identically from the same source, seed and engine', () => {
    const again = dnaFor(0);
    expect(again).toEqual(dnas[0]);
    expect(again.dna_hash).toBe(dnas[0].dna_hash);
    expect(verifyDNA(again)).toBe(true);
  });

  it('matches the committed Phase 1 DNA files', () => {
    for (const d of dnas) {
      const committed = JSON.parse(readFileSync(join(ROOT, 'experiments/phase1/dna', `${d.name}.dna.json`), 'utf8'));
      expect(committed).toEqual(d);
    }
  });

  it('changes with the seed but keeps the source-derived character', () => {
    const other = dnaFor(0, 'another-seed');
    expect(other.dna_hash).not.toBe(dnas[0].dna_hash);
    expect(other.harmonics).toEqual(dnas[0].harmonics);
    expect(other.attack).toBe(dnas[0].attack);
  });

  it('gives each source a different instrument and role', () => {
    expect(new Set(dnas.map((d) => d.dna_hash)).size).toBe(3);
    const [bark, tower, sunset] = dnas;
    expect(bark.attack).toBeLessThan(sunset.attack);
    expect(tower.interaction_rules.responses[0].effect).toBe('resonate');
    expect(sunset.interaction_rules.responses[0].effect).toBe('timbre');
    expect(bark.interaction_rules.responses.map((r) => r.effect)).toContain('rhythm');
  });

  it('records an explanation for every parameter it sets', () => {
    for (const d of dnas) {
      const params = d.mapping.map((m) => m.parameter);
      for (const p of ['pitch_range.root_pc', 'attack', 'decay', 'sustain', 'release', 'resonance.amount', 'noise.amount', 'modulation.fm_index', 'rhythm.pulses']) expect(params).toContain(p);
      expect(d.mapping.every((m) => m.features.length > 0 && m.rule.length > 0)).toBe(true);
    }
  });

  it('detects edits and keeps overrides separate', () => {
    const edited = { ...dnas[0], attack: 0.5 };
    expect(verifyDNA(edited)).toBe(false);
    const o = applyOverrides(dnas[0], { attack: 0.4, octave: 1 });
    expect(o.attack).toBe(0.4);
    expect(o.pitch_range.low).toBe(dnas[0].pitch_range.low + 12);
    expect(dnas[0].attack).not.toBe(0.4);
  });
});

describe('rhythm and pitch helpers', () => {
  it('euclid spreads pulses', () => {
    expect(euclid(8, 3).filter(Boolean)).toHaveLength(3);
    expect(euclid(16, 5).filter(Boolean)).toHaveLength(5);
    expect(euclid(12, 2, 5).filter(Boolean)).toHaveLength(2);
  });
  it('degree ↔ midi round-trips', () => {
    for (const d of [-9, -1, 0, 3, 14]) expect(midiToDegree(2, MODES.dorian, degreeToMidi(2, MODES.dorian, d))).toBe(d);
  });
  it('rng is reproducible', () => {
    const a = new Rng('x');
    const b = new Rng('x');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});

describe('synthesis', () => {
  it('renders bounded, finite, non-silent voices', () => {
    for (const d of dnas) {
      const v = renderVoice(d, { midi: d.pitch_range.center, velocity: 1, duration: 0.5, timbre: 1, kind: 'note' }, 44100, 'x');
      let peak = 0;
      for (const s of v) {
        expect(Number.isFinite(s)).toBe(true);
        peak = Math.max(peak, Math.abs(s));
      }
      expect(peak).toBeGreaterThan(0.01);
      expect(peak).toBeLessThan(2);
    }
  });

  it('master limiter enforces the ceiling', () => {
    const L = new Float32Array(44100).map((_, i) => Math.sin(i / 10) * 5);
    const R = L.slice();
    const rep = master(L, R, { sampleRate: 44100, targetRmsDb: -6, ceilingDb: -1, maxGainDb: 20 });
    expect(rep.outputPeak).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
  });

  it('instrument demo passes audio checks', () => {
    const demo = renderInstrumentDemo(dnas[2]);
    const wav = decodeWav(encodeWav16([demo.buffer.left, demo.buffer.right], 44100));
    const v = verifyAudio(wav, { sampleRate: 44100, channels: 2, bitsPerSample: 16, maxPeakDbfs: -0.9, maxSilentRatio: 0.3 });
    expect(v.problems).toEqual([]);
  });
});

describe('music generator', () => {
  const gen = generate(dnas, { seed: 'test-seed', durationSec: 30, arc: 'bloom' });

  it('is reproducible', () => {
    expect(generate(dnas, { seed: 'test-seed', durationSec: 30, arc: 'bloom' })).toEqual(gen);
    expect(generate(dnas, { seed: 'test-seed-2', durationSec: 30, arc: 'bloom' }).events).not.toEqual(gen.events);
  });

  it('produces interaction in both directions with traceable causes', () => {
    const byId = new Map(gen.events.map((e) => [e.id, e]));
    for (const e of gen.events) {
      if (!e.cause) continue;
      const c = byId.get(e.cause.event)!;
      expect(c).toBeDefined();
      expect(c.step).toBeLessThanOrEqual(e.step);
      expect(e.depth).toBe(c.depth + 1);
      expect(c.instrument).not.toBe(e.instrument);
    }
    const pairs = Object.keys(gen.stats.byPair);
    expect(pairs.some((p) => pairs.includes(p.split('->').reverse().join('->')))).toBe(true); // feedback A→B and B→A
    expect(gen.stats.resonances).toBeGreaterThan(0);
    expect(gen.stats.mutations).toBeGreaterThan(0);
    expect(gen.chains.length).toBeGreaterThan(0);
  });

  it('stays bounded even with extreme coupling', () => {
    const wild = generate(dnas, { seed: 'wild', durationSec: 30, arc: 'cascade', ruleGain: { resonate: 50, timbre: 50, rhythm: 50, entrain: 50, attract: 50 } });
    expect(wild.stats.maxDepthReached).toBeLessThanOrEqual(3);
    expect(wild.stats.maxResponsesInStep).toBeLessThanOrEqual(6);
    expect(wild.stats.peakTotalEnergy).toBeLessThanOrEqual(2.2 + 1e-9);
    expect(wild.events.length).toBeLessThan(wild.totalSteps * 10);
    const lastNote = Math.max(...wild.events.filter((e) => e.kind === 'note').map((e) => e.time));
    expect(lastNote).toBeLessThan(30 - 3 + 0.01);
  });

  it('can switch interactions off', () => {
    const none = generate(dnas, { seed: 'off', durationSec: 30, arc: 'bloom', ruleGain: { resonate: 0, timbre: 0, rhythm: 0, entrain: 0, attract: 0 } });
    expect(none.stats.resonances + none.stats.mutations).toBe(0);
  });

  it('arc presets stay in range and end quietly', () => {
    for (const a of ['bloom', 'tide', 'cascade'] as const) {
      for (let u = 0; u <= 1; u += 0.05) {
        const v = arcAt(a, u);
        expect(v.density).toBeGreaterThanOrEqual(0);
        expect(v.density).toBeLessThanOrEqual(1);
      }
      expect(arcAt(a, 0.99).density).toBeLessThan(0.05);
    }
  });
});

describe('composition, WAV and MIDI', () => {
  const gen = generate(dnas, { seed: 'sonova-exp-0001', durationSec: 30, arc: 'bloom' });
  const arr = arrange(dnas, gen, 'test');
  const out = renderArrangement(arr, dnas);
  const bytes = encodeWav16([out.buffer.left, out.buffer.right], 44100, 'sonova-exp-0001');

  it('writes a valid 30 s 44.1 kHz / 16-bit / stereo WAV', () => {
    const wav = decodeWav(bytes);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.channels).toBe(2);
    expect(wav.bitsPerSample).toBe(16);
    const v = verifyAudio(wav, { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 29.9, maxDurationSec: 30.1, maxPeakDbfs: -0.9, maxSilentRatio: 0.12 });
    expect(v.problems).toEqual([]);
    expect(v.peakDbfs).toBeLessThanOrEqual(-0.9);
  });

  it('renders bit-identically for the same input', () => {
    const again = renderArrangement(arrange(dnas, gen, 'test'), dnas);
    expect(Buffer.from(encodeWav16([again.buffer.left, again.buffer.right], 44100, 'sonova-exp-0001')).equals(Buffer.from(bytes))).toBe(true);
  });

  it('mute edits change the mix only', () => {
    const muted = arrange(dnas, gen, 'test', [{ mute: true }]);
    expect(muted.tracks[0].mute).toBe(true);
    expect(muted.tracks[1].notes).toEqual(arr.tracks[1].notes);
  });

  it('exports MIDI with one note track and one resonance track per instrument', () => {
    const Midi = (TonejsMidi as { Midi?: typeof TonejsMidi.Midi }).Midi ?? (TonejsMidi as unknown as { default: typeof TonejsMidi }).default.Midi;
    const midi = new Midi(toMidi(arr, gen));
    expect(midi.tracks).toHaveLength(6);
    const total = midi.tracks.reduce((s, t) => s + t.notes.length, 0);
    expect(total).toBe(gen.stats.notes + gen.stats.resonances);
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(gen.bpm);
  });

  it('work numbers are canonical only for unedited canonical renders', () => {
    expect(workNumberFor('sonova-exp-0002', dnas, undefined, undefined)).toBe('SONOVA-EXP-0002');
    expect(workNumberFor('sonova-exp-0002', dnas, undefined, [{ mute: true }])).toMatch(/^SONOVA-EXP-H[0-9A-F]{8}$/);
    expect(workNumberFor('custom', dnas, undefined, undefined)).toMatch(/^SONOVA-EXP-H/);
  });
});
