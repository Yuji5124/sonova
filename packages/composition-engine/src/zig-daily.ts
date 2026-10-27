/**
 * ZIG daily song — the plan for one original instrumental rock song per (Japan-time) day.
 *
 * Pure and deterministic: the same date stamp always yields the same work number, seed, title, key and tempo,
 * so a re-run on the same day can recognise "already done" by name alone (no clock, no Math.random).
 * Everything here is free and local: no cloud AI, no API keys, no GPU, no voice engines.
 *
 * Naming (see docs/zig-daily.md):
 *   stamp        261027                       YYMMDD in Asia/Tokyo
 *   work number  ZIG-DAILY-261027             (a 2nd song the same day: ZIG-DAILY-261027-02)
 *   display name 261027_ZIG_STATIC BLOOM      SOUNDVAULT `name`
 *   file stem    261027_ZIG_static-bloom      public/sounds/bgm/<stem>.ogg
 */
import { Rng } from '@sonova/instrument-dna';
import type { RockOptions } from '@sonova/music-generator';

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

export function zigDailyPlan(stamp: string, opts: { sequence?: number; takenNames?: Iterable<string> } = {}): ZigDailyPlan {
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
  const title = zigTitleFor(seed, new Set(opts.takenNames ?? []), stamp);
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
