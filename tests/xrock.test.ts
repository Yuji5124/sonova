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

describe('XROCK singer', () => {
  it('vowels of the vocal tract land in the right formant order', async () => {
    const { renderSinger } = await import('@sonova/synthesis-engine');
    const f2 = (v: 'a' | 'e' | 'i' | 'o' | 'u') => {
      const x = renderSinger([{ time: 0.1, duration: 1.2, midi: 45, velocity: 0.9, syllable: { vowel: v } }], 1.5, SR, 't', { vibratoCents: 0, breathiness: 0 });
      const spec = averageSpectrum(x, SR, Math.round(0.5 * SR), Math.round(1.2 * SR), 16384);
      // the strongest harmonic between 700 and 2600 Hz approximates F2
      let best = 0;
      let at = 0;
      for (let k = 7; k * 110 < 2600; k++) {
        const e = bandEnergyDb(spec, k * 110 - 30, k * 110 + 30);
        if (e > best || at === 0) {
          best = e;
          at = k * 110;
        }
      }
      return at;
    };
    const [i, e, a, u] = [f2('i'), f2('e'), f2('a'), f2('u')];
    expect(i).toBeGreaterThan(a);
    expect(e).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(u);
  });

  it('the invented language follows its source and the refrain repeats', async () => {
    const { inventLanguage, setLyrics } = await import('@sonova/composition-engine');
    const dark = { dna_hash: 'x', name: 'dark', harmonics: { brightness: 0.05 }, attack: 0.7, decay: 1.6 } as never;
    const bright = { dna_hash: 'y', name: 'bright', harmonics: { brightness: 0.95 }, attack: 0.01, decay: 0.2 } as never;
    const d = inventLanguage(dark, 's');
    const b = inventLanguage(bright, 's');
    expect(d.vowels.u).toBeGreaterThan(b.vowels.u);
    expect(b.vowels.i).toBeGreaterThan(d.vowels.i);
    expect(b.onsets.k).toBeGreaterThan(d.onsets.k);
    expect(b.codaProb).toBeGreaterThan(d.codaProb);
    expect(inventLanguage(dark, 's')).toEqual(d);
    const notes = Array.from({ length: 24 }, (_, k) => ({ time: k * 0.25, duration: k % 8 === 7 ? 1 : 0.2, midi: 60 + (k % 5), velocity: 0.8, slide: k % 3 === 2 }));
    const one = setLyrics(notes, d, 'lyr');
    expect(setLyrics(notes, d, 'lyr').text).toBe(one.text);
    expect(one.sung.filter((n) => n.syllable === null).length).toBeGreaterThan(0); // melismas
    expect(one.text.split(' / ').length).toBeGreaterThan(2); // phrases end on long notes
  });
});

describe('XROCK voice journey', () => {
  it('a shorter tract moves the resonances up without changing the pitch; the ring stays stable', async () => {
    const { renderSinger, tractLengthCm } = await import('@sonova/synthesis-engine');
    const sing = (formantScale: number, ring = 0) => renderSinger([{ time: 0.1, duration: 1.2, midi: 57, velocity: 0.9, syllable: { vowel: 'i' } }], 1.5, SR, 't', { formantScale, ring, vibratoCents: 0, breathiness: 0, scoopCents: 0 });
    const centroid = (x: Float32Array) => {
      const spec = averageSpectrum(x, SR, Math.round(0.5 * SR), Math.round(1.2 * SR), 8192);
      let num = 0;
      let den = 0;
      spec.mag.forEach((m, k) => {
        const hz = k * spec.binHz;
        if (hz > 1200 && hz < 5000) {
          num += hz * m;
          den += m;
        }
      });
      return num / den;
    };
    const pitchPeak = (x: Float32Array) => {
      const spec = averageSpectrum(x, SR, Math.round(0.5 * SR), Math.round(1.2 * SR), 16384);
      return bandEnergyDb(spec, 215, 225) - bandEnergyDb(spec, 180, 200);
    };
    const human = sing(1);
    const small = sing(1.3);
    expect(centroid(small)).toBeGreaterThan(centroid(human) * 1.1);
    expect(pitchPeak(small)).toBeGreaterThan(10); // still sings A3 (220 Hz)
    expect(tractLengthCm(1.07)).toBeCloseTo(16, 0);
    const ringing = sing(1.3, 0.8);
    expect(ringing.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('TOYRIOT', () => {
  it('turns romaji lyrics into singer syllables (moraic n as coda, voiced consonants approximated)', async () => {
    const { romajiToSyllables, romanizeSyl } = await import('@sonova/composition-engine');
    const r = romajiToSyllables('to-n-de-ke / ze-n-bu');
    expect(r.syllables.map(romanizeSyl)).toEqual(['ton', 'te', 'ke', 'sen', 'vu']);
    expect(r.breaks).toEqual([3, 5]);
  });
  it('the megaphone keeps the voice band and removes the low end', async () => {
    const { megaphone } = await import('@sonova/composition-engine');
    const x = new Float32Array(SR).map((_, i) => Math.sin((2 * Math.PI * 100 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 1500 * i) / SR));
    const y = megaphone(x, SR, 1);
    const spec = averageSpectrum(y, SR, SR / 4, SR);
    expect(bandEnergyDb(spec, 1400, 1600) - bandEnergyDb(spec, 90, 110)).toBeGreaterThan(15);
  });
});
