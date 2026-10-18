import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { analyzeImage, sha256Hex, type ImageFeatures } from '@sonova/source-analyzer';
import { createImageDNA, type InstrumentDNA } from '@sonova/instrument-dna';
import { PHASE1_SEED, PHASE1_SOURCE_NAMES, encodeWav16 } from '@sonova/composition-engine';
import type { StereoBuffer } from '@sonova/synthesis-engine';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

export const PHASE1_SOURCES = PHASE1_SOURCE_NAMES.map((f) => join(ROOT, 'experiments/sources', f));
export { PHASE1_SEED };

export interface LoadedSource {
  path: string;
  name: string;
  sha256: string;
  features: ImageFeatures;
}

export async function loadImageSource(path: string): Promise<LoadedSource> {
  const bytes = readFileSync(path);
  if (!path.toLowerCase().endsWith('.png')) throw new Error(`CLI supports PNG only (browser supports PNG/JPG): ${path}`);
  const png = PNG.sync.read(bytes);
  return { path, name: basename(path), sha256: await sha256Hex(new Uint8Array(bytes)), features: analyzeImage({ width: png.width, height: png.height, data: png.data }) };
}

export async function buildInstruments(paths = PHASE1_SOURCES, seed = PHASE1_SEED): Promise<{ sources: LoadedSource[]; dnas: InstrumentDNA[] }> {
  const sources = await Promise.all(paths.map(loadImageSource));
  const dnas = sources.map((s) => createImageDNA({ sourceType: 'image', sourceName: s.name, sourceHash: s.sha256, features: s.features, seed }));
  return { sources, dnas };
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeStereoWav(path: string, buf: StereoBuffer, ditherSeed: string): Uint8Array {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodeWav16([buf.left, buf.right], buf.sampleRate, ditherSeed);
  writeFileSync(path, bytes);
  return bytes;
}
