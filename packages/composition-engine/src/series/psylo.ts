/**
 * ZIG — PSYLO (サイロ, Psyche × Glow): the PSYENCE WORKSHOP chorus (Pattern A, 160 BPM, hook サ・イーー・ロー)
 * grown into a full song on the TOYRIOT production (radio intro, megaphone verses, gang-vocal choruses).
 * Everything is original. The chorus notes are Pattern A / SHORT from PSYENCE-WORKSHOP src/psylo-vocal.json.
 */
import { generateRock, type RockSong } from '@sonova/music-generator';
import type { KanaNote, VocalLine } from './toyriot.ts';

export const PSYLO_VERSION = 'sonova-psylo/1.0.0';

/** original words (romaji, syllables split by '-', lines by '/') — after the PSYLO story: a show behind closed eyes */
export const PSYLO_LYRICS = {
  // 閉じたまぶたの裏側で / 誰も知らない幕が上がる
  verse1: 'to-ji-ta ma-bu-ta no / u-ra ga-wa de / da-re mo shi-ra-na-i / ma-ku ga a-ga-ru',
  // 不安も怒りも 鏡の前 / 楽しさも涙も 並んで
  verse2: 'fu-a-n mo i-ka-ri mo / ka-ga-mi no ma-e / ta-no-shi-sa mo / na-mi-da mo na-ra-n-de',
  // 音になれ / もっと外へ
  pre: 'o-to ni na-re / mo-t-to so-to e',
  // まもなく ショーが始まります
  intro: 'ma-mo-na-ku / sho o ga ha-ji-ma-ri-ma-su',
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
