/**
 * SONOVA 003 — 音楽が自分を修復する (the music repairs itself)
 *
 * Three image instruments play a score (bass = sunset, pad = tower, melody = bark). A seeded
 * fault process breaks it: a part drops out (欠落) or plays wrong notes (不協和). A listener
 * analyses the *rendered audio* of every bar (score-informed presence per part, out-of-harmony
 * spectral energy, roughness) and, one bar later, another instrument repairs:
 *   dropout of melody → the pad covers the melody (an octave away)
 *   dropout of bass   → the pad plays the roots
 *   dropout of pad    → the melody instrument arpeggiates the chord
 *   wrong notes       → the bass re-harmonises: it changes the root so the wrong note becomes a chord tone
 * Repairs stop when the listener hears the original part healthy again. The same piece is also
 * rendered without repairs for comparison.
 */
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { Rng, clamp, euclid } from '@sonova/instrument-dna';
import { averageSpectrum, energyAtDb, roughness, spectralPeaks } from '@sonova/source-analyzer';
import { createBus, fadeEdges, master, midiToHz, mixInto, renderVoice, reverb, type MasterReport, type StereoBuffer } from '@sonova/synthesis-engine';

export const HEAL_VERSION = 'sonova-heal/1.0.0';

export type HealPart = 'bass' | 'pad' | 'melody';
export interface HealNote {
  part: HealPart;
  /** who actually plays it (differs from `part` for repairs) */
  player: HealPart;
  time: number;
  midi: number;
  duration: number;
  velocity: number;
  role: 'score' | 'fault' | 'repair';
}

export interface Fault {
  kind: 'dropout' | 'wrong';
  part: HealPart;
  startBar: number;
  bars: number;
}

export interface HealEvent {
  id: number;
  bar: number;
  time: number;
  kind: 'fault' | 'detect' | 'repair' | 'recover';
  part: HealPart;
  by?: HealPart;
  text: string;
  cause?: number;
  metrics?: Record<string, number>;
}

export interface BarMetrics {
  bar: number;
  presenceDb: Record<HealPart, number>;
  wrongnessDb: Record<HealPart, number>;
  foreign: number;
  roughness: number;
  health: number;
}

export interface HealResult {
  engine_version: string;
  seed: string;
  bpm: number;
  barSec: number;
  durationSec: number;
  key: { root_pc: number; mode: string };
  progression: number[];
  faults: Fault[];
  events: HealEvent[];
  metrics: BarMetrics[];
  notes: HealNote[];
  buffer: StereoBuffer;
  master: MasterReport;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Triad on a root (pitch class offset from the key) in natural minor. */
function triad(rootOff: number): number[] {
  const deg = MINOR.indexOf(((rootOff % 12) + 12) % 12);
  if (deg < 0) return [rootOff, rootOff + 4, rootOff + 7];
  return [0, 2, 4].map((k) => {
    const d = deg + k;
    return MINOR[d % 7] + 12 * Math.floor(d / 7) + (rootOff - MINOR[deg]);
  });
}

export function renderHeal(band: { bass: InstrumentDNA; pad: InstrumentDNA; melody: InstrumentDNA }, seed: string, opts: { repair: boolean; bars?: number } = { repair: true }, sampleRate = 44100): HealResult {
  const rng = new Rng(`heal:${seed}`);
  const bars = opts.bars ?? 32;
  const bpm = 100;
  const barSec = (60 / bpm) * 4;
  const slot = barSec / 8;
  const rootPc = band.melody.pitch_range.root_pc;
  const progression = [0, 8, 3, 10];
  const dna: Record<HealPart, InstrumentDNA> = { bass: band.bass, pad: band.pad, melody: band.melody };
  const range: Record<HealPart, [number, number]> = { bass: [36, 52], pad: [52, 67], melody: [67, 84] };
  const fold = (m: number, [lo, hi]: [number, number]) => {
    let x = m;
    while (x < lo) x += 12;
    while (x > hi) x -= 12;
    return x;
  };

  // ---- Faults (same for the repaired and the broken render) ----
  const frng = new Rng(`heal-faults:${seed}`);
  const faultPlan: Array<[Fault['kind'], HealPart, number, number]> = [
    ['dropout', 'melody', 5, 8],
    ['wrong', 'melody', 10, 13],
    ['dropout', 'bass', 14, 17],
    ['wrong', 'pad', 19, 22],
    ['dropout', 'pad', 24, 27],
  ];
  const faults: Fault[] = faultPlan.map(([kind, part, lo, hi]) => ({ kind, part, startBar: frng.int(lo, hi - 1), bars: frng.int(3, 4) }));
  const faultAt = (bar: number, part: HealPart) => faults.find((f) => f.part === part && bar >= f.startBar && bar < f.startBar + f.bars);

  // ---- Score ----
  const melRhythm = euclid(8, clamp(band.melody.rhythm.pulses + 1, 3, 7), band.melody.rhythm.rotation % 8);
  const melodyScore: number[][] = [];
  let deg = 2;
  for (let b = 0; b < bars; b++) {
    const chord = triad(progression[b % 4]);
    const line: number[] = [];
    for (let s = 0; s < 8; s++) {
      if (!melRhythm[s]) {
        line.push(-1);
        continue;
      }
      if (s === 0) deg = chord[rng.int(0, 2)];
      else deg = MINOR[((MINOR.indexOf(((deg % 12) + 12) % 12) + rng.pick([-1, 1, 1, 2, -2])) % 7 + 7) % 7];
      line.push(fold(60 + rootPc + deg, range.melody));
    }
    melodyScore.push(line);
  }

  const total = bars * barSec + 4;
  const bus = createBus(total, sampleRate);
  const wet = createBus(total, sampleRate);
  const mono = new Float32Array(bus.left.length);
  // What the repairs themselves sound like: the listener subtracts its own repair sound before judging.
  const repairMono = new Float32Array(bus.left.length);
  const notes: HealNote[] = [];
  const events: HealEvent[] = [];
  const metrics: BarMetrics[] = [];
  let eid = 0;
  const log = (e: Omit<HealEvent, 'id' | 'time'>) => {
    const ev = { id: eid++, time: r3(e.bar * barSec), ...e };
    events.push(ev);
    return ev;
  };
  const PAN: Record<HealPart, number> = { bass: 0, pad: -0.35, melody: 0.35 };
  const play = (n: HealNote, b: number) => {
    const v = renderVoice(dna[n.player], { midi: n.midi, velocity: n.velocity, duration: n.duration, timbre: 0, kind: 'note' }, sampleRate, `${seed}:${b}:${n.player}:${n.time}:${n.midi}`);
    const gain = n.player === 'bass' ? 0.9 : n.player === 'pad' ? 0.42 : 0.55;
    mixInto(bus, v, n.time, PAN[n.player], gain);
    mixInto(wet, v, n.time, PAN[n.player], gain * 0.25);
    const s = Math.round(n.time * sampleRate);
    for (let i = 0; i < v.length && s + i < mono.length; i++) {
      mono[s + i] += v[i] * gain;
      if (n.role === 'repair') repairMono[s + i] += v[i] * gain;
    }
    notes.push(n);
  };

  // Active repairs: part → {by, sinceEvent}
  const repairs = new Map<HealPart, { by: HealPart; cause: number; kind: 'cover' | 'reharm'; root?: number }>();
  const baseline: Record<HealPart, number[]> = { bass: [], pad: [], melody: [] };
  const foreignBase: number[] = [];
  const announced = new Set<Fault>();

  for (let b = 0; b < bars; b++) {
    const t0 = b * barSec;
    const chordOff = progression[b % 4];
    let soundingRoot = chordOff;
    const reharm = [...repairs.values()].find((r) => r.kind === 'reharm');
    if (reharm && reharm.root !== undefined) soundingRoot = reharm.root;
    const chord = triad(chordOff);

    // Ground-truth fault events (the listener does not read these).
    for (const f of faults) {
      if (f.startBar === b && !announced.has(f)) {
        announced.add(f);
        log({ bar: b, kind: 'fault', part: f.part, text: f.kind === 'dropout' ? `${f.part} が ${f.bars} 小節消える (故障の注入)` : `${f.part} が ${f.bars} 小節、半音ずれた音を弾く (故障の注入)` });
      }
    }

    // ---- Score parts, with faults applied ----
    const scoreNotes: Record<HealPart, HealNote[]> = { bass: [], pad: [], melody: [] };
    scoreNotes.bass.push({ part: 'bass', player: 'bass', time: t0, midi: fold(36 + rootPc + chordOff, range.bass), duration: barSec * 0.48, velocity: 0.85, role: 'score' });
    scoreNotes.bass.push({ part: 'bass', player: 'bass', time: t0 + barSec / 2, midi: fold(36 + rootPc + chordOff + 7, range.bass), duration: barSec * 0.45, velocity: 0.75, role: 'score' });
    for (const c of chord) scoreNotes.pad.push({ part: 'pad', player: 'pad', time: t0, midi: fold(48 + rootPc + c, range.pad), duration: barSec * 0.95, velocity: 0.6, role: 'score' });
    melodyScore[b].forEach((m, s) => m >= 0 && scoreNotes.melody.push({ part: 'melody', player: 'melody', time: t0 + s * slot, midi: m, duration: slot * 1.3, velocity: 0.7, role: 'score' }));

    for (const part of ['bass', 'pad', 'melody'] as HealPart[]) {
      const f = faultAt(b, part);
      if (f?.kind === 'dropout') continue;
      for (const n of scoreNotes[part]) {
        const wrong = f?.kind === 'wrong' && (part === 'pad' ? n.midi === scoreNotes.pad[1].midi : rng.next() < 0.7);
        // A wrong note is a semitone off, on the side that leaves the key.
        const inKey = (m: number) => MINOR.includes((((m - rootPc) % 12) + 12) % 12);
        const off = inKey(n.midi + 1) ? n.midi - 1 : n.midi + 1;
        play(wrong ? { ...n, midi: off, role: 'fault' } : n, b);
      }
    }

    // ---- Repairs scheduled from earlier detections ----
    if (opts.repair) {
      for (const [part, r] of repairs) {
        if (r.kind === 'cover') {
          if (part === 'melody') for (const n of scoreNotes.melody) play({ ...n, player: r.by, midi: fold(n.midi - 12, range[r.by]), velocity: 0.62, role: 'repair' }, b);
          if (part === 'bass') for (const n of scoreNotes.bass) play({ ...n, player: r.by, midi: fold(n.midi + 12, range[r.by]), velocity: 0.75, role: 'repair' }, b);
          if (part === 'pad') for (let s = 0; s < 8; s++) play({ part: 'pad', player: r.by, time: t0 + s * slot, midi: fold(60 + rootPc + chord[s % 3] + (s >= 4 ? 12 : 0), range[r.by]), duration: slot * 1.1, velocity: 0.55, role: 'repair' }, b);
        } else if (r.kind === 'reharm' && r.root !== undefined) {
          // The bass plays the new root an octave below its normal line so it is heard as harmony, not as the bass part.
          play({ part, player: r.by, time: t0, midi: fold(36 + rootPc + r.root, [28, 47]), duration: barSec * 0.9, velocity: 0.8, role: 'repair' }, b);
        }
      }
    }

    // ---- Listen to this bar ----
    const a = Math.round((t0 + 0.08) * sampleRate);
    const z = Math.round((t0 + barSec) * sampleRate);
    const heard = averageSpectrum(mono, sampleRate, a, z);
    const own = averageSpectrum(repairMono, sampleRate, a, z);
    // Residual = what was heard minus the listener's own repair sound.
    const spec = { mag: heard.mag.map((m, k) => Math.max(0, m - own.mag[k])), binHz: heard.binHz };
    // Fine resolution (≈1.3 Hz) for judging low fundamentals.
    const heardFine = averageSpectrum(mono, sampleRate, a, z, 32768);
    const ownFine = averageSpectrum(repairMono, sampleRate, a, z, 32768);
    const fine = { mag: heardFine.mag.map((m, k) => Math.max(0, m - ownFine.mag[k])), binHz: heardFine.binHz };
    const all = energyAtDb(spec, [30, 60, 120, 240, 480, 960, 1920, 3840].map((f) => f * 1.414), 600);
    const presence = {} as Record<HealPart, number>;
    for (const part of ['bass', 'pad', 'melody'] as HealPart[]) presence[part] = r3(energyAtDb(spec, scoreNotes[part].map((n) => midiToHz(n.midi)), 35) - all);
    const peaks = spectralPeaks(spec, 20, 50, 2500);
    const harmonyPcs = new Set([...triad(soundingRoot), ...chord].map((c) => (((rootPc + c) % 12) + 12) % 12));
    const pcOf = (hz: number) => (((Math.round(12 * Math.log2(hz / 440)) + 9) % 12) + 12) % 12;
    // Only fundamentals and low partials count: harmonics far above are judged by their fundamentals.
    const lowPeaks = peaks.filter((p) => p.hz < 1200);
    const tot = lowPeaks.reduce((s, p) => s + p.amp * p.amp, 0) || 1;
    const foreignToOriginal = lowPeaks.filter((p) => !new Set(chord.map((c) => (((rootPc + c) % 12) + 12) % 12)).has(pcOf(p.hz)) && MINOR.every((m) => (rootPc + m) % 12 !== pcOf(p.hz))).reduce((s, p) => s + p.amp * p.amp, 0) / tot;
    const foreign = r3(lowPeaks.filter((p) => !harmonyPcs.has(pcOf(p.hz))).reduce((s, p) => s + p.amp * p.amp, 0) / tot);
    const rough = r3(roughness(peaks));

    // Score following: energy on the written pitches vs. a semitone either side, per part (dB).
    const wrongness = {} as Record<HealPart, number>;
    for (const part of ['bass', 'pad', 'melody'] as HealPart[]) {
      // Low notes are judged on a harmonic ≥ 180 Hz, where the FFT can tell a semitone apart.
      const h = (m: number) => (part === 'bass' ? 1 : Math.max(1, Math.ceil(180 / midiToHz(m))));
      const sp = part === 'bass' ? fine : spec;
      const written = scoreNotes[part].map((n) => midiToHz(n.midi) * h(n.midi));
      // Per written note: are its neighbours louder than it? The worst note decides.
      let worst = -Infinity;
      for (const n of scoreNotes[part]) {
        const w = midiToHz(n.midi) * h(n.midi);
        // Neighbours that coincide with another part's written notes (or their harmonics) are not evidence.
        const others = (['bass', 'pad', 'melody'] as HealPart[]).filter((q) => q !== part).flatMap((q) => scoreNotes[q].flatMap((o) => [1, 2, 3, 4, 5, 6].map((k) => midiToHz(o.midi) * k)));
        const nb = [midiToHz(n.midi - 1) * h(n.midi), midiToHz(n.midi + 1) * h(n.midi)].filter((f) => [...written, ...others].every((x) => Math.abs(1200 * Math.log2(f / x)) > 50));
        if (!nb.length) continue;
        worst = Math.max(worst, energyAtDb(sp, nb, 30) - energyAtDb(sp, [w], 30));
      }
      wrongness[part] = r3(Number.isFinite(worst) ? worst : -60);
    }
    const median = (xs: number[]) => (xs.length ? [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] : NaN);
    const missing: HealPart[] = [];
    for (const part of ['bass', 'pad', 'melody'] as HealPart[]) {
      const base = median(baseline[part]);
      if (b >= 2 && presence[part] < base - 10) missing.push(part);
      else if (!faultAt(b, part) || b < 2) baseline[part].push(presence[part]);
    }
    // A part is off when its semitone neighbours are louder than its written notes.
    const offParts = (['melody', 'pad', 'bass'] as HealPart[]).filter((p) => !missing.includes(p) && wrongness[p] > 3);
    const dissonant = b >= 2 && offParts.length > 0;
    void foreignToOriginal;
    void foreignBase;
    // Health: a part's role counts as filled if the listener hears it, or hears another instrument covering it
    // (repairs sounding in this bar); wrong notes count unless a re-harmonisation is sounding.
    const covered = new Set([...repairs.entries()].filter(([, r]) => r.kind === 'cover').map(([p]) => p));
    const reharmSounding = [...repairs.values()].some((r) => r.kind === 'reharm');
    const unfilled = missing.filter((p) => !covered.has(p)).length;
    const health = r3(clamp(1 - unfilled / 3 - (dissonant && !reharmSounding ? 0.4 : 0) - Math.max(0, foreign - 0.1), 0, 1));
    metrics.push({ bar: b, presenceDb: presence, wrongnessDb: wrongness, foreign, roughness: rough, health });

    if (!opts.repair) continue;
    // ---- Decide repairs for the next bar ----
    for (const part of ['bass', 'pad', 'melody'] as HealPart[]) {
      const isMissing = missing.includes(part);
      const active = repairs.get(part);
      if (isMissing && !active) {
        const det = log({ bar: b, kind: 'detect', part, text: `${part} の音が楽譜の音高で ${(presence[part] - median(baseline[part])).toFixed(1)} dB 足りない (欠落)`, metrics: { presenceDb: presence[part], baselineDb: median(baseline[part]) } });
        const by: HealPart = part === 'melody' ? 'pad' : part === 'bass' ? 'pad' : 'melody';
        repairs.set(part, { by, cause: det.id, kind: 'cover' });
        log({ bar: b + 1, kind: 'repair', part, by, cause: det.id, text: part === 'pad' ? `${by} が和音をアルペジオで補う` : `${by} が ${part} のパートを${part === 'melody' ? '1オクターブ下' : '1オクターブ上'}で引き受ける` });
      } else if (!isMissing && active?.kind === 'cover') {
        repairs.delete(part);
        log({ bar: b, kind: 'recover', part, by: active.by, cause: active.cause, text: `${part} が戻ったのを聴いて ${active.by} は補完をやめる`, metrics: { presenceDb: presence[part] } });
      }
    }
    const reharmActive = [...repairs.entries()].find(([, r]) => r.kind === 'reharm');
    if (dissonant && !reharmActive) {
      // The culprit is the part that is most off; the wrong pitch is its loudest semitone neighbour.
      const culprit = offParts.sort((p, q) => wrongness[q] - wrongness[p])[0];
      let fpc = rootPc;
      let loud = -Infinity;
      for (const n of scoreNotes[culprit])
        for (const d of [-1, 1]) {
          const e = energyAtDb(spec, [midiToHz(n.midi + d)], 30);
          if (e > loud) {
            loud = e;
            fpc = (((n.midi + d) % 12) + 12) % 12;
          }
        }
      const det = log({ bar: b, kind: 'detect', part: culprit, text: `${culprit} の楽譜の音より半音隣りが ${wrongness[culprit].toFixed(1)} dB 強い → ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][fpc]} がずれている (不協和)`, metrics: { wrongnessDb: wrongness[culprit], roughness: rough } });
      // Re-harmonise: among chords whose root is a semitone/third/fourth from the written root, pick one containing the foreign pc and most written notes.
      const nextChord = triad(progression[(b + 1) % 4]);
      let best: { root: number; score: number } | null = null;
      for (let root = 0; root < 12; root++) {
        const tones = [root, root + 4, root + 7, root + 10].map((x) => (((rootPc + x) % 12) + 12) % 12);
        const tonesMinor = [root, root + 3, root + 7, root + 10].map((x) => (((rootPc + x) % 12) + 12) % 12);
        for (const t of [tones, tonesMinor]) {
          if (!t.includes(fpc)) continue;
          const keep = nextChord.filter((c) => t.includes((((rootPc + c) % 12) + 12) % 12)).length;
          const score = keep * 2 - (MINOR.includes(root) ? 0 : 1);
          if (!best || score > best.score) best = { root, score };
        }
      }
      if (best) {
        const by: HealPart = culprit === 'bass' ? 'pad' : 'bass';
        repairs.set(culprit, { by, cause: det.id, kind: 'reharm', root: best.root });
        log({ bar: b + 1, kind: 'repair', part: culprit, by, cause: det.id, text: `${by} が根音を ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][(rootPc + best.root) % 12]} に変え、ずれた音を和音の音にする (リハーモナイズ)` });
      }
    } else if (!dissonant && reharmActive) {
      repairs.delete(reharmActive[0]);
      log({ bar: b, kind: 'recover', part: reharmActive[0], by: reharmActive[1].by, cause: reharmActive[1].cause, text: `ずれが消えたのを聴いて ${reharmActive[1].by} は元の和声に戻る`, metrics: { wrongnessDb: wrongness[reharmActive[0]] } });
    }
  }

  const [rl, rr] = reverb(wet.left, wet.right, { roomSize: 0.6, damping: 0.5, sampleRate });
  for (let i = 0; i < bus.left.length; i++) {
    bus.left[i] += rl[i];
    bus.right[i] += rr[i];
  }
  fadeEdges(bus.left, bus.right, sampleRate, 0.01, 2.5);
  const rep = master(bus.left, bus.right, { sampleRate, targetRmsDb: -16, ceilingDb: -1, maxGainDb: 18 });
  return { engine_version: HEAL_VERSION, seed, bpm, barSec: r3(barSec), durationSec: r3(total), key: { root_pc: rootPc, mode: 'aeolian' }, progression, faults, events, metrics, notes, buffer: bus, master: rep };
}
