/**
 * SONOVA ROCK: a band whose instruments come from images, playing a rock form.
 * The form (intro / verse / chorus …) is a human choice; riff, hook, solo rhythm, drum texture,
 * tempo and key are derived from the instruments' DNA and the seed, and the parts react to each
 * other (kick locks to riff accents, fills make the guitar stop and the bass walk up, a crash
 * sets off amp feedback, feedback flips the drums' cellular-automaton rule …). Every reaction is
 * an event with a cause, as in the free generator.
 */
import type { InstrumentDNA, InteractionEffect } from '@sonova/instrument-dna';
import { Rng, clamp, euclid } from '@sonova/instrument-dna';

export const ROCK_VERSION = 'sonova-rock/1.0.0';

export type RockPart = 'guitar' | 'bass' | 'lead' | 'drums' | 'bytebeat' | 'image' | 'amp';
export type DrumHit = 'kick' | 'snare' | 'hat' | 'hatOpen' | 'crash' | 'ride' | 'tom1' | 'tom2' | 'tom3';
export type RockRule = InteractionEffect | 'stop' | 'feedback' | 'mutate-ca';

export interface RockEvent {
  id: number;
  time: number;
  bar: number;
  slot: number;
  part: RockPart;
  kind: 'chord' | 'note' | 'hit' | 'fill' | 'mutation' | 'texture' | 'feedback' | 'damp' | 'section';
  midi?: number;
  midis?: number[];
  drum?: DrumHit;
  velocity?: number;
  duration?: number;
  palmMute?: boolean;
  slide?: boolean;
  bend?: number;
  vibrato?: number;
  param?: string;
  from?: string | number;
  to?: string | number;
  gain?: number;
  cause?: { event: number; rule: RockRule; from_part: RockPart };
  depth: number;
  text?: string;
}

export interface RockSection {
  name: string;
  startBar: number;
  bars: number;
  start: number;
  end: number;
  description: string;
}

export interface RiffSlot {
  kind: 'pc' | 'single' | 'mute' | 'rest';
  off: number;
}

export interface Derivation {
  choice: string;
  value: string | number;
  from: string;
  rule: string;
}

export interface RockSong {
  engine_version: string;
  seed: string;
  title: string;
  bpm: number;
  barSec: number;
  durationSec: number;
  key: { root_pc: number; mode: string; scale: number[] };
  tuning: string;
  sections: RockSection[];
  riff: RiffSlot[];
  riffText: string;
  hook: Array<number | null>;
  progressions: Record<string, number[]>;
  caRules: Array<{ bar: number; rule: number; cause?: number }>;
  derivations: Derivation[];
  events: RockEvent[];
  stats: { byPart: Record<string, number>; byRule: Record<string, number>; maxDepth: number };
  chains: Array<{ time: number; text: string; eventIds: number[] }>;
}

const FORM: Array<[string, number, string]> = [
  ['intro', 4, 'バイトビート (数式) がリフを先に鳴らし、ギターのフィードバックとタムが立ち上がる'],
  ['riffA', 4, 'バンド全員でリフ。キックはリフのアクセントに揃う'],
  ['verse1', 8, 'ブリッジミュートの8分、セルオートマトンのハイハット'],
  ['pre1', 4, 'bVI–bVII の開放和音、スネアのビルドアップ'],
  ['chorus1', 8, 'i–bVI–bIII–bVII、リードのフック'],
  ['riffB', 4, 'リフの変奏'],
  ['verse2', 8, 'ブリッジミュート、ゴーストノートが増える'],
  ['pre2', 4, 'ビルドアップ'],
  ['chorus2', 8, 'サビ。最後のクラッシュでアンプがハウリングを始める'],
  ['bridge', 8, 'ハーフタイム。ハウリングがドラムの CA ルールを変え、木の年輪の画像がスペクトログラムに描かれる'],
  ['solo', 8, 'リードソロ。リズムはセルオートマトンの世代'],
  ['breakdown', 4, 'ドラムとギターのユニゾン刻み、数式が戻ってくる'],
  ['riffA2', 4, 'リフの再現'],
  ['pre3', 4, '最後のビルドアップ'],
  ['chorus3', 8, 'サビ'],
  ['chorus4', 8, '最後のサビ。フックが1オクターブ上がる'],
  ['riffA3', 4, 'リフ'],
  ['outro', 8, 'リフで締め、最後の和音とハウリング、余韻'],
];

const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTA = [0, 3, 5, 7, 10];
const CA_RULES = [30, 45, 73, 90, 105, 110, 150, 54];

export interface RockOptions {
  /** Override the derived tempo (recorded as a derivation). */
  bpm?: { value: number; reason: string };
  /** Override the key (pitch class), e.g. chosen by a room's lowest mode. */
  rootPc?: { value: number; reason: string };
  /** Change section lengths (bars) of the standard form; names must be the form's own. */
  bars?: { value: Record<string, number>; reason: string };
}

export function generateRock(dnas: { guitar: InstrumentDNA; drums: InstrumentDNA; voice: InstrumentDNA }, seed: string, title = 'Everything Is an Amplifier', opts: RockOptions = {}): RockSong {
  const { guitar: g, drums: d, voice: v } = dnas;
  const rng = new Rng(`rock:${seed}:${g.dna_hash}:${d.dna_hash}:${v.dna_hash}`);
  const derivations: Derivation[] = [];
  const derive = (choice: string, value: string | number, from: string, rule: string) => derivations.push({ choice, value, from, rule });

  const rootPc = opts.rootPc?.value ?? g.pitch_range.root_pc;
  derive('key', `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][rootPc]} minor`, opts.rootPc ? 'series' : `${g.name}.pitch_range.root_pc`, opts.rootPc?.reason ?? 'ギターになった素材の主音。ロックなので自然短音階');
  const bpm = opts.bpm?.value ?? Math.round(clamp(118 + 22 * g.interaction_rules.emission + 6 * d.resonance.amount, 110, 168));
  derive('bpm', bpm, opts.bpm ? 'series' : `${g.name}.interaction_rules.emission, ${d.name}.resonance.amount`, opts.bpm?.reason ?? '働きかけの強い素材ほど速く、共鳴する素材がドライブ感を足す');
  const barSec = (60 / bpm) * 4;
  const slotSec = barSec / 16;
  // Drop tuning: lowest string = the key's root in octave 2 (C2 for C, D2 for D …).
  const tuningRoot = rootPc <= 4 ? 36 + rootPc : 24 + rootPc;
  derive('tuning', `drop ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][rootPc]}`, 'key', '最低弦を主音に下げる (ドロップチューニング) と主音のパワーコードが最も重く鳴る');
  const hitTarget = Math.round(clamp(g.rhythm.pulses * 2, 8, 12));
  derive('riff.hits', hitTarget, `${g.name}.rhythm.pulses`, 'ギター素材のエッジ密度 (発音数) → リフの音数');
  const caRule0 = CA_RULES[Math.floor(clamp(d.resonance.amount, 0, 0.999) * CA_RULES.length)];
  derive('drums.ca_rule', caRule0, `${d.name}.resonance.amount`, 'ドラム素材の反復の強さでセルオートマトンのルールを選ぶ');
  const caSeedRow = euclid(16, d.rhythm.pulses, d.rhythm.rotation);
  derive('drums.ca_seed', caSeedRow.map((c) => (c ? 'x' : '.')).join(''), `${d.name}.rhythm`, 'ドラム素材のユークリッドリズムを最初の世代にする');
  const slideProb = clamp(v.attack * 0.9, 0.1, 0.7);
  derive('lead.slide', slideProb, `${v.name}.attack`, 'ゆっくり立ち上がる素材ほどリードが音をつなげて (スライドで) 弾く');

  // ---- Riff: best of 400 seeded candidates by a rock-riff score ----------------------
  const riff = makeRiff(rng.fork('riff'), hitTarget);
  const riffText = riff.map((s) => (s.kind === 'rest' ? '.' : s.kind === 'mute' ? 'm' : s.kind === 'pc' ? (s.off === 0 ? 'R' : 'P') : 'n')).join('');
  // ---- Hook ----
  const hook = makeHook(rng.fork('hook'));

  const progressions: Record<string, number[]> = {
    verse: [0, 0, 0, 10],
    pre: [8, 10, 8, 10],
    chorus: [0, 8, 3, 10],
    bridge: [5, 8, 0, 10],
    riff: [0, 0, 0, 0],
  };

  const events: RockEvent[] = [];
  let nextId = 0;
  const push = (e: Omit<RockEvent, 'id' | 'time'> & { time?: number }): RockEvent => {
    const ev: RockEvent = { id: nextId++, time: round6(e.time ?? e.bar * barSec + e.slot * slotSec), ...e } as RockEvent;
    events.push(ev);
    return ev;
  };

  const sections: RockSection[] = [];
  let bar = 0;
  if (opts.bars) derive('form.bars', Object.entries(opts.bars.value).map(([k, v]) => `${k}=${v}`).join(', '), 'series', opts.bars.reason);
  for (const [name, formBars, description] of FORM) {
    const bars = opts.bars?.value[name] ?? formBars;
    sections.push({ name, startBar: bar, bars, start: round6(bar * barSec), end: round6((bar + bars) * barSec), description });
    bar += bars;
  }
  const totalBars = bar;
  const durationSec = round6(totalBars * barSec + 4.5);

  // ---- Cellular automaton (drums' texture), one generation per bar ---------------------
  let caRule = caRule0;
  let cells = caSeedRow;
  const caRules: RockSong['caRules'] = [{ bar: 0, rule: caRule }];
  const caForBar: boolean[][] = [];
  const step = (c: boolean[], rule: number) => c.map((_, i) => ((rule >> (((c[(i + 15) % 16] ? 4 : 0) | (c[i] ? 2 : 0) | (c[(i + 1) % 16] ? 1 : 0)))) & 1) === 1);
  let pendingRule: { bar: number; rule: number; cause: number } | null = null;

  const chordAt = (sec: RockSection, barInSec: number) => {
    const kind = sec.name.startsWith('chorus') || sec.name === 'solo' ? 'chorus' : sec.name.startsWith('pre') ? 'pre' : sec.name.startsWith('verse') ? 'verse' : sec.name === 'bridge' ? 'bridge' : 'riff';
    const prog = progressions[kind];
    return { kind, root: tuningRoot + prog[barInSec % prog.length] };
  };
  const power = (root: number) => [root, root + 7, root + 12];

  for (const sec of sections) {
    push({ bar: sec.startBar, slot: 0, part: 'drums', kind: 'section', depth: 0, text: sec.name });
    for (let b = 0; b < sec.bars; b++) {
      const absBar = sec.startBar + b;
      if (pendingRule && pendingRule.bar <= absBar) {
        const ev = push({ bar: absBar, slot: 0, part: 'drums', kind: 'mutation', param: 'ca_rule', from: caRule, to: pendingRule.rule, depth: 2, cause: { event: pendingRule.cause, rule: 'mutate-ca', from_part: 'amp' } });
        caRule = pendingRule.rule;
        caRules.push({ bar: absBar, rule: caRule, cause: ev.id });
        pendingRule = null;
      }
      cells = absBar === 0 ? cells : step(cells, caRule);
      if (cells.every((c) => !c)) cells = caSeedRow; // a dead automaton is reseeded from the source
      caForBar[absBar] = cells;
      const lastBar = b === sec.bars - 1;
      const { kind, root } = chordAt(sec, b);
      const fillBar = lastBar && sec.name !== 'outro' && sec.name !== 'intro' && (sec.bars >= 8 || sec.name.startsWith('pre'));
      const energy = sec.name.startsWith('chorus') ? 1 : sec.name === 'solo' ? 0.95 : sec.name.startsWith('riff') ? 0.9 : sec.name.startsWith('verse') ? 0.7 : sec.name.startsWith('pre') ? 0.8 : sec.name === 'bridge' ? 0.55 : 0.75;

      // ---------- Guitar ----------
      const gEvents: RockEvent[] = [];
      const guitar = (slot: number, midis: number[], dur: number, opts: Partial<RockEvent> = {}) => {
        const e = push({ bar: absBar, slot, part: 'guitar', kind: 'chord', midis, midi: midis[0], velocity: round6(clamp(0.55 + energy * 0.4 + (slot === 0 ? 0.05 : 0), 0, 1)), duration: round6(dur * slotSec), depth: 0, ...opts });
        gEvents.push(e);
        return e;
      };
      if (sec.name === 'intro') {
        if (b === 2) {
          const e = guitar(0, power(tuningRoot), 32, { text: 'feedback swell' });
          push({ bar: absBar, slot: 2, part: 'amp', kind: 'feedback', gain: 1.5, duration: round6(barSec * 1.6), depth: 1, cause: { event: e.id, rule: 'feedback', from_part: 'guitar' } });
        }
      } else if (sec.name.startsWith('riff') || (sec.name === 'outro' && !lastBar)) {
        const variation = b % 2 === 1 && (sec.name === 'riffB' || b === 3);
        riff.forEach((s, slot) => {
          if (s.kind === 'rest') return;
          let off = s.off;
          if (variation && slot >= 12) off = [10, 7, 5, 3][slot - 12] ?? off;
          if (sec.name === 'riffB' && b < 2) off += 5;
          const r = tuningRoot + off;
          const midis = s.kind === 'pc' ? power(r) : [r];
          guitar(slot, midis, s.kind === 'mute' ? 1 : nextHitGap(riff, slot), { palmMute: s.kind === 'mute' || s.kind === 'single' && slot % 2 === 1 });
        });
      } else if (sec.name === 'outro' && lastBar) {
        const e = guitar(0, power(tuningRoot), 64, { text: 'final chord' });
        push({ bar: absBar, slot: 4, part: 'amp', kind: 'feedback', gain: 1.7, duration: round6(barSec * 1.8), depth: 1, cause: { event: e.id, rule: 'feedback', from_part: 'guitar' } });
      } else if (kind === 'verse') {
        for (let s = 0; s < 16; s += 2) guitar(s, power(root), s === 0 ? 2 : 1.5, { palmMute: s !== 0 });
        if (sec.name === 'verse2' && b % 2 === 1) guitar(15, power(root + 3), 1, { palmMute: true });
      } else if (kind === 'pre') {
        guitar(0, power(root), 8);
        guitar(8, power(root), b === 3 ? 4 : 8);
        if (b === 3) for (let s = 12; s < 16; s++) guitar(s, power(root), 1, { palmMute: true });
      } else if (kind === 'chorus') {
        for (const [s, dur] of [[0, 6], [6, 2], [8, 3], [11, 3], [14, 2]] as const) guitar(s, power(root), dur);
      } else if (kind === 'bridge') {
        const e = guitar(0, power(root), 16);
        if (b === 0) push({ bar: absBar, slot: 0, part: 'amp', kind: 'feedback', gain: 0, duration: round6(barSec), depth: 1, cause: { event: e.id, rule: 'feedback', from_part: 'guitar' }, text: 'feedback fades' });
        if (b % 2 === 1) guitar(8, power(root + 7), 8);
      } else if (sec.name === 'breakdown') {
        cells.forEach((c, s) => c && s % 2 === 0 && guitar(s, power(tuningRoot), 1, { palmMute: s !== 0 }));
      }

      // Fill at the end of long sections: decided before the drums so the kick never locks to a removed hit.
      let fillEvent: RockEvent | null = null;
      if (fillBar) {
        fillEvent = push({ bar: absBar, slot: 12, part: 'drums', kind: 'fill', depth: 0, text: 'fill' });
        // Guitar stops on beat 4 so the fill is heard.
        for (let k = gEvents.length - 1; k >= 0; k--) {
          if (gEvents[k].slot >= 12) {
            events.splice(events.indexOf(gEvents[k]), 1);
            gEvents.splice(k, 1);
          }
        }
        push({ bar: absBar, slot: 12, part: 'guitar', kind: 'damp', depth: 1, cause: { event: fillEvent.id, rule: 'stop', from_part: 'drums' }, text: 'ギターがフィルのために止まる' });
      }

      // ---------- Drums (pattern per section + CA texture + interaction) ----------
      const hit = (slot: number, drum: DrumHit, vel: number, opts: Partial<RockEvent> = {}) => (fillEvent && slot >= 12 && !opts.cause && drum !== 'crash' ? null : push({ bar: absBar, slot, part: 'drums', kind: 'hit', drum, velocity: round6(clamp(vel, 0.05, 1)), depth: 0, ...opts }));
      const kickSlots = new Set<number>();
      if (sec.name === 'intro') {
        if (b === 2) for (let s = 0; s < 16; s += 2) hit(s, 'tom3', 0.3 + s * 0.035);
        if (b === 3) for (let s = 0; s < 16; s++) hit(s, 'snare', 0.25 + s * 0.045);
      } else if (sec.name === 'breakdown') {
        cells.forEach((c, s) => {
          if (c && s % 2 === 0) {
            hit(s, 'kick', 0.95);
            hit(s, s % 4 === 0 ? 'crash' : 'snare', 0.8);
          }
        });
      } else if (!(sec.name === 'outro' && lastBar)) {
        const half = sec.name === 'bridge';
        const backbeat = half ? [8] : [4, 12];
        backbeat.forEach((s) => hit(s, 'snare', 0.85 + energy * 0.1));
        const baseKick = half ? [0, 10] : kind === 'pre' ? [0, 4, 8, 12] : kind === 'verse' ? [0, 7, 8, 10] : [0, 8];
        baseKick.forEach((s) => kickSlots.add(s));
        // Entrain: the kick copies the guitar's accents (riff hits / chorus pushes).
        for (const ge of gEvents) {
          if (ge.palmMute || kickSlots.has(ge.slot) || ge.slot % 2 === 1 || kind === 'verse') continue;
          kickSlots.add(ge.slot);
          hit(ge.slot, 'kick', 0.85, { depth: 1, cause: { event: ge.id, rule: 'entrain', from_part: 'guitar' } });
        }
        baseKick.forEach((s) => hit(s, 'kick', 0.95));
        // Cymbal layer: CA cells decide where the hats/ride speak beyond the 8th-note grid.
        const cym: DrumHit = kind === 'chorus' ? 'hatOpen' : 'hat';
        // Half-time bridge: no cymbals (the picture lives up there) — floor-tom pulse instead.
        if (half) for (let s = 0; s < 16; s += 4) hit(s, 'tom3', 0.5 + (s === 0 ? 0.2 : 0));
        for (let s = 0; s < 16 && !half; s++) {
          const grid = s % 2 === 0;
          const ca = cells[s] && (sec.name === 'solo' || sec.name.startsWith('verse2') || kind === 'chorus');
          if (grid || ca) hit(s, cym, (grid ? 0.55 : 0.32) + (s % 4 === 0 ? 0.15 : 0), ca && !grid ? { text: 'ca' } : {});
          if (kind === 'verse' && cells[s] && s % 2 === 1 && sec.name === 'verse2') hit(s, 'snare', 0.18, { text: 'ghost (ca)' });
        }
        if (b === 0 && sec.name !== 'verse1' && sec.name !== 'verse2') hit(0, 'crash', 0.9);
        if (kind === 'chorus' && b === 4) hit(0, 'crash', 0.85);
        if (kind === 'pre' && b === 3) for (let s = 8; s < 16; s++) hit(s, 'snare', 0.4 + (s - 8) * 0.07);
      } else {
        hit(0, 'kick', 1);
        hit(0, 'crash', 1);
      }

      // Fill: toms chosen by the CA row; the bass walks up below.
      if (fillEvent) {
        const toms: DrumHit[] = ['snare', 'tom1', 'tom2', 'tom3'];
        for (let s = 12; s < 16; s++) {
          const idx = (cells[s] ? 1 : 0) + (cells[(s + 5) % 16] ? 2 : 0);
          hit(s, toms[(idx + s) % 4], 0.6 + (s - 12) * 0.1, { cause: { event: fillEvent.id, rule: 'rhythm', from_part: 'drums' }, depth: 1 });
          if (s % 2 === 0) hit(s, 'kick', 0.7, { cause: { event: fillEvent.id, rule: 'rhythm', from_part: 'drums' }, depth: 1 });
        }
      }
      // Chorus 2 ends with a crash on the last bar → the amp starts to howl → the drums' CA rule changes.
      if (sec.name === 'chorus2' && lastBar) {
        const crash = hit(8, 'crash', 1, { text: 'crash' })!;
        const fb = push({ bar: absBar, slot: 8, part: 'amp', kind: 'feedback', gain: 1.6, duration: round6(barSec * 2), depth: 1, cause: { event: crash.id, rule: 'feedback', from_part: 'drums' } });
        const newRule = CA_RULES[(CA_RULES.indexOf(caRule) + 3) % CA_RULES.length];
        pendingRule = { bar: absBar + 1, rule: newRule, cause: fb.id };
      }

      // ---------- Bass (from the voice source) ----------
      const bassRoot = root - 12;
      const bass = (slot: number, midi: number, dur: number, opts: Partial<RockEvent> = {}) => push({ bar: absBar, slot, part: 'bass', kind: 'note', midi, velocity: round6(0.75 + energy * 0.2), duration: round6(dur * slotSec), depth: 0, ...opts });
      if (sec.name === 'intro') {
        if (b === 3) bass(0, bassRoot, 16);
      } else if (sec.name === 'outro' && lastBar) bass(0, bassRoot, 48);
      else if (sec.name === 'bridge') {
        [[0, 0, 6], [6, 7, 2], [8, 10, 8]].forEach(([s, iv, dur]) => bass(s, bassRoot + iv, dur));
      } else if (sec.name === 'breakdown') {
        cells.forEach((c, s) => c && s % 2 === 0 && bass(s, bassRoot, 1.5));
      } else {
        const limit = fillEvent ? 12 : 16;
        for (let s = 0; s < limit; s += 2) {
          const pop = kind === 'chorus' && s % 8 === 6;
          bass(s, bassRoot + (pop ? 12 : 0), 1.6, kickSlots.has(s) ? { velocity: 0.98 } : {});
        }
        if (fillEvent) {
          // Walk up to the next section's root.
          const nextSec = sections[sections.indexOf(sec) + 1];
          const target = nextSec ? chordAt(nextSec, 0).root - 12 : bassRoot;
          const walk = [target - 4, target - 3, target - 2, target - 1].map((m) => (m < 22 ? m + 12 : m));
          walk.forEach((m, k) => bass(12 + k, m, 1, { depth: 1, cause: { event: fillEvent!.id, rule: 'attract', from_part: 'drums' } }));
        }
      }

      // ---------- Lead (hook in choruses, solo, answers in verse 2) ----------
      if (kind === 'chorus' && sec.name !== 'solo') {
        const octave = sec.name === 'chorus4' ? 12 : 0;
        const phraseBar = b % 2;
        const chordEv = gEvents[0];
        for (let s = 0; s < 8; s++) {
          const deg = hook[phraseBar * 8 + s];
          if (deg === null) continue;
          let midi = 60 + rootPc + deg + octave;
          // Attract: strong beats move to the nearest chord tone of the current chord.
          if (s % 4 === 0 && chordEv) {
            const rel = (((root - tuningRoot) % 12) + 12) % 12;
            const third = [0, 5, 7].includes(rel) ? 3 : 4;
            const tones = [root, root + third, root + 7].map((t) => ((t % 12) + 12) % 12);
            const best = nearestPc(midi, tones);
            if (best !== midi) {
              const ev = push({ bar: absBar, slot: s * 2, part: 'lead', kind: 'note', midi: best, velocity: 0.85, duration: round6(2 * slotSec * (s === 7 ? 4 : 1.9)), depth: 1, vibrato: v.modulation.vibrato_depth * 2, cause: { event: chordEv.id, rule: 'attract', from_part: 'guitar' } });
              void ev;
              continue;
            }
          }
          if (b === 7 && s >= 4) midi = s === 4 ? 60 + rootPc + octave : midi;
          push({ bar: absBar, slot: s * 2, part: 'lead', kind: 'note', midi, velocity: 0.8, duration: round6(2 * slotSec * (s === 7 || (b === 7 && s === 4) ? 6 : 1.9)), depth: 0, slide: rng.next() < slideProb, vibrato: v.modulation.vibrato_depth * 2 });
          if (b === 7 && s === 4) break;
        }
      } else if (sec.name === 'solo') {
        // Rhythm: the CA generation of this bar; pitch: a pentatonic walk climbing over 8 bars.
        let deg = 4 + Math.floor(b / 2);
        for (let s = 0; s < 16; s++) {
          if (!cells[s] && s % 4 !== 0) continue;
          deg += rng.pick([-2, -1, 1, 1, 2]);
          deg = clamp(deg, 2, 11 + Math.floor(b / 3));
          const midi = 60 + rootPc + PENTA[((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5) - 12;
          const end = s === 15 || (cells[(s + 1) % 16] === false && s % 4 === 3);
          push({ bar: absBar, slot: s, part: 'lead', kind: 'note', midi, velocity: 0.75 + (b / 8) * 0.2, duration: round6(slotSec * (end ? 3 : 1.1)), depth: 0, bend: end && rng.next() < 0.5 ? 2 : 0, slide: rng.next() < slideProb * 0.6, vibrato: end ? v.modulation.vibrato_depth * 3 : 0, text: s % 4 !== 0 ? 'ca' : undefined });
        }
      }

      // ---------- Bytebeat / image textures ----------
      if (sec.name === 'intro' && b === 0) push({ bar: absBar, slot: 0, part: 'bytebeat', kind: 'texture', duration: round6(barSec * 3), depth: 0, text: 'riff as a formula' });
      if (sec.name === 'breakdown' && b === 0) push({ bar: absBar, slot: 0, part: 'bytebeat', kind: 'texture', duration: round6(barSec * 4), depth: 0, text: 'formula returns' });
      if (sec.name === 'bridge' && b === 0) push({ bar: absBar, slot: 0, part: 'image', kind: 'texture', duration: round6(barSec * 8), depth: 0, text: `${g.source_name} painted in the spectrogram` });
    }
  }

  events.sort((a, b) => a.time - b.time || a.id - b.id);
  const byPart: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  let maxDepth = 0;
  for (const e of events) {
    byPart[e.part] = (byPart[e.part] ?? 0) + 1;
    if (e.cause) byRule[e.cause.rule] = (byRule[e.cause.rule] ?? 0) + 1;
    maxDepth = Math.max(maxDepth, e.depth);
  }
  return {
    engine_version: ROCK_VERSION,
    seed,
    title,
    bpm,
    barSec: round6(barSec),
    durationSec,
    key: { root_pc: rootPc, mode: 'aeolian', scale: NATURAL_MINOR },
    tuning: `drop (lowest string MIDI ${tuningRoot})`,
    sections,
    riff,
    riffText,
    hook,
    progressions,
    caRules,
    derivations,
    events,
    stats: { byPart, byRule, maxDepth },
    chains: rockChains(events),
  };
}

function nextHitGap(riff: RiffSlot[], slot: number): number {
  for (let s = slot + 1; s < 16; s++) if (riff[s].kind !== 'rest') return Math.max(1, s - slot);
  return 16 - slot;
}

function nearestPc(midi: number, pcs: number[]): number {
  let best = midi;
  let dist = 99;
  for (let m = midi - 6; m <= midi + 6; m++) {
    if (pcs.includes(((m % 12) + 12) % 12) && Math.abs(m - midi) < dist) {
      dist = Math.abs(m - midi);
      best = m;
    }
  }
  return best;
}

/** Riff = best-scoring of many seeded candidates (a tiny evolutionary choice, all recorded). */
export function makeRiff(rng: Rng, hitTarget: number): RiffSlot[] {
  let best: RiffSlot[] = [];
  let bestScore = -Infinity;
  const offs = [0, 0, 3, 5, 6, 7, 10, 12];
  for (let c = 0; c < 400; c++) {
    const slots: RiffSlot[] = [];
    for (let s = 0; s < 16; s++) {
      if (s === 0) {
        slots.push({ kind: 'pc', off: 0 });
        continue;
      }
      const p = rng.next();
      if (p < 0.32) slots.push({ kind: 'rest', off: 0 });
      else if (p < 0.5) slots.push({ kind: 'mute', off: 0 });
      else if (p < 0.78) slots.push({ kind: 'single', off: rng.pick(offs) });
      else slots.push({ kind: 'pc', off: rng.pick([0, 3, 5, 7, 10]) });
    }
    const hits = slots.filter((s) => s.kind !== 'rest').length;
    const rests = 16 - hits;
    const offbeat = slots.filter((s, i) => s.kind === 'pc' && i % 4 !== 0).length;
    const pcs = slots.filter((s) => s.kind === 'pc').length;
    const distinct = new Set(slots.filter((s) => s.kind !== 'rest').map((s) => s.off)).size;
    const tail = slots.slice(12).filter((s) => s.kind !== 'rest' && [3, 5, 7, 10].includes(s.off)).length;
    let leaps = 0;
    let prev = 0;
    for (const s of slots) {
      if (s.kind === 'rest' || s.kind === 'mute') continue;
      leaps += Math.abs(s.off - prev) > 7 ? 1 : 0;
      prev = s.off;
    }
    const score = -Math.abs(hits - hitTarget) * 2 - (rests < 3 ? 4 : 0) + Math.min(offbeat, 3) * 1.5 + Math.min(distinct, 4) + (pcs >= 3 && pcs <= 6 ? 3 : 0) + Math.min(tail, 2) * 2 - leaps * 1.5 + (slots[8].kind !== 'rest' ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = slots;
    }
  }
  return best;
}

/** Two-bar chorus hook in the minor pentatonic (8 eighth notes per bar, null = rest). */
export function makeHook(rng: Rng): Array<number | null> {
  let best: Array<number | null> = [];
  let bestScore = -Infinity;
  const scale = [-2, 0, 3, 5, 7, 10, 12, 15];
  for (let c = 0; c < 300; c++) {
    const notes: Array<number | null> = [];
    let idx = rng.int(1, 4);
    for (let s = 0; s < 16; s++) {
      if (s % 8 !== 0 && rng.next() < 0.28) {
        notes.push(null);
        continue;
      }
      idx = clamp(idx + rng.pick([-2, -1, -1, 0, 1, 1, 2]), 0, scale.length - 1);
      notes.push(scale[idx]);
    }
    const played = notes.filter((n): n is number => n !== null);
    const peak = played.indexOf(Math.max(...played));
    const rhythmRepeat = notes.slice(0, 8).every((n, i) => (n === null) === (notes[i + 8] === null)) ? 4 : 0;
    const range = Math.max(...played) - Math.min(...played);
    const score = rhythmRepeat + (peak > 3 && peak < played.length - 2 ? 3 : 0) - Math.abs(range - 10) * 0.4 + (notes[15] === 0 || notes[15] === 12 || notes[14] === 0 ? 3 : 0) + (notes[0] === 7 || notes[0] === 3 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = notes;
    }
  }
  return best;
}

const PART_JA: Record<RockPart, string> = { guitar: 'ギター', bass: 'ベース', lead: 'リード', drums: 'ドラム', bytebeat: '数式', image: '画像', amp: 'アンプ' };
const RULE_JA: Record<RockRule, string> = { resonate: '共鳴', timbre: '音色', rhythm: 'リズム', entrain: '同調', attract: '引き寄せ', stop: '停止', feedback: 'ハウリング', 'mutate-ca': 'CA ルール変化' };

export function describeRockEvent(e: RockEvent): string {
  const who = PART_JA[e.part];
  if (e.kind === 'feedback') return `${who}がハウリング (gain ${e.gain})`;
  if (e.kind === 'mutation') return `${who}のセルオートマトンが rule ${e.from} → ${e.to}`;
  if (e.kind === 'fill') return `${who}がフィル`;
  if (e.kind === 'damp') return `${who}が止まる`;
  if (e.kind === 'hit') return `${who} ${e.drum}`;
  if (e.kind === 'chord') return `${who}が和音 (root ${e.midi})`;
  if (e.kind === 'note') return `${who}が MIDI ${e.midi}`;
  return `${who} ${e.text ?? e.kind}`;
}

function rockChains(events: RockEvent[]): RockSong['chains'] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const chains: RockSong['chains'] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.cause || e.depth < 1) continue;
    const path: RockEvent[] = [];
    let cur: RockEvent | undefined = e;
    while (cur) {
      path.unshift(cur);
      cur = cur.cause ? byId.get(cur.cause.event) : undefined;
    }
    const sig = path.map((p) => `${p.part}:${p.kind}:${p.cause?.rule ?? ''}`).join('>');
    if (seen.has(sig) && e.depth < 2) continue;
    seen.add(sig);
    chains.push({ time: path[0].time, eventIds: path.map((p) => p.id), text: path.map((p, i) => (i === 0 ? describeRockEvent(p) : `[${RULE_JA[p.cause!.rule]}] ${describeRockEvent(p)}`)).join(' → ') });
  }
  return chains.slice(0, 40);
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
