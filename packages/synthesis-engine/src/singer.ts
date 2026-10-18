/**
 * A singer: glottal pulses through a Kelly–Lochbaum vocal tract (Kelly & Lochbaum 1962).
 * The design follows the idea of Neil Thapen's Pink Trombone (a 44-segment waveguide tract run at
 * twice the sample rate, turbulence noise injected at constrictions); this is an independent
 * implementation — the tract shapes, the source and the consonant model are our own.
 */
import { Rng } from '@sonova/instrument-dna';
import { Biquad } from './rock/filters.ts';

export const SINGER_VERSION = 'sonova-singer/1.0.0';

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
export type Consonant = 'l' | 'r' | 'm' | 'n' | 's' | 'h' | 'k' | 't' | 'v';

export interface Syllable {
  onset?: Consonant;
  vowel: Vowel;
  coda?: Consonant;
}

export interface SungNote {
  time: number;
  duration: number;
  midi: number;
  velocity: number;
  /** null = melisma: the previous vowel carries on to this pitch */
  syllable: Syllable | null;
}

export interface SingerOptions {
  breathiness?: number;
  vibratoRate?: number;
  vibratoCents?: number;
}

const N = 44;
const LIPS = 39;
const TIP = 33;
const REST: number[] = Array.from({ length: N }, (_, i) => (i < 7 ? 0.55 + (i / 7) * 0.7 : 1.5));

/** Tongue constriction (position along the tract, how much it narrows) and lip opening per vowel. */
export const VOWEL_SHAPES: Record<Vowel, { pos: number; narrow: number; width: number; lips: number; open?: number }> = {
  a: { pos: 11, narrow: 0.62, width: 4, lips: 1.6, open: 2.2 },
  e: { pos: 28, narrow: 0.62, width: 5, lips: 1.3 },
  i: { pos: 30, narrow: 0.86, width: 4, lips: 1.2 },
  o: { pos: 13, narrow: 0.6, width: 5, lips: 0.8 },
  u: { pos: 21, narrow: 0.72, width: 4, lips: 0.55 },
};

const PLACE: Record<Consonant, { at: number; d: number; noise: number; voiced: boolean; nasal: boolean; dur: number }> = {
  l: { at: TIP, d: 0.45, noise: 0, voiced: true, nasal: false, dur: 0.06 },
  r: { at: TIP, d: 0.0, noise: 0, voiced: true, nasal: false, dur: 0.025 },
  m: { at: 41, d: 0.0, noise: 0, voiced: true, nasal: true, dur: 0.07 },
  n: { at: TIP, d: 0.0, noise: 0, voiced: true, nasal: true, dur: 0.065 },
  s: { at: TIP + 2, d: 0.12, noise: 1, voiced: false, nasal: false, dur: 0.09 },
  h: { at: 8, d: 1.2, noise: 0.5, voiced: false, nasal: false, dur: 0.07 },
  k: { at: 22, d: 0.0, noise: 0.8, voiced: false, nasal: false, dur: 0.06 },
  t: { at: TIP + 1, d: 0.0, noise: 0.9, voiced: false, nasal: false, dur: 0.05 },
  v: { at: 41, d: 0.22, noise: 0.35, voiced: true, nasal: false, dur: 0.07 },
};

export function vowelDiameters(v: Vowel): number[] {
  const s = VOWEL_SHAPES[v];
  return REST.map((r, i) => {
    let d = r;
    if (i >= 7 && i < LIPS) {
      d = r * (1 - s.narrow * Math.exp(-(((i - s.pos) / s.width) ** 2)));
      if (s.open && i > s.pos + 6) d = Math.min(s.open, d + (s.open - r) * Math.min(1, (i - s.pos - 6) / 8));
    }
    if (i >= LIPS) d = s.lips;
    return d;
  });
}

interface Segment {
  t0: number;
  t1: number;
  kind: 'vowel' | 'cons' | 'silence';
  vowel?: Vowel;
  cons?: Consonant;
  release?: boolean;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Render a monophonic sung line. Deterministic for the same notes and seed. */
export function renderSinger(notes: SungNote[], seconds: number, sampleRate: number, seed: string, opts: SingerOptions = {}): Float32Array {
  const rng = new Rng(`singer:${seed}`);
  const breath = opts.breathiness ?? 0.18;
  const vibRate = opts.vibratoRate ?? 5.4;
  const vibCents = opts.vibratoCents ?? 28;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const sorted = [...notes].sort((a, b) => a.time - b.time);

  // ---- 1. a timeline of articulations: consonant before the beat, vowel on the beat ----
  const segs: Segment[] = [];
  const phrases: Array<{ t0: number; t1: number }> = [];
  let vowel: Vowel = 'a';
  sorted.forEach((n, k) => {
    const next = sorted[k + 1];
    const end = Math.min(n.time + n.duration, next ? next.time : Infinity);
    const legato = next && next.time - (n.time + n.duration) < 0.06;
    if (n.syllable) {
      vowel = n.syllable.vowel;
      if (n.syllable.onset) {
        const c = PLACE[n.syllable.onset];
        segs.push({ t0: n.time - c.dur, t1: n.time, kind: 'cons', cons: n.syllable.onset, release: true });
      }
    }
    segs.push({ t0: n.time, t1: end, kind: 'vowel', vowel });
    if (n.syllable?.coda && !legato) {
      const c = PLACE[n.syllable.coda];
      segs.push({ t0: end - c.dur, t1: end, kind: 'cons', cons: n.syllable.coda });
    }
    const last = phrases[phrases.length - 1];
    const start = n.syllable?.onset ? n.time - PLACE[n.syllable.onset].dur : n.time;
    if (last && start - last.t1 < 0.12) last.t1 = end;
    else phrases.push({ t0: start, t1: end });
  });
  segs.sort((a, b) => a.t0 - b.t0);

  // ---- 2. the tract ----
  const R = new Float64Array(N);
  const L = new Float64Array(N);
  const nR = new Float64Array(N);
  const nL = new Float64Array(N);
  const d = Float64Array.from(vowelDiameters('a'));
  const target = Float64Array.from(d);
  const kj = new Float64Array(N);
  const nasal = new Biquad('bandpass', 260, 3.5, sampleRate);
  const nasal2 = new Biquad('bandpass', 2400, 4, sampleRate);
  const fric = new Biquad('highpass', 3200, 0.7, sampleRate * 2);
  const asp = new Biquad('bandpass', 1800, 0.6, sampleRate * 2);
  let phase = 0;
  let f0 = midiHz(sorted[0]?.midi ?? 60);
  let amp = 0;
  let si = 0;
  let ni = 0;
  let prevFlow = 0;
  let jitter = 0;
  const steps = 2;
  const dtStep = 1 / (sampleRate * steps);
  const damp = 0.9995;
  let noteStart = -1;
  let pi = 0;
  let nasalGain = 0;
  let noiseSm = 0;

  for (let n = 0; n < out.length; n++) {
    const t = n / sampleRate;
    while (si < segs.length && segs[si].t1 <= t) si++;
    while (ni < sorted.length - 1 && sorted[ni + 1].time <= t) ni++;
    const note = sorted[ni];
    // active articulation (consonants win over the vowel they overlap)
    let seg: Segment | undefined;
    for (let q = Math.max(0, si - 2); q < Math.min(segs.length, si + 4); q++) {
      const s = segs[q];
      if (s.t0 <= t && t < s.t1 && (!seg || s.kind === 'cons')) seg = s;
    }
    while (pi < phrases.length - 1 && phrases[pi].t1 + 0.04 <= t) pi++;
    const inPhrase = !!phrases[pi] && phrases[pi].t0 - 0.02 <= t && t < phrases[pi].t1 + 0.04;
    // targets
    let voiced = inPhrase;
    let noiseAmt = 0;
    let noiseAt = TIP;
    let nasalOn = false;
    if (seg?.kind === 'vowel') {
      const v = vowelDiameters(seg.vowel!);
      for (let i = 0; i < N; i++) target[i] = v[i];
    } else if (seg?.kind === 'cons') {
      const c = PLACE[seg.cons!];
      const u = (t - seg.t0) / (seg.t1 - seg.t0);
      for (let i = 0; i < N; i++) {
        const w = Math.exp(-(((i - c.at) / 2.2) ** 2));
        target[i] = target[i] * (1 - w) + Math.min(target[i], Math.max(0.03, c.d)) * w;
      }
      voiced = inPhrase && c.voiced;
      noiseAt = c.at;
      // stops: silent closure, then a burst in the last 30 %
      if (c.d === 0 && c.noise > 0) noiseAmt = u > 0.7 ? c.noise : 0;
      else noiseAmt = c.noise;
      nasalOn = c.nasal;
    }
    noiseSm += (noiseAmt - noiseSm) * 0.02;
    const rate = seg?.kind === 'cons' ? 0.006 : 0.003;
    for (let i = 0; i < N; i++) d[i] += (target[i] - d[i]) * rate;

    // pitch: portamento, vibrato that grows after the onset, a little jitter
    if (note && t >= note.time - 0.03) {
      if (noteStart !== note.time) noteStart = note.time;
      const glide = note.syllable ? 0.0025 : 0.0012;
      f0 += (midiHz(note.midi) - f0) * glide;
    }
    jitter += (rng.next() - 0.5) * 0.002 - jitter * 0.001;
    const sinceOn = t - noteStart;
    const vib = vibCents * Math.min(1, Math.max(0, (sinceOn - 0.15) / 0.3));
    const f = f0 * Math.pow(2, (vib * Math.sin(2 * Math.PI * vibRate * t)) / 1200) * (1 + jitter);
    const vel = note?.velocity ?? 0.8;
    const ampTarget = voiced ? 0.55 + 0.45 * vel : 0;
    amp += (ampTarget - amp) * (ampTarget > amp ? 0.004 : 0.0016);

    // reflection coefficients from areas
    for (let j = 1; j < N; j++) {
      const a0 = d[j - 1] * d[j - 1];
      const a1 = d[j] * d[j];
      kj[j] = a0 + a1 > 1e-9 ? (a0 - a1) / (a0 + a1) : 0;
    }
    let closure = Infinity;
    for (let i = 9; i < N; i++) if (d[i] < closure) closure = d[i];

    let y = 0;
    for (let st = 0; st < steps; st++) {
      phase += f * dtStep;
      if (phase >= 1) phase -= 1;
      // Rosenberg glottal flow; its derivative drives the tract
      const Tp = 0.42;
      const Tn = 0.18;
      const flow = phase < Tp ? 0.5 * (1 - Math.cos((Math.PI * phase) / Tp)) : phase < Tp + Tn ? Math.cos((Math.PI * (phase - Tp)) / (2 * Tn)) : 0;
      const dflow = (flow - prevFlow) * 40;
      prevFlow = flow;
      const white = rng.next() * 2 - 1;
      const aspiration = asp.process(white) * (breath * amp * (0.4 + 0.6 * flow) + (seg?.cons === 'h' ? 0.35 * (inPhrase ? 1 : 0) : 0));
      const glottal = dflow * amp + aspiration;
      nR[0] = L[0] * 0.75 + glottal;
      nL[N - 1] = R[N - 1] * -0.85;
      for (let j = 1; j < N; j++) {
        const w = kj[j] * (R[j - 1] + L[j]);
        nR[j] = R[j - 1] - w;
        nL[j - 1] = L[j] + w;
      }
      if (noiseSm > 1e-4) {
        const tn = fric.process(white) * noiseSm * 0.18 * (inPhrase ? 1 : 0);
        nR[noiseAt] += tn / 2;
        nL[noiseAt] += tn / 2;
      }
      for (let j = 0; j < N; j++) {
        R[j] = nR[j] * damp;
        L[j] = nL[j] * damp;
      }
      y += R[N - 1];
    }
    y /= steps;
    nasalGain += ((nasalOn ? 1 : closure < 0.08 ? 0.2 : 0) - nasalGain) * 0.003;
    const hum = nasal.process(prevFlow * amp) * 0.9 + nasal2.process(prevFlow * amp) * 0.15;
    y += hum * nasalGain;
    out[n] = y;
  }
  // DC / rumble out
  const hp = new Biquad('highpass', 80, 0.7, sampleRate);
  for (let n = 0; n < out.length; n++) out[n] = hp.process(out[n]);
  return out;
}
