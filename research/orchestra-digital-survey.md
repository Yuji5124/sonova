# SONOVA — ORCHESTRA × DIGITAL · Phase 1 技術調査

調査日 2026-10-19。各 URL は GitHub 上で存在を確認した (更新日は GitHub API の最終 push)。**コードのライセンスと音源データのライセンスは別に記載**する。
GPL / AGPL のものは「考え方のみ」(コードを読まず・写さず、公開されたアルゴリズムの説明から独自実装)。

## 既存リポジトリ

- **SONOVA** (このリポジトリ): アクセス可。規則 (`AGENTS.md`) に従う — 無料・ローカル完結、`Math.random()` を使わず `Rng`、音量は必ずリミッターを通す、生成 WAV/MP3・外部の音源データはコミットしない、main への統合は確認を取る。新しい作業は `packages/orchestra-engine` と `scripts/od-*.ts` に分けた。
- **SOUNDVAULT** (Yuji5124/soundvault): このセッションから GitHub 上のリポジトリへの追加は権限確認で止められた (前回と同じ)。手元に以前の clone があるが、**今回は推測で触らない**。登録は完成後に承認を得てから。

## 候補

### 1. アルゴリズム作曲・生成的シーケンス

| リポジトリ | 機能 | 最終更新 | ライセンス | 導入 / Windows | 判断 |
|---|---|---|---|---|---|
| [tonaljs/tonal](https://github.com/tonaljs/tonal) | 音名・音程・音階・和音・調 (TypeScript) | 2026-10 | MIT | npm、純 JS / ◯ | 候補 (今回は依存を増やさず不採用。和声の計算が複雑になったら導入) |
| [scribbletune/scribbletune](https://github.com/scribbletune/scribbletune) | パターン文字列 → クリップ・MIDI | 2026-08 | MIT | npm / ◯ | 参考 |
| [tidalcycles/strudel](https://github.com/tidalcycles/strudel) | Tidal のパターン言語 (`degradeBy`, `sometimes`) | 2025-06 (archived) | AGPL-3.0 | — | 考え方のみ |
| [dbkaplun/euclidean-rhythm](https://github.com/dbkaplun/euclidean-rhythm) | ユークリッドリズム | 2023-01 | MIT | 小さい | 既存の自前 `euclid()` で足りる |

### 2. FM・加算・減算・ウェーブテーブル

| リポジトリ | 機能 | 最終更新 | ライセンス | 判断 |
|---|---|---|---|---|
| [google/music-synthesizer-for-android](https://github.com/google/music-synthesizer-for-android) | DX7 の FM エンジン "msfa" とその研究ノート | 2021-11 (archived) | Apache-2.0 | **FM の参照**。自前 `fm()` (2 オペレーター + フィードバック、変調指数の減衰) |
| [asb2m10/dexed](https://github.com/asb2m10/dexed) | DX7 プラグイン | 2026-10 | GPL-3.0 (msfa 部分は Apache-2.0) | 考え方のみ |
| [surge-synthesizer/surge](https://github.com/surge-synthesizer/surge), [mtytel/vital](https://github.com/mtytel/vital) | ハイブリッド / ウェーブテーブル | 2026-10 / 2023-05 | GPL-3.0 | 考え方のみ |

### 3. グラニュラー

| リポジトリ | 機能 | 最終更新 | ライセンス | 判断 |
|---|---|---|---|---|
| [pichenettes/eurorack](https://github.com/pichenettes/eurorack) (Clouds / Beads) | テクスチャーシンセ (粒の位置・密度・ピッチ・凍結) | 2026-10 | STM32 のコード MIT (AVR は GPL-3、名称は商標) | **グラニュラーの参照**。自前 `grains()` — オーケストラの録音そのものから粒を切る |
| [AlexHarker/HISSTools_Granular](https://github.com/AlexHarker/HISSTools_Granular) | 教育用グラニュラー (ストリーム/クラウド) | 2024-09 | BSD-3-Clause | 粒のスケジューリングの参照 |
| [zya/granular](https://github.com/zya/granular) | Web Audio のグラニュラー | 2021-08 | MIT | 小さな参照 |

### 4. 物理モデリング

| リポジトリ | 機能 | 最終更新 | ライセンス | 判断 |
|---|---|---|---|---|
| [thestk/stk](https://github.com/thestk/stk) | 弓の弦・管・リードなどの導波管モデル (C++) | 2025-03 | MIT 型 (STK license) | Phase 3 以降の候補 (弦の物理モデルで「弓の圧力」を電子側から操作する) |
| [IMAGINARY/pink-trombone](https://github.com/IMAGINARY/pink-trombone) | 声道モデル (Pink Trombone の原版) | 2023-11 | MIT 型 | SONOVA の歌手 (XROCK) で考え方を使用済み |

### 5. グリッチ・確率的リズム

| リポジトリ | 機能 | ライセンス | 判断 |
|---|---|---|---|
| pichenettes/eurorack (Grids / Marbles / Branches) | 密度の地図、デジャヴのあるランダム、ベルヌーイゲート | Marbles/Branches は MIT、Grids は GPL-3 | 考え方。自前の確率パターン + `glitch()` (スタッター・逆再生・サンプルレート低下) |
| GitHub 上のグリッチ専用エンジン | — | — | まともなオープンソースが見つからなかった。`Heroisn/Glitch-1.3-dblue-MacOS` のようなバイナリ配布リポジトリは**危険なので避ける** |

### 6. スペクトル解析・音色変換

| リポジトリ | 機能 | 最終更新 | ライセンス | GPU / 重み | 判断 |
|---|---|---|---|---|---|
| [MTG/sms-tools](https://github.com/MTG/sms-tools) | 正弦波・倍音・確率モデル (SMS) | 2026-03 | AGPL-3.0 | 不要 | 考え方のみ → 自前 `analyseTimbre()` + `additive()` (倍音の振幅・立ち上がり・余韻・雑音成分) |
| [magenta/ddsp](https://github.com/magenta/ddsp) | 微分可能 DSP による音色変換 | 2026-10 | Apache-2.0 (重みのライセンス記載なし) | TensorFlow、学習は GPU | **不採用** (GPU と重み)。「倍音の発振器群 + 雑音を f0 と音量で動かす」という考え方だけ |
| [meyda/meyda](https://github.com/meyda/meyda) | 音響特徴 (重心・MFCC・クロマ) | 2024-07 | MIT | 不要 | 必要なら導入可。今回は自前の解析で足りる |

### 7. MIDI 生成・オーケストラ音源 (データのライセンスに注意)

| 音源 | URL | データのライセンス | 形式・規模 | 判断 |
|---|---|---|---|---|
| **VS Chamber Orchestra 2 Community Edition** | [sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE) | **CC0 1.0** (LICENSE を取得して確認) | WAV (44.1 kHz ステレオ)、SFZ は別ブランチ。リポジトリ全体 約 2.3 GB | **採用** (オーケストラの音源)。使うフォルダだけ取得 (約 1,180 ファイル) |
| Sonatina Symphonic Orchestra | [peastman/sso](https://github.com/peastman/sso) | CC Sampling Plus 1.0 (広告利用不可・全体の複製は非商用のみ) | SFZ + WAV、約 1.3 GB | 不採用 (CC0 より制約が強い) |
| Virtual Playing Orchestra 3 | [studiorack/virtual-playing-orchestra](https://github.com/studiorack/virtual-playing-orchestra) | 楽器ごとに混在 (CC0 / CC-BY-SA / Sampling Plus) | SFZ + FLAC | 不採用 (楽器ごとの権利確認が必要) |
| MIDI 書き出し | [Tonejs/Midi](https://github.com/Tonejs/Midi) | MIT | npm | 既存の依存をそのまま使用 |

**VSCO-2-CE の注意 (実測で確認)**: ファイル名の音名は**実音より 1 オクターブ低い** (`VlnEns_susVib_A3` は 440 Hz = A4)。倍音和による音高検出で全フォルダを測り、ハープ以外はすべて +12 半音で一致した (ハープは実音名)。`library.ts` の `nameOffset` に記録。

### 8. 空間音響・畳み込みリバーブ

| リポジトリ | 機能 | ライセンス | 判断 |
|---|---|---|---|
| [LCAV/pyroomacoustics](https://github.com/LCAV/pyroomacoustics) | 鏡像音源法・レイトレーシングで部屋のインパルス応答 | MIT | **考え方を採用**: 自前 `hallIR()` (直方体の鏡像音源 4 次 + 周波数ごとに減衰の違う拡散残響)。IR も自前なのでデータの権利問題がない |
| [jpcima/HybridReverb2-impulse-response-database](https://github.com/jpcima/HybridReverb2-impulse-response-database) | 実測 IR 集 (約 25 MB) | CC-BY-SA-4.0 | 代替候補 (表示義務と継承条件があるので今回は使わない) |
| [ShanonPearce/ASH-IR-Dataset](https://github.com/ShanonPearce/ASH-IR-Dataset) | バイノーラル IR (約 10.7 GB) | CC BY-NC-SA 4.0 | 不採用 (非商用・巨大) |
| [ircam-ismm/node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) | Node 用 Web Audio (Rust、ネイティブバイナリ) | BSD-3-Clause | 不採用 (ネイティブバイナリを避け、自前の FFT 畳み込みで足りる) |

## 厳選した 5 つ (役割がすべて違う)

| # | 役割 | 技術 | 取り入れ方 |
|---|---|---|---|
| 1 | オーケストラの音源 | **VSCO-2-CE** (CC0) | データを使用 (リポジトリには入れず `npm run od:fetch` で取得)。サンプラーは自前 (音高変換・ベロシティ層・ラウンドロビン・ループのクロスフェード・リリース) |
| 2 | 音色の橋 | **SMS の倍音モデル** (sms-tools の考え方) + DDSP の考え方 | 自前実装。オーケストラの録音を分析し、同じ倍音の電子音 (双子) を作って連続的に変形 |
| 3 | 粒と凍結 | **Clouds / Beads** (eurorack, MIT 部分) | 自前実装。オーケストラの録音そのものを粒にして電子側の素材にする |
| 4 | 電子音の発音 | **DX7 / msfa の FM** (Apache-2.0) + ユークリッド・確率リズム | 自前実装 (FM、ドラム声部、グリッチ) |
| 5 | 共通の空間 | **鏡像音源法** (pyroomacoustics の考え方) + FFT 畳み込み | 自前の IR 生成と畳み込み。オーケストラも電子も同じホールに置く |

外部プログラムは実行していない。取得したのは VSCO-2-CE の WAV (データ) だけで、git の部分 clone (blob を必要な分だけ) を使った。ffmpeg (LGPL/GPL、外部コマンド、同梱しない) は MP3 の書き出しにだけ使う。
