/**
 * SONOVA-ROCK-0001: the Phase 1 image instruments as a rock band (≈3 min).
 *   bark (wood) → guitar · tower (facade) → drums · sunset → bass & lead
 * Techniques from other people's research/repos, reimplemented: extended Karplus–Strong + amp
 * feedback, WDF diode clipper, modal membranes/plates, cellular-automaton rhythm, bytebeat,
 * image painted into the spectrogram. See research/github-survey-rock.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { generateRock } from '@sonova/music-generator';
import { decodeWav, engineVersions, renderRock, rockPlan, rockToMidi, verifyAudio, ROCK_RENDER_VERSION } from '@sonova/composition-engine';
import type { SpectroImage } from '@sonova/synthesis-engine';
import { ROCK_VERSION } from '@sonova/music-generator';
import { ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'SONOVA-ROCK-0001';
const seed = process.argv[2] ?? 'sonova-rock-0001';
const { dnas, sources } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const band = { guitar: bark, drums: tower, voice: sunset };
const song = generateRock(band, seed);

// The guitar's source picture, as luminance (row 0 = top) for the spectrogram painting.
const png = PNG.sync.read(readFileSync(sources[0].path));
const W = 160;
const H = 72;
const lum = new Float64Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const sx = Math.floor((x / W) * png.width);
    const sy = Math.floor((y / H) * png.height);
    const i = (sy * png.width + sx) * 4;
    lum[y * W + x] = (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
  }
const image: SpectroImage = { width: W, height: H, lum };

console.log(`${WORK} "${song.title}" ${song.bpm} BPM, ${song.durationSec.toFixed(1)} s, riff ${song.riffText}, CA ${song.caRules.map((r) => r.rule).join('→')}`);
const out = renderRock(song, band, image, 44100, (m) => process.stdout.write(`  · ${m}\n`));
const base = join(ROOT, 'output/rock', WORK);
const bytes = writeStereoWav(`${base}.wav`, out.buffer, seed);
writeFileSync(`${base}.mid`, rockToMidi(song));
const verification = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 180, maxPeakDbfs: -0.9, maxSilentRatio: 0.03 });
const plan = rockPlan(song, band);
const jb = join(ROOT, 'experiments/rock', WORK);
writeJson(`${jb}.song.json`, { workNumber: WORK, ...song, events: undefined, eventCount: song.events.length });
writeJson(`${jb}.events.json`, { workNumber: WORK, events: song.events });
writeJson(`${jb}.generation.json`, {
  workNumber: WORK,
  title: song.title,
  seed,
  engines: { ...engineVersions(), rock: ROCK_VERSION, rock_render: ROCK_RENDER_VERSION },
  band: { guitar: bark.instrument_id, drums: tower.instrument_id, voice: sunset.instrument_id },
  sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })),
  plan,
  derivations: song.derivations,
  techniques: [
    { technique: 'Extended Karplus–Strong strings + amp feedback (Jaffe & Smith 1983, Sullivan 1990)', used_for: 'guitar, bass, lead', reference: 'mrahtz/javascript-karplus-strong (ideas only, no licence), CCRMA EKS' },
    { technique: 'Wave Digital Filter diode clipper with Wright-ω (Werner et al. 2015, D\'Angelo et al. 2019)', used_for: 'amp distortion', reference: 'Chowdhury-DSP/chowdsp_wdf, jatinchowdhury18/KlonCentaur (BSD-3, studied, not copied)' },
    { technique: 'Modal synthesis: circular membrane (Bessel zeros) + rectangular plate', used_for: 'drums and cymbals', reference: 'baconpaul/ripplerx (GPL-3, ideas only)' },
    { technique: '1-D elementary cellular automaton as rhythm', used_for: 'hats, ghost notes, fills, breakdown, solo rhythm', reference: 'mhitchman/IMS (ideas only, no licence)' },
    { technique: 'Bytebeat (formula as instrument)', used_for: 'intro and breakdown', reference: 'greggman/html5bytebeat (MIT, studied)' },
    { technique: 'Image painted into the spectrogram', used_for: 'bridge (bark.png)', reference: 'LeviBorodenko/spectrographic (MIT, studied)' },
  ],
  render: { ms: out.renderMs, stems: out.stems, master: out.master },
});
writeJson(`${jb}.verification.json`, { workNumber: WORK, wav: rel(`${base}.wav`), verification });
console.log(`rendered in ${(out.renderMs / 1000).toFixed(1)} s · peak ${verification.peakDbfs} dBFS · RMS ${verification.rmsDbfs} dBFS · ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(', ')}`);
console.log(`stems ${JSON.stringify(out.stems)}`);
for (const c of song.chains.slice(0, 8)) console.log(`  ${c.time.toFixed(1)}s ${c.text}`);

// ---- Human-readable report ----
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nn = (m: number) => `${NOTE[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const md = `# ${WORK} — ${song.title}

自動生成: \`npm run rock\`。音声は \`output/rock/${WORK}.wav\`（Git 管理外、同じシードで再生成）。

- ${song.bpm} BPM · ${NOTE[song.key.root_pc]} minor · ${Math.floor(song.durationSec / 60)}分${Math.round(song.durationSec % 60)}秒 · シード \`${seed}\`
- バンド: **ギター** ← ${bark.source_name}（木の年輪） / **ドラム** ← ${tower.source_name}（建物の外壁） / **ベースとリード** ← ${sunset.source_name}（夕焼けの海）
- 検証: ${verification.ok ? 'OK' : 'NG'} · ${verification.durationSec}s · ${verification.sampleRate}Hz · ${verification.bitsPerSample}bit · ${verification.channels}ch · peak ${verification.peakDbfs} dBFS · RMS ${verification.rmsDbfs} dBFS · クリップ ${verification.clippedSamples}

## 構成

| 区間 | 開始 | 小節 | 内容 |
|---|---|---|---|
${song.sections.map((s) => `| ${s.name} | ${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')} | ${s.bars} | ${s.description} |`).join('\n')}

リフ (16分 × 16): \`${song.riffText}\`（R = 主音のパワーコード、P = 他のパワーコード、n = 単音、m = ミュート、. = 休符）。400 個の候補から「音数・裏拍のアクセント・音の種類・小節末の戻り」の点数で選んだ。

## 何から何が決まったか

| 決めたこと | 値 | 元 | 理由 |
|---|---|---|---|
${[...song.derivations, ...plan.derivations].map((d) => `| ${d.choice} | ${d.value} | ${d.from} | ${d.rule} |`).join('\n')}

## 使った手法（他の人の研究・リポジトリから。コードは写さず独自実装）

| 手法 | 曲での役割 |
|---|---|
| 拡張 Karplus–Strong の弦 6 本 + アンプ出力を弦へ戻す帰還 (Sullivan 1990) | ギター・ベース・リード。イントロ、サビ2の終わり、最後の和音でハウリング |
| Wave Digital Filter のダイオードクリッパー (Wright ω、2 倍オーバーサンプリング) | アンプの歪み。ギター gain ${plan.guitarAmp.gain}、リード ${plan.leadAmp.gain} |
| 円形膜 (ベッセル零点) と板のモーダル合成、張力変調によるピッチ降下 | キック ${plan.kit.kickHz} Hz、スネア ${plan.kit.snareHz} Hz、タム ${plan.kit.tomHz.join(' / ')} Hz、シンバルの板の縦横比 ${plan.kit.plateAspect} |
| 1 次元セルオートマトン (rule ${song.caRules.map((r) => r.rule).join(' → ')}) | ハイハット、ゴーストノート、フィル、ブレイクダウン、ソロのリズム |
| バイトビート \`${plan.bytebeat.formula}\` | イントロでリフを数式が先に鳴らす、ブレイクダウンで再登場 |
| 画像をスペクトログラムに描く (${plan.image.lowHz}–${plan.image.highHz} Hz、${plan.image.rows} 行) | ブリッジ: 木の年輪の画像 (bark.png) がスペクトログラムに現れる |

## 相互作用（因果ログより）

${Object.entries(song.stats.byRule).map(([k, v]) => `- ${k}: ${v} 回`).join('\n')}

${song.chains.filter((c, i, a) => a.findIndex((x) => x.text.replace(/[\d.]+s/g, '') === c.text.replace(/[\d.]+s/g, '')) === i).slice(0, 12).map((c) => `- **${Math.floor(c.time / 60)}:${(c.time % 60).toFixed(1).padStart(4, '0')}** ${c.text}`).join('\n')}

最低弦: ${nn(36 + song.key.root_pc)}（ドロップチューニング）。
`;
writeFileSync(join(ROOT, 'experiments/rock/REPORT.md'), md);
