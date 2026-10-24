/**
 * Quality of a 30-second piece, measured from its events and its audio. These are SONOVA's own
 * criteria, written down so they can be argued with: each one has a target and a reason.
 *  - continuity: no hole longer than 2 s without a new note (before the ending)
 *  - arc: the note density follows the arc's density as the generator applied it (the piece does what its form says)
 *  - consonance: mean roughness of overlapping notes (Plomp–Levelt); lower = clearer harmony
 *  - motif: share of 3-note interval patterns that come back (memory), aiming at 25–60 % (not a loop, not noise)
 *  - interplay: share of notes and changes caused by another instrument, causal chains of depth ≥ 2, and
 *    dialogue: 3-note interval shapes that one instrument plays within 4 s after another played them
 *  - balance: how evenly the instruments share the notes (entropy)
 *  - ending: the last sounding notes are chords of the key, and the piece thins out before the ring-out
 *  - dynamics: loudness range of the audio (10th–90th percentile of 400 ms RMS), aiming at 5–14 dB
 */
import type { GenEvent, GeneratorResult } from '@sonova/music-generator';
import { midiToDegree, pairRoughness } from '@sonova/music-generator';

export interface PieceMetrics {
  maxGapSec: number;
  arcCorrelation: number;
  roughness: number;
  motifRecurrence: number;
  interplay: number;
  deepChains: number;
  dialogue: number;
  balance: number;
  endsOnChord: boolean;
  thinningEnd: number;
  loudnessRangeDb: number;
  score: number;
  parts: Record<string, number>;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
const peaked = (x: number, lo: number, hi: number, soft: number) => (x < lo ? Math.max(0, 1 - (lo - x) / soft) : x > hi ? Math.max(0, 1 - (x - hi) / soft) : 1);

/** the arc's density as the generator recorded it (snapshots every 4 steps), at time t */
function recordedArc(gen: GeneratorResult, t: number): number {
  let best = gen.snapshots[0];
  for (const s of gen.snapshots) if (s.time <= t) best = s;
  return best?.arc.density ?? 0;
}

export function measurePiece(gen: GeneratorResult, audio: { left: Float32Array; right: Float32Array; sampleRate: number }): PieceMetrics {
  const dur = gen.config.durationSec;
  const tail = gen.config.tailSec;
  const notes = gen.events.filter((e) => e.kind === 'note' || e.kind === 'resonance').sort((a, b) => a.time - b.time);
  // continuity
  let maxGap = notes.length ? notes[0].time : dur;
  for (let i = 1; i < notes.length; i++) if (notes[i].time < dur - tail - 2) maxGap = Math.max(maxGap, notes[i].time - notes[i - 1].time);
  // arc: onsets per 2 s window vs the arc's density in that window
  const W = 2;
  const win = Math.floor((dur - tail) / W);
  const dens = Array.from({ length: win }, (_, k) => notes.filter((n) => n.time >= k * W && n.time < (k + 1) * W).length);
  const arc = Array.from({ length: win }, (_, k) => recordedArc(gen, (k + 0.5) * W));
  const arcCorrelation = pearson(dens, arc);
  // consonance: overlapping pairs from different instruments, weighted by overlap
  let rs = 0;
  let rw = 0;
  for (let i = 0; i < notes.length; i++)
    for (let j = i + 1; j < notes.length && notes[j].time < notes[i].time + (notes[i].duration ?? 0); j++) {
      if (notes[i].instrument === notes[j].instrument) continue;
      const ov = Math.min(notes[i].time + (notes[i].duration ?? 0), notes[j].time + (notes[j].duration ?? 0)) - notes[j].time;
      if (ov <= 0) continue;
      rs += pairRoughness(notes[i].midi!, notes[j].midi!) * ov;
      rw += ov;
    }
  const roughness = rw > 0 ? rs / rw : 0;
  // motif: per instrument, 3-note interval patterns that occur more than once
  let grams = 0;
  let repeated = 0;
  const byInst = new Map<number, GenEvent[]>();
  for (const n of notes) if (n.kind === 'note') (byInst.get(n.instrument) ?? byInst.set(n.instrument, []).get(n.instrument)!).push(n);
  for (const seq of byInst.values()) {
    const iv = seq.slice(1).map((n, i) => n.midi! - seq[i].midi!);
    const count = new Map<string, number>();
    for (let i = 0; i + 2 <= iv.length; i++) {
      const g = `${iv[i]},${iv[i + 1]}`;
      count.set(g, (count.get(g) ?? 0) + 1);
    }
    for (const c of count.values()) {
      grams += c;
      if (c > 1) repeated += c;
    }
  }
  const motifRecurrence = grams ? repeated / grams : 0;
  // interplay
  const caused = gen.events.filter((e) => e.kind !== 'wake' && e.cause && e.cause.rule !== 'cadence').length;
  const interplay = caused / Math.max(1, gen.events.filter((e) => e.kind !== 'wake').length);
  const deepChains = gen.chains.filter((c) => c.depth >= 2).length;
  // dialogue: a 3-note phrase echoed by another instrument within 4 s
  const deg = (m: number) => midiToDegree(gen.key.root_pc, gen.key.scale, m);
  const shapes: Array<{ inst: number; time: number; g: string }> = [];
  // an echo: the same three pitch classes in the same melodic shape (octave transposition only)
  for (const [inst, seq] of byInst) for (let i = 2; i < seq.length; i++) shapes.push({ inst, time: seq[i - 2].time, g: `${seq[i - 2].midi! % 12}:${deg(seq[i - 1].midi!) - deg(seq[i - 2].midi!)},${deg(seq[i].midi!) - deg(seq[i - 1].midi!)}` });
  const echoed = shapes.filter((a) => !a.g.endsWith(':0,0') && shapes.some((b) => b.inst !== a.inst && b.g === a.g && a.time - b.time > 0.2 && a.time - b.time <= 4)).length;
  const dialogue = shapes.length ? echoed / shapes.length : 0;
  // balance
  const counts = gen.instruments.map((_, i) => notes.filter((n) => n.instrument === i).length);
  const tot = counts.reduce((s, c) => s + c, 0) || 1;
  const balance = -counts.reduce((s, c) => (c > 0 ? s + (c / tot) * Math.log(c / tot) : s), 0) / Math.log(counts.length || 2);
  // ending
  const lastStart = notes.length ? notes[notes.length - 1].time : 0;
  const lastNotes = notes.filter((n) => n.time >= lastStart - 0.6);
  const pcsKey = gen.key.scale;
  const triad = [0, pcsKey.find((x) => x === 3 || x === 4) ?? pcsKey[2], pcsKey.includes(7) ? 7 : pcsKey[Math.floor(pcsKey.length / 2) + 1]].map((x) => (gen.key.root_pc + x) % 12);
  const endsOnChord = lastNotes.length > 0 && lastNotes.every((n) => triad.includes(((n.midi! % 12) + 12) % 12));
  const endWin = (a: number, b: number) => notes.filter((n) => n.time >= a && n.time < b).length / (b - a);
  const playEnd = dur - tail;
  const thinningEnd = endWin(playEnd * 0.4, playEnd * 0.8) > 0 ? 1 - endWin(playEnd - 3, playEnd) / Math.max(1e-9, endWin(playEnd * 0.4, playEnd * 0.8)) : 0;
  // dynamics
  const sr = audio.sampleRate;
  const hop = Math.round(0.4 * sr);
  const lv: number[] = [];
  for (let a = 0; a + hop <= audio.left.length; a += hop) {
    let s = 0;
    for (let i = a; i < a + hop; i++) s += (audio.left[i] ** 2 + audio.right[i] ** 2) / 2;
    const db = 10 * Math.log10(s / hop + 1e-12);
    if (db > -60) lv.push(db);
  }
  lv.sort((p, q) => p - q);
  const loudnessRangeDb = lv.length ? lv[Math.floor(lv.length * 0.9)] - lv[Math.floor(lv.length * 0.1)] : 0;

  const parts = {
    continuity: peaked(maxGap, 0, 2, 2),
    arc: Math.max(0, arcCorrelation),
    consonance: Math.max(0, 1 - roughness / 0.25),
    motif: peaked(motifRecurrence, 0.25, 0.6, 0.25),
    interplay: Math.min(1, interplay / 0.5) * 0.4 + Math.min(1, deepChains / 10) * 0.2 + Math.min(1, dialogue / 0.1) * 0.4,
    balance,
    ending: (endsOnChord ? 0.6 : 0) + 0.4 * Math.max(0, Math.min(1, thinningEnd)),
    dynamics: peaked(loudnessRangeDb, 5, 14, 5),
  };
  const score = Object.values(parts).reduce((s, v) => s + v, 0) / Object.keys(parts).length;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    maxGapSec: r3(maxGap),
    arcCorrelation: r3(arcCorrelation),
    roughness: r3(roughness),
    motifRecurrence: r3(motifRecurrence),
    interplay: r3(interplay),
    deepChains,
    dialogue: r3(dialogue),
    balance: r3(balance),
    endsOnChord,
    thinningEnd: r3(thinningEnd),
    loudnessRangeDb: r3(loudnessRangeDb),
    score: r3(score),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r3(v)])),
  };
}
