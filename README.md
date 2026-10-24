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
| HAPPY TEARS | **ZIG — HAPPY TEARS** (PSYENCE WORKSHOP, FREAKTION SONG 002 / Phase 0): 30秒デモ3案 (A BRASS RIFF 160 / B ORCHESTRA RIOT 156 / C BROKEN PARADE 158 BPM)。同じ歌 (VOICEVOX、喜び・悲しみの声を同時に重ねる) に、VSCO-2-CE のオーケストラと新しい**物理モデルのバリトンサックス・バスクラリネット** (`orchestra-engine/src/reed.ts`)、歪ませたティンパニ、変異する画像楽器。6パートのステム | ✅ `npm run happytears -- --out <PSYENCE-WORKSHOP>` · 曲 `packages/composition-engine/src/series/happytears.ts` · データ `experiments/happytears/happytears.json` |
| NOBODY ON AIR | **ZIG — NOBODY ON AIR** (PSYENCE WORKSHOP, FREAKTION SONG 001): 30秒デモ3案 — A ROCK BROADCAST (160 BPM)、B GHOST FREQUENCY (140 BPM、ラジオ → 長調のサビ)、C FREAKTION REACTION (150 BPM、v1.1 の画像楽器と生成器の電子音がリフとぶつかり、種で突然変異)。歌は VOICEVOX の歌唱機能 | ✅ `npm run nobody -- --out <PSYENCE-WORKSHOP>` · 曲 `packages/composition-engine/src/series/nobody.ts` · データ `experiments/nobody/nobody.json` |
| v1.1 | **本体の強化** — 写真→楽器の精度 (ノイズを見分ける画像解析 v1.1、DNA v1.1: 画像と音の対応 0.68→0.88、加工に強く)、相互作用 v1.1 (フレーズと終止、鳴っている音を聴いて選ぶ音程、模倣・譲るの新ルール)、30秒の候補曲を各アーク16曲から選ぶ (SONOVA-EXP-0004〜0006)。v1.0 は変更なし (DNA ハッシュと音をテストで確認) | ✅ [experiments/v11/REPORT.md](experiments/v11/REPORT.md) · `npm run v11:eval` · `npm run v11:phase2` · `npm run v11:report` |
| 6 (先行) | ロック寄りの完成曲 **SONOVA-ROCK-0001**（3分03秒）。他の人の GitHub から珍しい手法を調査して独自実装 | ✅ [experiments/rock/REPORT.md](experiments/rock/REPORT.md)、調査 [research/github-survey-rock.md](research/github-survey-rock.md) |
| SONOVA 002 | **音が楽器を育てる** — 演奏するほど楽器の共鳴構造が進化する (SONOVA-GROW-0001, 83秒) | ✅ [experiments/s002/REPORT.md](experiments/s002/REPORT.md) |
| SONOVA 003 | **音楽が自分を修復する** — 欠落・不協和を聴いて検知し、別の楽器が補う (SONOVA-HEAL-0001, 81秒、修復なし版つき) | ✅ [experiments/s003/REPORT.md](experiments/s003/REPORT.md) |
| SONOVA 004 | **音が空間を作る** — 部屋の共鳴モードが音を決め、音が部屋を変形させる (SONOVA-SPACE-0001, 77秒、glTF アニメーション) | ✅ [experiments/s004/REPORT.md](experiments/s004/REPORT.md) |
| ロック版 002–004 | 同じ原理を ROCK-0001 のバンドで: **ROCK-GROW** (3分48秒)・**ROCK-HEAL** (2分45秒、修復なし版つき)・**ROCK-SPACE** (3分21秒) | ✅ [experiments/rock-series/](experiments/rock-series/) |
| 拡張ロック | **SONOVA-XROCK-0001** *Five Ways Out of the Song* (3分36秒) — ロックを 時間・テンポ・リズム・音高・声 の 5 方向に押し広げる | ✅ [experiments/xrock/REPORT.md](experiments/xrock/REPORT.md) |
| TOYRIOT | **SONOVA-TOYRIOT-0001** *Tin Wings Riot* (2:35, 172 BPM) — 90 年代後半の日本のインダストリアル/オルタナ・ポップロックの作り方を参考にしたオリジナル曲 (ラジオのコラージュ、メガホンの歌、ドラムマシン、フランジャー、おもちゃのキーボード、テープストップ)。歌詞もオリジナル。**歌は VOICEVOX の男声** (VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎、ロック・ボーカルの処理)。VOICEVOX が無い環境では内蔵の歌手で歌う | ✅ [experiments/toyriot/REPORT.md](experiments/toyriot/REPORT.md) · `npm run toyriot` (VOICEVOX Engine を起動しておく) · 声の聴き比べ `npm run toyriot:voices` |
| PSYLO | **ZIG-PSYLO-0001** *PSYLO* (2:46, 160 BPM, B minor / サビ D major) — PSYENCE WORKSHOP の PSYLO A案 (フック「サイロー」) を TOYRIOT 男声版の作り方で1曲に (英語のラジオ・アナウンスのイントロ (Piper + LibriTTS / espeak-ng)、サビ1のあとから**変則リフ** (3+3+3+3+2+2、5ステップのポリメーター、回転するユークリッドリズム — TidalCycles / Strudel / bjorklund の考え方)、メガホンの A メロ、プリコーラス、ダブル + 1オクターブ上のギャング・ボーカルのサビ×4)。歌詞・旋律はオリジナル。歌は VOICEVOX の男声 (VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎)、**音程の安定化** (母音の中の音程を楽譜へ75%寄せ、揺れをならす) つき | ✅ [experiments/psylo/REPORT.md](experiments/psylo/REPORT.md) · `npm run psylo` (VOICEVOX Engine が必要) · フックの声の聴き比べ `npm run psylo:voices` · 英語アナウンスの声の聴き比べ `npm run psylo:announcers` |
| ORCHESTRA × DIGITAL | フルオーケストラ (VSCO-2-CE、CC0 の録音) と電子音楽を対等に一曲にする制作。Phase 1 調査・Phase 2 の 4 つの実験まで | 🔄 [docs/orchestra-digital.md](docs/orchestra-digital.md) |
| 4, 5, 7 | 3D・文章・コードの読み込み、シリーズ管理 | 未着手 (設計のみ) |

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

### SONOVA-ROCK-0001 *Everything Is an Amplifier*

同じ 3 枚の画像がロックバンドになる: **木の年輪 → ギター**、**建物の外壁 → ドラム**、**夕焼け → ベースとリード**。145 BPM・C minor・ドロップ C。

| 手法（参考） | 曲での役割 |
|---|---|
| 拡張 Karplus–Strong + アンプ帰還（Sullivan 1990 / mrahtz/javascript-karplus-strong） | 弦の物理モデルのギター。アンプの音が弦に戻り、本当にハウリングする |
| WDF ダイオードクリッパー（chowdsp_wdf, KlonCentaur） | 回路方程式を解いて歪むアンプ |
| 円形膜のモーダル合成（ripplerx の考え方） | ベッセル関数の零点で鳴る太鼓、外壁の格子比で鳴るシンバル |
| 1 次元セルオートマトン（mhitchman/IMS） | 小節ごとに進化するハイハット・フィル・ソロのリズム。サビ2のハウリングがルールを変える |
| バイトビート（greggman/html5bytebeat） | イントロで数式がリフを鳴らす |
| 画像のスペクトログラム描画（LeviBorodenko/spectrographic） | ブリッジのスペクトログラムに木の年輪が浮かぶ |

```bash
npm run rock          # 約2分で output/rock/SONOVA-ROCK-0001.wav / .mid、experiments/rock/*.json と REPORT.md
```

### SONOVA 002–004

| 作品 | 原理 | 何が何を変えるか |
|---|---|---|
| SONOVA-GROW-0001 | 音が楽器を育てる | 外壁の画像から作った共鳴板 (24 モード) が、自分の鳴り方を聴いて育つ。よく鳴ったモードは長く響き、弾かれた音程へ調律され、鳴らないモードは死んで「聴こえたのに楽器になかった周波数」で生まれ直す。次の旋律は板の強いモードから選ぶ |
| SONOVA-HEAL-0001 | 音楽が自分を修復する | 聴き手が毎小節の**実際の音声**を楽譜と照らして聴き (楽譜追従・自分の修復音は差し引く)、欠落なら別の楽器が役を引き受け、半音ずれならベースが根音を変えて「間違った音を和音の音にする」。戻ったのを聴いたら補完をやめる |
| SONOVA-SPACE-0001 | 音が空間を作る | 部屋の共鳴モードがそのまま (微分音の) 音高に、初期反射の到着時刻がリズムになる。聴こえた低・中・高音と明るさで部屋の形・体積・壁の硬さが変わる。部屋の変形は glTF で書き出し |

```bash
npm run s002 && npm run s003 && npm run s004   # 合計約2分
```

聴き手の道具 (帯域エネルギー、楽譜の音高のエネルギー、スペクトルのピーク、Plomp–Levelt/Sethares の粗さ) は `packages/source-analyzer/src/listen.ts`、各作品は `packages/composition-engine/src/series/`。同じシードで 2 回レンダリングしてすべての WAV がバイト単位で一致することを確認済み。

### ロック版 SONOVA 002–004

SONOVA-ROCK-0001 のバンド（ギター ← 木の年輪、ドラム ← 外壁、ベースとリード ← 夕焼け）で、002–004 の原理をそれぞれ 1 曲にした。

| 作品 | 曲 | 原理がロックでどう働くか |
|---|---|---|
| [SONOVA-ROCK-GROW-0001](experiments/rock-series/SONOVA-ROCK-GROW-0001.md) | *Grown in the Feedback* — 116 BPM（重く遅く）、C minor | アンプの後ろの共鳴板（外壁の画像から）が区間ごとにギターとベースを聴いて育つ。次の区間のリードは板の強いモードの音程で弾く |
| [SONOVA-ROCK-HEAL-0001](experiments/rock-series/SONOVA-ROCK-HEAL-0001.md) | *Broken Strings, Living Band* — 162 BPM（ライブの勢い）、C minor | ケーブル抜け・リードの半音ずれ・弦切れ・ベースアンプ落ちを、モニターエンジニアのように各チャンネルの音を聴いて検知し、他のメンバーが補う。修復なし版つき |
| [SONOVA-ROCK-SPACE-0001](experiments/rock-series/SONOVA-ROCK-SPACE-0001.md) | *The Room Is the Amp* — 132 BPM、C# minor | 会場の最低モードがキー、会場の幅の往復時間がテンポ。リードは会場のモードに吸い寄せられて微分音になり、バンドの音で会場が細長いホールへ変形する。**ドラムも会場が叩く**: 天井の高さで周期が決まるポリメーターのキック、部屋のモード比の連符 (Rhythmicon)、部屋の変形量でずれるスネア (Turing Machine)、初期反射を引き伸ばしたフィル |

```bash
npm run rock:series            # 3 曲 (各 3 分ほど)。grow / heal / space を引数で 1 曲だけ
```

### SONOVA-XROCK-0001 *Five Ways Out of the Song*

同じバンドのロック曲を、他の人の GitHub / 研究の手法で 5 方向に広げた（すべて独自実装）。

| 方向 | 手法 | 曲での役割 |
|---|---|---|
| 時間 | Paulstretch（paulnasca/paulstretch_python、パブリックドメイン） | イントロ = サビ1 の 1 小節を 12 倍に引き伸ばした雲。リフの頭で突然止まる |
| テンポ | ナンカロウのテンポカノン（nanc-in-a-can/canon-generator の考え方） | ブリッジでリフを 3:4:5 の 3 つのテンポで重ね、ソロの 1 拍目で同時に着地 |
| リズム | リセット・リズム（tmhglnd/risset-rhythm-effect・MIT の考え方） | カノンの下で永遠に加速し続けて聴こえるドラム |
| 音高 | シェパード=リセットのグリッサンド | 最後のサビの前、終わらずに上がり続ける 6 本の弦 |
| 声 | トークボックス（Peterson & Barney の母音フォルマント）＋ 声道の物理モデルの歌手（Kelly–Lochbaum、Pink Trombone の考え方） | リードが "everything is an instrument" の母音でしゃべり、サビ（0:46〜）では歌手が**何語でもない言葉**でフックを歌う。言葉の音は夕焼けの画像から決まる。声は男女の中間（声道 16 cm）から始まり、サビごとに人の声の範囲の外へ（13 cm / 19.9 cm）、音程に同調した弦の共鳴が育つ |

```bash
npm run xrock        # 約4分
```

## 使い方

Node.js 22.12 以上（Windows / macOS / Linux）。

```bash
npm install
npm run dev          # SONOVA LAB → http://localhost:5173
npm test             # 72 テスト
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

Tone.js・DDSP・Strudel などの評価は [research/github-survey.md](research/github-survey.md)、ロック曲のための手法調査は [research/github-survey-rock.md](research/github-survey-rock.md)。外部リポジトリのコードはコピーしていない（Freeverb、ユークリッドリズム、Karplus–Strong、WDF、モーダル合成、セルオートマトン、バイトビート、スペクトログラム描画はすべて公開アルゴリズムから再実装）。GPL のリポジトリ（ripplerx）とライセンスのないリポジトリ（javascript-karplus-strong, IMS）は考え方だけを参考にした。
SONOVA が生成した音と素材画像はオリジナル（SOUNDVAULT では `license: "Original"`）。
