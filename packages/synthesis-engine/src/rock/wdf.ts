/**
 * Wave Digital Filter diode clipper (series R → C ∥ antiparallel diode pair).
 *
 * Reimplemented from the published method, no code copied:
 *  - K. J. Werner, V. Nangia, A. Bernardini, J. O. Smith III, A. Sarti,
 *    "An Improved and Generalized Diode Clipper Model for Wave Digital Filters", AES 2015
 *  - S. D'Angelo, L. Gabrielli, L. Turchet, "Fast Approximation of the Lambert W Function
 *    for Virtual Analog Modelling", DAFx 2019 (Wright ω approximations)
 * Studied as reference implementations: Chowdhury-DSP/chowdsp_wdf and
 * jatinchowdhury18/KlonCentaur (both BSD-3-Clause).
 */

/** Wright omega ω(x) (solution of ω + ln ω = x): D'Angelo's 3rd-order polynomial start + Newton steps. */
export function wrightOmega(x: number): number {
  let y: number;
  if (x < -3.34145955276862) y = 0;
  else if (x < 8) y = ((-1.3142931498778e-3 * x + 4.775931364975583e-2) * x + 3.631952663804445e-1) * x + 6.313183464296682e-1;
  else y = x - Math.log(x);
  if (x < -1 || y <= 0) y = Math.exp(x - Math.exp(x)); // for small ω, ω ≈ e^(x−e^x)
  // Newton refinement on f(y) = y + ln y − x (the polynomial alone is ~5 % off).
  for (let i = 0; i < 3; i++) y = Math.max(1e-300, y - ((y + Math.log(y) - x) * y) / (1 + y));
  return y;
}

export interface DiodeClipperOptions {
  sampleRate: number;
  /** Series resistance (Ω) */
  resistance?: number;
  /** Capacitance (F) */
  capacitance?: number;
  /** Diode reverse saturation current (A) */
  saturationCurrent?: number;
  /** Thermal voltage × number of diodes in series (V) */
  thermalVoltage?: number;
}

export class DiodeClipper {
  private readonly gS: number;
  private readonly gC: number;
  private readonly gP: number;
  private readonly rIs: number;
  private readonly rIsOverVt: number;
  private readonly logRIsOverVt: number;
  private readonly vt: number;
  private capState = 0;

  constructor(opts: DiodeClipperOptions) {
    const rs = opts.resistance ?? 2200;
    const c = opts.capacitance ?? 10e-9;
    const is = opts.saturationCurrent ?? 2.52e-9;
    this.vt = opts.thermalVoltage ?? 25.85e-3;
    const rc = 1 / (2 * c * opts.sampleRate);
    this.gS = 1 / rs;
    this.gC = 1 / rc;
    this.gP = this.gS + this.gC;
    const rp = 1 / this.gP;
    this.rIs = rp * is;
    this.rIsOverVt = this.rIs / this.vt;
    this.logRIsOverVt = Math.log(this.rIsOverVt);
  }

  /** Input voltage → voltage across the diodes. */
  process(vin: number): number {
    const rS = vin; // resistive voltage source reflects its EMF
    const rC = this.capState; // capacitor reflects last incident wave
    const bUp = (this.gS * rS + this.gC * rC) / this.gP;
    // Diode pair at the root, one-term approximation with sign(a)
    const a = bUp;
    const lambda = a >= 0 ? 1 : -1;
    const b = a + 2 * lambda * (this.rIs - this.vt * wrightOmega(this.logRIsOverVt + (lambda * a) / this.vt + this.rIsOverVt));
    // Parallel adaptor: wave sent down to the capacitor
    this.capState = bUp + b - rC;
    return (a + b) / 2;
  }
}

/** 2× oversampling with a short half-band FIR, so the clipper aliases less. */
const HB = (() => {
  const taps = 31;
  const h = new Float64Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - m;
    const sinc = x === 0 ? 0.5 : Math.sin((Math.PI * x) / 2) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
})();

export class Oversampled2x {
  private up = new Float64Array(HB.length);
  private down = new Float64Array(HB.length);
  private upPos = 0;
  private downPos = 0;
  constructor(private readonly fn: (x: number) => number) {}

  private fir(buf: Float64Array, pos: number): number {
    let s = 0;
    const n = buf.length;
    for (let i = 0; i < n; i++) s += HB[i] * buf[(pos - i + n) % n];
    return s;
  }

  process(x: number): number {
    let out = 0;
    for (let k = 0; k < 2; k++) {
      this.upPos = (this.upPos + 1) % this.up.length;
      this.up[this.upPos] = k === 0 ? 2 * x : 0;
      const u = this.fir(this.up, this.upPos);
      const y = this.fn(u);
      this.downPos = (this.downPos + 1) % this.down.length;
      this.down[this.downPos] = y;
      if (k === 1) out = this.fir(this.down, this.downPos);
    }
    return out;
  }
}
