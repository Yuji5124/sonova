/** Writes experiments/REPORT.md from the committed Phase 1/2 JSON (run after phase1 + phase2). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstrumentDNA } from '@sonova/instrument-dna';
import type { StructureDoc } from '@sonova/composition-engine';
import { ROOT } from './lib.ts';

const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nn = (m: number) => `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`;
const names = ['bark', 'tower', 'sunset'];
const dnas: InstrumentDNA[] = names.map((n) => read(`experiments/phase1/dna/${n}.dna.json`));
const feats = names.map((n) => read(`experiments/phase1/features/${n}.features.json`).features);
const p1 = read('experiments/phase1/summary.json');
const p2 = read('experiments/phase2/summary.json');

let md = `# SONOVA 実験レポート (Phase 1–2)

自動生成: \`npx tsx scripts/report.ts\`。数値はすべて \`experiments/phase1\`・\`experiments/phase2\` の JSON から。

## Phase 1 — 画像 3 枚 → 3 つの楽器

| | bark (木の年輪) | tower (建物の外壁) | sunset (夕焼けの海) |
|---|---|---|---|
| 素材 sha256 | ${dnas.map((d) => `\`${d.source_hash.slice(0, 12)}…\``).join(' | ')} |
| instrument_id | ${dnas.map((d) => `\`${d.instrument_id}\``).join(' | ')} |
| dna_hash | ${dnas.map((d) => `\`${d.dna_hash}\``).join(' | ')} |
| 平均輝度 / コントラスト | ${feats.map((f) => `${f.meanLuminance.toFixed(2)} / ${f.contrast.toFixed(2)}`).join(' | ')} |
| 彩度 / 色の豊かさ | ${feats.map((f) => `${f.meanSaturation.toFixed(2)} / ${f.colorfulness.toFixed(2)}`).join(' | ')} |
| エッジ強度 / 粗さ | ${feats.map((f) => `${f.edgeMean.toFixed(3)} / ${f.textureRoughness.toFixed(3)}`).join(' | ')} |
| 反復の強さ (横 / 縦) | ${feats.map((f) => `${f.strengthX.toFixed(2)} / ${f.strengthY.toFixed(2)}`).join(' | ')} |
| 高い空間周波数の比率 | ${feats.map((f) => f.highFreqRatio.toFixed(3)).join(' | ')} |
| → 音域 | ${dnas.map((d) => `${nn(d.pitch_range.low)}–${nn(d.pitch_range.high)}`).join(' | ')} |
| → Attack / Decay | ${dnas.map((d) => `${d.attack.toFixed(3)}s / ${d.decay.toFixed(2)}s`).join(' | ')} |
| → 明るさ / ノイズ | ${dnas.map((d) => `${d.harmonics.brightness.toFixed(2)} / ${d.noise.amount.toFixed(2)}`).join(' | ')} |
| → 共鳴 | ${dnas.map((d) => d.resonance.amount.toFixed(2)).join(' | ')} |
| → リズム | ${dnas.map((d) => `E(${d.rhythm.pulses},${d.rhythm.steps}) ×${d.rhythm.rate}`).join(' | ')} |
| → FM 比 / 深さ | ${dnas.map((d) => `${d.modulation.fm_ratio.toFixed(2)} / ${d.modulation.fm_index.toFixed(2)}`).join(' | ')} |
| → 反応ルール | ${dnas.map((d) => d.interaction_rules.responses.map((r) => `${r.effect} ${r.strength.toFixed(2)}`).join(', ')).join(' | ')} |
| 試聴 WAV 検証 | ${p1.instruments.map((s: any) => `${s.verification.ok ? 'OK' : 'NG'} peak ${s.verification.peakDbfs} dBFS`).join(' | ')} |

役割はコードに書いていない。特徴量から決まった:
木目の細かい不規則なエッジ → **リズムを生む楽器**、外壁の縦横の格子 → **共鳴する楽器**、夕焼けの彩度と滑らかさ → **音色が変わる楽器**。

### 特徴 → 音の対応 (bark の例、全項目は各 DNA の \`mapping\`)

| パラメータ | 値 | 素材の特徴 | 理由 |
|---|---|---|---|
${dnas[0].mapping.map((m) => `| \`${m.parameter}\` | ${m.value} | ${m.features.join(', ')} | ${m.rule} |`).join('\n')}

## Phase 2 — 3 楽器の相互作用による 30 秒 × 3 候補

| 作品番号 | 曲名 | 展開 | BPM | 旋法 | 音 | 共鳴 | 変化 | 最大連鎖 | 相互作用 (ルール別) | peak / RMS |
|---|---|---|---|---|---|---|---|---|---|---|
${p2.candidates.map((c: any) => `| ${c.workNumber} | ${c.title} | ${c.arc} | ${c.bpm} | ${c.key.split('/')[1]} | ${c.stats.notes} | ${c.stats.resonances} | ${c.stats.mutations} | ${c.stats.maxDepthReached} | ${Object.entries(c.stats.byRule).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')} | ${c.verification.peakDbfs} / ${c.verification.rmsDbfs} dBFS |`).join('\n')}
`;

for (const c of p2.candidates) {
  const s: StructureDoc = read(`experiments/phase2/${c.workNumber}.structure.json`);
  md += `\n### ${c.workNumber} ${c.title}\n\n`;
  md += `構成: ${s.sections.map((x) => `**${x.name}** ${x.start}–${x.end}s`).join(' → ')}\n\n`;
  md += `楽器間の相互作用回数: ${Object.entries(s.interaction.byPair).map(([k, v]) => `${k.replace(/\d/g, (d) => names[Number(d)])} ${v}`).join(', ')}\n\n`;
  md += `なぜこう鳴ったか (因果の連鎖):\n\n${s.chains.slice(0, 6).map((ch) => `- **${ch.time.toFixed(2)}s** ${ch.text}`).join('\n')}\n`;
}
writeFileSync(join(ROOT, 'experiments/REPORT.md'), md);
console.log('wrote experiments/REPORT.md');
