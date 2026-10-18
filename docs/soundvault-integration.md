# SOUNDVAULT 連携 (Phase 3)

## Step 1: 既存システムの確認結果

アクセス可能なリポジトリ一覧から **https://github.com/Yuji5124/soundvault** (public) を特定し、読み取り専用で clone して仕様を確認した（確認時の HEAD: `747100e`, 2026-10-16）。推測ではなく、実際のファイルから読み取った仕様:

| 項目 | 実体 |
|---|---|
| 保存場所 | `public/sounds/<category>/` に音声ファイル (`.wav .mp3 .ogg .m4a`) |
| フォルダ構成 | `ui action item environment fx kids voice bgm`（UI のカテゴリタブは固定: `UI ACTION ITEM ENVIRONMENT FX KIDS VOICE BGM`） |
| メタデータ形式 | `data/sounds.json`（配列）。`public/data/sounds.json` は scan が書き出すコピー |
| 音源 ID | レコードの `id`（既存例: `monque_stone_ogg`）。scan は既存 `id` を保持し、なければファイル名から作る |
| 登録 API | **サーバー・API はない**。ファイルを置き、`data/sounds.json` を編集し、`npm run scan` で filesystem 項目 (path/format/size/category) を更新する。scan はそれ以外の項目（`tags license source author notes volume loop collections projectIds` や未知の項目）を保持する |
| 既存スクリプト | `scripts/scan-sounds.mjs`（Node 標準ライブラリのみ）、`scripts/generate-demo-audio.mjs`、`tools/monque-sound-lab/to_soundvault.py`（MONQUE の楽曲を OGG/M4A にして登録した既存の前例） |
| カテゴリ | 上記 8 種。新カテゴリを足すと UI のタブに出ない |
| タグ / コレクション / プロジェクト | `tags[]`、`collections[]`（例: `MONQUE BGM 30`）、`projectIds[]` と `data/projects.json`（例: `monque`） |
| 公開方法 | `main` への push で GitHub Actions (`deploy.yml`) が `npm run prepare-assets`（demo 生成 → scan → build）を実行し GitHub Pages に公開。`data/sounds.json` は他プロジェクトから読める公開インデックス |
| 料金 | 無料（GitHub リポジトリ + Pages）。Pages の制限: サイト 1GB、帯域 100GB/月 (ソフト上限)。今回の追加は 2.1MB |

## Step 2: SONOVA の分類 → SOUNDVAULT カテゴリ

| SONOVA | SOUNDVAULT category | collection | フォルダ |
|---|---|---|---|
| INSTRUMENT（独自楽器の単体音源） | `FX` | `SONOVA INSTRUMENTS` | `public/sounds/fx/` |
| EXPERIMENT（15〜30秒の音楽実験） | `BGM` | `SONOVA EXPERIMENTS` | `public/sounds/bgm/` |
| COMPOSITION（3〜5分の完成曲） | `BGM` | `SONOVA COMPOSITIONS` | `public/sounds/bgm/` |

UI のカテゴリは固定なので新カテゴリは作らず、`collections` と `projectIds: ["sonova"]`（Project「SONOVA / 音楽研究」）で区別する。MONQUE の前例と同じ方式。

## Step 3: メタデータ

既存スキーマの項目をそのまま埋め、SONOVA 固有の情報は scan が保持する `sonova` オブジェクトに入れる（既存 UI はこの項目を無視するので表示は壊れない）。

| 指示書の項目 | SOUNDVAULT での格納先 |
|---|---|
| SONOVA 作品番号 | `name` 先頭、`sonova.workNumber`（例 `SONOVA-EXP-0001`） |
| 曲名 | `name`, `sonova.title` |
| 素材ID | `sonova.materialIds`（素材ファイルの sha256） |
| 音源タイプ | `category` + `collections` + `sonova.assetType` |
| 再生時間 / BPM / 形式 | `duration`, `sonova.bpm`, `format`, `sampleRate` |
| Instrument DNA | `sonova.instrumentDna`（instrument_id と dna_hash。DNA 本体は SONOVA の `experiments/phase1/dna/*.json`、`sonova.sonovaFiles` で参照） |
| 生成シード / 使用アルゴリズム / エンジン | `sonova.seed`, `sonova.algorithms`, `sonova.engines` |
| 元素材情報 | `source`, `sonova.sources` |
| ライセンス | `license: "Original"`（素材画像もコードで生成した SONOVA オリジナル） |
| 制作日時 | `createdAt`, `sonova.createdAt` |
| 音声検証結果 | `sonova.verification`（長さ・ch・Hz・bit・peak・RMS・無音率）、`sonova.wavSha256` |

## Step 4: 保存パイプライン（`packages/soundvault-adapter`）

1. SONOVA で生成 → 2. WAV 書き出し (`output/`) → 3. WAV を検証（44.1kHz/16bit/2ch、長さ、ピーク ≤ −0.9 dBFS、クリップ 0、無音率、DC）→ 4. メタデータ生成 → 5. ffmpeg があれば OGG Vorbis (q6) に変換（なければ WAV のまま）し、`public/sounds/<cat>/sonova-<番号>-<曲名>.ogg` に配置、`data/sounds.json` と `data/projects.json` を更新、SOUNDVAULT 自身の `scripts/scan-sounds.mjs` を実行 → 6. 登録後のレコード・サイズ・形式を再確認、既存レコードが 1 件も変化していないことを確認 → 7. 素材 ID 取得 → 8. `compositions/soundvault-registry.json` に記録 → 9. `scripts/soundvault-verify.ts` で再生確認。

- **失敗時**: SOUNDVAULT の JSON を元に戻し、書いた音声を削除。元の WAV は `output/` に残る。JSON のバックアップは SOUNDVAULT の外 (`output/soundvault-backups/`) に作る。
- **重複防止**: 同じ作品番号 + 同じ WAV (sha256) → `already-registered`（何も書かない）。同じ作品番号で違う音 → 登録拒否（上書きしない）。同じファイル名の別素材 → 拒否。SONOVA LAB で編集（ミュート・音量・DNA 調整）した音は内容ハッシュの作品番号 (`SONOVA-EXP-Hxxxxxxxx`) になる。

## Step 5: 無料条件

有料ストレージ・API は使わない。既存の「Git + GitHub Pages」運用に乗るだけ。ffmpeg は任意（無料）。

## Step 6: SONOVA LAB の保存操作

SOUNDVAULT 画面: 保存先と状態の表示、「SOUNDVAULT へ保存」（手動）、保存済み表示と素材 ID、登録台帳、「SOUNDVAULT から再生」、公開ページへのリンク、エラー表示。保存は `npm run dev` のローカル開発サーバー (`/api/soundvault/*`, localhost のみ) 経由で行い、静的ビルドには含まれない。自動保存は未実装（指示書どおり、手動での登録・再生検証の成功後に追加する）。

## 実行結果（2026-10-18, ローカル clone に対して）

```
npm run soundvault:register -- --vault <soundvault>
✓ SONOVA-INST-0001 registered  sonova_inst_0001_ogg  /sounds/fx/sonova-inst-0001-bark-instrument.ogg
✓ SONOVA-INST-0002 registered  sonova_inst_0002_ogg  /sounds/fx/sonova-inst-0002-tower-instrument.ogg
✓ SONOVA-INST-0003 registered  sonova_inst_0003_ogg  /sounds/fx/sonova-inst-0003-sunset-instrument.ogg
✓ SONOVA-EXP-0001 registered   sonova_exp_0001_ogg   /sounds/bgm/sonova-exp-0001-rings-wake-the-tower.ogg
✓ SONOVA-EXP-0002 registered   sonova_exp_0002_ogg   /sounds/bgm/sonova-exp-0002-facade-tide.ogg
✓ SONOVA-EXP-0003 registered   sonova_exp_0003_ogg   /sounds/bgm/sonova-exp-0003-sunset-cascade.ogg
(2回目の実行は 6 件とも already-registered)

npm run soundvault:verify -- --vault <soundvault>
✓ 既存 71 件のレコードは不変 / SOUNDVAULT の変更は SONOVA 関連のみ / 削除なし
✓ SOUNDVAULT の npm run build 成功、ビルド済みサイトから同一 sha256 の音声を取得
✓ SOUNDVAULT UI で 6 件とも ▶ 再生（Chromium で currentTime が進行、decode 30.0s/6.0s・2ch・44.1kHz）
```

詳細: `compositions/soundvault-registry.json`（素材 ID と sha256）、`compositions/soundvault-verification.json`（全チェック）。

## ⚠ 承認が必要なこと（SOUNDVAULT 側の変更）

このセッションは SOUNDVAULT への push 権限を使っておらず、**GitHub 上の SOUNDVAULT は一切変更していない**。上記の登録はローカル clone で行い、検証後もそのまま（未コミット）にしてある。

SOUNDVAULT に反映する場合の変更内容:

- 追加: `public/sounds/bgm/sonova-exp-000{1,2,3}-*.ogg`（各 約0.6MB）、`public/sounds/fx/sonova-inst-000{1,2,3}-*.ogg`（各 70〜130KB）、計 2.1MB
- 変更: `data/sounds.json` / `public/data/sounds.json` に 6 レコード追加（既存 71 件は不変）、`data/projects.json` / `public/data/projects.json` に Project `sonova` を追加
- 差分（JSON 部分）: [`docs/soundvault-proposal/soundvault-data.patch`](soundvault-proposal/soundvault-data.patch)

承認後の手順（Windows でも同じ）:

```bash
# SOUNDVAULT を clone 済みの場所を指定
npm run phase1 && npm run phase2
npm run soundvault:register -- --vault ../soundvault
npm run soundvault:verify -- --vault ../soundvault
cd ../soundvault && git checkout -b sonova-phase3 && git add public/sounds data public/data && git commit -m "Add SONOVA Phase 3 assets" && git push -u origin sonova-phase3
```

OGG のバイト列は ffmpeg のバージョンで変わりうるが、元の WAV (sha256 を記録済み) は SONOVA で決定論的に再生成される。
