/** SONOVA v1.1 report from experiments/v11/evaluation.json and phase2.json.   npm run v11:report */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.ts';

const EXP = join(ROOT, 'experiments/v11');
const ev = JSON.parse(readFileSync(join(EXP, 'evaluation.json'), 'utf8'));
const p2 = JSON.parse(readFileSync(join(EXP, 'phase2.json'), 'utf8'));
const R = ev.results as Record<string, { dna: Record<string, never>; fidelity: { pairs: Array<{ name: string; rho: number }>; mean: number } }>;
const names = Object.keys(R);
const v10 = R['v1.0'];
const v11 = R['v1.1'];
const f = (x: number, d = 3) => x.toFixed(d);
const row = (label: string, get: (r: (typeof R)[string]) => string) => `| ${label} | ${names.map((n) => get(R[n])).join(' | ')} |`;
const PART: Record<string, string> = { continuity: '途切れない', arc: '形 (アーク) に沿う', consonance: '協和', motif: '動機の記憶', interplay: '掛け合い', balance: '楽器のバランス', ending: '終わり方', dynamics: '音量の起伏' };

const md = `# SONOVA v1.1 — 写真 → 楽器の精度、相互作用、30秒の候補曲

自動生成: \`npm run v11:eval\` → \`npm run v11:phase2\` → \`npm run v11:report\`。数値はすべて \`experiments/v11/evaluation.json\`・\`phase2.json\` から。
v1.0 (\`analyzeImage\`・\`createImageDNA\`・\`generate\`) は変えていない。v1.0 の楽器の DNA ハッシュと SONOVA-EXP-0001 の音は公開時と同じであることをテストで確認している (\`tests/v11.test.ts\`)。

## 1. 写真 → 楽器: どう測ったか

実在の写真の代わりに、手続き的に描いた **${ev.corpus.materials.length} 素材 × ${ev.corpus.instances} 枚** のテスト画像 (${ev.corpus.materials.map((m: { description: string }) => m.description).join('・')}) を使う。同じ素材の2枚は種と細部が違う (2つの違うレンガの壁のように)。
各画像に「楽器が変わってはいけない」6つの加工 (${ev.corpus.transforms.map((t: { description: string }) => t.description).join('・')}) をかけ、DNA の主要 ${'25'} パラメータの距離を測る (距離 1 ≒ 違う写真どうしの典型的な差)。

| 指標 | ${names.join(' | ')} |
|---|${names.map(() => '---').join('|')}|
${row('加工による DNA の変化 ÷ 写真どうしの差 (小さいほど頑丈)', (r) => f(r.dna.robustnessRatio))}
${row('加工後も元の写真の楽器だと特定できる率', (r) => f(r.dna.identification))}
${row('いちばん近い楽器が同じ素材のもう1枚である率', (r) => f(r.dna.category))}
${row('離散的な選択 (主音・リズム・反応ルール…) が加工で変わる率', (r) => f(r.dna.flipRate))}
${row('　うち主音が変わる率', (r) => f((r.dna.flips as Record<string, number>).root_pc))}
${row('画像と音の対応 (順位相関の平均、1 が完全)', (r) => f(r.fidelity.mean))}

加工ごとの DNA の変化 (v1.0 → v1.1): ${Object.keys(v10.dna.nuisance).map((k) => `${k} ${f((v10.dna.nuisance as Record<string, number>)[k])} → ${f((v11.dna.nuisance as Record<string, number>)[k])}`).join('、')}

### 画像と音の対応 (実際に鳴らして測る)

各楽器で A3 を 0.8 秒鳴らし、音を測って、画像の特徴との順位相関 (Spearman) を取った (${ev.corpus.materials.length * ev.corpus.instances} 枚)。

| 対応 | ${names.join(' | ')} |
|---|${names.map(() => '---').join('|')}|
${v10.fidelity.pairs.map((p, i) => `| ${p.name} | ${names.map((n) => f(R[n].fidelity.pairs[i].rho)).join(' | ')} |`).join('\n')}

### v1.1 で変えたこと

**画像解析 v1.1** (\`analyzeImageV11\`、特徴の名前と尺度は v1.0 と同じ)
- 画像自身のノイズ量を推定 (16×16 のブロックごとの対角ウェーブレット係数の中央値、静かなブロックで読む) し、粗さ・エッジ・空間スペクトルから引く。センサーのざらつきは「質感」ではない
- 色は彩度 (ノイズより上の分) で重みづけ。灰色の画素のノイズの色は数えない
- 色相は 36 区分 + 実際の色相の円周平均 (v1.0 は 30° の区分の中心)
- 反復の周期は「最大の山」ではなく「最大の 85% 以上で最も短い周期」(倍の周期を取り違えない)
- 面積を正確に配分する縮小 (端の画素を割合で数える)
- 新しい特徴: ノイズ量、4色のパレット、色相の円周上の広がり、粗い/細かい模様の比、エッジの主方向とそのそろい方

**DNA v1.1** (\`createImageDNAV11\`)
- 滑らかさ = exp(−エッジ/0.06): v1.0 の「1 − エッジ×7」は模様のある画像をすべて「完全に鋭い」に潰していた
- 余韻は滑らかさで決める (v1.0 は反復構造で長くなり、滑らかな画像のほうが短く鳴ることがあった)
- 色の豊かさ → **シマー** (少しずらした2層目の倍音がうなる)。FM の比は整数比だけにして、色が「揺らぎ」になり「濁り」にならないようにした
- トリミングで動く特徴 (反復周期、8方向のエッジのばらつき、30° 区分の色相の割合) に頼らない
- 反応ルールは強さ = スコア² で 0.4 以上をすべて持つ (v1.0 は上位2つ + 0.55 以上で、少しの差で役割ごと入れ替わった)
- 新しい反応ルール **imitate** (フレーズをまねて答える) と **yield** (周りが混むと1小節休む)

### 測り方の訂正

最初の測定では v1.0 の「滑らかな画像 → 長い減衰」が逆相関 (−0.70) に見えたが、測り方の誤りだった。ピークからの時間で測っていたため、立ち上がりの遅い (滑らかな) 楽器は「ピークが遅い分だけ短い」と数えられていた。ノートを離してからの余韻の長さに直すと v1.0 も +0.80 で、v1.1 は ${f(v11.fidelity.pairs[2].rho, 2)}。同じく「揺らぐ倍音」も、最初はスペクトルの変化量で測っていて、ただの減衰まで揺らぎと数えていた。減衰の直線を引いた残りの揺れに直した (v1.0 ${f(v10.fidelity.pairs[4].rho, 2)}、v1.1 ${f(v11.fidelity.pairs[4].rho, 2)})。表の数字はすべて訂正後の測り方で、v1.0 と v1.1 を同じ物差しで測っている。

試して**やめたこと**: 画像を6通りに切り抜いて特徴の中央値を取る「多視点解析」は、縮小やノイズに対してかえって不安定になった (切り抜きが 128 px より小さいと拡大されるため) ので採用しなかった。

## 2. 相互作用 v1.1 (\`generateV11\`)

v1.0 の仕組み (楽器が自分のリズムで鳴り、DNA のルールで互いに反応する。アークは条件だけを決める) はそのまま、次を足した。

- **フレーズ**: 2小節ごとに息をつき、フレーズの終わりは主和音の音に寄る。最後は小節線で主和音に着地する (作曲上の唯一の決めごと。'cadence' の出来事として記録)
- **聴いて選ぶ音程**: 次の音を近くの音階の音から選ぶとき、いま鳴っている他の楽器の音との粗さ (Plomp–Levelt / Sethares、6倍音) が小さい音ほど選ばれやすい
- **imitate**: 他の楽器の直前の3音を、形を保ったまま自分の音域に移して2拍後に答える
- **yield**: 周りの1小節の音数が多いと、自分は1小節休む
- **attract** も、いま鳴っている全体との粗さが最小の音を選ぶ
- アークは最後の和音で終わるように伸縮する

## 3. 30秒の候補曲

### 曲の質の指標 (SONOVA の基準)

${Object.entries(PART).map(([k, v]) => `**${v}** (${k})`).join('・')} の8項目を 0–1 にして平均した。各項目の目標と理由は \`packages/evaluation/src/piece-metrics.ts\` に書いた。
**注意**: これは SONOVA が決めた基準で、v1.1 の生成器は「協和」「終わり方」「掛け合い」を良くするように作ったので、その項目が上がるのは設計どおりの結果でもある。音楽として良いかは人が聴いて確かめる必要がある。

### 同じ3枚の写真から、たくさんの種で (${p2.seedsPerArc} 種 × 3 アーク = ${p2.seedsPerArc * 3} 曲、音量の起伏を除く7項目)

| | 平均 | 下位 10% | 上位 10% |
|---|---|---|---|
${Object.entries(p2.distribution as Record<string, { mean: number; p10: number; p90: number }>).map(([k, d]) => `| ${k} | ${f(d.mean)} | ${f(d.p10)} | ${f(d.p90)} |`).join('\n')}

### 候補曲 (各アークで ${p2.seedsPerArc} 曲を作り、上位3曲を鳴らして測り、最もよい1曲)

| | 作品番号 | 題 | アーク | 総合 | ${Object.values(PART).join(' | ')} |
|---|---|---|---|---|${Object.keys(PART).map(() => '---').join('|')}|
${[...p2.baseline.map((b: never) => ['v1.0', b] as const), ...p2.candidates.map((c: never) => ['v1.1', c] as const)].map(([v, c]: readonly [string, { workNumber: string; title: string; arc: string; metrics: { score: number; parts: Record<string, number> } }]) => `| ${v} | ${c.workNumber} | ${c.title} | ${c.arc} | **${f(c.metrics.score)}** | ${Object.keys(PART).map((k) => f(c.metrics.parts[k], 2)).join(' | ')} |`).join('\n')}

v1.1 の候補曲 (\`output/v11/\`、Git 管理外):
${p2.candidates.map((c: { workNumber: string; title: string; seed: string; bpm: number; key: string; notes: number; statsV11: { imitations: number; yields: number }; metrics: { roughness: number; dialogue: number; endsOnChord: boolean }; verification: { ok: boolean; peakDbfs: number; rmsDbfs: number }; chains: string[] }) => `- **${c.workNumber} ${c.title}** — 種 \`${c.seed}\`、${c.bpm} BPM、${c.key}、${c.notes} 音、模倣 ${c.statsV11.imitations} 回・譲る ${c.statsV11.yields} 回、粗さ ${c.metrics.roughness}、掛け合い ${c.metrics.dialogue}、${c.metrics.endsOnChord ? '主和音で終わる' : '主和音で終わらない'}。検証 ${c.verification.ok ? 'OK' : 'NG'} (peak ${c.verification.peakDbfs} dBFS, RMS ${c.verification.rmsDbfs} dBFS)\n  - 例: ${c.chains[0] ?? ''}`).join('\n')}

## 4. 限界と次

- テスト画像は手続き的に描いたもので、実在の写真ではない。実写真 (ライセンスが明確なもの) での確認が次の段階
- 曲の質の指標は SONOVA 自身の基準。人が聴いて「v1.0 と v1.1 のどちらがよいか」を比べる必要がある
- 主音・リズムの音数などの離散的な選択は、境目の近くでは加工で変わりうる (v1.1 でも ${f(v11.dna.flipRate)})
- SONOVA LAB (ブラウザ) はまだ v1.0 のまま。v1.1 を選べるようにするのは次の作業
`;
writeFileSync(join(EXP, 'REPORT.md'), md);
console.log('wrote experiments/v11/REPORT.md');
