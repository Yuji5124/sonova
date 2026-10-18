import { describe, expect, it } from 'vitest';
import { FORMANTS, paulstretch, rissetRhythm, talkbox, tempoCanon, vowelsOf } from '@sonova/composition-engine';
import { averageSpectrum, bandEnergyDb } from '@sonova/source-analyzer';

const SR = 44100;

describe('XROCK techniques', () => {
  it('paulstretch keeps the spectrum, spreads the time, and is reproducible', () => {
    // a 0.5 s tone burst at 440 Hz
    const x = new Float32Array(SR / 2);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * Math.min(1, i / 200);
    const y = paulstretch(x, 8, 8192, SR * 4, 't');
    expect(paulstretch(x, 8, 8192, SR * 4, 't')).toEqual(y);
    const spec = averageSpectrum(y, SR, SR, SR * 3);
    expect(bandEnergyDb(spec, 400, 480) - bandEnergyDb(spec, 1000, 4000)).toBeGreaterThan(20);
    // still sounding 3 s later, i.e. far longer than the source
    let late = 0;
    for (let i = SR * 3; i < SR * 3.5; i++) late += y[i] * y[i];
    expect(late).toBeGreaterThan(0);
  });

  it('tempo canon: every voice lands on its cycle start at the convergence point', () => {
    const template = [
      { u: 0, midis: [36, 43], dur: 0.1, palmMute: false, velocity: 0.9 },
      { u: 0.375, midis: [36], dur: 0.05, palmMute: true, velocity: 0.7 },
    ];
    const cp = 30;
    const { voices, notes } = tempoCanon(
      template,
      [
        { name: 'a', ratio: 1, ratioText: '1', transpose: 0, window: 20, reason: '' },
        { name: 'b', ratio: 4 / 3, ratioText: '4/3', transpose: 7, window: 14, reason: '' },
        { name: 'c', ratio: 5 / 3, ratioText: '5/3', transpose: -12, window: 8, reason: '' },
      ],
      2,
      cp,
    );
    voices.forEach((v, i) => {
      const last = notes.filter((n) => n.voice === i && n.midis.length === 2).at(-1)!;
      // the next cycle of every voice would start exactly at cp
      expect(last.time + 2 / v.ratio).toBeCloseTo(cp, 9);
      expect(v.entry).toBeGreaterThanOrEqual(cp - [20, 14, 8][i] - 1e-9);
    });
    // later voices enter later (staggered entries)
    expect(voices[0].entry).toBeLessThan(voices[1].entry);
    expect(voices[1].entry).toBeLessThan(voices[2].entry);
  });

  it('risset rhythm: layers a factor two apart, faded at the extremes', () => {
    const hits = rissetRhythm([{ u: 0, drum: 'kick', velocity: 1 }, { u: 0.5, drum: 'snare', velocity: 1 }], 2, 0, 24, 12, 3);
    expect(hits.length).toBeGreaterThan(20);
    for (const h of hits) {
      expect(h.tempoFactor).toBeGreaterThan(Math.pow(2, -1.5) - 1e-6);
      expect(h.tempoFactor).toBeLessThan(Math.pow(2, 1.5) + 1e-6);
    }
    // the hit rate keeps rising within one megabar for each layer
    const l0 = hits.filter((h) => h.layer === 0 && h.time < 12).map((h) => h.time);
    const gaps = l0.slice(1).map((t, i) => t - l0[i]);
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0]);
  });

  it('talkbox: the vowel moves the energy to its formants', () => {
    expect(vowelsOf('everything is an instrument')).toEqual(['e', 'e', 'i', 'i', 'i', 'a', 'i', 'u', 'e']);
    const saw = () => {
      const x = new Float32Array(SR);
      for (let i = 0; i < x.length; i++) x[i] = ((i * 110) / SR) % 1 - 0.5;
      return x;
    };
    const a = saw();
    const i2 = saw();
    talkbox(a, SR, [{ time: 0, vowel: 'a' }]);
    talkbox(i2, SR, [{ time: 0, vowel: 'i' }]);
    const sa = averageSpectrum(a, SR, SR / 4, SR);
    const si = averageSpectrum(i2, SR, SR / 4, SR);
    const f2a = FORMANTS.a[1];
    const f2i = FORMANTS.i[1];
    expect(bandEnergyDb(sa, f2a - 100, f2a + 100) - bandEnergyDb(sa, f2i - 100, f2i + 100)).toBeGreaterThan(6);
    expect(bandEnergyDb(si, f2i - 100, f2i + 100) - bandEnergyDb(si, f2a - 100, f2a + 100)).toBeGreaterThan(6);
  });
});
