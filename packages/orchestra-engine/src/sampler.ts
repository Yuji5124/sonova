/** Plays library zones: pitch shift by resampling, crossfaded loops for long notes, shaped release. */
import { INSTRUMENTS, type SampleLibrary, type SampleZone } from './library.ts';

export interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

export interface PlayOptions {
  /** extra gain in dB */
  gainDb?: number;
  /** fade-in (s), to soften a sample's attack (used by the timbre bridge) */
  fadeIn?: number;
  /** override release (s) */
  release?: number;
  /** pitch offset in cents (microtonal) */
  cents?: number;
  /** start offset into the sample (s) — skips the attack */
  offset?: number;
}

/** Build a source long enough for `needSec` by repeating the sample's middle with equal-power crossfades. */
function extend(src: Float32Array, sr: number, needSec: number): Float32Array {
  const need = Math.ceil(needSec * sr);
  if (src.length >= need) return src;
  const a = Math.floor(src.length * 0.42);
  const b = Math.floor(src.length * 0.86);
  const x = Math.min(Math.floor(0.18 * sr), Math.floor((b - a) / 3));
  const out = new Float32Array(need + x);
  out.set(src.subarray(0, b));
  let w = b; // write head: next segment starts at w - x (overlap)
  while (w < need) {
    const start = w - x;
    for (let i = 0; i < b - a && start + i < out.length; i++) {
      const s = src[a + i];
      if (i < x) {
        const t = i / x;
        out[start + i] = out[start + i] * Math.cos((t * Math.PI) / 2) + s * Math.sin((t * Math.PI) / 2);
      } else out[start + i] = s;
    }
    w = start + (b - a);
  }
  return out;
}

/** Render one note to a stereo buffer at `sr`. The buffer starts at the note-on. */
export function playNote(lib: SampleLibrary, inst: string, art: string, midi: number, vel: number, dur: number, sr: number, o: PlayOptions = {}): Stereo {
  const preset = INSTRUMENTS[inst];
  const zone: SampleZone = lib.pick(inst, art, Math.round(midi), vel);
  const a = zone.audio!;
  const ratio = Math.pow(2, (midi - zone.midi + (o.cents ?? 0) / 100) / 12) * (a.sampleRate / sr);
  const sustained = preset.sustained.includes(art);
  const release = o.release ?? preset.release;
  const off = Math.round((o.offset ?? 0) * a.sampleRate);
  const srcSec = (x: Float32Array) => (x.length - off) / a.sampleRate;
  // length of the output: sustained = dur + release; otherwise the sample's own length (cut at 8 s)
  const outSec = sustained ? dur + release : Math.min(8, srcSec(a.channels[0]) / Math.pow(2, (midi - zone.midi) / 12));
  const chans = a.channels.length > 1 ? [a.channels[0], a.channels[1]] : [a.channels[0], a.channels[0]];
  const need = (outSec * Math.pow(2, (midi - zone.midi) / 12)) + (o.offset ?? 0) + 0.05;
  const src = chans.map((c) => (sustained ? extend(c, a.sampleRate, need) : c));
  const n = Math.max(1, Math.ceil(outSec * sr));
  const out = [new Float32Array(n), new Float32Array(n)];
  const relStart = sustained ? Math.round(dur * sr) : n - Math.round(Math.min(0.05, outSec / 4) * sr);
  const relLen = Math.max(1, sustained ? Math.round(release * sr) : n - relStart);
  const fadeIn = Math.max(1, Math.round((o.fadeIn ?? 0.002) * sr));
  const g = Math.pow(10, ((o.gainDb ?? 0) - 14 * Math.pow(1 - Math.max(0, Math.min(1, vel)), 1.4)) / 20);
  for (let c = 0; c < 2; c++) {
    const s = src[c];
    for (let i = 0; i < n; i++) {
      const p = off + i * ratio;
      const k = Math.floor(p);
      if (k + 1 >= s.length) break;
      const f = p - k;
      // 4-point Hermite interpolation
      const y0 = s[k - 1] ?? s[k];
      const y1 = s[k];
      const y2 = s[k + 1];
      const y3 = s[k + 2] ?? y2;
      let y = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      if (i < fadeIn) y *= i / fadeIn;
      if (i >= relStart) y *= 0.5 + 0.5 * Math.cos((Math.PI * Math.min(1, (i - relStart) / relLen)));
      out[c][i] = y * g;
    }
  }
  return { left: out[0], right: out[1] };
}
