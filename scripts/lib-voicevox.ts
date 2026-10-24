/**
 * Sing a line with a local VOICEVOX Engine (song API, CPU only).
 *   https://github.com/VOICEVOX/voicevox_engine — start it (e.g. `run --port 50021`), or keep the VOICEVOX app open.
 * Pitch/timing/phonemes come from the singing style 6000 (波音リツ); the voice is any frame_decode style.
 * Every voice needs a credit when the audio is shared, e.g. "VOICEVOX:玄野武宏".
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeWav } from '@sonova/composition-engine';
import type { KanaNote } from '@sonova/composition-engine';

export const VOICEVOX_URL = process.env.VOICEVOX_URL ?? 'http://127.0.0.1:50021';
export const SING_QUERY_STYLE = 6000;

export const MALE_VOICES: Record<string, { id: number; name: string; credit: string }> = {
  takehiro: { id: 3011, name: '玄野武宏 ノーマル', credit: 'VOICEVOX:玄野武宏' },
  takehiroTsun: { id: 3040, name: '玄野武宏 ツンギレ', credit: 'VOICEVOX:玄野武宏' },
  kotarouOko: { id: 3034, name: '白上虎太郎 おこ', credit: 'VOICEVOX:白上虎太郎' },
  kenzaki: { id: 3021, name: '剣崎雌雄 ノーマル', credit: 'VOICEVOX:剣崎雌雄' },
  wakamatsu: { id: 3052, name: '雀松朱司 ノーマル', credit: 'VOICEVOX:雀松朱司' },
  kigashima: { id: 3053, name: '麒ヶ島宗麟 ノーマル', credit: 'VOICEVOX:麒ヶ島宗麟' },
};

export async function voicevoxAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${VOICEVOX_URL}/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  const r = await fetch(`${VOICEVOX_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`VOICEVOX ${path}: HTTP ${r.status} ${await r.text()}`);
  return r;
}

/**
 * Notes with times relative to the take's sample 0 → a mono take at `sr`, `seconds` long.
 * Frame boundaries are rounded from absolute time, so the ±5 ms rounding never accumulates.
 * `cents` detunes the whole line through the query's f0 (VOICEVOX notes are whole semitones).
 */
/**
 * The singing query (pitch curve, phoneme timing) is NOT deterministic in VOICEVOX — two identical
 * requests give slightly different curves — while synthesis from a fixed query is. So queries are
 * frozen to `cacheDir` (one JSON per score) and reused: same score → same audio, every time.
 */
export async function singLine(notes: KanaNote[], seconds: number, sr: number, styleId: number, o: { transpose?: number; cents?: number; delay?: number; cacheDir?: string; label?: string } = {}): Promise<{ x: Float32Array; phonemes: string[] }> {
  const fps = 93.75;
  const shift = o.delay ?? 0;
  const fr = (t: number) => Math.round((t + shift) * fps);
  const score: Array<{ key: number | null; frame_length: number; lyric: string; id?: string }> = [];
  // frame boundaries: a gap shorter than 4 frames (≈43 ms) is sung legato (the engine cannot place
  // a consonant in a 1–2 frame rest); every note is at least 3 frames
  const MIN_REST = 4;
  const MIN_NOTE = 3;
  let cursorF = fr(0);
  score.push({ key: null, frame_length: 0, lyric: '' });
  notes.forEach((n, i) => {
    let s0 = Math.max(fr(n.time), cursorF);
    const next = notes[i + 1];
    let e0 = Math.max(s0 + MIN_NOTE, fr(n.time + n.duration));
    if (next && fr(next.time) - e0 < MIN_REST) e0 = Math.max(s0 + MIN_NOTE, fr(next.time));
    const gap = s0 - cursorF;
    if (gap > 0) {
      if (gap < MIN_REST && score.length > 1) {
        score[score.length - 1].frame_length += gap; // extend the previous note
      } else score[score.length - 1].key === null ? (score[score.length - 1].frame_length += gap) : score.push({ key: null, frame_length: gap, lyric: '' });
    }
    s0 = cursorF + gap;
    score.push({ id: `n${i}`, key: n.midi + (o.transpose ?? 0), frame_length: e0 - s0, lyric: n.lyric });
    cursorF = e0;
  });
  if (score[0].frame_length === 0) score[0].frame_length = 1;
  const cursor = cursorF / fps - shift;
  score.push({ key: null, frame_length: Math.max(1, Math.round(Math.max(0.5, seconds - cursor) * fps)), lyric: '' });
  const body = JSON.stringify({ notes: score });
  const hash = createHash('sha256').update(`${SING_QUERY_STYLE}:${body}`).digest('hex').slice(0, 12);
  const file = o.cacheDir ? join(o.cacheDir, `${o.label ?? 'line'}-${hash}.json`) : '';
  let query;
  if (file && existsSync(file)) query = JSON.parse(readFileSync(file, 'utf8'));
  else {
    query = await (await post(`/sing_frame_audio_query?speaker=${SING_QUERY_STYLE}`, { notes: score })).json();
    if (file) {
      mkdirSync(o.cacheDir!, { recursive: true });
      const r = (x: number, d: number) => Math.round(x * d) / d;
      writeFileSync(file, JSON.stringify({ ...query, f0: query.f0.map((x: number) => r(x, 100)), volume: query.volume.map((x: number) => r(x, 10000)) }));
      query = JSON.parse(readFileSync(file, 'utf8'));
    }
  }
  if (o.cents) query.f0 = query.f0.map((f: number) => f * Math.pow(2, o.cents! / 1200));
  const wav = new Uint8Array(await (await post(`/frame_synthesis?speaker=${styleId}`, query)).arrayBuffer());
  const d = decodeWav(wav);
  const src = d.data[0];
  // resample (cubic Hermite) to the render's rate
  const ratio = d.sampleRate / sr;
  const x = new Float32Array(Math.ceil(seconds * sr));
  for (let i = 0; i < x.length; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    const y0 = src[k - 1] ?? 0;
    const y1 = src[k] ?? 0;
    const y2 = src[k + 1] ?? 0;
    const y3 = src[k + 2] ?? 0;
    x[i] = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
  }
  return { x, phonemes: query.phonemes.map((p: { phoneme: string }) => p.phoneme) };
}
