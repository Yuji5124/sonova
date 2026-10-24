/**
 * ZIG — PSYLO (サイロ, Psyche × Glow): the PSYENCE WORKSHOP chorus (Pattern A, 160 BPM, hook サ・イーー・ロー)
 * grown into a full song on the TOYRIOT production (radio intro, megaphone verses, gang-vocal choruses).
 * Everything is original. The chorus notes are Pattern A / SHORT from PSYENCE-WORKSHOP src/psylo-vocal.json.
 */
import { euclid } from '@sonova/instrument-dna';
import { generateRock, type RockEvent, type RockSong } from '@sonova/music-generator';
import type { KanaNote, VocalLine } from './toyriot.ts';

export const PSYLO_VERSION = 'sonova-psylo/1.1.0';

/** original words (romaji, syllables split by '-', lines by '/') — after the PSYLO story: a show behind closed eyes */
export const PSYLO_LYRICS = {
  // 閉じたまぶたの裏側で / 誰も知らない幕が上がる
  verse1: 'to-ji-ta ma-bu-ta no / u-ra ga-wa de / da-re mo shi-ra-na-i / ma-ku ga a-ga-ru',
  // 不安も怒りも 鏡の前 / 楽しさも涙も 並んで
  verse2: 'fu-a-n mo i-ka-ri mo / ka-ga-mi no ma-e / ta-no-shi-sa mo / na-mi-da mo na-ra-n-de',
  // 音になれ / もっと外へ
  pre: 'o-to ni na-re / mo-t-to so-to e',
  // the opening announcement is in English (an English TTS voice, see scripts/psylo.ts)
  intro: 'Good evening. This is Radio Psyence. Close your eyes... the show is about to begin.',
  chorus: 'ポケットの宇宙 / 知らない色 / 胸の奥 ショーが始まる / 光れ サイロー！',
};

/** Pattern A / SHORT: [kana, midi, start beat, beats] — the hook サ D5, イ E5 ×3 beats, ロ F#5 ×2 beats */
export const PSYLO_CHORUS: Array<[string, number, number, number]> = [
  ['ポ', 62, 0, 0.5], ['ケ', 62, 0.5, 0.25], ['ト', 62, 1, 0.5], ['ノ', 64, 1.5, 0.5], ['ウ', 66, 2, 1], ['チュ', 66, 3, 0.5], ['ウ', 69, 3.5, 2],
  ['シ', 64, 8, 0.5], ['ラ', 66, 8.5, 0.5], ['ナ', 69, 9, 0.5], ['イ', 69, 9.5, 0.5], ['イ', 71, 10, 0.5], ['ロ', 69, 10.5, 2.5],
  ['ム', 67, 16, 0.5], ['ネ', 67, 16.5, 0.5], ['ノ', 69, 17, 0.5], ['オ', 71, 17.5, 0.5], ['ク', 71, 18, 1],
  ['ショ', 69, 20, 1], ['ガ', 71, 21, 0.5], ['ハ', 71, 21.5, 0.5], ['ジ', 74, 22, 0.5], ['マ', 74, 22.5, 0.5], ['ル', 71, 23, 0.75],
  ['ヒ', 69, 24, 0.5], ['カ', 69, 24.5, 0.5], ['レ', 71, 25, 0.75], ['サ', 74, 26, 1], ['イ', 76, 27, 3], ['ロ', 78, 30, 2],
];

export function psyloSong(band: Parameters<typeof generateRock>[0], seed: string): RockSong {
  return applyPsyloRiffs(psyloBaseSong(band, seed));
}

/** the generator's song before the irregular riffs (kept for comparison) */
export function psyloBaseSong(band: Parameters<typeof generateRock>[0], seed: string): RockSong {
  return generateRock(band, seed, 'PSYLO', {
    bpm: { value: 160, reason: 'PSYLO A案の確定テンポ (疾走型)' },
    rootPc: { value: 11, reason: 'B minor = A案のサビ (D major) の平行調。ギターは B まで下げたドロップで重く' },
    bars: { value: { intro: 6, outro: 6 }, reason: 'ラジオのイントロ (アナウンス) と、最後にラジオへ戻る時間' },
  });
}

/** a 2-bar stepwise verse motif (8ths, B minor), sung twice per 4 bars with an answering second half */
const VERSE_MOTIF: Array<Array<number | null>> = [
  [59, 59, 57, 59, 62, null, 59, null],
  [57, 57, 55, 57, 54, null, null, null],
  [59, 59, 57, 59, 62, null, 64, null],
  [62, 61, 59, 57, 59, null, null, null],
];
/** the pre-chorus: rising quarter notes over ♭VI–♭VII, leaving room before the chorus restarts low */
const PRE: Array<Array<number | null>> = [
  [55, 55, 57, 57],
  [57, 57, 59, 61],
  [59, 59, 62, 62],
  [61, 59, 57, null],
];

/** male voice: the chorus is sung an octave below Pattern A (hook ロー on F#4); the gang voice sings it as written */
export const PSYLO_MALE_TRANSPOSE = -12;

export function psyloVocalPlan(song: RockSong): VocalLine[] {
  const barSec = song.barSec;
  const spb = 60 / song.bpm;
  const sec = (n: string) => song.sections.find((s) => s.name === n)!;
  const line = (name: string, style: VocalLine['style'], text: string, melody: VocalLine['melody'], kana?: KanaNote[]): VocalLine => {
    const s = sec(name);
    return { section: name, style, text, offset: s.start - 0.3, seconds: s.end - s.start + 1.5, melody, ...(kana ? { kana } : {}) };
  };
  const out: VocalLine[] = [];
  for (const name of ['verse1', 'verse2'] as const) {
    const s = sec(name);
    const melody: VocalLine['melody'] = [];
    for (let b = 0; b < s.bars; b++) {
      const bar = VERSE_MOTIF[b % 4];
      bar.forEach((m, k) => {
        if (m === null) return;
        const rest = bar[k + 1] === null;
        melody.push({ time: s.start + b * barSec + k * (barSec / 8), duration: (barSec / 8) * (rest ? 1.8 : 0.9), midi: m, velocity: k === 0 ? 0.9 : 0.8 });
      });
    }
    out.push(line(name, 'megaphone', PSYLO_LYRICS[name], melody));
  }
  for (const name of ['pre1', 'pre2', 'pre3']) {
    const s = sec(name);
    const melody: VocalLine['melody'] = [];
    for (let b = 0; b < s.bars; b++)
      PRE[b % 4].forEach((m, k) => {
        if (m === null) return;
        melody.push({ time: s.start + b * barSec + k * (barSec / 4), duration: (barSec / 4) * (PRE[b % 4][k + 1] === null ? 1.9 : 0.95), midi: m, velocity: 0.8 + 0.04 * b });
      });
    out.push(line(name, 'pre', PSYLO_LYRICS.pre, melody));
  }
  for (const s of song.sections.filter((x) => x.name.startsWith('chorus'))) {
    const kana: KanaNote[] = PSYLO_CHORUS.map(([lyric, midi, start, beats]) => ({ lyric, midi: midi + PSYLO_MALE_TRANSPOSE, time: s.start + start * spb, duration: beats * spb, velocity: lyric === 'サ' || lyric === 'ロ' ? 1 : 0.85 }));
    out.push(line(s.name, 'chorus', PSYLO_LYRICS.chorus, kana.map((k) => ({ time: k.time, duration: k.duration, midi: k.midi, velocity: k.velocity })), kana));
  }
  return out;
}

// ---- irregular riffs ------------------------------------------------------------------------
// The generator plays one 16-step riff bar again and again, and the verses chug straight 8ths.
// PSYLO swaps those bars for patterns that push against the 4/4 backbeat (the snare stays on 2 and 4):
//   - accent groups 3+3+3+3+2+2 (a 7/8-ish lurch inside 4/4)
//   - polymeter: a 5-step cell laid over the 16-step bar, so its accent lands somewhere new every bar
//     (the idea of TidalCycles' `{…}%16`, github.com/tidalcycles/Tidal)
//   - Euclidean rhythms (Toussaint; github.com/brianhouse/bjorklund) rotated every bar
//     (Strudel's `iter`, codeberg.org/uzu/strudel), with `ply`-style 32nd-note stutters
// All re-implemented here from the published ideas; no code from those projects is copied.

/** one step: R = accented power chord, P = power chord on another degree, m = palm-muted root, s = 32nd stutter (2 mutes), . = rest */
export interface RiffStep {
  slot: number;
  kind: 'R' | 'P' | 'm' | 's';
  off: number;
}
export interface PsyloRiffBar {
  section: string;
  bar: number;
  pattern: string;
  steps: RiffStep[];
}

const toSteps = (row: string, offs: number[]): RiffStep[] => {
  const out: RiffStep[] = [];
  let k = 0;
  [...row].forEach((c, slot) => {
    if (c === '.') return;
    out.push({ slot, kind: c as RiffStep['kind'], off: c === 'R' || c === 'P' ? offs[k++ % offs.length] : 0 });
  });
  return out;
};
/** accent groups (in 16ths): a chord on each group start, then a palm mute, then rests — 3 → R m . , 2 → R m */
const grouped = (groups: number[]): string => groups.map((g) => ('Rm' + '.'.repeat(g)).slice(0, g)).join('');
/** E(pulses,16) rotated by `rot`: chords on the hits, a mute on the even slots between them; the downbeat is always a chord */
const euclidRow = (pulses: number, rot: number): string => 'R' + euclid(16, pulses, rot).map((h, i) => (h ? 'P' : i % 2 === 0 ? 'm' : '.')).join('').slice(1);

/** the riff bars of every irregular section (absolute bar numbers), deterministic */
export function psyloRiffPlan(song: RockSong): PsyloRiffBar[] {
  const out: PsyloRiffBar[] = [];
  const add = (section: string, bar: number, row: string, offs: number[]) => out.push({ section, bar, pattern: row, steps: toSteps(row, offs) });
  for (const sec of song.sections) {
    const n = sec.name;
    for (let b = 0; b < sec.bars; b++) {
      const bar = sec.startBar + b;
      const last = b === sec.bars - 1;
      if (n === 'riffA' || n === 'riffA2') {
        // 3+3+3+3+2+2, and the 4th bar regroups (3+3+2+3+3+2) and stutters into the next section
        let row = b % 4 === 3 ? grouped([3, 3, 2, 3, 3, 2]) : grouped([3, 3, 3, 3, 2, 2]);
        if (n === 'riffA2' && b % 2 === 1) row = euclidRow(7, b * 3); // the reprise answers itself with a rotated E(7,16)
        if (b % 4 === 3) row = row.slice(0, 14) + 'ss';
        // B, B, D, E, F (♭5), C (♭2): the tritone and the half step give the industrial edge
        add(n, bar, row, b % 2 === 0 ? [0, 0, 3, 5, 0, 6] : [0, 1, 0, 5, 6, 3]);
      } else if (n === 'riffB') {
        // polymeter: the 5-step cell R m . P m runs straight across the bar lines
        const cell = 'Rm.Pm';
        let row = Array.from({ length: 16 }, (_, i) => cell[(b * 16 + i) % 5]).join('');
        if (row[0] === '.') row = 'm' + row.slice(1);
        if (last) row = row.slice(0, 12) + 'R.ss';
        add(n, bar, row, [0, 7, 0, 5, 0, 10]);
      } else if (n === 'riffA3' || (n === 'outro' && !last)) {
        // cross-rhythm: E(5,16) chords against an E(3,8) mute pulse, rotating by 2 steps a bar
        const chords = euclid(16, 5, b * 2);
        const mutes = [...euclid(8, 3, b), ...euclid(8, 3, b)];
        let row = chords.map((h, i) => (h ? (i === 0 ? 'R' : 'P') : mutes[i] ? 'm' : '.')).join('');
        if (row[0] !== 'R') row = 'R' + row.slice(1);
        if (b % 4 === 3 && n === 'riffA3') row = row.slice(0, 13) + 'sss';
        add(n, bar, row, [0, 3, 6, 5, 10, 0]);
      } else if (n.startsWith('verse')) {
        // the chug, displaced: groups of three 16ths (R m m) over the bar; every 4th bar is stop-time
        // (one hit and space for the megaphone voice, then a pickup)
        const row = b % 4 === 3 ? 'R...........m.mm' : n === 'verse2' && b % 2 === 1 ? 'Rmm.mmPm.mmRm.P.' : 'Rm.Rm.Rm.Rm.R.m.';
        add(n, bar, row, n === 'verse2' && b % 2 === 1 ? [0, 3, 0, 5] : [0]);
      }
    }
  }
  return out;
}

/**
 * Rewrite the generated song with the irregular riffs: the guitar of those bars is replaced, the kick
 * follows the new accents (snare backbeat, hats and fills are kept) and the bass doubles the chord roots.
 */
export function applyPsyloRiffs(song: RockSong): RockSong {
  const plan = psyloRiffPlan(song);
  const byBar = new Map(plan.map((p) => [p.bar, p]));
  const slotSec = song.barSec / 16;
  let nextId = Math.max(...song.events.map((e) => e.id)) + 1;
  const kept: RockEvent[] = [];
  const rootOfBar = new Map<number, number>();
  const fillAt12 = new Set<number>();
  for (const e of song.events) {
    if (e.part === 'guitar' && e.kind === 'chord' && byBar.has(e.bar) && !rootOfBar.has(e.bar)) rootOfBar.set(e.bar, Math.min(...e.midis!));
    if (e.part === 'guitar' && e.kind === 'damp' && e.slot === 12) fillAt12.add(e.bar);
  }
  for (const e of song.events) {
    const p = byBar.get(e.bar);
    if (p) {
      if (e.part === 'guitar' && e.kind === 'chord') continue;
      if (e.part === 'drums' && e.kind === 'hit' && e.drum === 'kick' && !e.cause?.rule.match(/rhythm/)) continue;
      if (e.part === 'bass' && e.kind === 'note' && !e.cause) continue;
    }
    kept.push(e);
  }
  const tuningRoot = Number(song.tuning.match(/MIDI (\d+)/)?.[1] ?? 35);
  const added: RockEvent[] = [];
  for (const p of plan) {
    const t0 = p.bar * song.barSec;
    const root = rootOfBar.get(p.bar) ?? tuningRoot;
    const steps = p.steps.filter((s) => !(fillAt12.has(p.bar) && s.slot >= 12));
    steps.forEach((s, k) => {
      const nextSlot = steps[k + 1]?.slot ?? 16;
      const r = root + s.off;
      const ev = (slot: number, kind: RockEvent['kind'], o: Partial<RockEvent>): RockEvent => ({ id: nextId++, time: Math.round((t0 + slot * slotSec) * 1e6) / 1e6, bar: p.bar, slot: Math.floor(slot), depth: 0, kind, part: 'guitar', ...o }) as RockEvent;
      if (s.kind === 's') {
        for (const h of [0, 0.5]) added.push(ev(s.slot + h, 'chord', { midis: [root, root + 7], midi: root, velocity: 0.72 + h * 0.3, duration: Math.round(slotSec * 0.45 * 1e6) / 1e6, palmMute: true, text: 'ply' }));
        return;
      }
      const chord = s.kind === 'R' || s.kind === 'P';
      const g = added.push(ev(s.slot, 'chord', { midis: chord ? [r, r + 7, r + 12] : [root], midi: chord ? r : root, velocity: s.kind === 'R' ? 0.98 : s.kind === 'P' ? 0.9 : 0.74, duration: Math.round(slotSec * (chord ? Math.max(1, nextSlot - s.slot) * 0.95 : 0.9) * 1e6) / 1e6, palmMute: !chord, text: p.pattern }));
      const gEv = added[g - 1];
      if (chord) {
        added.push({ ...ev(s.slot, 'hit', {}), part: 'drums', drum: 'kick', velocity: s.kind === 'R' ? 0.98 : 0.86, depth: 1, cause: { event: gEv.id, rule: 'entrain', from_part: 'guitar' } } as RockEvent);
        added.push({ ...ev(s.slot, 'note', {}), part: 'bass', midi: r - 12 < 23 ? r : r - 12, velocity: 0.9, duration: Math.round(slotSec * Math.max(1, nextSlot - s.slot) * 0.9 * 1e6) / 1e6, depth: 1, cause: { event: gEv.id, rule: 'entrain', from_part: 'guitar' } } as RockEvent);
      }
    });
  }
  const events = [...kept, ...added].sort((a, b) => a.time - b.time || a.id - b.id);
  const derivations = [
    ...song.derivations,
    { choice: 'riff.irregular', value: [...new Set(plan.map((p) => p.section))].join(', '), from: 'series', rule: '3+3+3+3+2+2 のアクセント、5拍子のセルのポリメーター (TidalCycles の {…}%16 の考え方)、毎小節回転するユークリッドリズム (Toussaint / Strudel の iter)、32分の ply。スネアは 2・4 拍のまま' },
  ];
  return { ...song, events, derivations, riffText: plan.filter((p) => p.section === 'riffA')[0]?.pattern ?? song.riffText };
}
