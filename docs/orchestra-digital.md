# SONOVA — ORCHESTRA × DIGITAL

フルオーケストラ (実際の録音サンプル) と、GitHub で公開されている電子音楽の手法 (自前で再実装) を、対等な二つの音楽として一曲にする制作。
和声を一致させるのではなく、**リズムの周期・動機の形・音色・強弱・空間・構成**のどれかで二つを結び、「違うまま一つの音楽」になる条件を探す。

## 進め方

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | 既存リポジトリと技術の調査 | ✅ [research/orchestra-digital-survey.md](../research/orchestra-digital-survey.md) |
| 2 | 統一原理の違う 4 つの短い実験 | ✅ [experiments/orchestra-digital/phase2/](../experiments/orchestra-digital/phase2/) (試聴待ち) |
| 3 | 有望な 2 つを 30〜45 秒の試作に | 未着手 (試聴の結果で決める) |
| 4 | 試聴・検証・改善 | |
| 5 | 完成曲 SONOVA — ORCHESTRA × DIGITAL 001 (約 3 分 30 秒) | |
| 6 | WAV / MP3 / MIDI / ステム / 制作ノート | |

## 統一エンジン (Phase 2 で実装した部分)

| 橋 | 実装 | 実験 |
|---|---|---|
| A. RHYTHM BRIDGE | 異なる拍子・テンポの共通周期 (3/4 の 90 BPM と 4/4 の 120 BPM は 1 小節 = 2 秒)、周期の頭だけでアクセントを共有 | EXP-A |
| B. MOTIF BRIDGE | 動機を「上下の形・音程の大小の順位・リズム比」に抽象化し、別の音階 (八音音階) で実現 `contourToScale()`。音高とリズムを分けて受け渡す | EXP-B |
| C. TIMBRE BRIDGE | `analyseTimbre()` (倍音・立ち上がり・余韻・雑音) → `additive()` の双子 → 倍音の伸び・偏り・雑音で電子音へ。逆方向は `articulationFor()` (電子音の包絡 → スピッカート/ピチカート) | EXP-D |
| D. DYNAMICS BRIDGE | 共通の緊張曲線 T(t) を電子側 (音数・FM の明るさ・確率) とオーケストラ側 (強弱の層・表情) に別々の意味で入れる。総休止を共有 | EXP-C |
| E. SPACE BRIDGE | `hallIR()` で一つのホール (鏡像音源 + 周波数ごとの残響) を作り、全ステムを同じホールに送る。奥行き = 直接音の量・高域・送りの量 | 全実験 |
| F. STRUCTURE BRIDGE | 独立 → 応答 → 交換 → 融合 (EXP-B の 4 段、EXP-D の受け渡し) | EXP-B, D |

## 使い方 (Windows / macOS / Linux)

必要: Node.js 22.12 以上、git 2.27 以上、ffmpeg (MP3 書き出し用、無くても WAV は出る)。

```bash
npm install
npm run od:fetch       # VSCO-2-CE (CC0) の必要なフォルダだけを vendor/VSCO-2-CE に取得 (約 1,180 ファイル)
npm run od:phase2      # 4 つの実験 (約 40 秒) → output/orchestra-digital/phase2/
npm run od:phase2 -- C # 1 つだけ
```

音源を別の場所に置く場合は `VSCO_DIR` 環境変数で指定 (PowerShell: `$env:VSCO_DIR="D:\VSCO-2-CE"`)。

## 個別に直せる場所

- テンポ・和声・動機・構成: `scripts/od-phase2.ts` の各実験の関数 (進行・時刻・音高はすべてコード上のデータ)
- 音色: `packages/orchestra-engine/src/synth.ts` (FM・加算・粒・ドラム・グリッチ)、楽器と奏法の対応は `library.ts` の `INSTRUMENTS`
- 定位・奥行き・音量: 各 `track(...)` の pan / depth と `level(...)` の dB
- 残響: `HALL` (部屋の大きさ・RT60・初期遅延)

## ライセンス

- オーケストラ音源: VSCO-2-CE — **CC0 1.0** (データはリポジトリに含めない。`npm run od:fetch` で取得、コミット固定)
- 電子音・解析・残響・ミックス: すべて自前の実装 (外部コードなし)。参照した考え方とライセンスは調査メモに記載
- MIDI 書き出し: @tonejs/midi (MIT)、MP3: ffmpeg (外部コマンド、同梱しない)
