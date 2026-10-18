import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { analyzeImage, roughness, sha256Hex } from '@sonova/source-analyzer';
import { createImageDNA } from '@sonova/instrument-dna';
import { imageSources, renderGrow, renderHeal, renderSpace, roomModes, sabineRt60, spaceToGltf } from '@sonova/composition-engine';

const ROOT = join(import.meta.dirname, '..');
const [bark, tower, sunset] = await Promise.all(
  ['bark.png', 'tower.png', 'sunset.png'].map(async (n) => {
    const bytes = readFileSync(join(ROOT, 'experiments/sources', n));
    const png = PNG.sync.read(bytes);
    return createImageDNA({ sourceType: 'image', sourceName: n, sourceHash: await sha256Hex(new Uint8Array(bytes)), features: analyzeImage({ width: png.width, height: png.height, data: png.data }), seed: 'sonova-001' });
  }),
);
const peak = (b: { left: Float32Array; right: Float32Array }) => {
  let p = 0;
  for (let i = 0; i < b.left.length; i++) p = Math.max(p, Math.abs(b.left[i]), Math.abs(b.right[i]));
  return p;
};

describe('listening tools', () => {
  it('roughness: a semitone is rougher than a fifth', () => {
    const semitone = roughness([{ hz: 440, amp: 1 }, { hz: 466.16, amp: 1 }]);
    const fifth = roughness([{ hz: 440, amp: 1 }, { hz: 660, amp: 1 }]);
    expect(semitone).toBeGreaterThan(fifth * 3);
  });
});

describe('SONOVA 002 grow', () => {
  const a = renderGrow({ player: bark, drone: sunset, body: tower }, 't', 4);
  it('is reproducible and bounded', () => {
    const b = renderGrow({ player: bark, drone: sunset, body: tower }, 't', 4);
    expect(b.changes).toEqual(a.changes);
    expect(Buffer.from(b.buffer.left.buffer).equals(Buffer.from(a.buffer.left.buffer))).toBe(true);
    expect(peak(a.buffer)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
  });
  it('the body changes because of what it heard, with a reason for every change', () => {
    expect(a.generations).toHaveLength(4);
    expect(a.changes.length).toBeGreaterThan(0);
    expect(a.changes.every((c) => c.cause.length > 0)).toBe(true);
    expect(a.generations[3].metrics.meanDecay).toBeGreaterThan(a.generations[0].metrics.meanDecay);
    // from generation 1 on, the melody comes from the body's modes
    expect(a.generations[1].melody.some((n) => n.from_mode !== null)).toBe(true);
    for (const g of a.generations) for (const m of g.modes) expect(m.decay).toBeLessThanOrEqual(6);
  });
});

describe('SONOVA 003 heal', () => {
  const healed = renderHeal({ bass: sunset, pad: tower, melody: bark }, 'sonova-heal-0001', { repair: true, bars: 18 });
  const broken = renderHeal({ bass: sunset, pad: tower, melody: bark }, 'sonova-heal-0001', { repair: false, bars: 18 });
  it('injects the same faults in both renders', () => {
    expect(healed.faults).toEqual(broken.faults);
    expect(broken.events.filter((e) => e.kind === 'repair')).toHaveLength(0);
  });
  it('detects faults from the audio and repairs them, each repair caused by a detection', () => {
    const byId = new Map(healed.events.map((e) => [e.id, e]));
    const repairs = healed.events.filter((e) => e.kind === 'repair');
    expect(repairs.length).toBeGreaterThan(0);
    for (const r of repairs) expect(byId.get(r.cause!)?.kind).toBe('detect');
    // every detection happens while (or right after) a fault is active — no false alarms
    for (const d of healed.events.filter((e) => e.kind === 'detect')) expect(healed.faults.some((f) => d.bar >= f.startBar && d.bar <= f.startBar + f.bars)).toBe(true);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(healed.metrics.map((m) => m.health))).toBeGreaterThan(avg(broken.metrics.map((m) => m.health)));
  });
});

describe('SONOVA 004 space', () => {
  it('room acoustics formulas', () => {
    const room = { L: [5, 4, 3] as [number, number, number], absorption: 0.3 };
    expect(roomModes(room)[0].hz).toBeCloseTo(343 / 10, 3); // first axial mode c / 2Lx
    expect(sabineRt60(room)).toBeCloseTo((0.161 * 60) / (94 * 0.3), 6);
    const ims = imageSources(room, [1, 1, 1], 1);
    expect(ims).toHaveLength(7);
    expect(ims.some((i) => i.pos[0] === -1)).toBe(true); // mirror in the x = 0 wall
  });
  it('the room deforms from what was heard and drives the next notes; glTF is valid JSON', () => {
    const res = renderSpace({ melody: bark, drone: sunset, walls: tower }, 't', 3);
    expect(res.generations).toHaveLength(3);
    expect(res.changes.length).toBeGreaterThan(0);
    expect(res.generations[2].room.L).not.toEqual(res.generations[0].room.L);
    for (const g of res.generations) for (const n of g.melody) expect(g.modes.some((m) => m.n.join() === n.mode.join())).toBe(true);
    expect(peak(res.buffer)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
    const gltf = JSON.parse(spaceToGltf(res));
    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.animations[0].channels[0].target.path).toBe('scale');
  });
});

describe('rock versions of 002–004', () => {
  it('ROCK-HEAL injects exactly the planned faults into a copy of the score', async () => {
    const { rockHealSong } = await import('@sonova/composition-engine');
    const band = { guitar: bark, drums: tower, voice: sunset };
    const a = rockHealSong(band, 't');
    const b = rockHealSong(band, 't');
    expect(b.faulty.events).toEqual(a.faulty.events);
    expect(a.faults).toHaveLength(5);
    const barOf = (t: number) => Math.floor(t / a.song.barSec + 1e-9);
    for (const f of a.faults) {
      const inFault = (e: { part: string; time: number }) => e.part === f.part && barOf(e.time) >= f.startBar && barOf(e.time) < f.startBar + f.bars;
      const orig = a.song.events.filter((e) => inFault(e) && (e.kind === 'note' || e.kind === 'chord'));
      const now = a.faulty.events.filter((e) => inFault(e) && (e.kind === 'note' || e.kind === 'chord'));
      expect(orig.length).toBeGreaterThan(0);
      if (f.kind === 'dropout') expect(now).toHaveLength(0);
      else now.forEach((e, i) => expect(Math.abs(e.midi! - orig[i].midi!)).toBe(1));
    }
    // outside the faults the score is untouched
    expect(a.faulty.events.filter((e) => !a.faults.some((f) => e.part === f.part && barOf(e.time) >= f.startBar && barOf(e.time) < f.startBar + f.bars))).toEqual(
      a.song.events.filter((e) => !a.faults.some((f) => e.part === f.part && barOf(e.time) >= f.startBar && barOf(e.time) < f.startBar + f.bars)),
    );
    expect(a.song.derivations.some((d) => d.choice === 'bpm' && d.from === 'series')).toBe(true);
  });
});
