import * as TonejsMidi from '@tonejs/midi';

// @tonejs/midi ships UMD for Node and ESM for bundlers; accept either shape.
const Midi: typeof TonejsMidi.Midi = (TonejsMidi as { Midi?: typeof TonejsMidi.Midi }).Midi ?? (TonejsMidi as unknown as { default: typeof TonejsMidi }).default.Midi;
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { DNA_ENGINE_VERSION } from '@sonova/instrument-dna';
import { ANALYZER_VERSION } from '@sonova/source-analyzer';
import { GENERATOR_VERSION, arcAt, type GeneratorResult, type GenEvent } from '@sonova/music-generator';
import {
  SAMPLE_RATE,
  SYNTH_ENGINE_VERSION,
  createBus,
  fadeEdges,
  master,
  mixInto,
  renderVoice,
  reverb,
  type MasterReport,
  type NoteKind,
  type StereoBuffer,
} from '@sonova/synthesis-engine';

export * from './wav.ts';
export * from './works.ts';
export * from './rock.ts';

export const COMPOSITION_ENGINE_VERSION = 'sonova-composition/1.0.0';

export interface ArrangedNote {
  eventId: number;
  time: number;
  midi: number;
  velocity: number;
  duration: number;
  timbre: number;
  kind: NoteKind;
}

export interface Track {
  instrument_id: string;
  name: string;
  pan: number;
  gain: number;
  mute: boolean;
  send: number;
  notes: ArrangedNote[];
}

export interface Section {
  name: string;
  start: number;
  end: number;
  description: string;
}

export interface Arrangement {
  title: string;
  durationSec: number;
  bpm: number;
  key: GeneratorResult['key'];
  sections: Section[];
  tracks: Track[];
}

export interface TrackEdit {
  mute?: boolean;
  gain?: number;
}

const SECTION_TEXT: Record<string, string> = {
  emergence: '最初の楽器だけが鳴り、他の楽器が共鳴によって目覚めていく',
  interaction: '相互作用が増え、音色とリズムが互いを変え始める',
  bloom: '密度と結合が最大。連鎖反応が最も長くなる',
  ebb: '密度が引き、残った共鳴が次の波を準備する',
  afterglow: '新しい音は止み、共鳴とリバーブの余韻だけが残る',
};

/** Sections are read from the generator's conditions and from what actually happened. */
export function deriveSections(gen: GeneratorResult): Section[] {
  const dur = gen.config.durationSec;
  const sampleCount = 60;
  const labels: string[] = [];
  let firstWakeAll = Infinity;
  const wakes = gen.events.filter((e) => e.kind === 'wake');
  if (wakes.length >= gen.instruments.length - 1) firstWakeAll = Math.max(...wakes.map((w) => w.time));
  let peakSeen = false;
  for (let i = 0; i < sampleCount; i++) {
    const t = ((i + 0.5) / sampleCount) * dur;
    const u = t / dur;
    const a = arcAt(gen.config.arc, u);
    let label: string;
    if (t >= dur - gen.config.tailSec) label = 'afterglow';
    else if (t < Math.min(firstWakeAll, dur * 0.3) && a.density < 0.6) label = 'emergence';
    else if (a.density >= 0.72) {
      label = 'bloom';
      peakSeen = true;
    } else label = peakSeen ? 'ebb' : 'interaction';
    labels.push(label);
  }
  const sections: Section[] = [];
  labels.forEach((label, i) => {
    const start = (i / sampleCount) * dur;
    const end = ((i + 1) / sampleCount) * dur;
    const last = sections[sections.length - 1];
    if (last && last.name === label) last.end = end;
    else sections.push({ name: label, start, end, description: SECTION_TEXT[label] });
  });
  // Merge sections shorter than 1.5 s into their neighbour.
  for (let i = sections.length - 1; i > 0; i--) {
    if (sections[i].end - sections[i].start < 1.5) {
      sections[i - 1].end = sections[i].end;
      sections.splice(i, 1);
    }
  }
  return sections.map((s) => ({ ...s, start: round(s.start), end: round(s.end) }));
}

export function arrange(dnas: InstrumentDNA[], gen: GeneratorResult, title: string, edits: TrackEdit[] = []): Arrangement {
  const tracks: Track[] = dnas.map((dna, i) => ({
    instrument_id: dna.instrument_id,
    name: dna.name,
    pan: spreadPan(dna.pan, i, dnas.length),
    gain: edits[i]?.gain ?? 1,
    mute: edits[i]?.mute ?? false,
    send: round(0.16 + dna.resonance.amount * 0.22),
    notes: [],
  }));
  for (const e of gen.events) {
    if (e.kind !== 'note' && e.kind !== 'resonance') continue;
    tracks[e.instrument].notes.push(toNote(e));
  }
  return { title, durationSec: gen.config.durationSec, bpm: gen.bpm, key: gen.key, sections: deriveSections(gen), tracks };
}

/** Keep each instrument's own placement but avoid three instruments stacked in the centre. */
function spreadPan(own: number, i: number, n: number): number {
  const slot = n === 1 ? 0 : -0.6 + (1.2 * i) / (n - 1);
  return round(Math.max(-0.85, Math.min(0.85, own * 0.5 + slot * 0.6)));
}

const toNote = (e: GenEvent): ArrangedNote => ({
  eventId: e.id,
  time: e.time,
  midi: e.midi!,
  velocity: e.velocity!,
  duration: e.duration!,
  timbre: e.timbre ?? 0,
  kind: e.kind as NoteKind,
});

export interface RenderResult {
  buffer: StereoBuffer;
  master: MasterReport;
  renderMs: number;
}

/** Render an arrangement to a mastered stereo buffer. Deterministic for a given input. */
export function renderArrangement(arr: Arrangement, dnas: InstrumentDNA[], sampleRate = SAMPLE_RATE, onProgress?: (p: number) => void): RenderResult {
  const t0 = Date.now();
  const dry = createBus(arr.durationSec, sampleRate);
  const wet = createBus(arr.durationSec, sampleRate);
  const total = arr.tracks.reduce((s, t) => s + t.notes.length, 0);
  let done = 0;
  arr.tracks.forEach((track, i) => {
    const dna = dnas[i];
    if (track.mute) {
      done += track.notes.length;
      return;
    }
    const level = 0.55 * track.gain;
    for (const note of track.notes) {
      const voice = renderVoice(dna, note, sampleRate, `${arr.title}:${note.eventId}`);
      const res = note.kind === 'resonance';
      mixInto(dry, voice, note.time, track.pan, level * (res ? 0.8 : 1));
      mixInto(wet, voice, note.time, track.pan * 0.6, level * (res ? 0.55 : track.send));
      if (++done % 25 === 0) onProgress?.(done / Math.max(1, total));
    }
  });
  const [rl, rr] = reverb(wet.left, wet.right, { roomSize: 0.82, damping: 0.45, sampleRate });
  for (let n = 0; n < dry.left.length; n++) {
    dry.left[n] += rl[n];
    dry.right[n] += rr[n];
  }
  fadeEdges(dry.left, dry.right, sampleRate, 0.01, 1.2);
  const report = master(dry.left, dry.right, { sampleRate, targetRmsDb: -17, ceilingDb: -1, maxGainDb: 14 });
  onProgress?.(1);
  return { buffer: dry, master: report, renderMs: Date.now() - t0 };
}

/** MIDI: one track per instrument plus a resonance track; timbre mutations as CC74 (brightness). */
export function toMidi(arr: Arrangement, gen: GeneratorResult): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(arr.bpm);
  midi.header.name = arr.title;
  arr.tracks.forEach((track, i) => {
    const t = midi.addTrack();
    t.name = track.name;
    t.channel = i * 2;
    const r = midi.addTrack();
    r.name = `${track.name} (resonance)`;
    r.channel = i * 2 + 1;
    for (const n of track.notes) {
      (n.kind === 'resonance' ? r : t).addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
    }
    t.addCC({ number: 10, value: Math.round(((track.pan + 1) / 2) * 127) / 127, time: 0 });
    for (const e of gen.events) {
      if (e.instrument === i && e.kind === 'mutation' && e.param === 'timbre') {
        t.addCC({ number: 74, value: (Number(e.to) + 1) / 2, time: e.time });
      }
    }
  });
  return midi.toArray();
}

export interface GenerationManifest {
  sonova_version: string;
  title: string;
  created_at: string;
  engines: Record<string, string>;
  algorithms: string[];
  seed: string;
  generator_config: GeneratorResult['config'];
  sources: Array<{ name: string; type: string; sha256: string }>;
  instruments: Array<{ instrument_id: string; dna_hash: string; seed: string }>;
  reproducibility: string;
  third_party: Array<{ name: string; version: string; license: string; use: string }>;
}

export function engineVersions(): Record<string, string> {
  return {
    analyzer: ANALYZER_VERSION,
    dna: DNA_ENGINE_VERSION,
    synth: SYNTH_ENGINE_VERSION,
    generator: GENERATOR_VERSION,
    composition: COMPOSITION_ENGINE_VERSION,
  };
}

export function generationManifest(title: string, dnas: InstrumentDNA[], gen: GeneratorResult, createdAt: string): GenerationManifest {
  return {
    sonova_version: '1.0.0',
    title,
    created_at: createdAt,
    engines: engineVersions(),
    algorithms: [
      'image analysis: colour/hue histogram, luminance statistics, Sobel edges, Laplacian roughness, 2D FFT radial spectrum, profile autocorrelation',
      'instrument DNA: deterministic feature→parameter mapping (see each DNA `mapping`)',
      'synthesis: additive partials (image spectrum) + FM layer + filtered noise burst, TPT state-variable low-pass, ADSR',
      'generator: step-based agent simulation (energy, timbre, resonance, Euclidean rhythm, motif memory) with bidirectional interaction rules',
      'safety: energy cap, refractory periods, max chain depth, per-step response cap, look-ahead peak limiter (−1 dBFS)',
      'reverb: Freeverb-style comb/allpass network (own implementation)',
    ],
    seed: gen.config.seed,
    generator_config: gen.config,
    sources: dnas.map((d) => ({ name: d.source_name, type: d.source_type, sha256: d.source_hash })),
    instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, dna_hash: d.dna_hash, seed: d.seed })),
    reproducibility: '同じ素材 (sha256)・同じシード・同じエンジンバージョンで、同じ DNA・イベント列・音声が再生成されます。',
    third_party: [{ name: '@tonejs/midi', version: '2.x', license: 'MIT', use: 'MIDI file writing' }],
  };
}

export interface StructureDoc {
  title: string;
  durationSec: number;
  bpm: number;
  key: GeneratorResult['key'];
  sections: Section[];
  tracks: Array<{ instrument_id: string; name: string; pan: number; notes: number; resonances: number; mute: boolean; gain: number }>;
  interaction: GeneratorResult['stats'];
  chains: GeneratorResult['chains'];
}

export function structureDoc(arr: Arrangement, gen: GeneratorResult): StructureDoc {
  return {
    title: arr.title,
    durationSec: arr.durationSec,
    bpm: arr.bpm,
    key: arr.key,
    sections: arr.sections,
    tracks: arr.tracks.map((t) => ({
      instrument_id: t.instrument_id,
      name: t.name,
      pan: t.pan,
      notes: t.notes.filter((n) => n.kind === 'note').length,
      resonances: t.notes.filter((n) => n.kind === 'resonance').length,
      mute: t.mute,
      gain: t.gain,
    })),
    interaction: gen.stats,
    chains: gen.chains,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
export * from './series/grow.ts';
export * from './series/heal.ts';
export * from './series/space.ts';
export * from './series/rock-series.ts';
export * from './series/xrock.ts';
export * from './series/glossolalia.ts';
export * from './series/toyriot.ts';
export * from './series/psylo.ts';
export * from './zig-daily.ts';
