/**
 * The first chorus line of "Tin Wings Riot" sung by each male VOICEVOX voice, dry then with the rock chain,
 * to choose the lead by ear.   npm run toyriot:voices   (needs a running VOICEVOX Engine)
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { megaphone, rockVocal, setKana, toyRiotSong, toyRiotVocalPlan } from '@sonova/composition-engine';
import { ROOT, buildInstruments, writeStereoWav } from './lib.ts';
import { MALE_VOICES, singLine, voicevoxAvailable } from './lib-voicevox.ts';

if (!(await voicevoxAvailable())) throw new Error('VOICEVOX Engine が起動していません (127.0.0.1:50021)');
const { dnas } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const seed = 'sonova-toyriot-0001';
const line = toyRiotVocalPlan(toyRiotSong({ guitar: bark, drums: tower, voice: sunset }, seed), seed).find((l) => l.section === 'chorus1')!;
const SR = 44100;
const kana = setKana(line.melody, line.text).map((n) => ({ ...n, time: n.time - line.offset })).filter((n) => n.time < 6.3);
const parts: Float32Array[] = [];
const order: string[] = [];
for (const [key, v] of Object.entries(MALE_VOICES)) {
  const { x } = await singLine(kana, 6.8, SR, v.id);
  for (const fx of ['dry', 'rock', 'megaphone'] as const) {
    const y = fx === 'dry' ? x : fx === 'rock' ? rockVocal(x, SR, 1) : megaphone(x, SR, 0.85);
    let p = 0;
    for (const s of y) p = Math.max(p, Math.abs(s));
    parts.push(y.map((s) => (s / (p || 1)) * 0.7), new Float32Array(Math.round(0.5 * SR)));
    order.push(`${v.name} (${fx})`);
  }
  void key;
}
const total = parts.reduce((s, p) => s + p.length, 0);
const out = new Float32Array(total);
let o = 0;
for (const p of parts) {
  out.set(p, o);
  o += p.length;
}
const base = join(ROOT, 'output/toyriot/SONOVA-TOYRIOT-0001-voices');
writeStereoWav(`${base}.wav`, { left: out, right: out, sampleRate: SR }, seed);
try {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '192k', `${base}.mp3`]);
} catch {
  /* no ffmpeg */
}
const seg = 6.8 + 0.5;
console.log(order.map((n, i) => `${Math.floor((i * seg) / 60)}:${String(Math.floor((i * seg) % 60)).padStart(2, '0')} ${n}`).join('\n'));
