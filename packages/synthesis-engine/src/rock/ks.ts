/**
 * Extended Karplus–Strong string + amp rig with acoustic feedback.
 *
 * Reimplemented from the published algorithms, no code copied:
 *  - K. Karplus, A. Strong, "Digital Synthesis of Plucked-String and Drum Timbres", CMJ 1983
 *  - D. Jaffe, J. O. Smith, "Extensions of the Karplus-Strong Plucked-String Algorithm", CMJ 1983
 *    (pick-position comb, dynamic-level low-pass, decay stretching)
 *  - C. R. Sullivan, "Extending the Karplus-Strong Algorithm to Synthesize Electric Guitar
 *    Timbres with Distortion and Feedback", CMJ 1990 (amp output fed back into the strings)
 * Studied: mrahtz/javascript-karplus-strong (no licence → ideas only), CCRMA EKS listings.
 */
import { Rng } from '@sonova/instrument-dna';
import { Biquad } from './filters.ts';
import { DiodeClipper, Oversampled2x } from './wdf.ts';

const MAX_DELAY = 4096;

export interface PluckOptions {
  velocity: number;
  /** 0–1: one-zero loop filter weight (higher = darker / faster high decay). */
  damping: number;
  /** Seconds for the string to decay by 60 dB. */
  t60: number;
  /** 0–0.5 relative pick position (comb notch). */
  pickPosition: number;
  /** Excitation brightness 0–1 (dynamic-level low-pass). */
  brightness: number;
}

export class KsString {
  private buf = new Float64Array(MAX_DELAY);
  private write = 0;
  private delay = 100;
  private targetDelay = 100;
  private glide = 1;
  private prev = 0;
  private rho = 0.999;
  private s = 0.5;
  private excitation: Float64Array | null = null;
  private vibRate = 0;
  private vibDepth = 0;
  private vibPhase = 0;
  private exPos = 0;
  private readonly rng: Rng;

  constructor(private readonly sampleRate: number, seed: string) {
    this.rng = new Rng(`ks:${seed}`);
  }

  private setFreq(freq: number, glideSec = 0): void {
    // The averaging loop filter adds half a sample of delay.
    const d = Math.min(MAX_DELAY - 4, Math.max(4, this.sampleRate / freq - 0.5));
    this.targetDelay = d;
    if (glideSec <= 0) this.delay = d;
    this.glide = glideSec > 0 ? 1 - Math.exp(-1 / (glideSec * this.sampleRate)) : 1;
  }

  pluck(freq: number, o: PluckOptions): void {
    // The pick stops the old vibration before the new one starts.
    for (let i = 0; i < MAX_DELAY; i++) this.buf[i] *= 0.12;
    this.setFreq(freq);
    this.vibDepth = 0;
    this.s = 0.5 * o.damping;
    this.rho = Math.pow(10, -3 / (Math.max(0.05, o.t60) * freq));
    const n = Math.max(8, Math.round(this.delay));
    const ex = new Float64Array(n);
    // Noise burst → dynamic-level one-pole low-pass → pick-position comb.
    const a = 0.15 + 0.8 * o.brightness;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += a * (this.rng.next() * 2 - 1 - lp);
      ex[i] = lp;
    }
    const pick = Math.max(1, Math.round(n * o.pickPosition));
    const comb = new Float64Array(n);
    for (let i = 0; i < n; i++) comb[i] = ex[i] - (i >= pick ? ex[i - pick] : 0);
    let mean = 0;
    for (const v of comb) mean += v / n;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(comb[i] - mean));
    for (let i = 0; i < n; i++) comb[i] = ((comb[i] - mean) / peak) * o.velocity;
    this.excitation = comb;
    this.exPos = 0;
  }

  /** Slide / bend to a new pitch while ringing. */
  bend(freq: number, glideSec: number): void {
    this.setFreq(freq, glideSec);
  }

  /** Vibrato in cents (0 turns it off). */
  vibrato(rate: number, depthCents: number): void {
    this.vibRate = rate;
    this.vibDepth = depthCents;
  }

  /** Hand on the strings: fast decay. */
  damp(t60 = 0.06): void {
    this.rho = Math.pow(10, -3 / (t60 * (this.sampleRate / this.delay)));
    this.s = 0.45;
  }

  process(feedbackIn: number): number {
    if (this.glide < 1) this.delay += (this.targetDelay - this.delay) * this.glide;
    let delay = this.delay;
    if (this.vibDepth > 0) {
      this.vibPhase += this.vibRate / this.sampleRate;
      delay *= Math.pow(2, (-this.vibDepth * Math.sin(2 * Math.PI * this.vibPhase)) / 1200);
    }
    const readPos = this.write - delay;
    const i0 = Math.floor(readPos);
    const frac = readPos - i0;
    const x0 = this.buf[(i0 + MAX_DELAY) & (MAX_DELAY - 1)];
    const x1 = this.buf[(i0 + 1 + MAX_DELAY) & (MAX_DELAY - 1)];
    const x = x0 + (x1 - x0) * frac;
    const y = this.rho * ((1 - this.s) * x + this.s * this.prev);
    this.prev = x;
    let input = y + feedbackIn;
    if (this.excitation) {
      input += this.excitation[this.exPos++];
      if (this.exPos >= this.excitation.length) this.excitation = null;
    }
    this.buf[this.write] = Math.max(-4, Math.min(4, input));
    this.write = (this.write + 1) & (MAX_DELAY - 1);
    return x;
  }
}

export interface AmpSettings {
  /** Pre-gain into the diode clipper (1 = clean … 80 = high gain). */
  gain: number;
  /** Mid boost (dB) before clipping, Tube-Screamer style. */
  midBoostDb: number;
  /** Cabinet low-pass corner (Hz). */
  cabinetHz: number;
  /** Clean blend 0–1. */
  clean: number;
}

export type RigEvent =
  | { time: number; type: 'pluck'; freqs: number[]; velocity: number; mute: boolean; pickPosition: number; brightness: number; t60: number; damping: number; strum?: number }
  | { time: number; type: 'damp' }
  | { time: number; type: 'bend'; string: number; freq: number; glide: number }
  | { time: number; type: 'vibrato'; string: number; rate: number; depth: number }
  | { time: number; type: 'feedback'; gain: number; ramp: number };

/**
 * A guitar (or bass) rig rendered as one continuous physical process:
 * six KS strings → pickup → amp (WDF diode clipper, 2× oversampled) → cabinet,
 * with the amp output fed back into the strings (feedback howl when the gain allows).
 */
export function renderRig(events: RigEvent[], seconds: number, sampleRate: number, amp: AmpSettings, seed: string, strings = 6): Float32Array {
  const n = Math.ceil(seconds * sampleRate);
  const out = new Float32Array(n);
  const s = Array.from({ length: strings }, (_, i) => new KsString(sampleRate, `${seed}:${i}`));
  const pickupHp = new Biquad('highpass', 70, 0.7, sampleRate);
  const tight = new Biquad('highpass', amp.gain > 8 ? 140 : 40, 0.7, sampleRate);
  const mid = new Biquad('peaking', 760, 0.8, sampleRate, amp.midBoostDb);
  const clipper = new DiodeClipper({ sampleRate: sampleRate * 2 });
  const os = new Oversampled2x((v) => clipper.process(v));
  const tone = new Biquad('lowpass', 6500, 0.7, sampleRate);
  const cabHp = new Biquad('highpass', amp.gain > 8 ? 85 : 35, 0.8, sampleRate);
  const cabLow = new Biquad('peaking', 120, 1.1, sampleRate, amp.gain > 8 ? 3 : 1);
  const cabNotch = new Biquad('peaking', 2200, 1.4, sampleRate, -3);
  const cabLp1 = new Biquad('lowpass', amp.cabinetHz, 0.9, sampleRate);
  const cabLp2 = new Biquad('lowpass', amp.cabinetHz * 1.15, 0.6, sampleRate);
  const fbBand = new Biquad('bandpass', 900, 0.9, sampleRate);
  const fbDelay = new Float64Array(Math.round(0.011 * sampleRate));
  let fbPos = 0;
  let fbGain = 0;
  let fbTarget = 0;
  let fbRate = 0;
  const sorted = [...events].sort((a, b) => a.time - b.time);
  let ev = 0;
  const pending: Array<{ at: number; str: number; freq: number; o: PluckOptions }> = [];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    while (ev < sorted.length && sorted[ev].time <= t) {
      const e = sorted[ev++];
      if (e.type === 'pluck') {
        const strum = e.strum ?? 0.008;
        e.freqs.forEach((f, k) => pending.push({ at: e.time + k * strum, str: k, freq: f, o: { velocity: e.velocity, damping: e.damping, t60: e.t60, pickPosition: e.pickPosition, brightness: e.brightness } }));
        // Strings not in the chord are damped.
        for (let k = e.freqs.length; k < strings; k++) s[k].damp();
      } else if (e.type === 'damp') s.forEach((x) => x.damp());
      else if (e.type === 'bend') s[Math.min(strings - 1, e.string)].bend(e.freq, e.glide);
      else if (e.type === 'vibrato') s[Math.min(strings - 1, e.string)].vibrato(e.rate, e.depth);
      else {
        fbTarget = e.gain;
        fbRate = e.ramp > 0 ? 1 / (e.ramp * sampleRate) : 1;
      }
    }
    for (let k = pending.length - 1; k >= 0; k--) {
      if (pending[k].at <= t) {
        const p = pending[k];
        s[p.str].pluck(p.freq, p.o);
        pending.splice(k, 1);
      }
    }
    if (fbGain !== fbTarget) fbGain += Math.sign(fbTarget - fbGain) * Math.min(Math.abs(fbTarget - fbGain), fbRate);
    const fb = fbBand.process(fbDelay[fbPos]) * fbGain;
    let sum = 0;
    for (let k = 0; k < strings; k++) sum += s[k].process(fb * 0.25);
    const pu = pickupHp.process(sum);
    const pre = mid.process(tight.process(pu)) * amp.gain * 0.35;
    const clipped = os.process(pre) / 0.75;
    let y = tone.process(clipped) * (1 - amp.clean) + pu * amp.clean;
    y = cabLp2.process(cabLp1.process(cabNotch.process(cabLow.process(cabHp.process(y)))));
    fbDelay[fbPos] = y;
    fbPos = (fbPos + 1) % fbDelay.length;
    out[i] = y;
  }
  return out;
}
