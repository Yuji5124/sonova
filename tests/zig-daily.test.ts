import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZIG_DAILY_REFERENCES, ZIG_DAILY_TITLE_SPACE, BPM_RANGE, encodeWav16, isStamp, jstStamp, stampToIso, zigDailyPlan, zigSlug, zigTitleFor } from '@sonova/composition-engine';
import { SoundvaultError, registerAsset, type AssetMetadata, type SoundRecord } from '@sonova/soundvault-adapter';
import { findDailyRecords, runZigDaily, type Renderer } from '../scripts/lib-zig-daily.ts';

// ---------------------------------------------------------------- planner (pure)

describe('ZIG daily plan', () => {
  it('uses the Japan-time calendar day, not the machine zone', () => {
    expect(jstStamp(new Date('2026-10-27T00:00:00+09:00'))).toBe('261027');
    expect(jstStamp(new Date('2026-10-27T14:59:59Z'))).toBe('261027'); // 23:59:59 JST
    expect(jstStamp(new Date('2026-10-27T15:00:00Z'))).toBe('261028'); // 00:00:00 JST next day
    expect(jstStamp(new Date('2026-12-31T15:00:00Z'))).toBe('270101'); // year rolls over in JST first
    expect(jstStamp(new Date('2026-10-26T22:00:00Z'))).toBe('261027'); // the 07:00 JST schedule (22:00 UTC)
  });

  it('validates stamps as real calendar dates', () => {
    expect(stampToIso('261027')).toBe('2026-10-27');
    expect(stampToIso('240229')).toBe('2024-02-29');
    for (const bad of ['', '26102', '2610270', 'abcdef', '261301', '261032', '260230', '251301']) {
      expect(isStamp(bad)).toBe(false);
      expect(() => zigDailyPlan(bad)).toThrow();
    }
  });

  it('names everything with the YYMMDD_ prefix', () => {
    const p = zigDailyPlan('261027');
    expect(p.workNumber).toBe('ZIG-DAILY-261027');
    expect(p.seed).toBe('zig-daily-261027');
    expect(p.displayName).toBe(`261027_ZIG_${p.title}`);
    expect(p.fileStem).toBe(`261027_ZIG_${zigSlug(p.title)}`);
    expect(p.fileStem).toMatch(/^261027_ZIG_[a-z0-9-]+$/);
    expect(p.dateIso).toBe('2026-10-27');
    expect(p.timezone).toBe('Asia/Tokyo');
  });

  it('is deterministic: the same day always gives the same plan', () => {
    expect(zigDailyPlan('261027')).toEqual(zigDailyPlan('261027'));
    expect(zigDailyPlan('261027', { takenNames: ['x'] })).toEqual(zigDailyPlan('261027', { takenNames: ['y'] }));
  });

  it('gives different days different songs, within safe musical bounds', () => {
    const titles = new Set<string>();
    const keys = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      const p = zigDailyPlan(`2611${String(d).padStart(2, '0')}`);
      titles.add(p.title);
      keys.add(p.key);
      expect(p.bpm).toBeGreaterThanOrEqual(BPM_RANGE[0]);
      expect(p.bpm).toBeLessThanOrEqual(BPM_RANGE[1]);
      expect(p.rootPc).toBeGreaterThanOrEqual(0);
      expect(p.rootPc).toBeLessThanOrEqual(11);
      expect(p.rockOptions.bpm?.value).toBe(p.bpm);
      expect(p.rockOptions.rootPc?.value).toBe(p.rootPc);
    }
    expect(titles.size).toBeGreaterThan(20);
    expect(keys.size).toBeGreaterThan(4);
  });

  it('numbers an extra song on the same day instead of reusing names', () => {
    const a = zigDailyPlan('261027');
    const b = zigDailyPlan('261027', { sequence: 2, takenNames: [a.displayName] });
    expect(b.workNumber).toBe('ZIG-DAILY-261027-02');
    expect(b.seed).toBe('zig-daily-261027-02');
    expect(b.fileStem.endsWith('_02')).toBe(true);
    expect(b.displayName).not.toBe(a.displayName);
    expect(b.fileStem).not.toBe(a.fileStem);
    expect(() => zigDailyPlan('261027', { sequence: 0 })).toThrow();
    expect(() => zigDailyPlan('261027', { sequence: 100 })).toThrow();
  });

  it('never picks a taken or denylisted title', () => {
    const first = zigTitleFor('s1');
    const second = zigTitleFor('s1', new Set([first]));
    expect(second).not.toBe(first);
    // even with the display-name form taken
    const third = zigTitleFor('s1', new Set([`261027_ZIG_${first}`]), '261027');
    expect(third).not.toBe(first);
    expect(ZIG_DAILY_TITLE_SPACE).toBeGreaterThan(1000);
  });

  it('records what the song is based on and that nothing was copied', () => {
    expect(ZIG_DAILY_REFERENCES.brief).toContain('hide');
    expect(ZIG_DAILY_REFERENCES.basis.length).toBeGreaterThan(0);
    expect(ZIG_DAILY_REFERENCES.noCopying).toContain('旋律・歌詞・音源・声は一切使用していない');
  });
});

// ---------------------------------------------------------------- adapter extension

const FAKE_SCANNER = `import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
const sounds = JSON.parse(readFileSync('data/sounds.json', 'utf8'));
for (const s of sounds) { s.size = statSync('public' + s.file).size; s.format = s.file.split('.').pop(); }
sounds.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync('data/sounds.json', JSON.stringify(sounds, null, 2) + '\\n');
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/sounds.json', JSON.stringify(sounds, null, 2) + '\\n');
writeFileSync('public/data/projects.json', readFileSync('data/projects.json', 'utf8'));
`;

const EXISTING = {
  id: 'coin_001',
  name: 'Coin 001',
  file: '/sounds/item/coin-001.wav',
  category: 'ITEM',
  tags: ['item'],
  duration: 0,
  format: 'wav',
  size: 0,
  loop: false,
  volume: 0.8,
  license: 'UNKNOWN',
  source: '',
  author: '',
  favorite: false,
  notes: '',
  createdAt: '2026-10-06T13:11:09.047Z',
};

function tone(seconds: number, amp = 0.5): Uint8Array {
  const n = Math.round(seconds * 44100);
  const l = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / 44100) * amp);
  return encodeWav16([l, l.slice()], 44100);
}

let dir: string;
let vault: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zig-daily-test-'));
  vault = join(dir, 'soundvault');
  out = join(dir, 'out');
  mkdirSync(join(vault, 'scripts'), { recursive: true });
  mkdirSync(join(vault, 'data'), { recursive: true });
  mkdirSync(join(vault, 'public/sounds/item'), { recursive: true });
  writeFileSync(join(vault, 'package.json'), JSON.stringify({ name: 'soundvault', scripts: { scan: 'node scripts/scan-sounds.mjs' } }));
  writeFileSync(join(vault, 'scripts/scan-sounds.mjs'), FAKE_SCANNER);
  writeFileSync(join(vault, 'public/sounds/item/coin-001.wav'), tone(0.2));
  writeFileSync(join(vault, 'data/sounds.json'), JSON.stringify([{ ...EXISTING, size: tone(0.2).length }], null, 2));
  writeFileSync(join(vault, 'data/projects.json'), JSON.stringify([{ id: 'sonova', name: 'SONOVA', type: '音楽研究', archived: false }]));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** every file under a directory with its bytes, to prove "nothing changed" */
function snapshot(root: string): Record<string, string> {
  const res: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else res[p.slice(root.length)] = readFileSync(p).toString('base64');
    }
  };
  walk(root);
  return res;
}

const baseMeta = (over: Partial<AssetMetadata> = {}): AssetMetadata => ({
  workNumber: 'ZIG-DAILY-261027',
  title: 'STATIC BLOOM',
  type: 'COMPOSITION',
  bpm: 140,
  materialIds: ['abc'],
  sources: [{ name: 'a.png', type: 'image', sha256: 'abc' }],
  instruments: [{ instrument_id: 'inst-1', dna_hash: 'h', name: 'a' }],
  seed: 'zig-daily-261027',
  algorithms: ['x'],
  engines: { dna: '1' },
  license: 'Original',
  createdAt: '2026-10-27T00:00:00.000Z',
  description: 'テスト。',
  tags: ['zig'],
  sonovaFiles: [],
  ...over,
});

describe('SOUNDVAULT adapter: ZIG overrides', () => {
  const wavPath = () => join(dir, 'piece.wav');
  const reg = (meta: AssetMetadata) => registerAsset({ vaultDir: vault, wavPath: wavPath(), meta, encode: 'wav', backupDir: join(dir, 'bk'), expectations: { sampleRate: 44100, channels: 2, minDurationSec: 1 } });
  beforeEach(() => writeFileSync(wavPath(), tone(2)));

  it('applies name, file stem, collections, projects, author and extra fields', () => {
    const r = reg(baseMeta({ displayName: '261027_ZIG_STATIC BLOOM', fileStem: '261027_ZIG_static-bloom', collections: ['ZIG'], projectIds: ['sonova', 'sonova-zig'], author: 'ZIG', extra: { zigDaily: { stamp: '261027' }, workNumber: 'IGNORED' } }));
    expect(r.status).toBe('registered');
    expect(r.file).toBe('/sounds/bgm/261027_ZIG_static-bloom.wav');
    expect(r.soundvaultId).toBe('sonova_zig_daily_261027_wav');
    const rec = JSON.parse(readFileSync(join(vault, 'data/sounds.json'), 'utf8')).find((s: { id: string }) => s.id === r.soundvaultId);
    expect(rec.name).toBe('261027_ZIG_STATIC BLOOM');
    expect(rec.author).toBe('ZIG');
    expect(rec.collections).toEqual(['ZIG']);
    expect(rec.projectIds).toEqual(['sonova', 'sonova-zig']);
    expect(rec.sonova.zigDaily).toEqual({ stamp: '261027' });
    expect(rec.sonova.workNumber).toBe('ZIG-DAILY-261027'); // `extra` cannot override core fields
  });

  it('refuses unsafe file stems and leaves the vault untouched', () => {
    const before = snapshot(vault);
    for (const bad of ['../evil', 'a/b', '日本語', '', ' x', '.hidden']) expect(() => reg(baseMeta({ fileStem: bad }))).toThrow(SoundvaultError);
    expect(snapshot(vault)).toEqual(before);
  });

  it('refuses a different work that reuses an existing name', () => {
    reg(baseMeta({ displayName: '261027_ZIG_STATIC BLOOM', fileStem: 'a' }));
    const before = snapshot(vault);
    expect(() => reg(baseMeta({ workNumber: 'ZIG-DAILY-261027-02', displayName: '261027_ZIG_STATIC BLOOM', fileStem: 'b' }))).toThrow(/名前/);
    expect(snapshot(vault)).toEqual(before);
  });
});

// ---------------------------------------------------------------- the daily run

const fakeRenderer = (calls: { n: number }, seconds = 2, amp = 0.5): Renderer => async (plan, outDir) => {
  calls.n++;
  mkdirSync(outDir, { recursive: true });
  const wavPath = join(outDir, `${plan.fileStem}.wav`);
  writeFileSync(wavPath, tone(seconds, amp));
  return {
    wavPath,
    bpm: plan.bpm,
    key: plan.key,
    durationSec: seconds,
    riffText: 'Rm..m..Pn..PPPmP',
    sections: [{ name: 'intro', start: 0, bars: 4 }],
    derivations: [],
    engines: { composition: 'test' },
    sources: [{ name: 'bark.png', sha256: 'aaa' }],
    instruments: [{ instrument_id: 'inst-1', dna_hash: 'h', name: 'bark' }],
    renderMs: 1,
  };
};

const run = (over: Partial<Parameters<typeof runZigDaily>[0]> = {}, calls = { n: 0 }) => runZigDaily({ vaultDir: vault, outDir: out, stamp: '261027', render: fakeRenderer(calls), minDurationSec: 1, ...over });
const sonovaOf = (r: SoundRecord) => r.sonova as Record<string, any>;
const sounds = () => JSON.parse(readFileSync(join(vault, 'data/sounds.json'), 'utf8')) as SoundRecord[];

describe('ZIG daily run', () => {
  it('dry-run reports the plan and changes nothing in the vault', async () => {
    const calls = { n: 0 };
    const before = snapshot(vault);
    const r = await run({ dryRun: true }, calls);
    expect(r.status).toBe('dry-run');
    expect(r.plan?.displayName).toMatch(/^261027_ZIG_/);
    expect(calls.n).toBe(0); // nothing rendered
    expect(snapshot(vault)).toEqual(before);
    expect(existsSync(r.runLogPath!)).toBe(true);
  });

  it('registers one song named with the date prefix and keeps existing records', async () => {
    const before = sounds()[0];
    const r = await run();
    expect(r.status).toBe('registered');
    const all = sounds();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === 'coin_001')).toEqual(before);
    const rec = all.find((s) => s.id === r.soundvaultId)!;
    expect(rec.name).toBe(r.plan!.displayName);
    expect(rec.name.startsWith('261027_ZIG_')).toBe(true);
    expect(rec.file).toMatch(/^\/sounds\/bgm\/261027_ZIG_[a-z0-9-]+\.(ogg|wav)$/);
    expect(rec.id).toContain('261027');
    expect(rec.tags).toContain('261027');
    expect(rec.author).toBe('ZIG');
    expect(rec.license).toBe('Original');
    expect(sonovaOf(rec).zigDaily).toMatchObject({ stamp: '261027', dateIso: '2026-10-27', timezone: 'Asia/Tokyo', sequence: 1 });
    expect(sonovaOf(rec).references.noCopying).toContain('一切使用していない');
    expect(sonovaOf(rec).generation.vocals).toContain('インストゥルメンタル');
    // the run record is saved with the song
    const recordFile = join(vault, 'data/zig-daily', `${r.plan!.fileStem}.json`);
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    expect(record).toMatchObject({ schema: 'zig-daily/1', stamp: '261027', workNumber: 'ZIG-DAILY-261027', registration: { status: 'registered', soundvaultId: r.soundvaultId } });
    expect(record.audio.wavSha256).toHaveLength(64);
    expect(findDailyRecords(sounds(), '261027')).toHaveLength(1);
  });

  it('does not register twice on the same day: no render, no write', async () => {
    const calls = { n: 0 };
    const first = await run({}, calls);
    expect(first.status).toBe('registered');
    const snap = snapshot(vault);
    const again = await run({}, calls);
    expect(again.status).toBe('skipped-existing');
    expect(again.existing).toEqual([first.soundvaultId]);
    expect(calls.n).toBe(1);
    expect(snapshot(vault)).toEqual(snap);
    expect(sounds()).toHaveLength(2);
  });

  it('registers a new, differently named song on the next day', async () => {
    const a = await run({ stamp: '261027' });
    const b = await run({ stamp: '261028' });
    expect(a.status).toBe('registered');
    expect(b.status).toBe('registered');
    expect(b.plan!.displayName.startsWith('261028_ZIG_')).toBe(true);
    expect(b.plan!.displayName).not.toBe(a.plan!.displayName);
    expect(sounds()).toHaveLength(3);
  });

  it('can add an explicitly allowed second song the same day with a unique number', async () => {
    const a = await run();
    const b = await run({ allowExtra: true });
    expect(b.status).toBe('registered');
    expect(b.plan!.sequence).toBe(2);
    expect(b.plan!.workNumber).toBe('ZIG-DAILY-261027-02');
    expect(b.plan!.displayName).not.toBe(a.plan!.displayName);
    expect(findDailyRecords(sounds(), '261027')).toHaveLength(2);
    expect(new Set(sounds().map((s) => s.file)).size).toBe(3);
  });

  it('takes the date from Japan time when none is given', async () => {
    const r = await run({ stamp: undefined, now: new Date('2026-10-27T15:30:00Z'), dryRun: true });
    expect(r.stamp).toBe('261028');
  });

  it('a renderer failure is reported as failed and leaves the vault untouched', async () => {
    const before = snapshot(vault);
    const r = await run({
      render: async () => {
        throw new Error('render blew up');
      },
    });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('render blew up');
    expect(snapshot(vault)).toEqual(before);
    expect(JSON.parse(readFileSync(r.runLogPath!, 'utf8'))).toMatchObject({ status: 'failed' });
    // and the next run is free to try again
    expect((await run()).status).toBe('registered');
  });

  it('audio that fails verification is refused and rolled back', async () => {
    const before = snapshot(vault);
    const loud = await run({ render: fakeRenderer({ n: 0 }, 2, 1.0), minDurationSec: 1 }); // peak 0 dBFS > -0.9
    expect(loud.status).toBe('failed');
    const short = await run({ minDurationSec: 150 }); // 2 s is far below the minimum
    expect(short.status).toBe('failed');
    expect(short.message).toContain('元に戻してあります');
    expect(snapshot(vault)).toEqual(before);
  });

  it('refuses to guess when a record file exists without a sounds.json entry', async () => {
    mkdirSync(join(vault, 'data/zig-daily'), { recursive: true });
    writeFileSync(join(vault, 'data/zig-daily/261027_ZIG_STRAY.json'), '{}');
    const calls = { n: 0 };
    const r = await run({}, calls);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('orphan-record');
    expect(calls.n).toBe(0);
  });

  it('rejects a folder that is not SOUNDVAULT and a bad date', async () => {
    expect((await run({ vaultDir: dir })).status).toBe('failed');
    expect((await run({ stamp: '261332' })).status).toBe('failed');
  });

  it('never overwrites an existing audio file', async () => {
    const r = await run({ dryRun: true });
    const stem = r.plan!.fileStem;
    mkdirSync(join(vault, 'public/sounds/bgm'), { recursive: true });
    for (const ext of ['ogg', 'wav']) writeFileSync(join(vault, 'public/sounds/bgm', `${stem}.${ext}`), 'precious');
    const failed = await run();
    expect(failed.status).toBe('failed');
    for (const ext of ['ogg', 'wav']) expect(readFileSync(join(vault, 'public/sounds/bgm', `${stem}.${ext}`), 'utf8')).toBe('precious');
    expect(sounds()).toHaveLength(1);
  });
});
