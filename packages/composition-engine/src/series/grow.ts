/**
 * SONOVA 002 — 音が楽器を育てる (the sound grows the instrument)
 *
 * A resonant body (modes of a plate whose aspect comes from the tower image) is played by the bark
 * (melody) and sunset (drone) instruments and struck on the beat. After every phrase the body
 * *listens* to what it just did and evolves:
 *   grow     — the most excited modes ring longer and louder
 *   tune     — excited modes drift toward the pitches that were played (Hebbian-like attraction)
 *   starve   — the least excited modes decay faster and fade
 *   reborn   — a starved mode dies and is re-born at the strongest heard spectral peak it lacks
 * The next melody is taken from the body's strongest modes, so instrument and music co-evolve.
 * Every change is logged with the measurement that caused it.
 */
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { Rng, clamp, euclid } from '@sonova/instrument-dna';
import { averageSpectrum, hzToMidi, spectralPeaks } from '@sonova/source-analyzer';
import { createBus, fadeEdges, master, midiToHz, mixInto, plateModes, renderVoice, reverb, type MasterReport, type StereoBuffer } from '@sonova/synthesis-engine';

export const GROW_VERSION = 'sonova-grow/1.0.0';

export interface GrowMode {
  id: number;
  hz: number;
  decay: number;
  gain: number;
  born: number;
}

export interface GrowChange {
  gen: number;
  mode: number;
  kind: 'grow' | 'tune' | 'starve' | 'reborn';
  from: string;
  to: string;
  cause: string;
}

export interface GrowGeneration {
  gen: number;
  start: number;
  modes: GrowMode[];
  melody: Array<{ time: number; midi: number; from_mode: number | null; curiosity: boolean }>;
  drone: { midi: number; from_mode: number | null };
  energy: number[];
  metrics: { harmonicity: number; meanDecay: number; centroidHz: number; lowestStrongHz: number; distinctPitchClasses: number };
}

export interface GrowResult {
  engine_version: string;
  seed: string;
  bpm: number;
  phraseSec: number;
  durationSec: number;
  generations: GrowGeneration[];
  changes: GrowChange[];
  buffer: StereoBuffer;
  master: MasterReport;
  derivations: Array<{ choice: string; value: string | number; from: string; rule: string }>;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const PENTA = [0, 3, 5, 7, 10];

function harmonicity(modes: GrowMode[], energy: number[]): { h: number; f0: number } {
  const strong = modes.map((m, i) => ({ m, e: energy[i] * m.gain })).sort((a, b) => b.e - a.e).slice(0, 8).map((x) => x.m.hz).sort((a, b) => a - b);
  const f0 = strong[0];
  const dev = strong.slice(1).map((f) => {
    const r = f / f0;
    return Math.abs(r - Math.round(r));
  });
  return { h: r4(1 - (dev.reduce((a, b) => a + b, 0) / Math.max(1, dev.length)) * 2), f0: r4(f0) };
}

export function renderGrow(band: { player: InstrumentDNA; drone: InstrumentDNA; body: InstrumentDNA }, seed: string, generationsCount = 16, sampleRate = 44100): GrowResult {
  const rng = new Rng(`grow:${seed}:${band.body.dna_hash}`);
  const derivations: GrowResult['derivations'] = [];
  const derive = (choice: string, value: string | number, from: string, rule: string) => derivations.push({ choice, value, from, rule });
  const bpm = Math.round(clamp(84 + band.player.interaction_rules.emission * 14, 80, 110));
  derive('bpm', bpm, `${band.player.name}.interaction_rules.emission`, '奏者の働きかけの強さ → テンポ');
  const phraseSec = (60 / bpm) * 8; // two bars
  const slot = phraseSec / 32;
  const aspect = clamp(band.body.resonance.q / 10, 0.3, 0.95);
  const baseHz = midiToHz(band.body.pitch_range.center);
  derive('body.plate_aspect', r4(aspect), `${band.body.name}.resonance.q`, '外壁の格子の規則性 → 板の縦横比 → 最初のモードの並び');
  derive('body.base_hz', r4(baseHz), `${band.body.name}.pitch_range.center`, '素材の音域の中心 → 板の最低モード');
  let nextId = 0;
  let modes: GrowMode[] = plateModes(aspect, 14, rng.fork('plate'))
    .slice(0, 24)
    .map((m) => ({ id: nextId++, hz: r4(baseHz * m.ratio), decay: r4(0.25 + band.body.resonance.ring * 0.15 / m.ratio), gain: r4(m.amp), born: 0 }));

  const total = generationsCount * phraseSec + 5;
  const bus = createBus(total, sampleRate);
  const wet = createBus(total, sampleRate);
  const generations: GrowGeneration[] = [];
  const changes: GrowChange[] = [];
  const rootPc = band.player.pitch_range.root_pc;

  const fold = (midi: number, lo: number, hi: number) => {
    let m = midi;
    while (m < lo) m += 12;
    while (m > hi) m -= 12;
    return m;
  };

  for (let g = 0; g < generationsCount; g++) {
    const t0 = g * phraseSec;
    const n0 = Math.round(t0 * sampleRate);
    const n1 = Math.round((t0 + phraseSec) * sampleRate);
    const prevEnergy = generations[g - 1]?.energy;
    const ranked = prevEnergy ? modes.map((m, i) => ({ m, s: prevEnergy[i] * m.gain })).sort((a, b) => b.s - a.s) : [];

    // ---- Melody (player) from the body's strongest modes; first phrase from the player's own scale.
    const pattern = euclid(16, Math.max(3, band.player.rhythm.pulses + 1), band.player.rhythm.rotation);
    const melody: GrowGeneration['melody'] = [];
    // Habituation: the less varied the last phrase, the more curious the player becomes.
    const lastPcs = generations[g - 1]?.melody.map((n) => n.midi % 12) ?? [];
    const variety = lastPcs.length ? new Set(lastPcs).size / Math.min(5, lastPcs.length) : 1;
    const curiousP = clamp(0.12 + (1 - variety) * 0.5, 0.12, 0.6);
    const used = new Map<number, number>();
    for (let s = 0; s < 32; s++) {
      if (!pattern[s % 16]) continue;
      let midi: number;
      let from: number | null = null;
      if (!prevEnergy) midi = 60 + rootPc + PENTA[rng.int(0, 4)] - 12 * rng.int(0, 1);
      else {
        // Strong modes are likely, but a mode loses appeal each time it is used in this phrase.
        const weights = ranked.slice(0, 8).map((r, k) => Math.pow(0.7, k) / (1 + 1.5 * (used.get(r.m.id) ?? 0)));
        let u = rng.next() * weights.reduce((a2, b2) => a2 + b2, 0);
        let k = 0;
        while (k < weights.length - 1 && (u -= weights[k]) > 0) k++;
        const pick = ranked[k].m;
        used.set(pick.id, (used.get(pick.id) ?? 0) + 1);
        from = pick.id;
        midi = Math.round(hzToMidi(pick.hz));
      }
      const curiosity = !!prevEnergy && rng.next() < curiousP;
      if (curiosity) midi += rng.pick([7, -5, 5, 3, -2]);
      midi = fold(midi, band.player.pitch_range.low, band.player.pitch_range.high);
      melody.push({ time: r4(t0 + s * slot), midi, from_mode: from, curiosity });
    }
    const droneFrom = ranked[0]?.m ?? null;
    const droneMidi = fold(droneFrom ? Math.round(hzToMidi(droneFrom.hz)) : 48 + rootPc, band.drone.pitch_range.low, band.drone.pitch_range.high);

    // ---- Render the players (stereo for the mix, mono as the body's excitation).
    const players = new Float32Array(n1 - n0 + sampleRate * 4);
    const addMono = (v: Float32Array, at: number, gain: number) => {
      const s = Math.round((at - t0) * sampleRate);
      for (let i = 0; i < v.length && s + i < players.length; i++) players[s + i] += v[i] * gain;
    };
    melody.forEach((n, k) => {
      const v = renderVoice(band.player, { midi: n.midi, velocity: 0.75, duration: slot * 1.6, timbre: 0, kind: 'note' }, sampleRate, `${seed}:g${g}:m${k}`);
      mixInto(bus, v, n.time, -0.25, 0.5);
      mixInto(wet, v, n.time, -0.2, 0.15);
      addMono(v, n.time, 1);
    });
    const dv = renderVoice(band.drone, { midi: droneMidi, velocity: 0.6, duration: phraseSec * 0.9, timbre: 0, kind: 'note' }, sampleRate, `${seed}:g${g}:drone`);
    mixInto(bus, dv, t0, 0.3, 0.4);
    addMono(dv, t0, 0.8);

    // ---- The body: resonator bank driven by the players and by mallet strikes on beats 1 and 3.
    const strikes = new Set<number>();
    for (let b = 0; b < 2; b++) for (const beat of [0, 2]) strikes.add(Math.round((b * 4 + beat) * (60 / bpm) * sampleRate));
    const len = players.length;
    const outL = new Float32Array(len);
    const outR = new Float32Array(len);
    const energy = new Array(modes.length).fill(0);
    modes.forEach((m, i) => {
      const r = Math.exp(-1 / (m.decay * sampleRate));
      const c = 2 * r * Math.cos((2 * Math.PI * m.hz) / sampleRate);
      const r2 = r * r;
      const norm = (1 - r2) * 0.5;
      const pan = (m.id % 2 === 0 ? -1 : 1) * 0.6;
      const gl = Math.cos(((pan + 1) * Math.PI) / 4) * m.gain;
      const gr = Math.sin(((pan + 1) * Math.PI) / 4) * m.gain;
      let y1 = 0;
      let y2 = 0;
      let e = 0;
      const phraseLen = n1 - n0;
      for (let k = 0; k < len; k++) {
        let x = players[k] * 0.35;
        if (strikes.has(k)) x += 0.9;
        const y = c * y1 - r2 * y2 + x * norm * 40;
        y2 = y1;
        y1 = y;
        if (k < phraseLen) e += y * y;
        outL[k] += y * gl;
        outR[k] += y * gr;
      }
      energy[i] = r4(e / Math.max(1, phraseLen));
    });
    // Each phrase's body sound (with its ring-out) is rendered from rest, so generations stay separable.
    const bodyL = outL;
    const bodyR = outR;
    let bp = 1e-9;
    for (let k = 0; k < len; k++) bp = Math.max(bp, Math.abs(bodyL[k]), Math.abs(bodyR[k]));
    const bodyGain = 0.55 / bp;
    for (let k = 0; k < len && n0 + k < bus.left.length; k++) {
      const fade = k < n1 - n0 ? 1 : Math.max(0, 1 - (k - (n1 - n0)) / (sampleRate * 4));
      bus.left[n0 + k] += bodyL[k] * bodyGain * fade;
      bus.right[n0 + k] += bodyR[k] * bodyGain * fade;
      wet.left[n0 + k] += bodyL[k] * bodyGain * fade * 0.25;
      wet.right[n0 + k] += bodyR[k] * bodyGain * fade * 0.25;
    }

    // ---- Listen & record this generation.
    const spec = averageSpectrum(players, sampleRate, 0, n1 - n0);
    const { h, f0 } = harmonicity(modes, energy);
    const strongCentroid = modes.reduce((s, m, i) => s + m.hz * energy[i] * m.gain, 0) / Math.max(1e-12, modes.reduce((s, m, i) => s + energy[i] * m.gain, 0));
    const pcs = new Set(modes.map((m, i) => ({ m, e: energy[i] * m.gain })).sort((a, b) => b.e - a.e).slice(0, 8).map((x) => ((Math.round(hzToMidi(x.m.hz)) % 12) + 12) % 12));
    generations.push({
      gen: g,
      start: r4(t0),
      modes: modes.map((m) => ({ ...m })),
      melody,
      drone: { midi: droneMidi, from_mode: droneFrom?.id ?? null },
      energy,
      metrics: { harmonicity: h, meanDecay: r4(modes.reduce((s, m) => s + m.decay, 0) / modes.length), centroidHz: r4(strongCentroid), lowestStrongHz: f0, distinctPitchClasses: pcs.size },
    });

    // ---- Evolve.
    const order = energy.map((e, i) => ({ i, e })).sort((a, b) => b.e - a.e);
    const q = Math.max(1, Math.floor(modes.length / 4));
    const top = new Set(order.slice(0, q).map((x) => x.i));
    const bottom = new Set(order.slice(-q).map((x) => x.i));
    const median = order[Math.floor(order.length / 2)].e;
    const played = [...melody.map((n) => n.midi), droneMidi].flatMap((m) => [1, 2, 3, 4].map((h2) => midiToHz(m) * h2));
    const heard = spectralPeaks(spec, 16, 60, 4000);
    const rel = (e: number) => (median > 0 ? (e / median).toFixed(2) : '∞');
    modes = modes.map((m, i) => {
      let { hz, decay, gain } = m;
      const before = `${hz.toFixed(1)}Hz/${decay.toFixed(2)}s`;
      if (top.has(i)) {
        decay = Math.min(6, decay * 1.25);
        gain = Math.min(2, gain * 1.08);
        changes.push({ gen: g, mode: m.id, kind: 'grow', from: before, to: `${hz.toFixed(1)}Hz/${decay.toFixed(2)}s`, cause: `エネルギー中央値の ${rel(energy[i])} 倍` });
      }
      if (energy[i] >= median) {
        let best = 0;
        let bestCents = Infinity;
        for (const f of played) {
          const c = 1200 * Math.log2(f / hz);
          if (Math.abs(c) < Math.abs(bestCents)) {
            bestCents = c;
            best = f;
          }
        }
        if (Math.abs(bestCents) < 150 && Math.abs(bestCents) > 2) {
          const nhz = hz * Math.pow(2, (0.35 * bestCents) / 1200);
          changes.push({ gen: g, mode: m.id, kind: 'tune', from: `${hz.toFixed(1)}Hz`, to: `${nhz.toFixed(1)}Hz`, cause: `弾かれた音 ${best.toFixed(1)}Hz に ${bestCents.toFixed(0)} セント引き寄せ` });
          hz = nhz;
        }
      }
      if (bottom.has(i)) {
        decay *= 0.78;
        gain *= 0.9;
        if (decay < 0.12) {
          const free = heard.find((p) => modes.every((o) => Math.abs(1200 * Math.log2(p.hz / o.hz)) > 60));
          if (free) {
            const id = nextId++;
            changes.push({ gen: g, mode: id, kind: 'reborn', from: `#${m.id} ${hz.toFixed(1)}Hz (死)`, to: `#${id} ${free.hz.toFixed(1)}Hz`, cause: `聴こえたスペクトルのピーク ${free.hz.toFixed(1)}Hz に楽器のモードがなかった` });
            return { id, hz: r4(free.hz), decay: 0.4, gain: 0.6, born: g + 1 };
          }
          decay = 0.12;
        } else changes.push({ gen: g, mode: m.id, kind: 'starve', from: before, to: `${hz.toFixed(1)}Hz/${decay.toFixed(2)}s`, cause: `エネルギー中央値の ${rel(energy[i])} 倍` });
      }
      return { ...m, hz: r4(hz), decay: r4(decay), gain: r4(gain) };
    });
  }

  const [rl, rr] = reverb(wet.left, wet.right, { roomSize: 0.7, damping: 0.5, sampleRate });
  for (let i = 0; i < bus.left.length; i++) {
    bus.left[i] += rl[i];
    bus.right[i] += rr[i];
  }
  fadeEdges(bus.left, bus.right, sampleRate, 0.01, 3);
  const rep = master(bus.left, bus.right, { sampleRate, targetRmsDb: -16, ceilingDb: -1, maxGainDb: 18 });
  return { engine_version: GROW_VERSION, seed, bpm, phraseSec: r4(phraseSec), durationSec: r4(total), generations, changes, buffer: bus, master: rep, derivations };
}

/** One strike of the body as it is at a generation (for before/after comparison). */
export function strikeBody(modes: GrowMode[], seconds: number, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  for (const m of modes) {
    const r = Math.exp(-1 / (m.decay * sampleRate));
    const c = 2 * r * Math.cos((2 * Math.PI * m.hz) / sampleRate);
    let y1 = 0;
    let y2 = 0;
    for (let k = 0; k < out.length; k++) {
      const y = c * y1 - r * r * y2 + (k === 0 ? 1 : 0);
      y2 = y1;
      y1 = y;
      out[k] += y * m.gain * 0.05;
    }
  }
  let p = 1e-9;
  for (const v of out) p = Math.max(p, Math.abs(v));
  for (let k = 0; k < out.length; k++) out[k] = (out[k] / p) * 0.8 * Math.min(1, (out.length - k) / (sampleRate * 0.05));
  return out;
}
