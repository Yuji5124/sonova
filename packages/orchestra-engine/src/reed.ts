/**
 * Reed instruments as digital waveguides (physical models), for the two voices VSCO-2-CE does not have:
 *  - bass clarinet: a cylindrical bore = one delay line closed at the reed (odd harmonics), after the STK
 *    Clarinet model (Cook & Scavone, The Synthesis ToolKit) — re-implemented here, no STK code
 *  - baritone saxophone: a conical bore approximated by two delay lines either side of the reed position
 *    (all harmonics), after the STK Saxofony model
 * The reed is a pressure-controlled valve (a clipped linear "reed table"); the breath has noise and vibrato.
 * A body resonance and a little saturation give the honk / growl. Deterministic for a given seed.
 */
import { Rng } from '@sonova/instrument-dna';

export type ReedKind = 'bassClarinet' | 'bariSax';

class Frac {
  private buf: Float32Array;
  private w = 0;
  constructor(max: number) {
    this.buf = new Float32Array(max);
  }
  read(d: number): number {
    const n = this.buf.length;
    const p = this.w - d;
    const i = Math.floor(p);
    const f = p - i;
    const a = this.buf[((i % n) + n) % n];
    const b = this.buf[(((i + 1) % n) + n) % n];
    return a + (b - a) * f;
  }
  write(x: number) {
    this.buf[this.w % this.buf.length] = x;
    this.w++;
  }
}

const reedTable = (x: number, offset: number, slope: number) => Math.max(-1, Math.min(1, offset + slope * x));

export interface ReedOptions {
  /** breath noise (0–0.3) */
  noise?: number;
  /** vibrato depth (fraction of the breath) and rate */
  vibrato?: number;
  vibratoHz?: number;
  /** extra growl (saturation drive 0–1) */
  growl?: number;
  /** attack time (s) */
  attack?: number;
}

/** loop delay corrections (samples) found by measuring the rendered pitch (see tests) */
export const REED_TUNING = { bassClarinet: 1.0, bariSax: 1.2 };

export function reedNote(kind: ReedKind, midi: number, dur: number, vel: number, sr: number, seed: string, o: ReedOptions = {}): Float32Array {
  const rng = new Rng(`reed:${kind}:${seed}`);
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const release = kind === 'bariSax' ? 0.12 : 0.1;
  const n = Math.ceil((dur + release + 0.05) * sr);
  const out = new Float32Array(n);
  const attack = o.attack ?? (kind === 'bariSax' ? 0.025 : 0.035);
  const noise = o.noise ?? (kind === 'bariSax' ? 0.1 : 0.06);
  const vib = o.vibrato ?? 0.025;
  const vibHz = o.vibratoHz ?? 5.2;
  // the breath has to clear the reed's threshold; louder notes blow harder
  const breathMax = kind === 'bariSax' ? 0.55 + 0.25 * vel : 0.6 + 0.25 * vel;
  let lp = 0;
  let dc = 0;
  let dcIn = 0;
  // body resonance: a band-pass around the instrument's formant, blended in (honk)
  const formant = kind === 'bariSax' ? 650 : 1100;
  const w = (2 * Math.PI * formant) / sr;
  const q = 1.2;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha / (1 + alpha);
  const a1 = (-2 * Math.cos(w)) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const drive = 1 + (o.growl ?? (kind === 'bariSax' ? 0.6 : 0.2)) * 3;
  const env = (t: number) => (t < attack ? t / attack : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release));
  if (kind === 'bassClarinet') {
    const len = 0.5 * (sr / f0) - REED_TUNING.bassClarinet;
    const d = new Frac(Math.ceil(len) + 4);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let breath = breathMax * env(t);
      breath += breath * noise * (rng.next() * 2 - 1);
      breath += breath * vib * Math.sin(2 * Math.PI * vibHz * t) * Math.min(1, t / 0.3);
      const back = d.read(len);
      lp = 0.5 * (back + lp); // one-zero low-pass of the bore end (losses)
      const pdiff = -0.95 * lp - breath;
      d.write(breath + pdiff * reedTable(pdiff, 0.7, -0.3));
      out[i] = back;
    }
  } else {
    const total = sr / f0 - REED_TUNING.bariSax;
    const pos = 0.22;
    const l0 = (1 - pos) * total;
    const l1 = pos * total;
    const d0 = new Frac(Math.ceil(l0) + 4);
    const d1 = new Frac(Math.ceil(l1) + 4);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let breath = breathMax * env(t);
      breath += breath * noise * (rng.next() * 2 - 1);
      breath += breath * vib * Math.sin(2 * Math.PI * vibHz * t) * Math.min(1, t / 0.25);
      const o0 = d0.read(l0);
      const o1 = d1.read(l1);
      lp = 0.5 * (o0 + lp);
      const temp = -0.95 * lp;
      const last = temp - o1;
      const pdiff = breath - last;
      d1.write(temp);
      d0.write(breath - pdiff * reedTable(pdiff, 0.7, 0.3) - temp);
      out[i] = last;
    }
  }
  // DC block, body resonance blend, saturation, level by velocity
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = out[i];
    dc = x - dcIn + 0.995 * dc;
    dcIn = x;
    const y = b0 * dc - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = dc;
    y2 = y1;
    y1 = y;
    out[i] = Math.tanh((dc * 0.7 + y * 1.6) * drive) / drive;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const g = peak > 0 ? (0.4 + 0.6 * vel) / peak : 0;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}
