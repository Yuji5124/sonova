/**
 * SPACE BRIDGE — one hall for everyone. A stereo impulse response is generated here (no third-party
 * IR data): early reflections of a shoebox by the image-source method + a diffuse tail whose decay
 * time depends on frequency (low 1.15×, high 0.55× the mid RT60). Convolution by FFT overlap-add.
 */
import { Rng } from '@sonova/instrument-dna';
import { fft } from '@sonova/source-analyzer';
import { Biquad } from '@sonova/synthesis-engine';

export interface HallSpec {
  /** room size in metres (width, depth, height) */
  room: [number, number, number];
  rt60: number;
  predelay: number;
  seed: string;
}

export function hallIR(sr: number, h: HallSpec): [Float32Array, Float32Array] {
  const len = Math.ceil((h.rt60 * 1.3 + h.predelay) * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const rng = new Rng(`ir:${h.seed}`);
  const c = 343;
  const [W, D, H] = h.room;
  const src = [W * 0.5, D * 0.25, 1.4];
  const ears = [[W * 0.5 - 0.1, D * 0.7, 1.3], [W * 0.5 + 0.1, D * 0.7, 1.3]];
  const beta = Math.sqrt(1 - 0.25);
  const axis = (n: number, p: number, Lx: number) => (n % 2 === 0 ? n * Lx + p : (n + 1) * Lx - p);
  const direct = Math.hypot(src[0] - ears[0][0], src[1] - ears[0][1], src[2] - ears[0][2]);
  for (let i = -3; i <= 3; i++)
    for (let j = -3; j <= 3; j++)
      for (let k = -2; k <= 2; k++) {
        const order = Math.abs(i) + Math.abs(j) + Math.abs(k);
        if (order === 0 || order > 4) continue;
        const p = [axis(i, src[0], W), axis(j, src[1], D), axis(k, src[2], H)];
        ears.forEach((e, ch) => {
          const d = Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
          const t = h.predelay + (d - direct) / c;
          const at = Math.round(t * sr);
          if (at < 0 || at >= len) return;
          (ch === 0 ? L : R)[at] += (Math.pow(beta, order) * direct) / d * 0.6;
        });
      }
  // diffuse tail, three bands with their own decay
  const bands: Array<[Biquad, number]> = [
    [new Biquad('lowpass', 350, 0.7, sr), 1.15],
    [new Biquad('bandpass', 1500, 0.5, sr), 1],
    [new Biquad('highpass', 4500, 0.7, sr), 0.55],
  ];
  const bandsR: Biquad[] = [new Biquad('lowpass', 350, 0.7, sr), new Biquad('bandpass', 1500, 0.5, sr), new Biquad('highpass', 4500, 0.7, sr)];
  const start = Math.round((h.predelay + 0.012) * sr);
  for (let i = start; i < len; i++) {
    const t = (i - start) / sr;
    const build = Math.min(1, t / 0.06);
    const nl = rng.next() * 2 - 1;
    const nr = rng.next() * 2 - 1;
    let yl = 0;
    let yr = 0;
    bands.forEach(([f, m], b) => {
      const dec = Math.pow(10, (-3 * t) / (h.rt60 * m));
      yl += f.process(nl) * dec;
      yr += bandsR[b].process(nr) * dec;
    });
    L[i] += yl * 0.22 * build;
    R[i] += yr * 0.22 * build;
  }
  let e = 0;
  for (let i = 0; i < len; i++) e += L[i] * L[i] + R[i] * R[i];
  const g = 1 / Math.sqrt(e / 2);
  for (let i = 0; i < len; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return [L, R];
}

/** Linear convolution of x with h (FFT overlap-add). */
export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const out = new Float32Array(x.length + h.length - 1);
  let N = 1;
  while (N < h.length * 2) N <<= 1;
  const B = N - h.length + 1;
  const Hr = new Float64Array(N);
  const Hi = new Float64Array(N);
  Hr.set(h);
  fft(Hr, Hi);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = 0; s < x.length; s += B) {
    re.fill(0);
    im.fill(0);
    let any = false;
    for (let i = 0; i < B && s + i < x.length; i++) {
      re[i] = x[s + i];
      if (x[s + i] !== 0) any = true;
    }
    if (!any) continue;
    fft(re, im);
    for (let k = 0; k < N; k++) {
      const a = re[k] * Hr[k] - im[k] * Hi[k];
      const b = re[k] * Hi[k] + im[k] * Hr[k];
      re[k] = a;
      im[k] = -b; // conjugate for the inverse
    }
    fft(re, im);
    for (let i = 0; i < N && s + i < out.length; i++) out[s + i] += re[i] / N;
  }
  return out;
}
