/** Render a log-frequency spectrogram PNG of a WAV (for checking renders by eye). Usage: tsx scripts/spectrogram.ts in.wav out.png */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fft } from '@sonova/source-analyzer';
import { decodeWav } from '@sonova/composition-engine';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: spectrogram.ts in.wav out.png');
const wav = decodeWav(new Uint8Array(readFileSync(input)));
const N = 2048;
const W = 900;
const H = 300;
const mono = new Float64Array(wav.frames);
for (let i = 0; i < wav.frames; i++) mono[i] = wav.data.reduce((s, ch) => s + ch[i], 0) / wav.channels;
const png = new PNG({ width: W, height: H + 40 });
const hop = Math.max(1, Math.floor((wav.frames - N) / W));
const fMin = 40;
const fMax = 16000;
for (let x = 0; x < W; x++) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (mono[x * hop + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  fft(re, im);
  let rms = 0;
  for (let i = 0; i < N; i++) rms += (mono[x * hop + i] ?? 0) ** 2;
  rms = Math.sqrt(rms / N);
  for (let y = 0; y < H; y++) {
    const f = fMin * Math.pow(fMax / fMin, 1 - y / H);
    const bin = Math.min(N / 2 - 1, Math.round((f / wav.sampleRate) * N));
    const mag = Math.sqrt(re[bin] ** 2 + im[bin] ** 2) / (N / 4);
    const db = 20 * Math.log10(mag + 1e-9);
    const v = Math.max(0, Math.min(1, (db + 90) / 80));
    const i = (y * W + x) * 4;
    png.data[i] = Math.round(255 * Math.min(1, v * 1.6));
    png.data[i + 1] = Math.round(255 * Math.max(0, v * 1.4 - 0.4));
    png.data[i + 2] = Math.round(255 * Math.max(0, 0.5 - Math.abs(v - 0.3)) * 1.2);
    png.data[i + 3] = 255;
  }
  const level = Math.max(0, Math.min(39, Math.round(((20 * Math.log10(rms + 1e-9) + 60) / 60) * 39)));
  for (let y = H; y < H + 40; y++) {
    const i = (y * W + x) * 4;
    const on = H + 40 - y <= level;
    png.data[i] = on ? 120 : 20;
    png.data[i + 1] = on ? 200 : 20;
    png.data[i + 2] = on ? 255 : 30;
    png.data[i + 3] = 255;
  }
}
writeFileSync(output, PNG.sync.write(png));
console.log(`${output}: ${(wav.frames / wav.sampleRate).toFixed(2)}s`);
