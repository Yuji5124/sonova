/**
 * ZIG — HAPPY TEARS (FREAKTION SONG 002, Phase 0): three 30-second demos with the same vocal hook.
 * EMOTION COLLISION × TIME CROSS — joy and sorrow, past and future, sound at the same time, not in turns:
 * bright strings, brass and glockenspiel above, a lamenting cello, contrabass, bass clarinet and baritone sax
 * below, a band that keeps running forward, and a voice sung at once by its "joy" and "sorrow" styles.
 *   A  BRASS RIFF      160 BPM  distorted guitar and baritone sax finish each other's riff (RIFF A)
 *   B  ORCHESTRA RIOT  156 BPM  strings and brass in front, saturated timpani and toms in unison with the guitar (RIFF B)
 *   C  BROKEN PARADE   158 BPM  a march that keeps breaking; a phrase handed guitar → reeds → pizzicato → SONOVA image
 *                               instruments, mutating (RIFF C)
 * Lyrics: the current draft (HAPPY_TEARS_LYRICS) is kept verbatim; the demos sing an excerpt (B melody, chorus,
 * the last "ありがとう"). Everything is original; nothing is taken from existing songs.
 */
import { Rng } from '@sonova/instrument-dna';
import type { RockSong } from '@sonova/music-generator';
import { Score, pc, sing } from './nobody.ts';
import type { KanaNote } from './toyriot.ts';

export const HAPPY_TEARS_VERSION = 'sonova-happytears/0.1.0';

/** the adopted draft, verbatim */
export const HAPPY_TEARS_LYRICS = {
  'Aメロ｜過去の君': ['古いフィルムに　明日の色が', 'まだ知らない夢を　照らしてた', '笑い飛ばした　小さな傷が', '今じゃ誰かの　宝物'],
  'Bメロ｜未来の僕': ['止まった時計が　酔っぱらって', '昨日と明日を　飲み干した', '君がいないと　知っているのに', '壊れたラジオが　笑いだす'],
  'サビ｜二つの時間が重なる': ['HAPPY〜！ TEAR〜S！', '笑いながら　空を見上げて', 'HAPPY〜！ TEAR〜S！', '泣きながら　明日を鳴らす', '昨日の君が　笑うたび', '明日の僕に　涙が降る', 'HAPPY〜！ TEAR〜S！', 'まだ終わらない　この歌が'],
  'ラスト｜ありがとう': ['君の知らない　未来の街で', '僕らは今日も　歌っている', '悲しいくらい　楽しい夜に', 'また君の曲を　かけてみる', 'HAPPY〜！ TEAR〜S！', 'ありがとう　こんなに楽しい音楽を'],
};

/** what the 30-second demos sing (an excerpt; nothing rewritten) */
export const DEMO_LYRICS = [
  { section: 'Bメロ (抜粋)', lines: ['止まった時計が　酔っぱらって', '昨日と明日を　飲み干した'] },
  { section: 'サビ (抜粋)', lines: ['HAPPY〜！ TEAR〜S！', '笑いながら　空を見上げて', 'HAPPY〜！ TEAR〜S！', '泣きながら　明日を鳴らす'] },
  { section: 'ラスト (抜粋)', lines: ['HAPPY〜！ TEAR〜S！', 'ありがとう'] },
];

/**
 * syllables of the hook and how they are sung (VOICEVOX sings one kana mora per note):
 * HAP-PY〜  = ハ (short, the ッ is the gap) + ピ (the stretched vowel i, a 5th up: the lift)
 * TEAR〜S   = ティ (short) + ア (the stretched vowel a, falling a step at the end: the catch in the voice)
 *             + ズ (z only — its vowel is muted so the English final consonant is not sung as "zu")
 */
export const HOOK_SYLLABLES = [
  { word: 'HAP', kana: 'ハ', accent: true, beats: 0.5, note: 'D4', how: '強く短く。続く ッ は休符で表す' },
  { word: 'PY〜', kana: 'ピ', accent: false, beats: 2.5, note: 'A4', how: '完全5度上へ跳ねて母音 i を伸ばす (高揚)' },
  { word: 'TEAR〜', kana: 'ティ + ア', accent: true, beats: 2.5, note: 'A4 → F♯4 → E4', how: 'ティで当て、母音 a を伸ばしながら一段下がる (泣き声の揺れ)' },
  { word: 'S！', kana: 'ズ', accent: false, beats: 0.25, note: 'E4', how: '子音 z だけ。母音 u は消す (英語の末尾子音を伸ばさない)' },
];

export interface OrchNote {
  inst: string;
  art: string;
  midi: number;
  time: number;
  dur: number;
  vel: number;
  stem: Stem;
  pan: number;
  gainDb?: number;
}
export interface ReedNote {
  kind: 'bassClarinet' | 'bariSax';
  midi: number;
  time: number;
  dur: number;
  vel: number;
  stem: Stem;
  pan: number;
  gainDb?: number;
}
export interface PercHit {
  kind: 'timpani' | 'tom' | 'snare' | 'crash';
  time: number;
  vel: number;
  /** saturation drive for RIFF B (0 = clean) */
  drive: number;
  midi?: number;
}
export interface MorphNote {
  /** a SONOVA test-corpus material (image instrument) */
  material: string;
  midi: number;
  time: number;
  dur: number;
  vel: number;
  timbre: number;
}
export type Stem = 'vocal' | 'drums' | 'bass' | 'guitar' | 'happy' | 'tears';
export const STEMS: Array<{ id: Stem; label: string }> = [
  { id: 'vocal', label: 'ボーカル' },
  { id: 'drums', label: 'ドラム・打楽器' },
  { id: 'bass', label: 'ベース' },
  { id: 'guitar', label: 'ギター' },
  { id: 'happy', label: 'HAPPY (弦・ブラス・グロッケン)' },
  { id: 'tears', label: 'TEARS (チェロ・コントラバス・バスクラ・バリサク)' },
];

export interface VoicePart {
  name: string;
  voice: string;
  styleId: number;
  credit: string;
  transpose?: number;
  delay?: number;
  cents?: number;
  pan: number;
  gain: number;
  fx: 'lead' | 'layer' | 'gang' | 'thanks';
  notes: KanaNote[];
  /** indices of notes sung as their consonant only (ズ of TEARS) */
  consonantOnly: number[];
}

export interface HappyDemo {
  id: 'A' | 'B' | 'C';
  title: string;
  goal: string;
  bpm: number;
  bars: number;
  durationSec: number;
  sections: Array<{ name: string; from: number; to: number; text: string }>;
  chords: Array<{ bars: string; chords: string; why: string }>;
  riffs: Array<{ name: string; text: string }>;
  instrumentation: { happy: string[]; tears: string[]; band: string[] };
  song: RockSong;
  orch: OrchNote[];
  reeds: ReedNote[];
  perc: PercHit[];
  morph: MorphNote[];
  vocals: VoicePart[];
  discoveries: Array<{ name: string; text: string; seed?: string; settings?: Record<string, unknown> }>;
  hall: number;
  /** a tape stop on the band [from, to] seconds (C) */
  tapeStop?: [number, number];
}

// ---- the shared vocal score (beats; the same in all three demos) -----------------------------------
type Mel = Array<[string, number, number]>;
// the S lands a quarter beat before the next pickup, so there is a breath after TEAR〜S!
const HOOK: Mel = [['ハ', 62, 0.5], ['-', 0, 0.25], ['ピ', 69, 2.25], ['-', 0, 1], ['ティ', 69, 0.5], ['ア', 66, 1.25], ['ア', 64, 0.75], ['ズ', 64, 0.25], ['-', 0, 1.25]];
/** bar → melody, starting at beat 0 of that bar (pickups are written as rests in the bar before) */
function vocalScore(s: Score): { lead: KanaNote[]; hookIdx: number[]; zu: number[] } {
  const lines: Array<[number, number, Mel]> = [
    // Bメロ: 止まった時計が 酔っぱらって — a drunk clock: off-beat, a sharp 4th that stumbles
    [4, 0, [['ト', 59, 0.5], ['マ', 59, 0.25], ['-', 0, 0.25], ['タ', 62, 0.5], ['ト', 61, 0.5], ['ケ', 59, 0.5], ['イ', 57, 0.5], ['ガ', 59, 1]]],
    [5, 0, [['ヨ', 62, 0.25], ['-', 0, 0.25], ['パ', 62, 0.5], ['ラ', 61, 0.25], ['-', 0, 0.25], ['テ', 59, 1.5], ['-', 0, 1]]],
    // 昨日と明日を 飲み干した
    [6, 0, [['キ', 55, 0.5], ['ノ', 57, 0.5], ['ウ', 59, 0.5], ['ト', 62, 0.5], ['ア', 64, 0.5], ['シ', 62, 0.5], ['タ', 59, 0.5], ['ヲ', 57, 0.5]]],
    [7, 0, [['ノ', 59, 0.5], ['ミ', 62, 0.5], ['ホ', 64, 0.5], ['シ', 66, 0.5], ['タ', 64, 1.5], ['-', 0, 0.5]]],
    // サビ: HAPPY〜! TEAR〜S! 笑いながら 空を見上げて
    [8, 0, HOOK],
    [9, 3, [['ワ', 62, 0.5], ['ラ', 64, 0.5]]],
    [10, 0, [['イ', 66, 0.5], ['ナ', 66, 0.5], ['ガ', 64, 0.5], ['ラ', 62, 0.5], ['ソ', 66, 0.5], ['ラ', 67, 0.5], ['ヲ', 69, 0.5], ['ミ', 69, 0.5]]],
    [11, 0, [['ア', 71, 0.5], ['ゲ', 69, 0.5], ['テ', 62, 2], ['-', 0, 1]]],
    // HAPPY〜! TEAR〜S! 泣きながら 明日を鳴らす
    [12, 0, HOOK],
    [13, 3, [['ナ', 59, 0.5], ['キ', 62, 0.5]]],
    [14, 0, [['ナ', 64, 0.5], ['ガ', 62, 0.5], ['ラ', 59, 0.5], ['ア', 57, 0.5], ['シ', 59, 0.5], ['タ', 62, 0.5], ['ヲ', 64, 0.5], ['ナ', 66, 0.5]]],
    [15, 0, [['ラ', 64, 0.5], ['ス', 62, 2.5], ['-', 0, 1]]],
    // ラスト: HAPPY〜! TEAR〜S! ありがとう
    [16, 0, HOOK],
    [18, 0, [['ア', 66, 0.5], ['リ', 64, 0.5], ['ガ', 62, 0.5], ['ト', 64, 0.5], ['ウ', 62, 2.5]]],
  ];
  const lead: KanaNote[] = [];
  const hookIdx: number[] = [];
  const zu: number[] = [];
  for (const [bar, beat, mel] of lines) {
    const notes = sing(s, bar, beat, mel);
    notes.forEach((n) => {
      if (mel === HOOK) hookIdx.push(lead.length);
      if (n.lyric === 'ズ') zu.push(lead.length);
      lead.push(n);
    });
  }
  return { lead, hookIdx, zu };
}

function voices(s: Score): VoicePart[] {
  const { lead, hookIdx, zu } = vocalScore(s);
  const chorusFrom = s.t(8);
  const thanksFrom = s.t(18);
  const sub = (pred: (n: KanaNote, i: number) => boolean) => {
    const idx: number[] = [];
    const notes = lead.filter((n, i) => {
      const ok = pred(n, i);
      if (ok) idx.push(i);
      return ok;
    });
    return { notes, consonantOnly: zu.filter((z) => idx.includes(z)).map((z) => idx.indexOf(z)) };
  };
  const chorus = sub((n) => n.time >= chorusFrom && n.time < thanksFrom);
  const hook = sub((_, i) => hookIdx.includes(i));
  return [
    { name: 'ZIG (lead)', voice: '玄野武宏 ノーマル', styleId: 3011, credit: 'VOICEVOX:玄野武宏', pan: 0, gain: 1, fx: 'lead', notes: lead, consonantOnly: zu },
    { name: 'joy (喜び)', voice: '玄野武宏 喜び', styleId: 3039, credit: 'VOICEVOX:玄野武宏', pan: -0.42, gain: 0.5, fx: 'layer', delay: 0.008, cents: 5, ...chorus },
    { name: 'sorrow (悲しみ)', voice: '玄野武宏 悲しみ', styleId: 3041, credit: 'VOICEVOX:玄野武宏', pan: 0.42, gain: 0.5, fx: 'layer', delay: 0.013, cents: -5, ...chorus },
    { name: 'gang (+1 oct)', voice: '白上虎太郎 わーい', styleId: 3032, credit: 'VOICEVOX:白上虎太郎', transpose: 12, pan: 0, gain: 0.32, fx: 'gang', ...hook },
  ];
}

// ---- helpers --------------------------------------------------------------------------------------
const EIGHTHS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
type Chord = { name: string; root: number; tones: number[] };
const CH: Record<string, Chord> = {
  D: { name: 'D', root: 38, tones: [50, 54, 57] },
  'A/C#': { name: 'A/C♯', root: 37, tones: [49, 52, 57] },
  Bm: { name: 'Bm', root: 47, tones: [47, 50, 54] },
  G: { name: 'G', root: 43, tones: [43, 47, 50] },
  Gm: { name: 'Gm', root: 43, tones: [43, 46, 50] },
  A: { name: 'A', root: 45, tones: [45, 49, 52] },
  'F#m': { name: 'F♯m', root: 42, tones: [42, 45, 49] },
  Em7: { name: 'Em7', root: 40, tones: [40, 43, 47, 50] },
  Em: { name: 'Em', root: 40, tones: [40, 43, 47] },
  C: { name: 'C', root: 48, tones: [48, 52, 55] },
  'D/F#': { name: 'D/F♯', root: 42, tones: [42, 45, 50] },
};
/** bar → [chord on beats 0–2, chord on beats 2–4] (same twice = whole bar) */
type Harmony = Record<number, [string, string]>;
const whole = (c: string): [string, string] => [c, c];

function bandBase(s: Score, h: Harmony, from: number, to: number, o: { kick: number[]; snare: number[]; hat?: 'hat' | 'hatOpen' | 'ride' }) {
  for (let bar = from; bar < to; bar++) {
    const [c1, c2] = h[bar];
    for (const b of EIGHTHS) {
      const c = CH[b < 2 ? c1 : c2];
      const low = c.root < 40 ? c.root + 12 : c.root;
      s.bass(bar, b, low >= 52 ? low - 24 : low - 12, 0.5, b % 1 ? 0.8 : 0.93);
    }
    s.drums(bar, { kick: o.kick, snare: o.snare, [o.hat ?? 'hat']: EIGHTHS }, 0.9);
  }
}

// =====================================================================================================
// A — BRASS RIFF
// =====================================================================================================
export function demoHappyA(): HappyDemo {
  const s = new Score(160);
  const h: Harmony = {
    0: whole('D'), 1: whole('A/C#'), 2: whole('Bm'), 3: ['G', 'Gm'],
    4: whole('Bm'), 5: whole('G'), 6: whole('Em'), 7: whole('A'),
    8: whole('D'), 9: whole('A/C#'), 10: whole('Bm'), 11: ['G', 'Gm'],
    12: whole('D'), 13: whole('A/C#'), 14: whole('Bm'), 15: ['G', 'Gm'],
    16: whole('D'), 17: whole('A/C#'), 18: ['G', 'Gm'], 19: whole('D'),
  };
  const orch: OrchNote[] = [];
  const reeds: ReedNote[] = [];
  const perc: PercHit[] = [];
  // RIFF A — BRASS RESPONSE: the guitar plays beats 1–2, the baritone sax answers in the guitar's rest (3–4)
  const gtrCall = (bar: number, root: number) => {
    s.guitar(bar, 0, pc(root), 0.5, { vel: 0.97 });
    s.guitar(bar, 0.5, [root], 0.25, { mute: true });
    s.guitar(bar, 0.75, pc(root), 0.5, { vel: 0.9 });
    s.guitar(bar, 1.25, pc(root + 2), 0.5, { vel: 0.92 });
  };
  const saxAnswer = (bar: number, root: number, up = 0) => {
    const r = root < 38 ? root + 12 : root;
    const phrase: Array<[number, number, number]> = [[2, r + 7 - 12, 0.5], [2.5, r + 10 - 12, 0.25], [2.75, r + 12 - 12 + up, 0.5], [3.25, r + 7 - 12, 0.25], [3.5, r - 12 + 12, 0.5]];
    for (const [b, m, d] of phrase) reeds.push({ kind: 'bariSax', midi: Math.max(33, m), time: s.t(bar, b), dur: d * s.beat * 0.95, vel: 0.85, stem: 'tears', pan: 0.25 });
  };
  for (let bar = 0; bar < 4; bar++) {
    const c = CH[h[bar][0]];
    gtrCall(bar, c.root < 40 ? c.root + 12 : c.root);
    saxAnswer(bar, c.root, bar === 3 ? 1 : 0);
    s.bass(bar, 0, (c.root < 40 ? c.root : c.root - 12), 1.5);
    s.bass(bar, 2, (c.root < 40 ? c.root : c.root - 12) + 7, 0.5);
    s.drums(bar, { kick: [0, 0.75, 2, 2.5], snare: [1, 3], hat: EIGHTHS, ...(bar === 0 ? { crash: [0] } : {}) });
  }
  // B melody: half-time feel, the riff thinned; cello sings under it
  bandBase(s, h, 4, 8, { kick: [0, 2.5], snare: [2], hat: 'hat' });
  for (let bar = 4; bar < 8; bar++) {
    const c = CH[h[bar][0]];
    s.guitar(bar, 0, pc(c.root < 40 ? c.root + 12 : c.root), 1.5, { vel: 0.8 });
    s.guitar(bar, 2.5, [c.root < 40 ? c.root + 12 : c.root], 0.4, { mute: true });
  }
  s.drums(7, { snare: [3, 3.25, 3.5, 3.75] }, 0.8);
  // chorus + last: driving eighths, guitar+sax still trading in the gaps of the vocal (beats 3–4 of the hook bars)
  bandBase(s, h, 8, 19, { kick: [0, 1.5, 2, 3.5], snare: [1, 3], hat: 'hatOpen' });
  for (let bar = 8; bar < 19; bar++) {
    const [c1, c2] = h[bar];
    for (const b of EIGHTHS) {
      const c = CH[b < 2 ? c1 : c2];
      s.guitar(bar, b, pc(c.root < 40 ? c.root + 12 : c.root), 0.5, { vel: b % 1 ? 0.8 : 0.92 });
    }
    if ([8, 12, 16].includes(bar)) s.hit(bar, 0, 'crash', 0.9);
    if ([9, 13, 17].includes(bar)) saxAnswer(bar, CH[c1].root);
  }
  s.drums(18, { snare: [3, 3.25, 3.5, 3.75] }, 0.85);
  s.guitar(19, 0, pc(38), 5, { vel: 1 });
  s.bass(19, 0, 26, 4);
  s.drums(19, { kick: [0], crash: [0] }, 1);
  // HAPPY: violins in bright eighth arpeggios (above the voice), glockenspiel on the hooks, brass stabs + orchestra hits
  for (let bar = 8; bar < 19; bar++) {
    const c = CH[h[bar][0]];
    EIGHTHS.forEach((b, k) => orch.push({ inst: 'violins', art: 'spic', midi: c.tones[k % c.tones.length] + 24 + (k >= 4 ? 12 : 0), time: s.t(bar, b), dur: s.beat * 0.5, vel: 0.7 + (k % 2 ? 0 : 0.15), stem: 'happy', pan: -0.35 }));
  }
  for (const bar of [8, 12, 16]) {
    hitAt(orch, perc, s.t(bar), CH[h[bar][0]]);
    for (const [b, m] of [[0.5, 81], [1, 86], [1.5, 90], [2, 93]] as const) orch.push({ inst: 'glock', art: 'hit', midi: m, time: s.t(bar, b), dur: 1, vel: 0.75, stem: 'happy', pan: 0.3 });
    for (const [b, m] of [[2.5, 74], [3, 78], [3.5, 81]] as const) orch.push({ inst: 'trumpet', art: 'stac', midi: m, time: s.t(bar + 1, b), dur: s.beat * 0.45, vel: 0.85, stem: 'happy', pan: 0.2 });
  }
  for (let bar = 4; bar < 8; bar++) orch.push({ inst: 'violins', art: 'sus', midi: CH[h[bar][0]].tones[2] + 24, time: s.t(bar), dur: s.bar, vel: 0.5, stem: 'happy', pan: -0.3 });
  // TEARS: the cello's lament — a descending line through the whole chorus, under everything; contrabass doubles roots
  const lament = [74 - 12, 73 - 12, 71 - 12, 70 - 12];
  for (let bar = 4; bar < 19; bar++) {
    const m = bar < 8 ? [59, 55, 52, 57][bar - 4] : lament[(bar - 8) % 4];
    orch.push({ inst: 'celli', art: 'sus', midi: m - 12, time: s.t(bar), dur: s.bar * 0.98, vel: 0.75, stem: 'tears', pan: 0.25 });
    orch.push({ inst: 'contrabass', art: 'sus', midi: CH[h[bar][0]].root - 12 + (CH[h[bar][0]].root < 40 ? 12 : 0), time: s.t(bar), dur: s.bar * 0.98, vel: 0.6, stem: 'tears', pan: 0 });
  }
  orch.push({ inst: 'celli', art: 'sus', midi: 50, time: s.t(19), dur: 2.5, vel: 0.7, stem: 'tears', pan: 0.25 });
  orch.push({ inst: 'violins', art: 'sus', midi: 78, time: s.t(19), dur: 2.5, vel: 0.65, stem: 'happy', pan: -0.3 });
  const song = toSongHT(s, 'HAPPY TEARS — A BRASS RIFF', 'happy-a', [['intro', 0, 4], ['verse', 4, 8], ['chorus', 8, 19], ['outro', 19, 21]], h);
  return {
    id: 'A',
    title: 'BRASS RIFF',
    goal: '最もライブで盛り上がる。歪みギターとバリトンサックスが1つのリフを分け合う',
    bpm: 160,
    bars: 20,
    durationSec: lengthOf(s),
    sections: sectionsText(s, 'ギター (1–2拍) とバリトンサックス (3–4拍) が交互に1つのリフを作る'),
    chords: [
      { bars: '1–4 (イントロ)', chords: 'D – A/C♯ – Bm – G→Gm', why: '明るい I から下降ベース、最後の小節で G が Gm (同主短調からの借用 iv) に沈む' },
      { bars: '5–8 (Bメロ)', chords: 'Bm – G – Em – A', why: '酔っぱらった時計: 短調寄りで A に向かう' },
      { bars: '9–16 (サビ)', chords: 'D – A/C♯ – Bm – G→Gm ×2', why: 'Pattern A を元に、4小節目だけ G→Gm。「見上げて」の D を伸ばしたまま和音が一瞬だけ陰る' },
      { bars: '17–20 (ラスト)', chords: 'D – A/C♯ – G→Gm – D', why: '「ありがとう」の小節で Gm を通り、明るい D に着地' },
    ],
    riffs: [
      { name: 'RIFF A — BRASS RESPONSE', text: 'ギターが1–2拍に D5・m・D5・E5 を弾いて止まり、3–4拍の休符をバリトンサックスが A–C–D–A–D と埋める。サビでも TEARS の小節でサックスが答える' },
      { name: 'ストリングス', text: 'サビの間ずっと、バイオリン (スピッカート) がコードの音を2オクターブ上で8分の上昇アルペジオ' },
      { name: 'チェロの嘆き', text: 'サビの4小節ごとに D – C♯ – B – B♭ と半音ずつ下がる (明るい和音の下で泣き続ける)' },
    ],
    instrumentation: { happy: ['バイオリン (VSCO スピッカート・持続)', 'グロッケンシュピール', 'トランペット (スタッカート)', 'オーケストラヒット (弦+トランペット+トロンボーン+ティンパニ)'], tears: ['チェロ (VSCO)', 'コントラバス (VSCO)', 'バリトンサックス (SONOVA 物理モデル)'], band: ['歪みギター左右 (SONOVA 弦モデル)', 'ベース', 'ドラム (SONOVA モード合成)'] },
    song,
    orch,
    reeds,
    perc,
    morph: [],
    vocals: voices(s),
    discoveries: [{ name: 'サックスがギターの続きを弾く', text: 'ギターの休符にバリトンサックスが入ると、2つの楽器で1本のリフに聞こえる (と設計した)。サビでも TEARS の伸ばしの下でサックスが答え、悲しい低音が「返事」になる' }],
    hall: 0.35,
  };
}

/** an orchestra hit: string spiccato + trumpet + trombone staccato in octaves + a timpani stroke + crash */
function hitAt(orch: OrchNote[], perc: PercHit[], time: number, c: Chord) {
  for (const t of c.tones) {
    orch.push({ inst: 'violins', art: 'spic', midi: t + 24, time, dur: 0.2, vel: 1, stem: 'happy', pan: -0.3, gainDb: 3 });
    orch.push({ inst: 'trumpet', art: 'stac', midi: t + 12, time, dur: 0.2, vel: 1, stem: 'happy', pan: 0.2, gainDb: 2 });
    orch.push({ inst: 'trombone', art: 'stac', midi: t, time, dur: 0.2, vel: 1, stem: 'happy', pan: 0.1 });
  }
  perc.push({ kind: 'timpani', time, vel: 1, drive: 0, midi: c.root < 40 ? c.root + 12 : c.root });
}

// =====================================================================================================
// B — ORCHESTRA RIOT
// =====================================================================================================
export function demoHappyB(): HappyDemo {
  const s = new Score(156);
  const h: Harmony = {
    0: whole('Bm'), 1: whole('G'), 2: whole('D'), 3: whole('A'),
    4: whole('G'), 5: whole('D/F#'), 6: whole('Em'), 7: whole('A'),
    8: whole('Bm'), 9: whole('G'), 10: whole('D'), 11: whole('A'),
    12: whole('Bm'), 13: whole('G'), 14: whole('D'), 15: ['G', 'Gm'],
    16: whole('Bm'), 17: whole('G'), 18: ['G', 'Gm'], 19: whole('D'),
  };
  const orch: OrchNote[] = [];
  const reeds: ReedNote[] = [];
  const perc: PercHit[] = [];
  // RIFF B — DISTORTED PERCUSSION: timpani and low toms, saturated, hit together with the guitar on 3+3+2
  const grid = [0, 0.75, 1.5, 2.5, 3.25];
  for (let bar = 0; bar < 4; bar++) {
    const c = CH[h[bar][0]];
    const r = c.root < 40 ? c.root + 12 : c.root;
    for (const b of grid) {
      s.guitar(bar, b, pc(r), 0.5, { vel: 0.95 });
      perc.push({ kind: 'timpani', time: s.t(bar, b), vel: 0.9, drive: 0.7, midi: r });
      perc.push({ kind: 'tom', time: s.t(bar, b), vel: 0.8, drive: 0.6 });
    }
    s.bass(bar, 0, r - 12, 0.75);
    s.bass(bar, 0.75, r - 12, 0.75);
    s.bass(bar, 1.5, r - 12, 1);
    s.bass(bar, 2.5, r - 12 + 7, 0.75);
    s.bass(bar, 3.25, r - 12, 0.75);
    s.drums(bar, { snare: [1, 3], hat: [0, 1, 2, 3] }, 0.75);
    if (bar === 0) s.hit(0, 0, 'crash', 0.9);
  }
  // the strings and brass lead: horns state the hook melody's shape in the intro
  const hornLine: Array<[number, number, number, number]> = [[0, 0, 62, 1], [0, 1, 69, 2.5], [1, 0, 69, 1], [1, 1, 66, 1.5], [1, 2.5, 64, 1.5], [2, 0, 66, 2], [2, 2, 69, 2], [3, 0, 71, 2], [3, 2, 69, 2]];
  for (const [bar, b, m, d] of hornLine) orch.push({ inst: 'horn', art: 'sus', midi: m - 12, time: s.t(bar, b), dur: d * s.beat, vel: 0.85, stem: 'happy', pan: -0.15 });
  bandBase(s, h, 4, 8, { kick: [0, 2.5], snare: [2], hat: 'hat' });
  for (let bar = 4; bar < 8; bar++) {
    orch.push({ inst: 'violins', art: 'trem', midi: CH[h[bar][0]].tones[1] + 24, time: s.t(bar), dur: s.bar, vel: 0.55, stem: 'happy', pan: -0.4 });
    orch.push({ inst: 'violas', art: 'pizz', midi: CH[h[bar][0]].tones[0] + 12, time: s.t(bar, 1), dur: 0.3, vel: 0.6, stem: 'happy', pan: 0.3 });
    orch.push({ inst: 'violas', art: 'pizz', midi: CH[h[bar][0]].tones[2] + 12, time: s.t(bar, 3), dur: 0.3, vel: 0.6, stem: 'happy', pan: 0.3 });
  }
  perc.push({ kind: 'timpani', time: s.t(7, 2), vel: 0.6, drive: 0, midi: 45 });
  for (let k = 0; k < 8; k++) perc.push({ kind: 'timpani', time: s.t(7, 2 + k * 0.25), vel: 0.4 + k * 0.07, drive: 0.2, midi: 45 });
  // chorus: rock drums under a wide orchestra; violins soar in long lines, trumpets fanfare, timpani on downbeats
  bandBase(s, h, 8, 19, { kick: [0, 1.5, 2], snare: [1, 3], hat: 'ride' });
  for (let bar = 8; bar < 19; bar++) {
    const [c1, c2] = h[bar];
    for (const [b, d] of [[0, 1.5], [1.5, 1], [2.5, 1.5]] as const) {
      const c = CH[b < 2 ? c1 : c2];
      s.guitar(bar, b, pc(c.root < 40 ? c.root + 12 : c.root), d, { vel: 0.85 });
    }
    const c = CH[c1];
    orch.push({ inst: 'violins', art: 'sus', midi: c.tones[2] + 24, time: s.t(bar), dur: s.bar, vel: 0.85, stem: 'happy', pan: -0.4 });
    orch.push({ inst: 'violas', art: 'sus', midi: c.tones[0] + 24, time: s.t(bar), dur: s.bar, vel: 0.7, stem: 'happy', pan: 0.35 });
    orch.push({ inst: 'violin', art: 'sus', midi: c.tones[1] + 36 - (c.tones[1] + 36 > 90 ? 12 : 0), time: s.t(bar, 2), dur: s.beat * 2, vel: 0.75, stem: 'happy', pan: -0.1 });
    perc.push({ kind: 'timpani', time: s.t(bar), vel: 0.85, drive: 0.15, midi: c.root < 40 ? c.root + 12 : c.root });
    if (bar % 2 === 1) for (const [b, m] of [[2.5, 0], [3, 4], [3.5, 7]] as const) orch.push({ inst: 'trumpet', art: 'stac', midi: c.tones[0] + 24 + m, time: s.t(bar, b), dur: 0.15, vel: 0.85, stem: 'happy', pan: 0.25 });
    if ([8, 12, 16].includes(bar)) hitAt(orch, perc, s.t(bar), c);
    // TEARS: celli + contrabass + bass clarinet hold the lament line an octave apart
    const lament = [62, 61, 59, 58][(bar - 8) % 4];
    orch.push({ inst: 'celli', art: 'sus', midi: lament - 12, time: s.t(bar), dur: s.bar * 0.98, vel: 0.8, stem: 'tears', pan: 0.3 });
    orch.push({ inst: 'contrabass', art: 'sus', midi: (c.root < 40 ? c.root : c.root - 12), time: s.t(bar), dur: s.bar * 0.98, vel: 0.65, stem: 'tears', pan: 0 });
    reeds.push({ kind: 'bassClarinet', midi: lament - 24 + 12, time: s.t(bar, 0.5), dur: s.bar * 0.85, vel: 0.65, stem: 'tears', pan: -0.2 });
  }
  for (let bar = 4; bar < 8; bar++) {
    orch.push({ inst: 'celli', art: 'sus', midi: [55, 54, 52, 52][bar - 4] - 12 + 12, time: s.t(bar), dur: s.bar * 0.98, vel: 0.7, stem: 'tears', pan: 0.3 });
    reeds.push({ kind: 'bassClarinet', midi: [47, 45, 43, 45][bar - 4], time: s.t(bar), dur: s.bar * 0.9, vel: 0.6, stem: 'tears', pan: -0.2 });
  }
  s.drums(18, { tom1: [3], tom2: [3.25], tom3: [3.5, 3.75] }, 0.8);
  s.guitar(19, 0, pc(38), 5, { vel: 1 });
  s.bass(19, 0, 26, 4);
  s.drums(19, { kick: [0], crash: [0] }, 1);
  for (let k = 0; k < 10; k++) perc.push({ kind: 'timpani', time: s.t(19, k * 0.2), vel: 0.8 - k * 0.06, drive: 0, midi: 38 + 12 });
  orch.push({ inst: 'violins', art: 'sus', midi: 81, time: s.t(19), dur: 2.6, vel: 0.8, stem: 'happy', pan: -0.4 });
  orch.push({ inst: 'horn', art: 'sus', midi: 54, time: s.t(19), dur: 2.6, vel: 0.8, stem: 'happy', pan: -0.15 });
  orch.push({ inst: 'celli', art: 'sus', midi: 38, time: s.t(19), dur: 2.6, vel: 0.75, stem: 'tears', pan: 0.3 });
  const song = toSongHT(s, 'HAPPY TEARS — B ORCHESTRA RIOT', 'happy-b', [['intro', 0, 4], ['verse', 4, 8], ['chorus', 8, 19], ['outro', 19, 21]], h);
  return {
    id: 'B',
    title: 'ORCHESTRA RIOT',
    goal: '幸福と悲しみが最も同時に感じられる。弦と金管が前、ロックバンドが下で走る',
    bpm: 156,
    bars: 20,
    durationSec: lengthOf(s),
    sections: sectionsText(s, 'ティンパニとロータムを軽く歪ませ、ギターと 3+3+2 で同時に叩く。ホルンがフックの形を先に吹く'),
    chords: [
      { bars: '1–4 (イントロ)', chords: 'Bm – G – D – A', why: 'Pattern B (悲しみから浮上)。短調から始まり、D・A で明るさへ上がる' },
      { bars: '5–8 (Bメロ)', chords: 'G – D/F♯ – Em – A', why: '下降ベース (G–F♯–E) の上で時計が酔う' },
      { bars: '9–16 (サビ)', chords: 'Bm – G – D – A | Bm – G – D – G→Gm', why: '同じフックを短調の Bm で始め、「泣きながら」の最後で G→Gm に陰らせる' },
      { bars: '17–20 (ラスト)', chords: 'Bm – G – G→Gm – D', why: '最後は長調の D に浮かび上がる' },
    ],
    riffs: [
      { name: 'RIFF B — DISTORTED PERCUSSION', text: 'ギターのパワーコードとティンパニ・ロータムを同じ 3+3+2 のリズム (0, 0.75, 1.5, 2.5, 3.25 拍) で同時に。打楽器は 200 Hz より上だけ歪ませ、低音はきれいなまま分ける' },
      { name: 'ストリングスとブラス', text: 'サビは長い音のバイオリン・ビオラ・ソロバイオリン (高音)、TEARS の小節でトランペットのファンファーレ、各サビの頭でオーケストラヒット' },
      { name: '悲しみの低音', text: 'チェロとバスクラリネットが D – C♯ – B – B♭ の嘆きの線を1オクターブ違いで、コントラバスが和音の根音' },
    ],
    instrumentation: { happy: ['バイオリン・ビオラ (VSCO 持続・トレモロ・ピチカート)', 'ソロバイオリン (VSCO, 高音)', 'ホルン・トランペット (VSCO)', 'オーケストラヒット'], tears: ['チェロ (VSCO)', 'コントラバス (VSCO)', 'バスクラリネット (SONOVA 物理モデル)'], band: ['ギター', 'ベース', 'ドラム', 'ティンパニ (VSCO) とロータム (SONOVA) を歪ませた打楽器'] },
    song,
    orch,
    reeds,
    perc,
    morph: [],
    vocals: voices(s),
    discoveries: [{ name: '歪んだティンパニ', text: 'ティンパニの 200 Hz より上だけを歪ませると、低い胴鳴りはオーケストラのまま、アタックがギターのパワーコードと一体になる (帯域を分けた設計)' }],
    hall: 0.55,
  };
}

// =====================================================================================================
// C — BROKEN PARADE
// =====================================================================================================
export interface ParadeMutation {
  seed: string;
  /** the order in which the phrase is handed on (one instrument per bar of the intro) */
  relay: string[];
  /** materials of the SONOVA image instruments the phrase mutates through */
  materials: string[];
  /** a beat where the parade trips (tape-stop) before the last hook */
  trip: number;
  /** semitone the phrase is bent by when it mutates */
  bend: number;
}
export function paradeMutation(seed: string): ParadeMutation {
  const r = new Rng(`parade:${seed}`);
  const relayOptions = [['guitar', 'bariSax', 'pizz', 'image'], ['guitar', 'pizz', 'bassClarinet', 'image'], ['guitar', 'image', 'bariSax', 'pizz']];
  return {
    seed,
    relay: r.pick(relayOptions),
    materials: [r.pick(['metal', 'gravel', 'rust']), r.pick(['mosaic', 'citylights', 'ice', 'water'])],
    trip: r.pick([2, 3, 3.5]),
    bend: r.pick([-1, 1, 6]),
  };
}

export function demoHappyC(seed = 'parade-03'): HappyDemo {
  const s = new Score(158);
  const m = paradeMutation(seed);
  const h: Harmony = {
    0: whole('D'), 1: whole('F#m'), 2: whole('G'), 3: ['G', 'Gm'],
    4: whole('Bm'), 5: whole('G'), 6: whole('C'), 7: whole('A'),
    8: whole('D'), 9: whole('F#m'), 10: whole('G'), 11: ['G', 'Gm'],
    12: whole('D'), 13: whole('F#m'), 14: whole('Em7'), 15: ['G', 'Gm'],
    16: whole('D'), 17: whole('F#m'), 18: ['G', 'Gm'], 19: whole('D'),
  };
  const orch: OrchNote[] = [];
  const reeds: ReedNote[] = [];
  const perc: PercHit[] = [];
  const morph: MorphNote[] = [];
  // RIFF C — MUTATING ORCHESTRA: one parade phrase, handed on bar by bar and mutating
  const phrase: Array<[number, number, number]> = [[0, 0, 0.5], [0.5, 4, 0.5], [1, 7, 0.75], [1.75, 9, 0.25], [2, 7, 0.5], [2.5, 4, 0.5], [3, 2, 0.5], [3.5, 0, 0.5]];
  for (let bar = 0; bar < 4; bar++) {
    const c = CH[h[bar][0]];
    const root = c.root < 40 ? c.root + 12 : c.root;
    const who = m.relay[bar];
    const bend = bar === 3 ? m.bend : 0;
    for (const [b, iv, d] of phrase) {
      const midi = root + iv + bend;
      const t = s.t(bar, b);
      if (who === 'guitar') s.guitar(bar, b, [midi, midi + 7], d, { vel: 0.92 });
      else if (who === 'bariSax' || who === 'bassClarinet') reeds.push({ kind: who, midi: who === 'bariSax' ? midi - 12 : midi, time: t, dur: d * s.beat * 0.9, vel: 0.85, stem: 'tears', pan: 0.2 });
      else if (who === 'pizz') orch.push({ inst: 'celli', art: 'pizz', midi, time: t, dur: 0.3, vel: 0.9, stem: 'tears', pan: -0.25 }, { inst: 'violins', art: 'pizz', midi: midi + 24, time: t, dur: 0.3, vel: 0.8, stem: 'happy', pan: 0.3 });
      else morph.push({ material: m.materials[0], midi: midi + 12, time: t, dur: d * s.beat, vel: 0.8, timbre: -0.6 + b / 3 });
    }
    // the march: snare rolls on the off-beats, tuba oom-pah, kick on 1 and 3
    s.drums(bar, { kick: [0, 2], snare: [1, 1.25, 3, 3.25, 3.5] }, 0.75);
    orch.push({ inst: 'tuba', art: 'sus', midi: root - 12, time: s.t(bar, 0), dur: s.beat * 0.8, vel: 0.85, stem: 'tears', pan: 0 }, { inst: 'tuba', art: 'sus', midi: root - 5, time: s.t(bar, 2), dur: s.beat * 0.8, vel: 0.8, stem: 'tears', pan: 0 });
    for (const b of [1, 3]) perc.push({ kind: 'tom', time: s.t(bar, b), vel: 0.7, drive: 0.9 });
  }
  // B melody: a broken march — tuba, bass clarinet and pizzicato under the voice; glockenspiel giggles
  for (let bar = 4; bar < 8; bar++) {
    const c = CH[h[bar][0]];
    const r = c.root < 40 ? c.root + 12 : c.root;
    orch.push({ inst: 'tuba', art: 'sus', midi: r - 12, time: s.t(bar), dur: s.beat * 0.8, vel: 0.8, stem: 'tears', pan: 0 }, { inst: 'tuba', art: 'sus', midi: r - 5, time: s.t(bar, 2), dur: s.beat * 0.8, vel: 0.75, stem: 'tears', pan: 0 });
    for (const b of [1, 3]) orch.push({ inst: 'violins', art: 'pizz', midi: c.tones[1] + 24, time: s.t(bar, b), dur: 0.2, vel: 0.7, stem: 'happy', pan: 0.35 }, { inst: 'violins', art: 'pizz', midi: c.tones[2] + 24, time: s.t(bar, b + 0.5), dur: 0.2, vel: 0.65, stem: 'happy', pan: 0.35 });
    reeds.push({ kind: 'bassClarinet', midi: [54, 55, 52, 52][bar - 4], time: s.t(bar), dur: s.bar * 0.9, vel: 0.6, stem: 'tears', pan: -0.25 });
    s.drums(bar, { kick: [0, 2], snare: [1, 3, 3.5], hat: EIGHTHS }, 0.7);
    s.bass(bar, 0, r - 12, 1.5);
    s.bass(bar, 2, r - 12 + 7, 1.5);
    orch.push({ inst: 'glock', art: 'hit', midi: c.tones[2] + 36, time: s.t(bar, 3.5), dur: 1, vel: 0.6, stem: 'happy', pan: 0.4 });
  }
  // chorus: the band runs; guitars play the parade phrase in power fifths; the image instruments keep mutating
  bandBase(s, h, 8, 19, { kick: [0, 2, 2.5], snare: [1, 3], hat: 'hatOpen' });
  for (let bar = 8; bar < 19; bar++) {
    const [c1, c2] = h[bar];
    for (const [b, iv, d] of phrase) {
      const c = CH[b < 2 ? c1 : c2];
      const r = c.root < 40 ? c.root + 12 : c.root;
      s.guitar(bar, b, [r + (iv === 0 || iv === 7 ? iv : 0), r + (iv === 0 || iv === 7 ? iv : 0) + 7], d, { vel: 0.88 });
    }
    const c = CH[c1];
    orch.push({ inst: 'violins', art: 'sus', midi: c.tones[2] + 24, time: s.t(bar), dur: s.bar, vel: 0.75, stem: 'happy', pan: -0.4 });
    orch.push({ inst: 'glock', art: 'hit', midi: c.tones[(bar % 3)] + 36, time: s.t(bar, 0.5), dur: 1, vel: 0.65, stem: 'happy', pan: 0.4 });
    reeds.push({ kind: 'bariSax', midi: (c.root < 40 ? c.root + 12 : c.root) - 12, time: s.t(bar, 2.5), dur: s.beat * 0.45, vel: 0.85, stem: 'tears', pan: 0.25 }, { kind: 'bariSax', midi: (c.root < 40 ? c.root + 12 : c.root) - 5, time: s.t(bar, 3), dur: s.beat * 0.9, vel: 0.8, stem: 'tears', pan: 0.25 });
    orch.push({ inst: 'celli', art: 'sus', midi: [62, 61, 59, 58][(bar - 8) % 4] - 12, time: s.t(bar), dur: s.bar * 0.98, vel: 0.75, stem: 'tears', pan: 0.3 });
    orch.push({ inst: 'contrabass', art: 'pizz', midi: c.root < 40 ? c.root : c.root - 12, time: s.t(bar), dur: 0.4, vel: 0.85, stem: 'tears', pan: 0 });
    // the image instruments answer the hook with the phrase, mutating material bar by bar
    if ([9, 13, 17].includes(bar)) for (const [b, iv, d] of phrase.slice(4)) morph.push({ material: m.materials[(bar >> 2) % 2], midi: (c.root < 40 ? c.root + 12 : c.root) + iv + 24, time: s.t(bar, b), dur: d * s.beat, vel: 0.7, timbre: Math.sin(bar) });
    if ([8, 12, 16].includes(bar)) hitAt(orch, perc, s.t(bar), c);
    perc.push({ kind: 'tom', time: s.t(bar, 3.5), vel: 0.6, drive: 0.9 });
  }
  s.guitar(19, 0, pc(38), 5, { vel: 1 });
  s.bass(19, 0, 26, 4);
  s.drums(19, { kick: [0], crash: [0] }, 1);
  orch.push({ inst: 'tuba', art: 'sus', midi: 38, time: s.t(19), dur: 1.2, vel: 0.85, stem: 'tears', pan: 0 });
  orch.push({ inst: 'glock', art: 'hit', midi: 86, time: s.t(19, 1), dur: 2, vel: 0.7, stem: 'happy', pan: 0.4 });
  const song = toSongHT(s, 'HAPPY TEARS — C BROKEN PARADE', `happy-c:${seed}`, [['intro', 0, 4], ['verse', 4, 8], ['chorus', 8, 19], ['outro', 19, 21]], h);
  return {
    id: 'C',
    title: 'BROKEN PARADE',
    goal: '最も予想外で、もう一度聴きたくなる。行進曲が何度もつまずく',
    bpm: 158,
    bars: 20,
    durationSec: lengthOf(s),
    sections: sectionsText(s, `1つのフレーズが小節ごとに ${m.relay.join(' → ')} へ受け渡される (種 ${seed})`),
    chords: [
      { bars: '1–4 (イントロ)', chords: 'D – F♯m – G – G→Gm', why: 'Pattern C (未解決の幸福) をそのまま行進曲に' },
      { bars: '5–8 (Bメロ)', chords: 'Bm – G – C – A', why: 'C は D の ♭VII (同主短調からの借用)。酔った時計が一瞬違う調に迷い込む' },
      { bars: '9–16 (サビ)', chords: 'D – F♯m – G – G→Gm | D – F♯m – Em7 – G→Gm', why: '「空を見上げて」「明日を鳴らす」の最後で G→Gm' },
      { bars: '17–20 (ラスト)', chords: 'D – F♯m – G→Gm – D', why: '' },
    ],
    riffs: [
      { name: 'RIFF C — MUTATING ORCHESTRA', text: `パレードのフレーズ (根音・3度・5度・6度…の8音) を、イントロの4小節で ${m.relay.join(' → ')} の順に受け渡す。4小節目は ${m.bend > 0 ? '+' : ''}${m.bend} 半音ずれる。サビでは SONOVA の画像楽器 (${m.materials.join(' → ')}) が答える` },
      { name: '歪んだ打楽器', text: '行進曲の裏拍でロータムを強く歪ませ (低域はそのまま)、スネアのロール' },
      { name: '低音管楽器', text: 'チューバのオンパ (VSCO) と、バリトンサックス・バスクラリネット (SONOVA 物理モデル)' },
    ],
    instrumentation: { happy: ['バイオリン (VSCO 持続・ピチカート)', 'グロッケンシュピール', 'オーケストラヒット', 'SONOVA 画像楽器 (変異する音色)'], tears: ['チェロ (VSCO 持続・ピチカート)', 'コントラバス (VSCO ピチカート)', 'チューバ (VSCO)', 'バリトンサックス・バスクラリネット (SONOVA 物理モデル)'], band: ['ギター', 'ベース', '行進曲のドラム', '歪ませたロータム'] },
    song,
    orch,
    reeds,
    perc,
    morph,
    vocals: voices(s),
    discoveries: [{ name: 'つまずく行進曲', text: `最後のフックの前 (16小節目の ${m.trip + 1} 拍目から) でバンドがテープストップしてつまずき、次の小節で何もなかったように立ち直る`, seed, settings: { ...m } }],
    hall: 0.4,
    tapeStop: [s.t(15, m.trip), s.t(16)],
  };
}

function lengthOf(s: Score): number {
  return Math.round((s.t(19) + 1.7) * 100) / 100;
}
function sectionsText(s: Score, intro: string) {
  return [
    { name: 'イントロ', from: 0, to: 4, text: intro },
    { name: 'Bメロ', from: 4, to: 8, text: '「止まった時計が 酔っぱらって / 昨日と明日を 飲み干した」' },
    { name: 'サビ', from: 8, to: 16, text: 'HAPPY〜! TEAR〜S! ×2 — 笑いながら空を見上げて / 泣きながら明日を鳴らす' },
    { name: 'ラスト', from: 16, to: 20, text: 'HAPPY〜! TEAR〜S! と「ありがとう」、明るい D で終わる' },
  ].map((x) => ({ ...x, start: Math.round(s.t(x.from) * 100) / 100, end: Math.round(Math.min(s.t(x.to), lengthOf(s)) * 100) / 100 }));
}
function toSongHT(s: Score, title: string, seed: string, sections: Array<[string, number, number]>, h: Harmony): RockSong {
  void h;
  return {
    engine_version: HAPPY_TEARS_VERSION,
    seed,
    title,
    bpm: s.bpm,
    barSec: s.bar,
    durationSec: lengthOf(s) + 1.5,
    key: { root_pc: 2, mode: 'major', scale: [0, 2, 4, 5, 7, 9, 11] },
    tuning: 'drop D',
    sections: sections.map(([name, a, b]) => ({ name, startBar: a, bars: b - a, start: s.t(a), end: s.t(b), description: '' })),
    riff: Array.from({ length: 16 }, (_, k) => ({ kind: k % 4 === 0 ? 'pc' : k % 2 ? 'rest' : 'mute', off: 0 }) as RockSong['riff'][number]),
    riffText: '',
    hook: [],
    progressions: {},
    caRules: [],
    derivations: [],
    events: [...s.events].sort((a, b) => a.time - b.time || a.id - b.id),
    stats: { byPart: {}, byRule: {}, maxDepth: 1 },
    chains: [],
  };
}

export function happyTearsDemos(seedC?: string): HappyDemo[] {
  return [demoHappyA(), demoHappyB(), demoHappyC(seedC)];
}
