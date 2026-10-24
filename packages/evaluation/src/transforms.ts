/**
 * Nuisance transforms: changes that should NOT change which instrument a picture becomes
 * (the same wall photographed with another camera, size or crop).
 */
import { Rng } from '@sonova/instrument-dna';
import type { RGBAImage } from '@sonova/source-analyzer';

export type Transform = { name: string; description: string; apply: (img: RGBAImage) => RGBAImage };

const make = (w: number, h: number): RGBAImage => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
const px = (img: RGBAImage, x: number, y: number, c: number) => img.data[(Math.max(0, Math.min(img.height - 1, y)) * img.width + Math.max(0, Math.min(img.width - 1, x))) * 4 + c];

/** bilinear resample to w×h */
export function resize(img: RGBAImage, w: number, h: number): RGBAImage {
  const out = make(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * img.width) / w - 0.5;
      const sy = ((y + 0.5) * img.height) / h - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const a = px(img, x0, y0, c) * (1 - fx) + px(img, x0 + 1, y0, c) * fx;
        const b = px(img, x0, y0 + 1, c) * (1 - fx) + px(img, x0 + 1, y0 + 1, c) * fx;
        out.data[(y * w + x) * 4 + c] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  return out;
}

export const TRANSFORMS: Transform[] = [
  { name: 'half', description: '縮小 (1/2)', apply: (img) => resize(img, Math.round(img.width / 2), Math.round(img.height / 2)) },
  { name: 'upscale', description: '拡大 (×1.6、ぼける)', apply: (img) => resize(img, Math.round(img.width * 1.6), Math.round(img.height * 1.6)) },
  {
    name: 'noise',
    description: 'センサーノイズ (σ = 4/255)',
    apply: (img) => {
      const rng = new Rng('nuisance:noise');
      const out = make(img.width, img.height);
      for (let i = 0; i < img.data.length; i++) {
        if (i % 4 === 3) out.data[i] = img.data[i];
        else {
          // Box–Muller
          const g = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
          out.data[i] = Math.round(img.data[i] + g * 4);
        }
      }
      return out;
    },
  },
  {
    name: 'crop',
    description: '中央 90% にトリミング',
    apply: (img) => {
      const w = Math.round(img.width * 0.9);
      const h = Math.round(img.height * 0.9);
      const ox = Math.round((img.width - w) / 2);
      const oy = Math.round((img.height - h) / 2);
      const out = make(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) out.data[(y * w + x) * 4 + c] = px(img, x + ox, y + oy, c);
      return out;
    },
  },
  {
    name: 'exposure',
    description: '露出 +8% (少し明るく撮れた)',
    apply: (img) => {
      const out = make(img.width, img.height);
      for (let i = 0; i < img.data.length; i++) out.data[i] = i % 4 === 3 ? img.data[i] : Math.round(255 * Math.pow(img.data[i] / 255, 1 / 1.08) * 1.0);
      return out;
    },
  },
  {
    name: 'compress',
    description: '圧縮 (階調 6bit + 2×2 の色ぼかし)',
    apply: (img) => {
      const out = make(img.width, img.height);
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++)
          for (let c = 0; c < 4; c++) {
            const i = (y * img.width + x) * 4 + c;
            if (c === 3) {
              out.data[i] = img.data[i];
              continue;
            }
            // luminance stays sharp, colour is averaged over 2×2 (like 4:2:0 chroma), then 6-bit quantised
            const own = img.data[i];
            const avg = (px(img, x & ~1, y & ~1, c) + px(img, (x & ~1) + 1, y & ~1, c) + px(img, x & ~1, (y & ~1) + 1, c) + px(img, (x & ~1) + 1, (y & ~1) + 1, c)) / 4;
            out.data[i] = Math.round(((own * 0.5 + avg * 0.5) / 4)) * 4;
          }
      return out;
    },
  },
];
