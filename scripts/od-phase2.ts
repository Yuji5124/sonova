/**
 * SONOVA — ORCHESTRA × DIGITAL · Phase 2: four short experiments, each testing one unifying principle.
 *   EXP-A SHARED CYCLE   rhythm bridge     — 3/4 orchestra in D minor vs 4/4 electronics in F♯ lydian, one 2-s cycle   (Q1)
 *   EXP-B CONTOUR        motif bridge      — one gesture, two pitch worlds (diatonic / octatonic), handed back and forth (Q2)
 *   EXP-C BREATH         dynamics bridge   — free-time chorale vs 137-BPM pulse, sharing only crescendo, silence, climax (Q3)
 *   EXP-D BOW INTO WIRE  timbre bridge     — a cello note morphs continuously into a digital one; a glitch rhythm becomes strings (Q4, Q5)
 * Usage: npm run od:phase2 [-- A|B|C|D]     samples: npm run od:fetch (or VSCO_DIR=...)
 * Output: output/orchestra-digital/phase2/<id>/ (48 kHz/24-bit WAV, MP3, stems), experiments/orchestra-digital/phase2/ (MIDI, JSON, REPORT)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng, euclid } from '@sonova/instrument-dna';
import { Biquad } from '@sonova/synthesis-engine';
import {
  INSTRUMENTS,
  SampleLibrary,
  Track,
  additive,
  analyseTimbre,
  articulationFor,
  click,
  dust,
  encodeWav24,
  fm,
  glitch,
  grains,
  kick,
  loudness,
  mixdown,
  noiseHit,
  playNote,
  toMidi,
  type HallSpec,
  type Score,
  type ScoreNote,
  type ScorePart,
  type Stereo,
} from '@sonova/orchestra-engine';
import { ROOT } from './lib.ts';

const SR = 48000;
const lib = new SampleLibrary(process.env.VSCO_DIR ?? join(ROOT, 'vendor', 'VSCO-2-CE'));
const only = process.argv[2]?.toUpperCase();
const OUT = join(ROOT, 'output/orchestra-digital/phase2');
const EXP = join(ROOT, 'experiments/orchestra-digital/phase2');
mkdirSync(EXP, { recursive: true });
const HALL: HallSpec = { room: [26, 38, 15], rt60: 2.3, predelay: 0.022, seed: 'od-hall' };

// ---- shared material: the ORIGIN motif (used again in the full piece) ----
/** D F E B♭ A — up a minor third, down a semitone, up a tritone, down a semitone; long-short-short-medium-long */
const MOTIF = { steps: [0, 3, 2, 8, 7], beats: [1.5, 0.5, 0.5, 1, 2] };

// ---- helpers ----
interface Exp {
  id: string;
  title: string;
  question: string;
  bridge: string;
  seconds: number;
  parts: ScorePart[];
  tracks: Track[];
  notes: string[];
}

function newExp(id: string, title: string, question: string, bridge: string, seconds: number): Exp {
  return { id, title, question, bridge, seconds, parts: [], tracks: [], notes: [] };
}

function track(e: Exp, id: string, name: string, kind: 'orchestra' | 'electronic', pan: number, depth: number, width = 1): Track {
  const t = new Track(id, name, kind, { pan, depth, width }, Math.ceil((e.seconds + 3.5) * SR));
  e.tracks.push(t);
  return t;
}

function part(e: Exp, id: string, name: string, kind: 'orchestra' | 'electronic', instrument: string): ScorePart {
  const p: ScorePart = { id, name, kind, instrument, notes: [] };
  e.parts.push(p);
  return p;
}

/** play orchestral notes into a track and log them in the score */
function orch(t: Track, p: ScorePart, notes: ScoreNote[], art: string, extra: { fadeIn?: number; gainDb?: number } = {}): void {
  for (const n of notes) {
    p.notes.push({ ...n, art: n.art ?? art });
    t.add(playNote(lib, p.instrument, n.art ?? art, n.midi, n.vel, n.dur, SR, { ...extra, cents: n.cents }), n.t, SR);
  }
}

/** scale a track so its active RMS (50-ms blocks above -60 dBFS) sits at `db` dBFS */
function level(t: Track, db: number): void {
  const w = Math.round(0.05 * SR);
  let s = 0;
  let c = 0;
  for (let b = 0; b < t.left.length; b += w) {
    let e = 0;
    for (let i = b; i < Math.min(t.left.length, b + w); i++) e += t.left[i] ** 2 + t.right[i] ** 2;
    const r = Math.sqrt(e / (2 * w));
    if (r > 1e-3) {
      s += e;
      c += 2 * w;
    }
  }
  const rms = c ? Math.sqrt(s / c) : 0;
  if (!rms) return;
  const g = Math.pow(10, db / 20) / rms;
  for (let i = 0; i < t.left.length; i++) {
    t.left[i] *= g;
    t.right[i] *= g;
  }
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// =============================================================================================
// EXP-A SHARED CYCLE — different harmony and metre, one cycle and shared accents
// =============================================================================================
function expA(): Exp {
  const e = newExp('EXP-A', 'SHARED CYCLE', '1. 異なるコード進行でも統一感が生まれるか', 'RHYTHM BRIDGE (共通周期 2 秒・アクセント共有) + 音域の分離', 30);
  const cyc = 2.0; // 1 bar of 3/4 at 90 = 1 bar of 4/4 at 120
  const ob = cyc / 3; // orchestra beat
  const es = cyc / 16; // electronic 16th
  const bars = 15;
  // orchestra: D minor, 3/4
  const prog = [
    { root: 38, tones: [62, 65, 69] }, // Dm
    { root: 34, tones: [62, 65, 70] }, // B♭
    { root: 31, tones: [62, 67, 70] }, // Gm
    { root: 33, tones: [61, 64, 69] }, // A
  ];
  const dyn = (t: number) => 0.35 + 0.45 * smooth(0, 16, t) + 0.2 * smooth(16, 24, t) - 0.35 * smooth(24, 28, t);
  const vc = part(e, 'vc', 'Celli', 'orchestra', 'celli');
  const cb = part(e, 'cb', 'Contrabass', 'orchestra', 'contrabass');
  const va = part(e, 'va', 'Violas', 'orchestra', 'violas');
  const vn = part(e, 'vn', 'Violins (spiccato)', 'orchestra', 'violins');
  const vm = part(e, 'vm', 'Violins (motif)', 'orchestra', 'violins');
  const tp = part(e, 'tp', 'Timpani', 'orchestra', 'timpani');
  const tVc = track(e, 'vc', 'Celli', 'orchestra', 0.35, 0.35);
  const tCb = track(e, 'cb', 'Contrabass', 'orchestra', 0.5, 0.45);
  const tVa = track(e, 'va', 'Violas', 'orchestra', 0.15, 0.4);
  const tVn = track(e, 'vn', 'Violins spic', 'orchestra', -0.45, 0.35);
  const tVm = track(e, 'vm', 'Violins motif', 'orchestra', -0.25, 0.3);
  const tTp = track(e, 'tp', 'Timpani', 'orchestra', 0.1, 0.6);
  for (let b = 0; b < bars - 1; b++) {
    const c = prog[b % 4];
    const t = b * cyc;
    const v = dyn(t);
    orch(tVc, vc, [{ t, dur: cyc, midi: c.root + 12, vel: v * 0.9, why: 'root, 3/4 bar' }], 'sus');
    if (b >= 2) orch(tCb, cb, [{ t, dur: cyc, midi: c.root, vel: v * 0.8 }], 'sus');
    orch(tVa, va, [{ t, dur: cyc, midi: c.tones[0] - 12 + (b % 2 ? 0 : 3), vel: v * 0.7 }], 'sus');
    // violins: six spiccato eighths per bar, accent on beat 1
    const arp = [c.tones[0], c.tones[1], c.tones[2], c.tones[1] + 12, c.tones[2], c.tones[1]];
    if (b >= 1) arp.forEach((m, k) => orch(tVn, vn, [{ t: t + (k * ob) / 2, dur: ob / 2, midi: m + 12, vel: Math.min(1, v * (k === 0 ? 1.15 : k % 2 ? 0.7 : 0.85)) }], 'spic'));
    // timpani on every cycle downbeat (shared accent), stronger every 4 cycles
    if (b % 2 === 0 || b >= 8) orch(tTp, tp, [{ t, dur: 1.5, midi: c.root + 12 >= 45 ? c.root + 12 - 12 : c.root + 12, vel: b % 4 === 0 ? 0.95 : 0.6, why: 'shared cycle accent' }], 'hit');
  }
  // the motif in the violins over bars 6–11, in the orchestra's metre
  let mt = 6 * cyc;
  for (let rep = 0; rep < 2; rep++)
    MOTIF.steps.forEach((s, k) => {
      orch(tVm, vm, [{ t: mt, dur: MOTIF.beats[k] * ob * 2, midi: 74 + s, vel: 0.75, why: 'ORIGIN motif' }], 'sus');
      mt += MOTIF.beats[k] * ob * 2;
    });
  // final shared hit
  orch(tTp, tp, [{ t: 14 * cyc, dur: 3, midi: 38, vel: 1 }], 'hit');
  orch(tVc, vc, [{ t: 14 * cyc, dur: 2.5, midi: 38, vel: 0.9 }], 'sus');
  orch(tCb, cb, [{ t: 14 * cyc, dur: 2.5, midi: 26, vel: 0.9 }], 'sus');

  // electronics: F♯ lydian, 4/4 — FM bells above C5, kick on 1 and 3, glitchy hats; no sub (register control)
  const eprog = [
    [66, 70, 73, 77, 80], // F♯maj9
    [64, 68, 71, 75, 78], // Emaj9
    [61, 66, 68, 73, 75], // C♯sus
    [68, 71, 75, 78, 82], // G♯m9
  ];
  const bell = part(e, 'bell', 'FM bells', 'electronic', 'fm-bell');
  const kk = part(e, 'kick', 'Kick', 'electronic', 'kick');
  const hh = part(e, 'hat', 'Glitch hats', 'electronic', 'noise');
  const ds = part(e, 'dust', 'Dust', 'electronic', 'dust');
  const tBell = track(e, 'bell', 'FM bells', 'electronic', -0.1, 0.25, 0.9);
  const tKick = track(e, 'kick', 'Kick', 'electronic', 0, 0.15);
  const tHat = track(e, 'hat', 'Glitch hats', 'electronic', 0.3, 0.2);
  const tDust = track(e, 'dust', 'Dust', 'electronic', 0, 0.5);
  const rng = new Rng('od:A');
  tDust.add(dust(e.seconds, SR, 'A', { rate: (t) => 4 + 10 * smooth(0, 8, t) - 10 * smooth(24, 28, t), hz: 5200, q: 8 }), 0, SR, 0.6);
  ds.notes.push({ t: 0, dur: e.seconds, midi: 0, vel: 0.3, why: 'micro noise from the start' });
  const pattern = euclid(16, 7, 2);
  for (let b = 4; b < bars - 1; b++) {
    const t0 = b * cyc;
    const ch = eprog[b % 4];
    let idx = 0;
    for (let s = 0; s < 16; s++) {
      if (!pattern[s]) continue;
      const m = ch[idx++ % ch.length] + (s >= 8 ? 12 : 0);
      const v = 0.5 + 0.3 * dyn(t0) + (s === 0 ? 0.2 : 0);
      bell.notes.push({ t: t0 + s * es, dur: es * 1.5, midi: m, vel: v, why: 'euclid 7/16 over the cycle' });
      tBell.add(fm(m, es * 1.5, SR, { ratio: 3.5, index: 3.2, indexEnd: 0.15, indexTime: 0.12, env: { a: 0.002, d: 0.4, s: 0.0, r: 0.5 } }), t0 + s * es, SR, v * 0.5, (rng.next() - 0.5) * 0.8);
    }
    if (b >= 6) for (const s of [0, 8]) {
      kk.notes.push({ t: t0 + s * es, dur: 0.3, midi: 36, vel: s === 0 ? 1 : 0.8, why: s === 0 ? 'shared accent with the timpani' : '4/4 beat 3 — against the 3/4' });
      tKick.add(kick(SR, { hz: 44, drop: 3.5 }), t0 + s * es, SR, s === 0 ? 1 : 0.75);
    }
    if (b >= 7)
      for (let s = 0; s < 16; s++) {
        const p = s % 4 === 2 ? 0.85 : 0.25 + 0.4 * dyn(t0);
        if (rng.next() > p) continue;
        hh.notes.push({ t: t0 + s * es, dur: 0.05, midi: 42, vel: 0.5 });
        tHat.add(noiseHit(SR, `A${b}${s}`, { hp: 7500, decay: 0.02 + 0.03 * rng.next() }), t0 + s * es, SR, 0.4);
      }
  }
  // the end: one electronic bell on the final shared downbeat, F♯ against the orchestra's D
  tBell.add(fm(78, 2.5, SR, { ratio: 3.5, index: 2, indexEnd: 0.1, indexTime: 0.5, env: { a: 0.002, d: 1.2, s: 0.2, r: 1.5 } }), 14 * cyc, SR, 0.6);
  tKick.add(kick(SR, { hz: 40, drop: 4, decay: 0.4 }), 14 * cyc, SR, 1);
  const hats = tHat.left.slice();
  const g = glitch(hats, SR, [{ at: 22, len: 0.5, kind: 'stutter', slice: es / 2 }, { at: 26, len: 0.75, kind: 'crush', hold: 12 }]);
  tHat.left.set(g);
  tHat.right.set(glitch(tHat.right.slice(), SR, [{ at: 22, len: 0.5, kind: 'stutter', slice: es / 2 }, { at: 26, len: 0.75, kind: 'crush', hold: 12 }]));
  // balance (dBFS active RMS before the master)
  level(tVc, -24); level(tCb, -27); level(tVa, -27); level(tVn, -25); level(tVm, -23); level(tTp, -25);
  level(tBell, -25); level(tKick, -23); level(tHat, -31); level(tDust, -38);
  e.notes.push('オーケストラ: D minor (Dm–B♭–Gm–A), 3/4・90 BPM / 電子: F♯ lydian (F♯maj9–Emaj9–C♯sus–G♯m9), 4/4・120 BPM');
  e.notes.push('1 小節 = 2.0 秒が両方に共通。小節頭 (ティンパニとキック) だけが一致し、拍の中は 3 対 4 のポリリズム');
  e.notes.push('不協和の制御: 電子は C5 より上 (ベル) と 40 Hz 台のキックだけ、オーケストラは中低域。低音の F♯ は置かない');
  return e;
}

// =============================================================================================
// EXP-B CONTOUR — the same gesture in two pitch worlds, handed back and forth
// =============================================================================================
function contourToScale(scale: number[], startDeg: number, semis: number[]): number[] {
  // keep the contour and the size ranking: map each interval to a number of scale steps
  const out: number[] = [];
  let d = startDeg;
  const degOf = (k: number) => scale[((k % scale.length) + scale.length) % scale.length] + 12 * Math.floor(k / scale.length);
  out.push(degOf(d));
  for (let i = 1; i < semis.length; i++) {
    const iv = semis[i] - semis[i - 1];
    const steps = Math.sign(iv) * Math.max(1, Math.round(Math.abs(iv) / 1.5));
    d += steps;
    out.push(degOf(d));
  }
  return out;
}

function expB(): Exp {
  const e = newExp('EXP-B', 'CONTOUR', '2. 同じ旋律でなくても同じ音楽に聞こえるか', 'MOTIF BRIDGE (輪郭とリズム比だけを共有、音高の世界は別)', 32);
  const beat = 60 / 72;
  const octa = [0, 1, 3, 4, 6, 7, 9, 10]; // half–whole octatonic on C
  const O = MOTIF.steps.map((s) => 62 + s); // D F E B♭ A
  const E = contourToScale(octa, 0, MOTIF.steps).map((s) => 72 + s); // C E♭ D♭ G F♯ (contour kept)
  const vn = part(e, 'vn', 'Violins', 'orchestra', 'violins');
  const vc = part(e, 'vc', 'Celli', 'orchestra', 'celli');
  const pz = part(e, 'pz', 'Strings pizz', 'orchestra', 'violas');
  const hn = part(e, 'hn', 'Horn', 'orchestra', 'horn');
  const fmP = part(e, 'fm', 'FM glass', 'electronic', 'fm-glass');
  const gr = part(e, 'gr', 'Granular violins', 'electronic', 'granular');
  const gl = part(e, 'gl', 'Glitch rhythm', 'electronic', 'clicks');
  const tVn = track(e, 'vn', 'Violins', 'orchestra', -0.4, 0.3);
  const tVc = track(e, 'vc', 'Celli', 'orchestra', 0.35, 0.4);
  const tPz = track(e, 'pz', 'Pizz', 'orchestra', -0.15, 0.35);
  const tHn = track(e, 'hn', 'Horn', 'orchestra', 0.2, 0.55);
  const tFm = track(e, 'fm', 'FM glass', 'electronic', 0.1, 0.2, 0.8);
  const tGr = track(e, 'gr', 'Granular', 'electronic', 0, 0.45, 1);
  const tGl = track(e, 'gl', 'Glitch', 'electronic', 0.25, 0.15);
  const play = (pitches: number[], t0: number, beatSec: number, f: (m: number, t: number, d: number, k: number) => void) => {
    let t = t0;
    pitches.forEach((m, k) => {
      const d = MOTIF.beats[k] * beatSec;
      f(m, t, d, k);
      t += d;
    });
    return t;
  };
  // 0–9 s: violins state O twice; cello pedal; a granular halo cut from the violins' own A4
  let t = 0.3;
  for (let r = 0; r < 2; r++) t = play(O, t, beat, (m, tt, d) => orch(tVn, vn, [{ t: tt, dur: d * 1.02, midi: m + 12, vel: 0.7, why: 'motif O (D minor)' }], 'sus'));
  orch(tVc, vc, [{ t: 0, dur: 9, midi: 38, vel: 0.45 }], 'sus');
  const src = lib.pick('violins', 'sus', 81, 0.7).audio!;
  const halo = grains(src.channels[0], src.sampleRate, 32, SR, { position: (x) => 0.3 + 0.4 * (x / 32), pitch: (x) => (x < 18 ? 0 : -5), density: (x) => 18 + 40 * smooth(0, 9, x) - 30 * smooth(26, 31, x), grainSec: 0.12, spread: 0.05, seed: 'B' });
  tGr.add({ left: halo[0], right: halo[1] }, 0, SR, 1);
  gr.notes.push({ t: 0, dur: 32, midi: 81, vel: 0.4, why: "grains of the violins' own recorded A5" });
  // 9–18 s: electronics answer with E (faster), cellos answer in augmentation underneath
  t = 9;
  for (let r = 0; r < 2; r++)
    t = play(E, t, beat * 0.6, (m, tt, d) => {
      fmP.notes.push({ t: tt, dur: d, midi: m, vel: 0.7, why: 'motif E (octatonic, same contour)' });
      tFm.add(fm(m, d, SR, { ratio: 2.005, index: 1.6, indexEnd: 0.4, indexTime: 0.3, feedback: 0.3, env: { a: 0.01, d: 0.2, s: 0.6, r: 0.4 } }), tt, SR, 0.6, -0.2);
    });
  play(O.map((m) => m - 24), 9.5, beat * 1.4, (m, tt, d) => orch(tVc, vc, [{ t: tt, dur: d, midi: m, vel: 0.6, why: 'O in augmentation' }], 'sus'));
  // 18–26 s: exchange — electronics keep only the motif's RHYTHM (pitchless clicks), the strings pluck E's pitches
  t = 18;
  for (let r = 0; r < 3; r++)
    t = play(E.map((m) => m - 12), t, beat * 0.5, (m, tt, d, k) => {
      orch(tPz, pz, [{ t: tt, dur: d, midi: m, vel: 0.75, art: 'pizz', why: "the electronics' pitches, plucked" }], 'pizz');
      gl.notes.push({ t: tt, dur: 0.03, midi: 60, vel: 0.8, why: "the orchestra's rhythm without pitch" });
      tGl.add(k % 2 ? click(SR, 2400) : noiseHit(SR, `B${tt}`, { bp: 3000, decay: 0.015 }), tt + 0.002, SR, 0.9);
    });
  // 26–32 s: canon — horn plays O, FM plays E half a beat later; they end on different long notes together
  play(O, 26, beat * 0.8, (m, tt, d, k) => orch(tHn, hn, [{ t: tt, dur: k === 4 ? 4.5 : d, midi: m - 12, vel: 0.65 }], 'sus'));
  play(E, 26 + beat * 0.4, beat * 0.8, (m, tt, d, k) => {
    const dd = k === 4 ? 4.5 - beat * 0.4 : d;
    fmP.notes.push({ t: tt, dur: dd, midi: m, vel: 0.65 });
    tFm.add(fm(m, dd, SR, { ratio: 2.005, index: 1.2, indexEnd: 0.5, indexTime: 0.6, feedback: 0.3, env: { a: 0.02, d: 0.3, s: 0.6, r: 1.2 } }), tt, SR, 0.55, 0.2);
  });
  orch(tVc, vc, [{ t: 26, dur: 6, midi: 38, vel: 0.5 }], 'sus');
  level(tVn, -23); level(tVc, -26); level(tPz, -25); level(tHn, -24); level(tFm, -25); level(tGr, -30); level(tGl, -28);
  e.notes.push(`motif O = D F E B♭ A (D minor), motif E = ${E.map((m) => ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][m % 12]).join(' ')} (C octatonic) — 上下の形と音程の大小の順位、リズム比 1.5:0.5:0.5:1:2 が同じ`);
  e.notes.push('9–18 秒: 電子が E を 0.6 倍の時間で、チェロが O を 1.4 倍に引き伸ばして同時に (呼びかけと応答)');
  e.notes.push('18–26 秒: 交換 — 電子は音高を捨ててリズムだけ、弦のピチカートが電子側の音高 (八音音階) を弾く');
  return e;
}

// =============================================================================================
// EXP-C BREATH — no shared pulse, no shared key: only crescendo, silence and climax
// =============================================================================================
function expC(): Exp {
  const e = newExp('EXP-C', 'BREATH', '3. リズムを共有せずに強弱だけで統一できるか', 'DYNAMICS BRIDGE (共通の緊張曲線 T(t)・総休止・スフォルツァンド)', 30);
  const T = (t: number) => {
    if (t < 9) return 0.1 + 0.65 * Math.pow(t / 9, 1.6);
    if (t < 9.9) return 0;
    if (t < 17) return 0.12 + 0.38 * smooth(9.9, 17, t);
    if (t < 23.5) return 0.5 + 0.5 * smooth(17, 23.2, t);
    if (t < 24.1) return 0;
    return 0.08 * Math.exp(-(t - 24.1) / 2.5);
  };
  // orchestra: free-time chorale in A♭ (no pulse), chord changes at irregular moments
  const chorale: Array<[number, number[]]> = [
    [0, [44, 56, 60, 63, 68]], // A♭
    [3.2, [41, 53, 60, 65, 68]], // Fm
    [6.1, [37, 53, 61, 65, 68]], // D♭
    [9.9, [46, 58, 61, 65, 70]], // B♭m
    [12.5, [39, 55, 63, 68, 70]], // E♭sus
    [15.4, [36, 56, 60, 63, 68]], // A♭/C
    [17.0, [37, 53, 60, 65, 68]], // D♭maj7
    [19.4, [39, 55, 61, 67, 70]], // E♭7
    [21.6, [32, 56, 60, 63, 72]], // A♭ (wide)
    [24.1, [44, 56, 63, 68]], // A♭, ppp remains
  ];
  const hn = part(e, 'hn', 'Horns', 'orchestra', 'horn');
  const tb = part(e, 'tb', 'Trombone', 'orchestra', 'trombone');
  const tu = part(e, 'tu', 'Tuba', 'orchestra', 'tuba');
  const st = part(e, 'st', 'Strings', 'orchestra', 'violins');
  const vc = part(e, 'vc', 'Celli', 'orchestra', 'celli');
  const tHn = track(e, 'hn', 'Horns', 'orchestra', 0.3, 0.6);
  const tTb = track(e, 'tb', 'Trombone', 'orchestra', 0.5, 0.6);
  const tTu = track(e, 'tu', 'Tuba', 'orchestra', 0.55, 0.6);
  const tSt = track(e, 'st', 'Violins', 'orchestra', -0.45, 0.35);
  const tVc = track(e, 'vc', 'Celli', 'orchestra', 0.25, 0.4);
  chorale.forEach(([t0, ch], k) => {
    const t1 = k + 1 < chorale.length ? chorale[k + 1][0] : 30;
    const end = t0 < 9.9 && t1 > 9 ? 9 : t0 < 24.1 && t1 > 23.5 ? 23.5 : t1;
    const dur = Math.max(0.5, end - t0);
    const v = Math.max(0.15, T(t0 + 0.3));
    orch(tTu, tu, [{ t: t0, dur, midi: ch[0], vel: v }], 'sus');
    orch(tVc, vc, [{ t: t0, dur, midi: ch[0] + 12, vel: v }], 'sus');
    orch(tTb, tb, [{ t: t0, dur, midi: ch[1], vel: v }], 'sus');
    orch(tHn, hn, ch.slice(2, 4).map((m) => ({ t: t0 + 0.05, dur, midi: m - 12, vel: v })), 'sus');
    orch(tSt, st, ch.slice(2).map((m) => ({ t: t0, dur, midi: m + 12, vel: v })), 'sus');
  });
  // electronics: strict 137 BPM in E, density and brightness follow T
  const sx = 60 / 137 / 4;
  const bs = part(e, 'bass', 'FM bass', 'electronic', 'fm-bass');
  const kk = part(e, 'kick', 'Kick', 'electronic', 'kick');
  const hh = part(e, 'hat', 'Hats', 'electronic', 'noise');
  const ar = part(e, 'arp', 'Arp', 'electronic', 'fm');
  const tBs = track(e, 'bass', 'FM bass', 'electronic', 0, 0.15);
  const tKk = track(e, 'kick', 'Kick', 'electronic', 0, 0.1);
  const tHh = track(e, 'hat', 'Hats', 'electronic', -0.25, 0.2);
  const tAr = track(e, 'arp', 'Arp', 'electronic', 0.15, 0.25, 0.9);
  const rng = new Rng('od:C');
  const bassPat = euclid(16, 5, 0);
  const E = [52, 56, 59, 63, 64, 66, 68, 71];
  for (let s = 0; s * sx < 30; s++) {
    const t = s * sx;
    const v = T(t);
    if (v <= 0.01) continue;
    const st16 = s % 16;
    if (bassPat[st16] && rng.next() < 0.4 + 0.6 * v) {
      const m = st16 === 0 ? 28 : rng.next() < 0.5 ? 40 : 35;
      bs.notes.push({ t, dur: sx * 2, midi: m, vel: v, why: 'euclid 5/16, density ∝ T' });
      tBs.add(fm(m, sx * 1.8, SR, { ratio: 1, index: 0.8 + 3.5 * v, indexEnd: 0.3, indexTime: 0.08, env: { a: 0.003, d: 0.15, s: 0.5, r: 0.08 } }), t, SR, v);
    }
    if (st16 % 4 === 0 && v > 0.3) {
      kk.notes.push({ t, dur: 0.2, midi: 36, vel: v });
      tKk.add(kick(SR, { hz: 47 }), t, SR, v);
    }
    if (rng.next() < v * 0.9) {
      hh.notes.push({ t, dur: 0.03, midi: 42, vel: v });
      tHh.add(noiseHit(SR, `C${s}`, { hp: 6000 + 4000 * v, decay: 0.012 + 0.03 * v }), t, SR, 0.25 + 0.5 * v);
    }
    if (v > 0.35 && st16 % 2 === 1 && rng.next() < v) {
      const m = E[Math.floor(rng.next() * E.length)] + 12;
      ar.notes.push({ t, dur: sx, midi: m, vel: v });
      tAr.add(fm(m, sx, SR, { ratio: 1.5, index: 1 + 4 * v, indexEnd: 0.1, indexTime: 0.05, env: { a: 0.002, d: 0.1, s: 0.2, r: 0.1 } }), t, SR, v * 0.6, (rng.next() - 0.5) * 0.9);
    }
  }
  // the shared silence must be silent: gate everything (both worlds) with the same curve's zero regions
  const gate = (t: number) => (t >= 9 && t < 9.9) || (t >= 23.5 && t < 24.1) ? 0 : 1;
  const gsm = (t: number) => Math.min(gate(t), gate(t + 0.02), gate(t - 0.02)) || (gate(t) ? 1 : 0);
  for (const tr of [tBs, tKk, tHh, tAr]) tr.shape((t) => gsm(t), SR);
  // the orchestra's sustained samples also get the curve as expression (bowing pressure / air)
  for (const tr of [tHn, tTb, tTu, tSt, tVc]) tr.shape((t) => 0.25 + 0.75 * Math.min(1, T(t) * 1.3) * gsm(t) + (t > 24.1 ? 0.05 : 0), SR);
  level(tHn, -25); level(tTb, -27); level(tTu, -27); level(tSt, -24); level(tVc, -27);
  level(tBs, -25); level(tKk, -25); level(tHh, -31); level(tAr, -28);
  e.notes.push('オーケストラ: A♭ のコラール、拍なし (和音は 0, 3.2, 6.1, 9.9 … 秒の不規則な時刻) / 電子: E、137 BPM の 16 分音符');
  e.notes.push('共有するのは緊張曲線 T(t) だけ: 0–9 秒クレッシェンド → 9.0–9.9 秒 総休止 → 弱奏から再び → 17–23.5 秒 頂点 → 23.5 秒で同時に切る → 余韻');
  e.notes.push('T は電子側では音数・FM の明るさ・ハイハットの確率に、オーケストラ側では強弱の層と表情 (弓圧/息) に入る');
  return e;
}

// =============================================================================================
// EXP-D BOW INTO WIRE — continuous timbre morph, then an electronic rhythm handed to the orchestra
// =============================================================================================
function expD(): Exp {
  const e = newExp('EXP-D', 'BOW INTO WIRE', '4. オーケストラの音色を電子音へ連続的に変形できるか (+5. 第三の現象)', 'TIMBRE BRIDGE (倍音分析 → 加算合成の双子 → 変形) と逆方向 (電子のリズム → 弦・ティンパニ・ハープ)', 32);
  const vc = part(e, 'vc', 'Celli', 'orchestra', 'celli');
  const va = part(e, 'va', 'Violas', 'orchestra', 'violas');
  const tw = part(e, 'twin', 'Additive twin', 'electronic', 'additive');
  const fz = part(e, 'freeze', 'Granular freeze', 'electronic', 'granular');
  const tVc = track(e, 'vc', 'Celli', 'orchestra', 0.2, 0.35);
  const tVa = track(e, 'va', 'Violas', 'orchestra', -0.15, 0.45);
  const tTw = track(e, 'twin', 'Additive twin', 'electronic', 0.2, 0.3);
  const tFz = track(e, 'freeze', 'Granular freeze', 'electronic', 0, 0.4);
  const line: Array<[number, number, number]> = [
    [0, 4.2, 48], // C3
    [4.2, 3.2, 51], // E♭3
    [7.4, 3.8, 50], // D3
    [11.2, 4.6, 43], // G2
  ];
  // analyse the cello section's C3
  const z = lib.pick('celli', 'sus', 48, 0.7);
  const prof = analyseTimbre(z.audio!.channels[0], z.audio!.sampleRate, 440 * Math.pow(2, (z.midi - 69) / 12)); // the sample's own pitch (nearest zone)
  const orchGain = (t: number) => 1 - smooth(3, 11, t);
  const twinGain = (t: number) => smooth(1.5, 8, t) * (1 - smooth(14.5, 17, t));
  const morph = (t: number) => smooth(7, 15, t);
  for (const [t0, d, m] of line) {
    orch(tVc, vc, [{ t: t0, dur: d + 0.15, midi: m, vel: 0.7, why: 'the source of the morph' }], 'sus');
    tw.notes.push({ t: t0, dur: d + 0.15, midi: m, vel: 0.7, why: `additive twin from the analysed cello partials (centroid ${prof.centroid}×f0)` });
    tTw.add(additive(prof, m, d + 0.15, SR, { morph: (tt) => morph(t0 + tt), env: { a: 0.12, d: 0.1, s: 1, r: 0.6 }, seed: `twin${m}`, vibrato: 0.004 }), t0, SR, 1);
  }
  orch(tVa, va, [{ t: 0, dur: 15.5, midi: 55, vel: 0.35 }], 'sus');
  tVc.shape(orchGain, SR);
  tVa.shape((t) => 0.4 + 0.6 * orchGain(t), SR);
  tTw.shape(twinGain, SR);
  const frz = grains(z.audio!.channels[0], z.audio!.sampleRate, 32, SR, { position: () => 0.55, pitch: (t) => (t < 13 ? 0 : t < 15 ? 7 : 12) + 0.08 * Math.sin(t * 3), density: (t) => 6 + 60 * smooth(9, 15, t) - 60 * smooth(16, 20, t) + 30 * smooth(29, 31, t), grainSec: 0.09, spread: 0.01, seed: 'D' });
  tFz.add({ left: frz[0], right: frz[1] }, 0, SR, 1);
  fz.notes.push({ t: 9, dur: 11, midi: 48, vel: 0.5, why: 'grains frozen at 55 % of the same cello sample' });
  // Phase B: a probabilistic electronic rhythm, then the orchestra takes it over (same onsets, accents)
  const ebpm = 100;
  const sx = 60 / ebpm / 4;
  const rng = new Rng('od:D');
  const steps: Array<{ t: number; v: number; kind: 'click' | 'noise' | 'blip' | 'sub'; m: number }> = [];
  const pat = euclid(16, 9, 3);
  for (let s = 0; s * sx < 17; s++) {
    const t = 15 + s * sx;
    const st = s % 16;
    if (!pat[st] && rng.next() > 0.12) continue;
    const kind = st === 0 ? 'sub' : st % 4 === 2 ? 'noise' : rng.next() < 0.5 ? 'blip' : 'click';
    steps.push({ t, v: st === 0 ? 1 : st % 4 === 2 ? 0.8 : 0.45 + 0.4 * rng.next(), kind, m: [43, 50, 55, 58, 62][Math.floor(rng.next() * 5)] });
  }
  const el = part(e, 'erhythm', 'Glitch rhythm', 'electronic', 'glitch');
  const tEl = track(e, 'erhythm', 'Glitch rhythm', 'electronic', 0.1, 0.15);
  const spP = part(e, 'spic', 'Violins spiccato', 'orchestra', 'violins');
  const pzP = part(e, 'pizz', 'Celli pizz', 'orchestra', 'celli');
  const tpP = part(e, 'timp', 'Timpani', 'orchestra', 'timpani');
  const hpP = part(e, 'harp', 'Harp', 'orchestra', 'harp');
  const tSp = track(e, 'spic', 'Violins spic', 'orchestra', -0.4, 0.35);
  const tPz = track(e, 'pizz', 'Celli pizz', 'orchestra', 0.35, 0.35);
  const tTp = track(e, 'timp', 'Timpani', 'orchestra', 0.05, 0.6);
  const tHp = track(e, 'harp', 'Harp', 'orchestra', -0.2, 0.45);
  const elecGain = (t: number) => 1 - smooth(21, 27, t);
  const orchIn = (t: number) => smooth(19, 22, t);
  const handover: Array<{ kind: string; art: string; decay: number }> = [];
  for (const s of steps) {
    const voice = s.kind === 'sub' ? kick(SR, { hz: 43, drop: 2 }) : s.kind === 'noise' ? noiseHit(SR, `D${s.t}`, { bp: 2500, decay: 0.03 }) : s.kind === 'blip' ? fm(s.m + 24, sx, SR, { ratio: 2, index: 2, indexEnd: 0.1, indexTime: 0.04, env: { a: 0.001, d: 0.08, s: 0, r: 0.05 } }) : click(SR, 2000);
    el.notes.push({ t: s.t, dur: sx, midi: s.kind === 'blip' ? s.m + 24 : 60, vel: s.v, why: `${s.kind}` });
    tEl.add(voice, s.t, SR, s.v * elecGain(s.t));
    // the reverse bridge: the electronic hit's envelope chooses the orchestral articulation
    const a = articulationFor(voice, SR);
    handover.push({ kind: s.kind, art: a.art, decay: Math.round(a.decay * 1000) / 1000 });
    const g = orchIn(s.t);
    if (g <= 0.01) continue;
    const v = s.v * (0.4 + 0.6 * g);
    // pitched blips keep their pitch on the harp; the sub-kick goes to the timpani; the rest follow the measured decay
    const target = s.kind === 'sub' ? 'timpani' : s.kind === 'blip' ? 'harp' : a.art === 'spic' ? 'violins spiccato' : 'celli pizzicato';
    handover[handover.length - 1].art = target;
    const why = `${s.kind} (decay ${a.decay.toFixed(2)} s) → ${target}`;
    if (target === 'timpani') orch(tTp, tpP, [{ t: s.t, dur: 1, midi: 43, vel: v, why }], 'hit');
    else if (target === 'harp') orch(tHp, hpP, [{ t: s.t, dur: 0.5, midi: s.m + 24, vel: v, why }], 'pluck');
    else if (target === 'violins spiccato') orch(tSp, spP, [{ t: s.t, dur: sx, midi: s.m + 19, vel: v, why }], 'spic');
    else orch(tPz, pzP, [{ t: s.t, dur: 0.3, midi: s.m, vel: v, why }], 'pizz');
  }
  // the very end: cello C2 with its electronic ghost (morph 1), together
  orch(tVc, vc, [{ t: 30, dur: 2.5, midi: 36, vel: 0.6 }], 'sus');
  tTw.add(additive(prof, 36, 2.5, SR, { morph: () => 0.6, env: { a: 0.3, d: 0.1, s: 1, r: 1.2 }, seed: 'ghost' }), 30, SR, 0.5);
  level(tVc, -24); level(tVa, -30); level(tTw, -25); level(tFz, -30);
  level(tEl, -26); level(tSp, -27); level(tPz, -27); level(tTp, -27); level(tHp, -28);
  e.notes.push(`チェロ (サンプル ${z.path.split("/").pop()}, 実音 MIDI ${z.midi}) の分析: 倍音の重心 ${prof.centroid}×f0、立ち上がり ${prof.attack}s、雑音成分 ${prof.noise}、倍音 1–8: ${prof.partials.slice(0, 8).join(' ')}`);
  e.notes.push('0–15 秒: 実際のチェロ → 同じ倍音の加算合成の双子に受け渡し (1.5–11 秒) → 双子の倍音を伸ばす・偶数倍音を持ち上げる・雑音の暈 (7–15 秒) → 同じチェロの録音から切った粒の凍結');
  e.notes.push(`15–32 秒: 電子の確率的リズム (100 BPM, euclid 9/16 + 12 %) → 各音の包絡から奏法を決めてオーケストラへ: ${[...new Set(handover.map((h) => `${h.kind}→${h.art}`))].join(', ')}。19–27 秒は両方が同時 (同じ発音時刻)`);
  return e;
}

// =============================================================================================
// render + measure
// =============================================================================================
interface Metrics {
  lufs: number;
  lra: number;
  peakDbfs: number;
  /** correlation of 100-ms loudness curves, orchestra vs electronics (where both sound) */
  envelopeCorrelation: number;
  /** share of electronic onsets within 30 ms of an orchestral onset */
  onsetCoincidence: number;
  /** cosine similarity of duration-weighted pitch-class profiles (1 = same key, 0 = unrelated) */
  pitchClassSimilarity: number;
  /** share of electronic pitched note-time inside the orchestra's central register (its middle 50 %) */
  registerOverlap: number;
  /** composite onsets per second vs the busier part alone (>1 = a new, denser rhythm emerges) */
  compositeDensityRatio: number;
}

function metrics(e: Exp, master: Stereo): Metrics {
  const sum = (kind: string) => {
    const L = new Float32Array(master.left.length);
    for (const t of e.tracks.filter((x) => x.kind === kind)) for (let i = 0; i < Math.min(L.length, t.left.length); i++) L[i] += t.left[i] + t.right[i];
    return L;
  };
  const o = sum('orchestra');
  const el = sum('electronic');
  const w = Math.round(0.1 * SR);
  const dbs = (x: Float32Array) => {
    const out: number[] = [];
    for (let b = 0; b + w <= x.length; b += w) {
      let s = 0;
      for (let i = b; i < b + w; i++) s += x[i] * x[i];
      out.push(10 * Math.log10(s / w + 1e-12));
    }
    return out;
  };
  const a = dbs(o);
  const b = dbs(el);
  const idx = a.map((_, i) => i).filter((i) => a[i] > -70 && b[i] > -70);
  const mean = (xs: number[]) => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
  const ma = mean(idx.map((i) => a[i]));
  const mb = mean(idx.map((i) => b[i]));
  let num = 0;
  let da = 0;
  let db = 0;
  for (const i of idx) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const corr = num / Math.sqrt(da * db || 1);
  const on = (kind: string) => e.parts.filter((p) => p.kind === kind).flatMap((p) => p.notes.map((n) => n.t));
  const oo = on('orchestra').sort((x, y) => x - y);
  const eo = on('electronic').sort((x, y) => x - y);
  const near = eo.filter((t) => oo.some((u) => Math.abs(u - t) < 0.03)).length / Math.max(1, eo.length);
  const pcp = (kind: string) => {
    const v = new Array(12).fill(0);
    for (const p of e.parts.filter((x) => x.kind === kind && !['dust', 'noise', 'kick', 'clicks', 'glitch', 'granular'].includes(x.instrument))) for (const n of p.notes) v[((Math.round(n.midi) % 12) + 12) % 12] += n.dur * n.vel;
    return v;
  };
  const po = pcp('orchestra');
  const pe = pcp('electronic');
  const dot = po.reduce((s, v, i) => s + v * pe[i], 0);
  const sim = dot / Math.sqrt(po.reduce((s, v) => s + v * v, 0) * pe.reduce((s, v) => s + v * v, 0) || 1);
  // the orchestra's central register: inter-quartile range of its duration-weighted pitches
  const oNotes = e.parts.filter((p) => p.kind === 'orchestra' && p.instrument !== 'timpani').flatMap((p) => p.notes).sort((x, y) => x.midi - y.midi);
  const totalDur = oNotes.reduce((s, n) => s + n.dur, 0);
  const q = (f: number) => {
    let acc = 0;
    for (const n of oNotes) {
      acc += n.dur;
      if (acc >= f * totalDur) return n.midi;
    }
    return oNotes[oNotes.length - 1]?.midi ?? 60;
  };
  const lo = q(0.25);
  const hi = q(0.75);
  const eNotes = e.parts.filter((p) => p.kind === 'electronic' && !['dust', 'noise', 'kick', 'clicks', 'glitch'].includes(p.instrument)).flatMap((p) => p.notes);
  const inR = eNotes.reduce((s, n) => s + (n.midi >= lo && n.midi <= hi ? n.dur : 0), 0) / Math.max(1e-9, eNotes.reduce((s, n) => s + n.dur, 0));
  const uniq = (xs: number[]) => xs.filter((t, i) => i === 0 || t - xs[i - 1] > 0.03).length;
  const comp = uniq([...oo, ...eo].sort((x, y) => x - y)) / Math.max(1, Math.max(uniq(oo), uniq(eo)));
  const lm = loudness(master.left, master.right, SR);
  let peak = 0;
  for (let i = 0; i < master.left.length; i++) peak = Math.max(peak, Math.abs(master.left[i]), Math.abs(master.right[i]));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { lufs: r2(lm.integrated), lra: r2(lm.lra), peakDbfs: r2(20 * Math.log10(peak)), envelopeCorrelation: r2(corr), onsetCoincidence: r2(near), pitchClassSimilarity: r2(sim), registerOverlap: r2(inR), compositeDensityRatio: r2(comp) };
}

function render(e: Exp): { e: Exp; m: Metrics; mp3: boolean } {
  const t0 = Date.now();
  const res = mixdown(e.tracks, SR, HALL, { targetLufs: -18, ceilingDb: -1, hallLevel: 0.3 });
  // trim to the piece + hall tail
  const n = Math.ceil((e.seconds + 2.5) * SR);
  const fade = Math.round(0.8 * SR);
  const master: Stereo = { left: res.master.left.slice(0, n), right: res.master.right.slice(0, n) };
  for (let i = n - fade; i < n; i++) {
    const g = (n - i) / fade;
    master.left[i] *= g;
    master.right[i] *= g;
  }
  const dir = join(OUT, e.id);
  mkdirSync(join(dir, 'stems'), { recursive: true });
  writeFileSync(join(dir, `${e.id}.wav`), encodeWav24([master.left, master.right], SR));
  for (const s of res.stems) writeFileSync(join(dir, 'stems', `${e.id}_${s.kind === 'orchestra' ? 'ORCH' : 'ELEC'}_${s.id}.wav`), encodeWav24([s.audio.left.slice(0, n), s.audio.right.slice(0, n)], SR));
  writeFileSync(join(dir, 'stems', `${e.id}_HALL.wav`), encodeWav24([res.hallReturn.left.slice(0, n), res.hallReturn.right.slice(0, n)], SR));
  let mp3 = true;
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(dir, `${e.id}.wav`), '-codec:a', 'libmp3lame', '-b:a', '256k', join(dir, `${e.id}.mp3`)]);
  } catch {
    mp3 = false;
  }
  const score: Score = { title: `SONOVA — ORCHESTRA × DIGITAL · ${e.id} ${e.title}`, bpm: 90, parts: e.parts };
  writeFileSync(join(EXP, `${e.id}.mid`), toMidi(score));
  const m = metrics(e, master);
  writeFileSync(join(EXP, `${e.id}.json`), JSON.stringify({ id: e.id, title: e.title, question: e.question, bridge: e.bridge, seconds: e.seconds, notes: e.notes, metrics: m, mix: res.report, tracks: e.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, place: t.place })), score }, null, 1));
  console.log(`${e.id} ${e.title}: ${((Date.now() - t0) / 1000).toFixed(1)} s · ${JSON.stringify(m)}`);
  return { e, m, mp3 };
}

const builders: Record<string, () => Exp> = { A: expA, B: expB, C: expC, D: expD };
const done: Array<{ e: Exp; m: Metrics; mp3: boolean }> = [];
for (const k of Object.keys(builders)) {
  if (only && only !== k) continue;
  lib.resetRoundRobin();
  const t = Date.now();
  const e = builders[k]();
  console.log(`${e.id} built in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  done.push(render(e));
}
void Biquad;
void INSTRUMENTS;
if (!only) {
  const md = `# SONOVA — ORCHESTRA × DIGITAL · Phase 2 — 統一原理の違う 4 つの実験

自動生成: \`npm run od:phase2\`。音声は \`output/orchestra-digital/phase2/<ID>/\` (48 kHz / 24-bit WAV、MP3 256 kbps、楽器ごとのステム、ホールの返り)。MIDI と JSON (楽譜・指標) はこのフォルダ。
オーケストラ音源: VSCO-2-CE (CC0)。電子音・残響 (インパルス応答も生成) はすべて自前の実装。

| 実験 | 問い | 統一の仕組み | 長さ |
|---|---|---|---|
${done.map(({ e }) => `| **${e.id} ${e.title}** | ${e.question} | ${e.bridge} | ${e.seconds} 秒 |`).join('\n')}

## 測った値 (聴く前の手がかり。採否は試聴で決める)

| 実験 | LUFS | LRA | ピーク | 強弱の相関 | 発音の一致 | 音高クラスの類似 | 音域の重なり | 合成リズムの密度比 |
|---|---|---|---|---|---|---|---|---|
${done.map(({ e, m }) => `| ${e.id} | ${m.lufs} | ${m.lra} LU | ${m.peakDbfs} dBFS | ${m.envelopeCorrelation} | ${m.onsetCoincidence} | ${m.pitchClassSimilarity} | ${m.registerOverlap} | ${m.compositeDensityRatio} |`).join('\n')}

- 強弱の相関: 0.1 秒ごとの音量の動きがオーケストラと電子でどれだけ一緒か (1 = 完全に一緒)
- 発音の一致: 電子の発音のうち、30 ms 以内にオーケストラも発音している割合
- 音高クラスの類似: 2 つの音楽の調性がどれだけ近いか (1 = 同じ、0 = 無関係)。低いほど多調
- 音域の重なり: 電子の音のうち、オーケストラの中心の音域 (音の長さで重みを付けた中央 50 %) に入っている割合。低いほど音域で棲み分けている
- 合成リズムの密度比: 両方を合わせた発音の数 ÷ 多い方の発音の数。1 を超えると「どちらにもなかったリズム」ができている

${done.map(({ e }) => `## ${e.id} ${e.title}\n\n${e.notes.map((x) => `- ${x}`).join('\n')}`).join('\n\n')}
`;
  writeFileSync(join(EXP, 'REPORT.md'), md);
}
