# AGENTS.md — SONOVA で作業するエージェント向け

## 原則

- **無料・ローカル完結**。有料 API、クラウド AI、API キー、GPU 必須の依存を入れない。新しい依存はライセンスを確認し `research/github-survey.md` と README の表に追記する。コピーレフト (GPL/AGPL) は組み込まない。
- **再現性**: `Math.random()` を使わない（`Rng` を使う）。特徴量や DNA の数値は `r6()` で丸める。エンジンの出力が変わる変更をしたら該当パッケージの `*_VERSION` を上げる。
- **説明可能性**: 新しい写像には `mapping` エントリ（特徴名と理由）を、新しい相互作用には原因イベントへのリンクを必ず付ける。
- **安全**: 音量は `master()` を必ず通す（−1 dBFS 上限）。相互作用は深さ・不応期・1 ステップの上限・総エネルギー上限の中で設計する。
- アップロードされたプログラム（CODE INSTRUMENT, Phase 4）は**実行しない**。静的解析のみ。

## SOUNDVAULT

- 実体は https://github.com/Yuji5124/soundvault（静的サイト + `data/sounds.json` + `npm run scan`）。新しいシステムや API を作らない。
- 登録は `packages/soundvault-adapter` を通す。既存レコードを変更しない、同じ作品番号で別の音を上書きしない。
- **SOUNDVAULT 側の commit / push はユーザーの承認を得てから**。

## コマンド

```bash
npm install
npm test                 # vitest (tests/)
npm run typecheck
npm run build
npm run phase1 && npm run phase2 && npx tsx scripts/report.ts
npm run verify:lab       # Chromium で SONOVA LAB を通しで確認
npm run rock             # SONOVA-ROCK-0001 (約2分のレンダリング)
npm run s002 / s003 / s004  # SONOVA 002 育つ楽器 / 003 自己修復 / 004 空間
npm run rock:series      # 002–004 のロック版 3 曲 (output/rock-series, experiments/rock-series)
npm run xrock            # SONOVA-XROCK-0001 拡張ロック (output/xrock, experiments/xrock)
npm run od:fetch         # ORCHESTRA × DIGITAL: VSCO-2-CE (CC0) を vendor/ に取得 (コミットしない)
npm run od:phase2        # ORCHESTRA × DIGITAL の 4 つの実験 (48 kHz/24-bit, MP3, ステム)
npm run soundvault:register -- --vault <dir> [--dry-run]
npm run soundvault:verify   -- --vault <dir>
npm run zig:daily -- --vault <dir> [--dry-run]   # ZIG デイリー曲 (docs/zig-daily.md)。SOUNDVAULT へはユーザー承認 (PR のマージ) 経由
```

`phase2` は `SONOVA_CREATED_AT` を指定すると generation.json の日時が固定され、差分が出にくい。

## Git

- 生成 WAV/OGG・モデル重み・秘密情報はコミットしない（`.gitignore`）。小さな JSON（DNA、構造、イベント）はコミットする。
- `main` への統合はユーザーの確認を取る。
