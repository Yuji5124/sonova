# 外部 GitHub 調査 2 — ロック曲のための「珍しい手法」

調査日: 2026-10-18。目的: SOUNDVAULT の既存曲ではなく、**他の人の GitHub リポジトリ**から SONOVA の趣旨（音楽でないものを楽器にする／相互作用から音楽を生む）に合う、あまり使われない手法を探して SONOVA-ROCK-0001 に取り入れる。
方法: WebSearch で候補を探し、各リポジトリを `git clone --depth 1` して LICENSE・README・実装を読んだ（**実行はしていない**）。Star/Issue 数は前回と同じく確認できたものだけ記す。

## 採用した手法とライセンス上の扱い

| 手法 | 参考リポジトリ | ライセンス | 扱い |
|---|---|---|---|
| 拡張 Karplus–Strong + アンプ帰還（ハウリング） | [mrahtz/javascript-karplus-strong](https://github.com/mrahtz/javascript-karplus-strong) | **なし**（README で「意図的にライセンスなし」と明記） | コードは読んだだけ。論文 (Karplus & Strong 1983, Jaffe & Smith 1983, Sullivan 1990) から独自実装 |
| WDF ダイオードクリッパー（Wright ω） | [Chowdhury-DSP/chowdsp_wdf](https://github.com/Chowdhury-DSP/chowdsp_wdf)、[jatinchowdhury18/KlonCentaur](https://github.com/jatinchowdhury18/KlonCentaur) | BSD-3-Clause | コピー可能なライセンスだが、論文 (Werner et al. 2015, D'Angelo et al. 2019) から独自実装。ω の初期近似の係数は D'Angelo の論文値（元実装 MIT）を使用し、ニュートン法で精度を上げた |
| 円形膜のモーダル合成（ベッセル零点）、板のモード | [baconpaul/ripplerx](https://github.com/baconpaul/ripplerx) | **GPL-3.0** | 組み込み不可。考え方だけ参考にし、ベッセル零点は SONOVA 内で数値計算（係数表もコピーしていない） |
| 1 次元セルオートマトンのリズム | [mhitchman/IMS](https://github.com/mhitchman/IMS) | **なし** | 考え方だけ（Wolfram の基本 CA は公知） |
| バイトビート（数式が楽器） | [greggman/html5bytebeat](https://github.com/greggman/html5bytebeat) | MIT | 公知の技法を独自実装。式は SONOVA がリフから組み立てる（ユーザーの式を eval しない） |
| 画像をスペクトログラムに描く | [LeviBorodenko/spectrographic](https://github.com/LeviBorodenko/spectrographic) | MIT | 考え方を独自実装（対数周波数・コントラスト補正を追加） |
| ニューラル・アンプモデル | [sdatkinson/NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) | MIT（コード） | **不採用**。`.nam` モデル（重み）は作成者ごとに別ライセンスで、無料・再配布の条件を一律に満たせない。原理は WDF で代替 |

外部コードは 1 行もコピーしていない。実行時の依存も増えていない（すべて TypeScript で `packages/synthesis-engine/src/rock/` に実装）。

---

## 各リポジトリ（15 項目）

### 1. mrahtz/javascript-karplus-strong
1. URL: https://github.com/mrahtz/javascript-karplus-strong
2. 目的: André Michelle の Karplus–Strong ギターを HTML5 / Web Audio / asm.js で再実装したもの
3. ライセンス: **なし**（README: 元が商用製品 Audiotool になったため、あえてライセンスを付けない）→ 既定の著作権。コード利用不可
4. 最終更新: 2015-08-21
5. 保守: 更新停止
6. Windows: ブラウザ
7. CPU: 可
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし
11. 重み・素材: なし
12. SONOVA での可能性: 弦の物理モデルでギターを作るという方向性の確認
13. 最小実装: 論文どおり（遅延線 + 平均化フィルター + ノイズ励起）
14. 注意: ライセンスがないためコードを流用しない
15. 代替: CCRMA の EKS 解説、Sullivan 1990 の論文

### 2. Chowdhury-DSP/chowdsp_wdf
1. URL: https://github.com/Chowdhury-DSP/chowdsp_wdf
2. 目的: Wave Digital Filter で回路をモデル化するヘッダオンリー C++ ライブラリ（ダイオード、三極管など）
3. ライセンス: BSD-3-Clause (© 2022 Chowdhury-DSP)
4. 最終更新: 2026-07-02
5. 保守: 継続的に更新
6. Windows: C++ ライブラリ（CI 対象は未確認）
7. CPU: 可（SIMD 対応）
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし
11. 重み・素材: なし
12. 可能性: ダイオード対の反射波を Wright ω 関数で閉形式に解く方式（`wdft_nonlinearities.h`）を、SONOVA のアンプ歪みとして採用
13. 最小実装: 電圧源 + 抵抗 → 並列アダプタ → コンデンサ、根にダイオード対
14. 注意: なし（BSD）。それでも独自実装とした
15. 代替: tanh などの静的な波形整形（物理的な根拠は弱い）

### 3. jatinchowdhury18/KlonCentaur
1. URL: https://github.com/jatinchowdhury18/KlonCentaur
2. 目的: Klon Centaur（ギターペダル）を節点解析・WDF・RNN でモデル化したプラグイン
3. ライセンス: BSD-3-Clause (© 2020)
4. 最終更新: 2021-07-02
5. 保守: 更新は止まっている
6. Windows: JUCE プラグイン（VST/AU/Standalone）
7. CPU: 可
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし（JUCE は別ライセンス。ビルドする場合は確認が必要）
11. 重み・素材: RNN の重みがリポジトリ内にある（BSD に含まれると読めるが、再配布の前に確認が必要。SONOVA は使わない）
12. 可能性: 「クリッピング段の前に中域を持ち上げる」構成を参考にした（Tube Screamer 型の mid boost）
13. 最小実装: プラグインのビルド
14. 注意: JUCE の依存
15. 代替: chowdsp_wdf 単体

### 4. baconpaul/ripplerx
1. URL: https://github.com/baconpaul/ripplerx
2. 目的: 物理モデリング合成器。弦・梁・膜・太鼓の皮・板・マリンバ・管の共鳴器
3. ライセンス: **GPL-3.0** → SONOVA に組み込むと SONOVA 全体が GPL になるため不可
4. 最終更新: 2025-02-18
5. 保守: 更新は少ない
6. Windows: JUCE プラグイン
7. CPU: 可
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし
11. 重み・素材: なし
12. 可能性: 「太鼓の皮 = ベッセル関数の零点 j_mn の比で並ぶモード」という考え方を採用。零点は SONOVA 内で積分表示から数値計算した（2.4048, 3.8317, 5.1356 … とテストで照合）
13. 最小実装: 減衰正弦波の和、または 2 次共振器のバンク
14. 注意: GPL のため係数表もコピーしていない
15. 代替: 論文・教科書の物理（理想円形膜、単純支持板）

### 5. mhitchman/IMS
1. URL: https://github.com/mhitchman/IMS
2. 目的: 1 次元セルオートマトンで 2 声のリズム、マルコフモデルで旋律を作る ChucK + TouchOSC 作品
3. ライセンス: **なし**
4. 最終更新: 2018-08-07
5. 保守: 更新停止
6. Windows: ChucK
7. CPU: 可
8. GPU: 不要
9. API キー: 不要
10. 有料依存: Ableton Live に MIDI を送る構成（SONOVA は不要）
11. 重み・素材: なし
12. 可能性: 「CA の 1 世代 = 1 小節」。SONOVA ではハイハット、ゴーストノート、フィルのタム配置、ブレイクダウンの刻み、ソロのリズムに使用。ルール番号はドラムになった画像（塔）の反復の強さから選んだ
13. 最小実装: 3 近傍のビットをルール番号で引く（数行）
14. 注意: ライセンスなし → 考え方のみ
15. 代替: ユークリッドリズム（既存）

### 6. greggman/html5bytebeat
1. URL: https://github.com/greggman/html5bytebeat
2. 目的: バイトビート（t の整数式）のブラウザ用プレイヤー・エディタ
3. ライセンス: MIT (© 2021 Gregg Tavares)
4. 最終更新: 2025-02-07
5. 保守: 時々更新
6. Windows: ブラウザ
7. CPU: 可
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし
11. 重み・素材: なし
12. 可能性: 「プログラム（数式）そのものが楽器」。CODE INSTRUMENT の先行体験として、イントロとブレイクダウンでリフを 8kHz の数式で鳴らす
13. 最小実装: `v = (t*f*256/8000 & 192) ^ (t>>6 & t>>9 & 31)`
14. 注意: ユーザーが書いた式を `eval` すると任意コード実行になる。SONOVA は式を内部で組み立て、関数として評価する
15. 代替: 矩形波シンセ

### 7. LeviBorodenko/spectrographic
1. URL: https://github.com/LeviBorodenko/spectrographic
2. 目的: 画像をスペクトログラムとして音にする（画像の行 = 周波数、列 = 時間、明るさ = 音量）
3. ライセンス: MIT (© 2019 Levi Borodenko)
4. 最終更新: 2021-05-07
5. 保守: 更新停止
6. Windows: Python
7. CPU: 可（NumPy）
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし
11. 重み・素材: なし
12. 可能性: 「EVERYTHING IS AN INSTRUMENT」を最も直接に見せる手法。ブリッジで、ギターになった木の年輪 (bark.png) を 5.5〜14.5kHz に描いた。ブリッジはシンバルを抜いてあり、スペクトログラムで年輪が見える
13. 最小実装: 各行の正弦波 × 列ごとの明るさ
14. 注意: なし
15. 代替: 加算合成で直接描く（SONOVA の実装がこれ）

### 8. sdatkinson/NeuralAmpModelerCore
1. URL: https://github.com/sdatkinson/NeuralAmpModelerCore
2. 目的: Neural Amp Modeler の推論ライブラリ（実機アンプを学習したモデルを CPU で動かす）
3. ライセンス: MIT (© 2023 Steven Atkinson)
4. 最終更新: 2026-09-18
5. 保守: 活発
6. Windows: 対応（C++、プラグインは別リポジトリ）
7. CPU: 可（実時間）
8. GPU: 不要
9. API キー: 不要
10. 有料依存: なし
11. 重み・素材: `.nam` モデルは作成者ごとに別ライセンス。**無料で再配布可能なものを選んで個別に確認する必要がある**
12. 可能性: 実機アンプの音。Phase 5 以降に、ライセンスの明確なモデルが見つかれば検討
13. 最小実装: C++ でモデルを読み込んで `process()`
14. 注意: モデルファイルのライセンス
15. 代替: 今回の WDF 回路モデル（重み不要）

---

## 検索したが GitHub 上で見つからなかったもの

- Xenakis の GENDYN（動的確率合成）: Csound / SuperCollider（GPL）に実装があるが、独立した GitHub リポジトリは見つからなかった。今回は不採用
- Sullivan 方式の「歪み + フィードバック」を実装した GitHub リポジトリ: 見つからず（Stanford CCRMA の授業ページに ChucK 版がある）。論文から実装した
