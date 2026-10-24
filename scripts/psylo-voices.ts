/**
 * The PSYLO hook (chorus bars 5–8: 胸の奥 ショーが始まる 光れ サイロー) sung by each male VOICEVOX voice —
 * dry, then the rock chain, then the megaphone — to choose the lead by ear. At the end: the engine's own
 * pitch vs the stabilised pitch on the same voice.   npm run psylo:voices   (needs a running VOICEVOX Engine)
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { megaphone, psyloSong, psyloVocalPlan, rockVocal } from '@sonova/composition-engine';
import { ROOT, buildInstruments, writeStereoWav } from './lib.ts';
import { MALE_VOICES, singLine, voicevoxAvailable } from './lib-voicevox.ts';

if (!(await voicevoxAvailable())) throw new Error('VOICEVOX Engine が起動していません (127.0.0.1:50021)');
const { dnas } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const seed = 'zig-psylo-0001';
const song = psyloSong({ guitar: bark, drums: tower, voice: sunset }, seed);
const c = song.sections.find((s) => s.name === 'chorus1')!;
const line = psyloVocalPlan(song).find((l) => l.section === 'chorus1')!;
const spb = 60 / song.bpm;
const from = c.start + 16 * spb - 0.3; // bar 5 of the chorus, with room for the first consonant
const SR = 44100;
const kana = line.kana!.filter((n) => n.time >= from).map((n) => ({ ...n, time: n.time - from }));
const SEG = 16 * spb + 1.2;
const stabilize = 0.75;
const cache = join(ROOT, 'experiments/psylo/vocal-queries');
const parts: Float32Array[] = [];
const order: string[] = [];
const push = (y: Float32Array, name: string) => {
  let p = 0;
  for (const s of y) p = Math.max(p, Math.abs(s));
  parts.push(y.map((s) => (s / (p || 1)) * 0.7), new Float32Array(Math.round(0.5 * SR)));
  order.push(name);
};
for (const v of Object.values(MALE_VOICES)) {
  const { x } = await singLine(kana, SEG, SR, v.id, { stabilize, cacheDir: cache, label: 'hook' });
  push(x, `${v.name} (素の声)`);
  push(rockVocal(x, SR, 1), `${v.name} (ロック処理)`);
  push(megaphone(x, SR, 0.85), `${v.name} (メガホン)`);
}
const ref = MALE_VOICES.takehiroTsun;
push((await singLine(kana, SEG, SR, ref.id, { cacheDir: cache, label: 'hook' })).x, `${ref.name} 素の声 — 安定化なし (エンジンそのまま)`);
push((await singLine(kana, SEG, SR, ref.id, { stabilize, cacheDir: cache, label: 'hook' })).x, `${ref.name} 素の声 — 安定化 ${stabilize}`);
const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
let o = 0;
for (const p of parts) {
  out.set(p, o);
  o += p.length;
}
const base = join(ROOT, 'output/psylo/ZIG-PSYLO-0001-voices');
writeStereoWav(`${base}.wav`, { left: out, right: out, sampleRate: SR }, seed);
try {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '192k', `${base}.mp3`]);
} catch {
  /* no ffmpeg */
}
const seg = SEG + 0.5;
console.log(order.map((n, i) => `${Math.floor((i * seg) / 60)}:${String(Math.floor((i * seg) % 60)).padStart(2, '0')} ${n}`).join('\n'));
