/**
 * SONOVA-XROCK — rock pushed out of its edges in five directions, on the SONOVA-ROCK-0001 band.
 *   time   — Paulstretch: the intro is one bar of the first chorus, stretched (Nasca Octavian Paul, public domain)
 *   tempo  — Nancarrow tempo canon: the riff in three tempi, converging on the solo's downbeat
 *            (Nemire 2012; nanc-in-a-can/canon-generator — ideas only)
 *   rhythm — Risset rhythm: drums that accelerate forever under the canon (Stowell 2011; tmhglnd/risset-rhythm-effect, MIT — ideas only)
 *   pitch  — Shepard–Risset glissando: guitar strings that rise without end before the last chorus (Shepard 1964, Risset 1969)
 *   voice  — talkbox: the lead is shaped by vowel formants and "says" EVERYTHING IS AN INSTRUMENT (Peterson & Barney 1952)
 * All reimplemented here from the published descriptions; no code copied.
 */
import { Rng, type InstrumentDNA } from '@sonova/instrument-dna';
import { generateRock, type RockEvent, type RockSong } from '@sonova/music-generator';
import { fft } from '@sonova/source-analyzer';
import { compress, midiToHz, mixInto, renderDrumHit, renderRig, type DrumName, type RigEvent, type SpectroImage, type StereoBuffer } from '@sonova/synthesis-engine';
import { renderRock, rockPlan, type RockBand, type RockRenderResult } from '../rock.ts';

export const XROCK_VERSION = 'sonova-xrock/1.0.0';

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// =============================================================================================
// Paulstretch: window → FFT → keep magnitudes, randomise phases → IFFT → window → overlap-add
// =============================================================================================
export function paulstretch(x: Float32Array, stretch: number, windowSize: number, outLength: number, seed: string): Float32Array {
  const N = windowSize;
  const half = N / 2;
  const win = new Float64Array(N);
  // Paul's window: (1 - t²)^1.25 on t ∈ [-1, 1]
  for (let i = 0; i < N; i++) {
    const t = (2 * i) / (N - 1) - 1;
    win[i] = Math.pow(Math.max(0, 1 - t * t), 1.25);
  }
  const rng = new Rng(`paulstretch:${seed}`);
  const out = new Float32Array(outLength);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const hopIn = half / stretch;
  let pos = 0;
  for (let o = 0; o < outLength; o += half) {
    const p = Math.floor(pos);
    for (let i = 0; i < N; i++) {
      const j = p + i;
      re[i] = (j < x.length ? x[j] : 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const ph = rng.next() * 2 * Math.PI;
      re[k] = mag * Math.cos(ph);
      im[k] = mag * Math.sin(ph);
      if (k > 0 && k < half) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    im[0] = 0;
    im[half] = 0;
    // inverse FFT by conjugation
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < N && o + i < outLength; i++) out[o + i] += ((re[i] / N) * win[i]);
    pos += hopIn;
    if (pos + N > x.length) pos = Math.max(0, x.length - N); // hold the end rather than read silence
  }
  return out;
}

// =============================================================================================
// Nancarrow tempo canon with one convergence point
// =============================================================================================
export interface CanonVoice {
  name: string;
  ratio: number;
  ratioText: string;
  transpose: number;
  entry: number;
  cycles: number;
  reason: string;
}

export interface CanonNote {
  voice: number;
  time: number;
  midis: number[];
  duration: number;
  palmMute: boolean;
  velocity: number;
}

/** Notes of `template` (positions u ∈ [0,1) of one cycle) for each voice, all landing on cycle start at `convergence`. */
export function tempoCanon(
  template: Array<{ u: number; midis: number[]; dur: number; palmMute: boolean; velocity: number }>,
  voices: Array<Omit<CanonVoice, 'entry' | 'cycles'> & { window: number }>,
  cycleSec: number,
  convergence: number,
): { voices: CanonVoice[]; notes: CanonNote[] } {
  const notes: CanonNote[] = [];
  const out: CanonVoice[] = voices.map((v, i) => {
    const c = cycleSec / v.ratio;
    const cycles = Math.max(1, Math.floor(v.window / c + 1e-9));
    const entry = convergence - cycles * c;
    for (let n = 0; n < cycles; n++)
      for (const t of template) notes.push({ voice: i, time: entry + (n + t.u) * c, midis: t.midis.map((m) => m + v.transpose), duration: t.dur / v.ratio, palmMute: t.palmMute, velocity: t.velocity });
    return { name: v.name, ratio: v.ratio, ratioText: v.ratioText, transpose: v.transpose, entry: r3(entry), cycles, reason: v.reason };
  });
  return { voices: out, notes: notes.sort((a, b) => a.time - b.time || a.voice - b.voice) };
}

// =============================================================================================
// Risset rhythm: L layers of one drum bar, each accelerating by 2^L per megabar, faded by sin²
// =============================================================================================
export interface RissetHit {
  time: number;
  drum: DrumName;
  velocity: number;
  layer: number;
  tempoFactor: number;
}

export function rissetRhythm(pattern: Array<{ u: number; drum: DrumName; velocity: number }>, barSec: number, start: number, end: number, megabar: number, layers = 3): RissetHit[] {
  const hits: RissetHit[] = [];
  const L = layers;
  const dt = 0.0005;
  for (let k = 0; k < L; k++) {
    // beat position (in bars) B(t) = A·2^(Lφ − L/2), A = M/(barSec·L·ln2); layers a factor 2 apart stay aligned (B_{k+1} = 2·B_k)
    const A = megabar / (barSec * L * Math.LN2);
    const phase = (t: number) => {
      const p = (t - start) / megabar + k / L;
      return p - Math.floor(p);
    };
    let prevB = -1;
    let prevPhi = -1;
    for (let t = start; t < end; t += dt) {
      const phi = phase(t);
      const B = A * Math.pow(2, L * phi - L / 2);
      if (prevPhi >= 0 && phi >= prevPhi) {
        for (let n = Math.floor(prevB); n <= Math.floor(B); n++)
          for (const p of pattern) {
            const target = n + p.u;
            if (target > prevB && target <= B) {
              const tt = t - dt + ((target - prevB) / (B - prevB)) * dt;
              const g = Math.pow(Math.sin(Math.PI * phase(tt)), 2);
              if (g > 0.06) hits.push({ time: tt, drum: p.drum, velocity: r3(p.velocity * (0.35 + 0.65 * g)), layer: k, tempoFactor: r3(Math.pow(2, L * phase(tt) - L / 2)) });
            }
          }
      }
      prevB = B;
      prevPhi = phi;
    }
  }
  return hits.sort((a, b) => a.time - b.time || a.layer - b.layer);
}

// =============================================================================================
// Shepard–Risset glissando on six KS strings, each through its own amp
// =============================================================================================
export function shepardStrings(rootPc: number, seconds: number, octaveSec: number, sampleRate: number, amp: Parameters<typeof renderRig>[3], seed: string): { left: Float32Array; right: Float32Array; voices: Array<{ pc: number; octave: number }> } {
  const voices = [0, 1, 2].flatMap((o) => [{ pc: rootPc, octave: o }, { pc: (rootPc + 7) % 12, octave: o }]);
  const base = midiToHz(36 + rootPc); // C2 for C
  const left = new Float32Array(Math.ceil(seconds * sampleRate));
  const right = new Float32Array(left.length);
  const span = 3; // octaves
  voices.forEach((v, idx) => {
    const pos = (t: number) => {
      const p = v.octave + ((v.pc - rootPc + 12) % 12) / 12 + t / octaveSec;
      return ((p % span) + span) % span;
    };
    const events: RigEvent[] = [];
    const beat = octaveSec / 8;
    let last = pos(0);
    for (let t = 0; t < seconds; t += 0.02) {
      const p = pos(t);
      const f = base * Math.pow(2, p);
      if (t === 0 || p < last || Math.floor(t / beat) !== Math.floor((t - 0.02) / beat))
        events.push({ time: t, type: 'pluck', freqs: [f], velocity: 0.8, mute: false, pickPosition: 0.2, brightness: 0.75, t60: 4, damping: 0.2 });
      else events.push({ time: t, type: 'bend', string: 0, freq: f, glide: 0.02 });
      last = p;
    }
    const x = renderRig(events, seconds, sampleRate, amp, `${seed}:shepard:${idx}`, 1);
    // the bell over log-frequency is applied after the amp, so the illusion survives the distortion
    const pan = idx % 2 === 0 ? -0.5 : 0.5;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < x.length; i++) {
      const g = Math.pow(Math.sin((Math.PI * pos(i / sampleRate)) / span), 2);
      left[i] += x[i] * g * gl;
      right[i] += x[i] * g * gr;
    }
  });
  return { left, right, voices };
}

// =============================================================================================
// Talkbox: three time-varying formant band-passes (TPT state-variable filters)
// =============================================================================================
export const FORMANTS: Record<string, [number, number, number]> = {
  // Peterson & Barney (1952), adult male averages (Hz)
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};

export function vowelsOf(text: string): string[] {
  return [...text.toLowerCase()].flatMap((c) => (c === 'y' ? ['i'] : 'aeiou'.includes(c) ? [c] : []));
}

export function talkbox(x: Float32Array, sampleRate: number, schedule: Array<{ time: number; vowel: string }>, glideSec = 0.06): void {
  const st = [0, 0, 0].map(() => ({ ic1: 0, ic2: 0, f: 0 }));
  const gains = [1, 0.7, 0.45];
  const bw = [90, 110, 160];
  const coef = Math.exp(-1 / (glideSec * sampleRate));
  let s = 0;
  const target = (i: number) => FORMANTS[schedule[Math.max(0, s - 1)]?.vowel ?? 'a'][i];
  for (let k = 0; k < 3; k++) st[k].f = FORMANTS[schedule[0]?.vowel ?? 'a'][k];
  for (let n = 0; n < x.length; n++) {
    const t = n / sampleRate;
    while (s < schedule.length && schedule[s].time <= t) s++;
    const v = x[n];
    let y = 0.12 * v;
    for (let k = 0; k < 3; k++) {
      const f = st[k];
      f.f = target(k) + (f.f - target(k)) * coef;
      const g = Math.tan((Math.PI * Math.min(f.f, sampleRate * 0.45)) / sampleRate);
      const q = f.f / bw[k];
      const kk = 1 / q;
      const a1 = 1 / (1 + g * (g + kk));
      const a2 = g * a1;
      const a3 = g * a2;
      const v3 = v - f.ic2;
      const v1 = a1 * f.ic1 + a2 * v3;
      const v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
      f.ic1 = 2 * v1 - f.ic1;
      f.ic2 = 2 * v2 - f.ic2;
      y += gains[k] * v1 * 2.2;
    }
    x[n] = y;
  }
}

// =============================================================================================
// The piece
// =============================================================================================
export interface XRockResult {
  song: RockSong;
  render: RockRenderResult;
  stretch: { sourceSection: string; sourceStart: number; sourceSec: number; factor: number; windowSec: number; outSec: number };
  canon: { voices: CanonVoice[]; convergence: number; notes: number };
  risset: { layers: number; megabarSec: number; hits: number; start: number; end: number };
  shepard: { start: number; seconds: number; octaveSec: number; octavesRisen: number };
  talkbox: { text: string; vowels: string[]; notes: number };
}

const DRUM_PAN: Record<DrumName, number> = { kick: 0, snare: 0.04, hat: 0.38, hatOpen: 0.38, crash: -0.42, ride: -0.35, tom1: 0.3, tom2: -0.05, tom3: -0.35 };


function rms(x: Float32Array, a = 0, z = x.length): number {
  let s = 0;
  let n = 0;
  for (let i = a; i < z; i++) {
    if (Math.abs(x[i]) < 1e-5) continue;
    s += x[i] * x[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

export function renderXRock(band: RockBand, seed: string, image: SpectroImage, log: (m: string) => void = () => undefined): XRockResult {
  const bars = { intro: 12, bridge: 16, pre3: 8 };
  const song = generateRock(band, seed, 'Five Ways Out of the Song', { bars: { value: bars, reason: '引き伸ばし (イントロ)・テンポカノン (ブリッジ)・終わらない上昇 (pre3) が聴き取れる長さにする' } });
  const plan = rockPlan(song, band);
  const sec = (name: string) => song.sections.find((s) => s.name === name)!;
  const intro = sec('intro');
  const chorus1 = sec('chorus1');
  const bridge = sec('bridge');
  const pre3 = sec('pre3');
  const barSec = song.barSec;

  // ---- talkbox text and canon voices ----
  const text = 'everything is an instrument';
  const vowels = vowelsOf(text);
  const dnas: Array<[string, InstrumentDNA]> = [
    ['guitar L (bark)', band.guitar],
    ['guitar R (tower)', band.drums],
    ['bass (sunset)', band.voice],
  ];
  // Nancarrow's 3:4:5. Which source plays which tempo: the rhythmically densest (pulses / steps) is the fastest;
  // the slowest voice enters first and plays the whole bridge, the fastest enters last.
  const density = (d: InstrumentDNA) => d.rhythm.pulses / d.rhythm.steps;
  const order = dnas.map((x, i) => ({ i, dens: density(x[1]) })).sort((a, b) => a.dens - b.dens || a.i - b.i);
  const RATIO: Array<[number, string]> = [
    [1, '3'],
    [4 / 3, '4'],
    [5 / 3, '5'],
  ];
  const voiceSpecs = order.map(({ i, dens }, rank) => {
    const [name, d] = dnas[i];
    return {
      name,
      ratio: RATIO[rank][0],
      ratioText: `${RATIO[rank][1]}/3`,
      transpose: i === 1 ? 7 : i === 2 ? -12 : 0,
      window: bridge.end - bridge.start - rank * (barSec * 4),
      reason: `${d.name} のリズムの密度 ${d.rhythm.pulses}/${d.rhythm.steps} = ${dens.toFixed(2)} が 3 つの中で ${['最も低い', '2番目', '最も高い'][rank]} → 3:4:5 の ${RATIO[rank][1]}`,
    };
  });
  const riffBar = sec('riffA').startBar;
  const template = song.events
    .filter((e) => e.part === 'guitar' && e.kind === 'chord' && e.bar === riffBar)
    .map((e) => ({ u: (e.time - riffBar * barSec) / barSec, midis: e.midis!, dur: e.duration!, palmMute: !!e.palmMute, velocity: e.velocity! }));
  const canon = tempoCanon(template, voiceSpecs, barSec, bridge.end);

  // ---- Risset drums: the first bar of chorus1, accelerating forever under the canon ----
  const pattern = song.events
    .filter((e) => e.part === 'drums' && e.kind === 'hit' && e.bar === chorus1.startBar && ['kick', 'snare', 'hat', 'hatOpen'].includes(e.drum!))
    .map((e) => ({ u: (e.time - chorus1.startBar * barSec) / barSec, drum: e.drum as DrumName, velocity: e.velocity! }));
  const megabar = (bridge.end - bridge.start) / 2;
  const rissetStart = bridge.start + barSec * 2;
  const risset = rissetRhythm(pattern, barSec, rissetStart, bridge.end, megabar, 3);

  const stretch = { sourceSection: 'chorus1', sourceStart: chorus1.start, sourceSec: barSec, factor: r3((intro.end - intro.start) / barSec), windowSec: r3(16384 / 44100), outSec: r3(intro.end - intro.start) };
  const shepard = { start: pre3.start, seconds: pre3.end - pre3.start, octaveSec: r3((pre3.end - pre3.start) / 2), octavesRisen: 2 };
  let leadNotes = 0;

  const render = renderRock(song, band, image, 44100, log, {
    leadFx: ({ lead, sampleRate, song: s }) => {
      const notes = s.events.filter((e) => e.part === 'lead' && e.kind === 'note');
      leadNotes = notes.length;
      log('talkbox');
      talkbox(lead, sampleRate, notes.map((e, i) => ({ time: e.time, vowel: vowels[i % vowels.length] })));
    },
    drumEvents: ({ song: s }) =>
      s.events.filter((e) => e.part === 'drums' && !(e.kind === 'hit' && ((e.time >= intro.start && e.time < intro.end) || (e.time >= bridge.start && e.time < bridge.end)))),
    beforeReverb: ({ mix, wet, guitarL, drums, drumGain, sampleRate }) => {
      const at = (t: number) => Math.round(t * sampleRate);
      const len = mix.left.length;
      const silence = (buf: StereoBuffer, a: number, z: number) => {
        buf.left.fill(0, a, Math.min(len, z));
        buf.right.fill(0, a, Math.min(len, z));
      };

      // ---- 1. time: Paulstretch intro from one bar of chorus1 (the whole band) ----
      log('paulstretch');
      const src = at(chorus1.start);
      const srcLen = at(barSec);
      const mono = new Float32Array(srcLen);
      const side = new Float32Array(srcLen);
      for (let i = 0; i < srcLen; i++) {
        mono[i] = (mix.left[src + i] + mix.right[src + i]) / 2;
        side[i] = (mix.left[src + i] - mix.right[src + i]) / 2;
      }
      const ref = rms(mono);
      const outLen = at(intro.end - intro.start);
      const cm = paulstretch(mono, stretch.factor, 16384, outLen, `${seed}:mid`);
      const cs = paulstretch(side, stretch.factor, 16384, outLen, `${seed}:side`);
      const cg = (0.6 * ref) / (rms(cm) || 1);
      silence(mix, 0, at(intro.end));
      silence(wet, 0, at(intro.end));
      for (let i = 0; i < outLen; i++) {
        const t = i / sampleRate;
        // swell: in over 6 s, then a long crescendo that stops dead on the riff's downbeat
        const env = Math.min(1, t / 6) * (0.55 + 0.45 * Math.pow(t / (intro.end - intro.start), 2));
        const m = cm[i] * cg * env;
        const sd = cs[i] * cg * env * 1.3;
        mix.left[i] += m + sd;
        mix.right[i] += m - sd;
        wet.left[i] += (m + sd) * 0.25;
        wet.right[i] += (m - sd) * 0.25;
      }

      // ---- 2. tempo: the canon replaces the band in the bridge ----
      log('tempo canon');
      const b0 = at(bridge.start);
      const b1 = at(bridge.end);
      for (let i = b0; i < b1; i++) {
        const g = Math.max(0, 1 - (i - b0) / at(barSec));
        mix.left[i] *= g;
        mix.right[i] *= g;
        wet.left[i] *= g;
        wet.right[i] *= g;
      }
      const secs = len / sampleRate;
      const pans = [-0.75, 0.75, 0];
      const gRef = rms(guitarL, at(chorus1.start), at(chorus1.end));
      canon.voices.forEach((_v, vi) => {
        const isBass = order[vi].i === 2;
        const amp = isBass ? plan.bassAmp : plan.guitarAmp;
        const pl = isBass ? plan.bassPluck : plan.guitarPluck;
        const ev: RigEvent[] = [];
        const ns = canon.notes.filter((n) => n.voice === vi);
        ns.forEach((n, k) => {
          ev.push({ time: n.time, type: 'pluck', freqs: (isBass ? n.midis.slice(0, 1) : n.midis).map(midiToHz), velocity: n.velocity, mute: n.palmMute, pickPosition: pl.pickPosition, brightness: n.palmMute ? pl.brightness * 0.6 : pl.brightness, t60: n.palmMute ? 0.14 : pl.t60, damping: n.palmMute ? 0.85 : pl.damping, strum: n.palmMute ? 0.003 : 0.009 });
          const next = ns[k + 1];
          if (!n.palmMute && (!next || next.time - (n.time + n.duration) > 0.04)) ev.push({ time: n.time + n.duration, type: 'damp' });
        });
        ev.push({ time: bridge.end + 0.02, type: 'damp' });
        const x = renderRig(ev, secs, sampleRate, amp, `${seed}:canon:${vi}`, isBass ? 1 : 6);
        const g = (gRef * (isBass ? 1.1 : 0.9)) / (rms(x, b0, b1) || 1);
        for (let i = b0; i < Math.min(len, b1 + at(0.3)); i++) {
          const v2 = x[i] * g;
          const pan = pans[order[vi].i];
          const gl = Math.cos(((pan + 1) * Math.PI) / 4);
          const gr = Math.sin(((pan + 1) * Math.PI) / 4);
          mix.left[i] += v2 * gl;
          mix.right[i] += v2 * gr;
          wet.left[i] += v2 * 0.1;
          wet.right[i] += v2 * 0.1;
        }
      });

      // ---- 3. rhythm: Risset drums under the canon ----
      log('risset rhythm');
      const rb: StereoBuffer = { left: new Float32Array(len), right: new Float32Array(len), sampleRate } ;
      risset.forEach((h, k) => mixInto(rb, renderDrumHit(plan.kit, h.drum, h.velocity, sampleRate, `${seed}:risset:${k}`), h.time, DRUM_PAN[h.drum], h.drum === 'kick' ? 1 : h.drum === 'snare' ? 0.8 : 0.32));
      compress(rb.left, rb.right, sampleRate, { thresholdDb: -16, ratio: 4, attack: 0.004, release: 0.09, makeupDb: 3 });
      const dRef = rms(drums.left, at(chorus1.start), at(chorus1.end)) * drumGain;
      const rg = (0.9 * dRef) / (rms(rb.left, at(rissetStart), b1) || 1);
      for (let i = at(rissetStart); i < Math.min(len, b1 + at(0.4)); i++) {
        mix.left[i] += rb.left[i] * rg;
        mix.right[i] += rb.right[i] * rg;
      }

      // ---- 4. pitch: Shepard–Risset strings rising through pre3 ----
      log('shepard strings');
      const sh = shepardStrings(song.key.root_pc, shepard.seconds, shepard.octaveSec, sampleRate, { ...plan.leadAmp, gain: plan.leadAmp.gain * 0.5 }, seed);
      const p0 = at(pre3.start);
      const sg = (1.15 * gRef) / (rms(sh.left) || 1);
      for (let i = 0; i < sh.left.length && p0 + i < len; i++) {
        const cres = 0.5 + 0.5 * (i / sh.left.length);
        mix.left[p0 + i] += sh.left[i] * sg * cres;
        mix.right[p0 + i] += sh.right[i] * sg * cres;
        wet.left[p0 + i] += sh.left[i] * sg * cres * 0.3;
        wet.right[p0 + i] += sh.right[i] * sg * cres * 0.3;
      }
    },
  });
  return {
    song,
    render,
    stretch,
    canon: { voices: canon.voices, convergence: r3(bridge.end), notes: canon.notes.length },
    risset: { layers: 3, megabarSec: r3(megabar), hits: risset.length, start: r3(rissetStart), end: r3(bridge.end) },
    shepard,
    talkbox: { text, vowels, notes: leadNotes },
  };
}

export type { RockEvent };
