/** Score data: every part keeps its notes (for MIDI and for re-rendering), independent of the audio. */
import * as TonejsMidi from '@tonejs/midi';
import type { SampleLibrary } from './library.ts';
import { playNote, type PlayOptions } from './sampler.ts';
import type { Track } from './mix.ts';

const Midi: typeof TonejsMidi.Midi = (TonejsMidi as { Midi?: typeof TonejsMidi.Midi }).Midi ?? (TonejsMidi as unknown as { default: typeof TonejsMidi }).default.Midi;

export interface ScoreNote {
  t: number;
  dur: number;
  midi: number;
  vel: number;
  art?: string;
  cents?: number;
  /** why this note exists (bridge / rule) */
  why?: string;
}

export interface ScorePart {
  id: string;
  name: string;
  kind: 'orchestra' | 'electronic';
  /** sampled instrument id (orchestra) or synth name (electronic) */
  instrument: string;
  notes: ScoreNote[];
}

export interface Score {
  title: string;
  /** a nominal tempo for the MIDI header; note times are absolute seconds */
  bpm: number;
  parts: ScorePart[];
}

export function toMidi(score: Score): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(score.bpm);
  midi.header.name = score.title;
  score.parts.forEach((p, i) => {
    const tr = midi.addTrack();
    tr.name = `${p.kind === 'orchestra' ? 'ORCH' : 'ELEC'} ${p.name}`;
    tr.channel = p.instrument === 'timpani' ? 9 : i % 16 === 9 ? 10 : i % 16;
    for (const n of p.notes) tr.addNote({ midi: Math.max(0, Math.min(127, Math.round(n.midi))), time: Math.max(0, n.t), duration: Math.max(0.01, n.dur), velocity: Math.max(0.05, Math.min(1, n.vel)) });
  });
  return midi.toArray();
}

/** Render an orchestral part into a track. */
export function renderPart(lib: SampleLibrary, part: ScorePart, track: Track, sr: number, defaults: { art: string } & PlayOptions): void {
  for (const n of part.notes) {
    const v = playNote(lib, part.instrument, n.art ?? defaults.art, n.midi, n.vel, n.dur, sr, { ...defaults, cents: n.cents });
    track.add(v, n.t, sr);
  }
}
