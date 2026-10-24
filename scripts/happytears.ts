/**
 * ZIG — HAPPY TEARS (FREAKTION SONG 002, Phase 0): three 30-second demos rendered as six stems each
 * (vocal / drums / bass / guitar / happy / tears) that add up to the mix sample for sample.
 *   npm run happytears [-- --out ../psyence-workshop]
 * Needs: a VOICEVOX Engine (127.0.0.1:50021) and the VSCO-2-CE samples (npm run od:fetch). ≈5 min.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as TonejsMidi from '@tonejs/midi';
import { DEMO_LYRICS, HAPPY_TEARS_LYRICS, HAPPY_TEARS_VERSION, HOOK_SYLLABLES, STEMS, decodeWav, happyTearsDemos, materialDNA, paradeMutation, renderRock, rockPlan, rockVocal, verifyAudio, type HappyDemo, type RockHooks, type Stem } from '@sonova/composition-engine';
import { SampleLibrary, loudness, playNote, reedNote } from '@sonova/orchestra-engine';
import { Biquad, renderDrumHit, renderVoice, reverb, type StereoBuffer } from '@sonova/synthesis-engine';
import { singLine, voicevoxAvailable } from './lib-voicevox.ts';
import { ROOT, buildInstruments, writeJson, writeStereoWav } from './lib.ts';

// @tonejs/midi ships UMD for Node and ESM for bundlers; accept either shape (as composition-engine does)
const Midi = ((TonejsMidi as unknown as { Midi?: typeof TonejsMidi.Midi }).Midi ?? (TonejsMidi as unknown as { default: { Midi: typeof TonejsMidi.Midi } }).default.Midi);
const SR = 44100;
const TARGET_LUFS = -14;
const outArg = process.argv.indexOf('--out');
const PW = outArg > 0 ? resolve(process.argv[outArg + 1]) : null;
if (!(await voicevoxAvailable())) {
  console.error('VOICEVOX Engine not reachable (VOICEVOX_URL, default http://127.0.0.1:50021).');
  process.exit(1);
}
const lib = new SampleLibrary(process.env.VSCO_DIR ?? join(ROOT, 'vendor/VSCO-2-CE'));
const { dnas } = await buildInstruments();
const band = { guitar: dnas[0], drums: dnas[1], voice: dnas[2] };
const image = { width: 1, height: 1, lum: new Float64Array(1) };
const OUT = join(ROOT, 'output/happytears');
const EXP = join(ROOT, 'experiments/happytears');
mkdirSync(OUT, { recursive: true });

const bus = (n: number): StereoBuffer => ({ sampleRate: SR, left: new Float32Array(n), right: new Float32Array(n) });
const addMono = (b: StereoBuffer, x: Float32Array, at: number, pan: number, g = 1) => {
  const a = Math.round(at * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * g;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * g;
  for (let i = 0; i < x.length && a + i < b.left.length; i++) {
    if (a + i < 0) continue;
    b.left[a + i] += x[i] * gl;
    b.right[a + i] += x[i] * gr;
  }
};
const addStereo = (b: StereoBuffer, s: { left: Float32Array; right: Float32Array }, at: number, pan: number, g = 1) => {
  const a = Math.round(at * SR);
  const gl = Math.min(1, 1 - pan) * g;
  const gr = Math.min(1, 1 + pan) * g;
  for (let i = 0; i < s.left.length && a + i < b.left.length; i++) {
    if (a + i < 0) continue;
    b.left[a + i] += s.left[i] * gl;
    b.right[a + i] += s.right[i] * gr;
  }
};
const activeRms = (b: StereoBuffer) => {
  let s = 0;
  let n = 0;
  const w = Math.round(0.05 * SR);
  for (let a = 0; a < b.left.length; a += w) {
    let e = 0;
    for (let i = a; i < Math.min(b.left.length, a + w); i++) e += (b.left[i] ** 2 + b.right[i] ** 2) / 2;
    if (Math.sqrt(e / w) > 1e-3) {
      s += e;
      n += w;
    }
  }
  return n ? Math.sqrt(s / n) : 0;
};
const scale = (b: StereoBuffer, g: number) => {
  for (let i = 0; i < b.left.length; i++) {
    b.left[i] *= g;
    b.right[i] *= g;
  }
};
/** add a reverb of the stem to itself (stays inside the stem, so stems still add up to the mix) */
const space = (b: StereoBuffer, wet: number, room: number) => {
  if (wet <= 0) return;
  const [l, r] = reverb(b.left, b.right, { roomSize: room, damping: 0.5, sampleRate: SR });
  for (let i = 0; i < b.left.length; i++) {
    b.left[i] += l[i] * wet;
    b.right[i] += r[i] * wet;
  }
};
const filterStem = (b: StereoBuffer, type: 'highpass' | 'lowpass', hz: number) => {
  for (const ch of [b.left, b.right]) {
    const f = new Biquad(type, hz, 0.7, SR);
    for (let i = 0; i < ch.length; i++) ch[i] = f.process(ch[i]);
  }
};
/** RIFF B: saturate only above `split` Hz; the low end stays clean */
const splitDrive = (x: Float32Array, drive: number, split = 200) => {
  if (drive <= 0) return x;
  const lp = new Biquad('lowpass', split, 0.7, SR);
  const hp = new Biquad('highpass', split, 0.7, SR);
  const k = 1 + drive * 8;
  return x.map((v) => lp.process(v) + Math.tanh(hp.process(v) * k) / Math.tanh(k) * 0.9);
};

/** a look-ahead peak limiter's gain curve (as SONOVA's master), so the same curve can be applied to every stem */
function limiterGain(L: Float32Array, R: Float32Array, ceilingDb: number): Float32Array {
  const ceiling = Math.pow(10, ceilingDb / 20);
  const n = L.length;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    g[i] = a > ceiling ? ceiling / a : 1;
  }
  const rel = 1 - Math.exp(-1 / (0.12 * SR));
  const att = 1 - Math.exp(-1 / (0.004 * SR));
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i], g[i - 1] + (1 - g[i - 1]) * rel);
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + (1 - g[i + 1]) * att);
  return g;
}

/** per-demo balance (active RMS dBFS of each stem before the loudness match) */
const BALANCE: Record<HappyDemo['id'], Record<Stem, number>> = {
  A: { vocal: -17, drums: -17, bass: -20, guitar: -19, happy: -23, tears: -21 },
  B: { vocal: -17, drums: -19, bass: -21, guitar: -23, happy: -19, tears: -20 },
  C: { vocal: -17, drums: -18, bass: -21, guitar: -21, happy: -22, tears: -20 },
};

async function renderDemo(d: HappyDemo) {
  const n = Math.round(d.durationSec * SR);
  const stems = Object.fromEntries(STEMS.map((s) => [s.id, bus(n)])) as Record<Stem, StereoBuffer>;
  // ---- band (SONOVA rock renderer): the stems are taken before its own mix and master ----
  const caps: Array<Parameters<NonNullable<RockHooks['beforeReverb']>>[0]> = [];
  renderRock(d.song, band, image, SR, (m) => process.stdout.write(`  · ${d.id} ${m}\n`), { beforeReverb: (ctx) => void caps.push(ctx) });
  const c = caps[0];
  addMono(stems.guitar, c.guitarL.subarray(0, n), 0, -0.8);
  addMono(stems.guitar, c.guitarR.subarray(0, n), 0, 0.8);
  addMono(stems.guitar, c.lead.subarray(0, n), 0, 0.12);
  addMono(stems.bass, c.bass.subarray(0, n), 0, 0);
  addStereo(stems.drums, { left: c.drums.left.subarray(0, n), right: c.drums.right.subarray(0, n) }, 0, 0, c.drumGain);
  // ---- orchestra (VSCO-2-CE samples) ----
  process.stdout.write(`  · ${d.id} orchestra (${d.orch.length} notes)\n`);
  for (const o of d.orch) addStereo(stems[o.stem], playNote(lib, o.inst, o.art, o.midi, o.vel, o.dur, SR, { gainDb: o.gainDb ?? 0 }), o.time, o.pan * 0.6);
  // ---- reeds (SONOVA physical models) ----
  d.reeds.forEach((r, k) => addMono(stems[r.stem], reedNote(r.kind, r.midi, r.dur, r.vel, SR, `${d.id}:${k}`), r.time, r.pan, Math.pow(10, (r.gainDb ?? 0) / 20) * 0.5));
  // ---- percussion: timpani (VSCO) and toms (SONOVA modal drums), RIFF B's split saturation ----
  const kit = rockPlan(d.song, band).kit;
  d.perc.forEach((p, k) => {
    if (p.kind === 'timpani') {
      const t = playNote(lib, 'timpani', 'hit', p.midi ?? 50, p.vel, 1.5, SR);
      addStereo(stems.drums, { left: splitDrive(t.left, p.drive), right: splitDrive(t.right, p.drive) }, p.time, -0.15, 1.2);
    } else {
      const x = renderDrumHit(kit, p.kind === 'tom' ? 'tom3' : p.kind, p.vel, SR, `${d.id}:perc:${k}`);
      addMono(stems.drums, splitDrive(x, p.drive), p.time, 0.25, 0.8);
    }
  });
  // ---- C: SONOVA image instruments, mutating material and timbre ----
  const dnaCache = new Map<string, ReturnType<typeof materialDNA>>();
  d.morph.forEach((m, k) => {
    const dna = dnaCache.get(m.material) ?? materialDNA(m.material, 'happy-tears');
    dnaCache.set(m.material, dna);
    addMono(stems.happy, renderVoice(dna, { midi: m.midi, velocity: m.vel, duration: m.dur, timbre: m.timbre, kind: 'note' }, SR, `${d.id}:morph:${k}`), m.time, k % 2 ? 0.45 : -0.45, 0.6);
  });
  // ---- C: the parade trips (a tape stop on guitar, bass and drums) ----
  if (d.tapeStop) {
    const [a0, b0] = d.tapeStop.map((t) => Math.round(t * SR));
    for (const st of [stems.guitar, stems.bass, stems.drums])
      for (const ch of [st.left, st.right]) {
        const src = ch.slice(a0, b0);
        let p = 0;
        for (let i = a0; i < b0; i++) {
          const u = (i - a0) / (b0 - a0);
          p += Math.max(0, 1 - u * 1.15);
          ch[i] = (src[Math.floor(p)] ?? 0) * Math.max(0, 1 - u * 0.9);
        }
      }
  }
  // ---- vocals (VOICEVOX song API) ----
  const credits = new Set<string>();
  for (const v of d.vocals) {
    credits.add(v.credit);
    process.stdout.write(`  · ${d.id} VOICEVOX ${v.name}\n`);
    const { x } = await singLine(v.notes, d.durationSec + 0.5, SR, v.styleId, { transpose: v.transpose, cents: v.cents, delay: v.delay, stabilize: 0.75, consonantOnly: v.consonantOnly, cacheDir: join(EXP, 'vocal-queries'), label: `${d.id}-${v.name.split(' ')[0]}` });
    const hp = new Biquad('highpass', 110, 0.7, SR);
    const pres = new Biquad('peaking', 3000, 0.9, SR, 2);
    let y: Float32Array = x.map((s) => pres.process(hp.process(s)));
    if (v.fx === 'layer' || v.fx === 'gang') y = rockVocal(y, SR, 0.4);
    let pk = 0;
    for (const s of y) pk = Math.max(pk, Math.abs(s));
    const g = (v.gain * 0.3) / (pk || 1);
    addMono(stems.vocal, y.subarray(0, n), 0, v.pan, g);
  }
  // ---- balance, separation, space ----
  filterStem(stems.happy, 'highpass', 260); // happiness lives above the voice's chest and the low strings
  filterStem(stems.tears, 'lowpass', 3200); // sorrow stays below the voice's presence
  for (const st of STEMS) {
    const b = stems[st.id];
    const r = activeRms(b);
    if (r > 0) scale(b, Math.pow(10, BALANCE[d.id][st.id] / 20) / r);
  }
  space(stems.happy, 0.3 + d.hall * 0.3, 0.6 + d.hall * 0.3);
  space(stems.tears, 0.2 + d.hall * 0.2, 0.55 + d.hall * 0.3);
  space(stems.vocal, 0.16, 0.6);
  space(stems.guitar, 0.06, 0.5);
  space(stems.drums, 0.08, 0.45);
  // ---- loudness match and one limiter curve for all stems ----
  const mix = bus(n);
  for (const st of STEMS) for (let i = 0; i < n; i++) {
    mix.left[i] += stems[st.id].left[i];
    mix.right[i] += stems[st.id].right[i];
  }
  const g = Math.pow(10, (TARGET_LUFS - loudness(mix.left, mix.right, SR).integrated) / 20);
  scale(mix, g);
  const lim = limiterGain(mix.left, mix.right, -1);
  const fade = (i: number) => Math.min(1, (n - i) / (0.6 * SR), i / (0.005 * SR));
  for (const b of [mix, ...STEMS.map((s) => stems[s.id])]) {
    const gg = b === mix ? 1 : g;
    for (let i = 0; i < n; i++) {
      b.left[i] *= gg * lim[i] * fade(i);
      b.right[i] *= gg * lim[i] * fade(i);
    }
  }
  return { mix, stems, credits };
}

const demos = happyTearsDemos();
const results = [];
for (const d of demos) {
  console.log(`${d.id} ${d.title} (${d.bpm} BPM, ${d.durationSec}s)`);
  const { mix, stems, credits } = await renderDemo(d);
  const base = join(OUT, `HAPPY-${d.id}`);
  const bytes = writeStereoWav(`${base}-mix.wav`, mix, `happy-${d.id}`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}-mix.wav`, '-codec:a', 'libmp3lame', '-b:a', '192k', `${base}-mix.mp3`]);
  const verification = { ...verifyAudio(decodeWav(bytes), { sampleRate: SR, channels: 2, bitsPerSample: 16, minDurationSec: 29.5, maxDurationSec: 31.5, maxPeakDbfs: -0.9, maxSilentRatio: 0.05 }), lufs: Math.round(loudness(mix.left, mix.right, SR).integrated * 10) / 10 };
  const stemInfo: Record<string, { file: string; rmsDb: number }> = {};
  for (const st of STEMS) {
    const f = `${base}-${st.id}`;
    writeStereoWav(`${f}.wav`, stems[st.id], `happy-${d.id}-${st.id}`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${f}.wav`, '-codec:a', 'libmp3lame', '-b:a', '128k', `${f}.mp3`]);
    stemInfo[st.id] = { file: `${d.id}-${st.id}.mp3`, rmsDb: Math.round(20 * Math.log10(activeRms(stems[st.id]) + 1e-9) * 10) / 10 };
  }
  // one MIDI file: band + orchestra + reeds + the sung melody
  const midi = new Midi();
  midi.header.setTempo(d.bpm);
  const track = (name: string, notes: Array<{ midi: number; time: number; dur: number; vel: number }>) => {
    const t = midi.addTrack();
    t.name = name;
    for (const x of notes) t.addNote({ midi: x.midi, time: x.time, duration: Math.max(0.05, x.dur), velocity: Math.max(0.05, Math.min(1, x.vel)) });
  };
  track('vocal (ZIG)', d.vocals[0].notes.map((k) => ({ midi: k.midi, time: k.time, dur: k.duration, vel: 0.9 })));
  track('guitar', d.song.events.filter((e) => e.part === 'guitar' && e.kind === 'chord').flatMap((e) => e.midis!.map((m) => ({ midi: m, time: e.time, dur: e.duration!, vel: e.velocity! }))));
  track('bass', d.song.events.filter((e) => e.part === 'bass').map((e) => ({ midi: e.midi!, time: e.time, dur: e.duration!, vel: e.velocity! })));
  for (const inst of [...new Set(d.orch.map((o) => o.inst))]) track(inst, d.orch.filter((o) => o.inst === inst).map((o) => ({ midi: o.midi, time: o.time, dur: o.dur, vel: o.vel })));
  for (const kind of [...new Set(d.reeds.map((r) => r.kind))]) track(kind, d.reeds.filter((r) => r.kind === kind).map((r) => ({ midi: r.midi, time: r.time, dur: r.dur, vel: r.vel })));
  if (d.morph.length) track('SONOVA image instruments', d.morph.map((m) => ({ midi: m.midi, time: m.time, dur: m.dur, vel: m.vel })));
  writeFileSync(`${base}.mid`, midi.toArray());
  console.log(`  ${d.id}: ${verification.lufs} LUFS peak ${verification.peakDbfs} ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(',')} · stems ${Object.entries(stemInfo).map(([k, v]) => `${k} ${v.rmsDb}`).join(', ')}`);
  results.push({
    id: d.id,
    title: d.title,
    goal: d.goal,
    bpm: d.bpm,
    bars: d.bars,
    durationSec: d.durationSec,
    sections: d.sections,
    chords: d.chords,
    riffs: d.riffs,
    instrumentation: d.instrumentation,
    discoveries: d.discoveries,
    credits: [...credits],
    vocals: d.vocals.map((v) => ({ part: v.name, voice: v.voice, transpose: v.transpose ?? 0, consonantOnly: v.consonantOnly, notes: v.notes.map((k) => ({ lyric: k.lyric, midi: k.midi + (v.transpose ?? 0), time: Math.round(k.time * 1000) / 1000, duration: Math.round(k.duration * 1000) / 1000 })) })),
    files: { mix: `${d.id}-mix.mp3`, stems: stemInfo },
    verification,
  });
}

const manifest = {
  title: 'HAPPY TEARS',
  reading: 'ハッピー・ティアーズ',
  series: 'ZIG — FREAKTION SONG 002 / Phase 0',
  concept: 'もうここにはいない人が残した音楽を、未来を生きる ZIG が今も聴いている。楽しくて笑ってしまう、でももう会えないと思うと悲しい。それでも音楽を残してくれたことに感謝している。EMOTION COLLISION × TIME CROSS — 喜びと悲しみ、過去と未来を同時に鳴らす',
  engine: HAPPY_TEARS_VERSION,
  targetLufs: TARGET_LUFS,
  stems: STEMS,
  lyrics: { original: HAPPY_TEARS_LYRICS, sungInDemos: DEMO_LYRICS, hook: HOOK_SYLLABLES },
  paradeSeeds: Array.from({ length: 6 }, (_, k) => paradeMutation(`parade-${String(k).padStart(2, '0')}`)),
  licenses: [
    { what: 'オーケストラ (バイオリン・ソロバイオリン・ビオラ・チェロ・コントラバス・ホルン・トランペット・トロンボーン・チューバ・ティンパニ・グロッケンシュピール)', source: 'VSCO 2 Community Edition (Versilian Studios) https://github.com/sgossner/VSCO-2-CE', license: 'CC0 1.0 (パブリックドメイン相当、クレジット不要・商用可)' },
    { what: 'バリトンサックス・バスクラリネット', source: 'SONOVA の物理モデル (デジタル導波管、STK の Clarinet / Saxofony モデルを参考に自作)', license: '自作コード (サンプル音源なし)' },
    { what: 'ギター・ベース・ドラム・ロータム', source: 'SONOVA のロックレンダラー (弦の物理モデル、モード合成ドラム)', license: '自作コード' },
    { what: '変異する電子音 (C)', source: 'SONOVA v1.1 の画像楽器 (手続き画像から作った DNA)', license: '自作コード・自作画像' },
    { what: '歌声', source: 'VOICEVOX Engine 0.26.0 (LGPL v3 / 別ライセンス) の歌唱機能、CPU', license: '音声ライブラリごとの規約。公開時に「VOICEVOX:玄野武宏」「VOICEVOX:白上虎太郎」のクレジットが必要' },
    { what: '作詞・作曲・編曲', source: 'オリジナル (歌詞は依頼者の草案を原文のまま保存し、その抜粋を歌唱)', license: '—' },
  ],
  notUsed: [
    'University of Iowa MIS (バスクラリネットのサンプルがある): この環境からは取得できなかった (HTTP 403)',
    'サクソフォンのサンプル: VSCO-2-CE には無く、ライセンスの明確な無料サンプルを確認できなかったので物理モデルで作った',
  ],
  demos: results,
};
writeJson(join(EXP, 'happytears.json'), manifest);
if (PW) {
  const audio = join(PW, 'public/audio/happy-tears');
  const song = join(PW, 'songs/HAPPY-TEARS');
  mkdirSync(audio, { recursive: true });
  mkdirSync(song, { recursive: true });
  for (const d of demos) {
    execFileSync('cp', [join(OUT, `HAPPY-${d.id}-mix.mp3`), join(audio, `${d.id}-mix.mp3`)]);
    for (const st of STEMS) execFileSync('cp', [join(OUT, `HAPPY-${d.id}-${st.id}.mp3`), join(audio, `${d.id}-${st.id}.mp3`)]);
    execFileSync('cp', [join(OUT, `HAPPY-${d.id}.mid`), join(song, `HAPPY-${d.id}.mid`)]);
  }
  writeJson(join(song, 'demos.json'), manifest);
  console.log(`wrote ${audio} and ${song}`);
}
