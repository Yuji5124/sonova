# sonova

**SONOVA v1.0 — EVERYTHING IS AN INSTRUMENT**
MUSIC BOUNDARY × MUSIC GENERATOR

写真から独自の楽器をつくり、楽器同士の相互作用から音楽を発生させる研究・制作システム。
すべての音は「素材 (sha256)・シード・エンジンバージョン」から再現でき、「何がその音を生んだか」をイベントの因果ログで説明できる。

- 無料・ローカル完結: 有料 API・クラウド AI・API キー・GPU・DAW・有料音源は不要
- 実行時の外部依存は `@tonejs/midi` (MIT) だけ。合成・解析・生成はすべて自前の TypeScript
- ブラウザ (SONOVA LAB) と Node (CLI) で同じエンジンが動き、同じ DNA と同じ音を出す

## 現在の到達点 (Phase 0–3)

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 環境・外部技術調査、SOUNDVAULT の仕様確認 | ✅ [research/github-survey.md](research/github-survey.md)、[docs/soundvault-integration.md](docs/soundvault-integration.md) |
| 1 | PNG 3 枚 → Instrument DNA → 3 つの音色、ブラウザで試聴 | ✅ |
| 2 | 3 楽器の相互作用で 30 秒 × 3 候補 | ✅ |
| 3 | WAV・JSON 生成、SOUNDVAULT への登録と再生確認 | ✅ ローカルで登録・再生確認済み / ⏸ GitHub 上の SOUNDVAULT への反映は承認待ち |
| 4–7 | 3D・文章・コード、90 秒、3〜5 分の完成曲、シリーズ化 | 未着手 (設計のみ) |

結果: [experiments/REPORT.md](experiments/REPORT.md) / 評価: [docs/evaluation-phase0-3.md](docs/evaluation-phase0-3.md)

### 生まれた楽器と曲

| 作品番号 | 内容 | SOUNDVAULT 素材 ID |
|---|---|---|
| SONOVA-INST-0001 | bark（木の年輪）→ 明るい打撃音、他の楽器の変化からリズムを生む | `sonova_inst_0001_ogg` |
| SONOVA-INST-0002 | tower（建物の外壁）→ 長く響く倍音、他の楽器の音に共鳴する | `sonova_inst_0002_ogg` |
| SONOVA-INST-0003 | sunset（夕焼けの海）→ 暗く柔らかいパッド、周囲の旋律で音色が変わる | `sonova_inst_0003_ogg` |
| SONOVA-EXP-0001 | *Rings Wake the Tower* — BLOOM、87 BPM、C dorian | `sonova_exp_0001_ogg` |
| SONOVA-EXP-0002 | *Facade Tide* — TIDE（2 度満ち引き）、88 BPM | `sonova_exp_0002_ogg` |
| SONOVA-EXP-0003 | *Sunset Cascade* — CASCADE（共鳴の連鎖が先行）、86 BPM | `sonova_exp_0003_ogg` |

素材画像 (`experiments/sources/*.png`) もコードで生成したオリジナル (`scripts/make-sample-images.ts`)。

## 使い方

Node.js 22.12 以上（Windows / macOS / Linux）。

```bash
npm install
npm run dev          # SONOVA LAB → http://localhost:5173
npm test             # 32 テスト
npm run build        # 型検査 + 本番ビルド (apps/sonova-lab/dist)
```

CLI でのレンダリング（WAV は `output/`、JSON は `experiments/` へ）:

```bash
npm run phase1       # 画像 3 枚 → DNA + 試聴 WAV
npm run phase2       # 30 秒 × 3 候補 → WAV / MIDI / 構造・生成・イベント JSON
npx tsx scripts/report.ts             # experiments/REPORT.md を更新
python scripts/verify_wav.py output/phase2/*.wav --expect-seconds 30   # 標準ライブラリだけの独立チェック
```

SOUNDVAULT への登録（手動・Phase 3）:

```bash
npm run soundvault:register -- --vault ../soundvault --dry-run   # 何が書かれるか確認
npm run soundvault:register -- --vault ../soundvault
npm run soundvault:verify   -- --vault ../soundvault             # SOUNDVAULT をビルドして UI で再生確認
```

SONOVA LAB から保存する場合は `SOUNDVAULT_DIR=../soundvault npm run dev`（または `sonova.config.example.json` を `sonova.config.local.json` にコピー）。
OGG 変換には ffmpeg を使う（なければ WAV のまま登録）。ブラウザ検証 (`npm run verify:lab`, `soundvault:verify`) は手元の Chrome / Edge を使う（`CHROMIUM_PATH` で指定可）。

## SONOVA LAB の画面

| 画面 | できること |
|---|---|
| HOME | プロジェクト一覧、新しい実験、サンプル画像で開始、保存済み楽曲 |
| SOURCE LAB | PNG/JPG 読み込み（3D・文章・コードは Phase 4）、特徴量・空間スペクトル・色相分布の表示 |
| INSTRUMENT LAB | Instrument DNA、特徴 → 音の対応表、音色の調整（DNA とは別に「人間の編集」として保存）、試聴、DNA JSON |
| MUSIC GENERATOR | 楽器の関係図、相互作用ルールの強さ、展開 (BLOOM / TIDE / CASCADE)、シード、3 候補生成、因果の連鎖 |
| COMPOSITION | 構成・タイムライン・楽器別トラック（音量・ミュート）、再生/停止、WAV・MIDI・JSON 書き出し、イベント履歴 |
| SOUNDVAULT | 保存先の確認、保存、保存済み表示、素材 ID、登録台帳、SOUNDVAULT から再生、エラー表示 |

## 構成

```
apps/sonova-lab/            ブラウザアプリ (Vite + Web Audio API + Web Worker)
packages/source-analyzer/   画像の特徴量 (色・輝度・エッジ・模様・空間周波数・反復)
packages/instrument-dna/    特徴 → Instrument DNA、対応表、PRNG、ユークリッドリズム
packages/synthesis-engine/  加算 + FM + ノイズ + フィルター + エンベロープ、リバーブ、リミッター
packages/music-generator/   楽器の状態と相互作用ルール、因果ログ
packages/composition-engine/ 構成、ミックス、WAV/MIDI/JSON、作品番号
packages/soundvault-adapter/ SOUNDVAULT 登録 (Node)
experiments/                素材画像と Phase 1/2 の JSON (コミット対象)
compositions/               SOUNDVAULT 登録台帳と検証結果
research/  docs/            調査・設計・評価
scripts/   tests/           CLI と検証
output/                     WAV など生成物 (Git 管理外)
```

詳しくは [docs/architecture.md](docs/architecture.md)（データの流れ・再現性・安全装置）、[docs/instrument-dna.md](docs/instrument-dna.md)、[docs/music-generator.md](docs/music-generator.md)。

## 使用ライブラリとライセンス

| 名前 | ライセンス | 用途 |
|---|---|---|
| @tonejs/midi (+ midi-file, array-flatten) | MIT | MIDI 書き出し（実行時） |
| Vite, Vitest, tsx, pngjs, esbuild, Rollup | MIT | 開発・テスト |
| TypeScript, playwright-core | Apache-2.0 | 型検査・ブラウザ検証（任意） |
| ffmpeg (外部コマンド) | LGPL/GPL | OGG 変換（任意、同梱しない） |

Tone.js・DDSP・Strudel などの評価は [research/github-survey.md](research/github-survey.md)。外部リポジトリのコードはコピーしていない（Freeverb とユークリッドリズムは公開アルゴリズムとして再実装）。
SONOVA が生成した音と素材画像はオリジナル（SOUNDVAULT では `license: "Original"`）。
