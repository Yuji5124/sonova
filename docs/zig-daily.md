# ZIG デイリー曲 → SOUNDVAULT

毎日 1 曲、ZIG 名義のオリジナル曲 (インストゥルメンタルのロック、約 3〜4 分) を生成し、SOUNDVAULT へ登録する。
無料・ローカル完結 (CPU のみ。有料 API・クラウド AI・API キー・GPU・外部の音声エンジンは使わない)。1 曲のレンダリングは手元で約 1 分 45 秒。

```bash
npm run zig:daily -- --vault ../soundvault --dry-run    # 何を登録するかだけ表示 (何も書かない)
npm run zig:daily -- --vault ../soundvault              # 生成して登録
```

| オプション | 意味 |
|---|---|
| `--vault <dir>` | SOUNDVAULT の clone (`SOUNDVAULT_DIR` でも可) |
| `--dry-run` | 計画 (曲名・作品番号・キー・BPM・ファイル名) だけを表示。生成も書き込みもしない |
| `--date YYMMDD` | 日付を指定 (既定: 実行時点の **Asia/Tokyo** の日付。PC のタイムゾーンには依存しない) |
| `--allow-extra` | その日に既に曲があっても、連番 (`-02`…) を付けて追加する (既定は 1 日 1 曲) |
| `--out <dir>` | 作業出力 (WAV・MIDI・実行ログ・JSON バックアップ)。既定 `output/zig-daily` (Git 管理外) |

終了コード: 登録済み・当日分あり (スキップ)・dry-run は 0、失敗は 1。**失敗を成功として扱わない。**

## 名前のルール (`YYMMDD_`)

日付は日本時間の実行日。例: 2026-10-27 → `261027`。

| 項目 | 例 |
|---|---|
| 作品番号 | `ZIG-DAILY-261027` (同日 2 曲目: `ZIG-DAILY-261027-02`) |
| 表示名 (SOUNDVAULT の `name`) | `261027_ZIG_MIDNIGHT ANTENNA` |
| ファイル | `public/sounds/bgm/261027_ZIG_midnight-antenna.ogg` |
| 素材 ID | `sonova_zig_daily_261027_ogg` |
| タグ | `261027`, `zig`, `zig-daily` |
| 実行記録 | `data/zig-daily/261027_ZIG_midnight-antenna.json` |

曲名はシード (`zig-daily-YYMMDD`) から決まる英語 2 語 (36 × 36 通り)。既存の名前と重なる場合は別の曲名を選び、既存データを上書きしない。既知の他者作品名と一致しないための小さな除外リストも持つ。
キー (12 音すべて・自然短音階・ドロップチューニング) と BPM (112〜168) も同じシードから決まる。同じ日付なら必ず同じ計画になる。

## 重複登録の防止

1. SOUNDVAULT に `YYMMDD_ZIG_` で始まる名前、または `sonova.zigDaily.stamp` が同じ記録があれば、**生成もせず何も書かずに終了** (`skipped-existing`)。
2. `data/zig-daily/` に記録ファイルがあるのに `sounds.json` に無い場合は、手編集の可能性があるため推測せず失敗として止まる。
3. 登録は既存の `packages/soundvault-adapter` を通す。同じ作品番号で別の音、同じ名前、同じファイル名、ディスク上に既にあるファイルはすべて拒否し、`sounds.json` / `projects.json` を元に戻す。既存レコードが 1 件でも変わったら失敗。
4. `--allow-extra` のときだけ連番で追加する。

## 失敗と記録

実行のたびに `<out>/YYMMDD.<status>.run.json` を残す (`registered` / `skipped-existing` / `dry-run` / `failed`、開始・終了時刻、メッセージ、エラー)。
登録成功時は、生成条件・参照元・音声の sha256・検証結果を `data/zig-daily/<ファイル名>.json` に保存し、曲と一緒にコミットする。再実行しても安全 (上記の重複防止)。

## 「hide さんの曲をベースに」の扱い

既存曲の旋律・歌詞・音源・声は一切使わない。参照するのは次の 2 つだけで、記録 (`sonova.references`) に残す。

- PSYENCE WORKSHOP の制作上の考え方 (ZIG-PSYLO-0001 / TOYRIOT の作り方。`experiments/psylo/REPORT.md`, `experiments/toyriot/REPORT.md`)
- 90 年代後半の日本のインダストリアル/オルタナ・ポップロックに共通する一般的な特徴 (重いドロップチューニング、主音のパワーコード、トライトーンと短 2 度、変則アクセントのリフ)

音は SONOVA が自作の画像 (bark / tower / sunset) から合成し、リフとフックは日付シードから新たに生成する。変則リフは `applyPsyloRiffs` (3+3+3+3+2+2、5 ステップのポリメーター、回転するユークリッドリズム) を使う。

## 既知の制限

- **インストゥルメンタルのみ。** 歌詞と歌声は作らない。歌詞を書く生成 AI は無料・ローカルの条件に合わず、VOICEVOX / Piper は各自の環境に別途インストールが必要なため。
- 同じ 3 枚の画像から作る楽器なので、音色の傾向は毎日近い。日ごとに変わるのはキー・テンポ・リフ・フック・曲名・変則リフの根音。
- 音量はエンジンの `master()` に従い、WAV のサンプルピークは −1 dBFS 以下。true peak は既存のロック曲と同じく 0 dBFS を超える (+1〜+3 dBFS)。これは既存の全ロック曲に共通する仕様で、このツールで追加した挙動ではない。

## 毎日 7:00 (JST) の自動実行

SOUNDVAULT 側の `.github/workflows/zig-daily.yml` (GitHub Actions、無料) が SONOVA の `main` を取得して `npm run zig:daily` を実行する。
SOUNDVAULT への反映は **Pull Request** で提案され、**承認 (マージ) するまで `main` は変わらない** (AGENTS.md の「SOUNDVAULT 側の commit / push は承認を得てから」に従う)。詳細は SOUNDVAULT の README と下記の条件を参照。

- 前の提案 (`zig-daily/*` の未マージ PR) が残っている間は、衝突を避けるため新しい曲を作らない (ジョブに警告が出る)。
- スケジュールは遅延・欠落しうる (高負荷時)。8:00〜9:30 台にもう 1 回再試行枠があり、重複防止があるので安全。
- 公開リポジトリでは 60 日間リポジトリの動きが無いとスケジュールが自動停止する。
