/**
 * ZIG — NOBODY ON AIR: three 30-second demos (A ROCK BROADCAST / B GHOST FREQUENCY / C FREAKTION REACTION).
 *   npm run nobody [-- --out ../psyence-workshop]   (needs a VOICEVOX Engine on 127.0.0.1:50021; ≈4 min)
 * Writes output/nobody/*.wav, experiments/nobody/* and, with --out, the PSYENCE WORKSHOP files:
 *   public/audio/nobody/{A,B,C}-{mix,inst}.mp3, songs/NOBODY-ON-AIR/demos.json (+ band MIDI)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NOBODY_VERSION, decodeWav, freaktionSearch, megaphone, nobodyDemos, radioize, renderRock, rockToMidi, rockVocal, verifyAudio, type NobodyDemo, type VocalPart } from '@sonova/composition-engine';
import { loudness } from '@sonova/orchestra-engine';
import { Biquad, master, pingPong, reverb, type StereoBuffer } from '@sonova/synthesis-engine';
import { MALE_VOICES, singLine, voicevoxAvailable } from './lib-voicevox.ts';
import { ROOT, buildInstruments, writeJson, writeStereoWav } from './lib.ts';

const SR = 44100;
const LEN = 30;
const TARGET_LUFS = -14;
const outArg = process.argv.indexOf('--out');
const PW = outArg > 0 ? resolve(process.argv[outArg + 1]) : null;
if (!(await voicevoxAvailable())) {
  console.error('VOICEVOX Engine not reachable (VOICEVOX_URL, default http://127.0.0.1:50021).');
  process.exit(1);
}
const VOICES: Record<string, { id: number; name: string; credit: string }> = {
  ...MALE_VOICES,
  kotarouFutsu: { id: 3012, name: '白上虎太郎 ふつう', credit: 'VOICEVOX:白上虎太郎' },
  kotarouWai: { id: 3032, name: '白上虎太郎 わーい', credit: 'VOICEVOX:白上虎太郎' },
};

const { dnas } = await buildInstruments();
const band = { guitar: dnas[0], drums: dnas[1], voice: dnas[2] };
const image = { width: 1, height: 1, lum: new Float64Array(1) };
const search = freaktionSearch(12);
console.log('FREAKTION search:', search.map((r) => `${r.seed} ${r.score}`).join(', '));
const demos = nobodyDemos(search[0].seed);

const OUT = join(ROOT, 'output/nobody');
const EXP = join(ROOT, 'experiments/nobody');
mkdirSync(OUT, { recursive: true });
const rmsWhere = (x: Float32Array, mask: (i: number) => boolean) => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < x.length; i++)
    if (mask(i)) {
      s += x[i] * x[i];
      n++;
    }
  return n ? Math.sqrt(s / n) : 0;
};

function voiceFx(x: Float32Array, fx: VocalPart['fx']): Float32Array {
  if (fx === 'rock') return rockVocal(x, SR, 1);
  if (fx === 'rock-light') return rockVocal(x, SR, 0.5);
  if (fx === 'megaphone') return megaphone(x, SR, 1);
  if (fx === 'robot') {
    // ring modulation + 10-bit crush + megaphone: a machine announcing
    const y = x.map((v, i) => Math.round(v * Math.sin((2 * Math.PI * 92 * i) / SR) * 512) / 512);
    return megaphone(y, SR, 0.8);
  }
  // clean: high-pass and a gentle presence lift
  const hp = new Biquad('highpass', 110, 0.7, SR);
  const pk = new Biquad('peaking', 3200, 0.9, SR, 2.5);
  return x.map((v) => pk.process(hp.process(v)));
}

async function renderVocals(d: NobodyDemo, seconds: number, credits: Set<string>) {
  const bus: StereoBuffer = { sampleRate: SR, left: new Float32Array(Math.ceil(seconds * SR)), right: new Float32Array(Math.ceil(seconds * SR)) };
  for (const p of d.vocals) {
    const v = VOICES[p.voice];
    credits.add(v.credit);
    process.stdout.write(`  · VOICEVOX ${d.id} ${p.name} (${v.name})\n`);
    const { x } = await singLine(p.notes, seconds, SR, v.id, { transpose: p.transpose, cents: p.cents, delay: p.delay, stabilize: 0.75, cacheDir: join(EXP, 'vocal-queries'), label: `${d.id}-${p.name}` });
    const y = voiceFx(x, p.fx);
    const r = rmsWhere(y, (i) => Math.abs(y[i]) > 1e-4) || 1;
    const g = (0.1 / r) * p.gain;
    const gl = Math.cos(((p.pan + 1) * Math.PI) / 4) * g;
    const gr = Math.sin(((p.pan + 1) * Math.PI) / 4) * g;
    for (let i = 0; i < y.length && i < bus.left.length; i++) {
      bus.left[i] += y[i] * gl;
      bus.right[i] += y[i] * gr;
    }
  }
  // space: a plate and an eighth-note echo (B is wider and wetter: a voice from far away)
  const [rl, rr] = reverb(bus.left, bus.right, { roomSize: d.id === 'B' ? 0.78 : 0.6, damping: 0.5, sampleRate: SR });
  const [dl, dr] = pingPong(bus.left, bus.right, SR, (60 / d.bpm) * (d.id === 'B' ? 0.75 : 0.5), 0.3, 0.4);
  const wet = d.id === 'B' ? 0.3 : 0.16;
  for (let i = 0; i < bus.left.length; i++) {
    bus.left[i] += rl[i] * wet + dl[i] * 0.12;
    bus.right[i] += rr[i] * wet + dr[i] * 0.12;
  }
  if (d.id === 'B') {
    const out = d.song.sections.find((s) => s.name === 'outro')!.start;
    radioize(bus, out + 0.3, seconds, SR, 'nobody-b-vox', 0.8);
  }
  return bus;
}

const results = [];
for (const d of demos) {
  console.log(`${d.id} ${d.title}`);
  const credits = new Set<string>();
  const r = renderRock(d.song, band, image, SR, (m) => process.stdout.write(`  · ${m}\n`), d.hooks);
  const inst = r.buffer;
  const vox = await renderVocals(d, d.song.durationSec, credits);
  // the voice sits 1.5 dB under the band where it sings (B: level with it)
  const voxEnv = (i: number) => Math.abs(vox.left[i]) + Math.abs(vox.right[i]) > 2e-3;
  const bandRms = rmsWhere(inst.left, voxEnv);
  const voxRms = rmsWhere(vox.left, voxEnv);
  const vg = (bandRms / (voxRms || 1)) * Math.pow(10, (d.id === 'B' ? 0 : -1.5) / 20);
  const n = LEN * SR;
  const mk = (withVox: boolean): StereoBuffer => {
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // the last 0.8 s fade away (the final chord rings into it)
      const f = Math.min(1, (n - i) / (0.8 * SR));
      L[i] = (inst.left[i] + (withVox ? vox.left[i] * vg : 0)) * f;
      R[i] = (inst.right[i] + (withVox ? vox.right[i] * vg : 0)) * f;
    }
    return { sampleRate: SR, left: L, right: R };
  };
  const mix = mk(true);
  const instOnly = mk(false);
  // equal loudness for every demo: the mix goes to −14 LUFS; the instrumental keeps the same gain
  const lufs0 = loudness(mix.left, mix.right, SR).integrated;
  const g = Math.pow(10, (TARGET_LUFS - lufs0) / 20);
  for (const b of [mix, instOnly])
    for (let i = 0; i < n; i++) {
      b.left[i] *= g;
      b.right[i] *= g;
    }
  for (const b of [mix, instOnly]) master(b.left, b.right, { sampleRate: SR, targetRmsDb: 0, ceilingDb: -1, maxGainDb: 0 });
  const files: Record<string, string> = {};
  const verification: Record<string, unknown> = {};
  for (const [kind, b] of [['mix', mix], ['inst', instOnly]] as const) {
    const base = join(OUT, `NOBODY-${d.id}-${kind}`);
    const bytes = writeStereoWav(`${base}.wav`, b, `nobody-${d.id}`);
    verification[kind] = { ...verifyAudio(decodeWav(bytes), { sampleRate: SR, channels: 2, bitsPerSample: 16, minDurationSec: 29.9, maxDurationSec: 30.1, maxPeakDbfs: -0.9, maxSilentRatio: 0.05 }), lufs: Math.round(loudness(b.left, b.right, SR).integrated * 10) / 10 };
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '192k', `${base}.mp3`]);
    files[kind] = `${d.id}-${kind}.mp3`;
  }
  writeFileSync(join(OUT, `NOBODY-${d.id}.mid`), rockToMidi(d.song));
  const v = verification as Record<'mix' | 'inst', { ok: boolean; peakDbfs: number; lufs: number; problems: string[] }>;
  console.log(`  ${d.id}: mix ${v.mix.lufs} LUFS peak ${v.mix.peakDbfs} ${v.mix.ok ? 'OK' : 'NG ' + v.mix.problems.join(',')} · inst ${v.inst.lufs} LUFS · stems ${Object.entries(r.stems).map(([k, s]) => `${k} ${s.gainDb}`).join(', ')}`);
  results.push({
    id: d.id,
    title: d.title,
    concept: d.concept,
    bpm: d.bpm,
    key: d.key,
    bars: d.bars,
    durationSec: LEN,
    sections: d.sections.map((s) => ({ ...s, start: Math.round(d.song.barSec * s.from * 100) / 100, end: Math.round(d.song.barSec * s.to * 100) / 100 })),
    chords: d.chords,
    riff: d.riff,
    lyrics: d.lyrics,
    layers: d.layers,
    credits: [...credits],
    vocals: d.vocals.map((p) => ({ part: p.name, voice: VOICES[p.voice].name, transpose: p.transpose ?? 0, notes: p.notes.map((k) => ({ lyric: k.lyric, midi: k.midi + (p.transpose ?? 0), time: Math.round(k.time * 1000) / 1000, duration: Math.round(k.duration * 1000) / 1000 })) })),
    files,
    verification,
    stems: r.stems,
  });
}

const manifest = {
  title: 'NOBODY ON AIR',
  series: 'ZIG — FREAKTION SONG 001',
  engine: NOBODY_VERSION,
  targetLufs: TARGET_LUFS,
  freaktion: { chosen: search[0].seed, rule: '電子音の発音がリフの拍から外れる割合 (衝突) ×0.5 + 粗さの低さ (濁らない) ×0.3 + 密度 ×0.2。順位をつけるだけで、聴いて選ぶのは人', candidates: search },
  licenses: [
    'ギター・ベース・ドラム・電子音: SONOVA の自前の合成 (弦の物理モデル、モード合成ドラム、画像楽器、バイトビート)。サンプル音源は使っていない',
    '歌声: VOICEVOX Engine 0.26.0 の歌唱機能 (CPU)。音程とタイミングは VOICEVOX:波音リツ の歌唱スタイル、声は各キャラクター。公開時はクレジット表記が必要',
    '作詞・作曲・編曲: オリジナル (既存曲のリフ・歌詞・旋律・歌声は使っていない)',
  ],
  demos: results,
};
writeJson(join(EXP, 'nobody.json'), manifest);
if (PW) {
  const audio = join(PW, 'public/audio/nobody');
  mkdirSync(audio, { recursive: true });
  for (const d of demos) for (const kind of ['mix', 'inst']) execFileSync('cp', [join(OUT, `NOBODY-${d.id}-${kind}.mp3`), join(audio, `${d.id}-${kind}.mp3`)]);
  const song = join(PW, 'songs/NOBODY-ON-AIR');
  mkdirSync(song, { recursive: true });
  writeJson(join(song, 'demos.json'), manifest);
  for (const d of demos) execFileSync('cp', [join(OUT, `NOBODY-${d.id}.mid`), join(song, `NOBODY-${d.id}-band.mid`)]);
  console.log(`wrote ${audio} and ${song}`);
}
