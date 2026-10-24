/**
 * SONOVA-TOYRIOT-0001 "Tin Wings Riot" — an original song in the spirit of late-90s Japanese
 * industrial/alternative pop-rock (radio collage, megaphone verses, gang chorus, drum machine, flanger, toy keys, tape stop).
 *   npm run toyriot   (≈4 min)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeWav, engineVersions, renderToyRiot, rockToMidi, setKana, toyRiotSong, toyRiotVocalPlan, verifyAudio, TOYRIOT_VERSION, type ExternalTake } from '@sonova/composition-engine';
import { MALE_VOICES, singLine, voicevoxAvailable } from './lib-voicevox.ts';
import type { SpectroImage } from '@sonova/synthesis-engine';
import { ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'SONOVA-TOYRIOT-0001';
const seed = process.argv[2] ?? 'sonova-toyriot-0001';
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
// ---- the male voice: VOICEVOX (if an engine is running), else the built-in physical-model singer ----
const useVoicevox = process.env.TOYRIOT_SINGER !== 'model' && (await voicevoxAvailable());
const SR = 44100;
const vocals: Record<string, ExternalTake[]> = {};
const vocalScore: Array<{ section: string; style: string; notes: Array<{ lyric: string; midi: number; time: number; duration: number }> }> = [];
const credits = new Set<string>();
if (useVoicevox) {
  const plan = toyRiotVocalPlan(toyRiotSong(band, seed), seed);
  const V = MALE_VOICES;
  for (const line of plan) {
    const kana = setKana(line.melody, line.text).map((n) => ({ ...n, time: n.time - line.offset }));
    vocalScore.push({ section: line.section, style: line.style, notes: kana.map((n) => ({ lyric: n.lyric, midi: n.midi, time: Math.round((n.time + line.offset) * 1000) / 1000, duration: Math.round(n.duration * 1000) / 1000 })) });
    const sing = async (voice: keyof typeof V, o: Parameters<typeof singLine>[4] = {}) => {
      credits.add(V[voice].credit);
      return (await singLine(kana, line.seconds, SR, V[voice].id, { ...o, cacheDir: join(ROOT, 'experiments/toyriot/vocal-queries'), label: `${line.section}${o.transpose ? `-t${o.transpose}` : ''}` })).x;
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
        { x: await sing('kotarouOko', { transpose: 12 }), pan: 0, gain: 0.42, fx: 'rock-light' },
      ];
  }
}
const vocalCredit = [...credits].join(' / ');
console.log(useVoicevox ? `vocal: VOICEVOX (${vocalCredit})` : 'vocal: built-in physical-model singer (start a VOICEVOX Engine to use the male VOICEVOX voices)');
const r = renderToyRiot(band, seed, image, (m) => process.stdout.write(`  · ${m}\n`), useVoicevox ? { vocals, vocalCredit } : {});
const OUT = join(ROOT, 'output/toyriot');
const EXP = join(ROOT, 'experiments/toyriot');
mkdirSync(OUT, { recursive: true });
mkdirSync(EXP, { recursive: true });
const base = join(OUT, useVoicevox ? WORK : `${WORK}-model`);
const bytes = writeStereoWav(`${base}.wav`, r.render.buffer, seed);
writeFileSync(`${base}.mid`, rockToMidi(r.song));
try {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.wav`, '-codec:a', 'libmp3lame', '-b:a', '256k', `${base}.mp3`]);
} catch {
  console.log('(ffmpeg not found: MP3 skipped)');
}
const v = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 140, maxPeakDbfs: -0.9, maxSilentRatio: 0.03 });
const { song } = r;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
writeJson(join(EXP, `${WORK}.json`), { workNumber: WORK, title: song.title, seed, engines: { ...engineVersions(), toyriot: TOYRIOT_VERSION }, sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })), bpm: song.bpm, key: song.key, durationSec: song.durationSec, sections: song.sections.map((s) => ({ name: s.name, start: s.start, bars: s.bars })), derivations: song.derivations, lyrics: r.lyrics, layers: r.layers, vocal: useVoicevox ? { engine: 'VOICEVOX Engine (song API, CPU)', query_style: '6000 波音リツ (sing)', credits: [...credits], score: vocalScore } : { engine: 'built-in physical-model singer' }, render: { ms: r.render.renderMs, stems: r.render.stems, master: r.render.master }, verification: v, wav: rel(`${base}.wav`) });
console.log(`${WORK} "${song.title}" ${song.bpm} BPM E minor ${song.durationSec.toFixed(1)}s · render ${(r.render.renderMs / 1000).toFixed(1)}s · peak ${v.peakDbfs} RMS ${v.rmsDbfs} · ${v.ok ? 'OK' : 'NG ' + v.problems.join(',')}`);
const md = `# ${WORK} — ${song.title}

自動生成: \`npm run toyriot\`。音声 \`output/toyriot/${WORK}.wav\` / \`.mp3\` / \`.mid\` (Git 管理外)。
${song.bpm} BPM · E · ${mmss(song.durationSec)} · 検証 ${v.ok ? 'OK' : 'NG'} (peak ${v.peakDbfs} dBFS, RMS ${v.rmsDbfs} dBFS)

90 年代後半の日本のインダストリアル/オルタナティブ・ポップロックの**作り方**を参考にしたオリジナル曲。既存曲の旋律・歌詞・音源は使っていない (リフ・進行・フックは SONOVA のロック生成器、歌詞はこの曲のために書いた)。

## 仕掛け

${r.layers.map((x) => `- ${x}`).join('\n')}

## 構成

| 区間 | 開始 | 小節 |
|---|---|---|
${song.sections.map((s) => `| ${s.name} | ${mmss(s.start)} | ${s.bars} |`).join('\n')}

## 歌詞 (オリジナル)

${r.lyrics.map((l) => `- **${l.section}**: ${l.text.replace(/-/g, '')}`).join('\n')}

${useVoicevox ? `歌: **${vocalCredit}** — VOICEVOX Engine の歌唱機能 (CPU) で生成した男声。音程とタイミングは VOICEVOX:波音リツ の歌唱スタイルで作り、声を男声に差し替えている。歌詞はカナのまま歌う (濁音・ッ・ンも)。hide 本人の声は複製していない (声の加工の仕方だけを参考にした)。` : '歌手は声道の物理モデル (SONOVA の歌手)。子音は l r m n s h k t v しか持たないので、濁音や半濁音は近い音で歌う (ば→ヴァ、が→カ、ぱ→タ など)。'}
`;
writeFileSync(join(EXP, 'REPORT.md'), md);
