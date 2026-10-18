/** SONOVA 004 — 音が空間を作る. Usage: npm run s004 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeWav, engineVersions, renderSpace, spaceToGltf, verifyAudio, SPACE_VERSION } from '@sonova/composition-engine';
import { ROOT, buildInstruments, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'SONOVA-SPACE-0001';
const seed = process.argv[2] ?? 'sonova-space-0001';
const { dnas, sources } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const t = Date.now();
const res = renderSpace({ melody: bark, drone: sunset, walls: tower }, seed);
const base = join(ROOT, 'output/s004', WORK);
const verification = verifyAudio(decodeWav(writeStereoWav(`${base}.wav`, res.buffer, seed)), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 60, maxPeakDbfs: -0.9, maxSilentRatio: 0.05 });
const dir = join(ROOT, 'experiments/s004');
writeFileSync(join(dir, `${WORK}.gltf`), spaceToGltf(res));

// Floor plans (top view, Lx × Ly) of every generation, early = blue → late = orange.
const W = 720;
const H = 560;
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) png.data.set([12, 14, 20, 255], i * 4);
const maxX = Math.max(...res.generations.map((g) => g.room.L[0]));
const maxY = Math.max(...res.generations.map((g) => g.room.L[1]));
const sc = Math.min((W - 40) / maxX, (H - 40) / maxY);
res.generations.forEach((g, k) => {
  const u = k / (res.generations.length - 1);
  const col = [Math.round(90 + 150 * u), Math.round(160 - 40 * u), Math.round(230 - 180 * u), 255];
  const w = g.room.L[0] * sc;
  const h = g.room.L[1] * sc;
  const x0 = 20;
  const y0 = H - 20 - h;
  for (let x = Math.round(x0); x <= Math.round(x0 + w); x++) for (const y of [Math.round(y0), Math.round(y0 + h)]) if (x < W && y >= 0 && y < H) png.data.set(col, (y * W + x) * 4);
  for (let y = Math.round(y0); y <= Math.round(y0 + h); y++) for (const x of [Math.round(x0), Math.round(x0 + w)]) if (x < W && y >= 0 && y < H) png.data.set(col, (y * W + x) * 4);
});
writeFileSync(join(dir, `${WORK}.floorplans.png`), PNG.sync.write(png));

const { buffer, master: m, ...rest } = res;
void buffer;
writeJson(join(dir, `${WORK}.json`), { workNumber: WORK, engines: { ...engineVersions(), space: SPACE_VERSION }, sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })), band: { melody: bark.instrument_id, drone: sunset.instrument_id, walls: tower.instrument_id }, master: m, verification, ...rest });
console.log(`${WORK} ${res.durationSec}s render ${((Date.now() - t) / 1000).toFixed(1)}s ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(',')} peak ${verification.peakDbfs} rms ${verification.rmsDbfs}`);
for (const g of res.generations) console.log(`  gen ${String(g.gen).padStart(2)} L ${g.room.L.map((x) => x.toFixed(2)).join('×')} α ${g.room.absorption.toFixed(2)} RT60 ${g.rt60.toFixed(2)}s drone ${g.drone.hz.toFixed(1)}Hz (${g.drone.mode.join(',')}) slots ${g.rhythmSlots.join(',')} heard L/M/H ${g.heard.lowShare}/${g.heard.midShare}/${g.heard.highShare}`);

const md = `# ${WORK} — 音が空間を作る

自動生成: \`npm run s004\`。音声 \`output/s004/${WORK}.wav\`（${Math.round(res.durationSec)} 秒）、部屋の 3D アニメーション [\`${WORK}.gltf\`](${WORK}.gltf)（Blender / three.js で開ける）。

**原理**: 直方体の部屋が楽器であり楽譜でもある。

- **空間 → 音**: 部屋の共鳴モード f = c/2·√((nx/Lx)²+(ny/Ly)²+(nz/Lz)²) を、そのまま (12平均律に丸めず) 旋律とドローンの音高にする。旋律の音源から聴き手までの**初期反射の到着時刻**の並びを 16 分のリズムにする。すべての音を部屋の中で鳴らす (2 つの耳への鏡像音源 3 次反射 + Sabine の残響時間に合わせた残響)
- **音 → 空間**: 生成ごとに聴こえた音の低音・中音・高音の比率と明るさを測り、低音 → 幅 (Lx)、中音 → 奥行き (Ly)、高音 → 天井 (Lz)、明るさ → 壁の硬さ (吸音率) を変える。変形した部屋が次の音高とリズムを決める

最初の部屋: ${res.derivations.map((d) => `${d.choice} = ${d.value} (${d.rule})`).join('、')}。

![floor plans](${WORK}.floorplans.png)

上から見た部屋の変化（青 = 最初 → 橙 = 最後）。

| 生成 | 幅×奥行き×高さ (m) | 吸音率 | RT60 | ドローン (モード) | リズム (16分の位置) | 聴こえた 低/中/高 |
|---|---|---|---|---|---|---|
${res.generations.map((g) => `| ${g.gen} | ${g.room.L.map((x) => x.toFixed(2)).join(' × ')} | ${g.room.absorption.toFixed(2)} | ${g.rt60.toFixed(2)}s | ${g.drone.hz.toFixed(1)} Hz (${g.drone.mode.join(',')}) | ${g.rhythmSlots.join(' ')} | ${(g.heard.lowShare * 100).toFixed(0)} / ${(g.heard.midShare * 100).toFixed(0)} / ${(g.heard.highShare * 100).toFixed(0)} % |`).join('\n')}

旋律の音は部屋のモードなので 12 平均律からずれる (例: 生成 0 の最初の 6 音 ${res.generations[0].melody.slice(0, 6).map((n) => `${n.hz.toFixed(1)}Hz (${n.cents >= 0 ? '+' : ''}${n.cents}¢)`).join(', ')})。

## 変形の記録（抜粋）

${res.changes.slice(0, 16).map((c) => `- 生成 ${c.gen}: ${c.param} ${c.from} → ${c.to} — ${c.cause}`).join('\n')}

全 ${res.changes.length} 件は \`${WORK}.json\`。検証: ${verification.ok ? 'OK' : 'NG'} · peak ${verification.peakDbfs} dBFS · RMS ${verification.rmsDbfs} dBFS。
`;
writeFileSync(join(dir, 'REPORT.md'), md);
