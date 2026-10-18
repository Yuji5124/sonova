/** SONOVA 002 — 音が楽器を育てる. Usage: npm run s002 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeWav, encodeWav16, engineVersions, renderGrow, strikeBody, verifyAudio, GROW_VERSION } from '@sonova/composition-engine';
import { ROOT, buildInstruments, rel, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'SONOVA-GROW-0001';
const seed = process.argv[2] ?? 'sonova-grow-0001';
const { dnas, sources } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const t = Date.now();
const res = renderGrow({ player: bark, drone: sunset, body: tower }, seed);
const base = join(ROOT, 'output/s002', WORK);
const bytes = writeStereoWav(`${base}.wav`, res.buffer, seed);
const verification = verifyAudio(decodeWav(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 60, maxPeakDbfs: -0.9, maxSilentRatio: 0.05 });
const first = res.generations[0];
const last = res.generations[res.generations.length - 1];
for (const [name, g] of [['before', first], ['after', last]] as const) {
  const s = strikeBody(g.modes, 5);
  writeFileSync(`${base}.strike-${name}.wav`, encodeWav16([s, s], 44100));
}

// "Growth rings": mode frequency (log y) per generation (x), brightness = decay × gain.
const W = 960;
const H = 420;
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) png.data.set([12, 14, 20, 255], i * 4);
const fy = (hz: number) => Math.round(H - 10 - ((Math.log2(hz) - Math.log2(80)) / (Math.log2(4000) - Math.log2(80))) * (H - 20));
res.generations.forEach((g, k) => {
  const cx = Math.round(30 + (k / (res.generations.length - 1)) * (W - 60));
  for (const m of g.modes) {
    const y = fy(m.hz);
    const v = Math.min(1, (m.decay * m.gain) / 3);
    const r = 2 + Math.round(v * 6);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const yy = y + dy;
        if (x < 0 || x >= W || yy < 0 || yy >= H) continue;
        const i = (yy * W + x) * 4;
        const born = m.born === k && k > 0;
        png.data.set(born ? [120, 230, 160, 255] : [Math.round(120 + 135 * v), Math.round(80 + 120 * v), Math.round(40 + 40 * v), 255], i);
      }
  }
});
writeFileSync(join(ROOT, 'experiments/s002', `${WORK}.growth.png`), PNG.sync.write(png));

const jb = join(ROOT, 'experiments/s002', WORK);
const { buffer: _b, master: m, ...rest } = res;
void _b;
writeJson(`${jb}.json`, { workNumber: WORK, engines: { ...engineVersions(), grow: GROW_VERSION }, sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })), band: { player: bark.instrument_id, drone: sunset.instrument_id, body: tower.instrument_id }, master: m, verification, ...rest });
const counts = res.changes.reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});
console.log(`${WORK} ${res.bpm} BPM ${res.generations.length} gens ${res.durationSec}s render ${((Date.now() - t) / 1000).toFixed(1)}s ${verification.ok ? 'OK' : 'NG ' + verification.problems.join(',')} peak ${verification.peakDbfs} rms ${verification.rmsDbfs}`);
console.log('changes', counts);
for (const g of res.generations) console.log(`  gen ${String(g.gen).padStart(2)} harmonicity ${g.metrics.harmonicity.toFixed(3)} decay ${g.metrics.meanDecay.toFixed(2)}s f0 ${g.metrics.lowestStrongHz.toFixed(1)} pcs ${g.metrics.distinctPitchClasses} melody ${g.melody.map((n) => n.midi).join(' ')}`);

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const md = `# ${WORK} — 音が楽器を育てる

自動生成: \`npm run s002\`。音声 \`output/s002/${WORK}.wav\`（${Math.round(res.durationSec)}秒）、育つ前と後の打音 \`.strike-before.wav\` / \`.strike-after.wav\`。

**原理**: 外壁の画像から作った「共鳴する板」（${first.modes.length} モード）を、木の楽器（旋律）と夕焼けの楽器（ドローン）が鳴らし、板自身も拍ごとに打たれる。
板は 2 小節ごとに自分の鳴り方を聴いて変わる。

| 規則 | 条件 | 変化 | 回数 |
|---|---|---|---|
| grow | よく鳴った上位 25% のモード | 響きが 1.25 倍長く、少し大きく | ${counts.grow ?? 0} |
| tune | 中央値以上に鳴ったモード | 弾かれた音 (とその倍音) に 35% 近づく | ${counts.tune ?? 0} |
| starve | 鳴らなかった下位 25% | 響きが短く、小さく | ${counts.starve ?? 0} |
| reborn | 響きが 0.12 秒を切ったモード | 死んで、聴こえた音のピークのうち楽器にない周波数で生まれ直す | ${counts.reborn ?? 0} |

次のフレーズの旋律は、板のいちばん強いモードから選ぶ（15% は5度跳ぶ「好奇心」）。楽器が旋律を変え、旋律が楽器を変える。

![growth rings](${WORK}.growth.png)

横 = 世代、縦 = 周波数 (対数)、明るさ = 響きの長さ × 大きさ、緑 = 生まれ直したモード。

| 世代 | 調和度 | 平均の響き | 最低の強いモード | 強いモードの音名の種類 | 旋律 |
|---|---|---|---|---|---|
${res.generations.map((g) => `| ${g.gen} | ${g.metrics.harmonicity.toFixed(3)} | ${g.metrics.meanDecay.toFixed(2)}s | ${g.metrics.lowestStrongHz.toFixed(1)}Hz | ${g.metrics.distinctPitchClasses} | ${g.melody.map((n) => NOTE[n.midi % 12]).join(' ')} |`).join('\n')}

調和度 = 強い 8 モードが最低モードの整数倍にどれだけ近いか (1 = 完全な倍音列)。

## 変化の記録（抜粋）

${res.changes.filter((c) => c.kind === 'reborn').slice(0, 10).map((c) => `- 世代 ${c.gen}: **reborn** ${c.from} → ${c.to} — ${c.cause}`).join('\n')}
${res.changes.filter((c) => c.kind === 'tune').slice(0, 8).map((c) => `- 世代 ${c.gen}: tune #${c.mode} ${c.from} → ${c.to} — ${c.cause}`).join('\n')}

全 ${res.changes.length} 件は \`${WORK}.json\` の \`changes\`。検証: ${verification.ok ? 'OK' : 'NG'} · peak ${verification.peakDbfs} dBFS · RMS ${verification.rmsDbfs} dBFS。
`;
writeFileSync(join(ROOT, 'experiments/s002/REPORT.md'), md);
console.log(rel(`${base}.wav`));
