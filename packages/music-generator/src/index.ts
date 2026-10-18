import type { InstrumentDNA, InteractionEffect, InteractionRule, InteractionTrigger } from '@sonova/instrument-dna';
import { Rng, clamp, euclid } from '@sonova/instrument-dna';

export const GENERATOR_VERSION = 'sonova-generator/1.0.0';

export type ArcPreset = 'bloom' | 'tide' | 'cascade';

export const ARC_PRESETS: Record<ArcPreset, { label: string; description: string }> = {
  bloom: { label: 'BLOOM', description: '静かに生まれ、相互作用が育ち、満開の後に余韻へ' },
  tide: { label: 'TIDE', description: '潮のように2度満ちて引く。密度と結合が波打つ' },
  cascade: { label: 'CASCADE', description: '最初から結合が強く、共鳴の連鎖が先行し、後半にリズムが立ち上がる' },
};

export interface GeneratorConfig {
  seed: string;
  durationSec: number;
  arc: ArcPreset;
  /** Multiplier per interaction effect (0 disables it). */
  ruleGain?: Partial<Record<InteractionEffect, number>>;
  bpm?: number;
  /** Max length of a response chain (note → response → response …). */
  maxDepth?: number;
  /** Hard cap on responses processed per step. */
  maxResponsesPerStep?: number;
  /** Seconds at the end with no new notes (ring-out). */
  tailSec?: number;
}

export interface EventCause {
  event: number;
  rule: InteractionEffect;
  from_instrument: number;
}

export type GenEventKind = 'note' | 'resonance' | 'mutation' | 'wake';

export interface GenEvent {
  id: number;
  step: number;
  time: number;
  instrument: number;
  kind: GenEventKind;
  depth: number;
  origin: 'pulse' | 'motif' | 'response' | 'environment';
  midi?: number;
  velocity?: number;
  duration?: number;
  timbre?: number;
  param?: 'timbre' | 'rhythm' | 'phase' | 'pitch';
  from?: string | number;
  to?: string | number;
  cause?: EventCause;
}

export interface StateSnapshot {
  step: number;
  time: number;
  arc: { density: number; coupling: number };
  instruments: Array<{ energy: number; timbre: number; resonance: number; pulses: number; rotation: number; awake: boolean }>;
}

export interface GeneratorResult {
  engine_version: string;
  config: Required<Omit<GeneratorConfig, 'bpm'>> & { bpm: number };
  bpm: number;
  stepSec: number;
  totalSteps: number;
  key: { root_pc: number; mode: string; scale: number[]; reason: string };
  instruments: Array<{ instrument_id: string; name: string; dna_hash: string }>;
  events: GenEvent[];
  snapshots: StateSnapshot[];
  stats: {
    notes: number;
    resonances: number;
    mutations: number;
    byRule: Record<InteractionEffect, number>;
    byPair: Record<string, number>;
    maxDepthReached: number;
    suppressedResponses: number;
    maxResponsesInStep: number;
    peakTotalEnergy: number;
  };
  chains: Chain[];
}

export interface Chain {
  time: number;
  depth: number;
  eventIds: number[];
  text: string;
}

export const MODES: Record<string, number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor_pentatonic: [0, 3, 5, 7, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  in_sen: [0, 1, 5, 7, 10],
};
const MODE_ORDER = Object.keys(MODES);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Environmental conditions over normalised time — the "director" shapes conditions, never notes. */
export function arcAt(preset: ArcPreset, u: number): { density: number; coupling: number } {
  const ending = 1 - smoothstep(0.84, 0.95, u);
  switch (preset) {
    case 'bloom':
      return {
        density: (0.12 + 0.88 * smoothstep(0.02, 0.62, u)) * ending,
        coupling: (0.3 + 0.7 * smoothstep(0.08, 0.6, u)) * (1 - 0.6 * smoothstep(0.8, 1, u)),
      };
    case 'tide':
      return {
        density: (0.2 + 0.75 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (u * 2 - 0.15)))) * ending,
        coupling: 0.45 + 0.55 * Math.sin(Math.PI * u),
      };
    case 'cascade':
      return {
        density: (0.25 + 0.7 * smoothstep(0.45, 0.78, u)) * ending,
        coupling: 1 - 0.55 * smoothstep(0.35, 0.95, u),
      };
  }
}

interface InstState {
  dna: InstrumentDNA;
  energy: number;
  timbre: number;
  resonance: number;
  degree: number;
  homeDegree: number;
  rhythm: { steps: number; pulses: number; rotation: number; rate: number };
  pattern: boolean[];
  awake: boolean;
  motif: number[];
  motifQueue: number[];
  pendingPitch: number | null;
  lastResponse: Partial<Record<InteractionEffect, number>>;
  busyResonanceUntil: number;
  prevMidi: number | null;
  lastMidi: number | null;
  rng: Rng;
}

interface Scheduled {
  step: number;
  target: number;
  rule: InteractionRule;
  cause: GenEvent;
}

const REFRACTORY: Record<InteractionEffect, number> = { resonate: 2, timbre: 4, rhythm: 16, entrain: 8, attract: 2 };
const TRIGGER_EMISSION: Record<InteractionTrigger, number> = { note: 1, resonance: 0.7, mutation: 1.4 };

export function degreeToMidi(rootPc: number, scale: number[], degree: number): number {
  const len = scale.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return rootPc + 12 * oct + scale[idx];
}

export function midiToDegree(rootPc: number, scale: number[], midi: number): number {
  let best = 0;
  let bestDist = Infinity;
  const approx = Math.floor(((midi - rootPc) / 12) * scale.length);
  for (let d = approx - scale.length; d <= approx + scale.length; d++) {
    const dist = Math.abs(degreeToMidi(rootPc, scale, d) - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

const rhythmLabel = (r: { steps: number; pulses: number; rotation: number }) => `E(${r.pulses},${r.steps})+${r.rotation}`;

export function generate(dnas: InstrumentDNA[], cfg: GeneratorConfig): GeneratorResult {
  if (dnas.length === 0) throw new Error('At least one instrument is required');
  const config = {
    seed: cfg.seed,
    durationSec: cfg.durationSec,
    arc: cfg.arc,
    ruleGain: { resonate: 1, timbre: 1, rhythm: 1, entrain: 1, attract: 1, ...cfg.ruleGain },
    maxDepth: cfg.maxDepth ?? 3,
    maxResponsesPerStep: cfg.maxResponsesPerStep ?? 6,
    tailSec: cfg.tailSec ?? 3,
  };
  const rng = new Rng(`generator:${config.seed}:${dnas.map((d) => d.dna_hash).join(',')}`);

  // ---- Global key & tempo, derived from the instruments ---------------------------
  const initiator = dnas.reduce((best, d, i) => (d.interaction_rules.emission > dnas[best].interaction_rules.emission ? i : best), 0);
  const brightness = dnas.reduce((s, d) => s + d.harmonics.brightness * 0.6 + d.sustain * 0.4, 0) / dnas.length;
  const modeIdx = clamp(Math.floor((1 - brightness) * MODE_ORDER.length) + rng.int(-1, 1), 0, MODE_ORDER.length - 1);
  const mode = MODE_ORDER[modeIdx];
  const scale = MODES[mode];
  const rootPc = dnas[initiator].pitch_range.root_pc;
  const vib = dnas.reduce((s, d) => s + d.modulation.vibrato_rate, 0) / dnas.length;
  const bpm = cfg.bpm ?? Math.round(clamp(70 + ((vib - 1.5) / 5.5) * 38 + rng.int(-4, 4), 64, 116));
  const stepSec = 60 / bpm / 4;
  const totalSteps = Math.floor(config.durationSec / stepSec);
  const lastNoteStep = Math.floor((config.durationSec - config.tailSec) / stepSec);

  const states: InstState[] = dnas.map((dna, i) => {
    const home = midiToDegree(rootPc, scale, dna.pitch_range.center);
    return {
      dna,
      energy: i === initiator ? 0.6 : 0.1,
      timbre: 0,
      resonance: 0,
      degree: home,
      homeDegree: home,
      rhythm: { ...dna.rhythm },
      pattern: euclid(dna.rhythm.steps, dna.rhythm.pulses, dna.rhythm.rotation),
      awake: i === initiator,
      motif: [],
      motifQueue: [],
      pendingPitch: null,
      lastResponse: {},
      busyResonanceUntil: -1,
      prevMidi: null,
      lastMidi: null,
      rng: rng.fork(`inst${i}`),
    };
  });

  const events: GenEvent[] = [];
  const snapshots: StateSnapshot[] = [];
  const queue: Scheduled[] = [];
  const stats: GeneratorResult['stats'] = {
    notes: 0,
    resonances: 0,
    mutations: 0,
    byRule: { resonate: 0, timbre: 0, rhythm: 0, entrain: 0, attract: 0 },
    byPair: {},
    maxDepthReached: 0,
    suppressedResponses: 0,
    maxResponsesInStep: 0,
    peakTotalEnergy: 0,
  };
  let nextId = 0;
  const push = (e: Omit<GenEvent, 'id' | 'time'>): GenEvent => {
    const ev: GenEvent = { id: nextId++, time: Math.round(e.step * stepSec * 1e6) / 1e6, ...e };
    events.push(ev);
    stats.maxDepthReached = Math.max(stats.maxDepthReached, ev.depth);
    return ev;
  };

  const clampToRange = (st: InstState, midi: number): number => {
    let m = midi;
    while (m < st.dna.pitch_range.low) m += 12;
    while (m > st.dna.pitch_range.high) m -= 12;
    return m < st.dna.pitch_range.low ? st.dna.pitch_range.center : m;
  };

  /** Offer an event to every other instrument's listening rules. */
  const emit = (source: GenEvent, step: number, coupling: number) => {
    const trigger: InteractionTrigger = source.kind === 'note' ? 'note' : source.kind === 'resonance' ? 'resonance' : 'mutation';
    if (source.depth >= config.maxDepth || source.kind === 'wake') return;
    const src = states[source.instrument];
    const vel = source.velocity ?? 0.6;
    states.forEach((st, j) => {
      if (j === source.instrument) return;
      for (const rule of st.dna.interaction_rules.responses) {
        if (!rule.triggers.includes(trigger)) continue;
        const p =
          src.dna.interaction_rules.emission * TRIGGER_EMISSION[trigger] * st.dna.interaction_rules.sensitivity * rule.strength *
          (config.ruleGain[rule.effect] ?? 1) * coupling * (0.5 + vel * 0.6);
        if (st.rng.next() < clamp(p, 0, 0.95)) queue.push({ step: step + rule.delay_steps, target: j, rule, cause: source });
      }
    });
  };

  const wake = (j: number, step: number, cause?: EventCause, depth = 0) => {
    if (states[j].awake) return;
    states[j].awake = true;
    push({ step, instrument: j, kind: 'wake', depth, origin: cause ? 'response' : 'environment', cause });
  };

  for (let step = 0; step < totalSteps; step++) {
    const u = step / totalSteps;
    const arc = arcAt(config.arc, u);
    const canPlay = step < lastNoteStep;

    // 1. Environment: energy decays, the arc feeds awake instruments.
    states.forEach((st, i) => {
      st.energy *= 0.93;
      if (st.awake) st.energy += (0.3 + 0.7 * arc.density) * 0.07 * (0.6 + 0.4 * st.dna.interaction_rules.emission);
      st.timbre *= 0.99;
      st.resonance *= 0.97;
      // Fallback wake so nobody stays silent forever (recorded as an environment event).
      if (!st.awake && u > 0.28 + i * 0.08) wake(i, step);
    });
    let total = states.reduce((s, st) => s + st.energy, 0);
    if (total > 2.2) states.forEach((st) => (st.energy *= 2.2 / total));
    total = Math.min(total, 2.2);
    stats.peakTotalEnergy = Math.max(stats.peakTotalEnergy, total);

    // 2. Pulses: each awake instrument plays when its pattern hits and it has energy.
    if (canPlay) {
      states.forEach((st, i) => {
        if (!st.awake) return;
        const pos = step * st.rhythm.rate;
        if (!Number.isInteger(pos)) return;
        const idx = pos % st.rhythm.steps;
        const threshold = 0.18 + (1 - arc.density) * 0.08;
        // The piece opens with the initiator's first touch; after that the pattern decides.
        const opening = step === 0 && i === initiator;
        if (!opening && (!st.pattern[idx] || st.energy < threshold)) return;
        // Sparse conditions thin the pattern out; dense conditions play it fully.
        if (!opening && idx !== 0 && st.rng.next() > 0.3 + 0.7 * arc.density) return;
        let origin: GenEvent['origin'] = opening ? 'environment' : 'pulse';
        let cause: EventCause | undefined;
        let midi: number;
        if (st.pendingPitch !== null) {
          midi = st.pendingPitch;
          st.pendingPitch = null;
        } else if (st.motifQueue.length) {
          st.degree = st.motifQueue.shift()!;
          midi = clampToRange(st, degreeToMidi(rootPc, scale, st.degree));
          origin = 'motif';
        } else {
          const recall = (st.dna.interaction_rules.memory_length / 12) * 0.22 * arc.density;
          if (st.motif.length >= 4 && st.rng.next() < recall) {
            const shift = st.rng.pick([0, 0, 2, -2, scale.length]);
            st.motifQueue = st.motif.map((d) => d + shift);
            st.degree = st.motifQueue.shift()!;
            origin = 'motif';
          } else {
            const pull = Math.sign(st.homeDegree - st.degree) * (Math.abs(st.homeDegree - st.degree) > scale.length * 0.6 ? 1 : 0);
            st.degree += st.rng.pick([-2, -1, -1, 0, 1, 1, 2]) + pull;
          }
          midi = clampToRange(st, degreeToMidi(rootPc, scale, st.degree));
        }
        st.degree = midiToDegree(rootPc, scale, midi);
        if (st.motif.length < 4) st.motif.push(st.degree);
        const accent = idx === 0 ? 0.1 : 0;
        const velocity = Math.round(clamp(0.38 + st.energy * 0.5 + accent, 0.2, 1) * 1e4) / 1e4;
        const pad = st.dna.attack > 0.25;
        const gap = (st.rhythm.steps / Math.max(1, st.rhythm.pulses)) / st.rhythm.rate;
        const duration = Math.round(clamp(pad ? gap * stepSec * 1.6 : stepSec * 1.4 / st.rhythm.rate, 0.08, 4.5) * 1e4) / 1e4;
        const ev = push({ step, instrument: i, kind: 'note', depth: 0, origin, midi, velocity, duration, timbre: Math.round(st.timbre * 1e4) / 1e4, cause });
        stats.notes++;
        st.prevMidi = st.lastMidi;
        st.lastMidi = midi;
        st.energy = Math.max(0, st.energy - 0.12);
        emit(ev, step, arc.coupling);
      });
    }

    // 3. Responses due now (deterministic order), bounded per step.
    const due = queue.filter((q) => q.step === step).sort((a, b) => a.cause.id - b.cause.id || a.target - b.target);
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k].step <= step) queue.splice(k, 1);
    let processed = 0;
    for (const q of due) {
      const st = states[q.target];
      const effect = q.rule.effect;
      const last = st.lastResponse[effect];
      if (last !== undefined && step - last < REFRACTORY[effect]) continue;
      if (processed >= config.maxResponsesPerStep) {
        stats.suppressedResponses++;
        continue;
      }
      const cause: EventCause = { event: q.cause.id, rule: effect, from_instrument: q.cause.instrument };
      const depth = q.cause.depth + 1;
      const senderMidi = q.cause.midi ?? degreeToMidi(rootPc, scale, states[q.cause.instrument].degree);
      let produced: GenEvent | null = null;
      if (effect === 'resonate') {
        if (!canPlay || step < st.busyResonanceUntil) continue;
        let midi = clampToRange(st, senderMidi);
        if (Math.abs(midi - senderMidi) % 12 !== 0) midi = clampToRange(st, senderMidi + 7);
        const velocity = Math.round(clamp(0.22 + 0.45 * q.rule.strength * arc.coupling * st.dna.interaction_rules.sensitivity, 0.15, 0.75) * 1e4) / 1e4;
        const duration = Math.round(clamp(0.5 + st.dna.resonance.ring * 0.45, 0.4, 3.5) * 1e4) / 1e4;
        wake(q.target, step, cause, depth);
        produced = push({ step, instrument: q.target, kind: 'resonance', depth, origin: 'response', midi, velocity, duration, timbre: Math.round(st.timbre * 1e4) / 1e4, cause });
        st.busyResonanceUntil = step + Math.ceil((duration / stepSec) * 0.6);
        st.resonance = Math.min(1, st.resonance + 0.35);
        st.energy += 0.08;
        stats.resonances++;
      } else if (effect === 'timbre') {
        const before = st.timbre;
        // The sender's melodic contour paints the receiver's colour: rising → brighter, falling → darker.
        const prev = states[q.cause.instrument].prevMidi;
        const dir = prev === null || senderMidi === prev ? (st.timbre <= 0 ? 1 : -1) : senderMidi > prev ? 1 : -1;
        st.timbre = clamp(st.timbre + dir * 0.32 * q.rule.strength, -1, 1);
        wake(q.target, step, cause, depth);
        st.energy += 0.12;
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'timbre', from: round3(before), to: round3(st.timbre), cause });
      } else if (effect === 'rhythm') {
        const before = rhythmLabel(st.rhythm);
        const maxPulses = Math.max(2, Math.floor(st.rhythm.steps * 0.6));
        const op = (senderMidi + q.cause.id) % 3;
        if (op === 0) st.rhythm.pulses = Math.min(maxPulses, st.rhythm.pulses + 1);
        else if (op === 1) st.rhythm.pulses = Math.max(1, st.rhythm.pulses - 1);
        else st.rhythm.rotation = (st.rhythm.rotation + 1) % st.rhythm.steps;
        if (st.rhythm.pulses === st.dna.rhythm.pulses + 3) st.rhythm.pulses--; // keep it recognisable
        if (rhythmLabel(st.rhythm) === before) continue;
        st.pattern = euclid(st.rhythm.steps, st.rhythm.pulses, st.rhythm.rotation);
        wake(q.target, step, cause, depth);
        st.energy += 0.1;
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'rhythm', from: before, to: rhythmLabel(st.rhythm), cause });
      } else if (effect === 'entrain') {
        const before = st.rhythm.rotation;
        // Rotate so that this instrument's next onset lands one beat after the sender's event.
        const target = Math.floor((step + 4) * st.rhythm.rate) % st.rhythm.steps;
        if (!st.pattern[target]) {
          for (let r = 1; r < st.rhythm.steps; r++) {
            const cand = euclid(st.rhythm.steps, st.rhythm.pulses, (st.rhythm.rotation + r) % st.rhythm.steps);
            if (cand[target]) {
              st.rhythm.rotation = (st.rhythm.rotation + r) % st.rhythm.steps;
              st.pattern = cand;
              break;
            }
          }
        }
        if (before === st.rhythm.rotation) continue;
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'phase', from: before, to: st.rhythm.rotation, cause });
      } else if (effect === 'attract') {
        const options = [-12, -9, -8, -5, 3, 4, 7, 12]
          .map((iv) => degreeToMidi(rootPc, scale, midiToDegree(rootPc, scale, senderMidi + iv)))
          .filter((m) => m >= st.dna.pitch_range.low && m <= st.dna.pitch_range.high && m !== senderMidi);
        if (!options.length) continue;
        const current = degreeToMidi(rootPc, scale, st.degree);
        options.sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
        st.pendingPitch = options[0];
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'pitch', from: current, to: options[0], cause });
      }
      if (!produced) continue;
      if (produced.kind === 'mutation') stats.mutations++;
      st.lastResponse[effect] = step;
      stats.byRule[effect]++;
      const pair = `${q.cause.instrument}->${q.target}`;
      stats.byPair[pair] = (stats.byPair[pair] ?? 0) + 1;
      processed++;
      emit(produced, step, arc.coupling);
    }
    stats.maxResponsesInStep = Math.max(stats.maxResponsesInStep, processed);

    if (step % 4 === 0) {
      snapshots.push({
        step,
        time: Math.round(step * stepSec * 1e4) / 1e4,
        arc: { density: round3(arc.density), coupling: round3(arc.coupling) },
        instruments: states.map((st) => ({
          energy: round3(st.energy),
          timbre: round3(st.timbre),
          resonance: round3(st.resonance),
          pulses: st.rhythm.pulses,
          rotation: st.rhythm.rotation,
          awake: st.awake,
        })),
      });
    }
  }

  return {
    engine_version: GENERATOR_VERSION,
    config: { ...config, bpm },
    bpm,
    stepSec,
    totalSteps,
    key: {
      root_pc: rootPc,
      mode,
      scale,
      reason: `主音は最も働きかけの強い楽器「${dnas[initiator].name}」の主音、旋法は3楽器の明るさ平均 ${round3(brightness)} から選択`,
    },
    instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, name: d.name, dna_hash: d.dna_hash })),
    events,
    snapshots,
    stats,
    chains: findChains(events, dnas),
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const EFFECT_TEXT: Record<InteractionEffect, string> = {
  resonate: '共鳴',
  timbre: '音色変化',
  rhythm: 'リズム生成',
  entrain: '同調',
  attract: '協和への引き寄せ',
};

/** Describe an event in Japanese for the explanation log. */
export function describeEvent(e: GenEvent, names: string[]): string {
  const who = names[e.instrument] ?? `#${e.instrument}`;
  switch (e.kind) {
    case 'note':
      return `${who}が発音 (MIDI ${e.midi})`;
    case 'resonance':
      return `${who}が共鳴 (MIDI ${e.midi})`;
    case 'wake':
      return `${who}が目覚める`;
    case 'mutation':
      if (e.param === 'timbre') return `${who}の音色が${Number(e.to) > Number(e.from) ? '明るく' : '暗く'}変化 (${e.from}→${e.to})`;
      if (e.param === 'rhythm') return `${who}のリズムが ${e.from} → ${e.to} に変化`;
      if (e.param === 'phase') return `${who}がタイミングを同調 (回転 ${e.from}→${e.to})`;
      return `${who}が協和音へ引き寄せられる (${e.from}→${e.to})`;
  }
}

/** The longest causal chains: the "why" of the music. */
export function findChains(events: GenEvent[], dnas: InstrumentDNA[], limit = 12): Chain[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const names = dnas.map((d) => d.name);
  const deep = events.filter((e) => e.depth >= 2 && e.kind !== 'wake');
  const chains: Chain[] = [];
  const used = new Set<number>();
  for (const leaf of deep.sort((a, b) => b.depth - a.depth || a.id - b.id)) {
    if (used.has(leaf.id)) continue;
    const path: GenEvent[] = [];
    let cur: GenEvent | undefined = leaf;
    while (cur) {
      path.unshift(cur);
      used.add(cur.id);
      cur = cur.cause ? byId.get(cur.cause.event) : undefined;
    }
    const text = path
      .map((e, i) => (i === 0 ? describeEvent(e, names) : `[${EFFECT_TEXT[e.cause!.rule]}] ${describeEvent(e, names)}`))
      .join(' → ');
    chains.push({ time: path[0].time, depth: leaf.depth, eventIds: path.map((e) => e.id), text });
    if (chains.length >= limit) break;
  }
  return chains.sort((a, b) => a.time - b.time);
}

export * from './rock.ts';
