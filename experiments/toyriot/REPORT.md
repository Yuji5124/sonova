# SONOVA-TOYRIOT-0001 — Tin Wings Riot

自動生成: `npm run toyriot`。音声 `output/toyriot/SONOVA-TOYRIOT-0001.wav` / `.mp3` / `.mid` (Git 管理外)。
172 BPM · E · 2:35 · 検証 OK (peak -1 dBFS, RMS -13.33 dBFS)

90 年代後半の日本のインダストリアル/オルタナティブ・ポップロックの**作り方**を参考にしたオリジナル曲。既存曲の旋律・歌詞・音源は使っていない (リフ・進行・フックは SONOVA のロック生成器、歌詞はこの曲のために書いた)。

## 仕掛け

- イントロ: ラジオのダイヤルを回す雑音 (帯域が動くノイズ・局のうなり・パチパチ) とメガホンの「テスト、テスト、聞こえますか」→ ビット落ちしたスネアの 16 分ロールでバンドが入る
- ドラムマシン: 生ドラムの下に、4 つ打ちのキック・歪んだスネア・16 分のハイハットをビット落ちさせて重ねる (Aメロ・サビ・ブリッジ)
- フランジャー: Aメロとブリッジのギターに、1〜7 ms で揺れる遅れた複製を足す (ジェット音)
- おもちゃのキーボード: リフの区間で、粗い矩形波 (奇数倍音だけ・ビット落ち・安っぽいビブラート) の対旋律
- 歌: VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎 の男声。Aメロはメガホン (650 Hz–3.4 kHz、歪み、ビット落ち) + 短いスラップ / Bメロは素の声とメガホンの 2 声 / サビはロック・ボーカルの処理 (ハイパス、1.1 kHz の鼻にかかった中域、3.3 kHz の抜け、テープのような歪み、速いレベラー) で左右のダブル + 1 オクターブ上のギャング・ボーカル、付点 8 分のエコー
- テープストップ: サビ2 の最後の 1 小節、バンド全体の再生速度が 1 → 0 に落ちて音程ごと止まる → ブリッジ
- 終わり: 最後の 2 小節で曲がラジオの帯域に縮み、雑音と一緒に遠ざかる

## 構成

| 区間 | 開始 | 小節 |
|---|---|---|
| intro | 0:00 | 6 |
| riffA | 0:08 | 4 |
| verse1 | 0:13 | 8 |
| pre1 | 0:25 | 4 |
| chorus1 | 0:30 | 8 |
| riffB | 0:41 | 4 |
| verse2 | 0:47 | 8 |
| pre2 | 0:58 | 4 |
| chorus2 | 1:04 | 8 |
| bridge | 1:15 | 8 |
| solo | 1:26 | 8 |
| breakdown | 1:37 | 4 |
| riffA2 | 1:43 | 4 |
| pre3 | 1:48 | 4 |
| chorus3 | 1:54 | 8 |
| chorus4 | 2:05 | 8 |
| riffA3 | 2:16 | 4 |
| outro | 2:22 | 6 |

## 歌詞 (オリジナル)

- **intro**: tesuto tesuto / kikoemasuka
- **verse1**: karappo no machi de / neon ga haneru / buriki no tsubasa / senaka ni tsukete
- **verse2**: kagami no naka de / nisemono ga warau / kowareta rajio / boku no koe dake
- **pre1**: mada tarinai / motto oto wo
- **pre2**: mada tarinai / motto oto wo
- **pre3**: mada tarinai / motto oto wo
- **chorus1**: tondeke tondeke / sora wo kettobashite / uso no hoshi nante / zenbu kowashiteke
- **chorus2**: tondeke tondeke / sora wo kettobashite / uso no hoshi nante / zenbu kowashiteke
- **chorus3**: tondeke tondeke / sora wo kettobashite / uso no hoshi nante / zenbu kowashiteke
- **chorus4**: tondeke tondeke / sora wo kettobashite / uso no hoshi nante / zenbu kowashiteke

歌: **VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎** — VOICEVOX Engine の歌唱機能 (CPU) で生成した男声。音程とタイミングは VOICEVOX:波音リツ の歌唱スタイルで作り、声を男声に差し替えている。歌詞はカナのまま歌う (濁音・ッ・ンも)。hide 本人の声は複製していない (声の加工の仕方だけを参考にした)。
