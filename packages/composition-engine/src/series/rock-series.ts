/**
 * SONOVA 002–004 as rock songs. Each uses the SONOVA-ROCK band (Karplus–Strong guitars + WDF amp,
 * modal drums) and adds one principle through the render hooks:
 *   ROCK-GROW  — the band's sound grows a resonant body; the grown body chooses the lead's notes
 *   ROCK-HEAL  — live accidents (a dead cable, a wrong note…) are heard from the audio and covered
 *   ROCK-SPACE — the band plays in a venue that the music deforms; the venue sets key, tempo and the
 *                lead's (microtonal) notes, and is heard through image-source reflections
 */
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { Rng, clamp, euclid } from '@sonova/instrument-dna';
import { generateRock, type RockEvent, type RockSong } from '@sonova/music-generator';
import { averageSpectrum, bandEnergyDb, energyAtDb, hzToMidi, spectralPeaks } from '@sonova/source-analyzer';
import { midiToHz, mixInto, plateModes, renderRig, type SpectroImage } from '@sonova/synthesis-engine';
import { renderRock, rockPlan, type RockBand, type RockRenderResult } from '../rock.ts';
import { evolveBody, type GrowChange, type GrowMode } from './grow.ts';
import { imageSources, roomModes, sabineRt60, type Room } from './space.ts';

export const ROCK_SERIES_VERSION = 'sonova-rock-series/1.0.0';
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function monoSum(...xs: Float32Array[]): Float32Array {
  const n = Math.max(...xs.map((x) => x.length));
  const out = new Float32Array(n);
  for (const x of xs) for (let i = 0; i < x.length; i++) out[i] += x[i];
  return out;
}

const fold = (m: number, lo: number, hi: number) => {
  let x = m;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x;
};

/** Resonator bank energy (and optional output) for a block of audio. */
function bank(modes: GrowMode[], input: Float32Array, a: number, z: number, sampleRate: number, outL?: Float32Array, outR?: Float32Array, ring = 0): number[] {
  return modes.map((m) => {
    const r = Math.exp(-1 / (m.decay * sampleRate));
    const c = 2 * r * Math.cos((2 * Math.PI * m.hz) / sampleRate);
    const r2 = r * r;
    const norm = (1 - r2) * 20;
    const pan = m.id % 2 === 0 ? 0.3 : 0.7;
    let y1 = 0;
    let y2 = 0;
    let e = 0;
    const end = Math.min(input.length, z + ring);
    for (let k = a; k < end; k++) {
      const x = k < z ? input[k] : 0;
      const y = c * y1 - r2 * y2 + x * norm;
      y2 = y1;
      y1 = y;
      if (k < z) e += y * y;
      if (outL && outR) {
        outL[k] += y * m.gain * (1 - pan);
        outR[k] += y * m.gain * pan;
      }
    }
    return e / Math.max(1, z - a);
  });
}

// =============================================================================================
// ROCK-GROW
// =============================================================================================
export interface RockGrowResult {
  song: RockSong;
  render: RockRenderResult;
  bodies: Array<{ section: string; start: number; modes: GrowMode[]; energy: number[] }>;
  changes: GrowChange[];
  leadFromBody: number;
}

export function renderRockGrow(band: RockBand, seed: string, image: SpectroImage, log: (m: string) => void = () => undefined): RockGrowResult {
  const base = Math.round(clamp(118 + 22 * band.guitar.interaction_rules.emission + 6 * band.drums.resonance.amount, 110, 168));
  const bpm = Math.round(base * 0.8);
  const song = generateRock(band, seed, 'Grown in the Feedback', { bpm: { value: bpm, reason: `育つ胴の響きが聴こえるよう、元のテンポ ${base} の 0.8 倍 (重く遅く)` } });
  const rng = new Rng(`rock-grow:${seed}`);
  const aspect = clamp(band.drums.resonance.q / 10, 0.3, 0.95);
  const baseHz = midiToHz(band.drums.pitch_range.center);
  let nextId = 0;
  let modes: GrowMode[] = plateModes(aspect, 14, rng.fork('plate')).slice(0, 24).map((m) => ({ id: nextId++, hz: r3(baseHz * m.ratio), decay: r3(0.25 + (band.drums.resonance.ring * 0.15) / m.ratio), gain: r3(m.amp), born: 0 }));
  const bodies: RockGrowResult['bodies'] = [];
  const changes: GrowChange[] = [];
  let leadFromBody = 0;
  const render = renderRock(song, band, image, 44100, log, {
    leadEvents: ({ guitarL, guitarR, bass, sampleRate, song: s }) => {
      const heardBand = monoSum(guitarL, guitarR, bass);
      const out: RockEvent[] = [];
      s.sections.forEach((sec, g) => {
        // The lead of this section takes its pitches from the body grown so far.
        const prev = bodies[g - 1];
        const ranked = prev ? prev.modes.map((m, i) => ({ m, e: prev.energy[i] * m.gain })).sort((p, q) => q.e - p.e).slice(0, 6) : [];
        for (const e of s.events) {
          if (e.part !== 'lead' || e.time < sec.start || e.time >= sec.end) continue;
          if (!ranked.length) {
            out.push(e);
            continue;
          }
          // nearest strong mode (by pitch class) to the written note, kept in the lead's register
          let best = e.midi!;
          let dist = Infinity;
          let from = -1;
          for (const r of ranked) {
            const m = fold(Math.round(hzToMidi(r.m.hz)), e.midi! - 6, e.midi! + 6);
            if (Math.abs(m - e.midi!) < dist) {
              dist = Math.abs(m - e.midi!);
              best = m;
              from = r.m.id;
            }
          }
          if (best !== e.midi) leadFromBody++;
          out.push({ ...e, midi: best, text: `body mode #${from}` });
        }
        // Then the body listens to this section and evolves.
        const a = Math.round(sec.start * sampleRate);
        const z = Math.round(sec.end * sampleRate);
        const energy = bank(modes, heardBand, a, z, sampleRate).map(r3);
        bodies.push({ section: sec.name, start: sec.start, modes: modes.map((m) => ({ ...m })), energy });
        const played = s.events.filter((e) => (e.part === 'guitar' || e.part === 'bass') && e.time >= sec.start && e.time < sec.end && (e.midi ?? 0) > 0).flatMap((e) => (e.midis ?? [e.midi!]).flatMap((m) => [1, 2, 3].map((h) => midiToHz(m) * h)));
        const heard = spectralPeaks(averageSpectrum(heardBand, sampleRate, a, z), 16, 60, 3000);
        const ev = evolveBody(modes, energy, played.length ? played : [baseHz], heard, g, nextId, changes);
        modes = ev.modes;
        nextId = ev.nextId;
      });
      return out;
    },
    beforeReverb: ({ mix, wet, guitarL, guitarR, bass, lead, sampleRate, song: s }) => {
      // The body rings with the band, section by section, as it was at that point of its growth.
      const input = monoSum(guitarL, guitarR, bass, lead);
      const L = new Float32Array(mix.left.length);
      const R = new Float32Array(mix.left.length);
      s.sections.forEach((sec, g) => bank(bodies[g].modes, input, Math.round(sec.start * sampleRate), Math.round(sec.end * sampleRate), sampleRate, L, R, Math.round(2 * sampleRate)));
      let sum = 0;
      for (let i = 0; i < L.length; i++) sum += L[i] * L[i] + R[i] * R[i];
      const g = Math.pow(10, -22 / 20) / (Math.sqrt(sum / (2 * L.length)) || 1);
      for (let i = 0; i < L.length; i++) {
        mix.left[i] += L[i] * g;
        mix.right[i] += R[i] * g;
        wet.left[i] += L[i] * g * 0.3;
        wet.right[i] += R[i] * g * 0.3;
      }
    },
  });
  return { song, render, bodies, changes, leadFromBody };
}

// =============================================================================================
// ROCK-HEAL
// =============================================================================================
export type HealRockPart = 'guitar' | 'bass' | 'lead';
export interface RockFault {
  kind: 'dropout' | 'wrong';
  part: HealRockPart;
  section: string;
  startBar: number;
  bars: number;
  story: string;
}
export interface RockHealEvent {
  bar: number;
  time: number;
  kind: 'fault' | 'detect' | 'repair' | 'recover';
  part: HealRockPart;
  by?: string;
  text: string;
}

export interface RockHealResult {
  song: RockSong;
  faulty: RockSong;
  render: RockRenderResult;
  faults: RockFault[];
  events: RockHealEvent[];
  health: Array<{ bar: number; health: number; missing: HealRockPart[]; wrong: HealRockPart[] }>;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];

export function rockHealSong(band: RockBand, seed: string): { song: RockSong; faulty: RockSong; faults: RockFault[] } {
  const base = Math.round(clamp(118 + 22 * band.guitar.interaction_rules.emission + 6 * band.drums.resonance.amount, 110, 168));
  const bpm = Math.round(base * 1.12);
  const song = generateRock(band, seed, 'Broken Strings, Living Band', { bpm: { value: bpm, reason: `ライブの勢い: 元のテンポ ${base} の 1.12 倍` } });
  const sec = (name: string) => song.sections.find((s) => s.name === name)!;
  const plan: Array<[RockFault['kind'], HealRockPart, string, number, number, string]> = [
    ['dropout', 'guitar', 'verse1', 3, 4, 'ギターのケーブルが抜ける'],
    ['wrong', 'lead', 'chorus1', 2, 3, 'リードが半音ずれて弾く'],
    ['dropout', 'lead', 'solo', 2, 4, 'ソロの途中でリードの弦が切れる'],
    ['dropout', 'bass', 'chorus3', 1, 4, 'ベースのアンプが落ちる'],
    ['wrong', 'lead', 'chorus4', 4, 3, '最後のサビでリードがまた半音ずれる'],
  ];
  const faults: RockFault[] = plan.map(([kind, part, name, off, bars, story]) => ({ kind, part, section: name, startBar: sec(name).startBar + off, bars, story }));
  const barSec = song.barSec;
  const rootPc = song.key.root_pc;
  const inKey = (m: number) => MINOR.includes((((m - rootPc) % 12) + 12) % 12);
  const events: RockEvent[] = [];
  for (const e of song.events) {
    const bar = Math.floor(e.time / barSec + 1e-9);
    const f = faults.find((x) => x.part === e.part && bar >= x.startBar && bar < x.startBar + x.bars);
    if (f?.kind === 'dropout' && (e.kind === 'note' || e.kind === 'chord')) continue;
    if (f?.kind === 'wrong' && e.kind === 'note') {
      const off = inKey(e.midi! + 1) ? e.midi! - 1 : e.midi! + 1;
      events.push({ ...e, midi: off, text: 'fault: wrong note' });
      continue;
    }
    events.push(e);
  }
  return { song, faulty: { ...song, events }, faults };
}

export function renderRockHeal(band: RockBand, seed: string, image: SpectroImage, repair: boolean, log: (m: string) => void = () => undefined): RockHealResult {
  const { song, faulty, faults } = rockHealSong(band, seed);
  const plan = rockPlan(song, band);
  const barSec = song.barSec;
  const bars = song.sections.reduce((s, x) => s + x.bars, 0);
  const healEvents: RockHealEvent[] = [];
  const health: RockHealResult['health'] = [];
  for (const f of faults) healEvents.push({ bar: f.startBar, time: r3(f.startBar * barSec), kind: 'fault', part: f.part, text: `${f.story} (${f.bars} 小節、故障の注入)` });
  const render = renderRock(faulty, band, image, 44100, log, {
    beforeReverb: ({ mix, wet, guitarL, guitarR, bass, lead, sampleRate }) => {
      // The listener is a monitor engineer: it hears each amp's own channel (the faulty band as it
      // actually sounded), not the full mix. In a distorted mix the semitone test on the sum gave
      // false alarms (guitar harmonics sit next to lead notes), so the parts are judged one by one.
      const guitar = monoSum(guitarL, guitarR);
      const score = song.events;
      const notesIn = (part: HealRockPart, b: number) => score.filter((e) => e.part === part && (e.kind === 'note' || e.kind === 'chord') && e.time >= b * barSec && e.time < (b + 1) * barSec);
      const base: Record<HealRockPart, number[]> = { guitar: [], bass: [], lead: [] };
      const median = (xs: number[]) => (xs.length ? [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] : NaN);
      const rmsDb = (x: Float32Array, a: number, z: number) => {
        let s2 = 0;
        for (let i = a; i < z; i++) s2 += x[i] * x[i];
        return 10 * Math.log10(s2 / Math.max(1, z - a) + 1e-12);
      };
      const active = new Map<HealRockPart, { by: string; kind: 'cover' | 'reharm'; root?: number }>();
      const repairGuitar: RockEvent[] = [];
      const repairBass: RockEvent[] = [];
      let rid = 1e6;
      for (let b = 0; b < bars; b++) {
        const a = Math.round((b * barSec + 0.05) * sampleRate);
        const z = Math.min(guitar.length, Math.round((b + 1) * barSec * sampleRate));
        // presence of each part: its channel's level in the bar, only where the score says it plays
        const pres: Partial<Record<HealRockPart, number>> = {};
        if (notesIn('guitar', b).length) pres.guitar = rmsDb(guitar, a, z);
        if (notesIn('bass', b).length) pres.bass = rmsDb(bass, a, z);
        const ln = notesIn('lead', b);
        if (ln.length) pres.lead = rmsDb(lead, a, z);
        // wrong notes of the lead: on the lead channel, semitone neighbours louder than the written
        // pitches. Neighbours that are themselves written in this bar don't count.
        let leadWrong = -60;
        let wrongPc = 0;
        if (ln.length) {
          const spec = averageSpectrum(lead, sampleRate, a, z, 32768);
          const written = new Set(ln.map((e) => e.midi!));
          const diffs: number[] = [];
          const votes = new Map<number, number>();
          for (const n of ln) {
            const w = energyAtDb(spec, [midiToHz(n.midi!)], 25);
            for (const d of [-1, 1]) {
              if (written.has(n.midi! + d)) continue;
              const nb = energyAtDb(spec, [midiToHz(n.midi! + d)], 25);
              diffs.push(nb - w);
              if (nb > w) {
                const pc = (((n.midi! + d) % 12) + 12) % 12;
                votes.set(pc, (votes.get(pc) ?? 0) + 1);
              }
            }
          }
          // each note has two neighbours and at most one is "the" wrong one, so take the upper half
          diffs.sort((p, q) => q - p);
          if (diffs.length) leadWrong = median(diffs.slice(0, Math.max(1, Math.ceil(diffs.length / 2))));
          wrongPc = [...votes.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]?.[0] ?? 0;
        }
        const missing: HealRockPart[] = [];
        for (const p of ['guitar', 'bass', 'lead'] as HealRockPart[]) {
          if (pres[p] === undefined) continue;
          const m = median(base[p]);
          if (base[p].length >= 2 && pres[p]! < m - 12) missing.push(p);
          else base[p].push(pres[p]!);
        }
        const wrong: HealRockPart[] = ln.length && !missing.includes('lead') && leadWrong > 3 ? ['lead'] : [];
        const covered = (p: HealRockPart) => active.get(p)?.kind === 'cover';
        const reharm = [...active.values()].some((x) => x.kind === 'reharm');
        health.push({ bar: b, health: r3(1 - missing.filter((p) => !(repair && covered(p))).length / 3 - (wrong.length && !(repair && reharm) ? 0.4 : 0)), missing, wrong });
        if (!repair) continue;
        // ---- decide for the next bar ----
        const next = b + 1;
        const t1 = next * barSec;
        for (const p of ['guitar', 'bass', 'lead'] as HealRockPart[]) {
          const isMissing = missing.includes(p);
          const cur = active.get(p);
          if (isMissing && !cur) {
            const by = p === 'guitar' ? 'lead' : p === 'bass' ? 'guitar' : 'guitar';
            active.set(p, { by, kind: 'cover' });
            healEvents.push({ bar: b, time: r3(b * barSec), kind: 'detect', part: p, text: `${p} が聴こえない (基準より ${(pres[p]! - median(base[p])).toFixed(1)} dB)` });
            healEvents.push({ bar: next, time: r3(t1), kind: 'repair', part: p, by, text: p === 'guitar' ? 'リードギターがリフとコードを弾いて穴を埋める' : p === 'bass' ? 'ギターがベースラインを低い弦で弾く' : 'リズムギターがリードのメロディを引き受ける' });
          } else if (!isMissing && cur?.kind === 'cover' && pres[p] !== undefined) {
            active.delete(p);
            healEvents.push({ bar: b, time: r3(b * barSec), kind: 'recover', part: p, by: cur.by, text: `${p} が戻ったのを聴いて ${cur.by} は元の役に戻る` });
          }
        }
        const rh = active.get('lead');
        if (wrong.length && !rh) {
          // re-harmonise: the bass moves to a root under which the wrong lead note is a chord tone
          const root = [0, 3, 4, 7, 8, 9].map((iv) => (((wrongPc - iv) % 12) + 12) % 12).find((r) => MINOR.includes((((r - song.key.root_pc) % 12) + 12) % 12)) ?? wrongPc;
          active.set('lead', { by: 'bass', kind: 'reharm', root });
          const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          healEvents.push({ bar: b, time: r3(b * barSec), kind: 'detect', part: 'lead', text: `リードの半音隣りが ${leadWrong.toFixed(1)} dB 強い → ${NOTE[wrongPc]} がずれている` });
          healEvents.push({ bar: next, time: r3(t1), kind: 'repair', part: 'lead', by: 'bass', text: `ベースが根音を ${NOTE[root]} に変え、${NOTE[wrongPc]} を和音の音にする` });
        } else if (!wrong.length && rh?.kind === 'reharm' && ln.length) {
          active.delete('lead');
          healEvents.push({ bar: b, time: r3(b * barSec), kind: 'recover', part: 'lead', by: 'bass', text: 'ずれが消えたのを聴いてベースは元の根音に戻る' });
        }
        // ---- schedule the repair notes of the next bar ----
        if (next >= bars) continue;
        for (const [p, r] of active) {
          if (r.kind === 'cover' && p === 'guitar') for (const e of notesIn('guitar', next)) repairGuitar.push({ ...e, id: rid++, part: 'lead', kind: 'note', midi: e.midis ? e.midis[0] + 12 : e.midi! + 12, duration: Math.min(e.duration ?? 0.2, barSec / 2) });
          if (r.kind === 'cover' && p === 'bass') for (const e of notesIn('bass', next)) repairGuitar.push({ ...e, id: rid++, part: 'lead', kind: 'note', midi: fold(e.midi! + 12, 36, 52) });
          if (r.kind === 'cover' && p === 'lead') for (const e of notesIn('lead', next)) repairGuitar.push({ ...e, id: rid++, part: 'lead', kind: 'note', midi: fold(e.midi! - 12, 48, 64) });
          if (r.kind === 'reharm' && r.root !== undefined) repairBass.push({ id: rid++, time: r3(t1), bar: next, slot: 0, part: 'bass', kind: 'note', midi: 24 + r.root + (r.root < 4 ? 12 : 0), velocity: 0.9, duration: barSec * 0.95, depth: 1 });
        }
      }
      if (!repair) return;
      // Render the covering players with their own rigs and add them to the mix.
      const secs = mix.left.length / sampleRate;
      const toRig = (evs: RockEvent[]) => evs.sort((x, y) => x.time - y.time).flatMap((e) => [
        { time: e.time, type: 'pluck' as const, freqs: [midiToHz(e.midi!)], velocity: e.velocity ?? 0.85, mute: false, pickPosition: 0.15, brightness: 0.8, t60: 2.5, damping: 0.25 },
        { time: e.time + (e.duration ?? 0.3), type: 'damp' as const },
      ]);
      const cover = renderRig(toRig(repairGuitar), secs, sampleRate, plan.guitarAmp, `${seed}:repair-guitar`, 1);
      const re = renderRig(toRig(repairBass), secs, sampleRate, plan.bassAmp, `${seed}:repair-bass`, 1);
      const norm = (x: Float32Array, db: number) => {
        let s2 = 0;
        let n = 0;
        for (const v of x) if (Math.abs(v) > 1e-4) {
          s2 += v * v;
          n++;
        }
        const g = n ? Math.pow(10, db / 20) / Math.sqrt(s2 / n) : 0;
        for (let i = 0; i < x.length; i++) x[i] *= g;
      };
      norm(cover, -19);
      norm(re, -18);
      mixInto(mix, cover, 0, 0.45, 1);
      mixInto(wet, cover, 0, 0.3, 0.12);
      mixInto(mix, re, 0, 0, 1);
    },
  });
  healEvents.sort((p, q) => p.time - q.time || ['fault', 'detect', 'repair', 'recover'].indexOf(p.kind) - ['fault', 'detect', 'repair', 'recover'].indexOf(q.kind));
  return { song, faulty, render, faults, events: healEvents, health };
}

// =============================================================================================
// ROCK-SPACE
// =============================================================================================
export interface RockSpaceResult {
  song: RockSong;
  render: RockRenderResult;
  rooms: Array<{ section: string; start: number; room: Room; rt60: number; lowestModeHz: number; heard: { low: number; mid: number; high: number } }>;
  changes: Array<{ section: string; param: string; from: number; to: number; cause: string }>;
  microtonalLead: number;
  drummer: RoomDrummerSection[];
}

type Vec = [number, number, number];
const C = 343;

// ---- The room drummer ------------------------------------------------------------------------
// The drums of ROCK-SPACE are played by the venue of each section. Ideas (no code copied):
//  · polymeter loops whose length is not the bar (Grids' euclidean mode, pichenettes/eurorack, GPL-3 — idea only)
//  · Rhythmicon (Theremin & Cowell 1931): pulse rate ∝ frequency → cymbal tuplets ∝ the room's axial modes
//  · a looping shift register that slips with a probability (Music Thing Turing Machine, CC-BY-SA — idea only);
//    here the slip probability is how much the room has just changed
//  · fills = the room's own early reflections (image-source method, Allen & Berkley 1979) slowed down
export interface RoomDrummerSection {
  section: string;
  kickCycle: number;
  kickPulses: number;
  hatTuplet: number;
  rideTuplet: number;
  slip: number;
  register: string;
  displaced: number;
  echoFill: { hits: number; stretch: number } | null;
  reasons: string[];
}

const ROOM_DRUMMER_KEEP = new Set(['intro', 'bridge']);

export function roomDrummer(song: RockSong, rooms: Array<{ section: string; room: Room }>, seed: string): { events: RockEvent[]; sections: RoomDrummerSection[] } {
  const barSec = song.barSec;
  const slot = barSec / 16;
  const original = song.events.filter((e) => e.part === 'drums');
  const out: RockEvent[] = [];
  const sections: RoomDrummerSection[] = [];
  let id = 2e6;
  const hit = (time: number, drum: RockEvent['drum'], velocity: number, text: string): RockEvent => {
    const bar = Math.floor(time / barSec + 1e-9);
    const e: RockEvent = { id: id++, time: Math.round(time * 1e6) / 1e6, bar, slot: Math.round((time - bar * barSec) / slot), part: 'drums', kind: 'hit', drum, velocity: r3(clamp(velocity, 0.05, 1)), depth: 1, text };
    out.push(e);
    return e;
  };
  song.sections.forEach((sec, g) => {
    const inSec = original.filter((e) => e.time >= sec.start - 1e-6 && e.time < sec.end - 1e-6);
    if (ROOM_DRUMMER_KEEP.has(sec.name) || g === 0) {
      out.push(...inSec);
      return;
    }
    const room = rooms[g].room;
    const prev = rooms[Math.max(0, g - 1)].room;
    const [Lx, Ly, Lz] = room.L;
    // markers, crashes (one of them sets off the amp), the kicks the bass and guitar lock to, and bars the arrangement leaves empty
    const kept = inSec.filter((e) => e.kind !== 'hit' || e.drum === 'crash' || (e.drum === 'kick' && (e.slot === 0 || e.cause?.rule === 'entrain')));
    out.push(...kept);
    const busy = new Set(inSec.filter((e) => e.kind === 'hit').map((e) => e.bar));
    const chorus = sec.name.startsWith('chorus') || sec.name === 'solo';
    const half = sec.name.startsWith('verse') || sec.name === 'breakdown';
    // polymeter kick: the higher the ceiling, the longer the loop (1.5 sixteenths per metre)
    let kickCycle = clamp(Math.round(1.5 * Lz), 5, 17);
    if (kickCycle === 8 || kickCycle === 12 || kickCycle === 16) kickCycle += 1;
    const kickPulses = Math.max(2, Math.round(kickCycle * 0.4));
    const kickLoop = euclid(kickCycle, kickPulses, g);
    // Rhythmicon cymbals: pulses per bar ∝ the axial modes c/2L
    const hatTuplet = clamp(Math.round((4 * Lx) / Lz), 3, 13);
    const rideTuplet = clamp(Math.round((2 * Lx) / Ly), 3, 11);
    // Turing-machine register; the loop slips as much as the room just moved
    const moved = (Math.abs(Lx / prev.L[0] - 1) + Math.abs(Ly / prev.L[1] - 1) + Math.abs(Lz / prev.L[2] - 1)) / 3 + Math.abs(room.absorption - prev.absorption);
    const slip = r3(clamp(moved * 3, 0.05, 0.6));
    const rng = new Rng(`room-drummer:${seed}:${sec.name}`);
    let reg = Math.floor(rng.next() * 65536);
    let displaced = 0;
    // fills: the drum riser's early reflections to the listener, slowed down to two beats
    const src: Vec = [Lx * 0.5, Ly * 0.92, 1.1];
    const ear: Vec = [Lx * 0.5, Ly * 0.3, 1.6];
    const echoes = imageSources(room, src, 2)
      .map((im) => {
        const d = Math.hypot(im.pos[0] - ear[0], im.pos[1] - ear[1], im.pos[2] - ear[2]);
        const axis = im.pos[0] !== src[0] ? 0 : im.pos[1] !== src[1] ? 1 : im.pos[2] !== src[2] ? 2 : -1;
        return { t: d / C, gain: Math.pow(Math.sqrt(1 - room.absorption), im.order) / Math.max(1, d), order: im.order, axis };
      })
      .sort((a, b) => a.t - b.t);
    const merged: typeof echoes = [];
    for (const e of echoes) {
      const last = merged[merged.length - 1];
      if (last && e.t - last.t < 0.004) last.gain += e.gain;
      else merged.push({ ...e });
    }
    const fillEchoes = merged.slice(0, 11);
    const span = fillEchoes[fillEchoes.length - 1].t - fillEchoes[0].t || 1;
    const stretch = r3((barSec / 2) / span);
    const gMax = Math.max(...fillEchoes.map((e) => e.gain));
    let echoFill: RoomDrummerSection['echoFill'] = null;
    for (let b = sec.startBar; b < sec.startBar + sec.bars; b++) {
      if (!busy.has(b)) continue;
      const t0 = sec.start + (b - sec.startBar) * barSec;
      const lastBar = b === sec.startBar + sec.bars - 1 && sec.bars >= 4;
      // register step: the bit falling off the end comes back, flipped with probability `slip`
      const out1 = reg & 1;
      reg = (reg >> 1) | ((rng.next() < slip ? out1 ^ 1 : out1) << 15);
      for (let k = 0; k < 16; k++) {
        if (lastBar && k >= 8) break;
        const step = (b - sec.startBar) * 16 + k;
        const nearKept = kept.some((e) => e.drum === 'kick' && e.bar === b && Math.abs(e.slot - k) <= 1);
        if (k !== 0 && !nearKept && kickLoop[step % kickCycle]) hit(t0 + k * slot, 'kick', step % kickCycle === 0 ? 0.92 : 0.78, `polymeter kick ${kickPulses}/${kickCycle}`);
      }
      // snare: backbeat anchor, displaced by the register
      const backs = half ? [8] : [4, 12];
      for (const bs of backs) {
        if (lastBar && bs >= 8) continue;
        const bit = (reg >> bs) & 3;
        const s2 = bit === 3 ? bs + 1 : bit === 2 && bs > 4 ? bs - 1 : bs;
        if (s2 !== bs) displaced++;
        hit(t0 + s2 * slot, 'snare', 0.9, s2 === bs ? 'backbeat' : `backbeat displaced ${s2 - bs > 0 ? '+' : ''}${s2 - bs}/16 (register)`);
      }
      const ghost = (reg >> 4) & 15;
      if (ghost % 2 === 1 && !(lastBar && ghost >= 8)) hit(t0 + ghost * slot, 'snare', 0.22, 'ghost (register)');
      // Rhythmicon cymbals: true tuplets, off the 16th grid
      const tup = chorus ? rideTuplet : hatTuplet;
      const cym = chorus ? 'ride' : 'hat';
      const lim = lastBar ? 0.5 : 1;
      for (let k = 0; k < tup; k++) {
        if (k / tup >= lim) break;
        hit(t0 + (k * barSec) / tup, cym, (k === 0 ? 0.6 : 0.38) + 0.08 * Math.cos((2 * Math.PI * k * 2) / tup), `rhythmicon ${tup}:${cym === 'ride' ? `2·Lx/Ly` : `4·Lx/Lz`}`);
      }
      if (chorus) for (let k = 0; k < 4; k++) if (!(lastBar && k >= 2)) hit(t0 + k * 4 * slot, 'hat', 0.3, 'pulse');
      if (lastBar) {
        const toms = ['tom1', 'tom2', 'tom3'] as const;
        for (const e of fillEchoes) {
          const drum = e.order === 0 ? 'snare' : e.order === 1 ? toms[e.axis] : e.axis === 2 ? 'kick' : 'snare';
          hit(t0 + barSec / 2 + (e.t - fillEchoes[0].t) * stretch * 0.97, drum, 0.45 + 0.5 * Math.sqrt(e.gain / gMax), `echo fill (order ${e.order}${e.axis >= 0 ? `, ${'xyz'[e.axis]} wall` : ''})`);
        }
        echoFill = { hits: fillEchoes.length, stretch };
      }
    }
    sections.push({
      section: sec.name,
      kickCycle,
      kickPulses,
      hatTuplet,
      rideTuplet,
      slip,
      register: reg.toString(2).padStart(16, '0'),
      displaced,
      echoFill,
      reasons: [
        `キックは 16分 ${kickCycle} 個の周期に ${kickPulses} 打 (天井の高さ ${Lz.toFixed(2)} m × 1.5)、小節線をまたいでずれていく`,
        `${chorus ? `ライドは 1 小節 ${rideTuplet} 連 (幅と奥行きのモード比 2·Lx/Ly)` : `ハイハットは 1 小節 ${hatTuplet} 連 (幅と高さのモード比 4·Lx/Lz)`}`,
        `スネアのずれの確率 ${slip} (部屋が直前にどれだけ変形したか)`,
        echoFill ? `フィル = 会場の初期反射 ${fillEchoes.length} 本を ${stretch.toFixed(0)} 倍に引き伸ばしたもの` : 'フィルなし',
      ],
    });
  });
  return { events: out.sort((a, b) => a.time - b.time || a.id - b.id), sections };
}

export function renderRockSpace(band: RockBand, seed: string, image: SpectroImage, log: (m: string) => void = () => undefined): RockSpaceResult {
  const w = band.drums;
  let room: Room = { L: [r3(5 + w.resonance.q * 0.6), r3(4 + w.resonance.amount * 4), r3(2.6 + w.decay * 0.8)], absorption: r3(clamp(0.12 + w.noise.amount * 0.4, 0.08, 0.6)) };
  const lowest = roomModes(room)[0];
  const keyPc = ((Math.round(hzToMidi(lowest.hz)) % 12) + 12) % 12;
  // Tempo: a 16th note lasts two round trips across the room's width.
  const sixteenth = (4 * room.L[0]) / C;
  const bpm = Math.round(clamp(60 / (sixteenth * 4), 100, 170));
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const song = generateRock(band, seed, 'The Room Is the Amp', {
    bpm: { value: bpm, reason: `16分音符 = 会場の幅 ${room.L[0]} m を音が2往復する時間 (${(sixteenth * 1000).toFixed(0)} ms)` },
    rootPc: { value: keyPc, reason: `会場の最低の共鳴モード ${lowest.hz.toFixed(1)} Hz に最も近い音 ${NOTE[keyPc]}` },
  });
  const rooms: RockSpaceResult['rooms'] = [];
  const changes: RockSpaceResult['changes'] = [];
  let microtonalLead = 0;
  let drummer: RoomDrummerSection[] = [];
  let finalSong = song;
  const render = renderRock(song, band, image, 44100, log, {
    drumEvents: ({ song: s }) => {
      const d = roomDrummer(s, rooms, seed);
      drummer = d.sections;
      finalSong = { ...s, events: [...s.events.filter((e) => e.part !== 'drums'), ...d.events].sort((a, b) => a.time - b.time || a.id - b.id) };
      return d.events;
    },
    leadEvents: ({ guitarL, guitarR, bass, sampleRate, song: s }) => {
      const heardBand = monoSum(guitarL, guitarR, bass);
      const out: RockEvent[] = [];
      const prevShares: Array<{ low: number; mid: number; high: number }> = [];
      const prevRms: number[] = [];
      for (const sec of s.sections) {
        // space → sound: the lead plays the room's modes nearest to its written notes (exact Hz)
        const modes = roomModes(room, 2000, 60);
        for (const e of s.events) {
          if (e.part !== 'lead' || e.time < sec.start || e.time >= sec.end) continue;
          const target = midiToHz(e.midi!);
          let best = target;
          let bestC = Infinity;
          for (const m of modes) {
            for (let k = -3; k <= 4; k++) {
              const f = m.hz * Math.pow(2, k);
              const c = Math.abs(1200 * Math.log2(f / target));
              if (c < bestC) {
                bestC = c;
                best = f;
              }
            }
          }
          if (bestC <= 70) {
            microtonalLead++;
            out.push({ ...e, midi: r3(hzToMidi(best)), text: `room mode ${best.toFixed(1)}Hz` });
          } else out.push(e);
        }
        // sound → space: the venue listens to this section
        const a = Math.round(sec.start * sampleRate);
        const z = Math.round(sec.end * sampleRate);
        const spec = averageSpectrum(heardBand, sampleRate, a, z);
        const eL = 10 ** (bandEnergyDb(spec, 20, 200) / 10);
        const eM = 10 ** (bandEnergyDb(spec, 200, 2000) / 10);
        const eH = 10 ** (bandEnergyDb(spec, 2000, 8000) / 10);
        const sum = eL + eM + eH || 1;
        const heard = { low: r3(eL / sum), mid: r3(eM / sum), high: r3(eH / sum) };
        rooms.push({ section: sec.name, start: sec.start, room: { L: [...room.L] as Vec, absorption: room.absorption }, rt60: r3(sabineRt60(room)), lowestModeHz: roomModes(room)[0].hz, heard });
        const mean = (k: 'low' | 'mid' | 'high') => (prevShares.length ? prevShares.reduce((s2, h) => s2 + h[k], 0) / prevShares.length : heard[k]);
        const f = (x: number) => clamp(1 + x, 0.8, 1.25);
        const shaped: Vec = [room.L[0] * f(2 * (heard.low - mean('low'))), room.L[1] * f(2.5 * (heard.mid - mean('mid'))), room.L[2] * f(4 * (heard.high - mean('high')))];
        const rms = 10 * Math.log10(sum);
        const meanRms = prevRms.length ? prevRms.reduce((x, y) => x + y, 0) / prevRms.length : rms;
        prevShares.push(heard);
        prevRms.push(rms);
        const V = room.L[0] * room.L[1] * room.L[2];
        const Vt = V * (1 + 0.25 * clamp((rms - meanRms) / 6, -1, 1));
        const k = Math.cbrt(Vt / (shaped[0] * shaped[1] * shaped[2]));
        const next: Room = { L: [r3(clamp(shaped[0] * k, 3, 45)), r3(clamp(shaped[1] * k, 3, 45)), r3(clamp(shaped[2] * k, 2.4, 20))], absorption: room.absorption };
        const bright = heard.high - mean('high');
        next.absorption = r3(clamp(room.absorption * (1 - 2 * bright), 0.06, 0.7));
        const cause = `${sec.name} の 低/中/高 = ${(heard.low * 100).toFixed(0)}/${(heard.mid * 100).toFixed(0)}/${(heard.high * 100).toFixed(0)}%、音量 ${(rms - meanRms).toFixed(1)} dB (平均比)`;
        (['Lx', 'Ly', 'Lz'] as const).forEach((p, i) => Math.abs(next.L[i] - room.L[i]) > 1e-3 && changes.push({ section: sec.name, param: p, from: room.L[i], to: next.L[i], cause }));
        if (Math.abs(next.absorption - room.absorption) > 1e-3) changes.push({ section: sec.name, param: 'absorption', from: room.absorption, to: next.absorption, cause });
        room = next;
      }
      return out;
    },
    beforeReverb: ({ mix, wet, guitarL, guitarR, bass, lead, drums, drumGain, sampleRate, song: s }) => {
      // The band is heard *in* the venue of each section: image sources (2nd order) to two ears.
      const drumsMono = new Float32Array(drums.left.length);
      for (let i = 0; i < drumsMono.length; i++) drumsMono[i] = ((drums.left[i] + drums.right[i]) / 2) * drumGain;
      const outL = new Float32Array(mix.left.length);
      const outR = new Float32Array(mix.left.length);
      const fadeN = Math.round(0.05 * sampleRate);
      s.sections.forEach((sec, g) => {
        const rm = rooms[g].room;
        const [lx, ly] = rm.L;
        const ear: Vec[] = [[lx * 0.5 - 0.09, ly * 0.3, 1.6], [lx * 0.5 + 0.09, ly * 0.3, 1.6]];
        const srcs: Array<[Float32Array, Vec]> = [
          [guitarL, [lx * 0.2, ly * 0.8, 1.2]],
          [guitarR, [lx * 0.8, ly * 0.8, 1.2]],
          [bass, [lx * 0.62, ly * 0.85, 1.0]],
          [lead, [lx * 0.42, ly * 0.75, 1.6]],
          [drumsMono, [lx * 0.5, ly * 0.92, 1.1]],
        ];
        const beta = Math.sqrt(1 - rm.absorption);
        const a = Math.max(0, Math.round(sec.start * sampleRate) - fadeN);
        const z = Math.min(mix.left.length, Math.round(sec.end * sampleRate) + fadeN);
        for (const [x, pos] of srcs) {
          for (const im of imageSources(rm, pos, 2)) {
            for (let e = 0; e < 2; e++) {
              const d = Math.hypot(im.pos[0] - ear[e][0], im.pos[1] - ear[e][1], im.pos[2] - ear[e][2]);
              const gain = (Math.pow(beta, im.order) / Math.max(1, d)) * (im.order === 0 ? 1.2 : 1);
              const delay = Math.round((d / C) * sampleRate);
              const target = e === 0 ? outL : outR;
              for (let i = a; i < z && i + delay < target.length; i++) {
                const env = Math.min(1, (i - a) / fadeN, (z - i) / fadeN);
                target[i + delay] += x[i] * gain * env;
              }
            }
          }
        }
        // the late tail grows with the venue's reverberation time
        const tail = clamp(rooms[g].rt60 / 2, 0.08, 0.8);
        for (let i = Math.round(sec.start * sampleRate); i < Math.min(wet.left.length, Math.round(sec.end * sampleRate)); i++) {
          const v = (guitarL[i] + guitarR[i] + bass[i] + lead[i] + drumsMono[i]) * 0.25 * tail;
          wet.left[i] += v;
          wet.right[i] += v;
        }
      });
      let pIn = 0;
      let pOut = 0;
      for (let i = 0; i < outL.length; i++) {
        pIn += mix.left[i] * mix.left[i] + mix.right[i] * mix.right[i];
        pOut += outL[i] * outL[i] + outR[i] * outR[i];
      }
      const g = Math.sqrt(pIn / (pOut || 1));
      // close mics (25 %) + the venue (75 %)
      for (let i = 0; i < outL.length; i++) {
        mix.left[i] = mix.left[i] * 0.25 + outL[i] * g * 0.75;
        mix.right[i] = mix.right[i] * 0.25 + outR[i] * g * 0.75;
      }
    },
  });
  return { song: finalSong, render, rooms, changes, microtonalLead, drummer };
}

export type { InstrumentDNA };
