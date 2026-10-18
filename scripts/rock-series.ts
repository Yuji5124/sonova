/**
 * SONOVA 002–004 as rock songs, on the SONOVA-ROCK-0001 band (bark → guitar, tower → drums, sunset → bass & lead).
 *   npm run rock:series -- grow|heal|space   (each ≈2–4 min; no argument = all three)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  decodeWav,
  engineVersions,
  renderRockGrow,
  renderRockHeal,
  renderRockSpace,
  rockToMidi,
  verifyAudio,
  ROCK_RENDER_VERSION,
  ROCK_SERIES_VERSION,
  type RockRenderResult,
} from '@sonova/composition-engine';
import { ROCK_VERSION, type RockSong } from '@sonova/music-generator';
import type { SpectroImage } from '@sonova/synthesis-engine';
import { ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const which = process.argv[2] ?? 'all';
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

const OUT = join(ROOT, 'output/rock-series');
const EXP = join(ROOT, 'experiments/rock-series');
mkdirSync(OUT, { recursive: true });
mkdirSync(EXP, { recursive: true });
const log = (m: string) => process.stdout.write(`  · ${m}\n`);
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function save(work: string, seed: string, song: RockSong, render: RockRenderResult, extra: Record<string, unknown>) {
  const base = join(OUT, work);
  const bytes = writeStereoWav(`${base}.wav`, render.buffer, seed);
  writeFileSync(`${base}.mid`, rockToMidi(song));
  const verification = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 150, maxPeakDbfs: -0.9, maxSilentRatio: 0.03 });
  writeJson(join(EXP, `${work}.json`), {
    workNumber: work,
    title: song.title,
    seed,
    engines: { ...engineVersions(), rock: ROCK_VERSION, rock_render: ROCK_RENDER_VERSION, rock_series: ROCK_SERIES_VERSION },
    band: { guitar: bark.instrument_id, drums: tower.instrument_id, voice: sunset.instrument_id },
    sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })),
    bpm: song.bpm,
    key: song.key,
    durationSec: song.durationSec,
    sections: song.sections.map((s) => ({ name: s.name, start: s.start, bars: s.bars })),
    derivations: song.derivations,
    render: { ms: render.renderMs, stems: render.stems, master: render.master },
    verification,
    wav: rel(`${base}.wav`),
    ...extra,
  });
  console.log(`${work} "${song.title}" ${song.bpm} BPM ${NOTE[song.key.root_pc]} minor ${song.durationSec.toFixed(1)}s · render ${(render.renderMs / 1000).toFixed(1)}s · peak ${verification.peakDbfs} RMS ${verification.rmsDbfs} · ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(',')}`);
  return verification;
}

const header = (work: string, song: RockSong, seed: string, v: { ok: boolean; peakDbfs: number; rmsDbfs: number }) => `# ${work} — ${song.title}

自動生成: \`npm run rock:series\`。音声 \`output/rock-series/${work}.wav\` / \`.mid\`（Git 管理外、同じシードで再生成）。

- ${song.bpm} BPM · ${NOTE[song.key.root_pc]} minor · ${mmss(song.durationSec)} · シード \`${seed}\` · 検証 ${v.ok ? 'OK' : 'NG'} (peak ${v.peakDbfs} dBFS, RMS ${v.rmsDbfs} dBFS)
- バンドは SONOVA-ROCK-0001 と同じ: ギター ← 木の年輪 / ドラム ← 建物の外壁 / ベースとリード ← 夕焼けの海

| 決めたこと | 値 | 元 | 理由 |
|---|---|---|---|
${song.derivations.filter((d) => d.from === 'series' || /bpm|tempo|key|root/i.test(d.choice)).map((d) => `| ${d.choice} | ${d.value} | ${d.from} | ${d.rule} |`).join('\n')}
`;

const reports: string[] = [];

if (which === 'all' || which === 'grow') {
  const work = 'SONOVA-ROCK-GROW-0001';
  const seed = 'sonova-rock-grow-0001';
  const r = renderRockGrow(band, seed, image, log);
  const v = save(work, seed, r.song, r.render, { bodies: r.bodies, changes: r.changes, leadFromBody: r.leadFromBody });
  const counts = (k: string) => r.changes.filter((c) => c.kind === k).length;
  const md = `${header(work, r.song, seed, v)}
## 原理（SONOVA 002 のロック版）: 音が楽器を育てる

ギターアンプの後ろに、外壁の画像から作った**共鳴板** (${r.bodies[0].modes.length} モード) を置く。区間ごとにギターとベースの実際の音声を聴いて板が育つ:
よく鳴ったモードは減衰が長くなり (grow)、弾かれた音程へ寄り (tune)、鳴らないモードは痩せて (starve)、死んだら「聴こえたのに板になかった周波数」で生まれ直す (reborn)。
**次の区間のリードの音程は、その時点の板の強いモードから選ぶ** (${r.leadFromBody} 音)。板の響きは −22 dB でミックスに戻る。

変化: grow ${counts('grow')} · tune ${counts('tune')} · starve ${counts('starve')} · reborn ${counts('reborn')}

| 区間 | 開始 | 板の強いモード (上位 5, Hz) | 平均減衰 (s) |
|---|---|---|---|
${r.bodies.map((b) => `| ${b.section} | ${mmss(b.start)} | ${[...b.modes].sort((x, y) => y.gain - x.gain).slice(0, 5).map((m) => m.hz.toFixed(1)).join(', ')} | ${(b.modes.reduce((s, m) => s + m.decay, 0) / b.modes.length).toFixed(2)} |`).join('\n')}

### 変化の記録（抜粋）

${r.changes.filter((c) => c.kind === 'reborn' || c.kind === 'tune').slice(0, 14).map((c) => `- 区間 ${c.gen}: モード ${c.mode} ${c.kind} ${c.from} → ${c.to} — ${c.cause}`).join('\n')}
`;
  reports.push(md);
  writeFileSync(join(EXP, `${work}.md`), md);
}

if (which === 'all' || which === 'heal') {
  const work = 'SONOVA-ROCK-HEAL-0001';
  const seed = 'sonova-rock-heal-0001';
  const r = renderRockHeal(band, seed, image, true, log);
  const v = save(work, seed, r.song, r.render, { faults: r.faults, events: r.events, health: r.health });
  const b = renderRockHeal(band, seed, image, false, log);
  const vb = save(`${work}.broken`, seed, b.song, b.render, { faults: b.faults, events: b.events, health: b.health, note: '修復なし (比較用)' });
  // Health per bar: repaired (orange) vs broken (blue).
  const CW = 960;
  const CH = 240;
  const chart = new PNG({ width: CW, height: CH });
  for (let i = 0; i < CW * CH; i++) chart.data.set([12, 14, 20, 255], i * 4);
  const n = r.health.length;
  const plot = (hs: typeof r.health, col: number[]) =>
    hs.forEach((h, i) => {
      const x0 = Math.round((i / n) * CW);
      const x1 = Math.round(((i + 1) / n) * CW);
      const y = Math.round((1 - h.health) * (CH - 20)) + 10;
      for (let x = x0; x < x1; x++) for (let d = -1; d <= 1; d++) if (y + d >= 0 && y + d < CH) chart.data.set(col, ((y + d) * CW + x) * 4);
    });
  plot(b.health, [90, 160, 230, 255]);
  plot(r.health, [240, 140, 50, 255]);
  writeFileSync(join(EXP, `${work}.health.png`), PNG.sync.write(chart));
  const mean = (hs: typeof r.health) => {
    const f = hs.filter((h) => r.faults.some((ft) => h.bar >= ft.startBar && h.bar < ft.startBar + ft.bars));
    return (f.reduce((s, h) => s + h.health, 0) / Math.max(1, f.length)).toFixed(3);
  };
  const md = `${header(work, r.song, seed, v)}
## 原理（SONOVA 003 のロック版）: 音楽が自分を修復する

バンドに 5 つの故障を仕込み、聴き手が毎小節の**実際の音声**を楽譜と照らして聴く。欠落なら別の楽器が役を引き受け、半音ずれならベースが根音を変えて間違った音を和音の音にする。戻ったのを聴いたら補完をやめる。
比較用に修復なし版 \`${work}.broken.wav\` (検証 ${vb.ok ? 'OK' : 'NG'}) も書き出す。

| 故障 | 区間 | 小節 | 内容 |
|---|---|---|---|
${r.faults.map((f) => `| ${f.part} ${f.kind} | ${f.section} | ${f.startBar}–${f.startBar + f.bars - 1} | ${f.story} |`).join('\n')}

![health](${work}.health.png)

小節ごとの健全度（橙 = 修復あり、青 = 修復なし）。故障中の平均: 修復あり **${mean(r.health)}** / 修復なし **${mean(b.health)}**。

### 聴き手の記録

${r.events.map((e) => `- ${mmss(e.time)} (小節 ${e.bar}) **${e.kind}** ${e.part}${e.by ? ` ← ${e.by}` : ''}: ${e.text}`).join('\n')}
`;
  reports.push(md);
  writeFileSync(join(EXP, `${work}.md`), md);
}

if (which === 'all' || which === 'space') {
  const work = 'SONOVA-ROCK-SPACE-0001';
  const seed = 'sonova-rock-space-0001';
  const r = renderRockSpace(band, seed, image, log);
  const v = save(work, seed, r.song, r.render, { rooms: r.rooms, changes: r.changes, microtonalLead: r.microtonalLead });
  const md = `${header(work, r.song, seed, v)}
## 原理（SONOVA 004 のロック版）: 音が空間を作る

外壁の画像から最初の部屋 (ライブハウス) を作る。**部屋の最低モードに最も近い音名が曲のキー**、**部屋の幅を 2 往復する時間が 16 分音符** (= テンポ)。
リードの音は 70 セント以内にある部屋のモードへ吸い寄せられ、12 平均律からずれる (${r.microtonalLead} 音)。
バンドは区間ごとにその部屋の中で鳴る (5 つの音源 → 2 つの耳への鏡像音源 2 次反射、近接マイク 25% + 部屋 75%、残響は RT60 に比例)。
区間の終わりに、聴こえた低・中・高音の比率と音量で部屋の形・体積・壁の硬さが変わる (1 区間 ±25% まで)。

| 区間 | 開始 | 幅×奥行き×高さ (m) | 吸音率 | RT60 | 最低モード | 聴こえた 低/中/高 |
|---|---|---|---|---|---|---|
${r.rooms.map((g) => `| ${g.section} | ${mmss(g.start)} | ${g.room.L.map((x) => x.toFixed(2)).join(' × ')} | ${g.room.absorption.toFixed(2)} | ${g.rt60.toFixed(2)}s | ${g.lowestModeHz.toFixed(1)} Hz | ${(g.heard.low * 100).toFixed(0)} / ${(g.heard.mid * 100).toFixed(0)} / ${(g.heard.high * 100).toFixed(0)} % |`).join('\n')}

### 変形の記録（抜粋）

${r.changes.slice(0, 16).map((c) => `- ${c.section}: ${c.param} ${c.from} → ${c.to} — ${c.cause}`).join('\n')}
`;
  reports.push(md);
  writeFileSync(join(EXP, `${work}.md`), md);
}
