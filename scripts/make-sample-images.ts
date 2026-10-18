/**
 * Generates the three original Phase 1 source images (no external material, CC0 by the project).
 *   bark.png   — tree rings (wood)        → percussive, rhythmic instrument expected
 *   tower.png  — concrete facade grid      → resonant instrument expected
 *   sunset.png — sunset over rippling water → soft, colour-shifting instrument expected
 * The pictures are procedural; the analyzer does not know what they depict.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { Rng } from '@sonova/instrument-dna';

const SIZE = 256;
const OUT = new URL('../experiments/sources/', import.meta.url);

function valueNoise(seed: string, cells: number) {
  const rng = new Rng(seed);
  const grid = Array.from({ length: (cells + 1) * (cells + 1) }, () => rng.next());
  const at = (x: number, y: number) => grid[(y % (cells + 1)) * (cells + 1) + (x % (cells + 1))];
  return (u: number, v: number) => {
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

function write(name: string, shade: (u: number, v: number, rng: Rng) => [number, number, number]) {
  const png = new PNG({ width: SIZE, height: SIZE });
  const rng = new Rng(name);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = shade(x / (SIZE - 1), y / (SIZE - 1), rng);
      const i = (y * SIZE + x) * 4;
      png.data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      png.data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      png.data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      png.data[i + 3] = 255;
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(name, OUT), PNG.sync.write(png, { colorType: 6 }));
  console.log(`wrote experiments/sources/${name}`);
}

// 1. Tree rings with warped growth, fine fibres and a knot.
const warp = valueNoise('bark-warp', 6);
const fibre = valueNoise('bark-fibre', 90);
write('bark.png', (u, v, rng) => {
  const dx = u - 0.32;
  const dy = (v - 0.62) * 1.15;
  let d = Math.sqrt(dx * dx + dy * dy) + (warp(u, v) - 0.5) * 0.09;
  const kx = u - 0.74;
  const ky = v - 0.24;
  d += 0.05 * Math.exp(-(kx * kx + ky * ky) * 160);
  const ring = 0.5 + 0.5 * Math.cos(d * 2 * Math.PI * 17);
  const late = Math.pow(ring, 3.5);
  const grain = (fibre(u * 0.4, v * 3) - 0.5) * 0.18 + (rng.next() - 0.5) * 0.07;
  const base = 0.52 - late * 0.3 + grain;
  return [base * 1.18 + 0.06, base * 0.78 + 0.02, base * 0.46];
});

// 2. Concrete facade: pillars, floor slabs, a grid of windows, a few lit.
const stain = valueNoise('tower-stain', 10);
const lit = new Rng('tower-lights');
const lights = Array.from({ length: 9 * 12 }, () => lit.next() < 0.14);
write('tower.png', (u, v, rng) => {
  const cols = 9;
  const rows = 12;
  const cu = (u * cols) % 1;
  const rv = (v * rows) % 1;
  const isWindow = cu > 0.22 && cu < 0.82 && rv > 0.2 && rv < 0.78;
  const concrete = 0.62 + (stain(u, v) - 0.5) * 0.12 + (rng.next() - 0.5) * 0.04 - v * 0.08;
  if (!isWindow) {
    const pillar = cu < 0.08 ? -0.08 : 0;
    const c = concrete + pillar;
    return [c, c, c * 1.02];
  }
  const idx = Math.floor(v * rows) * cols + Math.floor(u * cols);
  if (lights[idx]) return [0.92, 0.78, 0.45];
  const glass = 0.2 + (1 - rv) * 0.12 + (rng.next() - 0.5) * 0.02;
  return [glass * 0.9, glass, glass * 1.15];
});

// 3. Sunset: sky gradient, sun disc, rippled reflection on water.
const cloud = valueNoise('sunset-cloud', 5);
const ripple = valueNoise('sunset-ripple', 24);
write('sunset.png', (u, v) => {
  const horizon = 0.58;
  const sunX = 0.66;
  const sunY = 0.47;
  if (v < horizon) {
    const t = v / horizon;
    const sky: [number, number, number] = [0.2 + t * 0.78, 0.12 + t * 0.42, 0.42 - t * 0.2];
    const c = (cloud(u * 1.5, v * 3) - 0.5) * 0.12;
    const sd = Math.hypot(u - sunX, (v - sunY) * 1.1);
    const sun = Math.exp(-sd * sd * 90) * 0.9 + Math.exp(-sd * 9) * 0.25;
    return [sky[0] + sun + c, sky[1] + sun * 0.8 + c * 0.6, sky[2] + sun * 0.35 + c * 0.4];
  }
  const t = (v - horizon) / (1 - horizon);
  const w = (ripple(u * 0.6, v * 6) - 0.5) * 0.08;
  const refl = Math.exp(-Math.pow((u - sunX + w) * 7, 2)) * (1 - t) * 0.75;
  return [0.55 - t * 0.38 + refl + w, 0.26 - t * 0.12 + refl * 0.7, 0.36 + t * 0.06 + refl * 0.3];
});
