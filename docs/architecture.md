# SONOVA アーキテクチャ

## BOUNDARY ENGINE の 2 本柱

- **MUSIC BOUNDARY** — 音楽ではない素材を楽器に変える: `source-analyzer` → `instrument-dna` → `synthesis-engine`
- **MUSIC GENERATOR** — 音楽を生む主体を変える: `music-generator`（楽器同士の相互作用）→ `composition-engine`（構成・ミックス・書き出し）

人間は「素材」「シード」「環境条件（展開）」「ルールの強さ」「ミックス（音量・ミュート）」を選ぶ。どの音をいつ鳴らすかは書かない。

```
PNG/JPG ──► source-analyzer ──► ImageFeatures (31 項目, 6 桁に丸め)
                                    │
                         seed ──►  instrument-dna ──► InstrumentDNA (+ mapping 対応表, dna_hash)
                                    │
           ARC (環境条件) ──► music-generator ──► GenEvent[] (note / resonance / mutation / wake, 因果リンク付き)
                                    │
                            composition-engine ──► Arrangement ──► synthesis-engine ──► Stereo 44.1kHz
                                    │                                                     │
                                    ├─► structure.json / generation.json / events.json   ├─► WAV 16bit (TPDF dither)
                                    └─► MIDI (@tonejs/midi)                               └─► soundvault-adapter ──► SOUNDVAULT
```

## パッケージ

| パッケージ | 役割 | 依存 |
|---|---|---|
| `packages/source-analyzer` | 画像解析（色・輝度・Sobel エッジ・Laplacian 粗さ・2D FFT 放射スペクトル・行列プロファイルの自己相関）、sha256 | なし |
| `packages/instrument-dna` | 特徴 → DNA の決定論的写像、対応表、内容ハッシュ、PRNG (sfc32)、ユークリッドリズム | source-analyzer |
| `packages/synthesis-engine` | 1 音のレンダリング（加算倍音 + FM + ノイズ + TPT SVF + ADSR）、Freeverb 型リバーブ、ルックアヘッド・リミッター | instrument-dna |
| `packages/music-generator` | ステップ単位のエージェントシミュレーション、相互作用ルール、因果連鎖の抽出 | instrument-dna |
| `packages/composition-engine` | 構成の導出、ミックス、WAV 読み書き・検証、MIDI、各種 JSON、作品番号 | 上記すべて + @tonejs/midi |
| `packages/soundvault-adapter` | SOUNDVAULT への登録・重複防止・ロールバック・台帳（Node 専用） | composition-engine |
| `apps/sonova-lab` | ブラウザアプリ（Vite + Web Audio API、レンダリングは Web Worker） | 上記 (adapter は dev サーバー側のみ) |

ブラウザと Node は同じ TypeScript を実行する。

## 再現性

- 特徴量と DNA の数値は小数 6 桁に丸めてから使う → `dna_hash` は環境に依存しない（ブラウザ = Node を検証済み）。
- 乱数は文字列シードから作る sfc32。`Math.random()` は使わない。
- 合成は 4096 点の正弦テーブル（線形補間）を使い、`Math.sin` 呼び出しを最小化。
- **同じ JS エンジン**ではビット単位で同一の WAV。Node 22 と Chromium の V8 では、3 候補のうち 2 つがバイト単位で同一、1 つは 2,646,000 サンプル中 1 サンプルが 1 LSB 異なった（−96 dBFS、超越関数の最終ビットの丸め）。
- エンジンを変えたら `*_VERSION` を上げる。作品番号は「正規シード + 無編集」のときだけ連番 (`SONOVA-EXP-0001`)、それ以外は内容ハッシュ (`SONOVA-EXP-H1A2B3C4D`)。

## 安全装置（音量・発散）

| 対象 | 仕組み |
|---|---|
| 連鎖の暴走 | 反応の深さ上限 3、効果ごとの不応期 (共鳴 2・音色 4・同調 8・リズム 16 ステップ)、1 ステップあたり反応 6 件まで（超過は `suppressedResponses` に記録） |
| エネルギー発散 | 毎ステップ減衰 ×0.93、総エネルギー上限 2.2（超えたら全体を縮小）、発音でエネルギー消費 |
| 音色・リズムの発散 | 音色は −1…1 にクランプし毎ステップ 0 に戻る、リズムのパルス数は 1…ステップ数×0.6 |
| 終わり | 最後の 3 秒は新しい音を出さない（余韻）、終端フェード |
| 音量 | 目標 RMS −17 dBFS（増幅は最大 +14 dB）→ ルックアヘッド・リミッター → −1 dBFS で硬クリップ、DC 除去。ブラウザの音量スライダーは 1 以上にならない |

テスト `tests/engine.test.ts` で「ルール強度 ×50 でも上限を守る」ことを確認している。
