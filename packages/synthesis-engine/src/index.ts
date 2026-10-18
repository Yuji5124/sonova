import { euclid, type InstrumentDNA } from '@sonova/instrument-dna';
import { renderVoice, type NoteSpec } from './voice.ts';
import { fadeEdges, master, reverb, type MasterReport } from './dsp.ts';

export * from './voice.ts';
export * from './dsp.ts';

export const SAMPLE_RATE = 44100;

export interface StereoBuffer {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

/** Equal-power pan of a mono voice into a stereo bus. */
export function mixInto(bus: StereoBuffer, voice: Float32Array, startSec: number, pan: number, gain: number): void {
  const start = Math.round(startSec * bus.sampleRate);
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  const gl = Math.cos(angle) * gain;
  const gr = Math.sin(angle) * gain;
  const end = Math.min(bus.left.length, start + voice.length);
  for (let i = Math.max(0, start); i < end; i++) {
    const v = voice[i - start];
    bus.left[i] += v * gl;
    bus.right[i] += v * gr;
  }
}

export function createBus(seconds: number, sampleRate = SAMPLE_RATE): StereoBuffer {
  const n = Math.ceil(seconds * sampleRate);
  return { sampleRate, left: new Float32Array(n), right: new Float32Array(n) };
}

/** Short audition phrase of one instrument: up/down through its range on its own rhythm. */
export function renderInstrumentDemo(dna: InstrumentDNA, seconds = 6, sampleRate = SAMPLE_RATE): { buffer: StereoBuffer; report: MasterReport; notes: Array<NoteSpec & { time: number }> } {
  const bus = createBus(seconds, sampleRate);
  const { low, high } = dna.pitch_range;
  const root = dna.pitch_range.root_pc;
  const pentatonic = [0, 2, 4, 7, 9];
  const pitches: number[] = [];
  for (let m = low; m <= high; m++) if (pentatonic.includes((((m - root) % 12) + 12) % 12)) pitches.push(m);
  const seq = pitches.length ? [...pitches.filter((_, i) => i % 2 === 0), ...pitches.filter((_, i) => i % 2 === 1).reverse()] : [dna.pitch_range.center];
  const stepSec = 60 / 96 / 4 / dna.rhythm.rate;
  const notes: Array<NoteSpec & { time: number }> = [];
  let step = 0;
  let i = 0;
  const pattern = euclid(dna.rhythm.steps, dna.rhythm.pulses, dna.rhythm.rotation);
  while (step * stepSec < seconds - Math.max(1, dna.release)) {
    if (pattern[step % pattern.length]) {
      const midi = seq[i % seq.length];
      notes.push({ time: step * stepSec, midi, velocity: 0.8, duration: Math.max(stepSec, dna.attack + 0.1), timbre: 0, kind: 'note' });
      i++;
    }
    step++;
  }
  if (notes.length < 4) {
    // Very sparse rhythms: audition on an even grid instead so the timbre can be heard.
    notes.length = 0;
    const span = seconds - 3;
    for (let k = 0; k < 5; k++) notes.push({ time: (k * span) / 5, midi: seq[k % seq.length], velocity: 0.8, duration: Math.max(0.3, span / 5), timbre: 0, kind: 'note' });
  }
  // A resonance at the end shows how the instrument rings.
  notes.push({ time: Math.max(0, seconds - 2.8), midi: dna.pitch_range.center, velocity: 0.55, duration: 1.2, timbre: 0, kind: 'resonance' });
  notes.forEach((note, n) => mixInto(bus, renderVoice(dna, note, sampleRate, `${dna.dna_hash}:${n}`), note.time, dna.pan * 0.5, 0.8));
  const [wl, wr] = reverb(bus.left, bus.right, { roomSize: 0.4 + dna.resonance.amount * 0.4, damping: 0.5, sampleRate });
  for (let n = 0; n < bus.left.length; n++) {
    bus.left[n] += wl[n] * 0.35;
    bus.right[n] += wr[n] * 0.35;
  }
  fadeEdges(bus.left, bus.right, sampleRate, 0.005, 0.4);
  const report = master(bus.left, bus.right, { sampleRate, targetRmsDb: -18, ceilingDb: -1, maxGainDb: 18 });
  return { buffer: bus, report, notes };
}
export * from './rock/index.ts';
