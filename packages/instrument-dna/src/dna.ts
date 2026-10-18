import type { ImageFeatures, SourceType } from '@sonova/source-analyzer';
import { r6 } from '@sonova/source-analyzer';
import { Rng, canonicalJson, clamp, hashHex } from './rng.ts';

export const DNA_ENGINE_VERSION = 'sonova-dna/1.0.0';

export type InteractionEffect = 'resonate' | 'timbre' | 'rhythm' | 'entrain' | 'attract';
export type InteractionTrigger = 'note' | 'resonance' | 'mutation';

export interface InteractionRule {
  effect: InteractionEffect;
  /** Which kinds of events from other instruments this rule listens to. */
  triggers: InteractionTrigger[];
  /** 0–1 relative strength of the response. */
  strength: number;
  /** Delay in generator steps (16th notes) between cause and response. */
  delay_steps: number;
  reason: string;
}

export interface MappingEntry {
  parameter: string;
  value: number | string;
  features: string[];
  rule: string;
}

export interface InstrumentDNA {
  instrument_id: string;
  name: string;
  source_type: SourceType;
  source_name: string;
  source_hash: string;
  seed: string;
  engine_version: string;
  /** MIDI note numbers; `root_pc` is the preferred pitch class (0 = C). */
  pitch_range: { low: number; high: number; center: number; root_pc: number };
  harmonics: { amplitudes: number[]; inharmonicity: number; damping: number; brightness: number };
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  resonance: { amount: number; q: number; ring: number };
  noise: { amount: number; color: number; length: number };
  modulation: { fm_ratio: number; fm_index: number; vibrato_rate: number; vibrato_depth: number };
  filter: { cutoff_ratio: number; envelope: number };
  rhythm: { steps: number; pulses: number; rotation: number; rate: number };
  pan: number;
  interaction_rules: {
    emission: number;
    sensitivity: number;
    memory_length: number;
    responses: InteractionRule[];
  };
  mapping: MappingEntry[];
  dna_hash: string;
}

export interface DnaInput {
  sourceType: 'image';
  sourceName: string;
  sourceHash: string;
  features: ImageFeatures;
  seed: string | number;
}

const FM_RATIOS = [1, 2, 3, 1.5, 0.5, 2.5, 3.5, Math.SQRT2];

/** Pitch class from a colour hue: walk the colour wheel around the circle of fifths. */
export function hueToPitchClass(hueDeg: number): number {
  const bin = Math.floor((((hueDeg % 360) + 360) % 360) / 30);
  return (bin * 7) % 12;
}

/**
 * Turn image features into an Instrument DNA.
 * Features decide the sound; the seed only adds small, recorded variations (rhythm rotation, detune, delays).
 */
export function createImageDNA(input: DnaInput): InstrumentDNA {
  const f = input.features;
  const seed = String(input.seed);
  const rng = new Rng(`${seed}:${input.sourceHash}`);
  const mapping: MappingEntry[] = [];
  const map = (parameter: string, value: number | string, features: string[], rule: string) => {
    mapping.push({ parameter, value: typeof value === 'number' ? r6(value) : value, features, rule });
    return value;
  };

  // ---- Pitch ----------------------------------------------------------------
  const grey = f.meanSaturation < 0.12;
  const rootPc = grey ? (Math.round(f.dominantPeriod * 128) + Math.round(f.meanLuminance * 12)) % 12 : hueToPitchClass(f.dominantHue);
  map('pitch_range.root_pc', rootPc, grey ? ['dominantPeriod', 'meanLuminance'] : ['dominantHue'],
    grey ? '無彩色: 反復周期と輝度から主音を決定' : '色相を五度圏に配置 (30°ごとに完全五度)');
  const center = Math.round(clamp(36 + f.meanLuminance * 20 + f.spectralCentroid * 30, 34, 84));
  map('pitch_range.center', center, ['meanLuminance', 'spectralCentroid'], '明るく細かい模様の画像ほど高い音域');
  const width = Math.round(clamp(7 + f.contrast * 22, 7, 30));
  map('pitch_range.width', width, ['contrast'], 'コントラストが大きいほど広い音域');
  const low = clamp(center - Math.floor(width / 2), 28, 96);
  const high = clamp(center + Math.ceil(width / 2), 28, 100);

  // ---- Harmonics: the image's spatial spectrum becomes the harmonic spectrum ----
  const rolloff = clamp(2.0 - f.highFreqRatio * 1.6 - f.spectralCentroid * 0.8, 0.6, 2.2);
  map('harmonics.rolloff', rolloff, ['highFreqRatio', 'spectralCentroid'], '細かい模様が多いほど高次倍音が残る');
  const oddBias = (f.verticalness - 0.5) * 1.6;
  map('harmonics.odd_bias', oddBias, ['verticalness'], '縦エッジが多いと奇数倍音 (矩形的)、横エッジが多いと偶数倍音');
  const maxBand = Math.max(...f.radialSpectrum, 1e-9);
  const amplitudes: number[] = [];
  for (let k = 1; k <= 16; k++) {
    const band = f.radialSpectrum[k - 1] / maxBand;
    const parity = k === 1 ? 1 : k % 2 === 1 ? 1 + Math.max(0, oddBias) : 1 + Math.max(0, -oddBias);
    amplitudes.push((0.45 + 0.55 * band) * parity * Math.pow(k, -rolloff));
  }
  const ampMax = Math.max(...amplitudes);
  const harmonicAmps = amplitudes.map((a) => r6(a / ampMax));
  map('harmonics.amplitudes', '16 partials', ['radialSpectrum'], '空間周波数の16帯域を16倍音の強さに写像');
  const inharmonicity = clamp(f.edgeDensity * 0.0025 + f.orientationEntropy * f.textureRoughness * 0.01, 0, 0.004);
  map('harmonics.inharmonicity', inharmonicity, ['edgeDensity', 'orientationEntropy', 'textureRoughness'], '鋭いエッジ → 硬い素材の非調和な倍音 (鐘・板)');
  const damping = clamp(0.9 - f.highFreqRatio * 2.5 - f.edgeMean * 1.5, 0.08, 0.9);
  map('harmonics.damping', damping, ['highFreqRatio', 'edgeMean'], '滑らかな画像ほど高次倍音が早く減衰 (柔らかい音)');
  const brightness = clamp(f.spectralCentroid * 1.2 + f.edgeMean * 2, 0, 1);
  map('harmonics.brightness', brightness, ['spectralCentroid', 'edgeMean'], '空間周波数の重心 → 音の明るさ');

  // ---- Envelope ----------------------------------------------------------------
  const smooth = 1 - clamp(f.edgeMean * 7, 0, 1);
  const attack = clamp(0.003 + Math.pow(smooth, 3) * 1.1, 0.003, 1.4);
  map('attack', attack, ['edgeMean'], 'エッジが鋭いほど立ち上がりが速い');
  const grid2d = f.strengthX * f.strengthY;
  const decay = clamp(0.18 + smooth * 1.4 + f.luminanceStd * 1.2 + grid2d * 1.2, 0.12, 3);
  map('decay', decay, ['edgeMean', 'luminanceStd', 'strengthX', 'strengthY'], '滑らかさ・明暗の幅・縦横の格子構造 → 減衰時間');
  const sustain = clamp(0.08 + (1 - f.contrast) * 0.55 + smooth * 0.25, 0.05, 0.85);
  map('sustain', sustain, ['contrast', 'edgeMean'], '低コントラスト → 持続する音');

  // ---- Resonance -----------------------------------------------------------------
  const resAmount = clamp(f.repetitionStrength * 1.1, 0, 1);
  map('resonance.amount', resAmount, ['repetitionStrength'], '反復構造が強い素材ほど共鳴しやすい');
  const q = clamp(0.8 + f.repetitionStrength * 9, 0.7, 10);
  map('resonance.q', q, ['repetitionStrength'], '反復の規則性 → フィルターの鋭さ');
  const ring = clamp(0.4 + f.repetitionStrength * 4 + (1 - f.textureRoughness) * 0.6, 0.3, 6);
  map('resonance.ring', ring, ['repetitionStrength', 'textureRoughness'], '共鳴の残響時間');
  const release = clamp(0.12 + attack * 1.4 + resAmount * 1.2, 0.08, 4);
  map('release', release, ['edgeMean', 'repetitionStrength'], '立ち上がりと共鳴 → 余韻');

  // ---- Noise -------------------------------------------------------------------
  const noiseAmount = clamp(f.textureRoughness * 3.2 + f.orientationEntropy * 0.12, 0, 0.7);
  map('noise.amount', noiseAmount, ['textureRoughness', 'orientationEntropy'], '細かな粗さ (木目・粒) → 打撃ノイズ');
  const noiseColor = clamp(f.highFreqRatio * 3 + f.warmth * -0.4 + 0.3, 0.05, 1);
  map('noise.color', noiseColor, ['highFreqRatio', 'warmth'], '暖色ほど低いノイズ、細かい模様ほど高いノイズ');
  const noiseLength = clamp(0.015 + noiseAmount * 0.25, 0.01, 0.25);

  // ---- Modulation ---------------------------------------------------------------
  const fmRatio = FM_RATIOS[Math.min(7, Math.floor(f.colorfulness * 1.6 * 8))];
  map('modulation.fm_ratio', fmRatio, ['colorfulness'], '色の豊かさで FM の周波数比を選択');
  const fmIndex = clamp(f.meanSaturation * 2 + f.colorfulness * 2, 0, 4);
  map('modulation.fm_index', fmIndex, ['meanSaturation', 'colorfulness'], '彩度 → FM の深さ (倍音の揺らぎ)');
  const vibratoRate = clamp(1.5 + f.dominantPeriod * 30, 1.5, 7);
  map('modulation.vibrato_rate', vibratoRate, ['dominantPeriod'], '反復周期 → ビブラートの速さ');
  const vibratoDepth = clamp((1 - f.hueConcentration) * 0.12 + f.luminanceEntropy * 0.05, 0, 0.25);
  map('modulation.vibrato_depth', vibratoDepth, ['hueConcentration', 'luminanceEntropy'], '色相が散らばるほど音程が揺らぐ (半音単位)');

  // ---- Filter ------------------------------------------------------------------
  const cutoffRatio = clamp(2 + brightness * 16, 2, 20);
  map('filter.cutoff_ratio', cutoffRatio, ['spectralCentroid', 'edgeMean'], '明るさ → カットオフ (基音の倍数)');
  const filterEnv = clamp(f.contrast * 0.8 + f.edgeMean, 0, 1.5);

  // ---- Rhythm (Euclidean pattern) ---------------------------------------------------
  const steps = f.repetitionStrength > 0.45 ? 16 : f.orientationEntropy > 0.85 ? 12 : 16;
  map('rhythm.steps', steps, ['repetitionStrength', 'orientationEntropy'], '格子状 → 16分割、曲線的 → 12分割');
  const pulses = Math.round(clamp(2 + f.edgeDensity * 6 + f.textureRoughness * 12 - f.repetitionStrength * 2, 1, Math.floor(steps * 0.6)));
  map('rhythm.pulses', pulses, ['edgeDensity', 'textureRoughness', 'repetitionStrength'], 'エッジと粗さ → 発音数が増え、規則的な反復 → 間引かれる (ユークリッドリズム)');
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
    ['rhythm', f.edgeDensity * Math.pow(f.orientationEntropy, 4) * 2.5 + f.textureRoughness * 2, ['mutation'], '不規則な方向のエッジと粗さ → 他の楽器の変化から新しいリズムを生む'],
    ['entrain', (1 - f.luminanceStd * 2) * 0.5, ['note'], '滑らかな明暗 → 他の楽器のタイミングに同調する'],
    ['attract', f.hueConcentration * 0.6, ['note', 'resonance'], '色相の集中 → 他の楽器の音程に協和しようとする'],
  ];
  const best = Math.max(...affinities.map((a) => a[1]), 1e-6);
  const responses: InteractionRule[] = affinities
    .map(([effect, score, triggers, reason]) => ({ effect, score: clamp(score / best, 0, 1), triggers, reason }))
    .sort((a, b) => b.score - a.score)
    .filter((r, i) => i < 2 || r.score >= 0.55)
    .map((r) => ({
      effect: r.effect,
      triggers: r.triggers,
      strength: r6(r.score),
      delay_steps: r.effect === 'resonate' ? 1 : rng.int(1, 3),
      reason: r.reason,
    }));
  responses.forEach((r) => map(`interaction.${r.effect}`, r.strength, ['(複合)'], r.reason));

  const name = input.sourceName.replace(/\.[^.]+$/, '');
  const body: Omit<InstrumentDNA, 'dna_hash' | 'instrument_id'> = {
    name,
    source_type: input.sourceType,
    source_name: input.sourceName,
    source_hash: input.sourceHash,
    seed,
    engine_version: DNA_ENGINE_VERSION,
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
    interaction_rules: { emission: r6(emission), sensitivity: r6(sensitivity), memory_length: memoryLength, responses },
    mapping,
  };
  const dnaHash = hashHex(canonicalJson(body));
  return { instrument_id: `inst-${input.sourceHash.slice(0, 8)}-${hashHex(seed).slice(0, 6)}`, ...body, dna_hash: dnaHash };
}

/** Recompute the content hash; a mismatch means the DNA was edited or corrupted. */
export function verifyDNA(dna: InstrumentDNA): boolean {
  const { dna_hash, instrument_id, ...body } = dna;
  void instrument_id;
  return hashHex(canonicalJson(body)) === dna_hash;
}

/** Human edits are stored separately from the generated DNA so the original stays reproducible. */
export interface DnaOverrides {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  brightness?: number;
  noise?: number;
  fm_index?: number;
  octave?: number;
  gain?: number;
}

export function applyOverrides(dna: InstrumentDNA, o: DnaOverrides | undefined): InstrumentDNA {
  if (!o || Object.keys(o).length === 0) return dna;
  const shift = (o.octave ?? 0) * 12;
  return {
    ...dna,
    attack: o.attack ?? dna.attack,
    decay: o.decay ?? dna.decay,
    sustain: o.sustain ?? dna.sustain,
    release: o.release ?? dna.release,
    pitch_range: { ...dna.pitch_range, low: dna.pitch_range.low + shift, high: dna.pitch_range.high + shift, center: dna.pitch_range.center + shift },
    harmonics: { ...dna.harmonics, brightness: o.brightness ?? dna.harmonics.brightness },
    filter: { ...dna.filter, cutoff_ratio: o.brightness !== undefined ? 2 + o.brightness * 16 : dna.filter.cutoff_ratio },
    noise: { ...dna.noise, amount: o.noise ?? dna.noise.amount },
    modulation: { ...dna.modulation, fm_index: o.fm_index ?? dna.modulation.fm_index },
  };
}
