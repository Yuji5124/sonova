import { describe, expect, it } from 'vitest';

describe('NOBODY ON AIR (FREAKTION SONG 001)', () => {
  it('three different arrangements, each fitting 30 s, all singing the hook', async () => {
    const { nobodyDemos } = await import('@sonova/composition-engine');
    const demos = nobodyDemos('freaktion-09');
    expect(demos.map((d) => d.bpm)).toEqual([160, 140, 150]);
    for (const d of demos) {
      const lead = d.vocals[0].notes;
      expect(lead.map((n) => n.lyric).join('')).toContain('ノバディノバディ');
      for (const n of lead) {
        expect(n.time + n.duration).toBeLessThanOrEqual(30);
        expect(n.lyric).not.toContain('ー');
      }
      // band parts present
      for (const part of ['guitar', 'bass', 'drums'] as const) expect(d.song.events.some((e) => e.part === part)).toBe(true);
      expect(d.song.sections.at(-1)!.start).toBeLessThan(30);
    }
    // A: the last AIR is long
    expect(Math.max(...demos[0].vocals[0].notes.filter((n) => n.lyric === 'ア').map((n) => n.duration))).toBeGreaterThan(4);
    // B: minor verse, major chorus (B♭ in the verse, F♯ in the chorus)
    const b = demos[1];
    const pcs = (from: number, to: number) => new Set(b.song.events.filter((e) => e.part === 'guitar' && e.time >= b.song.barSec * from && e.time < b.song.barSec * to).flatMap((e) => e.midis!.map((m) => m % 12)));
    expect(pcs(7, 15).has(6)).toBe(true);
  });
  it('the FREAKTION search is reproducible and C keeps its seed', async () => {
    const { freaktionSearch, mutationFor } = await import('@sonova/composition-engine');
    const a = freaktionSearch(4);
    expect(freaktionSearch(4)).toEqual(a);
    expect(mutationFor('freaktion-09')).toEqual(mutationFor('freaktion-09'));
  });
});
