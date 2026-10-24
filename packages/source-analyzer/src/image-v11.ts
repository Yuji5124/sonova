/**
 * Image analysis v1.1 — the same features as v1.0 (same names, same scales), measured so that the camera,
 * the size and the crop matter less, plus a few new ones. v1.0 (`analyzeImage`) is unchanged.
 *  - exact area resampling (fractional pixel coverage) instead of whole-pixel boxes: no aliasing on odd sizes
 *  - the image's own noise level is estimated (median absolute diagonal detail, Donoho & Johnstone 1994)
 *    and subtracted from roughness, edges and the spatial spectrum: sensor grain is not "texture"
 *  - colour statistics weight each pixel by its chroma above the noise: grey pixels with noisy colour no longer vote
 *  - hue: 36 bins, circular smoothing, dominant hue as a weighted circular mean (continuous, not a 30° bin)
 *  - repetition: the fundamental period (smallest lag within 85% of the best peak), not its multiples
 * New: noiseSigma, palette (4 colours, k-means), hueSpread (circular), detailScale (coarse vs fine texture),
 *  edgeOrientation (dominant edge angle) and orientationStrength.
 */
import { powerSpectrum2D } from './fft.ts';
import { IMAGE_ANALYSIS_SIZE, entropy, r6, type ImageFeatures, type RGBAImage } from './image.ts';

export const ANALYZER_V11_VERSION = 'sonova-analyzer/1.1.0';

export interface ImageFeaturesV11 extends ImageFeatures {
  analyzer: '1.1';
  /** estimated noise (luminance σ, 0–1) of the analysis grid */
  noiseSigma: number;
  /** k-means palette, heaviest first: rgb 0–1, weight share */
  palette: Array<{ rgb: [number, number, number]; weight: number; hue: number; chroma: number }>;
  /** circular spread of the hue (0 = one hue, 1 = all hues) */
  hueSpread: number;
  /** 0 = only fine detail, 1 = only coarse structure (energy at 1/16 vs 1/4 cycles/px) */
  detailScale: number;
  /** dominant edge direction (degrees, 0 = vertical edges / horizontal gradient) and how dominant (0–1) */
  edgeOrientation: number;
  orientationStrength: number;
}

const FFT_SIZE = 64;

/** area resample with fractional coverage at the borders of each target cell */
function resampleExact(img: RGBAImage, size: number): Float64Array {
  const out = new Float64Array(size * size * 3);
  const sx = img.width / size;
  const sy = img.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < size; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const w = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          if (w <= 0) continue;
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3] / 255;
          r += (img.data[i] / 255) * a * w;
          g += (img.data[i + 1] / 255) * a * w;
          b += (img.data[i + 2] / 255) * a * w;
          wsum += w;
        }
      }
      const o = (y * size + x) * 3;
      out[o] = r / wsum;
      out[o + 1] = g / wsum;
      out[o + 2] = b / wsum;
    }
  }
  return out;
}

/**
 * noise σ from the finest diagonal (HH) Haar detail, σ = median(|HH|)/0.6745 (Donoho & Johnstone 1994),
 * taken in 16×16 blocks and read at the 20th-percentile block: sensor noise is everywhere, texture is not,
 * so the quieter blocks tell the noise apart from fine texture
 */
export function estimateNoise(lum: Float64Array, S: number): number {
  const B = 16;
  const sig: number[] = [];
  for (let by = 0; by + B <= S; by += B)
    for (let bx = 0; bx + B <= S; bx += B) {
      const hh: number[] = [];
      for (let y = by; y + 1 < by + B; y += 2)
        for (let x = bx; x + 1 < bx + B; x += 2) {
          const a = lum[y * S + x];
          const b = lum[y * S + x + 1];
          const c = lum[(y + 1) * S + x];
          const d = lum[(y + 1) * S + x + 1];
          hh.push(Math.abs(a - b - c + d) / 2);
        }
      hh.sort((p, q) => p - q);
      sig.push(hh[Math.floor(hh.length / 2)] / 0.6745);
    }
  sig.sort((p, q) => p - q);
  return sig[Math.floor(sig.length * 0.2)];
}

/** fundamental repetition period of a 1D profile */
function periodicityV11(profile: Float64Array): { period: number; strength: number } {
  const n = profile.length;
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= n;
  const c = profile.map((v) => v - mean);
  let var0 = 0;
  for (const v of c) var0 += v * v;
  if (var0 < 1e-9) return { period: 0, strength: 0 };
  const maxLag = Math.floor(n / 2);
  const ac = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += c[i] * c[i + lag];
    ac[lag] = (s / var0) * (n / (n - lag));
  }
  let lag = 1;
  while (lag < maxLag && ac[lag] > 0) lag++;
  const peaks: Array<[number, number]> = [];
  for (let l = Math.max(lag, 2); l < maxLag; l++) if (ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > 0) peaks.push([l, ac[l]]);
  if (!peaks.length) return { period: 0, strength: 0 };
  const best = Math.max(...peaks.map((p) => p[1]));
  const fund = peaks.find((p) => p[1] >= 0.85 * best)!;
  // sub-sample peak position (parabola) so a 10% crop moves the period smoothly
  const [l, v] = fund;
  const a = ac[l - 1];
  const b = ac[l + 1];
  const d = (a - b) / (2 * (a - 2 * v + b) || 1);
  return { period: l + Math.max(-0.5, Math.min(0.5, d)), strength: Math.max(0, Math.min(1, best)) };
}

function kmeansPalette(px: Float64Array, N: number, k = 4): Array<{ rgb: [number, number, number]; weight: number }> {
  // deterministic init: luminance quantiles
  const idx = Array.from({ length: N }, (_, i) => i).sort((a, b) => px[a * 3] + px[a * 3 + 1] + px[a * 3 + 2] - (px[b * 3] + px[b * 3 + 1] + px[b * 3 + 2]));
  const cent = Array.from({ length: k }, (_, j) => {
    const i = idx[Math.floor(((j + 0.5) / k) * N)];
    return [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
  });
  const assign = new Int32Array(N);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < N; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (px[i * 3] - cent[j][0]) ** 2 + (px[i * 3 + 1] - cent[j][1]) ** 2 + (px[i * 3 + 2] - cent[j][2]) ** 2;
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      assign[i] = best;
    }
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < N; i++) {
      const s = sum[assign[i]];
      s[0] += px[i * 3];
      s[1] += px[i * 3 + 1];
      s[2] += px[i * 3 + 2];
      s[3]++;
    }
    sum.forEach((s, j) => s[3] > 0 && (cent[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < N; i++) counts[assign[i]]++;
  return cent.map((c, j) => ({ rgb: [c[0], c[1], c[2]] as [number, number, number], weight: counts[j] / N })).filter((p) => p.weight > 0).sort((a, b) => b.weight - a.weight);
}

const hueOf = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 1e-9) return 0;
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return (h * 60 + 360) % 360;
};

export function analyzeImageV11(img: RGBAImage): ImageFeaturesV11 {
  if (!img.width || !img.height || img.data.length < img.width * img.height * 4) throw new Error('Invalid RGBA image');
  const S = IMAGE_ANALYSIS_SIZE;
  const px = resampleExact(img, S);
  const N = S * S;
  const lum = new Float64Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.2126 * px[i * 3] + 0.7152 * px[i * 3 + 1] + 0.0722 * px[i * 3 + 2];
  const sigma = estimateNoise(lum, S);

  // ---- colour (chroma-weighted, noise-aware) ----
  const hue36 = new Float64Array(36);
  // per-bin sums of the actual hue directions, so the dominant hue is not rounded to a bin centre
  const hueCos = new Float64Array(36);
  const hueSin = new Float64Array(36);
  const lumHist = new Float64Array(32);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSat = 0;
  let sumRG = 0;
  let sumYB = 0;
  let sumRG2 = 0;
  let sumYB2 = 0;
  let sumL = 0;
  let cx = 0;
  let cy = 0;
  let hx = 0;
  let hy = 0;
  let hw = 0;
  const chromaFloor = Math.max(0.03, 3 * sigma);
  for (let i = 0; i < N; i++) {
    const r = px[i * 3];
    const g = px[i * 3 + 1];
    const b = px[i * 3 + 2];
    const L = lum[i];
    sumR += r;
    sumG += g;
    sumB += b;
    sumL += L;
    cx += L * ((i % S) / (S - 1));
    cy += L * (Math.floor(i / S) / (S - 1));
    lumHist[Math.min(31, Math.floor(L * 32))]++;
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);
    const clean = Math.max(0, chroma - chromaFloor);
    sumSat += clean / Math.max(max, 0.1);
    if (clean > 0) {
      const h = hueOf(r, g, b);
      const w = clean * clean;
      const bin = Math.floor(h / 10) % 36;
      const c = Math.cos((h * Math.PI) / 180);
      const sn = Math.sin((h * Math.PI) / 180);
      hue36[bin] += w;
      hueCos[bin] += w * c;
      hueSin[bin] += w * sn;
      hx += w * c;
      hy += w * sn;
      hw += w;
    }
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRG += rg;
    sumYB += yb;
    sumRG2 += rg * rg;
    sumYB2 += yb * yb;
  }
  const meanL = sumL / N;
  let varL = 0;
  for (let i = 0; i < N; i++) varL += (lum[i] - meanL) ** 2;
  // the noise adds σ² to the variance: remove it
  const stdL = Math.sqrt(Math.max(0, varL / N - sigma * sigma));
  const sortedL = Array.from(lum).sort((a, b) => a - b);
  const contrast = sortedL[Math.floor(N * 0.95)] - sortedL[Math.floor(N * 0.05)];
  const mRG = sumRG / N;
  const mYB = sumYB / N;
  const colorfulness = Math.sqrt(Math.max(0, sumRG2 / N - mRG * mRG - 2 * sigma * sigma) + Math.max(0, sumYB2 / N - mYB * mYB - 1.5 * sigma * sigma)) + 0.3 * Math.sqrt(mRG * mRG + mYB * mYB);
  // circular smoothing of the hue histogram, then the dominant hue as the weighted circular mean around the peak
  const sm = hue36.map((_, k) => 0.25 * hue36[(k + 35) % 36] + 0.5 * hue36[k] + 0.25 * hue36[(k + 1) % 36]);
  let peak = 0;
  for (let k = 1; k < 36; k++) if (sm[k] > sm[peak]) peak = k;
  let px_ = 0;
  let py_ = 0;
  let near = 0;
  for (let d = -4; d <= 4; d++) {
    const k = (peak + d + 36) % 36;
    px_ += hueCos[k];
    py_ += hueSin[k];
    near += hue36[k];
  }
  const dominantHue = hw > 0 ? ((Math.atan2(py_, px_) * 180) / Math.PI + 360) % 360 : 0;
  const hueConcentration = hw > 0 ? near / hw : 0;
  const hueSpread = hw > 0 ? 1 - Math.hypot(hx, hy) / hw : 0;
  const hue12 = new Array(12).fill(0);
  hue36.forEach((v, k) => (hue12[Math.floor(k / 3)] += v));

  // ---- edges (noise floor removed) ----
  let edgeSum = 0;
  let edgeSoft = 0;
  let sumGx = 0;
  let sumGy = 0;
  const ori = new Float64Array(16);
  let lapAbs = 0;
  let ox = 0;
  let oy = 0;
  let ow = 0;
  const gNoise = 0.866 * sigma; // Rayleigh scale of |Sobel|/4 for white noise σ
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const p = (xx: number, yy: number) => lum[yy * S + xx];
      const gx = p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x - 1, y) - p(x - 1, y + 1);
      const gy = p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x, y - 1) - p(x + 1, y - 1);
      const raw = Math.sqrt(gx * gx + gy * gy) / 4;
      const mag = Math.min(1, Math.max(0, raw - 2 * gNoise));
      edgeSum += mag;
      // soft edge count: 0 below 0.07, 1 above 0.13 (v1.0 counted a hard > 0.1)
      edgeSoft += Math.max(0, Math.min(1, (mag - 0.07) / 0.06));
      sumGx += Math.max(0, Math.abs(gx) - 2 * 3.46 * sigma);
      sumGy += Math.max(0, Math.abs(gy) - 2 * 3.46 * sigma);
      if (mag > 0.02) {
        const ang = (Math.atan2(gy, gx) + Math.PI) % Math.PI;
        const w = mag * mag;
        ori[Math.min(15, Math.floor((ang / Math.PI) * 16))] += w;
        ox += w * Math.cos(2 * ang);
        oy += w * Math.sin(2 * ang);
        ow += w;
      }
      lapAbs += Math.abs(4 * p(x, y) - p(x - 1, y) - p(x + 1, y) - p(x, y - 1) - p(x, y + 1));
    }
  }
  const inner = (S - 2) * (S - 2);
  // mean|Laplacian| as in v1.0, with the noise's own share (white noise σ: 0.798·√20·σ) removed in quadrature
  const rough = Math.sqrt(Math.max(0, (lapAbs / inner) ** 2 - (3.57 * sigma) ** 2));
  const ori8 = new Array(8).fill(0);
  ori.forEach((v, k) => (ori8[Math.floor(k / 2)] += v));

  // ---- spatial spectrum (noise floor removed) ----
  const F = FFT_SIZE;
  const grid = new Float64Array(F * F);
  let w2 = 0;
  for (let y = 0; y < F; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (F - 1));
    for (let x = 0; x < F; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (F - 1));
      const v = (lum[2 * y * S + 2 * x] + lum[2 * y * S + 2 * x + 1] + lum[(2 * y + 1) * S + 2 * x] + lum[(2 * y + 1) * S + 2 * x + 1]) / 4;
      grid[y * F + x] = (v - meanL) * wx * wy;
      w2 += (wx * wy) ** 2;
    }
  }
  const power = powerSpectrum2D(grid, F);
  const floor = (sigma / 2) ** 2 * w2;
  const bands = new Float64Array(16);
  for (let y = 0; y < F; y++) {
    const fy = y <= F / 2 ? y : y - F;
    for (let x = 0; x < F; x++) {
      const fx = x <= F / 2 ? x : x - F;
      const r = Math.sqrt(fx * fx + fy * fy);
      if (r < 1 || r > F / 2) continue;
      bands[Math.min(15, Math.floor(((r - 1) / (F / 2 - 1)) * 16))] += Math.max(0, power[y * F + x] - floor);
    }
  }
  const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;
  const radial = Array.from(bands, (b) => b / bandTotal);
  let centroid = 0;
  radial.forEach((p, i) => (centroid += p * (i / 15)));
  const highFreq = radial.slice(8).reduce((a, b) => a + b, 0);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  radial.forEach((p, i) => {
    const lx = Math.log(i + 1);
    const ly = Math.log(p + 1e-6);
    sx += lx;
    sy += ly;
    sxx += lx * lx;
    sxy += lx * ly;
  });
  const slope = (16 * sxy - sx * sy) / (16 * sxx - sx * sx);
  const coarse = radial.slice(0, 3).reduce((a, b) => a + b, 0);
  const fine = radial.slice(6).reduce((a, b) => a + b, 0);

  // ---- repetition ----
  const colProfile = new Float64Array(S);
  const rowProfile = new Float64Array(S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      colProfile[x] += lum[y * S + x] / S;
      rowProfile[y] += lum[y * S + x] / S;
    }
  const rx = periodicityV11(colProfile);
  const ry = periodicityV11(rowProfile);
  const dominant = rx.strength >= ry.strength ? rx : ry;

  const palette = kmeansPalette(px, N).map((p) => ({ rgb: p.rgb.map(r6) as [number, number, number], weight: r6(p.weight), hue: Math.round(hueOf(...p.rgb)), chroma: r6(Math.max(...p.rgb) - Math.min(...p.rgb)) }));
  const orientation = ow > 0 ? ((((Math.atan2(oy, ox) / 2) * 180) / Math.PI + 180) % 180) : 0;

  return {
    analyzer: '1.1',
    width: img.width,
    height: img.height,
    aspect: r6(img.width / img.height),
    meanRGB: [r6(sumR / N), r6(sumG / N), r6(sumB / N)],
    meanSaturation: r6(sumSat / N),
    colorfulness: r6(colorfulness),
    warmth: r6((sumR - sumB) / N),
    hueHistogram: hue12.map((v) => r6(hw > 0 ? v / hw : 0)),
    dominantHue: r6(dominantHue),
    hueConcentration: r6(hueConcentration),
    meanLuminance: r6(meanL),
    luminanceStd: r6(stdL),
    contrast: r6(contrast),
    luminanceEntropy: r6(entropy(lumHist)),
    edgeMean: r6(edgeSum / inner),
    edgeDensity: r6(edgeSoft / inner),
    verticalness: r6(sumGx + sumGy > 0 ? sumGx / (sumGx + sumGy) : 0.5),
    orientationEntropy: r6(entropy(ori8)),
    textureRoughness: r6(Math.min(1, rough)),
    radialSpectrum: radial.map(r6),
    spectralCentroid: r6(centroid),
    spectralSlope: r6(slope),
    highFreqRatio: r6(highFreq),
    periodX: r6(rx.period),
    strengthX: r6(rx.strength),
    periodY: r6(ry.period),
    strengthY: r6(ry.strength),
    repetitionStrength: r6(dominant.strength),
    dominantPeriod: r6(dominant.period / S),
    brightCenterX: r6(sumL > 0 ? cx / sumL : 0.5),
    brightCenterY: r6(sumL > 0 ? cy / sumL : 0.5),
    noiseSigma: r6(sigma),
    palette,
    hueSpread: r6(hueSpread),
    detailScale: r6(coarse + fine > 0 ? coarse / (coarse + fine) : 0.5),
    edgeOrientation: Math.round(orientation),
    orientationStrength: r6(ow > 0 ? Math.hypot(ox, oy) / ow : 0),
  };
}

