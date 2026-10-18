import type { InstrumentDNA } from '@sonova/instrument-dna';
import { Rng, clamp } from '@sonova/instrument-dna';

export const SYNTH_ENGINE_VERSION = 'sonova-synth/1.0.0';

export type NoteKind = 'note' | 'resonance';

export interface NoteSpec {
  midi: number;
  /** 0–1 */
  velocity: number;
  /** Seconds the note is held before release. */
  duration: number;
  /** −1…1: colour offset from interactions (darker ↔ brighter / more FM). */
  timbre: number;
  kind: NoteKind;
  /** Cents. */
  detune?: number;
}

const TABLE_SIZE = 4096;
const SINE = new Float64Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);

/** Table sine of a phase measured in cycles. */
function sinCycles(phase: number): number {
  const p = phase - Math.floor(phase);
  const x = p * TABLE_SIZE;
  const i = x | 0;
  const frac = x - i;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * frac;
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Topology-preserving state-variable filter (stable under fast modulation). */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  set(cutoff: number, q: number, sampleRate: number): void {
    this.g = Math.tan((Math.PI * clamp(cutoff, 20, sampleRate * 0.45)) / sampleRate);
    this.k = 1 / clamp(q, 0.5, 20);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }

  /** Returns [low, band]. */
  process(v0: number, out: [number, number]): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    out[0] = v2;
    out[1] = v1;
  }
}

export interface VoiceShape {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** Envelope timings actually used for a note (resonances are slower and ring longer). */
export function voiceShape(dna: InstrumentDNA, kind: NoteKind): VoiceShape {
  if (kind === 'resonance') {
    return {
      attack: Math.max(0.06, dna.attack * 1.5),
      decay: dna.decay + dna.resonance.ring * 0.5,
      sustain: Math.min(0.9, dna.sustain + 0.3),
      release: dna.resonance.ring,
    };
  }
  return { attack: dna.attack, decay: dna.decay, sustain: dna.sustain, release: dna.release };
}

export function voiceLength(dna: InstrumentDNA, note: NoteSpec): number {
  const s = voiceShape(dna, note.kind);
  return Math.max(note.duration, s.attack) + s.release + 0.02;
}

/**
 * Render one note from an Instrument DNA: additive partials (spectrum from the source)
 * + FM layer + filtered noise burst, through an enveloped state-variable low-pass.
 */
export function renderVoice(dna: InstrumentDNA, note: NoteSpec, sampleRate: number, seed: string | number): Float32Array {
  const rng = new Rng(`voice:${seed}`);
  const shape = voiceShape(dna, note.kind);
  const length = Math.ceil(voiceLength(dna, note) * sampleRate);
  const out = new Float32Array(length);
  const f0 = midiToHz(note.midi) * Math.pow(2, (note.detune ?? 0) / 1200);
  const timbre = clamp(note.timbre, -1, 1);
  const nyquist = sampleRate * 0.45;

  // Partials
  const B = dna.harmonics.inharmonicity;
  const tilt = timbre * 0.6;
  const partials: Array<{ ratio: number; amp: number; decay: number; phase: number }> = [];
  dna.harmonics.amplitudes.forEach((a, i) => {
    const k = i + 1;
    const ratio = k * Math.sqrt(1 + B * k * k);
    if (f0 * ratio >= nyquist || a < 1e-4) return;
    const amp = a * Math.pow(k, tilt);
    const lambda = ((k - 1) * dna.harmonics.damping * 3) / Math.max(0.2, shape.decay);
    partials.push({ ratio, amp, decay: lambda, phase: rng.next() });
  });
  const ampNorm = 1 / Math.max(0.2, Math.sqrt(partials.reduce((s, p) => s + p.amp * p.amp, 0)));

  // FM layer
  const fmMix = clamp(dna.modulation.fm_index / 8 + Math.max(0, timbre) * 0.25, 0, 0.55);
  const fmIndex = dna.modulation.fm_index * (1 + timbre * 0.8);
  const fmRatio = dna.modulation.fm_ratio;

  // Noise burst
  const noiseAmt = dna.noise.amount * (note.kind === 'resonance' ? 0.15 : 1);
  const noiseLen = Math.max(0.005, dna.noise.length);
  const noiseFilter = new Svf();
  noiseFilter.set(clamp(f0 * (1.5 + dna.noise.color * 14), 200, 14000), 1.3, sampleRate);

  // Main filter
  const filter = new Svf();
  const baseCut = f0 * dna.filter.cutoff_ratio * (1 + timbre * 0.7);
  const q = 0.55 + dna.resonance.q * 0.12;
  const fOut: [number, number] = [0, 0];
  const nOut: [number, number] = [0, 0];

  const vibRate = dna.modulation.vibrato_rate;
  const vibDepth = dna.modulation.vibrato_depth;
  const vibPhase0 = rng.next();
  const dt = 1 / sampleRate;
  const holdEnd = Math.max(note.duration, shape.attack);
  const relTau = Math.max(0.01, shape.release) / 4.6;
  const decTau = Math.max(0.01, shape.decay) / 3;
  let phase = 0;
  let modPhase = 0;
  let lastEnv = 0;
  const vel = clamp(note.velocity, 0, 1);

  for (let n = 0; n < length; n++) {
    const t = n * dt;
    // ADSR (exponential decay/release)
    let env: number;
    if (t < shape.attack) env = t / shape.attack;
    else if (t < holdEnd) env = shape.sustain + (1 - shape.sustain) * Math.exp(-(t - shape.attack) / decTau);
    else env = lastEnv * Math.exp(-dt / relTau);
    lastEnv = env;

    // Vibrato fades in after the attack.
    const vibAmt = vibDepth * Math.min(1, t / (shape.attack + 0.25));
    const freq = f0 * Math.pow(2, (vibAmt * sinCycles(vibPhase0 + vibRate * t)) / 12);
    phase += freq * dt;
    modPhase += freq * fmRatio * dt;

    let add = 0;
    for (let p = 0; p < partials.length; p++) {
      const pr = partials[p];
      add += pr.amp * Math.exp(-pr.decay * t) * sinCycles(pr.phase + phase * pr.ratio);
    }
    add *= ampNorm;
    const fmEnv = 0.35 + 0.65 * Math.exp(-t / (decTau + 0.05));
    const fm = sinCycles(phase + (fmIndex * fmEnv * sinCycles(modPhase)) / (2 * Math.PI));
    let s = add * (1 - fmMix) + fm * fmMix;

    if (noiseAmt > 0 && t < noiseLen * 6) {
      noiseFilter.process(rng.next() * 2 - 1, nOut);
      s += nOut[1] * noiseAmt * 2.5 * Math.exp(-t / noiseLen);
    }

    if ((n & 31) === 0) {
      const cut = baseCut * (1 + dna.filter.envelope * 3 * Math.exp(-t / (decTau * 0.6 + 0.02)));
      filter.set(cut, q, sampleRate);
    }
    filter.process(s, fOut);
    out[n] = fOut[0] * env * vel * 0.5;
  }
  // Short fade at both ends against clicks.
  const fade = Math.min(64, length);
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}
