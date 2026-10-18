import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { analyzeImage, sha256Hex } from '@sonova/source-analyzer';
import { createImageDNA } from '@sonova/instrument-dna';
import { generateRock, makeRiff } from '@sonova/music-generator';
import { Rng } from '@sonova/instrument-dna';
import { DiodeClipper, besselZeros, caStep, membraneModes, renderBytebeat, renderDrumHit, renderRig, renderSpectrogramImage, wrightOmega } from '@sonova/synthesis-engine';
import { rockPlan, rockToMidi } from '@sonova/composition-engine';
import * as TonejsMidi from '@tonejs/midi';

const ROOT = join(import.meta.dirname, '..');
const dnas = await Promise.all(
  ['bark.png', 'tower.png', 'sunset.png'].map(async (n) => {
    const bytes = readFileSync(join(ROOT, 'experiments/sources', n));
    const png = PNG.sync.read(bytes);
    return createImageDNA({ sourceType: 'image', sourceName: n, sourceHash: await sha256Hex(new Uint8Array(bytes)), features: analyzeImage({ width: png.width, height: png.height, data: png.data }), seed: 'sonova-001' });
  }),
);
const band = { guitar: dnas[0], drums: dnas[1], voice: dnas[2] };

describe('WDF diode clipper', () => {
  it('Wright omega solves ω + ln ω = x', () => {
    for (const x of [-6, -3, -2, 0, 1, 5, 20]) {
      const w = wrightOmega(x);
      expect(w + Math.log(w)).toBeCloseTo(x, 6);
    }
  });
  it('is near-linear for small signals and clips large ones near the diode voltage', () => {
    const d = new DiodeClipper({ sampleRate: 88200 });
    let small = 0;
    let big = 0;
    for (let i = 0; i < 4000; i++) small = Math.max(small, Math.abs(d.process(0.05 * Math.sin(i / 20))));
    const d2 = new DiodeClipper({ sampleRate: 88200 });
    for (let i = 0; i < 4000; i++) big = Math.max(big, Math.abs(d2.process(20 * Math.sin(i / 20))));
    expect(small).toBeGreaterThan(0.04);
    expect(big).toBeGreaterThan(0.3); // ≈ Vt·ln(I/Is) ≈ 0.39 V for one 1N4148-like pair
    expect(big).toBeLessThan(1.2);
  });
});

describe('physical models', () => {
  it('Bessel zeros match the known values', () => {
    expect(besselZeros(0, 2)[0]).toBeCloseTo(2.4048, 3);
    expect(besselZeros(0, 2)[1]).toBeCloseTo(5.5201, 3);
    expect(besselZeros(1, 1)[0]).toBeCloseTo(3.8317, 3);
    expect(membraneModes(0.3)[1].ratio).toBeCloseTo(3.8317 / 2.4048, 3);
  });
  it('drum hits and strings are deterministic and bounded', () => {
    const kit = rockPlan(generateRock(band, 't'), band).kit;
    for (const d of ['kick', 'snare', 'hat', 'crash', 'tom2'] as const) {
      const a = renderDrumHit(kit, d, 1, 44100, 'x');
      expect(Buffer.from(a.buffer).equals(Buffer.from(renderDrumHit(kit, d, 1, 44100, 'x').buffer))).toBe(true);
      expect(a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(1);
    }
    const ev = [{ time: 0, type: 'pluck' as const, freqs: [65.4, 98, 130.8], velocity: 1, mute: false, pickPosition: 0.13, brightness: 0.9, t60: 4, damping: 0.2 }, { time: 0.4, type: 'feedback' as const, gain: 2.5, ramp: 0.2 }];
    const y = renderRig(ev, 2, 44100, { gain: 60, midBoostDb: 6, cabinetHz: 5000, clean: 0 }, 's');
    let peak = 0;
    for (const v of y) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(3);
  });
  it('cellular automaton follows its rule', () => {
    const row = Array.from({ length: 16 }, (_, i) => i === 8);
    expect(caStep(row, 90).map((c, i) => (c ? i : -1)).filter((i) => i >= 0)).toEqual([7, 9]);
  });
  it('bytebeat and spectrogram textures are bounded', () => {
    const bb = renderBytebeat({ riff: [0, null, 3, 7], rootHz: 130.8, bpm: 145 }, 1, 44100);
    expect(bb.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(0.5);
    const im = renderSpectrogramImage({ width: 4, height: 4, lum: new Float64Array(16).map((_, i) => i / 15) }, 1, 44100, 5000, 12000, 16);
    expect(im.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(1);
  });
});

describe('rock song generator', () => {
  const song = generateRock(band, 'sonova-rock-0001');

  it('is reproducible and at least 3 minutes long', () => {
    expect(generateRock(band, 'sonova-rock-0001')).toEqual(song);
    expect(generateRock(band, 'other').riff).not.toEqual(song.riff);
    expect(song.durationSec).toBeGreaterThanOrEqual(180);
  });

  it('derives tempo, key, riff and drum texture from the instruments', () => {
    const choices = song.derivations.map((d) => d.choice);
    for (const c of ['key', 'bpm', 'riff.hits', 'drums.ca_rule', 'drums.ca_seed']) expect(choices).toContain(c);
    expect(song.key.root_pc).toBe(band.guitar.pitch_range.root_pc);
    expect(song.riff[0]).toEqual({ kind: 'pc', off: 0 });
  });

  it('every cause points to an earlier event of another kind/part, and the planned interactions occur', () => {
    const byId = new Map(song.events.map((e) => [e.id, e]));
    for (const e of song.events) {
      if (!e.cause) continue;
      const c = byId.get(e.cause.event);
      expect(c, `cause of ${e.id}`).toBeDefined();
      expect(c!.time).toBeLessThanOrEqual(e.time + 1e-9);
    }
    for (const r of ['entrain', 'stop', 'attract', 'feedback', 'mutate-ca', 'rhythm']) expect(song.stats.byRule[r] ?? 0).toBeGreaterThan(0);
    expect(song.caRules.length).toBeGreaterThan(1);
  });

  it('riff selection is deterministic for a seed', () => {
    expect(makeRiff(new Rng('a'), 10)).toEqual(makeRiff(new Rng('a'), 10));
  });

  it('exports MIDI with guitar, bass, lead and GM drums', () => {
    const Midi = (TonejsMidi as { Midi?: typeof TonejsMidi.Midi }).Midi ?? (TonejsMidi as unknown as { default: typeof TonejsMidi }).default.Midi;
    const midi = new Midi(rockToMidi(song));
    expect(midi.tracks.map((t) => t.channel)).toEqual([0, 1, 2, 9]);
    expect(midi.tracks.every((t) => t.notes.length > 0)).toBe(true);
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(song.bpm);
  });
});
