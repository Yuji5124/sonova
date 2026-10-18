import * as TonejsMidi from '@tonejs/midi';
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { clamp } from '@sonova/instrument-dna';
import type { DrumHit, RockEvent, RockSong } from '@sonova/music-generator';
import {
  Biquad,
  bytebeatFormula,
  compress,
  createBus,
  fadeEdges,
  master,
  midiToHz,
  mixInto,
  pingPong,
  renderBytebeat,
  renderDrumHit,
  renderRig,
  renderSpectrogramImage,
  reverb,
  type AmpSettings,
  type MasterReport,
  type ModalKit,
  type RigEvent,
  type SpectroImage,
  type StereoBuffer,
} from '@sonova/synthesis-engine';

const Midi: typeof TonejsMidi.Midi = (TonejsMidi as { Midi?: typeof TonejsMidi.Midi }).Midi ?? (TonejsMidi as unknown as { default: typeof TonejsMidi }).default.Midi;

export const ROCK_RENDER_VERSION = 'sonova-rock-render/1.0.0';

export interface RockBand {
  guitar: InstrumentDNA;
  drums: InstrumentDNA;
  voice: InstrumentDNA;
}

export interface RockRenderPlan {
  guitarAmp: AmpSettings;
  bassAmp: AmpSettings;
  leadAmp: AmpSettings;
  kit: ModalKit;
  guitarPluck: { t60: number; damping: number; pickPosition: number; brightness: number };
  bassPluck: { t60: number; damping: number; pickPosition: number; brightness: number };
  bytebeat: { formula: string; rootHz: number };
  image: { lowHz: number; highHz: number; rows: number };
  derivations: Array<{ choice: string; value: string | number; from: string; rule: string }>;
}

/** Sound design of each part, read from the instrument DNA (recorded for explanation). */
export function rockPlan(song: RockSong, band: RockBand): RockRenderPlan {
  const { guitar: g, drums: d, voice: v } = band;
  const der: RockRenderPlan['derivations'] = [];
  const note = (choice: string, value: string | number, from: string, rule: string) => der.push({ choice, value, from, rule });
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const guitarAmp: AmpSettings = { gain: r(28 + g.interaction_rules.emission * 30), midBoostDb: r(3 + g.noise.amount * 6), cabinetHz: Math.round(3600 + g.harmonics.brightness * 1800), clean: 0 };
  note('guitar.amp.gain', guitarAmp.gain, `${g.name}.interaction_rules.emission`, '働きかけの強い素材ほど深く歪む');
  note('guitar.amp.cabinet_hz', guitarAmp.cabinetHz, `${g.name}.harmonics.brightness`, '素材の明るさ → キャビネットの高域');
  const guitarPluck = { t60: r(2.5 + g.decay * 2), damping: r(0.12 + g.harmonics.damping * 0.5), pickPosition: r(0.07 + g.noise.amount * 0.2), brightness: r(0.5 + g.harmonics.brightness * 0.45) };
  note('guitar.string.pick_position', guitarPluck.pickPosition, `${g.name}.noise.amount`, '粗い素材ほどブリッジから離れた位置を弾く');
  note('guitar.string.t60', guitarPluck.t60, `${g.name}.decay`, '素材の減衰 → 弦の減衰時間');
  const bassAmp: AmpSettings = { gain: r(2 + v.modulation.fm_index * 2), midBoostDb: 2, cabinetHz: Math.round(1800 + v.harmonics.brightness * 3000), clean: 0.45 };
  const bassPluck = { t60: r(1.2 + v.decay), damping: r(0.35 + (1 - v.harmonics.brightness) * 0.45), pickPosition: 0.22, brightness: r(0.3 + v.harmonics.brightness) };
  note('bass.string.damping', bassPluck.damping, `${v.name}.harmonics.brightness`, '暗い素材ほど丸いベース');
  const leadAmp: AmpSettings = { gain: r(55 + v.modulation.fm_index * 10), midBoostDb: 8, cabinetHz: Math.round(4600 + v.modulation.fm_index * 300), clean: 0 };
  note('lead.amp.gain', leadAmp.gain, `${v.name}.modulation.fm_index`, '彩度 (FM の深さ) → リードの歪み');
  const tonic = song.key.root_pc;
  const kickMidi = 24 + ((tonic + 7) % 12) + (24 + ((tonic + 7) % 12) < 28 ? 12 : 0);
  const kit: ModalKit = {
    kickHz: r(midiToHz(kickMidi)),
    snareHz: r(150 + d.resonance.q * 8),
    tomHz: [r(midiToHz(48 + tonic)), r(midiToHz(43 + tonic)), r(midiToHz(39 + tonic))],
    plateAspect: r(clamp(d.resonance.q / 10, 0.3, 0.95)),
    cymbalBaseHz: r(340 + d.harmonics.brightness * 220),
    decay: r(0.8 + d.decay * 0.15),
    snares: r(clamp(0.45 + d.noise.amount, 0.3, 1)),
  };
  note('drums.kick_hz', kit.kickHz, 'key', 'キックを曲の属音 (5度) に合わせる');
  note('drums.toms', kit.tomHz.join('/'), 'key', 'タムを主音・5度下・短3度下に合わせる');
  note('drums.snare_hz', kit.snareHz, `${d.name}.resonance.q`, '格子の規則性 → スネアの胴の高さ');
  note('drums.plate_aspect', kit.plateAspect, `${d.name}.resonance.q`, '素材の格子の規則性 → シンバル (板) の縦横比 → 倍音の並び');
  note('drums.cymbal_hz', kit.cymbalBaseHz, `${d.name}.harmonics.brightness`, '明るさ → シンバルの高さ');
  const rootHz = midiToHz(48 + tonic);
  return {
    guitarAmp,
    bassAmp,
    leadAmp,
    kit,
    guitarPluck,
    bassPluck,
    bytebeat: { formula: bytebeatFormula({ riff: riffSemitones(song), rootHz, bpm: song.bpm }), rootHz: r(rootHz) },
    image: { lowHz: 5500, highHz: 14500, rows: 120 },
    derivations: der,
  };
}

function riffSemitones(song: RockSong): Array<number | null> {
  return song.riff.map((s) => (s.kind === 'rest' ? null : s.kind === 'mute' ? 0 : s.off));
}

const DRUM_PAN: Record<DrumHit, number> = { kick: 0, snare: 0.04, hat: 0.38, hatOpen: 0.38, crash: -0.42, ride: -0.35, tom1: 0.3, tom2: -0.05, tom3: -0.35 };

function guitarRigEvents(events: RockEvent[], plan: RockRenderPlan, offset: number, detuneCents: number): RigEvent[] {
  const out: RigEvent[] = [];
  const gtr = events.filter((e) => e.part === 'guitar');
  gtr.forEach((e, i) => {
    const t = e.time + offset;
    if (e.kind === 'damp') return out.push({ time: t, type: 'damp' });
    if (e.kind !== 'chord') return;
    const det = Math.pow(2, detuneCents / 1200);
    out.push({
      time: t,
      type: 'pluck',
      freqs: e.midis!.map((m) => midiToHz(m) * det),
      velocity: e.velocity!,
      mute: !!e.palmMute,
      pickPosition: plan.guitarPluck.pickPosition,
      brightness: e.palmMute ? plan.guitarPluck.brightness * 0.6 : plan.guitarPluck.brightness,
      t60: e.palmMute ? 0.14 : plan.guitarPluck.t60,
      damping: e.palmMute ? 0.85 : plan.guitarPluck.damping,
      strum: e.palmMute ? 0.003 : 0.009,
    });
    const next = gtr[i + 1];
    const end = e.time + e.duration!;
    if (!e.palmMute && (!next || next.time - end > 0.04)) out.push({ time: end + offset, type: 'damp' });
  });
  for (const e of events) {
    if (e.part !== 'amp' || e.kind !== 'feedback') continue;
    out.push({ time: e.time + offset, type: 'feedback', gain: e.gain!, ramp: Math.max(0.05, e.duration! * 0.6) });
    if (e.gain! > 0) out.push({ time: e.time + e.duration! + offset, type: 'feedback', gain: 0, ramp: 0.25 });
  }
  return out;
}

function monoRigEvents(events: RockEvent[], part: 'bass' | 'lead', pluck: RockRenderPlan['bassPluck']): RigEvent[] {
  const out: RigEvent[] = [];
  const notes = events.filter((e) => e.part === part && e.kind === 'note');
  notes.forEach((e, i) => {
    const prev = notes[i - 1];
    const legato = part === 'lead' && e.slide && prev && e.time - (prev.time + prev.duration!) < 0.03 && Math.abs(e.midi! - prev.midi!) <= 3;
    if (legato) out.push({ time: e.time, type: 'bend', string: 0, freq: midiToHz(e.midi!), glide: 0.035 });
    else out.push({ time: e.time, type: 'pluck', freqs: [midiToHz(e.midi!)], velocity: e.velocity!, mute: false, pickPosition: pluck.pickPosition, brightness: pluck.brightness, t60: pluck.t60, damping: pluck.damping });
    if (e.bend) out.push({ time: e.time + e.duration! * 0.35, type: 'bend', string: 0, freq: midiToHz(e.midi! + e.bend), glide: 0.07 });
    if (e.vibrato) out.push({ time: e.time + Math.min(0.18, e.duration! * 0.4), type: 'vibrato', string: 0, rate: 5.6, depth: Math.min(45, e.vibrato * 100) });
    const next = notes[i + 1];
    const end = e.time + e.duration!;
    if (!next || next.time - end > 0.02) out.push({ time: end, type: 'damp' });
  });
  return out;
}

function rmsActive(x: Float32Array, sampleRate: number): number {
  const win = Math.floor(sampleRate * 0.05);
  let sum = 0;
  let count = 0;
  for (let w = 0; w < x.length; w += win) {
    let s = 0;
    const end = Math.min(x.length, w + win);
    for (let i = w; i < end; i++) s += x[i] * x[i];
    const r = Math.sqrt(s / Math.max(1, end - w));
    if (r > 1e-3) {
      sum += s;
      count += end - w;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

const normTo = (x: Float32Array, sampleRate: number, targetDb: number) => {
  const r = rmsActive(x, sampleRate);
  const g = r > 0 ? Math.pow(10, targetDb / 20) / r : 0;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return g;
};

export interface RockRenderResult {
  buffer: StereoBuffer;
  master: MasterReport;
  renderMs: number;
  stems: Record<string, { gainDb: number; samples: number }>;
}

export function renderRock(song: RockSong, band: RockBand, image: SpectroImage, sampleRate = 44100, log: (m: string) => void = () => undefined): RockRenderResult {
  const t0 = Date.now();
  const plan = rockPlan(song, band);
  const secs = song.durationSec;
  const mix = createBus(secs, sampleRate);
  const wet = createBus(secs, sampleRate);
  const stems: RockRenderResult['stems'] = {};
  const place = (name: string, mono: Float32Array, pan: number, send: number, targetDb: number) => {
    const g = normTo(mono, sampleRate, targetDb);
    stems[name] = { gainDb: Math.round(20 * Math.log10(g + 1e-12) * 10) / 10, samples: mono.length };
    mixInto(mix, mono, 0, pan, 1);
    if (send > 0) mixInto(wet, mono, 0, pan * 0.5, send);
  };

  // Arrangement dynamics: each section has a level, applied to the pitched band parts.
  const level = sectionLevels(song, sampleRate, mix.left.length);
  const withLevel = (x: Float32Array) => {
    for (let i = 0; i < x.length; i++) x[i] *= level[i];
    return x;
  };
  log('guitar L');
  place('guitarL', withLevel(renderRig(guitarRigEvents(song.events, plan, 0, -3), secs, sampleRate, plan.guitarAmp, `${song.seed}:gL`)), -0.82, 0.08, -19);
  log('guitar R');
  place('guitarR', withLevel(renderRig(guitarRigEvents(song.events, plan, 0.009, 4), secs, sampleRate, plan.guitarAmp, `${song.seed}:gR`)), 0.82, 0.08, -19);
  log('bass');
  const bass = renderRig(monoRigEvents(song.events, 'bass', plan.bassPluck), secs, sampleRate, plan.bassAmp, `${song.seed}:bass`, 1);
  const bassL = bass.slice();
  compress(bassL, bass, sampleRate, { thresholdDb: -20, ratio: 4, attack: 0.005, release: 0.12 });
  place('bass', withLevel(bassL), 0, 0, -18);
  log('lead');
  const lead = renderRig(monoRigEvents(song.events, 'lead', { t60: 3.5, damping: 0.2, pickPosition: 0.15, brightness: 0.85 }), secs, sampleRate, plan.leadAmp, `${song.seed}:lead`, 1);
  normTo(lead, sampleRate, -20);
  stems.lead = { gainDb: 0, samples: lead.length };
  mixInto(mix, lead, 0, 0.12, 1);
  const zero = new Float32Array(lead.length);
  const [dl, dr] = pingPong(lead, zero, sampleRate, (60 / song.bpm) * 0.75, 0.38, 0.35);
  mixInto(mix, dl, 0, -0.6, 0.32);
  mixInto(mix, dr, 0, 0.6, 0.32);
  mixInto(wet, lead, 0, 0.1, 0.22);

  log('drums');
  const drums = createBus(secs, sampleRate);
  const room = createBus(secs, sampleRate);
  for (const e of song.events) {
    if (e.part !== 'drums' || e.kind !== 'hit') continue;
    const hit = renderDrumHit(plan.kit, e.drum!, e.velocity!, sampleRate, `${song.seed}:${e.id}`);
    mixInto(drums, hit, e.time, DRUM_PAN[e.drum!], e.drum === 'kick' ? 1 : e.drum === 'snare' ? 0.8 : e.drum!.startsWith('tom') ? 0.75 : e.drum === 'hat' || e.drum === 'hatOpen' ? 0.32 : 0.42);
    if (e.drum === 'snare' || e.drum!.startsWith('tom')) mixInto(room, hit, e.time, DRUM_PAN[e.drum!], 0.25);
  }
  compress(drums.left, drums.right, sampleRate, { thresholdDb: -16, ratio: 4, attack: 0.004, release: 0.09, makeupDb: 3 });
  const dRms = Math.max(rmsActive(drums.left, sampleRate), rmsActive(drums.right, sampleRate));
  const dG = dRms > 0 ? Math.pow(10, -15 / 20) / dRms : 0;
  stems.drums = { gainDb: Math.round(20 * Math.log10(dG + 1e-12) * 10) / 10, samples: drums.left.length };
  for (let i = 0; i < mix.left.length; i++) {
    mix.left[i] += drums.left[i] * dG;
    mix.right[i] += drums.right[i] * dG;
    wet.left[i] += room.left[i] * dG;
    wet.right[i] += room.right[i] * dG;
  }

  log('textures');
  for (const e of song.events) {
    if (e.kind !== 'texture') continue;
    if (e.part === 'bytebeat') {
      const bb = renderBytebeat({ riff: riffSemitones(song), rootHz: plan.bytebeat.rootHz, bpm: song.bpm }, e.duration!, sampleRate);
      const lp = new Biquad('lowpass', 5200, 0.7, sampleRate);
      const hp = new Biquad('highpass', 120, 0.7, sampleRate);
      for (let i = 0; i < bb.length; i++) bb[i] = hp.process(lp.process(bb[i])) * Math.min(1, i / (sampleRate * 0.02), (bb.length - i) / (sampleRate * 0.3));
      normTo(bb, sampleRate, e.text === 'formula returns' ? -27 : -21);
      mixInto(mix, bb, e.time, 0, 1);
      mixInto(wet, bb, e.time, 0, 0.2);
    } else if (e.part === 'image') {
      const im = renderSpectrogramImage(image, e.duration!, sampleRate, plan.image.lowHz, plan.image.highHz, plan.image.rows);
      normTo(im, sampleRate, -25);
      mixInto(mix, im, e.time, -0.3, 0.7);
      mixInto(mix, im, e.time, 0.3, 0.7);
      mixInto(wet, im, e.time, 0, 0.3);
    }
  }

  log('reverb + master');
  const [rl, rr] = reverb(wet.left, wet.right, { roomSize: 0.55, damping: 0.55, sampleRate });
  for (let i = 0; i < mix.left.length; i++) {
    mix.left[i] += rl[i] * 0.9;
    mix.right[i] += rr[i] * 0.9;
  }
  compress(mix.left, mix.right, sampleRate, { thresholdDb: -15, ratio: 2, attack: 0.01, release: 0.2, makeupDb: 1 });
  fadeEdges(mix.left, mix.right, sampleRate, 0.005, 2.5);
  const rep = master(mix.left, mix.right, { sampleRate, targetRmsDb: -12.5, ceilingDb: -1, maxGainDb: 18 });
  return { buffer: mix, master: rep, renderMs: Date.now() - t0, stems };
}

export const SECTION_LEVEL: Record<string, number> = { intro: 0.75, riff: 0.95, verse: 0.72, pre: 0.85, chorus: 1, bridge: 0.55, solo: 0.9, breakdown: 0.9, outro: 1 };

function sectionLevels(song: RockSong, sampleRate: number, n: number): Float32Array {
  const out = new Float32Array(n).fill(1);
  const key = (name: string) => Object.keys(SECTION_LEVEL).find((k) => name.startsWith(k)) ?? 'chorus';
  for (const s of song.sections) {
    const a = Math.floor(s.start * sampleRate);
    const b = Math.min(n, Math.floor(s.end * sampleRate));
    out.fill(SECTION_LEVEL[key(s.name)], a, b);
  }
  // Smooth the steps (≈60 ms) so section changes don't click.
  const c = 1 - Math.exp(-1 / (0.06 * sampleRate));
  let y = out[0];
  for (let i = 0; i < n; i++) {
    y += c * (out[i] - y);
    out[i] = y;
  }
  return out;
}

const GM_DRUM: Record<DrumHit, number> = { kick: 36, snare: 38, hat: 42, hatOpen: 46, crash: 49, ride: 51, tom1: 48, tom2: 45, tom3: 41 };

export function rockToMidi(song: RockSong): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(song.bpm);
  midi.header.name = song.title;
  const tracks = {
    guitar: Object.assign(midi.addTrack(), { name: 'Guitar (Karplus-Strong + WDF amp)', channel: 0 }),
    bass: Object.assign(midi.addTrack(), { name: 'Bass', channel: 1 }),
    lead: Object.assign(midi.addTrack(), { name: 'Lead', channel: 2 }),
    drums: Object.assign(midi.addTrack(), { name: 'Drums (modal)', channel: 9 }),
  };
  for (const e of song.events) {
    if (e.part === 'guitar' && e.kind === 'chord') for (const m of e.midis!) tracks.guitar.addNote({ midi: m, time: e.time, duration: e.palmMute ? 0.08 : e.duration!, velocity: e.velocity! });
    if ((e.part === 'bass' || e.part === 'lead') && e.kind === 'note') tracks[e.part].addNote({ midi: e.midi!, time: e.time, duration: e.duration!, velocity: e.velocity! });
    if (e.part === 'drums' && e.kind === 'hit') tracks.drums.addNote({ midi: GM_DRUM[e.drum!], time: e.time, duration: 0.1, velocity: e.velocity! });
  }
  for (const s of song.sections) midi.header.meta.push({ type: 'marker', text: s.name, ticks: midi.header.secondsToTicks(s.start) });
  return midi.toArray();
}
