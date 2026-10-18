/**
 * SONOVA-XROCK-0001 — rock pushed out of its edges (time, tempo, rhythm, pitch, voice).
 *   npm run xrock   (≈4 min)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeWav, engineVersions, renderXRock, rockToMidi, verifyAudio, ROCK_RENDER_VERSION, XROCK_VERSION } from '@sonova/composition-engine';
import { ROCK_VERSION } from '@sonova/music-generator';
import type { SpectroImage } from '@sonova/synthesis-engine';
import { ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'SONOVA-XROCK-0001';
const seed = process.argv[2] ?? 'sonova-xrock-0001';
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

const OUT = join(ROOT, 'output/xrock');
const EXP = join(ROOT, 'experiments/xrock');
mkdirSync(OUT, { recursive: true });
mkdirSync(EXP, { recursive: true });
const r = renderXRock(band, seed, image, (m) => process.stdout.write(`  · ${m}\n`));
const base = join(OUT, WORK);
const bytes = writeStereoWav(`${base}.wav`, r.render.buffer, seed);
writeFileSync(`${base}.mid`, rockToMidi(r.song));
const v = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 180, maxPeakDbfs: -0.9, maxSilentRatio: 0.03 });
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const { song } = r;
writeJson(join(EXP, `${WORK}.json`), {
  workNumber: WORK,
  title: song.title,
  seed,
  engines: { ...engineVersions(), rock: ROCK_VERSION, rock_render: ROCK_RENDER_VERSION, xrock: XROCK_VERSION },
  band: { guitar: bark.instrument_id, drums: tower.instrument_id, voice: sunset.instrument_id },
  sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })),
  bpm: song.bpm,
  key: song.key,
  durationSec: song.durationSec,
  sections: song.sections.map((s) => ({ name: s.name, start: s.start, bars: s.bars })),
  derivations: song.derivations,
  stretch: r.stretch,
  canon: r.canon,
  risset: r.risset,
  shepard: r.shepard,
  talkbox: r.talkbox,
  singer: r.singer,
  render: { ms: r.render.renderMs, stems: r.render.stems, master: r.render.master },
  verification: v,
  wav: rel(`${base}.wav`),
});
console.log(`${WORK} "${song.title}" ${song.bpm} BPM ${NOTE[song.key.root_pc]} minor ${song.durationSec.toFixed(1)}s · render ${(r.render.renderMs / 1000).toFixed(1)}s · peak ${v.peakDbfs} RMS ${v.rmsDbfs} · ${v.ok ? 'OK' : 'NG ' + v.problems.join(',')}`);
console.log(JSON.stringify({ stretch: r.stretch, canon: r.canon, risset: r.risset, shepard: r.shepard }, null, 1));

const sec = (n: string) => song.sections.find((s) => s.name === n)!;
const md = `# ${WORK} — ${song.title}

自動生成: \`npm run xrock\`。音声 \`output/xrock/${WORK}.wav\` / \`.mid\`（Git 管理外、同じシードで再生成）。

- ${song.bpm} BPM · ${NOTE[song.key.root_pc]} minor · ${mmss(song.durationSec)} · シード \`${seed}\` · 検証 ${v.ok ? 'OK' : 'NG'} (peak ${v.peakDbfs} dBFS, RMS ${v.rmsDbfs} dBFS)
- バンドは SONOVA-ROCK-0001 と同じ: ギター ← 木の年輪 / ドラム ← 建物の外壁 / ベースとリード ← 夕焼けの海

ロックの曲を 5 つの方向に押し広げる。どれも他の人の GitHub / 研究の手法を、コードを写さずに独自実装した。

| 方向 | 手法（参考） | どこで | 何が何を決めたか |
|---|---|---|---|
| 時間 | **Paulstretch**（Nasca Octavian Paul、[paulnasca/paulstretch_python](https://github.com/paulnasca/paulstretch_python)、パブリックドメイン） | イントロ ${mmss(sec('intro').start)}–${mmss(sec('intro').end)} | サビ1 の最初の 1 小節（バンド全員の実際の音）を ${r.stretch.factor} 倍に引き伸ばす。窓 ${r.stretch.windowSec} 秒、位相はシードで乱数化。曲がまだ起きていないうちに、その未来が雲として聴こえ、リフの頭で突然止まる |
| テンポ | **ナンカロウのテンポカノン**（収束点。[nanc-in-a-can/canon-generator](https://github.com/nanc-in-a-can/canon-generator) の考え方、Nemire 2012） | ブリッジ ${mmss(sec('bridge').start)}–${mmss(sec('bridge').end)} | 同じリフを 3 声が違うテンポで弾き、遅い順に入って、ソロの頭 ${mmss(r.canon.convergence)} で同時に着地する |
| リズム | **リセット・リズム**（永遠に加速し続けて聴こえるドラム。Stowell 2011、[tmhglnd/risset-rhythm-effect](https://github.com/tmhglnd/risset-rhythm-effect)・MIT の考え方） | カノンの下 ${mmss(r.risset.start)}– | サビ1 の 1 小節目のドラムを ${r.risset.layers} 層、テンポが 2 倍ずつ違う層を sin² でつなぐ。1 メガ小節 ${r.risset.megabarSec} 秒で ${r.risset.layers === 3 ? 8 : 2 ** r.risset.layers} 倍に加速 (${r.risset.hits} 打) |
| 音高 | **シェパード=リセットのグリッサンド**（終わらずに上がり続ける音。Shepard 1964、Risset 1969） | pre3 ${mmss(sec('pre3').start)}–${mmss(sec('pre3').end)} | 6 本の KS 弦（主音と 5 度 × 3 オクターブ）が ${r.shepard.octaveSec} 秒で 1 オクターブずつ上がる。音量の鐘形はアンプの**後**にかけるので、歪んでも錯覚が崩れない |
| 声 | **トークボックス**（母音のフォルマント。Peterson & Barney 1952 の値）と**声道の物理モデルの歌手**（Kelly & Lochbaum 1962 / Pink Trombone の考え方） | 曲全体のリード、サビでは何語でもない言葉の歌 | リードの ${r.talkbox.notes} 音に、"${r.talkbox.text}" の母音 ${r.talkbox.vowels.join('-')} を順に当てる。3 つの時間変化する帯域フィルター |

## 何語でもない歌 (${mmss(sec('chorus1').start)}〜 すべてのサビ)

サビでは、リードのフック (トークボックスのギター) と同じ旋律を**歌手**が歌う。言葉は実在しない言語で、音は声になった素材 (夕焼け) から決めた。

- 声: 声門のパルス (Rosenberg) → 44 区間の声道 (Kelly–Lochbaum の導波管。Neil Thapen の Pink Trombone と同じ考え方、独自実装) → 唇。子音は声道を狭める・閉じる・乱流の雑音を入れて作る
- 子音は拍の少し前、母音が拍の上に来る (歌手の発音の仕方)。小さなスライドは母音を伸ばしたまま音程だけ動く (メリスマ)
- サビ3・4 は 2 人で歌う (ダブル)。最後のサビはギターが 1 オクターブ上、声は元の高さ、歌詞の一部が変わる
- 歌手が入るとトークボックスのギターは −8 dB 下がって歌を支える

${r.singer.language.rules.map((x) => `- ${x}`).join('\n')}
- 語彙 (9 語): ${r.singer.language.words.map((w) => `*${w}*`).join('、')}

| サビ | 開始 | 歌詞 (/ = 長い音で息継ぎ) |
|---|---|---|
${r.singer.choruses.map((c) => `| ${c.section}${c.doubled ? ' (2人)' : ''} | ${mmss(c.start)} | ${c.lyrics} |`).join('\n')}

## テンポカノン

| 声部 | テンポ比 | 移調 | 入り | 周期 | 理由 |
|---|---|---|---|---|---|
${r.canon.voices.map((x) => `| ${x.name} | ${x.ratioText} | ${x.transpose >= 0 ? '+' : ''}${x.transpose} | ${mmss(x.entry)} (${x.entry.toFixed(2)}s) | ${x.cycles} | ${x.reason} |`).join('\n')}

すべての声部が ${r.canon.convergence.toFixed(3)} 秒（ソロの 1 拍目）でリフの頭に同時に戻る。

## 構成

| 区間 | 開始 | 小節 | 内容 |
|---|---|---|---|
${song.sections.map((s) => `| ${s.name} | ${mmss(s.start)} | ${s.bars} | ${s.name === 'intro' ? 'Paulstretch の雲 (サビ1 の 1 小節を引き伸ばし)' : s.name === 'bridge' ? 'テンポカノン + リセット・リズム' : s.name === 'pre3' ? '+ シェパード=リセットの上昇' : s.description} |`).join('\n')}

## 正直な注意

- ブリッジはテンポカノンに置き換えたので、ROCK-0001 のブリッジにあった「スペクトログラムに描く画像」はこの曲にはない
- イントロの雲は、サビ1 を一度レンダリングしてからそれを引き伸ばしている（曲の後ろの音で前を作る）
- MIDI にはカノン・リセット・シェパードの音は入っていない（もとのバンドの譜面だけ）
`;
writeFileSync(join(EXP, 'REPORT.md'), md);
