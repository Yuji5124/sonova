/**
 * SONOVA 004 — 音が空間を作る (sound builds the space)
 *
 * A shoebox room is both the instrument and the score:
 *   space → sound: the room's resonant modes f = c/2·√((nx/Lx)²+(ny/Ly)²+(nz/Lz)²) become the pitches
 *                  (exact, so microtonal), and the arrival times of the early reflections become the rhythm.
 *                  Every note is rendered *in* the room (image-source early reflections for two ears + a
 *                  late tail whose length follows Sabine's RT60).
 *   sound → space: after each generation the listener measures low / mid / high energy and brightness of
 *                  what it heard; low energy pushes the side walls apart (Lx), mid the far wall (Ly), high the
 *                  ceiling (Lz), and brightness hardens or softens the walls (absorption).
 * The deforming room is exported as an animated glTF.
 */
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { Rng, clamp } from '@sonova/instrument-dna';
import { averageSpectrum, bandEnergyDb, hzToMidi } from '@sonova/source-analyzer';
import { createBus, fadeEdges, master, renderVoice, reverb, type MasterReport, type StereoBuffer } from '@sonova/synthesis-engine';

export const SPACE_VERSION = 'sonova-space/1.0.0';
const C = 343;

export interface Room {
  L: [number, number, number];
  absorption: number;
}

export interface RoomMode {
  n: [number, number, number];
  hz: number;
}

export interface SpaceGeneration {
  gen: number;
  start: number;
  room: Room;
  rt60: number;
  modes: RoomMode[];
  drone: { hz: number; mode: [number, number, number] };
  melody: Array<{ time: number; hz: number; cents: number; mode: [number, number, number] }>;
  rhythmSlots: number[];
  reflectionsMs: number[];
  heard: { lowShare: number; midShare: number; highShare: number; centroidHz: number };
}

export interface SpaceChange {
  gen: number;
  param: string;
  from: number;
  to: number;
  cause: string;
}

export interface SpaceResult {
  engine_version: string;
  seed: string;
  generations: SpaceGeneration[];
  changes: SpaceChange[];
  durationSec: number;
  buffer: StereoBuffer;
  master: MasterReport;
  derivations: Array<{ choice: string; value: string | number; from: string; rule: string }>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function roomModes(room: Room, maxHz = 420, count = 24): RoomMode[] {
  const out: RoomMode[] = [];
  const [lx, ly, lz] = room.L;
  for (let a = 0; a <= 8; a++)
    for (let b = 0; b <= 8; b++)
      for (let c = 0; c <= 6; c++) {
        if (a + b + c === 0) continue;
        const hz = (C / 2) * Math.sqrt((a / lx) ** 2 + (b / ly) ** 2 + (c / lz) ** 2);
        if (hz <= maxHz) out.push({ n: [a, b, c], hz: r3(hz) });
      }
  return out.sort((p, q) => p.hz - q.hz).slice(0, count);
}

export function sabineRt60(room: Room): number {
  const [x, y, z] = room.L;
  const V = x * y * z;
  const S = 2 * (x * y + y * z + x * z);
  return 0.161 * V / (S * room.absorption);
}

type Vec = [number, number, number];

/** Image sources up to `order` (sum of |reflections|) for a source in a shoebox. */
export function imageSources(room: Room, src: Vec, order: number): Array<{ pos: Vec; order: number }> {
  const out: Array<{ pos: Vec; order: number }> = [];
  const axis = (n: number, p: number, L: number) => (n % 2 === 0 ? n * L + p : (n + 1) * L - p);
  for (let i = -order; i <= order; i++)
    for (let j = -order; j <= order; j++)
      for (let k = -order; k <= order; k++) {
        const o = Math.abs(i) + Math.abs(j) + Math.abs(k);
        if (o > order) continue;
        out.push({ pos: [axis(i, src[0], room.L[0]), axis(j, src[1], room.L[1]), axis(k, src[2], room.L[2])], order: o });
      }
  return out;
}

const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function fold(hz: number, lo: number, hi: number): number {
  let f = hz;
  while (f < lo) f *= 2;
  while (f > hi) f /= 2;
  return f;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function renderSpace(band: { melody: InstrumentDNA; drone: InstrumentDNA; walls: InstrumentDNA }, seed: string, generationsCount = 12, sampleRate = 44100): SpaceResult {
  const rng = new Rng(`space:${seed}`);
  const derivations: SpaceResult['derivations'] = [];
  const derive = (choice: string, value: string | number, from: string, rule: string) => derivations.push({ choice, value, from, rule });
  const w = band.walls;
  let room: Room = {
    L: [r3(5 + w.resonance.q * 0.6), r3(4 + w.resonance.amount * 4), r3(2.6 + w.decay * 0.8)],
    absorption: r3(clamp(0.12 + w.noise.amount * 0.4, 0.08, 0.6)),
  };
  derive('room.L', room.L.join(' × '), `${w.name}.resonance.q / resonance.amount / decay`, '外壁の格子の規則性と共鳴 → 部屋の幅・奥行き・高さ');
  derive('room.absorption', room.absorption, `${w.name}.noise.amount`, '表面の粗さ → 壁の吸音率');
  const genSec = 6;
  const total = generationsCount * genSec + 5;
  const out = createBus(total, sampleRate);
  const lateIn = createBus(total, sampleRate);
  const generations: SpaceGeneration[] = [];
  const changes: SpaceChange[] = [];
  const bpm = 80;
  const barSec = (60 / bpm) * 4;
  const slot = barSec / 16;
  const melRange: [number, number] = [midiHz(band.melody.pitch_range.low), midiHz(band.melody.pitch_range.high)];
  const droneRange: [number, number] = [midiHz(band.drone.pitch_range.low), midiHz(band.drone.pitch_range.high)];
  const strikeHz = midiHz(band.walls.pitch_range.center);
  const prevRms: number[] = [];
  const prevCentroid: number[] = [];

  for (let g = 0; g < generationsCount; g++) {
    const t0 = g * genSec;
    const [lx, ly, lz] = room.L;
    const listener: Vec = [lx * 0.5, ly * 0.35, 1.6];
    const ears: Vec[] = [
      [listener[0] - 0.09, listener[1], listener[2]],
      [listener[0] + 0.09, listener[1], listener[2]],
    ];
    const srcPos: Record<'melody' | 'drone' | 'walls', Vec> = {
      melody: [lx * 0.28, ly * 0.62, 1.5],
      drone: [lx * 0.78, ly * 0.3, 1.0],
      walls: [lx * 0.5, ly * 0.88, Math.min(lz - 0.3, 2.2)],
    };
    // ---- space → sound ----
    const modes = roomModes(room);
    const droneMode = modes[0];
    const droneHz = fold(droneMode.hz, droneRange[0], droneRange[1]);
    const direct = dist(srcPos.melody, listener);
    const refl = imageSources(room, srcPos.melody, 2)
      .filter((im) => im.order > 0)
      .map((im) => ((dist(im.pos, listener) - direct) / C) * 1000)
      .sort((a, b) => a - b)
      .slice(0, 10);
    const maxMs = refl[refl.length - 1] || 1;
    const rhythmSlots = [...new Set([0, ...refl.map((ms) => Math.min(15, Math.round((ms / maxMs) * 15)))])].sort((a, b) => a - b);
    const melody: SpaceGeneration['melody'] = [];
    const bars = Math.floor(genSec / barSec) || 1;
    for (let b = 0; b < bars; b++) {
      rhythmSlots.forEach((s, k) => {
        const m = modes[1 + ((k + b * 3 + rng.int(0, 2)) % Math.min(modes.length - 1, 12))];
        const hz = fold(m.hz, melRange[0], melRange[1]);
        const midi = hzToMidi(hz);
        melody.push({ time: r3(t0 + b * barSec + s * slot), hz: r3(hz), cents: Math.round((midi - Math.round(midi)) * 100), mode: m.n });
      });
    }
    // ---- render dry sources ----
    const genLen = Math.ceil((genSec + 3) * sampleRate);
    const dry: Record<'melody' | 'drone' | 'walls', Float32Array> = { melody: new Float32Array(genLen), drone: new Float32Array(genLen), walls: new Float32Array(genLen) };
    const put = (key: 'melody' | 'drone' | 'walls', v: Float32Array, at: number, gain: number) => {
      const s = Math.round((at - t0) * sampleRate);
      for (let i = 0; i < v.length && s + i < genLen; i++) dry[key][s + i] += v[i] * gain;
    };
    melody.forEach((n, k) => put('melody', renderVoice(band.melody, { midi: hzToMidi(n.hz), velocity: 0.75, duration: slot * 2.5, timbre: 0, kind: 'note' }, sampleRate, `${seed}:${g}:m${k}`), n.time, 0.6));
    put('drone', renderVoice(band.drone, { midi: hzToMidi(droneHz), velocity: 0.6, duration: genSec * 0.92, timbre: 0, kind: 'note' }, sampleRate, `${seed}:${g}:d`), t0, 0.7);
    for (let b = 0; b < bars; b++) put('walls', renderVoice(band.walls, { midi: hzToMidi(fold(modes[2].hz, strikeHz / 2, strikeHz * 2)), velocity: 0.7, duration: 0.3, timbre: 0, kind: 'resonance' }, sampleRate, `${seed}:${g}:w${b}`), t0 + b * barSec, 0.5);

    // ---- spatialise: image sources (order ≤ 3) for each ear ----
    const beta = Math.sqrt(1 - room.absorption);
    for (const key of ['melody', 'drone', 'walls'] as const) {
      const ims = imageSources(room, srcPos[key], 3);
      ears.forEach((ear, e) => {
        const target = e === 0 ? out.left : out.right;
        for (const im of ims) {
          const d = dist(im.pos, ear);
          const gain = Math.pow(beta, im.order) / Math.max(1, d);
          // head shadow: the far ear hears side sources a little quieter
          const side = (im.pos[0] - listener[0]) * (e === 0 ? -1 : 1);
          const shadow = side >= 0 ? 1 : 0.8;
          const delay = Math.round((d / C) * sampleRate);
          const start = Math.round(t0 * sampleRate) + delay;
          const src = dry[key];
          const gg = gain * shadow;
          for (let i = 0; i < genLen && start + i < target.length; i++) target[start + i] += src[i] * gg;
        }
      });
      const late = 0.18 * room.absorption ** -0.5 * 0.2;
      const s0 = Math.round(t0 * sampleRate);
      for (let i = 0; i < genLen && s0 + i < lateIn.left.length; i++) {
        lateIn.left[s0 + i] += dry[key][i] * late;
        lateIn.right[s0 + i] += dry[key][i] * late;
      }
    }

    // ---- listen ----
    const a = Math.round(t0 * sampleRate);
    const z = Math.round((t0 + genSec) * sampleRate);
    const monoWin = new Float32Array(out.left.length);
    for (let i = a; i < z; i++) monoWin[i] = (out.left[i] + out.right[i]) / 2;
    const spec = averageSpectrum(monoWin, sampleRate, a, z);
    const eLow = 10 ** (bandEnergyDb(spec, 20, 200) / 10);
    const eMid = 10 ** (bandEnergyDb(spec, 200, 2000) / 10);
    const eHigh = 10 ** (bandEnergyDb(spec, 2000, 8000) / 10);
    const sum = eLow + eMid + eHigh || 1;
    let cnum = 0;
    let cden = 0;
    for (let k = 1; k < spec.mag.length; k++) {
      const p = spec.mag[k] * spec.mag[k];
      cnum += p * k * spec.binHz;
      cden += p;
    }
    const centroid = cnum / (cden || 1);
    const heard = { lowShare: r3(eLow / sum), midShare: r3(eMid / sum), highShare: r3(eHigh / sum), centroidHz: r3(centroid) };
    generations.push({ gen: g, start: t0, room: { L: [...room.L] as [number, number, number], absorption: room.absorption }, rt60: r3(sabineRt60(room)), modes, drone: { hz: r3(droneHz), mode: droneMode.n }, melody, rhythmSlots, reflectionsMs: refl.map(r3), heard });

    // ---- sound → space ----
    // Shares are compared with their running mean so the room keeps moving instead of drifting one way forever.
    const prev = generations.slice(0, -1).map((x) => x.heard);
    const mean = (k: 'lowShare' | 'midShare' | 'highShare') => (prev.length ? prev.reduce((s2, h) => s2 + h[k], 0) / prev.length : heard[k]);
    const next: Room = { L: [...room.L] as [number, number, number], absorption: room.absorption };
    const push = (param: string, from: number, to: number, cause: string) => {
      if (Math.abs(to - from) > 1e-3) changes.push({ gen: g, param, from: r3(from), to: r3(to), cause });
    };
    const dl = heard.lowShare - mean('lowShare');
    const dm = heard.midShare - mean('midShare');
    const dh = heard.highShare - mean('highShare');
    // Shape: the band that is louder than usual stretches its axis …
    const f = (x: number) => clamp(1 + x, 0.8, 1.25); // at most ±25 % per generation
    const shaped: Vec = [room.L[0] * f(2.0 * dl), room.L[1] * f(2.5 * dm), room.L[2] * f(4.0 * dh)];
    // … volume: louder than usual → the room breathes out, quieter → in (shape alone keeps the volume).
    const rmsDb = 10 * Math.log10(sum);
    const meanRms = prevRms.length ? prevRms.reduce((a2, b2) => a2 + b2, 0) / prevRms.length : rmsDb;
    prevRms.push(rmsDb);
    const V = room.L[0] * room.L[1] * room.L[2];
    const Vt = V * (1 + 0.25 * clamp((rmsDb - meanRms) / 6, -1, 1));
    const k = Math.cbrt(Vt / (shaped[0] * shaped[1] * shaped[2]));
    next.L = [r3(clamp(shaped[0] * k, 2.5, 40)), r3(clamp(shaped[1] * k, 2.5, 40)), r3(clamp(shaped[2] * k, 2.2, 20))];
    const vol = `音量 ${(rmsDb - meanRms >= 0 ? '+' : '')}${(rmsDb - meanRms).toFixed(1)} dB → 体積 ${((Vt / V - 1) * 100).toFixed(1)}%`;
    push('Lx (幅)', room.L[0], next.L[0], `低音の比率 ${(heard.lowShare * 100).toFixed(1)}% (平均との差 ${(dl * 100).toFixed(1)}pt)、${vol}`);
    push('Ly (奥行き)', room.L[1], next.L[1], `中音の比率 ${(heard.midShare * 100).toFixed(1)}% (差 ${(dm * 100).toFixed(1)}pt)、${vol}`);
    push('Lz (天井)', room.L[2], next.L[2], `高音の比率 ${(heard.highShare * 100).toFixed(1)}% (差 ${(dh * 100).toFixed(1)}pt)、${vol}`);
    const meanC = prevCentroid.length ? prevCentroid.reduce((a2, b2) => a2 + b2, 0) / prevCentroid.length : centroid;
    prevCentroid.push(centroid);
    next.absorption = r3(clamp(room.absorption * (1 + 0.6 * (meanC - centroid) / meanC), 0.06, 0.7));
    push('absorption (吸音)', room.absorption, next.absorption, `音の重心 ${centroid.toFixed(0)}Hz (平均 ${meanC.toFixed(0)}Hz): いつもより明るいと壁が硬く、暗いと柔らかくなる`);
    room = next;
  }

  const rt = sabineRt60(room);
  const [rl, rr] = reverb(lateIn.left, lateIn.right, { roomSize: clamp(rt / 4, 0.3, 0.97), damping: clamp(room.absorption * 1.2, 0.1, 0.9), sampleRate });
  for (let i = 0; i < out.left.length; i++) {
    out.left[i] += rl[i];
    out.right[i] += rr[i];
  }
  fadeEdges(out.left, out.right, sampleRate, 0.01, 3);
  const rep = master(out.left, out.right, { sampleRate, targetRmsDb: -17, ceilingDb: -1, maxGainDb: 18 });
  return { engine_version: SPACE_VERSION, seed, generations, changes, durationSec: total, buffer: out, master: rep, derivations };
}

/** glTF 2.0 (embedded buffer): one box whose scale is animated through the generations, plus a ghost box per generation. */
export function spaceToGltf(res: SpaceResult): string {
  // Unit cube 0..1 (glTF is Y-up: x = width Lx, y = height Lz, z = depth Ly)
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
  const lines = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]);
  const tris = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const times = new Float32Array(res.generations.map((g) => g.start));
  const scales = new Float32Array(res.generations.flatMap((g) => [g.room.L[0], g.room.L[2], g.room.L[1]]));
  const parts = [pos, lines, tris, times, scales].map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const pad4 = (n: number) => (n + 3) & ~3;
  const offsets: number[] = [];
  let len = 0;
  for (const p of parts) {
    offsets.push(len);
    len = pad4(len + p.byteLength);
  }
  const bin = new Uint8Array(len);
  parts.forEach((p, i) => bin.set(p, offsets[i]));
  let b64 = '';
  for (let i = 0; i < bin.length; i += 0x8000) b64 += String.fromCharCode(...bin.subarray(i, i + 0x8000));
  const base64 = typeof btoa === 'function' ? btoa(b64) : Buffer.from(bin).toString('base64');
  const views = parts.map((p, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: p.byteLength, ...(i === 1 || i === 2 ? { target: 34963 } : i === 0 ? { target: 34962 } : {}) }));
  const lastScale = res.generations.map((g) => [g.room.L[0], g.room.L[2], g.room.L[1]]);
  const gltf = {
    asset: { version: '2.0', generator: SPACE_VERSION },
    scene: 0,
    scenes: [{ nodes: [0, ...res.generations.map((_, i) => i + 1)] }],
    nodes: [
      { name: 'room (animated)', mesh: 0, scale: lastScale[0], extras: { note: 'scale = [Lx, Lz, Ly] metres; animation = generations' } },
      ...res.generations.map((g, i) => ({ name: `room gen ${g.gen}`, mesh: 1, scale: lastScale[i], translation: [0, 0, 0], extras: { rt60: g.rt60, absorption: g.room.absorption, drone_hz: g.drone.hz, heard: g.heard } })),
    ],
    meshes: [
      { name: 'room', primitives: [{ attributes: { POSITION: 0 }, indices: 2, mode: 4, material: 0 }] },
      { name: 'room outline', primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 1, material: 1 }] },
    ],
    materials: [
      { name: 'air', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.65, 0.35, 0.25], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND', doubleSided: true },
      { name: 'trace', pbrMetallicRoughness: { baseColorFactor: [0.55, 0.72, 0.87, 1], metallicFactor: 0, roughnessFactor: 1 } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: lines.length, type: 'SCALAR' },
      { bufferView: 2, componentType: 5123, count: tris.length, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: times.length, type: 'SCALAR', min: [times[0]], max: [times[times.length - 1]] },
      { bufferView: 4, componentType: 5126, count: times.length, type: 'VEC3' },
    ],
    animations: [{ name: 'sound builds the room', channels: [{ sampler: 0, target: { node: 0, path: 'scale' } }], samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }] }],
    bufferViews: views,
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${base64}` }],
  };
  return JSON.stringify(gltf, null, 1);
}
