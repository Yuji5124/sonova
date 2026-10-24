import { powerSpectrum2D } from './fft.ts';

/** Decoded pixels. Browsers get this from canvas `getImageData`, Node from a PNG decoder. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface ImageFeatures {
  width: number;
  height: number;
  aspect: number;
  /** Colour */
  meanRGB: [number, number, number];
  meanSaturation: number;
  colorfulness: number;
  warmth: number;
  hueHistogram: number[];
  dominantHue: number;
  hueConcentration: number;
  /** Luminance */
  meanLuminance: number;
  luminanceStd: number;
  contrast: number;
  luminanceEntropy: number;
  /** Edges */
  edgeMean: number;
  edgeDensity: number;
  verticalness: number;
  orientationEntropy: number;
  /** Pattern / texture */
  textureRoughness: number;
  /** Spatial frequency (2D FFT of luminance) */
  radialSpectrum: number[];
  spectralCentroid: number;
  spectralSlope: number;
  highFreqRatio: number;
  /** Repetition (autocorrelation of row / column profiles) */
  periodX: number;
  strengthX: number;
  periodY: number;
  strengthY: number;
  repetitionStrength: number;
  dominantPeriod: number;
  /** Where the light is */
  brightCenterX: number;
  brightCenterY: number;
}

export const IMAGE_ANALYSIS_SIZE = 128;
const FFT_SIZE = 64;

/** Round so that features (and everything derived from them) serialise identically everywhere. */
export function r6(value: number): number {
  return Math.round(value * 1e6) / 1e6 || 0;
}

/** Area-average resample to a fixed square grid so analysis does not depend on the input resolution. */
function resample(img: RGBAImage, size: number): Float64Array {
  const out = new Float64Array(size * size * 3);
  const sx = img.width / size;
  const sy = img.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < Math.min(y1, img.height); yy++) {
        for (let xx = x0; xx < Math.min(x1, img.width); xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3] / 255;
          // Composite transparent pixels on black so alpha is not ignored.
          r += (img.data[i] / 255) * a;
          g += (img.data[i + 1] / 255) * a;
          b += (img.data[i + 2] / 255) * a;
          n++;
        }
      }
      const o = (y * size + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return out;
}

export function entropy(hist: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < hist.length; i++) total += hist[i];
  if (total <= 0) return 0;
  let h = 0;
  for (let i = 0; i < hist.length; i++) {
    const p = hist[i] / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h / Math.log2(hist.length);
}

/** Strongest repetition in a 1D profile: the highest normalised autocorrelation peak after the first dip. */
function periodicity(profile: Float64Array): { period: number; strength: number } {
  const n = profile.length;
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= n;
  const centered = profile.map((v) => v - mean);
  let var0 = 0;
  for (const v of centered) var0 += v * v;
  if (var0 < 1e-9) return { period: 0, strength: 0 };
  const maxLag = Math.floor(n / 2);
  const ac = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += centered[i] * centered[i + lag];
    ac[lag] = (s / var0) * (n / (n - lag));
  }
  let lag = 1;
  while (lag < maxLag && ac[lag] > 0) lag++;
  let best = 0;
  let bestLag = 0;
  for (let l = Math.max(lag, 2); l < maxLag; l++) {
    if (ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > best) {
      best = ac[l];
      bestLag = l;
    }
  }
  return { period: bestLag, strength: Math.max(0, Math.min(1, best)) };
}

export function analyzeImage(img: RGBAImage): ImageFeatures {
  if (!img.width || !img.height || img.data.length < img.width * img.height * 4) throw new Error('Invalid RGBA image');
  const S = IMAGE_ANALYSIS_SIZE;
  const px = resample(img, S);
  const N = S * S;
  const lum = new Float64Array(N);
  const hueHist = new Float64Array(12);
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
  for (let i = 0; i < N; i++) {
    const r = px[i * 3];
    const g = px[i * 3 + 1];
    const b = px[i * 3 + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = L;
    sumR += r;
    sumG += g;
    sumB += b;
    sumL += L;
    cx += L * ((i % S) / (S - 1));
    cy += L * (Math.floor(i / S) / (S - 1));
    lumHist[Math.min(31, Math.floor(L * 32))]++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    sumSat += sat;
    if (max - min > 1e-6) {
      let h: number;
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      const deg = (h * 60 + 360) % 360;
      hueHist[Math.floor(deg / 30) % 12] += sat * max;
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
  const stdL = Math.sqrt(varL / N);
  const sortedL = Array.from(lum).sort((a, b) => a - b);
  const contrast = sortedL[Math.floor(N * 0.95)] - sortedL[Math.floor(N * 0.05)];
  const mRG = sumRG / N;
  const mYB = sumYB / N;
  const colorfulness =
    Math.sqrt(Math.max(0, sumRG2 / N - mRG * mRG) + Math.max(0, sumYB2 / N - mYB * mYB)) + 0.3 * Math.sqrt(mRG * mRG + mYB * mYB);
  const hueTotal = hueHist.reduce((a, b) => a + b, 0);
  let domBin = 0;
  for (let i = 1; i < 12; i++) if (hueHist[i] > hueHist[domBin]) domBin = i;

  // Sobel edges and gradient orientation.
  let edgeSum = 0;
  let edgeCount = 0;
  let sumGx = 0;
  let sumGy = 0;
  const oriHist = new Float64Array(8);
  let rough = 0;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const p = (xx: number, yy: number) => lum[yy * S + xx];
      const gx = p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x - 1, y) - p(x - 1, y + 1);
      const gy = p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x, y - 1) - p(x + 1, y - 1);
      const mag = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 4);
      edgeSum += mag;
      if (mag > 0.1) edgeCount++;
      sumGx += Math.abs(gx);
      sumGy += Math.abs(gy);
      if (mag > 0.02) {
        const ang = (Math.atan2(gy, gx) + Math.PI) % Math.PI;
        oriHist[Math.min(7, Math.floor((ang / Math.PI) * 8))] += mag;
      }
      // Laplacian: fine-grain roughness independent of large shapes.
      rough += Math.abs(4 * p(x, y) - p(x - 1, y) - p(x + 1, y) - p(x, y - 1) - p(x, y + 1));
    }
  }
  const inner = (S - 2) * (S - 2);

  // Spatial frequency spectrum on a Hann-windowed 64×64 luminance grid.
  const F = FFT_SIZE;
  const grid = new Float64Array(F * F);
  for (let y = 0; y < F; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (F - 1));
    for (let x = 0; x < F; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (F - 1));
      const v = (lum[2 * y * S + 2 * x] + lum[2 * y * S + 2 * x + 1] + lum[(2 * y + 1) * S + 2 * x] + lum[(2 * y + 1) * S + 2 * x + 1]) / 4;
      grid[y * F + x] = (v - meanL) * wx * wy;
    }
  }
  const power = powerSpectrum2D(grid, F);
  const bands = new Float64Array(16);
  for (let y = 0; y < F; y++) {
    const fy = y <= F / 2 ? y : y - F;
    for (let x = 0; x < F; x++) {
      const fx = x <= F / 2 ? x : x - F;
      const r = Math.sqrt(fx * fx + fy * fy);
      if (r < 1 || r > F / 2) continue;
      bands[Math.min(15, Math.floor(((r - 1) / (F / 2 - 1)) * 16))] += power[y * F + x];
    }
  }
  const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;
  const radial = Array.from(bands, (b) => b / bandTotal);
  let centroid = 0;
  radial.forEach((p, i) => (centroid += p * (i / 15)));
  const highFreq = radial.slice(8).reduce((a, b) => a + b, 0);
  // Log-log slope of band energy (natural images ≈ -2, noise ≈ 0).
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  radial.forEach((p, i) => {
    const lx = Math.log(i + 1);
    const ly = Math.log(p + 1e-12);
    sx += lx;
    sy += ly;
    sxx += lx * lx;
    sxy += lx * ly;
  });
  const slope = (16 * sxy - sx * sy) / (16 * sxx - sx * sx);

  // Repetition: mean luminance per column (horizontal pattern) and per row (vertical pattern).
  const colProfile = new Float64Array(S);
  const rowProfile = new Float64Array(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      colProfile[x] += lum[y * S + x] / S;
      rowProfile[y] += lum[y * S + x] / S;
    }
  }
  const px_ = periodicity(colProfile);
  const py_ = periodicity(rowProfile);
  const dominant = px_.strength >= py_.strength ? px_ : py_;

  return {
    width: img.width,
    height: img.height,
    aspect: r6(img.width / img.height),
    meanRGB: [r6(sumR / N), r6(sumG / N), r6(sumB / N)],
    meanSaturation: r6(sumSat / N),
    colorfulness: r6(colorfulness),
    warmth: r6((sumR - sumB) / N),
    hueHistogram: Array.from(hueHist, (v) => r6(hueTotal > 0 ? v / hueTotal : 0)),
    dominantHue: domBin * 30 + 15,
    hueConcentration: r6(hueTotal > 0 ? hueHist[domBin] / hueTotal : 0),
    meanLuminance: r6(meanL),
    luminanceStd: r6(stdL),
    contrast: r6(contrast),
    luminanceEntropy: r6(entropy(lumHist)),
    edgeMean: r6(edgeSum / inner),
    edgeDensity: r6(edgeCount / inner),
    verticalness: r6(sumGx + sumGy > 0 ? sumGx / (sumGx + sumGy) : 0.5),
    orientationEntropy: r6(entropy(oriHist)),
    textureRoughness: r6(Math.min(1, rough / inner)),
    radialSpectrum: radial.map(r6),
    spectralCentroid: r6(centroid),
    spectralSlope: r6(slope),
    highFreqRatio: r6(highFreq),
    periodX: px_.period,
    strengthX: r6(px_.strength),
    periodY: py_.period,
    strengthY: r6(py_.strength),
    repetitionStrength: r6(dominant.strength),
    dominantPeriod: r6(dominant.period / S),
    brightCenterX: r6(sumL > 0 ? cx / sumL : 0.5),
    brightCenterY: r6(sumL > 0 ? cy / sumL : 0.5),
  };
}

/** Human-readable description of each feature, used by the explanation table in the UI. */
export const IMAGE_FEATURE_DESCRIPTIONS: Record<keyof ImageFeatures, string> = {
  width: '元画像の幅 (px)',
  height: '元画像の高さ (px)',
  aspect: '縦横比',
  meanRGB: '平均色 (R,G,B)',
  meanSaturation: '平均彩度',
  colorfulness: '色の豊かさ (Hasler–Süsstrunk)',
  warmth: '暖色度 (R−B)',
  hueHistogram: '色相ヒストグラム (30°×12)',
  dominantHue: '支配的な色相 (°)',
  hueConcentration: '色相の集中度',
  meanLuminance: '平均輝度',
  luminanceStd: '輝度の標準偏差',
  contrast: 'コントラスト (5–95%)',
  luminanceEntropy: '輝度分布のエントロピー',
  edgeMean: 'エッジ強度の平均 (Sobel)',
  edgeDensity: 'エッジ密度',
  verticalness: '縦エッジの比率',
  orientationEntropy: 'エッジ方向のばらつき',
  textureRoughness: '細かな粗さ (Laplacian)',
  radialSpectrum: '空間周波数スペクトル (16帯域)',
  spectralCentroid: '空間周波数の重心',
  spectralSlope: '空間スペクトルの傾き (log-log)',
  highFreqRatio: '高い空間周波数の比率',
  periodX: '横方向の反復周期 (px/128)',
  strengthX: '横方向の反復の強さ',
  periodY: '縦方向の反復周期 (px/128)',
  strengthY: '縦方向の反復の強さ',
  repetitionStrength: '反復構造の強さ',
  dominantPeriod: '支配的な反復周期 (画像比)',
  brightCenterX: '明るさの重心 X',
  brightCenterY: '明るさの重心 Y',
};
