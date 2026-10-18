/** RBJ "Audio EQ Cookbook" biquads (public formulas). */
export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: BiquadType, freq: number, q: number, sampleRate: number, gainDb = 0) {
    this.set(type, freq, q, sampleRate, gainDb);
  }

  set(type: BiquadType, freq: number, q: number, sampleRate: number, gainDb = 0): void {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
        a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
        a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Feed-forward RMS compressor (stereo-linked), applied in place. */
export function compress(L: Float32Array, R: Float32Array, sampleRate: number, opts: { thresholdDb: number; ratio: number; attack: number; release: number; makeupDb?: number }): void {
  const att = Math.exp(-1 / (opts.attack * sampleRate));
  const rel = Math.exp(-1 / (opts.release * sampleRate));
  const makeup = Math.pow(10, (opts.makeupDb ?? 0) / 20);
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const p = (L[i] * L[i] + R[i] * R[i]) / 2;
    env = p > env ? att * env + (1 - att) * p : rel * env + (1 - rel) * p;
    const db = 10 * Math.log10(env + 1e-12);
    const over = db - opts.thresholdDb;
    const gain = over > 0 ? Math.pow(10, (-over * (1 - 1 / opts.ratio)) / 20) : 1;
    L[i] *= gain * makeup;
    R[i] *= gain * makeup;
  }
}

/** Ping-pong delay, returns the wet signal. */
export function pingPong(inL: Float32Array, inR: Float32Array, sampleRate: number, delaySec: number, feedback: number, damp = 0.3): [Float32Array, Float32Array] {
  const d = Math.max(1, Math.round(delaySec * sampleRate));
  const bufL = new Float64Array(d);
  const bufR = new Float64Array(d);
  const outL = new Float32Array(inL.length);
  const outR = new Float32Array(inR.length);
  let lpL = 0;
  let lpR = 0;
  let p = 0;
  for (let i = 0; i < inL.length; i++) {
    const yl = bufL[p];
    const yr = bufR[p];
    lpL = lpL + (1 - damp) * (yl - lpL);
    lpR = lpR + (1 - damp) * (yr - lpR);
    bufL[p] = (inL[i] + inR[i]) * 0.5 + lpR * feedback;
    bufR[p] = lpL * feedback;
    outL[i] = yl;
    outR[i] = yr;
    p = (p + 1) % d;
  }
  return [outL, outR];
}
