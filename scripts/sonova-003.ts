/** SONOVA 003 — 音楽が自分を修復する. Usage: npm run s003 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeWav, engineVersions, renderHeal, verifyAudio, HEAL_VERSION } from '@sonova/composition-engine';
import { ROOT, buildInstruments, writeJson, writeStereoWav } from './lib.ts';

const WORK = 'SONOVA-HEAL-0001';
const seed = process.argv[2] ?? 'sonova-heal-0001';
const { dnas, sources } = await buildInstruments();
const [bark, tower, sunset] = dnas;
const band = { bass: sunset, pad: tower, melody: bark };
const t = Date.now();
const healed = renderHeal(band, seed, { repair: true });
const broken = renderHeal(band, seed, { repair: false });
const base = join(ROOT, 'output/s003', WORK);
const vh = verifyAudio(decodeWav(writeStereoWav(`${base}.wav`, healed.buffer, seed)), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 60, maxPeakDbfs: -0.9, maxSilentRatio: 0.05 });
const vb = verifyAudio(decodeWav(writeStereoWav(`${base}.broken.wav`, broken.buffer, seed)), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 60, maxPeakDbfs: -0.9, maxSilentRatio: 0.05 });

// Health per bar: broken (red) vs repaired (green); faults shaded.
const W = 960;
const H = 260;
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) png.data.set([14, 16, 22, 255], i * 4);
const bars = healed.metrics.length;
const bw = (W - 40) / bars;
const rect = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) png.data.set(c, (y * W + x) * 4);
};
for (const f of healed.faults) rect(20 + f.startBar * bw, 10, 20 + (f.startBar + f.bars) * bw, H - 10, f.kind === 'dropout' ? [40, 34, 60, 255] : [60, 34, 40, 255]);
const yv = (h: number) => H - 20 - h * (H - 40);
healed.metrics.forEach((m, i) => {
  const hb = broken.metrics[i].health;
  rect(20 + i * bw + 2, yv(hb), 20 + i * bw + bw / 2, H - 20, [230, 90, 90, 255]);
  rect(20 + i * bw + bw / 2, yv(m.health), 20 + (i + 1) * bw - 2, H - 20, [110, 210, 150, 255]);
});
writeFileSync(join(ROOT, 'experiments/s003', `${WORK}.health.png`), PNG.sync.write(png));

const strip = (r: typeof healed) => {
  const { buffer, ...rest } = r;
  void buffer;
  return rest;
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const inFault = (bar: number) => healed.faults.some((f) => bar >= f.startBar && bar < f.startBar + f.bars + 1);
const faultBars = healed.metrics.filter((m) => inFault(m.bar)).map((m) => m.bar);
const summary = {
  healthAll: { broken: +avg(broken.metrics.map((m) => m.health)).toFixed(3), healed: +avg(healed.metrics.map((m) => m.health)).toFixed(3) },
  healthDuringFaults: { broken: +avg(faultBars.map((b) => broken.metrics[b].health)).toFixed(3), healed: +avg(faultBars.map((b) => healed.metrics[b].health)).toFixed(3) },
  detected: healed.events.filter((e) => e.kind === 'detect').length,
  repairs: healed.events.filter((e) => e.kind === 'repair').length,
  recoveries: healed.events.filter((e) => e.kind === 'recover').length,
};
writeJson(join(ROOT, 'experiments/s003', `${WORK}.json`), { workNumber: WORK, engines: { ...engineVersions(), heal: HEAL_VERSION }, sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })), band: { bass: sunset.instrument_id, pad: tower.instrument_id, melody: bark.instrument_id }, summary, verification: { healed: vh, broken: vb }, healed: strip(healed), broken: { metrics: broken.metrics } });
console.log(`${WORK} ${healed.durationSec}s render ${((Date.now() - t) / 1000).toFixed(1)}s healed ${vh.ok ? 'OK' : vh.problems} broken ${vb.ok ? 'OK' : vb.problems}`);
console.log(JSON.stringify(summary));
for (const e of healed.events) console.log(`  bar ${String(e.bar).padStart(2)} ${e.kind.padEnd(7)} ${e.text}`);

const md = `# ${WORK} — 音楽が自分を修復する

自動生成: \`npm run s003\`。修復あり \`output/s003/${WORK}.wav\`、比較用の修復なし \`${WORK}.broken.wav\`（どちらも ${Math.round(healed.durationSec)} 秒、同じ故障）。

**原理**: 夕焼け (ベース)・外壁 (和音)・木 (旋律) が C minor の i–bVI–bIII–bVII を演奏する。シードで決まる故障が「欠落」と「不協和」を起こす。
聴き手は 1 小節ごとに**実際にレンダリングされた音声**を FFT で聴き、楽譜と照らして判断する（故障の情報は読まない）。

- 欠落の検出: 各パートが楽譜で弾くはずの音高のエネルギーが、健全な小節の中央値より 10 dB 以上低い
- 不協和の検出: 元の和音にも調にもない音高のエネルギーが 12% (または普段 + 10%) を超える
- 修復 (1 小節後から): 旋律の欠落 → 和音の楽器が 1 オクターブ下で引き受ける / ベースの欠落 → 和音の楽器が根音を弾く / 和音の欠落 → 旋律の楽器がアルペジオ / 不協和 → ベースが根音を変えて、ずれた音を和音の音にする
- 回復: 元のパートの音高が戻った (または ずれが消えた) のを聴いたら補完をやめる

![health](${WORK}.health.png)

小節ごとの健全度（赤 = 修復なし、緑 = 修復あり、紫の帯 = 欠落、赤い帯 = 不協和の故障区間）。

| | 修復なし | 修復あり |
|---|---|---|
| 健全度の平均 (全体) | ${summary.healthAll.broken} | ${summary.healthAll.healed} |
| 健全度の平均 (故障区間 + 1 小節) | ${summary.healthDuringFaults.broken} | ${summary.healthDuringFaults.healed} |

健全度 = 1 − 欠けたパート数/3 − 不協和なら 0.4 − 鳴っている和声の外の音の比率。

## 故障・検出・修復・回復の記録

| 小節 | 種類 | 内容 |
|---|---|---|
${healed.events.map((e) => `| ${e.bar} | ${e.kind} | ${e.text}${e.cause !== undefined ? ` (← #${e.cause})` : ''} |`).join('\n')}

検出 ${summary.detected} 回、修復 ${summary.repairs} 回、回復 ${summary.recoveries} 回。注入した故障は ${healed.faults.length} 件:
${healed.faults.map((f) => `${f.part} の${f.kind === 'dropout' ? '欠落' : '不協和'} (小節 ${f.startBar}〜${f.startBar + f.bars - 1})`).join('、')}。
`;
writeFileSync(join(ROOT, 'experiments/s003/REPORT.md'), md);
