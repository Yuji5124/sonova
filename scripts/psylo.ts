/**
 * ZIG-PSYLO-0001 "PSYLO" — the PSYENCE WORKSHOP chorus (Pattern A, サイロー) grown into a full song on the
 * TOYRIOT production (radio intro, megaphone verses, gang-vocal choruses), sung by male VOICEVOX voices.
 *   npm run psylo   (needs a VOICEVOX Engine on 127.0.0.1:50021; ≈4 min)
 *   PSYLO_STABILIZE=0 npm run psylo   — the engine's own pitch curves (default 0.75: a steadier singer)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeWav, engineVersions, psyloSong, psyloVocalPlan, renderToyRiot, rockToMidi, romajiToMorae, setKana, verifyAudio, PSYLO_LYRICS, PSYLO_VERSION, type ExternalTake, type KanaNote } from '@sonova/composition-engine';
import { MALE_VOICES, singLine, voicevoxAvailable } from './lib-voicevox.ts';
import type { SpectroImage } from '@sonova/synthesis-engine';
import { ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'ZIG-PSYLO-0001';
const seed = process.argv[2] ?? 'zig-psylo-0001';
const stabilize = Number(process.env.PSYLO_STABILIZE ?? 0.75);
if (!(await voicevoxAvailable())) {
  console.error('VOICEVOX Engine not reachable (VOICEVOX_URL, default http://127.0.0.1:50021). Start it and retry.');
  process.exit(1);
}
const { dnas, sources } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const band = { guitar: bark, drums: tower, voice: sunset };
const png = PNG.sync.read(readFileSync(sources[0].path));
const W = 160;
const H = 72;
const lum = new Float64Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (Math.floor((y / H) * png.height) * png.width + Math.floor((x / W) * png.width)) * 4;
    lum[y * W + x] = (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
  }
const image: SpectroImage = { width: W, height: H, lum };

const SR = 44100;
const song = psyloSong(band, seed);
const plan = psyloVocalPlan(song);
const V = MALE_VOICES;
const CACHE = join(ROOT, 'experiments/psylo/vocal-queries');
const credits = new Set<string>();
const vocals: Record<string, ExternalTake[]> = {};
const vocalScore: Array<{ section: string; style: string; notes: Array<{ lyric: string; midi: number; time: number; duration: number }> }> = [];
for (const line of plan) {
  const kana: KanaNote[] = (line.kana ?? setKana(line.melody, line.text)).map((n) => ({ ...n, time: n.time - line.offset }));
  vocalScore.push({ section: line.section, style: line.style, notes: kana.map((n) => ({ lyric: n.lyric, midi: n.midi, time: Math.round((n.time + line.offset) * 1000) / 1000, duration: Math.round(n.duration * 1000) / 1000 })) });
  const sing = async (voice: keyof typeof V, o: Parameters<typeof singLine>[4] = {}) => {
    credits.add(V[voice].credit);
    return (await singLine(kana, line.seconds, SR, V[voice].id, { stabilize, ...o, cacheDir: CACHE, label: `${line.section}${o.transpose ? `-t${o.transpose}` : ''}` })).x;
  };
  process.stdout.write(`  · VOICEVOX ${line.section}\n`);
  if (line.style === 'megaphone') vocals[line.section] = [{ x: await sing('takehiroTsun'), pan: 0, gain: 1, fx: 'megaphone' }];
  else if (line.style === 'pre')
    vocals[line.section] = [
      { x: await sing('takehiro'), pan: -0.12, gain: 0.8, fx: 'rock-light' },
      { x: await sing('takehiroTsun'), pan: 0.12, gain: 0.6, fx: 'megaphone' },
    ];
  else
    vocals[line.section] = [
      { x: await sing('takehiroTsun'), pan: -0.3, gain: 0.85, fx: 'rock' },
      { x: await sing('takehiro', { delay: 0.014, cents: 7 }), pan: 0.3, gain: 0.85, fx: 'rock' },
      // the gang voice an octave up = Pattern A as written (ロー on F#5)
      { x: await sing('kotarouOko', { transpose: 12 }), pan: 0, gain: 0.42, fx: 'rock-light' },
    ];
}
// the intro announcement (spoken on a monotone, then the megaphone in renderToyRiot)
const ann = romajiToMorae(PSYLO_LYRICS.intro);
const step = 60 / song.bpm / 2;
const annKana: KanaNote[] = ann.morae.map((m, k) => ({ lyric: m, time: 0.2 + k * step + (k >= ann.breaks[0] ? step * 2 : 0), duration: step * 0.95, midi: 55 + (k % 4 === 3 ? 2 : 0), velocity: 0.8 }));
const annTake = (await singLine(annKana, annKana.length * step + 2, SR, V.takehiroTsun.id, { stabilize, cacheDir: CACHE, label: 'intro' })).x;

const vocalCredit = [...credits].join(' / ');
console.log(`vocal: VOICEVOX (${vocalCredit}) · stabilize ${stabilize}`);
const r = renderToyRiot(band, seed, image, (m) => process.stdout.write(`  · ${m}\n`), { vocals, vocalCredit, song, plan, intro: { text: PSYLO_LYRICS.intro, take: annTake }, chorusLead: 0 });
const OUT = join(ROOT, 'output/psylo');
const EXP = join(ROOT, 'experiments/psylo');
mkdirSync(OUT, { recursive: true });
const base = join(OUT, stabilize ? WORK : `${WORK}-unstabilized`);
const bytes = writeStereoWav(`${base}.wav`, r.render.buffer, seed);
writeFileSync(`${base}.mid`, rockToMidi(r.song));
try {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '256k', `${base}.mp3`]);
} catch {
  console.log('(ffmpeg not found: MP3 skipped)');
}
const v = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 140, maxPeakDbfs: -0.9, maxSilentRatio: 0.03 });
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
writeJson(join(EXP, `${WORK}.json`), { workNumber: WORK, title: song.title, seed, engines: { ...engineVersions(), psylo: PSYLO_VERSION }, sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })), bpm: song.bpm, key: song.key, durationSec: song.durationSec, sections: song.sections.map((s) => ({ name: s.name, start: s.start, bars: s.bars })), lyrics: r.lyrics, layers: r.layers, vocal: { engine: 'VOICEVOX Engine 0.26.0 (song API, CPU)', query_style: '6000 波音リツ (sing)', stabilize, credits: [...credits], score: vocalScore }, render: { ms: r.render.renderMs, stems: r.render.stems, master: r.render.master }, verification: v, wav: rel(`${base}.wav`) });
console.log(`${WORK} "${song.title}" ${song.bpm} BPM ${song.durationSec.toFixed(1)}s · render ${(r.render.renderMs / 1000).toFixed(1)}s · peak ${v.peakDbfs} RMS ${v.rmsDbfs} · ${v.ok ? 'OK' : 'NG ' + v.problems.join(',')}`);
const md = `# ${WORK} — PSYLO (サイロ)

自動生成: \`npm run psylo\` (VOICEVOX Engine が必要)。音声 \`output/psylo/${WORK}.wav\` / \`.mp3\` / \`.mid\` (Git 管理外)。
${song.bpm} BPM · B minor (サビは D major) · ${mmss(song.durationSec)} · 検証 ${v.ok ? 'OK' : 'NG'} (peak ${v.peakDbfs} dBFS, RMS ${v.rmsDbfs} dBFS)

PSYENCE WORKSHOP の PSYLO A案 (サビ8小節・フック「サイロー」) を、SONOVA-TOYRIOT-0001「Tin Wings Riot」男声版と同じ作り方 (ラジオのイントロ、メガホンの A メロ、ダブル + 1オクターブ上のギャング・コーラスのサビ) で1曲にした。歌詞・旋律はすべてオリジナル。

## 歌声

- **${vocalCredit}** — VOICEVOX Engine の歌唱機能 (CPU)。音程とタイミングは VOICEVOX:波音リツ の歌唱スタイル (6000) で作り、声を男声に差し替えている
- **安定化 ${stabilize}**: 各母音の入り 40 ms (しゃくり) と終わり 30 ms (次の音へのつなぎ) は残し、その間の音程を楽譜の音へ ${Math.round(stabilize * 100)}% 寄せ、細かい揺れをならした (\`scripts/lib-voicevox.ts\` の \`stabilizePitch\`)。\`PSYLO_STABILIZE=0\` でエンジンそのままの歌い方
- サビ: 玄野武宏 (ツンギレ・ノーマル) の2声を左右に、白上虎太郎 (おこ) が1オクターブ上 (= A案の原調、ロー F#5) で重なる
- 実在の歌手の声は使っていない (hide 本人の声も複製していない)

## 構成

| 区間 | 開始 | 小節 |
|---|---|---|
${song.sections.map((s) => `| ${s.name} | ${mmss(s.start)} | ${s.bars} |`).join('\n')}

## 歌詞 (オリジナル)

${r.lyrics.map((l) => `- **${l.section}**: ${l.text.replace(/-/g, '')}`).join('\n')}

## 仕掛け

${r.layers.map((x) => `- ${x}`).join('\n')}
`;
writeFileSync(join(EXP, 'REPORT.md'), md);
