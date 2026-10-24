/**
 * Music generator v1.1 — the v1.0 interaction model (the instruments play their own patterns and
 * answer each other through their DNA's rules; the arc only sets conditions) with what v1.0 lacked:
 *  - phrases: 2-bar phrases breathe at their end and resolve to the key's chord; the piece ends on a
 *    final chord (the one composed rule, recorded as a 'cadence' event, like the arc)
 *  - listening harmony: a note is chosen among nearby scale degrees by how rough it sounds against what
 *    the others are holding right now (Plomp–Levelt / Sethares roughness of 6 harmonics)
 *  - 'imitate': an instrument answers another's last phrase two beats later, moved into its own register
 *  - 'yield': when the others are busy, an instrument rests for a bar and gives them room
 *  - dynamics follow the phrase (a small arch) instead of only the energy
 * `generate` (v1.0) is unchanged; the result has the same shape, so arrange/render/MIDI work as before.
 */
import type { InstrumentDNA, InteractionEffect, InteractionEffectV11, InteractionRule, InteractionRuleV11, InteractionTrigger } from '@sonova/instrument-dna';
import { Rng, clamp, euclid } from '@sonova/instrument-dna';
import {
  MODES,
  MODE_ORDER,
  REFRACTORY,
  TRIGGER_EMISSION,
  arcAt,
  degreeToMidi,
  findChains,
  midiToDegree,
  rhythmLabel,
  type EventCause,
  type GenEvent,
  type GeneratorConfig,
  type GeneratorResult,
  type StateSnapshot,
} from './index.ts';

export const GENERATOR_V11_VERSION = 'sonova-generator/1.1.0';

export interface GeneratorConfigV11 extends GeneratorConfig {
  /** steps per phrase (default 32 = 2 bars) */
  phraseSteps?: number;
  /** how strongly a note avoids roughness against the sounding notes (0 = v1.0 behaviour) */
  harmonyWeight?: number;
}

export interface GeneratorResultV11 extends GeneratorResult {
  phrases: Array<{ start: number; end: number; time: number }>;
  finalChord: { step: number; time: number; midis: number[] } | null;
  statsV11: { imitations: number; yields: number; cadenceNotes: number; meanRoughness: number };
}

const REFRACTORY_V11: Record<InteractionEffectV11, number> = { imitate: 24, yield: 16 };

/** roughness of two harmonic tones (6 partials, 1/k), Sethares' fit of Plomp & Levelt */
const roughCache = new Map<string, number>();
export function pairRoughness(m1: number, m2: number): number {
  const lo = Math.min(m1, m2);
  const hi = Math.max(m1, m2);
  const key = `${lo}:${hi}`;
  const hit = roughCache.get(key);
  if (hit !== undefined) return hit;
  const f1 = 440 * Math.pow(2, (lo - 69) / 12);
  const f2 = 440 * Math.pow(2, (hi - 69) / 12);
  let r = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const x = Math.min(f1 * a, f2 * b);
      const y = Math.max(f1 * a, f2 * b);
      const s = 0.24 / (0.021 * x + 19);
      const d = y - x;
      r += (1 / a) * (1 / b) * (Math.exp(-3.5 * s * d) - Math.exp(-5.75 * s * d));
    }
  roughCache.set(key, r);
  return r;
}

interface InstStateV11 {
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
  /** recent notes (midi) for imitation */
  recent: number[];
  motifQueue: Array<{ degree: number; cause?: EventCause; depth: number; until?: number }>;
  pendingPitch: number | null;
  lastResponse: Partial<Record<InteractionEffect | InteractionEffectV11, number>>;
  busyResonanceUntil: number;
  restUntil: number;
  prevMidi: number | null;
  lastMidi: number | null;
  rng: Rng;
}

type AnyRule = InteractionRule | InteractionRuleV11;
interface Scheduled {
  step: number;
  target: number;
  rule: AnyRule;
  cause: GenEvent;
}

export function generateV11(dnas: InstrumentDNA[], cfg: GeneratorConfigV11): GeneratorResultV11 {
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
  const phraseSteps = cfg.phraseSteps ?? 32;
  const harmonyWeight = cfg.harmonyWeight ?? 6;
  const rng = new Rng(`generator-v11:${config.seed}:${dnas.map((d) => d.dna_hash).join(',')}`);

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
  // the final chord lands on the bar line nearest to 1.5 s before the ring-out (never after the last note step)
  const target = lastNoteStep - Math.round(1.5 / stepSec);
  let finalStep = Math.max(16, Math.round(target / 16) * 16);
  if (finalStep > lastNoteStep - 4) finalStep -= 16;
  // chord tones of the key (root, the scale's third or nearest, fifth)
  const third = scale.find((iv) => iv === 3 || iv === 4) ?? scale[Math.min(2, scale.length - 1)];
  const fifth = scale.includes(7) ? 7 : scale[Math.min(scale.length - 1, Math.floor(scale.length / 2) + 1)];
  const chordPcs = [0, third, fifth].map((iv) => (rootPc + iv) % 12);
  const isChordTone = (m: number) => chordPcs.includes(((m % 12) + 12) % 12);

  const states: InstStateV11[] = dnas.map((dna, i) => {
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
      recent: [],
      motifQueue: [],
      pendingPitch: null,
      lastResponse: {},
      busyResonanceUntil: -1,
      restUntil: -1,
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
  const statsV11 = { imitations: 0, yields: 0, cadenceNotes: 0, meanRoughness: 0 };
  let roughSum = 0;
  let roughN = 0;
  let nextId = 0;
  const push = (e: Omit<GenEvent, 'id' | 'time'>): GenEvent => {
    const ev: GenEvent = { id: nextId++, time: Math.round(e.step * stepSec * 1e6) / 1e6, ...e };
    events.push(ev);
    stats.maxDepthReached = Math.max(stats.maxDepthReached, ev.depth);
    return ev;
  };
  /** notes still sounding: [instrument, midi, endStep] */
  const sounding: Array<[number, number, number]> = [];
  const roughAgainst = (i: number, midi: number, step: number) => {
    let r = 0;
    for (const [j, m, end] of sounding) if (j !== i && end > step) r += pairRoughness(midi, m);
    return r;
  };

  const clampToRange = (st: InstStateV11, midi: number): number => {
    let m = midi;
    while (m < st.dna.pitch_range.low) m += 12;
    while (m > st.dna.pitch_range.high) m -= 12;
    return m < st.dna.pitch_range.low ? st.dna.pitch_range.center : m;
  };

  const rulesOf = (dna: InstrumentDNA): AnyRule[] => [...dna.interaction_rules.responses, ...(dna.interaction_rules.responses_v11 ?? [])];
  const gainOf = (effect: AnyRule['effect']) => (effect === 'imitate' || effect === 'yield' ? 1 : (config.ruleGain[effect] ?? 1));

  const emit = (source: GenEvent, step: number, coupling: number) => {
    const trigger: InteractionTrigger = source.kind === 'note' ? 'note' : source.kind === 'resonance' ? 'resonance' : 'mutation';
    if (source.depth >= config.maxDepth || source.kind === 'wake') return;
    const src = states[source.instrument];
    const vel = source.velocity ?? 0.6;
    states.forEach((st, j) => {
      if (j === source.instrument) return;
      for (const rule of rulesOf(st.dna)) {
        if (!rule.triggers.includes(trigger)) continue;
        // v1.1 strengths are score² (see DNA v1.1): √ restores v1.0's scale for the v1.0 rules
        const strength = rule.effect === 'imitate' || rule.effect === 'yield' ? rule.strength : Math.sqrt(rule.strength);
        const p = src.dna.interaction_rules.emission * TRIGGER_EMISSION[trigger] * st.dna.interaction_rules.sensitivity * strength * gainOf(rule.effect) * coupling * (0.5 + vel * 0.6) * (rule.effect === 'imitate' ? 0.6 : 1);
        if (st.rng.next() < clamp(p, 0, 0.95)) queue.push({ step: step + rule.delay_steps, target: j, rule, cause: source });
      }
    });
  };

  const wake = (j: number, step: number, cause?: EventCause, depth = 0) => {
    if (states[j].awake) return;
    states[j].awake = true;
    push({ step, instrument: j, kind: 'wake', depth, origin: cause ? 'response' : 'environment', cause });
  };

  /** choose among nearby degrees: step-size prior × consonance with the sounding notes × cadence pull */
  const chooseDegree = (st: InstStateV11, i: number, step: number, cadence: boolean): number => {
    const pull = Math.sign(st.homeDegree - st.degree) * (Math.abs(st.homeDegree - st.degree) > scale.length * 0.6 ? 1 : 0);
    const prior: Record<number, number> = { [-2]: 0.5, [-1]: 1, 0: 0.45, 1: 1, 2: 0.5 };
    const cands = [-2, -1, 0, 1, 2].map((dd) => {
      const d = st.degree + dd + pull;
      const midi = clampToRange(st, degreeToMidi(rootPc, scale, d));
      const r = roughAgainst(i, midi, step);
      let w = prior[dd] * Math.exp(-harmonyWeight * r);
      if (cadence) w *= isChordTone(midi) ? 4 : 0.4;
      return { d, midi, r, w };
    });
    const total = cands.reduce((s, c) => s + c.w, 0);
    let x = st.rng.next() * total;
    for (const c of cands) {
      x -= c.w;
      if (x <= 0) return c.d;
    }
    return cands[cands.length - 1].d;
  };

  const phrases: GeneratorResultV11['phrases'] = [];
  for (let s = 0; s < finalStep; s += phraseSteps) phrases.push({ start: s, end: Math.min(finalStep, s + phraseSteps), time: Math.round(s * stepSec * 1e4) / 1e4 });
  let finalChord: GeneratorResultV11['finalChord'] = null;

  for (let step = 0; step < totalSteps; step++) {
    const u = step / totalSteps;
    // the arc is stretched so that its own ending (density falling over u = 0.84–0.95) meets the final chord
    const arc = arcAt(config.arc, Math.min(1, (step / finalStep) * 0.9));
    const canPlay = step < finalStep;
    const inPhrase = step % phraseSteps;
    const cadence = inPhrase >= phraseSteps - 6;
    // a small dynamic arch inside each phrase (peak at 60 %)
    const phraseDyn = 0.9 + 0.2 * Math.sin(Math.PI * Math.min(1, inPhrase / (phraseSteps * 0.6)) * 0.5 + (inPhrase > phraseSteps * 0.6 ? -0.4 : 0));
    for (let k = sounding.length - 1; k >= 0; k--) if (sounding[k][2] <= step) sounding.splice(k, 1);

    states.forEach((st, i) => {
      st.energy *= 0.93;
      if (st.awake) st.energy += (0.3 + 0.7 * arc.density) * 0.07 * (0.6 + 0.4 * st.dna.interaction_rules.emission);
      st.timbre *= 0.99;
      st.resonance *= 0.97;
      if (!st.awake && u > 0.22 + i * 0.07) wake(i, step);
    });
    let total = states.reduce((s, st) => s + st.energy, 0);
    if (total > 2.2) states.forEach((st) => (st.energy *= 2.2 / total));
    total = Math.min(total, 2.2);
    stats.peakTotalEnergy = Math.max(stats.peakTotalEnergy, total);

    // ---- the final chord: every awake instrument lands on a chord tone in its register ----
    if (step === finalStep) {
      const midis: number[] = [];
      const cause = push({ step, instrument: initiator, kind: 'mutation', depth: 0, origin: 'environment', param: 'pitch', from: 'phrase', to: 'final chord' });
      states.forEach((st, i) => {
        if (!st.awake) return;
        const opts: number[] = [];
        for (let m = st.dna.pitch_range.low; m <= st.dna.pitch_range.high; m++) if (isChordTone(m)) opts.push(m);
        if (!opts.length) return;
        // root for the lowest instrument, otherwise the chord tone nearest the last note that adds the least roughness
        const last = st.lastMidi ?? st.dna.pitch_range.center;
        opts.sort((a, b) => roughAgainst(i, a, step) - roughAgainst(i, b, step) || Math.abs(a - last) - Math.abs(b - last));
        const midi = opts[0];
        const duration = Math.round(clamp((totalSteps - step) * stepSec - 0.3, 1, 6) * 1e4) / 1e4;
        push({ step, instrument: i, kind: 'note', depth: 1, origin: 'response', midi, velocity: 0.62, duration, timbre: Math.round(st.timbre * 1e4) / 1e4, cause: { event: cause.id, rule: 'cadence', from_instrument: initiator } });
        sounding.push([i, midi, step + Math.round(duration / stepSec)]);
        stats.notes++;
        statsV11.cadenceNotes++;
        midis.push(midi);
      });
      finalChord = { step, time: Math.round(step * stepSec * 1e4) / 1e4, midis };
    }

    if (canPlay) {
      states.forEach((st, i) => {
        if (!st.awake || step < st.restUntil) return;
        const pos = step * st.rhythm.rate;
        if (!Number.isInteger(pos)) return;
        const idx = pos % st.rhythm.steps;
        const threshold = 0.18 + (1 - arc.density) * 0.08;
        const opening = step === 0 && i === initiator;
        if (!opening && (!st.pattern[idx] || st.energy < threshold)) return;
        if (!opening && idx !== 0 && st.rng.next() > 0.3 + 0.7 * arc.density) return;
        // the phrase breathes: in the last two steps only the phrase's own downbeat-like hits survive
        if (!opening && inPhrase >= phraseSteps - 2 && st.rng.next() < 0.7) return;
        let origin: GenEvent['origin'] = opening ? 'environment' : 'pulse';
        let cause: EventCause | undefined;
        let depth = 0;
        let midi: number;
        // an answer that could not be played within a phrase is dropped (an echo comes soon or not at all)
        while (st.motifQueue.length && st.motifQueue[0].until !== undefined && step > st.motifQueue[0].until!) st.motifQueue.shift();
        if (st.motifQueue.length && st.motifQueue[0].cause?.rule === 'imitate') {
          // an imitation goes first: an attraction must not cut the answered phrase in two
          const q = st.motifQueue.shift()!;
          st.degree = q.degree;
          st.pendingPitch = null;
          midi = clampToRange(st, degreeToMidi(rootPc, scale, st.degree));
          origin = 'response';
          cause = q.cause;
          depth = q.depth;
        } else if (st.pendingPitch !== null) {
          midi = st.pendingPitch;
          st.pendingPitch = null;
        } else if (st.motifQueue.length) {
          const q = st.motifQueue.shift()!;
          st.degree = q.degree;
          midi = clampToRange(st, degreeToMidi(rootPc, scale, st.degree));
          origin = q.cause ? 'response' : 'motif';
          cause = q.cause;
          depth = q.depth;
        } else {
          // memory: a phrase often starts with the instrument's own motif again (v1.0 recalled it anywhere, more rarely)
          const recall = (st.dna.interaction_rules.memory_length / 12) * (inPhrase < 4 ? 0.9 : 0.22) * arc.density;
          if (st.motif.length >= 4 && st.rng.next() < recall && !cadence) {
            const shift = st.rng.pick([0, 0, 2, -2, scale.length]);
            st.motifQueue = st.motif.map((d) => ({ degree: d + shift, depth: 0 }));
            st.degree = st.motifQueue.shift()!.degree;
            origin = 'motif';
          } else st.degree = chooseDegree(st, i, step, cadence);
          midi = clampToRange(st, degreeToMidi(rootPc, scale, st.degree));
        }
        st.degree = midiToDegree(rootPc, scale, midi);
        if (st.motif.length < 4) st.motif.push(st.degree);
        st.recent.push(midi);
        if (st.recent.length > 4) st.recent.shift();
        const accent = idx === 0 ? 0.1 : 0;
        const velocity = Math.round(clamp((0.38 + st.energy * 0.5 + accent) * phraseDyn, 0.2, 1) * 1e4) / 1e4;
        const pad = st.dna.attack > 0.25;
        const gap = st.rhythm.steps / Math.max(1, st.rhythm.pulses) / st.rhythm.rate;
        const duration = Math.round(clamp(pad ? gap * stepSec * 1.6 : (stepSec * 1.4) / st.rhythm.rate, 0.08, 4.5) * 1e4) / 1e4;
        roughSum += roughAgainst(i, midi, step);
        roughN++;
        const ev = push({ step, instrument: i, kind: 'note', depth, origin, midi, velocity, duration, timbre: Math.round(st.timbre * 1e4) / 1e4, cause });
        sounding.push([i, midi, step + Math.max(1, Math.round(duration / stepSec))]);
        stats.notes++;
        st.prevMidi = st.lastMidi;
        st.lastMidi = midi;
        st.energy = Math.max(0, st.energy - 0.12);
        emit(ev, step, arc.coupling);
      });
    }

    const due = queue.filter((q) => q.step === step).sort((a, b) => a.cause.id - b.cause.id || a.target - b.target);
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k].step <= step) queue.splice(k, 1);
    let processed = 0;
    for (const q of due) {
      const st = states[q.target];
      const effect = q.rule.effect;
      const last = st.lastResponse[effect];
      const refractory = effect === 'imitate' || effect === 'yield' ? REFRACTORY_V11[effect] : REFRACTORY[effect];
      if (last !== undefined && step - last < refractory) continue;
      if (processed >= config.maxResponsesPerStep) {
        stats.suppressedResponses++;
        continue;
      }
      const cause: EventCause = { event: q.cause.id, rule: effect, from_instrument: q.cause.instrument };
      const depth = q.cause.depth + 1;
      const senderMidi = q.cause.midi ?? degreeToMidi(rootPc, scale, states[q.cause.instrument].degree);
      const strength = effect === 'imitate' || effect === 'yield' ? q.rule.strength : Math.sqrt(q.rule.strength);
      let produced: GenEvent | null = null;
      if (effect === 'resonate') {
        if (!canPlay || step < st.busyResonanceUntil) continue;
        let midi = clampToRange(st, senderMidi);
        if (Math.abs(midi - senderMidi) % 12 !== 0) midi = clampToRange(st, senderMidi + 7);
        const velocity = Math.round(clamp(0.22 + 0.45 * strength * arc.coupling * st.dna.interaction_rules.sensitivity, 0.15, 0.75) * 1e4) / 1e4;
        const duration = Math.round(clamp(0.5 + st.dna.resonance.ring * 0.45, 0.4, 3.5) * 1e4) / 1e4;
        wake(q.target, step, cause, depth);
        produced = push({ step, instrument: q.target, kind: 'resonance', depth, origin: 'response', midi, velocity, duration, timbre: Math.round(st.timbre * 1e4) / 1e4, cause });
        sounding.push([q.target, midi, step + Math.round(duration / stepSec)]);
        st.busyResonanceUntil = step + Math.ceil((duration / stepSec) * 0.6);
        st.resonance = Math.min(1, st.resonance + 0.35);
        st.energy += 0.08;
        stats.resonances++;
      } else if (effect === 'timbre') {
        const before = st.timbre;
        const prev = states[q.cause.instrument].prevMidi;
        const dir = prev === null || senderMidi === prev ? (st.timbre <= 0 ? 1 : -1) : senderMidi > prev ? 1 : -1;
        st.timbre = clamp(st.timbre + dir * 0.32 * strength, -1, 1);
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
        if (st.rhythm.pulses === st.dna.rhythm.pulses + 3) st.rhythm.pulses--;
        if (rhythmLabel(st.rhythm) === before) continue;
        st.pattern = euclid(st.rhythm.steps, st.rhythm.pulses, st.rhythm.rotation);
        wake(q.target, step, cause, depth);
        st.energy += 0.1;
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'rhythm', from: before, to: rhythmLabel(st.rhythm), cause });
      } else if (effect === 'entrain') {
        const before = st.rhythm.rotation;
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
        // v1.1: among the consonant intervals to the sender, the one least rough against everything sounding
        const options = [-12, -9, -8, -5, 3, 4, 7, 12]
          .map((iv) => degreeToMidi(rootPc, scale, midiToDegree(rootPc, scale, senderMidi + iv)))
          .filter((m) => m >= st.dna.pitch_range.low && m <= st.dna.pitch_range.high && m !== senderMidi);
        if (!options.length) continue;
        const current = degreeToMidi(rootPc, scale, st.degree);
        options.sort((a, b) => roughAgainst(q.target, a, step) - roughAgainst(q.target, b, step) || Math.abs(a - current) - Math.abs(b - current) || a - b);
        st.pendingPitch = options[0];
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'pitch', from: current, to: options[0], cause });
      } else if (effect === 'imitate') {
        const src = states[q.cause.instrument];
        const phrase = src.recent.slice(-3);
        // only instruments that move fast enough to answer within a phrase, and only phrases that move
        if (!canPlay || phrase.length < 3 || new Set(phrase).size < 2 || st.rhythm.rate < 0.5 || st.motifQueue.length || !st.awake || step > finalStep - phraseSteps / 2) continue;
        // the whole phrase moves by octaves into the receiver's register, so its contour survives
        let shift = 0;
        let bestFit = -1;
        for (let o = -36; o <= 36; o += 12) {
          const fit = phrase.filter((m) => m + o >= st.dna.pitch_range.low && m + o <= st.dna.pitch_range.high).length * 100 - Math.abs(phrase[0] + o - st.dna.pitch_range.center);
          if (fit > bestFit) {
            bestFit = fit;
            shift = o;
          }
        }
        const answer = phrase.map((m) => midiToDegree(rootPc, scale, m + shift));
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'imitate', from: src.recent.slice(-3).join(' '), to: answer.map((d) => degreeToMidi(rootPc, scale, d)).join(' '), cause });
        st.motifQueue = answer.map((d) => ({ degree: d, cause: { event: produced!.id, rule: 'imitate', from_instrument: q.cause.instrument }, depth: depth + 1, until: step + phraseSteps }));
        st.energy += 0.15;
        statsV11.imitations++;
      } else if (effect === 'yield') {
        // how busy are the others over the last bar?
        const busy = events.filter((e) => e.kind === 'note' && e.instrument !== q.target && e.step > step - 16).length;
        if (busy < 6 * strength + 4 || !st.awake) continue;
        st.restUntil = step + 16;
        produced = push({ step, instrument: q.target, kind: 'mutation', depth, origin: 'response', param: 'yield', from: `${busy} notes/bar`, to: 'rests 1 bar', cause });
        statsV11.yields++;
      }
      if (!produced) continue;
      if (produced.kind === 'mutation') stats.mutations++;
      st.lastResponse[effect] = step;
      if (effect in stats.byRule) stats.byRule[effect as InteractionEffect]++;
      const pair = `${q.cause.instrument}->${q.target}`;
      stats.byPair[pair] = (stats.byPair[pair] ?? 0) + 1;
      processed++;
      if (effect !== 'yield') emit(produced, step, arc.coupling);
    }
    stats.maxResponsesInStep = Math.max(stats.maxResponsesInStep, processed);

    if (step % 4 === 0) {
      snapshots.push({
        step,
        time: Math.round(step * stepSec * 1e4) / 1e4,
        arc: { density: round3(arc.density), coupling: round3(arc.coupling) },
        instruments: states.map((st) => ({ energy: round3(st.energy), timbre: round3(st.timbre), resonance: round3(st.resonance), pulses: st.rhythm.pulses, rotation: st.rhythm.rotation, awake: st.awake })),
      });
    }
  }
  statsV11.meanRoughness = round3(roughSum / Math.max(1, roughN));

  return {
    engine_version: GENERATOR_V11_VERSION,
    config: { ...config, bpm },
    bpm,
    stepSec,
    totalSteps,
    key: { root_pc: rootPc, mode, scale, reason: `主音は最も働きかけの強い楽器「${dnas[initiator].name}」の主音、旋法は3楽器の明るさ平均 ${round3(brightness)} から選択` },
    instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, name: d.name, dna_hash: d.dna_hash })),
    events,
    snapshots,
    stats,
    chains: findChains(events, dnas),
    phrases,
    finalChord,
    statsV11,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
