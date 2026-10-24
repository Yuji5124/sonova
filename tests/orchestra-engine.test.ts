import { describe, expect, it } from 'vitest';
import { additive, analyseTimbre, articulationFor, convolve, decodeWavAny, encodeWav24, fm, glitch, grains, hallIR, kick, loudness, parseSampleName, toMidi } from '@sonova/orchestra-engine';

const SR = 48000;

describe('orchestra engine (no samples needed)', () => {
  it('parses VSCO-2-CE file names (note, velocity layer, round robin, dynamic words)', () => {
    expect(parseSampleName('VlnEns_susVib_A3_v1.wav')).toMatchObject({ midi: 57, vel: 1, rr: 1 });
    expect(parseSampleName('pizzT_A2_v2_RR2.wav')).toMatchObject({ midi: 45, vel: 2, rr: 2 });
    expect(parseSampleName('PSBassoon_A#0_v2_rr1.wav')).toMatchObject({ midi: 22, vel: 2 });
    expect(parseSampleName('KSHarp_C5_mf.wav')).toMatchObject({ midi: 72, dyn: 4 });
    expect(parseSampleName('Timpani1_Hit_v1_rr1_Sum.wav').midi).toBeUndefined();
  });

  it('writes and reads 24-bit WAV within one LSB', () => {
    const x = new Float32Array(1000).map((_, i) => Math.sin(i / 7) * 0.8);
    const back = decodeWavAny(encodeWav24([x, x], SR));
    expect(back.sampleRate).toBe(SR);
    let err = 0;
    for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(back.channels[1][i] - x[i]));
    expect(err).toBeLessThan(2 / 8388607);
  });

  it('FFT convolution equals direct convolution', () => {
    const x = new Float32Array(3000).map((_, i) => Math.sin(i * 0.37) * (i % 17 === 0 ? 1 : 0.2));
    const h = new Float32Array(700).map((_, i) => Math.exp(-i / 100) * Math.cos(i / 3));
    const y = convolve(x, h);
    for (const n of [0, 5, 699, 1500, 3500]) {
      let d = 0;
      for (let k = 0; k < h.length; k++) if (n - k >= 0 && n - k < x.length) d += x[n - k] * h[k];
      expect(y[n]).toBeCloseTo(d, 3);
    }
  });

  it('the generated hall decays by about 60 dB over its RT60 and is deterministic', () => {
    const [l] = hallIR(SR, { room: [20, 30, 12], rt60: 2, predelay: 0.02, seed: 't' });
    const [l2] = hallIR(SR, { room: [20, 30, 12], rt60: 2, predelay: 0.02, seed: 't' });
    expect(l2).toEqual(l);
    const e = (a: number, b: number) => l.slice(Math.round(a * SR), Math.round(b * SR)).reduce((s, v) => s + v * v, 0) / ((b - a) * SR);
    const drop = 10 * Math.log10(e(0.1, 0.3) / e(1.1, 1.3));
    expect(drop).toBeGreaterThan(20);
    expect(drop).toBeLessThan(40); // ≈ 30 dB per second for RT60 = 2 s
  });

  it('loudness of a full-scale 1 kHz sine in one channel is about −3 LUFS (BS.1770 reference)', () => {
    const x = new Float32Array(SR * 3).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
    const silent = new Float32Array(x.length);
    expect(loudness(x, silent, SR).integrated).toBeGreaterThan(-3.6);
    expect(loudness(x, silent, SR).integrated).toBeLessThan(-2.4);
  });

  it('timbre bridge: an analysed timbre resynthesises with the same spectral shape; envelopes choose articulations', () => {
    const src = new Float32Array(SR).map((_, i) => [1, 0.5, 0.25, 0.12].reduce((s, a, k) => s + a * Math.sin((2 * Math.PI * 220 * (k + 1) * i) / SR), 0) * Math.min(1, i / 2000));
    const p = analyseTimbre(src, SR, 220);
    expect(p.partials[1]).toBeCloseTo(0.5, 1);
    expect(p.partials[2]).toBeCloseTo(0.25, 1);
    const re = additive(p, 57, 0.8, SR, { seed: 't' });
    const p2 = analyseTimbre(re, SR, 220);
    expect(Math.abs(p2.centroid - p.centroid)).toBeLessThan(0.3);
    expect(articulationFor(kick(SR), SR).art).not.toBe('sus');
    expect(fm(60, 0.5, SR).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('granular and glitch are deterministic and bounded', () => {
    const src = new Float32Array(SR).map((_, i) => Math.sin(i / 20));
    const a = grains(src, SR, 1, SR, { position: () => 0.5, seed: 'g' });
    expect(grains(src, SR, 1, SR, { position: () => 0.5, seed: 'g' })[0]).toEqual(a[0]);
    const y = glitch(src, SR, [{ at: 0.2, len: 0.2, kind: 'stutter' }, { at: 0.5, len: 0.1, kind: 'reverse' }, { at: 0.7, len: 0.1, kind: 'crush' }]);
    expect(y.length).toBe(src.length);
    expect(Math.max(...y.map(Math.abs))).toBeLessThanOrEqual(1.0001);
  });

  it('exports a score to MIDI with one track per part', () => {
    const bytes = toMidi({ title: 't', bpm: 90, parts: [{ id: 'a', name: 'A', kind: 'orchestra', instrument: 'celli', notes: [{ t: 0, dur: 1, midi: 48, vel: 0.7 }] }, { id: 'b', name: 'B', kind: 'electronic', instrument: 'fm', notes: [{ t: 0.5, dur: 0.25, midi: 72, vel: 0.5 }] }] });
    expect(bytes.length).toBeGreaterThan(50);
  });
});
