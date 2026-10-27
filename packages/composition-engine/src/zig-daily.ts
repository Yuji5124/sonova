/**
 * ZIG daily song — the plan for one original instrumental rock song per (Japan-time) day.
 *
 * Pure and deterministic: the same date stamp always yields the same work number, seed, title, key and tempo,
 * so a re-run on the same day can recognise "already done" by name alone (no clock, no Math.random).
 * Everything here is free and local: no cloud AI, no API keys, no GPU. (Vocals, when asked for, use the built-in singer
 * or a local VOICEVOX Engine — see scripts/lib-zig-vocal.ts.)
 *
 * Naming (see docs/zig-daily.md):
 *   stamp        261027                       YYMMDD in Asia/Tokyo
 *   work number  ZIG-DAILY-261027             (a 2nd song the same day: ZIG-DAILY-261027-02)
 *   display name 261027_ZIG_STATIC BLOOM      SOUNDVAULT `name`
 *   file stem    261027_ZIG_static-bloom      public/sounds/bgm/<stem>.ogg
 */
import { Rng } from '@sonova/instrument-dna';
import type { RockOptions } from '@sonova/music-generator';
import { romajiProblems, romajiToMorae, type SongLyrics } from './series/toyriot.ts';

export const ZIG_DAILY_VERSION = 'sonova-zig-daily/1.0.0';
export const ZIG_DAILY_TIMEZONE = 'Asia/Tokyo';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** YYMMDD of `now` in Japan Standard Time (not the machine's local zone). */
export function jstStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZIG_DAILY_TIMEZONE, year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/** `261027` → `2026-10-27`; null if it is not a real calendar date. */
export function stampToIso(stamp: string): string | null {
  if (!/^\d{6}$/.test(stamp)) return null;
  const y = 2000 + Number(stamp.slice(0, 2));
  const m = Number(stamp.slice(2, 4));
  const d = Number(stamp.slice(4, 6));
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const isStamp = (stamp: string): boolean => stampToIso(stamp) !== null;

const ADJECTIVES = [
  'STATIC', 'NEON', 'HOLLOW', 'BROKEN', 'ELECTRIC', 'PAPER', 'MIDNIGHT', 'TIN', 'VELVET', 'SILENT', 'RUSTED', 'GLASS',
  'PHANTOM', 'WILD', 'PLASTIC', 'COSMIC', 'LOUD', 'PALE', 'SCARLET', 'CRACKED', 'BURNING', 'FALLING', 'TINY', 'LAST',
  'SECOND', 'ELASTIC', 'DIGITAL', 'MAGNETIC', 'FEVERISH', 'LUNAR', 'ATOMIC', 'RADIO', 'TELEVISED', 'SPIRAL', 'FROZEN', 'SIGNAL',
];
const NOUNS = [
  'BLOOM', 'CIRCUS', 'PARADE', 'ORBIT', 'ALARM', 'GARDEN', 'MACHINE', 'ECHO', 'VOLTAGE', 'CAROUSEL', 'SKYLINE', 'HEARTBEAT',
  'LANTERN', 'STATION', 'COMET', 'MIRROR', 'TRIGGER', 'RIOT', 'HARBOR', 'SPARK', 'ENGINE', 'THEATER', 'ROOM', 'CHORUS',
  'ANTENNA', 'WAVEFORM', 'FIREWORK', 'SATELLITE', 'FREQUENCY', 'VELOCITY', 'DREAM', 'TOWER', 'FACTORY', 'AQUARIUM', 'METEOR', 'PLAYGROUND',
];
/** Titles of existing works by others that a generated title must never equal. A small guard, not a catalogue. */
const TITLE_DENYLIST = new Set(['ROCKET DIVE', 'PINK SPIDER', 'HURRY GO ROUND', 'TELL ME', 'BEAUTY & STUPID', 'EVER FREE', 'MISERY', 'FLAME', 'DICE', 'DOUBT']);

export const ZIG_DAILY_TITLE_SPACE = ADJECTIVES.length * NOUNS.length;

/** The first free title for this seed: a seeded two-word English title that is not taken and not on the denylist. */
export function zigTitleFor(seed: string, takenNames: ReadonlySet<string> = new Set(), stamp = ''): string {
  const rng = new Rng(`zig-daily-title:${seed}`);
  const taken = new Set([...takenNames].map((n) => n.toUpperCase()));
  const isTaken = (title: string) => TITLE_DENYLIST.has(title) || taken.has(title) || taken.has(`${stamp}_ZIG_${title}`.toUpperCase());
  for (let i = 0; i < 400; i++) {
    const title = `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
    if (!isTaken(title)) return title;
  }
  // The title space is nearly exhausted: keep going with a number so a name is never reused.
  for (let n = 2; ; n++) {
    const title = `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)} ${n}`;
    if (!isTaken(title)) return title;
  }
}

/** lower-case ASCII slug for file names */
export function zigSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * What the song is based on, and what it is not. Recorded with every song.
 * The user's brief was "based on hide's songs": that is realised only as production ideas and general musical
 * features — never as a copy of any existing melody, lyric, recording or voice.
 */
export const ZIG_DAILY_REFERENCES = {
  brief: 'ユーザー指示: 「hideさんの曲をベースに」ZIG名義のオリジナル曲を毎日1曲',
  basis: [
    'PSYENCE WORKSHOP の制作上の考え方 (SONOVA の experiments/psylo/REPORT.md と experiments/toyriot/REPORT.md に記録された ZIG-PSYLO-0001 / TOYRIOT の作り方)',
    '90年代後半の日本のインダストリアル/オルタナ・ポップロックに共通する一般的な音楽的特徴: 重いドロップチューニングのギターと主音のパワーコード、トライトーンと短2度の混じる角のある響き、小節をまたぐ変則アクセントのリフ',
  ],
  techniques: [
    'ポリメーター: 5ステップのセル Rm.Pm を小節線をまたいで流す (TidalCycles の考え方)',
    'ユークリッドリズムの毎小節回転 (Toussaint / Strudel の iter の考え方)',
    '3+3+3+3+2+2 のアクセント、32分のスタッター',
  ],
  noCopying: '既存曲の旋律・歌詞・音源・声は一切使用していない。音は SONOVA が自作の画像素材から合成し、旋律・リフ・フックはシード (zig-daily-YYMMDD) から新たに生成した。歌詞と歌声はなし (インストゥルメンタル)。',
};

/** References for a sung song: the same production ideas, plus how the words and the voice were made. */
export function zigDailyReferences(sung: boolean) {
  if (!sung) return ZIG_DAILY_REFERENCES;
  return {
    ...ZIG_DAILY_REFERENCES,
    basis: [...ZIG_DAILY_REFERENCES.basis, '歌入りの作り方: SONOVA-TOYRIOT-0001 / ZIG-PSYLO-0001 / ZIG-HAPPY-TEARS と同じ (メガホンのAメロ、ロックボーカル処理のサビ)'],
    noCopying: '既存曲の旋律・歌詞・音源・声は一切使用していない。音は SONOVA が自作の画像素材から合成し、旋律・リフ・フックはシード (zig-daily-YYMMDD) から新たに生成した。歌詞はこの日のために新しく書いたオリジナル。歌声は VOICEVOX の合成音声 (または SONOVA 内蔵の歌手) で、実在の歌手の声ではない。',
  };
}

export interface ZigDailyPlan {
  version: string;
  /** YYMMDD (Asia/Tokyo) */
  stamp: string;
  /** 2026-10-27 */
  dateIso: string;
  timezone: string;
  /** 1 = the day's song; 2.. only when an extra song is explicitly allowed */
  sequence: number;
  workNumber: string;
  seed: string;
  title: string;
  /** SOUNDVAULT `name`: YYMMDD_ZIG_<title> */
  displayName: string;
  /** file name without extension: YYMMDD_ZIG_<slug> */
  fileStem: string;
  bpm: number;
  rootPc: number;
  key: string;
  rockOptions: RockOptions;
}

export const BPM_RANGE: readonly [number, number] = [112, 168];

/** A title written by the lyricist (English, upper case): letters, digits and a few marks, 2–40 characters. */
export const ZIG_TITLE_RE = /^[A-Z0-9][A-Z0-9 '&!?.-]{1,39}$/;

export function zigDailyPlan(stamp: string, opts: { sequence?: number; takenNames?: Iterable<string>; title?: string } = {}): ZigDailyPlan {
  const dateIso = stampToIso(stamp);
  if (!dateIso) throw new Error(`日付スタンプが不正です (YYMMDD): ${stamp}`);
  const sequence = opts.sequence ?? 1;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) throw new Error(`sequence が不正です: ${sequence}`);
  const suffix = sequence === 1 ? '' : `-${String(sequence).padStart(2, '0')}`;
  const seed = `zig-daily-${stamp}${suffix}`;
  const rng = new Rng(`zig-daily:${seed}`);
  const rootPc = rng.int(0, 11);
  const bpm = rng.int(BPM_RANGE[0], BPM_RANGE[1]);
  const key = `${NOTE_NAMES[rootPc]} minor`;
  const taken = new Set([...(opts.takenNames ?? [])].map((n) => n.toUpperCase()));
  let title: string;
  if (opts.title !== undefined) {
    // a title chosen with the lyrics: it must be well-formed, not on the denylist and not already used
    if (!ZIG_TITLE_RE.test(opts.title)) throw new Error(`曲名が不正です (英大文字・数字・一部の記号、2〜40文字): ${opts.title}`);
    if (TITLE_DENYLIST.has(opts.title) || taken.has(opts.title) || taken.has(`${stamp}_ZIG_${opts.title}`)) throw new Error(`曲名が既に使われています (または使用禁止): ${opts.title}`);
    title = opts.title;
  } else title = zigTitleFor(seed, new Set(opts.takenNames ?? []), stamp);
  return {
    version: ZIG_DAILY_VERSION,
    stamp,
    dateIso,
    timezone: ZIG_DAILY_TIMEZONE,
    sequence,
    workNumber: `ZIG-DAILY-${stamp}${suffix}`,
    seed,
    title,
    displayName: `${stamp}_ZIG_${title}`,
    fileStem: `${stamp}_ZIG_${zigSlug(title) || 'untitled'}${sequence === 1 ? '' : `_${String(sequence).padStart(2, '0')}`}`,
    bpm,
    rootPc,
    key,
    rockOptions: {
      rootPc: { value: rootPc, reason: `日付シード ${seed} から決めた主音 (${key})。最低弦を主音まで下げたドロップチューニングで重く鳴らす` },
      bpm: { value: bpm, reason: `日付シード ${seed} から決めたテンポ (${BPM_RANGE[0]}–${BPM_RANGE[1]} BPM の範囲)` },
    },
  };
}

// ---- vocals: original lyrics written for the day's song --------------------------------------------------
export const ZIG_LYRIC_SECTIONS = ['verse1', 'verse2', 'pre', 'chorus'] as const;
export type ZigLyricSection = (typeof ZIG_LYRIC_SECTIONS)[number];

/**
 * The lyrics file of one day's vocal song (JSON). The words are written fresh for the day (by Claude, in the
 * scheduled run) — never copied from an existing song.
 *   romaji   what is sung. Syllables split by '-', words by ' ', lines by '/'. Long vowels are written twice (o-o).
 *            Only the syllables of SONOVA's singer: a i u e o, ka… ga… sa shi su se so, za ji zu ze zo, ta chi tsu te to,
 *            da de do, na…, ha hi fu he ho, ba… pa…, ma…, ya yu yo, ra…, wa wo, n, sha shu sho cha chu cho ja ju jo;
 *            a lone p / t / k is a held stop (small っ).
 *   text     the same words in Japanese, for the record and for readers
 *   title    optional English title (upper case); otherwise the seeded one
 */
export interface ZigLyrics {
  title?: string;
  romaji: Record<ZigLyricSection, string> & { intro?: string };
  text: Record<ZigLyricSection, string> & { intro?: string };
  /** who wrote the words: recorded as is */
  author: string;
}

export interface LyricsCheck {
  ok: boolean;
  problems: string[];
  lyrics?: ZigLyrics;
}

const MIN_MORAE = 6;
const MAX_MORAE = 90;

/** Validate untrusted JSON as lyrics. Nothing is repaired or guessed: every problem is listed. */
export function checkZigLyrics(input: unknown): LyricsCheck {
  const problems: string[] = [];
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const romaji = rec(o.romaji);
  const text = rec(o.text);
  if (typeof o.author !== 'string' || !o.author.trim() || o.author.length > 80) problems.push('author (作詞者) が必要です (80文字まで)');
  if (o.title !== undefined && (typeof o.title !== 'string' || !ZIG_TITLE_RE.test(o.title))) problems.push('title は英大文字・数字・一部の記号の2〜40文字にしてください');
  const sections: Array<ZigLyricSection | 'intro'> = [...ZIG_LYRIC_SECTIONS, ...(romaji.intro !== undefined || text.intro !== undefined ? (['intro'] as const) : [])];
  for (const k of sections) {
    const r = romaji[k];
    const t = text[k];
    if (typeof r !== 'string' || !r.trim()) {
      problems.push(`romaji.${k} がありません`);
      continue;
    }
    if (!/^[A-Za-z' \-/]+$/.test(r)) problems.push(`romaji.${k} は英字・ハイフン・スペース・スラッシュだけにしてください`);
    else {
      const bad = romajiProblems(r);
      if (bad.length) problems.push(`romaji.${k} に歌えない音節があります: ${[...new Set(bad)].join(', ')}`);
      const n = romajiToMorae(r).morae.length;
      const max = k === 'intro' ? 24 : MAX_MORAE;
      const min = k === 'intro' ? 3 : MIN_MORAE;
      if (n < min || n > max) problems.push(`romaji.${k} は ${min}〜${max} 音で書いてください (今 ${n} 音)`);
    }
    if (typeof t !== 'string' || !t.trim() || t.length > 400) problems.push(`text.${k} (日本語の歌詞) が必要です (400文字まで)`);
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    problems,
    lyrics: {
      ...(o.title !== undefined ? { title: o.title as string } : {}),
      romaji: Object.fromEntries(sections.map((k) => [k, (romaji[k] as string).trim()])) as ZigLyrics['romaji'],
      text: Object.fromEntries(sections.map((k) => [k, (text[k] as string).trim()])) as ZigLyrics['text'],
      author: (o.author as string).trim(),
    },
  };
}

/** The singer's words of a lyrics file, in the shape the vocal plan wants. */
export const songLyricsOf = (l: ZigLyrics): SongLyrics => ({ verse1: l.romaji.verse1, verse2: l.romaji.verse2, pre: l.romaji.pre, chorus: l.romaji.chorus });
