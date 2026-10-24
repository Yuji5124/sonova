# ZIG-PSYLO-0001 — PSYLO (サイロ)

自動生成: `npm run psylo` (VOICEVOX Engine が必要)。音声 `output/psylo/ZIG-PSYLO-0001.wav` / `.mp3` / `.mid` (Git 管理外)。
160 BPM · B minor (サビは D major) · 2:46 · 検証 OK (peak -1 dBFS, RMS -13.374 dBFS)

PSYENCE WORKSHOP の PSYLO A案 (サビ8小節・フック「サイロー」) を、SONOVA-TOYRIOT-0001「Tin Wings Riot」男声版と同じ作り方 (ラジオのイントロ、メガホンの A メロ、ダブル + 1オクターブ上のギャング・コーラスのサビ) で1曲にした。歌詞・旋律はすべてオリジナル。

## 歌声

- **VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎** — VOICEVOX Engine の歌唱機能 (CPU)。音程とタイミングは VOICEVOX:波音リツ の歌唱スタイル (6000) で作り、声を男声に差し替えている
- **安定化 0.75**: 各母音の入り 40 ms (しゃくり) と終わり 30 ms (次の音へのつなぎ) は残し、その間の音程を楽譜の音へ 75% 寄せ、細かい揺れをならした (`scripts/lib-voicevox.ts` の `stabilizePitch`)。`PSYLO_STABILIZE=0` でエンジンそのままの歌い方
- サビ: 玄野武宏 (ツンギレ・ノーマル) の2声を左右に、白上虎太郎 (おこ) が1オクターブ上 (= A案の原調、ロー F#5) で重なる
- 実在の歌手の声は使っていない (hide 本人の声も複製していない)
- **オープニングのアナウンス (英語)**: "Good evening. This is Radio Psyence. Close your eyes... the show is about to begin." — Piper (en-us-libritts-high.onnx, speaker 3 = LibriTTS 6701)。Voice: Piper (MIT) + LibriTTS (CC BY 4.0)。メガホンを通してラジオのコラージュに乗せる

## 変則リフ

オープニング (イントロ・riffA・A メロ1・サビ1) は生成器のリフ `R.m..mnnPPm...PP` のまま。**サビ1のあと (0:45 の riffB) から**次の変則パターンに差し替えた (スネアは2・4拍のまま、キックとベースは新しいアクセントに付いていく)。
`R` = アクセントのパワーコード、`P` = 別の音のパワーコード、`m` = ブリッジミュート、`s` = 32分のスタッター、`.` = 休み (1文字 = 16分)

| 区間 | 考え方 | 例 |
|---|---|---|
| riffB | 5ステップのセル `Rm.Pm` を小節線をまたいで流すポリメーター (TidalCycles の `{…}%16`)。アクセントが毎小節ずれる | `Rm.PmRm.PmRm.PmR m.PmRm.PmRm.PmRm mPmRm.PmRm.PmRm. PmRm.PmRm.PmR.ss` |
| verse2 | 3つずつの刻み (R m .) をずらして置き、4小節ごとにストップ (1発と空白、メガホンの声だけになる) | `Rm.Rm.Rm.Rm.R.m.` / `R...........m.mm` |
| riffA2 | 前半2小節はオープニングのリフが戻り、後半で崩れる: 3+3+3+3+2+2 のアクセント → 回転するユークリッドリズム E(7,16) (Toussaint / Strudel の `iter`) と32分のスタッター。音は B・D・E・F (♭5)・C (♭2) | `Rm.Rm.Rm.Rm.RmRm RPmPmPmPm.P.P.ss` |
| riffA3・outro | E(5,16) のコードと E(3,8) のミュートのクロスリズム、2ステップずつ回転 | `R..mP.mPm.Pm.Pm. R.P..P.mP.mP.mPm` |

参考にした GitHub リポジトリ (考え方だけを参考にし、コードは使っていない・同梱していない):

- [tidalcycles/Tidal](https://github.com/tidalcycles/Tidal) (GPL-3.0) — ポリメーター `{…}%16`
- [Strudel](https://codeberg.org/uzu/strudel) (AGPL-3.0, 旧 github.com/tidalcycles/strudel) — `iter` (毎周期の回転)・`ply` (音の細分化)
- [brianhouse/bjorklund](https://github.com/brianhouse/bjorklund) — ユークリッドリズム (Toussaint の論文)。SONOVA の `euclid` を使用
- [rhasspy/piper](https://github.com/rhasspy/piper) (MIT) — 英語アナウンスの音声合成 (LibriTTS の声、CC BY 4.0)。無い環境では [espeak-ng](https://github.com/espeak-ng/espeak-ng) (GPL-3.0)

## 構成

| 区間 | 開始 | 小節 |
|---|---|---|
| intro | 0:00 | 6 |
| riffA | 0:09 | 4 |
| verse1 | 0:15 | 8 |
| pre1 | 0:27 | 4 |
| chorus1 | 0:33 | 8 |
| riffB | 0:45 | 4 |
| verse2 | 0:51 | 8 |
| pre2 | 1:03 | 4 |
| chorus2 | 1:09 | 8 |
| bridge | 1:21 | 8 |
| solo | 1:33 | 8 |
| breakdown | 1:45 | 4 |
| riffA2 | 1:51 | 4 |
| pre3 | 1:57 | 4 |
| chorus3 | 2:03 | 8 |
| chorus4 | 2:15 | 8 |
| riffA3 | 2:27 | 4 |
| outro | 2:33 | 6 |

## 歌詞 (オリジナル)

- **intro**: Good evening. This is Radio Psyence. Close your eyes... the show is about to begin.
- **verse1**: tojita mabuta no / ura gawa de / dare mo shiranai / maku ga agaru
- **verse2**: fuan mo ikari mo / kagami no mae / tanoshisa mo / namida mo narande
- **pre1**: oto ni nare / motto soto e
- **pre2**: oto ni nare / motto soto e
- **pre3**: oto ni nare / motto soto e
- **chorus1**: ポケットの宇宙 / 知らない色 / 胸の奥 ショーが始まる / 光れ サイロー！
- **chorus2**: ポケットの宇宙 / 知らない色 / 胸の奥 ショーが始まる / 光れ サイロー！
- **chorus3**: ポケットの宇宙 / 知らない色 / 胸の奥 ショーが始まる / 光れ サイロー！
- **chorus4**: ポケットの宇宙 / 知らない色 / 胸の奥 ショーが始まる / 光れ サイロー！

## 仕掛け

- イントロ: ラジオのダイヤルを回す雑音 (帯域が動くノイズ・局のうなり・パチパチ) とメガホンの「テスト、テスト、聞こえますか」→ ビット落ちしたスネアの 16 分ロールでバンドが入る
- ドラムマシン: 生ドラムの下に、4 つ打ちのキック・歪んだスネア・16 分のハイハットをビット落ちさせて重ねる (Aメロ・サビ・ブリッジ)
- フランジャー: Aメロとブリッジのギターに、1〜7 ms で揺れる遅れた複製を足す (ジェット音)
- おもちゃのキーボード: リフの区間で、粗い矩形波 (奇数倍音だけ・ビット落ち・安っぽいビブラート) の対旋律
- 歌: VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎 の男声。Aメロはメガホン (650 Hz–3.4 kHz、歪み、ビット落ち) + 短いスラップ / Bメロは素の声とメガホンの 2 声 / サビはロック・ボーカルの処理 (ハイパス、1.1 kHz の鼻にかかった中域、3.3 kHz の抜け、テープのような歪み、速いレベラー) で左右のダブル + 1 オクターブ上のギャング・ボーカル、付点 8 分のエコー
- テープストップ: サビ2 の最後の 1 小節、バンド全体の再生速度が 1 → 0 に落ちて音程ごと止まる → ブリッジ
- 終わり: 最後の 2 小節で曲がラジオの帯域に縮み、雑音と一緒に遠ざかる
