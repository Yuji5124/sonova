/**
 * Instrument DNA v1.1 — the same instrument model as v1.0, mapped from the v1.1 image features with
 * three aims, each measured by `npm run v11:eval`:
 *  1. robustness: no mapping leans on a feature that a resize, sensor noise or a 10% crop moves a lot
 *     (the repetition period, the 8-bin orientation entropy, the 30° hue bin share), and no hard
 *     saturation (v1.0's `edgeMean × 7` made every textured picture "fully sharp")
 *  2. fidelity: what the picture says is what the sound does — a smooth picture now rings longer
 *     (v1.0's release followed the repetition, so smooth pictures sounded shorter), colour makes the
 *     partials shimmer (a detuned second layer), roughness makes a noisy onset
 *  3. new listening rules for the v1.1 generator (imitate a phrase, make room), chosen from the picture
 * `createImageDNA` (v1.0) is unchanged.
 */
import type { ImageFeaturesV11 } from '@sonova/source-analyzer';
import { r6 } from '@sonova/source-analyzer';
import { hueToPitchClass, type DnaInput, type InstrumentDNA, type InteractionEffect, type InteractionRule, type InteractionRuleV11, type InteractionTrigger, type MappingEntry } from './dna.ts';
import { Rng, canonicalJson, clamp, hashHex } from './rng.ts';

export const DNA_ENGINE_V11_VERSION = 'sonova-dna/1.1.0';

/** harmonic ratios only: colour should make the sound waver, not rasp (v1.0's 2.5, 3.5, √2 added off-harmonic noise to colourful pictures) */
const FM_RATIOS = [1, 2, 3, 1, 0.5, 2, 4, 3];

export interface DnaInputV11 extends Omit<DnaInput, 'features'> {
  features: ImageFeaturesV11;
}

export function createImageDNAV11(input: DnaInputV11): InstrumentDNA {
  const f = input.features;
  const seed = String(input.seed);
  const rng = new Rng(`${seed}:${input.sourceHash}:v1.1`);
  const mapping: MappingEntry[] = [];
  const map = (parameter: string, value: number | string, features: string[], rule: string) => {
    mapping.push({ parameter, value: typeof value === 'number' ? r6(value) : value, features, rule });
    return value;
  };

  // ---- Pitch ----------------------------------------------------------------
  const grey = f.meanSaturation < 0.08;
  // grey pictures: six coarse brightness levels walk the circle of fifths (v1.0 used the repetition period, which a crop moves)
  const rootPc = grey ? (7 * Math.round(f.meanLuminance * 6)) % 12 : hueToPitchClass(f.dominantHue);
  map('pitch_range.root_pc', rootPc, grey ? ['meanLuminance'] : ['dominantHue'], grey ? '無彩色: 明るさを6段階にして五度圏に配置' : '色相 (彩度で重みづけした円周平均) を五度圏に配置');
  const center = Math.round(clamp(36 + f.meanLuminance * 20 + f.spectralCentroid * 30, 34, 84));
  map('pitch_range.center', center, ['meanLuminance', 'spectralCentroid'], '明るく細かい模様の画像ほど高い音域');
  const width = Math.round(clamp(7 + f.contrast * 22, 7, 30));
  map('pitch_range.width', width, ['contrast'], 'コントラストが大きいほど広い音域');
  const low = clamp(center - Math.floor(width / 2), 28, 96);
  const high = clamp(center + Math.ceil(width / 2), 28, 100);

  // ---- Harmonics -------------------------------------------------------------
  const rolloff = clamp(2.0 - f.highFreqRatio * 1.6 - f.spectralCentroid * 0.8, 0.6, 2.2);
  map('harmonics.rolloff', rolloff, ['highFreqRatio', 'spectralCentroid'], '細かい模様が多いほど高次倍音が残る');
  const oddBias = (f.verticalness - 0.5) * 1.6;
  map('harmonics.odd_bias', oddBias, ['verticalness'], '縦エッジが多いと奇数倍音、横エッジが多いと偶数倍音');
  const maxBand = Math.max(...f.radialSpectrum, 1e-9);
  const amplitudes: number[] = [];
  for (let k = 1; k <= 16; k++) {
    const band = f.radialSpectrum[k - 1] / maxBand;
    const parity = k === 1 ? 1 : k % 2 === 1 ? 1 + Math.max(0, oddBias) : 1 + Math.max(0, -oddBias);
    amplitudes.push((0.45 + 0.55 * band) * parity * Math.pow(k, -rolloff));
  }
  const ampMax = Math.max(...amplitudes);
  const harmonicAmps = amplitudes.map((a) => r6(a / ampMax));
  map('harmonics.amplitudes', '16 partials', ['radialSpectrum'], '空間周波数の16帯域を16倍音の強さに写像 (ノイズの床を引いたスペクトル)');
  const inharmonicity = clamp(f.edgeDensity * 0.0025 + (1 - f.orientationStrength) * f.textureRoughness * 0.01, 0, 0.004);
  map('harmonics.inharmonicity', inharmonicity, ['edgeDensity', 'orientationStrength', 'textureRoughness'], '鋭く方向のばらばらなエッジ → 硬い素材の非調和な倍音');
  const damping = clamp(0.9 - f.highFreqRatio * 2.5 - f.edgeMean * 1.5, 0.08, 0.9);
  map('harmonics.damping', damping, ['highFreqRatio', 'edgeMean'], '滑らかな画像ほど高次倍音が早く減衰');
  const brightness = clamp(f.spectralCentroid * 1.2 + f.edgeMean * 2, 0, 1);
  map('harmonics.brightness', brightness, ['spectralCentroid', 'edgeMean'], '空間周波数の重心 → 音の明るさ');

  // ---- Envelope: smoothness decides the whole time shape --------------------
  // exp(−edge/0.06): continuous over the whole range (v1.0: 1 − edge×7 hit 0 at edge 0.14)
  const smooth = Math.exp(-f.edgeMean / 0.06);
  map('smoothness', smooth, ['edgeMean'], '滑らかさ = exp(−エッジ強度/0.06) (飽和しない)');
  const attack = clamp(0.003 + Math.pow(smooth, 2.5) * 1.0, 0.003, 1.2);
  map('attack', attack, ['edgeMean'], 'エッジが鋭いほど立ち上がりが速い');
  const grid2d = f.strengthX * f.strengthY;
  const decay = clamp(0.15 + smooth * 1.6 + f.luminanceStd * 0.8 + grid2d * 0.6, 0.12, 3);
  map('decay', decay, ['edgeMean', 'luminanceStd', 'strengthX', 'strengthY'], '滑らかさ・明暗の幅・格子構造 → 減衰時間');
  const sustain = clamp(0.06 + smooth * 0.55 + (1 - f.contrast) * 0.15, 0.05, 0.85);
  map('sustain', sustain, ['edgeMean', 'contrast'], '滑らかで低コントラスト → 持続する音');

  // ---- Resonance -------------------------------------------------------------
  const resAmount = clamp(f.repetitionStrength * 1.1, 0, 1);
  map('resonance.amount', resAmount, ['repetitionStrength'], '反復構造が強い素材ほど共鳴しやすい');
  const q = clamp(0.8 + f.repetitionStrength * 9, 0.7, 10);
  map('resonance.q', q, ['repetitionStrength'], '反復の規則性 → フィルターの鋭さ');
  const ring = clamp(0.4 + f.repetitionStrength * 4 + (1 - f.textureRoughness) * 0.6, 0.3, 6);
  map('resonance.ring', ring, ['repetitionStrength', 'textureRoughness'], '共鳴の残響時間');
  // the note's own tail follows smoothness; the repetition only rings in resonances (v1.0 let it lengthen every note)
  const release = clamp(0.1 + smooth * 1.3 + attack * 0.5 + resAmount * 0.2, 0.08, 4);
  map('release', release, ['edgeMean', 'repetitionStrength'], '滑らかな素材ほど余韻が長い (共鳴の強さは少しだけ)');

  // ---- Noise -----------------------------------------------------------------
  const noiseAmount = clamp(f.textureRoughness * 3.2 + f.edgeDensity * 0.3, 0, 0.7);
  map('noise.amount', noiseAmount, ['textureRoughness', 'edgeDensity'], '細かな粗さ (ノイズの床を引いた値) → 打撃ノイズ');
  const noiseColor = clamp(f.highFreqRatio * 3 + f.warmth * -0.4 + 0.3, 0.05, 1);
  map('noise.color', noiseColor, ['highFreqRatio', 'warmth'], '暖色ほど低いノイズ、細かい模様ほど高いノイズ');
  const noiseLength = clamp(0.015 + noiseAmount * 0.25, 0.01, 0.25);

  // ---- Modulation and shimmer -------------------------------------------------
  const fmRatio = FM_RATIOS[Math.min(7, Math.floor(f.colorfulness * 1.6 * 8))];
  map('modulation.fm_ratio', fmRatio, ['colorfulness'], '色の豊かさで FM の周波数比を選択 (整数比・1/2 だけ)');
  const fmIndex = clamp(f.meanSaturation * 2 + f.colorfulness * 2, 0, 4);
  map('modulation.fm_index', fmIndex, ['meanSaturation', 'colorfulness'], '彩度 → FM の深さ');
  const vibratoRate = clamp(2 + f.spectralCentroid * 4 + f.hueSpread * 1.5, 1.5, 7);
  map('modulation.vibrato_rate', vibratoRate, ['spectralCentroid', 'hueSpread'], '模様の細かさと色相の広がり → ビブラートの速さ (v1.0 の反復周期はトリミングで動くので使わない)');
  const vibratoDepth = clamp(f.hueSpread * 0.14 + f.luminanceEntropy * 0.04, 0, 0.25);
  map('modulation.vibrato_depth', vibratoDepth, ['hueSpread', 'luminanceEntropy'], '色相が円周上に散らばるほど音程が揺らぐ');
  const shimmerCents = clamp(f.colorfulness * 45 + f.hueSpread * 6, 0, 18);
  const shimmerMix = clamp(f.colorfulness * 1.6, 0, 0.5);
  map('shimmer', `${r6(shimmerCents)} cents × ${r6(shimmerMix)}`, ['colorfulness', 'hueSpread'], '色が豊かなほど、少しずらした2層目の倍音がうなって揺らぐ');

  // ---- Filter ------------------------------------------------------------------
  const cutoffRatio = clamp(2 + brightness * 16, 2, 20);
  map('filter.cutoff_ratio', cutoffRatio, ['spectralCentroid', 'edgeMean'], '明るさ → カットオフ');
  const filterEnv = clamp(f.contrast * 0.8 + f.edgeMean, 0, 1.5);

  // ---- Rhythm --------------------------------------------------------------------
  const curved = f.orientationStrength < 0.15 && f.repetitionStrength < 0.45;
  const steps = curved ? 12 : 16;
  map('rhythm.steps', steps, ['orientationStrength', 'repetitionStrength'], '方向のそろわない曲線的な画像 → 12分割、それ以外 → 16分割');
  const pulses = Math.round(clamp(2 + f.edgeDensity * 6 + f.textureRoughness * 12 - f.repetitionStrength * 2, 1, Math.floor(steps * 0.6)));
  map('rhythm.pulses', pulses, ['edgeDensity', 'textureRoughness', 'repetitionStrength'], 'エッジと粗さ → 発音数が増え、規則的な反復 → 間引かれる');
  const rotation = rng.int(0, steps - 1);
  map('rhythm.rotation', rotation, ['seed'], 'シードでリズムの開始位置をずらす');
  const rate = attack > 0.25 ? 0.25 : attack > 0.06 ? 0.5 : 1;
  map('rhythm.rate', rate, ['edgeMean'], 'ゆっくり立ち上がる楽器は長い周期で発音');

  const pan = clamp((f.brightCenterX - 0.5) * 2.2 + rng.range(-0.08, 0.08), -0.85, 0.85);
  map('pan', pan, ['brightCenterX', 'seed'], '画像の明るい部分の左右位置 → 定位');

  // ---- Interaction ----------------------------------------------------------------
  const emission = clamp(0.2 + f.edgeDensity * 1.1 + f.contrast * 0.25 + f.textureRoughness, 0.2, 1);
  map('interaction.emission', emission, ['edgeDensity', 'contrast', 'textureRoughness'], '鋭く明暗のある素材ほど他の楽器へ強く働きかける');
  const sensitivity = clamp(0.35 + (1 - f.contrast) * 0.4 + f.repetitionStrength * 0.3, 0.2, 1);
  map('interaction.sensitivity', sensitivity, ['contrast', 'repetitionStrength'], '柔らかい・規則的な素材ほど他の楽器に反応しやすい');
  const memoryLength = Math.round(clamp(3 + f.repetitionStrength * 10, 3, 12));
  map('interaction.memory_length', memoryLength, ['repetitionStrength'], '反復構造 → 主題を覚えている長さ');

  const affinities: Array<[InteractionEffect, number, InteractionTrigger[], string]> = [
    ['resonate', f.repetitionStrength * 1.3 + (1 - f.meanSaturation) * 0.2, ['note'], '規則的な反復構造 → 他の楽器の音に共鳴する'],
    ['timbre', f.meanSaturation * 0.9 + f.colorfulness * 0.8, ['note', 'resonance'], '色彩の豊かさ → 周囲の音で音色が変化する'],
    ['rhythm', f.edgeDensity * (1 - f.orientationStrength) * 2.5 + f.textureRoughness * 2, ['mutation'], '方向のばらばらなエッジと粗さ → 他の楽器の変化から新しいリズムを生む'],
    ['entrain', (1 - f.luminanceStd * 2) * 0.5, ['note'], '滑らかな明暗 → 他の楽器のタイミングに同調する'],
    ['attract', f.hueConcentration * 0.6, ['note', 'resonance'], '色相の集中 → 他の楽器の音程に協和しようとする'],
  ];
  const best = Math.max(...affinities.map((a) => a[1]), 1e-6);
  const responses: InteractionRule[] = affinities
    .map(([effect, score, triggers, reason]) => ({ effect, score: clamp(score / best, 0, 1), triggers, reason }))
    .sort((a, b) => b.score - a.score)
    // v1.0 kept the top two and any third ≥ 0.55, so a small change swapped whole roles. v1.1 keeps every rule
    // above 0.4 with strength score², so a rule near the line is weak and its coming or going is barely audible
    .filter((r, i) => i < 1 || r.score >= 0.4)
    .map((r) => ({ effect: r.effect, triggers: r.triggers, strength: r6(r.score * r.score), delay_steps: r.effect === 'resonate' ? 1 : rng.int(1, 3), reason: r.reason }));
  responses.forEach((r) => map(`interaction.${r.effect}`, r.strength, ['(複合)'], r.reason));
  // v1.1 listening rules: strengths are continuous, so no rule appears or vanishes at a threshold
  const responsesV11: InteractionRuleV11[] = [
    {
      effect: 'imitate',
      triggers: ['note'],
      strength: r6(clamp(0.25 + f.repetitionStrength * 0.5 + f.orientationStrength * 0.25, 0, 1)),
      delay_steps: 8,
      reason: '模様が繰り返し・方向がそろう素材ほど、他の楽器のフレーズをまねて答える (2拍遅れのカノン)',
    },
    {
      effect: 'yield',
      triggers: ['note', 'resonance'],
      strength: r6(clamp(0.2 + smooth * 0.5 + (1 - f.contrast) * 0.3, 0, 1)),
      delay_steps: 0,
      reason: '滑らかで控えめな素材ほど、周りが混んでいると音数を減らして場所を空ける',
    },
  ];
  responsesV11.forEach((r) => map(`interaction.${r.effect}`, r.strength, ['(複合)'], r.reason));

  const name = input.sourceName.replace(/\.[^.]+$/, '');
  const body: Omit<InstrumentDNA, 'dna_hash' | 'instrument_id'> = {
    name,
    source_type: input.sourceType,
    source_name: input.sourceName,
    source_hash: input.sourceHash,
    seed,
    engine_version: DNA_ENGINE_V11_VERSION,
    pitch_range: { low, high, center, root_pc: rootPc },
    harmonics: { amplitudes: harmonicAmps, inharmonicity: r6(inharmonicity), damping: r6(damping), brightness: r6(brightness) },
    attack: r6(attack),
    decay: r6(decay),
    sustain: r6(sustain),
    release: r6(release),
    resonance: { amount: r6(resAmount), q: r6(q), ring: r6(ring) },
    noise: { amount: r6(noiseAmount), color: r6(noiseColor), length: r6(noiseLength) },
    modulation: { fm_ratio: r6(fmRatio), fm_index: r6(fmIndex), vibrato_rate: r6(vibratoRate), vibrato_depth: r6(vibratoDepth) },
    filter: { cutoff_ratio: r6(cutoffRatio), envelope: r6(filterEnv) },
    rhythm: { steps, pulses, rotation, rate },
    pan: r6(pan),
    interaction_rules: { emission: r6(emission), sensitivity: r6(sensitivity), memory_length: memoryLength, responses, responses_v11: responsesV11 },
    shimmer: { cents: r6(shimmerCents), mix: r6(shimmerMix) },
    mapping,
  };
  const dnaHash = hashHex(canonicalJson(body));
  return { instrument_id: `inst-${input.sourceHash.slice(0, 8)}-${hashHex(`${seed}:v1.1`).slice(0, 6)}`, ...body, dna_hash: dnaHash };
}
