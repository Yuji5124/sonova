import { describe, expect, it } from 'vitest';

describe('HAPPY TEARS (FREAKTION SONG 002)', () => {
  it('three demos share one vocal hook and differ in tempo, harmony and riff; HAPPY and TEARS parts in each', async () => {
    const { happyTearsDemos, HAPPY_TEARS_LYRICS } = await import('@sonova/composition-engine');
    const demos = happyTearsDemos();
    expect(demos.map((d) => d.bpm)).toEqual([160, 156, 158]);
    const melody = (d: (typeof demos)[number]) => d.vocals[0].notes.map((n) => `${n.lyric}${n.midi}`).join(' ');
    expect(new Set(demos.map(melody)).size).toBe(1);
    expect(new Set(demos.map((d) => d.chords.map((c) => c.chords).join('|'))).size).toBe(3);
    for (const d of demos) {
      const lead = d.vocals[0];
      expect(lead.notes.map((n) => n.lyric).join('')).toContain('ハピティアアズ');
      expect(lead.consonantOnly.every((i) => lead.notes[i].lyric === 'ズ')).toBe(true);
      expect(lead.notes.every((n) => !n.lyric.includes('ー'))).toBe(true);
      expect(lead.notes.at(-1)!.time + lead.notes.at(-1)!.duration).toBeLessThanOrEqual(d.durationSec);
      expect(d.orch.some((o) => o.stem === 'happy')).toBe(true);
      expect(d.orch.some((o) => o.stem === 'tears') || d.reeds.length > 0).toBe(true);
      expect(d.song.events.some((e) => e.part === 'guitar')).toBe(true);
    }
    // joy and sorrow sing the same chorus at the same time
    const [, joy, sorrow] = demos[0].vocals;
    expect(joy.notes.map((n) => n.time)).toEqual(sorrow.notes.map((n) => n.time));
    expect(HAPPY_TEARS_LYRICS['サビ｜二つの時間が重なる'][0]).toBe('HAPPY〜！ TEAR〜S！');
  });
  it('the reed models play in tune and do not overblow', async () => {
    const { reedNote } = await import('@sonova/orchestra-engine');
    const sr = 44100;
    const pitch = (x: Float32Array) => {
      const a = Math.round(0.35 * sr);
      const N = Math.round(0.3 * sr);
      const r = (L: number) => {
        let s = 0;
        let e = 0;
        let e2 = 0;
        for (let i = a; i < a + N; i++) {
          s += x[i] * x[i + L];
          e += x[i] ** 2;
          e2 += x[i + L] ** 2;
        }
        return s / Math.sqrt(e * e2 + 1e-12);
      };
      const rs: number[] = [];
      for (let L = 0; L < sr / 35; L++) rs.push(L < sr / 1200 ? 0 : r(L));
      const best = Math.max(...rs);
      const L = rs.findIndex((v, i) => i > 2 && v > 0.9 * best && v >= rs[i - 1] && v >= rs[i + 1]);
      return sr / (L + (rs[L - 1] - rs[L + 1]) / (2 * (rs[L - 1] - 2 * rs[L] + rs[L + 1])));
    };
    for (const [kind, notes] of [['bariSax', [33, 45, 52]], ['bassClarinet', [40, 50, 60]]] as const)
      for (const m of notes) {
        const hz = pitch(reedNote(kind, m, 0.9, 0.7, sr, 't'));
        expect(Math.abs(1200 * Math.log2(hz / (440 * 2 ** ((m - 69) / 12))))).toBeLessThan(10);
      }
  });
  it('consonantOnly silences the vowel of a note but keeps its consonant', async () => {
    const { consonantOnly } = await import('../scripts/lib-voicevox.ts');
    const q = { volume: Array(12).fill(1), phonemes: [{ phoneme: 'a', frame_length: 4, note_id: 'n0' }, { phoneme: 'z', frame_length: 3, note_id: 'n1' }, { phoneme: 'u', frame_length: 5, note_id: 'n1' }] };
    consonantOnly(q, new Set(['n1']));
    expect(q.volume.slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(q.volume.slice(9)).toEqual([0, 0, 0]);
  });
});
