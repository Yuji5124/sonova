# SONOVA 実験レポート (Phase 1–2)

自動生成: `npx tsx scripts/report.ts`。数値はすべて `experiments/phase1`・`experiments/phase2` の JSON から。

## Phase 1 — 画像 3 枚 → 3 つの楽器

| | bark (木の年輪) | tower (建物の外壁) | sunset (夕焼けの海) |
|---|---|---|---|
| 素材 sha256 | `9c88403909ba…` | `87643426093b…` | `a9dac2de5055…` |
| instrument_id | `inst-9c884039-187482` | `inst-87643426-187482` | `inst-a9dac2de-187482` |
| dna_hash | `07ba6016a573f9` | `1191843fa7154d` | `0b97a5fc7f8689` |
| 平均輝度 / コントラスト | 0.39 / 0.27 | 0.50 / 0.55 | 0.38 / 0.56 |
| 彩度 / 色の豊かさ | 0.65 / 0.17 | 0.10 / 0.11 | 0.53 / 0.32 |
| エッジ強度 / 粗さ | 0.119 / 0.111 | 0.126 / 0.111 | 0.022 / 0.011 |
| 反復の強さ (横 / 縦) | 0.34 / 0.62 | 0.76 / 0.79 | 0.00 / 0.00 |
| 高い空間周波数の比率 | 0.687 | 0.095 | 0.003 |
| → 音域 | G3–G#4 | A2–E4 | B1–F#3 |
| → Attack / Decay | 0.008s / 0.77s | 0.005s / 1.25s | 0.670s / 1.58s |
| → 明るさ / ノイズ | 0.93 / 0.47 | 0.55 / 0.46 | 0.06 / 0.14 |
| → 共鳴 | 0.69 | 0.87 | 0.00 |
| → リズム | E(5,16) ×1 | E(4,16) ×1 | E(2,12) ×0.25 |
| → FM 比 / 深さ | 3.00 / 1.65 | 2.00 / 0.43 | 0.50 / 1.71 |
| → 反応ルール | rhythm 1.00, resonate 0.59 | resonate 1.00, rhythm 0.67 | timbre 1.00, entrain 0.43 |
| 試聴 WAV 検証 | OK peak -1.14 dBFS | OK peak -3.147 dBFS | OK peak -7.028 dBFS |

役割はコードに書いていない。特徴量から決まった:
木目の細かい不規則なエッジ → **リズムを生む楽器**、外壁の縦横の格子 → **共鳴する楽器**、夕焼けの彩度と滑らかさ → **音色が変わる楽器**。

### 特徴 → 音の対応 (bark の例、全項目は各 DNA の `mapping`)

| パラメータ | 値 | 素材の特徴 | 理由 |
|---|---|---|---|
| `pitch_range.root_pc` | 0 | dominantHue | 色相を五度圏に配置 (30°ごとに完全五度) |
| `pitch_range.center` | 61 | meanLuminance, spectralCentroid | 明るく細かい模様の画像ほど高い音域 |
| `pitch_range.width` | 13 | contrast | コントラストが大きいほど広い音域 |
| `harmonics.rolloff` | 0.6 | highFreqRatio, spectralCentroid | 細かい模様が多いほど高次倍音が残る |
| `harmonics.odd_bias` | -0.091222 | verticalness | 縦エッジが多いと奇数倍音 (矩形的)、横エッジが多いと偶数倍音 |
| `harmonics.amplitudes` | 16 partials | radialSpectrum | 空間周波数の16帯域を16倍音の強さに写像 |
| `harmonics.inharmonicity` | 0.002445 | edgeDensity, orientationEntropy, textureRoughness | 鋭いエッジ → 硬い素材の非調和な倍音 (鐘・板) |
| `harmonics.damping` | 0.08 | highFreqRatio, edgeMean | 滑らかな画像ほど高次倍音が早く減衰 (柔らかい音) |
| `harmonics.brightness` | 0.931104 | spectralCentroid, edgeMean | 空間周波数の重心 → 音の明るさ |
| `attack` | 0.008092 | edgeMean | エッジが鋭いほど立ち上がりが速い |
| `decay` | 0.770911 | edgeMean, luminanceStd, strengthX, strengthY | 滑らかさ・明暗の幅・縦横の格子構造 → 減衰時間 |
| `sustain` | 0.522581 | contrast, edgeMean | 低コントラスト → 持続する音 |
| `resonance.amount` | 0.685609 | repetitionStrength | 反復構造が強い素材ほど共鳴しやすい |
| `resonance.q` | 6.409529 | repetitionStrength | 反復の規則性 → フィルターの鋭さ |
| `resonance.ring` | 3.426593 | repetitionStrength, textureRoughness | 共鳴の残響時間 |
| `release` | 0.954059 | edgeMean, repetitionStrength | 立ち上がりと共鳴 → 余韻 |
| `noise.amount` | 0.472773 | textureRoughness, orientationEntropy | 細かな粗さ (木目・粒) → 打撃ノイズ |
| `noise.color` | 1 | highFreqRatio, warmth | 暖色ほど低いノイズ、細かい模様ほど高いノイズ |
| `modulation.fm_ratio` | 3 | colorfulness | 色の豊かさで FM の周波数比を選択 |
| `modulation.fm_index` | 1.65054 | meanSaturation, colorfulness | 彩度 → FM の深さ (倍音の揺らぎ) |
| `modulation.vibrato_rate` | 2.90625 | dominantPeriod | 反復周期 → ビブラートの速さ |
| `modulation.vibrato_depth` | 0.032227 | hueConcentration, luminanceEntropy | 色相が散らばるほど音程が揺らぐ (半音単位) |
| `filter.cutoff_ratio` | 16.897664 | spectralCentroid, edgeMean | 明るさ → カットオフ (基音の倍数) |
| `rhythm.steps` | 16 | repetitionStrength, orientationEntropy | 格子状 → 16分割、曲線的 → 12分割 |
| `rhythm.pulses` | 5 | edgeDensity, textureRoughness, repetitionStrength | エッジと粗さ → 発音数が増え、規則的な反復 → 間引かれる (ユークリッドリズム) |
| `rhythm.rotation` | 3 | seed | シードでリズムの開始位置をずらす |
| `rhythm.rate` | 1 | edgeMean | ゆっくり立ち上がる楽器は長い周期で発音 |
| `pan` | -0.077096 | brightCenterX, seed | 画像の明るい部分の左右位置 → 定位 |
| `interaction.emission` | 0.974726 | edgeDensity, contrast, textureRoughness | 鋭く明暗のある素材ほど他の楽器へ強く働きかける |
| `interaction.sensitivity` | 0.82856 | contrast, repetitionStrength | 柔らかい・規則的な素材ほど他の楽器に反応しやすい |
| `interaction.memory_length` | 9 | repetitionStrength | 反復構造 → 主題を覚えている長さ |
| `interaction.rhythm` | 1 | (複合) | 不規則な方向のエッジと粗さ → 他の楽器の変化から新しいリズムを生む |
| `interaction.resonate` | 0.591929 | (複合) | 規則的な反復構造 → 他の楽器の音に共鳴する |

## Phase 2 — 3 楽器の相互作用による 30 秒 × 3 候補

| 作品番号 | 曲名 | 展開 | BPM | 旋法 | 音 | 共鳴 | 変化 | 最大連鎖 | 相互作用 (ルール別) | peak / RMS |
|---|---|---|---|---|---|---|---|---|---|---|
| SONOVA-EXP-0001 | Rings Wake the Tower | bloom | 87 | dorian | 66 | 16 | 27 | 2 | resonate 16, timbre 16, rhythm 6, entrain 5 | -1 / -17.055 dBFS |
| SONOVA-EXP-0002 | Facade Tide | tide | 88 | aeolian | 66 | 20 | 37 | 3 | resonate 20, timbre 19, rhythm 14, entrain 4 | -1 / -17.003 dBFS |
| SONOVA-EXP-0003 | Sunset Cascade | cascade | 86 | dorian | 72 | 11 | 27 | 3 | resonate 11, timbre 16, rhythm 7, entrain 4 | -1 / -17.011 dBFS |

### SONOVA-EXP-0001 Rings Wake the Tower

構成: **emergence** 0–8.5s → **interaction** 8.5–12s → **bloom** 12–27s → **afterglow** 27–30s

楽器間の相互作用回数: bark->tower 8, tower->sunset 13, sunset->bark 4, tower->bark 6, bark->sunset 8, sunset->tower 4

なぜこう鳴ったか (因果の連鎖):

- **9.48s** barkが発音 (MIDI 57) → [共鳴] towerが共鳴 (MIDI 57) → [音色変化] sunsetの音色が明るく変化 (0.295→0.615)
- **15.52s** barkが発音 (MIDI 58) → [音色変化] sunsetの音色が明るく変化 (0.695→1) → [リズム生成] barkのリズムが E(5,16)+3 → E(5,16)+4 に変化
- **15.52s** barkが発音 (MIDI 58) → [音色変化] sunsetの音色が明るく変化 (0.695→1) → [リズム生成] towerのリズムが E(4,16)+0 → E(4,16)+1 に変化
- **19.31s** barkが発音 (MIDI 65) → [音色変化] sunsetの音色が明るく変化 (0.83→1) → [リズム生成] barkのリズムが E(5,16)+4 → E(5,16)+5 に変化
- **19.31s** barkが発音 (MIDI 65) → [音色変化] sunsetの音色が明るく変化 (0.83→1) → [リズム生成] towerのリズムが E(4,16)+1 → E(4,16)+2 に変化
- **20.17s** barkが発音 (MIDI 63) → [共鳴] towerが共鳴 (MIDI 63) → [音色変化] sunsetの音色が明るく変化 (0.941→1)

### SONOVA-EXP-0002 Facade Tide

構成: **emergence** 0–2s → **interaction** 2–7s → **bloom** 7–12.5s → **ebb** 12.5–22s → **bloom** 22–27s → **afterglow** 27–30s

楽器間の相互作用回数: bark->tower 12, bark->sunset 17, tower->sunset 6, sunset->tower 6, tower->bark 14, sunset->bark 2

なぜこう鳴ったか (因果の連鎖):

- **3.41s** towerが発音 (MIDI 50) → [同調] sunsetがタイミングを同調 (回転 9→0) → [リズム生成] towerのリズムが E(4,16)+0 → E(4,16)+1 に変化 → [リズム生成] barkのリズムが E(5,16)+3 → E(4,16)+3 に変化
- **8.35s** barkが発音 (MIDI 68) → [音色変化] sunsetの音色が明るく変化 (0.16→0.48) → [リズム生成] towerのリズムが E(4,16)+1 → E(4,16)+2 に変化 → [リズム生成] barkのリズムが E(4,16)+3 → E(5,16)+3 に変化
- **11.08s** barkが発音 (MIDI 62) → [同調] sunsetがタイミングを同調 (回転 0→1) → [リズム生成] towerのリズムが E(4,16)+2 → E(5,16)+2 に変化
- **11.25s** towerが発音 (MIDI 51) → [音色変化] sunsetの音色が明るく変化 (0.118→0.438) → [リズム生成] barkのリズムが E(5,16)+3 → E(6,16)+3 に変化
- **14.15s** barkが発音 (MIDI 65) → [音色変化] sunsetの音色が明るく変化 (0.665→0.985) → [リズム生成] towerのリズムが E(5,16)+2 → E(4,16)+2 に変化 → [リズム生成] barkのリズムが E(6,16)+3 → E(7,16)+3 に変化
- **17.90s** barkが発音 (MIDI 62) → [音色変化] sunsetの音色が暗く変化 (0.224→-0.096) → [リズム生成] barkのリズムが E(7,16)+3 → E(6,16)+3 に変化 → [リズム生成] towerのリズムが E(4,16)+2 → E(3,16)+2 に変化

### SONOVA-EXP-0003 Sunset Cascade

構成: **emergence** 0–0.5s → **interaction** 0.5–19.5s → **bloom** 19.5–27s → **afterglow** 27–30s

楽器間の相互作用回数: bark->sunset 10, sunset->tower 4, tower->bark 5, bark->tower 7, tower->sunset 10, sunset->bark 2

なぜこう鳴ったか (因果の連鎖):

- **0.00s** barkが発音 (MIDI 62) → [音色変化] sunsetの音色が明るく変化 (0→0.32) → [リズム生成] towerのリズムが E(4,16)+0 → E(5,16)+0 に変化 → [リズム生成] barkのリズムが E(5,16)+3 → E(6,16)+3 に変化
- **6.28s** towerが発音 (MIDI 48) → [音色変化] sunsetの音色が暗く変化 (0.223→-0.097) → [リズム生成] barkのリズムが E(6,16)+3 → E(7,16)+3 に変化
- **9.94s** barkが発音 (MIDI 57) → [音色変化] sunsetの音色が暗く変化 (0.518→0.198) → [リズム生成] towerのリズムが E(5,16)+0 → E(5,16)+1 に変化
- **13.95s** barkが発音 (MIDI 62) → [共鳴] towerが共鳴 (MIDI 62) → [音色変化] sunsetの音色が明るく変化 (-0.094→0.226) → [リズム生成] towerのリズムが E(5,16)+1 → E(4,16)+1 に変化
- **15.87s** towerが発音 (MIDI 55) → [音色変化] sunsetの音色が明るく変化 (0.205→0.525) → [リズム生成] barkのリズムが E(7,16)+3 → E(7,16)+4 に変化
- **17.27s** barkが発音 (MIDI 60) → [共鳴] towerが共鳴 (MIDI 60) → [音色変化] sunsetの音色が明るく変化 (0.479→0.799) → [リズム生成] towerのリズムが E(4,16)+1 → E(5,16)+1 に変化
