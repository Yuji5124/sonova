/**
 * ZIG — NOBODY ON AIR (FREAKTION SONG 001): three different 30-second demos of one hook,
 * "NOBODY! NOBODY! ON AIR!", for PSYENCE WORKSHOP.
 *   A  ROCK BROADCAST     160 BPM  E minor riff → G major chorus, the long "AIR" at the end
 *   B  GHOST FREQUENCY    140 BPM  D minor radio verse → sudden D major chorus
 *   C  FREAKTION REACTION 150 BPM  SONOVA image instruments collide with an A riff, mutate, land on a pop chorus
 * FREAKTION = FREAK × REACTION: foreign sounds collide and the music that comes out is kept when it is good.
 * Everything here is original (riffs, progressions, melodies, lyrics). The band is the SONOVA rock renderer
 * (string models, modal drums), the voices are VOICEVOX (sung in scripts/nobody.ts), C's electronics are the
 * SONOVA v1.1 image instruments and interaction generator.
 */
import { Rng, createImageDNAV11, type InstrumentDNA } from '@sonova/instrument-dna';
import { generateV11, type RockEvent, type RockSong } from '@sonova/music-generator';
import { analyzeImageV11 } from '@sonova/source-analyzer';
import { Biquad, renderBytebeat, renderRig, renderVoice, type RigEvent, type StereoBuffer } from '@sonova/synthesis-engine';
import { MATERIALS, renderMaterial } from '@sonova/evaluation';
import { glitch } from '@sonova/orchestra-engine';
import type { KanaNote } from './toyriot.ts';
import type { RockHooks } from '../rock.ts';

export const NOBODY_VERSION = 'sonova-nobody/1.0.0';

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---- a small score builder ----------------------------------------------------------------------
export class Score {
  events: RockEvent[] = [];
  private id = 0;
  constructor(readonly bpm: number) {}
  get beat(): number {
    return 60 / this.bpm;
  }
  get bar(): number {
    return 4 * this.beat;
  }
  t(bar: number, beat = 0): number {
    return Math.round((bar * this.bar + beat * this.beat) * 1e6) / 1e6;
  }
  private push(bar: number, beat: number, e: Partial<RockEvent>): RockEvent {
    const ev = { id: this.id++, time: this.t(bar, beat), bar, slot: Math.round(beat * 4), depth: 0, ...e } as RockEvent;
    this.events.push(ev);
    return ev;
  }
  guitar(bar: number, beat: number, midis: number[], beats: number, o: { mute?: boolean; vel?: number } = {}) {
    return this.push(bar, beat, { part: 'guitar', kind: 'chord', midis, midi: midis[0], velocity: o.vel ?? (o.mute ? 0.78 : 0.92), duration: beats * this.beat, palmMute: !!o.mute });
  }
  bass(bar: number, beat: number, midi: number, beats: number, vel = 0.9) {
    return this.push(bar, beat, { part: 'bass', kind: 'note', midi, velocity: vel, duration: beats * this.beat * 0.92 });
  }
  lead(bar: number, beat: number, midi: number, beats: number, o: { slide?: boolean; bend?: number; vibrato?: number; vel?: number } = {}) {
    return this.push(bar, beat, { part: 'lead', kind: 'note', midi, velocity: o.vel ?? 0.85, duration: beats * this.beat, slide: o.slide, bend: o.bend, vibrato: o.vibrato });
  }
  hit(bar: number, beat: number, drum: NonNullable<RockEvent['drum']>, vel = 0.85) {
    return this.push(bar, beat, { part: 'drums', kind: 'hit', drum, velocity: vel });
  }
  feedback(bar: number, beat: number, gain: number, beats: number) {
    return this.push(bar, beat, { part: 'amp', kind: 'feedback', gain, duration: beats * this.beat });
  }
  /** one bar of a 16-step riff: [step, root, 'P' chord | 'm' mute, steps] */
  riff(bar: number, steps: Array<[number, number, 'P' | 'm', number]>, o: { vel?: number } = {}) {
    for (const [s, r, k, len] of steps) this.guitar(bar, s / 4, k === 'P' ? pc(r) : [r], len / 4, { mute: k === 'm', vel: k === 'P' ? (o.vel ?? 0.93) : 0.76 });
  }
  /** a drum bar: beats lists per drum */
  drums(bar: number, p: Partial<Record<NonNullable<RockEvent['drum']>, number[]>>, vel = 0.85) {
    for (const [drum, beats] of Object.entries(p) as Array<[NonNullable<RockEvent['drum']>, number[]]>)
      for (const b of beats) this.hit(bar, b, drum, drum === 'hat' || drum === 'hatOpen' ? (Number.isInteger(b) ? 0.62 : 0.45) * vel : drum === 'snare' && !Number.isInteger(b) ? 0.55 * vel : vel);
  }
}
export const pc = (r: number) => [r, r + 7, r + 12];
const range = (a: number, b: number, step: number) => Array.from({ length: Math.round((b - a) / step) }, (_, k) => a + k * step);
const EIGHTHS = range(0, 4, 0.5);

/** sung melody: [kana, midi, beats]; kana '-' is a rest. Times are absolute seconds. */
export function sing(s: Score, bar: number, beat: number, items: Array<[string, number, number]>, vel = 0.9): KanaNote[] {
  const out: KanaNote[] = [];
  let b = beat;
  for (const [k, m, d] of items) {
    if (k !== '-') out.push({ lyric: k, midi: m, time: s.t(bar, b), duration: d * s.beat, velocity: vel });
    b += d;
  }
  return out;
}

export interface VocalPart {
  name: string;
  /** a key of MALE_VOICES in scripts/lib-voicevox.ts, or 'kotarouFutsu' */
  voice: string;
  transpose?: number;
  cents?: number;
  delay?: number;
  fx: 'rock' | 'rock-light' | 'megaphone' | 'clean' | 'radio' | 'robot';
  pan: number;
  gain: number;
  notes: KanaNote[];
}

export interface NobodyDemo {
  id: 'A' | 'B' | 'C';
  title: string;
  concept: string;
  bpm: number;
  key: string;
  bars: number;
  sections: Array<{ name: string; from: number; to: number; text: string }>;
  chords: Array<{ bars: string; chords: string }>;
  riff: string;
  lyrics: string[];
  song: RockSong;
  vocals: VocalPart[];
  hooks: RockHooks;
  discoveries: Array<{ name: string; seed: string; settings: Record<string, unknown>; why: string }>;
  layers: string[];
}

function toSong(s: Score, title: string, seed: string, rootPc: number, mode: string, sections: Array<[string, number, number]>, durationSec: number): RockSong {
  return {
    engine_version: NOBODY_VERSION,
    seed,
    title,
    bpm: s.bpm,
    barSec: s.bar,
    durationSec,
    key: { root_pc: rootPc, mode, scale: mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10] },
    tuning: 'standard',
    sections: sections.map(([name, a, b]) => ({ name, startBar: a, bars: b - a, start: s.t(a), end: s.t(b), description: '' })),
    riff: Array.from({ length: 16 }, (_, k) => ({ kind: k % 4 === 0 ? 'pc' : k % 2 ? 'rest' : 'mute', off: 0 }) as RockSong['riff'][number]),
    riffText: '',
    hook: [],
    progressions: {},
    caRules: [],
    derivations: [],
    events: [...s.events].sort((a, b) => a.time - b.time || a.id - b.id),
    stats: { byPart: {}, byRule: {}, maxDepth: 1 },
    chains: [],
  };
}

// ---- shared sound tools (added before the reverb through RockHooks.beforeReverb) ---------------------
function rms(x: Float32Array): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < x.length; i++)
    if (x[i] !== 0) {
      s += x[i] * x[i];
      n++;
    }
  return n ? Math.sqrt(s / n) : 0;
}
/** add a mono layer at `db` relative to full scale (RMS of its sounding part), panned, with a reverb send */
function addLayer(ctx: { mix: StereoBuffer; wet: StereoBuffer }, x: Float32Array, at: number, sr: number, db: number, pan = 0, send = 0.2) {
  const g = Math.pow(10, db / 20) / (rms(x) || 1);
  const a = Math.round(at * sr);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * g;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * g;
  for (let i = 0; i < x.length && a + i < ctx.mix.left.length; i++) {
    if (a + i < 0) continue;
    ctx.mix.left[a + i] += x[i] * gl;
    ctx.mix.right[a + i] += x[i] * gr;
    ctx.wet.left[a + i] += x[i] * gl * send;
    ctx.wet.right[a + i] += x[i] * gr * send;
  }
}
/** radio static: band-limited hiss, crackle and tuning whistles that sweep between stations */
export function radioStatic(sec: number, sr: number, seed: string, whistles = 3): Float32Array {
  const rng = new Rng(`radio:${seed}`);
  const n = Math.round(sec * sr);
  const out = new Float32Array(n);
  const bp = new Biquad('bandpass', 1700, 0.6, sr);
  const sweeps = Array.from({ length: whistles }, () => ({ at: rng.range(0, sec * 0.8), len: rng.range(0.4, 1.2), f0: rng.range(700, 2600), f1: rng.range(300, 3400) }));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = bp.process(rng.next() * 2 - 1) * (0.7 + 0.3 * Math.sin(t * 7.3) * Math.sin(t * 2.1));
    if (rng.next() < 0.0012) v += (rng.next() * 2 - 1) * 1.8;
    for (const w of sweeps)
      if (t >= w.at && t < w.at + w.len) {
        const u = (t - w.at) / w.len;
        ph += (w.f0 + (w.f1 - w.f0) * u) / sr;
        v += 0.35 * Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * u);
      }
    out[i] = v;
  }
  return out;
}
/** make a span of the mix sound as if it came out of a small radio (band-pass, drive, static), with fades */
export function radioize(buf: StereoBuffer, from: number, to: number, sr: number, seed: string, fade = 0.4) {
  const a = Math.round(from * sr);
  const b = Math.min(buf.left.length, Math.round(to * sr));
  const st = radioStatic((b - a) / sr, sr, seed, 2);
  for (const ch of [buf.left, buf.right]) {
    const hp = new Biquad('highpass', 450, 0.7, sr);
    const lp = new Biquad('lowpass', 3000, 0.9, sr);
    for (let i = a; i < b; i++) {
      const u = Math.min(1, (i - a) / (fade * sr), (b - i) / (fade * sr));
      const radio = Math.tanh(lp.process(hp.process(ch[i])) * 2.2) * 0.55 + st[i - a] * 0.05;
      ch[i] = ch[i] * (1 - u) + radio * u;
    }
  }
}
/** a clean electric guitar (the SONOVA string model through a clean amp) */
function cleanGuitar(notes: Array<{ time: number; midi: number; dur: number; vel: number }>, sec: number, sr: number, seed: string): Float32Array {
  const ev: RigEvent[] = [];
  for (const n of notes) {
    ev.push({ time: n.time, type: 'pluck', freqs: [midiHz(n.midi)], velocity: n.vel, mute: false, pickPosition: 0.18, brightness: 0.75, t60: 2.6, damping: 0.25 });
  }
  return renderRig(ev, sec, sr, { gain: 1.6, midBoostDb: 0, cabinetHz: 6500, clean: 1 }, seed);
}
/** notes played by a SONOVA image instrument (additive + FM + noise from a picture's DNA) */
function imageInstrument(dna: InstrumentDNA, notes: Array<{ time: number; midi: number; dur: number; vel: number; timbre?: number }>, sec: number, sr: number, seed: string): Float32Array {
  const out = new Float32Array(Math.round(sec * sr));
  notes.forEach((n, k) => {
    const v = renderVoice(dna, { midi: n.midi, velocity: n.vel, duration: n.dur, timbre: n.timbre ?? 0, kind: 'note' }, sr, `${seed}:${k}`);
    const a = Math.round(n.time * sr);
    for (let i = 0; i < v.length && a + i < out.length; i++) out[a + i] += v[i];
  });
  return out;
}
export const materialName = (name: string) => MATERIALS.find((m) => m.name === name)?.description ?? name;
export function materialDNA(name: string, seed = 'nobody-on-air'): InstrumentDNA {
  const m = MATERIALS.find((x) => x.name === name)!;
  return createImageDNAV11({ sourceType: 'image', sourceName: `${name}.png`, sourceHash: `corpus-${name}`.padEnd(16, '0'), features: analyzeImageV11(renderMaterial(m, 0).image), seed });
}

// =====================================================================================================
// A — ROCK BROADCAST
// =====================================================================================================
export function demoA(): NobodyDemo {
  const s = new Score(160);
  const E = 40;
  const G = 43;
  const A = 45;
  const B = 47;
  const C = 48;
  const D = 50;
  // the riff: E-string drive with a climbing answer (16 steps)
  const riff1: Array<[number, number, 'P' | 'm', number]> = [[0, E, 'P', 2], [2, E, 'm', 1], [3, G, 'P', 2], [5, E, 'm', 1], [6, A, 'P', 2], [8, E, 'm', 1], [9, E, 'm', 1], [10, B, 'P', 2], [12, A, 'P', 1], [13, G, 'P', 1], [14, D, 'P', 2]];
  const riff2: Array<[number, number, 'P' | 'm', number]> = [[0, E, 'P', 2], [2, E, 'm', 1], [3, G, 'P', 2], [5, E, 'm', 1], [6, A, 'P', 2], [8, E, 'm', 1], [9, E, 'm', 1], [10, G, 'P', 2], [12, A, 'P', 2], [14, B, 'P', 2]];
  const rootsRiff = (r: typeof riff1) => r.filter((x) => x[2] === 'P');

  // bar 0: feedback swell + snare roll, the radio blip "ON AIR" in the hook
  s.guitar(0, 0, pc(E), 3.5, { vel: 0.6 });
  s.feedback(0, 0.5, 1.4, 3.5);
  s.hit(0, 0, 'kick', 0.9);
  for (let k = 0; k < 16; k++) s.hit(0, k / 4, 'snare', 0.25 + (k / 16) * 0.7);
  // bars 1–2: riff
  for (const [bar, r] of [[1, riff1], [2, riff2]] as const) {
    s.riff(bar, r);
    for (const [st, root, , len] of rootsRiff(r)) s.bass(bar, st / 4, root - 12, len / 4);
    s.drums(bar, { kick: [0, 0.75, 1.5, 2.5, 3.5], snare: [1, 3], hat: EIGHTHS, ...(bar === 1 ? { crash: [0] } : {}) });
  }
  // bars 3–6: verse — palm-muted drive under the voice, Em C G D
  const verse = [E, C, G, D];
  verse.forEach((r, k) => {
    const bar = 3 + k;
    s.guitar(bar, 0, pc(r), 1, { vel: 0.95 });
    for (const b of [1, 1.5, 2, 2.5, 3, 3.5]) s.guitar(bar, b, [r < 45 ? r : r - 12], 0.4, { mute: true });
    s.guitar(bar, 2.5, pc(r), 0.5, { vel: 0.85 });
    for (const b of EIGHTHS) s.bass(bar, b, (r < 45 ? r : r - 12) - 12 + (b === 3.5 ? 2 : 0), 0.5, b % 1 ? 0.8 : 0.92);
    s.drums(bar, { kick: [0, 1.5, 2, 3.5], snare: [1, 3], hat: EIGHTHS }, 0.85);
  });
  // bar 7: pre — C then D held, a snare build
  s.guitar(7, 0, pc(C), 2, { vel: 0.95 });
  s.guitar(7, 2, pc(D), 1.75, { vel: 0.95 });
  s.bass(7, 0, C - 24, 2);
  for (const b of [2, 2.5, 3, 3.25, 3.5, 3.75]) s.bass(7, b, D - 24, 0.25);
  s.drums(7, { kick: [0, 2], snare: [1, 2, 2.5, 3, 3.25, 3.5, 3.75], crash: [0] });
  // bars 8–19: chorus — open eighths, driving bass with approach notes, the two-step beat
  const chorusRoots: Record<number, number> = { 8: C, 9: G, 10: D, 11: D, 12: E, 13: C, 14: C, 15: G, 16: E, 17: D, 18: D };
  for (const [barS, r] of Object.entries(chorusRoots)) {
    const bar = Number(barS);
    const nextRoot = chorusRoots[bar + 1] ?? G;
    for (const b of EIGHTHS) s.guitar(bar, b, pc(r), 0.5, { vel: b % 1 ? 0.8 : 0.93 });
    const low = (r < 45 ? r : r - 12) - 12;
    EIGHTHS.forEach((b) => s.bass(bar, b, b === 3.5 ? (nextRoot < 45 ? nextRoot : nextRoot - 12) - 13 : b === 3 ? low + 12 : low, 0.5, b % 1 ? 0.82 : 0.95));
    const isFill = bar === 18;
    s.drums(bar, { kick: [0, 1.5, 2, 3.5], snare: isFill ? [1] : [1, 3], hatOpen: isFill ? [0, 0.5, 1, 1.5] : EIGHTHS, ...([8, 12, 14, 16].includes(bar) ? { crash: [0] } : {}) });
    if (isFill) for (let k = 0; k < 8; k++) s.hit(18, 2 + k / 4, k < 3 ? 'tom1' : k < 6 ? 'tom2' : 'tom3', 0.6 + k * 0.05);
  }
  // bar 11 and 18: a lead lick answers the held AIR
  [[71, 0.5], [74, 0.5], [76, 0.5], [79, 0.5], [81, 1], [79, 1]].reduce((b, [m, d], k) => (s.lead(11, b, m, d, { bend: k === 4 ? 2 : 0, vibrato: k === 5 ? 0.4 : 0 }), b + d), 0);
  [[74, 0.25], [76, 0.25], [79, 0.25], [81, 0.25], [83, 1, 0.5]].reduce((b, [m, d], k) => (s.lead(17, 2 + b, m, d, { vibrato: k === 4 ? 0.5 : 0 }), b + d), 0);
  // bar 19: the last chord (G) with the crash and the amp left to howl
  s.guitar(19, 0, pc(G), 6, { vel: 1 });
  s.bass(19, 0, G - 24, 5);
  s.drums(19, { kick: [0], crash: [0] }, 1);
  s.feedback(19, 0.5, 1.3, 3);

  // ---- vocals (male: written at the sung pitch) ----
  const lead: KanaNote[] = [
    // verse: だれも いない よるに / あかい ランプ ともる
    ...sing(s, 3, 0, [['-', 0, 0.5], ['ダ', 52, 0.5], ['レ', 55, 0.5], ['モ', 57, 1], ['イ', 59, 0.5], ['ナ', 57, 0.5], ['イ', 55, 0.5], ['ヨ', 57, 0.5], ['ル', 59, 0.5], ['ニ', 59, 2.5]]),
    ...sing(s, 5, 0, [['-', 0, 0.5], ['ア', 52, 0.5], ['カ', 55, 0.5], ['イ', 57, 1], ['ラ', 59, 0.5], ['ン', 57, 0.5], ['プ', 55, 0.5], ['ト', 57, 0.5], ['モ', 59, 0.5], ['ル', 62, 2.5]]),
    // pre: せかいへ とどけ (rising)
    ...sing(s, 7, 0, [['セ', 62, 0.5], ['カ', 62, 0.5], ['イ', 64, 0.5], ['ヘ', 66, 0.5], ['ト', 67, 0.5], ['ド', 66, 0.5], ['ケ', 67, 0.75], ['-', 0, 0.25]]),
    ...hookA(s, 8, 69, 9.25),
    // answer: だれも きいて なくても
    ...sing(s, 12, 0, [['ダ', 67, 0.5], ['レ', 67, 0.5], ['モ', 69, 0.5], ['キ', 67, 0.5], ['イ', 66, 0.5], ['テ', 64, 0.5], ['ナ', 62, 0.5], ['ク', 64, 0.5], ['テ', 66, 0.5], ['モ', 67, 1.5], ['-', 0, 2]]),
    // the last hook: AIR held from bar 15 to the final chord, then it falls onto G
    ...hookA(s, 14, 69, 13.25 - 0.25),
    ...sing(s, 19, 0, [['ア', 67, 2.5]], 0.85),
  ];
  const gang = [...hookA(s, 8, 69, 9.25), ...hookA(s, 14, 69, 13)];
  const vocals: VocalPart[] = [
    { name: 'lead', voice: 'takehiroTsun', fx: 'rock', pan: -0.18, gain: 0.9, notes: lead },
    { name: 'double', voice: 'takehiro', delay: 0.016, cents: 6, fx: 'rock', pan: 0.22, gain: 0.7, notes: lead.filter((n) => n.time >= s.t(7)) },
    { name: 'gang', voice: 'kotarouOko', transpose: 12, fx: 'rock-light', pan: 0, gain: 0.42, notes: gang },
  ];
  const song = toSong(s, 'NOBODY ON AIR — A ROCK BROADCAST', 'nobody-a', 7, 'major', [['intro', 0, 1], ['riffA', 1, 3], ['verse', 3, 7], ['pre', 7, 8], ['chorus', 8, 19], ['outro', 19, 21]], 31.5);
  return {
    id: 'A',
    title: 'ROCK BROADCAST',
    concept: '疾走するロック × キャッチーなサビ。ライブで一番盛り上がる方向',
    bpm: 160,
    key: 'E minor (リフ) → G major (サビ)',
    bars: 20,
    sections: [
      { name: '導入', from: 0, to: 1, text: 'アンプのハウリングとスネアの連打で幕が上がる' },
      { name: 'リフ', from: 1, to: 3, text: 'E の刻みから G・A・B と駆け上がるリフ' },
      { name: 'A メロ', from: 3, to: 7, text: 'ブリッジミュートの刻み、低い声で状況を歌う' },
      { name: 'プリ', from: 7, to: 8, text: '「せかいへ とどけ」で一気に上昇' },
      { name: 'サビ', from: 8, to: 19, text: 'NOBODY! NOBODY! ON AIR! の「AIR」を伸ばし、ギターのリックが答える。最後の AIR は約5秒' },
      { name: '締め', from: 19, to: 20, text: 'G の一撃とハウリング' },
    ],
    chords: [
      { bars: '1–2 (リフ)', chords: 'E5 – G5 – A5 – B5 – A5 – G5 – D5 (16分のリフ)' },
      { bars: '3–6 (A メロ)', chords: 'Em – C – G – D' },
      { bars: '7 (プリ)', chords: 'C – D' },
      { bars: '8–11 (サビ)', chords: 'C – G – D – D' },
      { bars: '12–19', chords: 'Em – C | C – G – Em – D – D | G' },
    ],
    riff: 'E5 (8分) · m · G5 · m · A5 · m m · B5 · A5 G5 · D5 — 2小節目は G5 · A5 · B5 と駆け上がる',
    lyrics: ['だれも いない よるに', 'あかい ランプ ともる', 'せかいへ とどけ', 'NOBODY! NOBODY! ON AIR —', 'だれも きいて なくても', 'NOBODY! NOBODY! ON AIR ——————'],
    song,
    vocals,
    hooks: {},
    discoveries: [],
    layers: ['SONOVA ロックレンダラー: 弦の物理モデル (KS + WDF ダイオードクリッパーのアンプ) の左右2本のギター、ベース、モード合成ドラム', 'アンプのハウリング (フィードバック) を導入と最後に', 'VOICEVOX: 玄野武宏 (ツンギレ/ノーマル) のダブル + 白上虎太郎 (おこ) が1オクターブ上のギャング'],
  };
}
/** the A hook, NO-BO-DY! NO-BO-DY! ON AI——R, with the AIR held `airBeats` */
function hookA(s: Score, bar: number, top: number, airBeats: number): KanaNote[] {
  return sing(s, bar, 0, [
    ['ノ', 59, 0.5], ['バ', 59, 0.5], ['ディ', 62, 1], ['ノ', 62, 0.5], ['バ', 62, 0.5], ['ディ', 64, 1],
    ['オ', 64, 0.5], ['ン', 66, 0.5], ['エ', 67, 0.75], ['ア', top, airBeats],
  ]);
}

// =====================================================================================================
// B — GHOST FREQUENCY
// =====================================================================================================
export function demoB(): NobodyDemo {
  const s = new Score(140);
  // verse in D minor: Dm(add9) – B♭maj7 – Gm6 – A7sus4→A7; chorus in D major
  const verseChords: Array<{ name: string; root: number; tones: number[] }> = [
    { name: 'Dm(add9)', root: 38, tones: [50, 57, 64, 65, 69, 64] },
    { name: 'B♭maj7', root: 46, tones: [46, 53, 57, 62, 65, 62] },
    { name: 'Gm6', root: 43, tones: [43, 50, 55, 58, 64, 58] },
    { name: 'A7sus4 → A7', root: 45, tones: [45, 52, 57, 62, 67, 61] },
  ];
  const chorus: Record<number, { name: string; root: number }> = {
    7: { name: 'D', root: 50 }, 8: { name: 'A/C♯', root: 49 }, 9: { name: 'Bm', root: 47 }, 10: { name: 'G', root: 43 },
    11: { name: 'D', root: 50 }, 12: { name: 'A', root: 45 }, 13: { name: 'G', root: 43 }, 14: { name: 'D', root: 50 },
  };
  // bars 3–6 verse: half-time drums, bass on the roots
  verseChords.forEach((c, k) => {
    const bar = 3 + k;
    s.bass(bar, 0, c.root - 12 < 28 ? c.root : c.root - 12, 2.5, 0.85);
    s.bass(bar, 2.5, c.root - 12 < 28 ? c.root : c.root - 12, 1.5, 0.75);
    s.drums(bar, { kick: [0, 2.5], snare: [2], hat: EIGHTHS }, 0.62);
  });
  s.drums(6, { tom1: [3], tom2: [3.25], tom3: [3.5, 3.75] }, 0.7);
  // bars 7–14 chorus: power chords open up, full groove
  for (const [barS, c] of Object.entries(chorus)) {
    const bar = Number(barS);
    const r = c.root > 47 ? c.root - 12 : c.root;
    s.guitar(bar, 0, c.name === 'A/C♯' ? [37, 45, 52] : c.name === 'Bm' ? [47, 54, 59] : pc(r), 1.5, { vel: 0.95 });
    s.guitar(bar, 1.5, c.name === 'A/C♯' ? [37, 45, 52] : pc(r), 1, { vel: 0.85 });
    s.guitar(bar, 2.5, c.name === 'A/C♯' ? [37, 45, 52] : pc(r), 1.5, { vel: 0.9 });
    const low = r - 12 < 26 ? r : r - 12;
    for (const b of EIGHTHS) s.bass(bar, b, b === 3.5 ? low + 7 : low, 0.5, b % 1 ? 0.78 : 0.92);
    s.drums(bar, { kick: [0, 1.5, 2, 3.5], snare: [1, 3], hatOpen: EIGHTHS, ...([7, 11].includes(bar) ? { crash: [0] } : {}) }, 0.9);
  }
  s.drums(14, { snare: [3, 3.25, 3.5, 3.75] }, 0.75);
  // bar 15: the band hits once and the radio takes it back
  s.guitar(15, 0, pc(38), 4, { vel: 0.9 });
  s.bass(15, 0, 38, 3.5);
  s.drums(15, { kick: [0], crash: [0] }, 0.9);
  // the lead sings back during the long AIR (bars 10 and 14)
  [[74, 1], [73, 0.5], [71, 0.5], [69, 1.5, 0.5], [66, 0.5]].reduce((b, [m, d, v]) => (s.lead(10, b, m, d, { vibrato: v ?? 0, slide: true }), b + d), 0);

  // ---- vocals: a boy finds a broadcast from the future (白上虎太郎 ふつう) ----
  const hook = (bar: number, air: number, shift = 0) =>
    sing(s, bar, 0, [['ノ', 66 + shift, 1.5], ['バ', 67 + shift, 0.5], ['ディ', 69 + shift, 2], ['ノ', 66 + shift, 1.5], ['バ', 67 + shift, 0.5], ['ディ', 71 + shift, 2], ['オ', 74 + shift, 0.5], ['ン', 73 + shift, 0.5], ['エ', 71 + shift, 1], ['ア', 69 + shift, air]]);
  const boy: KanaNote[] = [
    // ラジオの むこうで / だれかが よんでる
    ...sing(s, 3, 0, [['-', 0, 1], ['ラ', 57, 0.5], ['ジ', 62, 0.5], ['オ', 64, 0.5], ['ノ', 65, 0.5], ['ム', 64, 0.5], ['コ', 62, 0.5], ['ウ', 62, 1], ['デ', 57, 2], ['-', 0, 1]], 0.8),
    ...sing(s, 5, 0, [['-', 0, 1], ['ダ', 57, 0.5], ['レ', 62, 0.5], ['カ', 64, 0.5], ['ガ', 65, 0.5], ['ヨ', 67, 0.5], ['ン', 65, 0.5], ['デ', 64, 1], ['ル', 64, 2], ['-', 0, 1]], 0.8),
    ...hook(7, 6),
    // とおくの そらへ / とどけ
    ...sing(s, 11, 0, [['ト', 74, 0.5], ['オ', 73, 0.5], ['ク', 71, 0.5], ['ノ', 69, 0.5], ['ソ', 71, 0.5], ['ラ', 69, 0.5], ['エ', 66, 1], ['ト', 67, 0.5], ['ド', 69, 0.5], ['ケ', 71, 2], ['-', 0, 1]], 0.85),
    // the last AIR is held while the band goes back into the radio
    ...hook(13, 4.5),
  ];
  // a third above in the second hook (diatonic in D major)
  const third: Record<number, number> = { 66: 69, 67: 71, 69: 73, 71: 74, 73: 76, 74: 78 };
  const harmony = hook(13, 4.5).map((n) => ({ ...n, midi: third[n.midi] ?? n.midi + 3 }));
  const vocals: VocalPart[] = [
    { name: 'boy', voice: 'kotarouFutsu', fx: 'clean', pan: 0, gain: 1, notes: boy },
    { name: 'harmony', voice: 'kotarouWai', fx: 'clean', pan: 0.25, gain: 0.45, notes: harmony },
  ];
  const sr = 44100;
  const hooks: RockHooks = {
    beforeReverb: (ctx) => {
      const sec = ctx.mix.left.length / sr;
      // 1. radio static with tuning whistles: loud in the intro, a thin layer under the verse, back at the end
      const st = radioStatic(sec, sr, 'nobody-b');
      const env = (t: number) => (t < s.t(3) ? 1 : t < s.t(7) ? 0.18 : t < s.t(15) ? 0 : Math.min(1, (t - s.t(15)) / 1.5));
      const x = st.map((v, i) => v * env(i / sr));
      addLayer(ctx, x, 0, sr, -24, 0.1, 0.1);
      // 2. the "future broadcast": a bell-like SONOVA image instrument (ice) arpeggiating the verse chords,
      //    first only through the radio band, then clear
      const ice = materialDNA('ice');
      const arp = [0, 2, 4, 3, 5, 4, 2, 3];
      const bellNotes: Array<{ time: number; midi: number; dur: number; vel: number }> = [];
      for (let bar = 1; bar < 7; bar++) {
        const ch = verseChords[(bar + 1) % 4];
        for (let k = 0; k < 8; k++) bellNotes.push({ time: s.t(bar, k * 0.5), midi: ch.tones[arp[k] % ch.tones.length] + 12, dur: 0.6, vel: 0.55 + (k % 4 === 0 ? 0.2 : 0) });
      }
      const bells = imageInstrument(ice, bellNotes, sec, sr, 'nobody-b-bell');
      for (let i = 0; i < Math.min(bells.length, Math.round(s.t(3) * sr)); i++) bells[i] *= Math.min(1, i / (sr * 2));
      const radioBand = { left: bells.slice(0, Math.round(s.t(3) * sr) + sr), right: bells.slice(0, Math.round(s.t(3) * sr) + sr), sampleRate: sr };
      radioize(radioBand, 0, s.t(3), sr, 'nobody-b-bell', 0.01);
      for (let i = 0; i < Math.round(s.t(3) * sr); i++) bells[i] = radioBand.left[i];
      addLayer(ctx, bells, 0, sr, -27, 0.3, 0.45);
      // 3. clean guitar arpeggios in the verse (the SONOVA string model through a clean amp)
      const pick = [0, 1, 2, 3, 4, 3, 2, 5];
      const gNotes: Array<{ time: number; midi: number; dur: number; vel: number }> = [];
      verseChords.forEach((c, k) => {
        for (let j = 0; j < 8; j++) gNotes.push({ time: s.t(3 + k, j * 0.5), midi: c.tones[pick[j]], dur: 0.9, vel: 0.7 });
      });
      addLayer(ctx, cleanGuitar(gNotes, sec, sr, 'nobody-b-clean'), 0, sr, -22, -0.35, 0.35);
      // 4. at the end the whole band goes back into the radio
      radioize(ctx.mix, s.t(15) + 0.3, sec, sr, 'nobody-b-out', 0.8);
      radioize(ctx.wet, s.t(15) + 0.3, sec, sr, 'nobody-b-out-wet', 0.8);
    },
  };
  const song = toSong(s, 'NOBODY ON AIR — B GHOST FREQUENCY', 'nobody-b', 2, 'major', [['intro', 0, 3], ['verse', 3, 7], ['chorus', 7, 15], ['outro', 15, 18]], 31.5);
  return {
    id: 'B',
    title: 'GHOST FREQUENCY',
    concept: '不思議なラジオ × 美しいメロディ。少年が未来の放送を見つける物語',
    bpm: 140,
    key: 'D minor (A メロ) → D major (サビ)',
    bars: 17,
    sections: [
      { name: '導入', from: 0, to: 3, text: 'ラジオの砂嵐と同調音。遠くから鐘のような電子音 (SONOVA の画像楽器「氷」) がラジオの帯域で聞こえてくる' },
      { name: 'A メロ', from: 3, to: 7, text: '澄んだギターのアルペジオとハーフタイムのドラム。少年の声が「ラジオのむこうでだれかがよんでる」' },
      { name: 'サビ', from: 7, to: 15, text: '同じ D の短調から長調へ。歪んだギターとフルのビートで一気に開く' },
      { name: '締め', from: 15, to: 17, text: 'バンドが最後の和音を鳴らし、伸ばした「エア」ごとラジオの中に戻って砂嵐に消える' },
    ],
    chords: [
      { bars: '3–6 (A メロ)', chords: 'Dm(add9) – B♭maj7 – Gm6 – A7sus4→A7' },
      { bars: '7–10 (サビ)', chords: 'D – A/C♯ – Bm – G' },
      { bars: '11–14', chords: 'D – A – G – D' },
    ],
    riff: 'A メロ: 澄んだギターの8分のアルペジオ (コードの構成音を 1-2-3-4-5-4-3-6 の順に)。サビ: 付点4分 + 4分 + 付点4分のパワーコード',
    lyrics: ['ラジオの むこうで', 'だれかが よんでる', 'NOBODY! NOBODY! ON AIR —', 'とおくの そらへ とどけ', 'NOBODY! NOBODY! ON AIR —— (ラジオの中へ)'],
    song,
    vocals,
    hooks,
    discoveries: [],
    layers: ['ラジオの砂嵐・同調音 (自前のノイズ合成)、最後はバンド全体をラジオの帯域に通す', 'SONOVA v1.1 の画像楽器「ひびの入った氷」(テスト用の手続き画像から作った DNA) の鐘のアルペジオ', 'SONOVA の弦モデルをクリーンアンプで鳴らしたアルペジオ', 'VOICEVOX: 白上虎太郎 (ふつう) が主旋律、(わーい) が3度上のハモり'],
  };
}

// =====================================================================================================
// C — FREAKTION REACTION
// =====================================================================================================
export interface Mutation {
  seed: string;
  transpose: number;
  halfTime: boolean;
  reverse: boolean;
  stutter: number[];
  material: string;
  tapeStop: boolean;
}
export function mutationFor(seed: string): Mutation {
  const r = new Rng(`freaktion:${seed}`);
  return {
    seed,
    transpose: r.pick([6, 1, -5, 3, 8]),
    halfTime: r.next() < 0.6,
    reverse: r.next() < 0.5,
    stutter: Array.from({ length: r.int(2, 4) }, () => r.int(0, 15)).sort((a, b) => a - b),
    material: r.pick(['metal', 'gravel', 'water', 'fabric', 'rust']),
    tapeStop: r.next() < 0.7,
  };
}

/** the electronic layer: three SONOVA image instruments interacting (generator v1.1), at 150 BPM */
export function electronics(seed: string) {
  const dnas = ['mosaic', 'citylights', 'ice'].map((m) => materialDNA(m, seed));
  const gen = generateV11(dnas, { seed, durationSec: 30, arc: 'cascade', bpm: 150 });
  return { dnas, gen };
}

/**
 * FREAKTION search: many seeds, each measured for how much the electronics fight the guitar grid
 * (onsets off the riff's onsets) and how rough they sound — kept if they collide but do not turn to mud.
 * The listening is still a person's job; this only ranks the candidates and stores every one.
 */
export function freaktionSearch(n = 12) {
  const riffOnsets = new Set([0, 3, 6, 9, 12, 14]);
  const rows = Array.from({ length: n }, (_, k) => {
    const seed = `freaktion-${String(k).padStart(2, '0')}`;
    const { gen } = electronics(seed);
    const notes = gen.events.filter((e) => e.kind === 'note' && e.time < 11.2);
    const off = notes.filter((e) => !riffOnsets.has(e.step % 16)).length / Math.max(1, notes.length);
    const rough = gen.statsV11.meanRoughness;
    const density = notes.length / 11.2;
    // collide (off-grid) but stay clear (roughness) and busy enough to be heard
    const score = off * 0.5 + Math.max(0, 1 - rough / 0.3) * 0.3 + Math.min(1, density / 3) * 0.2;
    const mutation = mutationFor(seed);
    return { seed, notes: notes.length, offGrid: Math.round(off * 1000) / 1000, roughness: rough, density: Math.round(density * 100) / 100, score: Math.round(score * 1000) / 1000, mutation: { ...mutation, material: materialName(mutation.material) } };
  });
  return rows.sort((a, b) => b.score - a.score);
}

export function demoC(seed = freaktionSearch()[0].seed): NobodyDemo {
  const s = new Score(150);
  const m = mutationFor(seed);
  const A = 45;
  const E = 40;
  const D = 50;
  const Bb = 46;
  const Ds = 51;
  const Fs = 42;
  // the collision riff: A, B♭ (♭2) and D♯ (♯4) in groups of 3 over the bar
  const riffC: Array<[number, number, 'P' | 'm', number]> = [[0, A, 'P', 3], [3, Bb, 'P', 3], [6, A, 'P', 2], [8, A, 'm', 1], [9, E, 'P', 3], [12, Ds - 12, 'P', 2], [14, A, 'm', 1], [15, A, 'm', 1]];
  // bars 0–2: only the electronics (added in the hook) and a bass pulse that does not agree with them
  for (let bar = 0; bar < 3; bar++) for (const b of [0, 0.75, 1.5, 2.25, 3]) s.bass(bar, b, 33, 0.5, 0.7);
  s.drums(2, { snare: [2, 2.5, 3, 3.25, 3.5, 3.75] }, 0.7);
  // bars 3–6: the riff collides with the electronics
  for (let bar = 3; bar < 7; bar++) {
    s.riff(bar, riffC);
    for (const [st, root, k, len] of riffC) if (k === 'P') s.bass(bar, st / 4, root - 12 < 28 ? root : root - 12, len / 4);
    s.drums(bar, { kick: [0, 0.75, 1.5, 2.25, 3], snare: [1, 3], hat: EIGHTHS, ...(bar === 3 ? { crash: [0] } : {}) });
  }
  // bars 7–8: the mutation (seeded): the riff transposed, maybe reversed, at half time
  for (let bar = 7; bar < 9; bar++) {
    let steps = riffC.map(([st, r, k, len]) => [st, r + m.transpose, k, len] as [number, number, 'P' | 'm', number]);
    if (m.reverse) steps = steps.map(([st, r, k, len]) => [Math.max(0, 16 - st - len), r, k, len] as [number, number, 'P' | 'm', number]).sort((a, b) => a[0] - b[0]);
    if (m.halfTime) {
      const half = steps.filter(([st]) => st < 8).map(([st, r, k, len]) => [st * 2, r, k, len * 2] as [number, number, 'P' | 'm', number]);
      s.riff(bar, half);
      s.drums(bar, { kick: [0, 3], snare: [2], hat: [0, 1, 2, 3] });
    } else {
      s.riff(bar, steps);
      s.drums(bar, { kick: [0, 1, 2, 3], snare: [1, 3], hatOpen: EIGHTHS });
    }
    s.bass(bar, 0, A - 12 + m.transpose, 4, 0.8);
  }
  // bars 9–16: the pop chorus, A – E – F♯m – D, four on the floor
  const chorus: Record<number, number> = { 9: A, 10: E, 11: Fs, 12: D, 13: A, 14: E, 15: Fs, 16: D };
  for (const [barS, r] of Object.entries(chorus)) {
    const bar = Number(barS);
    const root = r > 47 ? r - 12 : r;
    s.guitar(bar, 0, pc(root), 1.5, { vel: 0.95 });
    s.guitar(bar, 1.5, pc(root), 0.5, { vel: 0.8 });
    s.guitar(bar, 2, pc(root), 1.5, { vel: 0.92 });
    s.guitar(bar, 3.5, pc(root), 0.5, { vel: 0.8 });
    for (const b of EIGHTHS) s.bass(bar, b, root - 12 < 26 ? root : root - 12, 0.5, b % 1 ? 0.8 : 0.95);
    s.drums(bar, { kick: [0, 1, 2, 3], snare: [1, 3], hatOpen: [0.5, 1.5, 2.5, 3.5], hat: [0, 1, 2, 3], ...([9, 13].includes(bar) ? { crash: [0] } : {}) });
  }
  s.drums(16, { tom1: [3], tom2: [3.25], tom3: [3.5], snare: [3.75] }, 0.8);
  // bar 17: the last chord
  s.guitar(17, 0, pc(A), 5, { vel: 1 });
  s.bass(17, 0, 33, 4);
  s.drums(17, { kick: [0], crash: [0] }, 1);

  // ---- vocals ----
  const hookC = (bar: number, air: number, top = 64) =>
    sing(s, bar, 0, [['ノ', 61, 0.5], ['バ', 61, 0.5], ['ディ', 64, 1], ['ノ', 61, 0.5], ['バ', 61, 0.5], ['ディ', 66, 1], ['オ', 64, 0.5], ['ン', 66, 0.5], ['エ', 64, 0.5], ['ア', top, air]]);
  const lead: KanaNote[] = [
    ...hookC(9, 2.5),
    // へんな おとで / せかいが かわる
    ...sing(s, 11, 0, [['ヘ', 57, 0.5], ['ン', 59, 0.5], ['ナ', 61, 0.5], ['オ', 64, 0.5], ['ト', 64, 0.5], ['デ', 61, 0.5], ['-', 0, 1], ['セ', 62, 0.5], ['カ', 62, 0.5], ['イ', 64, 0.5], ['ガ', 66, 0.5], ['カ', 64, 0.5], ['ワ', 62, 0.5], ['ル', 61, 1]]),
    ...hookC(13, 2.5),
    ...hookC(15, 6.5, 69),
  ];
  // the preview in the intro and the mutation: a chopped robot "ON AIR" / "NO-NO-BO"
  const robot: KanaNote[] = [
    ...sing(s, 1, 2, [['オ', 57, 0.5], ['ン', 57, 0.5], ['エ', 64, 0.5], ['ア', 57, 1.5]], 0.8),
    ...sing(s, 7, 0, [['ノ', 57 + m.transpose, 0.25], ['ノ', 57 + m.transpose, 0.25], ['ノ', 60 + m.transpose, 0.5], ['バ', 57 + m.transpose, 1], ['-', 0, 2], ['ノ', 63, 0.25], ['ノ', 63, 0.25], ['バ', 61, 0.5], ['ディ', 57, 1]], 0.8),
  ];
  const vocals: VocalPart[] = [
    { name: 'lead', voice: 'wakamatsu', fx: 'rock', pan: -0.15, gain: 0.95, notes: lead },
    { name: 'double', voice: 'kenzaki', delay: 0.014, cents: -7, fx: 'rock', pan: 0.2, gain: 0.65, notes: lead.filter((n) => n.time >= s.t(13)) },
    { name: 'gang', voice: 'kotarouOko', transpose: 12, fx: 'rock-light', pan: 0, gain: 0.38, notes: [...hookC(13, 2.5), ...hookC(15, 6.5, 69)] },
    { name: 'robot', voice: 'kigashima', fx: 'robot', pan: 0.3, gain: 0.7, notes: robot },
  ];
  const sr = 44100;
  const { dnas, gen } = electronics(seed);
  const swapped = materialDNA(m.material, seed);
  const hooks: RockHooks = {
    beforeReverb: (ctx) => {
      const sec = ctx.mix.left.length / sr;
      // 1. the electronics: the generator's notes moved into A, played by their image instruments;
      //    at the mutation their timbre jumps to another material; in the chorus they shrink to an ornament
      const shift = ((9 - gen.key.root_pc + 18) % 12) - 6;
      const before = gen.events.filter((e) => (e.kind === 'note' || e.kind === 'resonance') && e.time < s.t(9));
      for (const [k, dna] of dnas.entries()) {
        const notes = before.filter((e) => e.instrument === k).map((e) => ({ time: e.time, midi: e.midi! + shift, dur: Math.min(1.2, e.duration!), vel: e.velocity!, timbre: e.timbre }));
        const pre = imageInstrument(dna, notes.filter((n) => n.time < s.t(7)), sec, sr, `${seed}:e${k}`);
        const mut = imageInstrument(swapped, notes.filter((n) => n.time >= s.t(7)).map((n) => ({ ...n, midi: n.midi + m.transpose })), sec, sr, `${seed}:m${k}`);
        addLayer(ctx, pre, 0, sr, -23, [-0.55, 0.55, 0][k], 0.25);
        addLayer(ctx, mut, 0, sr, -24, [0.5, -0.5, 0][k], 0.3);
      }
      const pent = [0, 2, 4, 7, 9];
      const orn = gen.events.filter((e) => e.kind === 'note' && e.time >= s.t(9) && e.time < s.t(17) && e.instrument === 0).map((e) => {
        const pcl = (((e.midi! + shift - 9) % 12) + 12) % 12;
        const near = pent.reduce((best, p) => (Math.abs(p - pcl) < Math.abs(best - pcl) ? p : best), 0);
        return { time: e.time, midi: e.midi! + shift + (near - pcl) + 12, dur: 0.4, vel: 0.5 };
      });
      addLayer(ctx, imageInstrument(dnas[0], orn, sec, sr, `${seed}:orn`), 0, sr, -29, 0.4, 0.4);
      // 2. a bytebeat formula of the riff under the intro and the mutation
      const bb = renderBytebeat({ riff: riffC.flatMap(([, r, k, len]) => Array.from({ length: len }, (_, j) => (j === 0 ? (k === 'P' ? r - A : 0) : null))).slice(0, 16), rootHz: midiHz(57), bpm: 150 }, s.t(9), sr);
      const lp = new Biquad('lowpass', 4200, 0.7, sr);
      for (let i = 0; i < bb.length; i++) bb[i] = lp.process(bb[i]) * (i / sr < s.t(3) ? Math.min(1, i / sr) : i / sr >= s.t(7) ? 1 : 0.25);
      addLayer(ctx, bb, 0, sr, -27, 0, 0.1);
      // 3. the mutation acts on the whole band: stutters on seeded 16ths and a tape stop into the chorus
      const stEvents = m.stutter.map((st) => ({ at: s.t(7, st / 4), len: s.beat / 2, kind: 'stutter' as const, slice: s.beat / 8 }));
      ctx.mix.left.set(glitch(ctx.mix.left, sr, stEvents));
      ctx.mix.right.set(glitch(ctx.mix.right, sr, stEvents));
      if (m.tapeStop) {
        const a = Math.round(s.t(8, 2) * sr);
        const b = Math.round(s.t(9) * sr);
        for (const ch of [ctx.mix.left, ctx.mix.right]) {
          const src = ch.slice(a, b);
          let p = 0;
          for (let i = a; i < b; i++) {
            const u = (i - a) / (b - a);
            p += Math.max(0, 1 - u);
            const k = Math.floor(p);
            ch[i] = (src[k] ?? 0) * (1 - u * 0.6);
          }
        }
      }
    },
  };
  const song = toSong(s, 'NOBODY ON AIR — C FREAKTION REACTION', `nobody-c:${seed}`, 9, 'major', [['intro', 0, 3], ['riff', 3, 7], ['breakdown', 7, 9], ['chorus', 9, 17], ['outro', 17, 20]], 31.5);
  return {
    id: 'C',
    title: 'FREAKTION REACTION',
    concept: '突然変異する音楽 × ポップなフック。途中で全部ひっくり返り、口ずさめるサビに着地する',
    bpm: 150,
    key: 'A (♭2・♯4 がぶつかるリフ) → A major (サビ)',
    bars: 18,
    sections: [
      { name: '導入', from: 0, to: 3, text: 'SONOVA の画像楽器3つ (モザイク・夜の街の灯り・氷) が相互作用で鳴らす電子音と、ロボット声の「オンエア」予告' },
      { name: '衝突', from: 3, to: 7, text: '3つずつの塊で進むリフ (A・B♭・D♯) が電子音の拍とぶつかる' },
      { name: '突然変異', from: 7, to: 9, text: `シード ${seed}: リフが ${m.transpose > 0 ? '+' : ''}${m.transpose} 半音${m.reverse ? '・逆順' : ''}${m.halfTime ? '・ハーフタイム' : ''}、電子音の音色が画像楽器「${materialName(m.material)}」に入れ替わる、${m.stutter.length} か所のスタッター${m.tapeStop ? '、テープストップでサビへ' : ''}` },
      { name: 'サビ', from: 9, to: 17, text: 'A – E – F♯m – D の4つ打ちポップ。NOBODY! NOBODY! ON AIR!' },
      { name: '締め', from: 17, to: 18, text: 'A の一撃' },
    ],
    chords: [
      { bars: '3–6 (衝突)', chords: 'A5 – B♭5 – A5 · E5 – D♯5 (3+3+2+3+2+…)' },
      { bars: '7–8 (突然変異)', chords: `同じリフを ${m.transpose > 0 ? '+' : ''}${m.transpose} 半音${m.reverse ? '、逆順' : ''}${m.halfTime ? '、半分の速さ' : ''}` },
      { bars: '9–16 (サビ)', chords: 'A – E – F♯m – D ×2' },
    ],
    riff: 'A5 (3) · B♭5 (3) · A5 (2) · m · E5 (3) · D♯5 (2) · m m — 16分を 3+3+2+1+3+2+1+1 に区切る',
    lyrics: ['(オン エア)', 'NOBODY! NOBODY! ON AIR!', 'へんな おとで せかいが かわる', 'NOBODY! NOBODY! ON AIR!', 'NOBODY! NOBODY! ON AIR ——'],
    song,
    vocals,
    hooks,
    discoveries: [],
    layers: [
      'SONOVA v1.1: 手続き画像「色タイルのモザイク」「夜の街の灯り」「ひびの入った氷」から作った3つの画像楽器 (DNA v1.1) を、相互作用の生成器 v1.1 (模倣・譲る・共鳴…) で 150 BPM に鳴らした電子音',
      `突然変異で電子音の音色を画像楽器「${materialName(m.material)}」に差し替え`,
      'SONOVA のバイトビート (リフを数式にした音)',
      'SONOVA の glitch (スタッター) とテープストップをバンド全体に',
      'VOICEVOX: 雀松朱司 (主旋律)・剣崎雌雄 (ダブル)・白上虎太郎 おこ (1オクターブ上)・麒ヶ島宗麟 (ロボット声)',
    ],
  };
}

export function nobodyDemos(seedC?: string): NobodyDemo[] {
  return [demoA(), demoB(), demoC(seedC)];
}
