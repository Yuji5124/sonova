# 外部 GitHub 技術調査 (Phase 0)

調査日: 2026-10-18 / 方法: 各リポジトリを `git clone --depth 1` して README・LICENSE・依存定義・実装コードを確認し、GitHub のリポジトリページで Star/Issue/PR 数を確認した。
**コードは一切実行していない**（読むだけ）。数値はその時点のスナップショット。確認できなかった項目は「未確認」と記す。

## 結論 (採用方針)

| リポジトリ | ライセンス | SONOVA v1.0 での扱い |
|---|---|---|
| Tonejs/Tone.js | MIT | **今回は依存に入れていない**。オフライン決定論レンダリング（ブラウザ = Node で同じ WAV）を優先して自前 DSP にした。リアルタイム演奏 (Phase 4+) で採用候補 |
| Tonejs/Midi (`@tonejs/midi`) | MIT | **採用**（MIDI 書き出し）。唯一の実行時外部依存 |
| joaoCarvalho1000/audio-as-code | MIT | 原理のみ参考（スコア＝編集可能なデータ、測定フィードバック）。コード不使用 |
| MaxAlyokhin/binary-synth | MIT | 原理のみ参考（ファイルを解釈して音にする）。SONOVA は**バイト列ではなく構造特徴**を使う点で意図的に異なる。コード不使用 |
| ktakahashi74/conchordal | MIT OR Apache-2.0 | 原理のみ参考（環境条件だけを与え、音は相互作用から創発。協和への引き寄せ）。コード不使用 |
| magenta/ddsp | Apache-2.0 | 必須依存にしない。TensorFlow ≤2.11 / NumPy <1.24 固定で現行 Python と非互換のため Phase 5 以降に独立検証 |
| tidalcycles/strudel | **AGPL-3.0** | 組み込まない。GitHub 版は 2025-06-19 にアーカイブ、開発は Codeberg に移転。AGPL はネットワーク提供時にもソース公開義務があるため、SONOVA に組み込む場合は SONOVA 全体の AGPL 化が必要 |

「直接コピー」と「公開アイデアからの独自実装」の区別: SONOVA のコードはすべて独自実装。Freeverb (Jezar, パブリックドメイン) のコム/オールパス定数と、ユークリッドリズム (Toussaint) は公開アルゴリズムとして再実装した。外部リポジトリのソースは 1 行もコピーしていない。

---

## 1. Tonejs/Tone.js

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/Tonejs/Tone.js （実在確認済み） |
| 2. 目的と機能 | Web Audio API 上のインタラクティブ音楽フレームワーク。Transport/スケジューリング、Synth/FMSynth/AMSynth、エフェクト、Sampler |
| 3. ライセンス | MIT (LICENSE.md, © 2014-2025 Yotam Mann) |
| 4. 最終更新 | 2026-10-04 (コミット `v15.5.57`)。npm の latest は 15.1.22（リポジトリのタグは dev プレリリース系） |
| 5. 保守状況 | Star 約14.8k、open Issue 42、open PR 16。活発 |
| 6. Windows | ブラウザライブラリなので OS 非依存 |
| 7. CPU 実行 | 可（Web Audio） |
| 8. GPU | 不要 |
| 9. API キー | 不要 |
| 10. 有料依存 | なし（依存: standardized-audio-context, tslib） |
| 11. 重み・音素材 | モデルなし。Sampler の例は外部サンプル URL を使うものがある（使う場合は個別にライセンス確認） |
| 12. SONOVA での可能性 | リアルタイム試聴・ライブ演奏・Transport 同期。ただしブラウザの実時間レンダリングは WAV 書き出しと完全一致させにくい |
| 13. 最小実装 | `npm i tone` → `new Tone.FMSynth().toDestination().triggerAttackRelease('C4','8n')` |
| 14. セキュリティ | 実行時依存は少ない。AudioContext はユーザー操作後に開始する必要あり |
| 15. 代替 | Web Audio API 直接（SONOVA LAB は現在これを使用） |

## 2. Tonejs/Midi

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/Tonejs/Midi （npm: `@tonejs/midi`） |
| 2. 目的と機能 | MIDI ファイルの読み書き（JSON 風 API） |
| 3. ライセンス | MIT (LICENSE.md, © 2016 Yotam Mann) |
| 4. 最終更新 | 2023-05-31（dependabot マージ）。npm latest 2.0.28 |
| 5. 保守状況 | Star 約1.0k、open Issue 17、open PR 3。機能は安定、更新は少ない |
| 6. Windows | OS 非依存（Node/ブラウザ） |
| 7. CPU | 可 |
| 8. GPU | 不要 |
| 9. API キー | 不要 |
| 10. 有料依存 | なし（依存: midi-file MIT, array-flatten MIT） |
| 11. 重み・音素材 | なし |
| 12. 可能性 | **採用済み**: 楽器ごとのノートトラック + 共鳴トラック、音色変化を CC74 で書き出し |
| 13. 最小実装 | `new Midi(); midi.addTrack().addNote({midi, time, duration, velocity}); midi.toArray()` |
| 14. セキュリティ | Node では UMD ビルドが読まれるため ESM の名前付き import が使えない（SONOVA は両形式に対応する読み込みで回避） |
| 15. 代替 | MIDI SMF を自前で書く（数百行で可能） |

## 3. joaoCarvalho1000/audio-as-code

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/joaoCarvalho1000/audio-as-code |
| 2. 目的と機能 | エージェント向け音楽フレームワーク。検証付き JSON スコア → オフライン合成 (WAV/ステム/MIDI)、信号測定によるフィードバック。LLM は呼ばない |
| 3. ライセンス | MIT (LICENSE, © 2026 Audio as Code contributors) |
| 4. 最終更新 | 2026-10-17（0.5.0 公開の記録） |
| 5. 保守状況 | Star 12、open Issue 3、open PR 1。0.5.0 alpha。SECURITY.md あり（保守ブランチ・応答期限なしと明記） |
| 6. Windows | README に PowerShell 手順あり（`.venv/Scripts/python.exe`） |
| 7. CPU | 可（NumPy によるオフライン合成） |
| 8. GPU | 不要 |
| 9. API キー | 不要（README: "No API keys, audio device, model weights, sample downloads, or DAW are required"） |
| 10. 有料依存 | なし（numpy, pydantic, mido。任意で pyloudnorm） |
| 11. 重み・音素材 | なし（全音色をコードで合成） |
| 12. 可能性 | 「スコアは編集可能なデータ」「測定値でエージェントが修正」という設計は SONOVA の検証ループと同じ考え方。Python 側で長尺 (5分まで) レンダリングする選択肢になる |
| 13. 最小実装 | `uv sync` → `uv run aac instruments` / Python でスコアを書いてレンダリング |
| 14. セキュリティ | alpha。スコア JSON は検証データとして扱う設計。依存を固定して使う |
| 15. 代替 | SONOVA の composition-engine（同等の WAV/MIDI 書き出しを自前実装済み） |

## 4. MaxAlyokhin/binary-synth

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/MaxAlyokhin/binary-synth （デモ https://bs.stranno.su） |
| 2. 目的と機能 | 任意ファイルのバイナリを 8/16bit の「命令」列として読み、周波数・フィルター・LFO を制御するブラウザ合成器。MIDI 出力モードあり |
| 3. ライセンス | MIT (LICENSE, © 2023 Max Alyokhin) |
| 4. 最終更新 | 2026-01-20 |
| 5. 保守状況 | Star 134。Issue/PR 数はページ上で未表示（未確認）。v1.17.0 |
| 6. Windows | ブラウザアプリ（単一 HTML でオフライン動作） |
| 7. CPU | 可 |
| 8. GPU | 不要 |
| 9. API キー | 不要。ファイルはブラウザ内で処理 |
| 10. 有料依存 | なし（Vue, Pinia, worker-timers） |
| 11. 重み・音素材 | なし |
| 12. 可能性 | 「どんなファイルも楽器」という MUSIC BOUNDARY の先行例。SONOVA はバイト値ではなく**意味的・構造的特徴**（色・エッジ・反復）を使うことで差別化（指示書 §7 の要件） |
| 13. 最小実装 | 原理: `bytes → word(8/16bit) → frequency` を一定速度で読む |
| 14. セキュリティ | 外部送信なし（`navigator.requestMIDIAccess` のみ）。ファイル内容を実行しない |
| 15. 代替 | SONOVA の CODE/TEXT INSTRUMENT (Phase 4) でバイト列モードを補助的に追加可能 |

## 5. ktakahashi74/conchordal

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/ktakahashi74/conchordal （論文 arXiv:2603.25637） |
| 2. 目的と機能 | 心理音響に基づく生成作曲の生態系。Voice が協和場（粗さ・調和性）と創発メーターに反応し、和声とリズムが創発する。Rhai スクリプトで条件を与える |
| 3. ライセンス | MIT OR Apache-2.0（LICENSE-MIT / LICENSE-APACHE） |
| 4. 最終更新 | 2026-10-18（調査当日） |
| 5. 保守状況 | v0.4.0 alpha（ALIFE 2026 発表）。Star 0 表示、open Issue 2。API 変更の可能性を明記 |
| 6. Windows | CI が Linux/macOS/Windows を対象（README） |
| 7. CPU | 可（Rust, rustfft, cpal） |
| 8. GPU | 計算には不要。GUI は egui/glow (OpenGL)。`--nogui` あり |
| 9. API キー | 不要 |
| 10. 有料依存 | なし |
| 11. 重み・音素材 | モデル重みなし。samples/ は Rhai スクリプト |
| 12. 可能性 | 「Director は条件だけを形づくり、拍は予定しない」という設計を SONOVA の ARC（環境条件）に採用。協和への引き寄せ (attract ルール) も同じ発想 |
| 13. 最小実装 | `cargo run --release -- samples/01_a_single_voice.rhai` |
| 14. セキュリティ | Rhai スクリプトはサンドボックス言語だが、外部スクリプトは内容を確認してから実行 |
| 15. 代替 | SONOVA music-generator（TypeScript, 独自実装） |

## 6. magenta/ddsp

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/magenta/ddsp |
| 2. 目的と機能 | 微分可能な DSP（倍音合成・フィルター・リバーブ）を深層学習の出力層に使う。音色転写 (timbre transfer) |
| 3. ライセンス | Apache-2.0 (© 2019 Google LLC) |
| 4. 最終更新 | 2026-10-07（lint 置換コミット）。version 3.7.0 |
| 5. 保守状況 | Star 約3.4k、open Issue 51、open PR 5。機能開発は事実上停止、依存は古いまま |
| 6. Windows | 未確認（公式手順なし）。TensorFlow ≤2.11 の制約上、新しい Python では導入困難と判断 |
| 7. CPU | 推論は CPU 可能だが遅い。学習は GPU 前提 |
| 8. GPU | 学習・実用速度には事実上必要 |
| 9. API キー | 不要。ただし依存に `google-cloud-storage`、学習用 extras に GCP 系がある |
| 10. 有料依存 | 必須ではないが、Colab/GCP を前提とした手順が多い |
| 11. 重み・音素材 | 事前学習モデルは GCS で配布。**重みのライセンスは README で確認できず未確認** |
| 12. 可能性 | 「解釈可能な合成パラメータ（倍音分布・ノイズ）」という考え方は Instrument DNA と同型。SONOVA の加算合成 + ノイズは DDSP の Harmonic+FilteredNoise を手で設計したものに近い |
| 13. 最小実装 | `pip install ddsp` → `ddsp.synths.Harmonic()(amps, harmonic_distribution, f0_hz)` |
| 14. セキュリティ | 古い依存（protobuf ≤3.20, numpy <1.24 等）に既知脆弱性がある可能性。隔離環境で検証すべき |
| 15. 代替 | SONOVA synthesis-engine（同等の倍音+ノイズ合成を NumPy 不要で実装済み）。将来は小型モデルを ONNX で CPU 推論する案 |

## 7. tidalcycles/strudel

| 項目 | 内容 |
|---|---|
| 1. 実在URL | https://github.com/tidalcycles/strudel → **2025-06-19 にアーカイブ（読み取り専用）**。現行は https://codeberg.org/uzu/strudel |
| 2. 目的と機能 | TidalCycles のパターン言語をブラウザで動かすライブコーディング環境 |
| 3. ライセンス | AGPL-3.0 |
| 4. 最終更新 | GitHub 版 2025-06-19（移転告知コミット）。Codeberg 側は未確認 |
| 5. 保守状況 | GitHub: Star 約3.0k、Issue 243 / PR 43 が残ったままアーカイブ |
| 6. Windows | ブラウザ (strudel.cc) |
| 7. CPU | 可 |
| 8. GPU | 不要 |
| 9. API キー | 不要 |
| 10. 有料依存 | なし |
| 11. 重み・音素材 | 既定のサンプルバンクは外部から読み込む。各サンプルのライセンスは個別確認が必要（未確認） |
| 12. 可能性 | パターン変換（rev, every, euclid）の語彙は作曲構造の参考になる |
| 13. 最小実装 | strudel.cc で `s("bd sd")` |
| 14. セキュリティ / ライセンス | **AGPL**: 組み込んで配布・ネットワーク提供すると SONOVA 全体のソース公開義務が生じる。今回は組み込まない |
| 15. 代替 | ユークリッドリズムやパターン操作は SONOVA 内で独自実装（instrument-dna/rhythm.ts） |

---

## SONOVA が実際に使う外部ソフトウェア

| 名前 | 版 | ライセンス | 用途 | 必須? |
|---|---|---|---|---|
| @tonejs/midi | 2.0.28 | MIT | MIDI 書き出し | 実行時 |
| midi-file, array-flatten | 1.2.4, 3.0.0 | MIT | @tonejs/midi の依存 | 実行時 |
| Vite | 6.4.4 | MIT | 開発サーバー・ビルド | 開発 |
| TypeScript | 5.9.3 | Apache-2.0 | 型検査 | 開発 |
| tsx | 4.23.15 | MIT | TS スクリプト実行 | 開発 |
| Vitest | 5.0.5 | MIT | テスト（3.x に既知脆弱性があり 5.x を採用、`npm audit` 0 件） | 開発 |
| pngjs | 7.0.0 | MIT | CLI での PNG 読み書き | 開発 |
| playwright-core | 1.64.1 | Apache-2.0 | ブラウザ検証（ブラウザはダウンロードせず、手元の Chrome/Edge を使用） | 任意 |
| ffmpeg (外部コマンド) | 6.1.1 | LGPL/GPL (ビルド依存) | SOUNDVAULT 用 OGG Vorbis 変換。なければ WAV のまま登録 | 任意 |

ffmpeg はコマンドとして呼び出すだけで、SONOVA に同梱・リンクしない。生成した音声には ffmpeg のライセンスは及ばない。
