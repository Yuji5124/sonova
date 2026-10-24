/**
 * A procedural test corpus of material images (no external pictures, CC0 by the project).
 * 16 materials × 2 instances: two pictures of the same material differ in seed and in small
 * parameters, the way two photos of two different brick walls differ.
 * Used to measure how faithfully and how robustly a picture becomes an instrument.
 */
import { Rng } from '@sonova/instrument-dna';
import type { RGBAImage } from '@sonova/source-analyzer';

export const CORPUS_SIZE = 256;

type RGB = [number, number, number];
type Shader = (u: number, v: number) => RGB;

/** smooth value noise in [0,1], tileable over `cells` */
export function valueNoise(seed: string, cells: number): (u: number, v: number) => number {
  const rng = new Rng(seed);
  const n = cells + 1;
  const grid = Array.from({ length: n * n }, () => rng.next());
  const at = (x: number, y: number) => grid[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}
/** fractal (fBm) noise: octaves of value noise, normalised to [0,1] */
export function fbm(seed: string, base: number, octaves: number, gain = 0.5): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, k) => valueNoise(`${seed}:${k}`, base * 2 ** k));
  let norm = 0;
  for (let k = 0; k < octaves; k++) norm += gain ** k;
  return (u, v) => layers.reduce((s, f, k) => s + f(u, v) * gain ** k, 0) / norm;
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const hsv = (h: number, s: number, v: number): RGB => {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};

export interface Material {
  name: string;
  description: string;
  make: (seed: string, rng: Rng) => Shader;
}

export const MATERIALS: Material[] = [
  {
    name: 'wood',
    description: '木の年輪',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 4, 4);
      const rings = 14 + rng.range(-3, 3);
      const cx = 0.5 + rng.range(-0.25, 0.25);
      return (u, v) => {
        const r = Math.hypot(u - cx, (v - 0.3) * 0.35) * rings + n(u, v) * 2.4;
        const t = Math.pow(0.5 + 0.5 * Math.sin(r * Math.PI * 2), 3);
        return mix([0.55, 0.36, 0.2], [0.33, 0.19, 0.09], t * 0.9 + n(u * 3, v * 3) * 0.1);
      };
    },
  },
  {
    name: 'brick',
    description: 'レンガの壁',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 16, 3);
      const rows = Math.round(9 + rng.range(-2, 2));
      const hue = 8 + rng.range(-6, 8);
      return (u, v) => {
        const y = v * rows;
        const row = Math.floor(y);
        const x = u * rows * 0.5 + (row % 2) * 0.5;
        const fx = x - Math.floor(x);
        const fy = y - row;
        const mortar = fx < 0.06 || fy < 0.12;
        const c = hsv(hue, 0.6, 0.5 + 0.18 * n(u, v) + 0.08 * Math.sin(Math.floor(x) * 12.9 + row * 7.1));
        return mortar ? mix([0.72, 0.7, 0.66], [0.5, 0.5, 0.48], n(u * 2, v * 2)) : c;
      };
    },
  },
  {
    name: 'water',
    description: '水面のさざ波',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 3, 4);
      const k = 22 + rng.range(-5, 5);
      return (u, v) => {
        const w = 0.5 + 0.5 * Math.sin((v + n(u, v) * 0.15) * k * Math.PI * 2) * 0.6 + 0.2 * (n(u * 4, v * 8) - 0.5);
        return mix([0.03, 0.17, 0.32], [0.45, 0.72, 0.85], clamp01(w));
      };
    },
  },
  {
    name: 'clouds',
    description: '空と雲',
    make: (seed) => {
      const n = fbm(`${seed}:n`, 2, 5, 0.55);
      return (u, v) => mix([0.35, 0.58, 0.88], [0.97, 0.97, 0.98], clamp01((n(u, v) - 0.42) * 2.6));
    },
  },
  {
    name: 'foliage',
    description: '茂った葉',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 24, 3, 0.6);
      const m = fbm(`${seed}:m`, 6, 2);
      const hue = 105 + rng.range(-15, 15);
      return (u, v) => {
        const t = n(u, v);
        return hsv(hue + (m(u, v) - 0.5) * 40, 0.75, clamp01(0.08 + Math.pow(t, 1.7) * 1.1));
      };
    },
  },
  {
    name: 'metal',
    description: 'ヘアライン加工の金属',
    make: (seed) => {
      const streak = valueNoise(`${seed}:s`, 180);
      const n = fbm(`${seed}:n`, 3, 3);
      return (u, v) => {
        const s = streak(u * 0.02, v);
        const g = 0.55 + 0.18 * (s - 0.5) + 0.12 * (n(u, v) - 0.5) + 0.15 * Math.exp(-((u - 0.3) ** 2) * 12);
        return [g, g * 1.01, g * 1.04];
      };
    },
  },
  {
    name: 'fabric',
    description: '織物 (ツイル)',
    make: (seed, rng) => {
      const k = 48 + Math.round(rng.range(-8, 8));
      const hue = rng.range(200, 340);
      const n = fbm(`${seed}:n`, 8, 2);
      return (u, v) => {
        const x = Math.floor(u * k);
        const y = Math.floor(v * k);
        const over = (x + y) % 4 < 2;
        return hsv(hue + (over ? 0 : 18), 0.55, (over ? 0.62 : 0.4) + 0.1 * n(u, v));
      };
    },
  },
  {
    name: 'gravel',
    description: '砂利',
    make: (seed) => {
      const cell = valueNoise(`${seed}:c`, 40);
      const n = fbm(`${seed}:n`, 60, 2);
      return (u, v) => {
        const g = 0.25 + 0.5 * Math.pow(cell(u, v), 2) + 0.25 * n(u, v);
        return [g * 1.05, g, g * 0.88];
      };
    },
  },
  {
    name: 'sunset',
    description: '夕焼けのグラデーション',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 2, 3);
      const sunX = 0.3 + rng.range(0, 0.4);
      return (u, v) => {
        const sky = mix([0.98, 0.62, 0.22], [0.32, 0.14, 0.42], clamp01(v * 1.3 - 0.1 + (n(u, v) - 0.5) * 0.1));
        const sun = Math.exp(-((u - sunX) ** 2 + (v - 0.62) ** 2) * 60);
        return mix(sky, [1, 0.92, 0.6], sun);
      };
    },
  },
  {
    name: 'marble',
    description: '大理石',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 3, 5);
      const k = 5 + rng.range(-1.5, 1.5);
      return (u, v) => {
        const vein = Math.pow(Math.abs(Math.sin((u + v * 0.6 + n(u, v) * 1.8) * k * Math.PI)), 0.25);
        return mix([0.42, 0.42, 0.45], [0.93, 0.92, 0.9], vein);
      };
    },
  },
  {
    name: 'stripes',
    description: '太い縦縞の布',
    make: (_seed, rng) => {
      const k = Math.round(7 + rng.range(-2, 2));
      const h0 = rng.range(0, 360);
      return (u) => hsv((h0 + Math.floor(u * k) * 47) % 360, 0.8, 0.85);
    },
  },
  {
    name: 'dunes',
    description: '砂丘',
    make: (seed, rng) => {
      const n = fbm(`${seed}:n`, 2, 4);
      const k = 5 + rng.range(-1, 1);
      return (u, v) => {
        const h = 0.5 + 0.5 * Math.sin((v * k + n(u, v) * 1.5 + u * 0.8) * Math.PI * 2);
        return mix([0.62, 0.43, 0.24], [0.95, 0.8, 0.56], Math.pow(h, 0.7));
      };
    },
  },
  {
    name: 'citylights',
    description: '夜の街の灯り (ボケ)',
    make: (seed) => {
      const r = new Rng(`${seed}:lights`);
      const lights = Array.from({ length: 70 }, () => ({ x: r.next(), y: 0.35 + r.next() * 0.65, s: 0.006 + r.next() * 0.02, c: hsv(20 + r.next() * 40, 0.6 + r.next() * 0.4, 1) }));
      return (u, v) => {
        let c: RGB = [0.02, 0.02, 0.06 + 0.05 * (1 - v)];
        for (const l of lights) {
          const d = ((u - l.x) ** 2 + (v - l.y) ** 2) / (l.s * l.s);
          if (d < 9) c = mix(c, l.c, Math.exp(-d) * 0.9);
        }
        return c;
      };
    },
  },
  {
    name: 'rust',
    description: '錆びた鉄板',
    make: (seed) => {
      const n = fbm(`${seed}:n`, 6, 5, 0.6);
      const spots = fbm(`${seed}:s`, 10, 2);
      return (u, v) => {
        const t = n(u, v);
        const s = spots(u, v) > 0.6 ? 0.35 : 0;
        return mix(mix([0.48, 0.2, 0.08], [0.78, 0.42, 0.15], t), [0.25, 0.22, 0.2], s);
      };
    },
  },
  {
    name: 'ice',
    description: 'ひびの入った氷',
    make: (seed) => {
      const r = new Rng(`${seed}:cracks`);
      const cracks = Array.from({ length: 14 }, () => ({ a: r.next() * Math.PI, c: r.next() * 1.4 - 0.2 }));
      const n = fbm(`${seed}:n`, 3, 3);
      return (u, v) => {
        let crack = 0;
        for (const k of cracks) crack = Math.max(crack, Math.exp(-(((u * Math.cos(k.a) + v * Math.sin(k.a) - k.c) / 0.004) ** 2)));
        return mix(mix([0.55, 0.78, 0.86], [0.85, 0.95, 0.98], n(u, v)), [1, 1, 1], crack);
      };
    },
  },
  {
    name: 'mosaic',
    description: '色タイルのモザイク',
    make: (seed, rng) => {
      const k = Math.round(12 + rng.range(-3, 3));
      const r = new Rng(`${seed}:tiles`);
      const tiles = Array.from({ length: k * k }, () => hsv(r.next() * 360, 0.5 + r.next() * 0.4, 0.5 + r.next() * 0.45));
      return (u, v) => {
        const x = u * k;
        const y = v * k;
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        if (fx < 0.08 || fy < 0.08) return [0.85, 0.83, 0.78];
        return tiles[Math.min(k - 1, Math.floor(y)) * k + Math.min(k - 1, Math.floor(x))];
      };
    },
  },
];

export interface CorpusImage {
  id: string;
  material: string;
  instance: number;
  image: RGBAImage;
}

export function renderMaterial(m: Material, instance: number, size = CORPUS_SIZE): CorpusImage {
  const seed = `sonova-corpus:${m.name}:${instance}`;
  const shade = m.make(seed, new Rng(`${seed}:params`));
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = shade(x / (size - 1), y / (size - 1));
      const i = (y * size + x) * 4;
      data[i] = Math.round(clamp01(c[0]) * 255);
      data[i + 1] = Math.round(clamp01(c[1]) * 255);
      data[i + 2] = Math.round(clamp01(c[2]) * 255);
      data[i + 3] = 255;
    }
  return { id: `${m.name}-${instance}`, material: m.name, instance, image: { width: size, height: size, data } };
}

export function corpus(instances = 2): CorpusImage[] {
  return MATERIALS.flatMap((m) => Array.from({ length: instances }, (_, k) => renderMaterial(m, k)));
}
