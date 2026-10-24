/**
 * The PSYLO opening announcement by several English voices, dry then through the megaphone, to choose by ear.
 *   PIPER_BIN=… PIPER_MODEL=…/en-us-libritts-high.onnx npm run psylo:announcers
 * Pick one with PIPER_SPEAKER=<id> for `npm run psylo`.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { megaphone, PSYLO_LYRICS } from '@sonova/composition-engine';
import { ROOT, writeStereoWav } from './lib.ts';
import { speakEnglish } from './lib-tts.ts';

const SR = 44100;
// LibriTTS speakers with a low (male) speaking pitch, measured: 3 ≈ 86 Hz, 49 ≈ 82 Hz, 42 ≈ 83 Hz, 27 ≈ 86 Hz
const takes = [...[3, 49, 42, 27].map((speaker) => speakEnglish(PSYLO_LYRICS.intro, SR, { speaker, engine: 'piper' })), speakEnglish(PSYLO_LYRICS.intro, SR, { engine: 'espeak' })];
const parts: Float32Array[] = [];
const order: string[] = [];
for (const t of takes)
  for (const fx of ['dry', 'megaphone'] as const) {
    const y = fx === 'dry' ? t.x : megaphone(t.x, SR, 1);
    let p = 0;
    for (const s of y) p = Math.max(p, Math.abs(s));
    order.push(`${t.engine} (${fx}) @ ${(parts.reduce((s, q) => s + q.length, 0) / SR).toFixed(1)} s`);
    parts.push(y.map((s) => (s / (p || 1)) * 0.7), new Float32Array(Math.round(0.6 * SR)));
  }
const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
let o = 0;
for (const p of parts) {
  out.set(p, o);
  o += p.length;
}
const base = join(ROOT, 'output/psylo/ZIG-PSYLO-0001-announcers');
writeStereoWav(`${base}.wav`, { left: out, right: out, sampleRate: SR }, 'announcers');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '192k', `${base}.mp3`]);
console.log(order.join('\n'));
