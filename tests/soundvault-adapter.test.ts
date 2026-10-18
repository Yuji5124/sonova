import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeWav16 } from '@sonova/composition-engine';
import { SoundvaultError, inspectVault, readRegistry, registerAsset, upsertRegistry, type AssetMetadata } from '@sonova/soundvault-adapter';

// A minimal stand-in for SOUNDVAULT: same layout, a scanner that (like the real one) refreshes size/format and keeps other fields.
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

const meta = (workNumber = 'SONOVA-EXP-9001'): AssetMetadata => ({
  workNumber,
  title: 'Test Piece',
  type: 'EXPERIMENT',
  bpm: 90,
  materialIds: ['abc'],
  sources: [{ name: 'a.png', type: 'image', sha256: 'abc' }],
  instruments: [{ instrument_id: 'inst-1', dna_hash: 'h', name: 'a' }],
  seed: 's',
  algorithms: ['x'],
  engines: { dna: '1' },
  license: 'Original',
  createdAt: '2026-10-18T00:00:00.000Z',
  description: 'テスト。',
  tags: ['test'],
  sonovaFiles: [],
});

let dir: string;
let vault: string;
let wav: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sonova-vault-test-'));
  vault = join(dir, 'soundvault');
  mkdirSync(join(vault, 'scripts'), { recursive: true });
  mkdirSync(join(vault, 'data'), { recursive: true });
  mkdirSync(join(vault, 'public/sounds/item'), { recursive: true });
  writeFileSync(join(vault, 'package.json'), JSON.stringify({ name: 'soundvault', scripts: { scan: 'node scripts/scan-sounds.mjs' } }));
  writeFileSync(join(vault, 'scripts/scan-sounds.mjs'), FAKE_SCANNER);
  writeFileSync(join(vault, 'public/sounds/item/coin-001.wav'), tone(0.2));
  writeFileSync(join(vault, 'data/sounds.json'), JSON.stringify([{ ...EXISTING, size: tone(0.2).length }], null, 2));
  writeFileSync(join(vault, 'data/projects.json'), JSON.stringify([{ id: 'monque', name: 'モンスタークエスト0', type: 'ゲーム', archived: false }]));
  wav = join(dir, 'piece.wav');
  writeFileSync(wav, tone(30));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const opts = (extra: Partial<Parameters<typeof registerAsset>[0]> = {}) => ({
  vaultDir: vault,
  wavPath: wav,
  meta: meta(),
  encode: 'wav' as const,
  backupDir: join(dir, 'backups'),
  expectations: { sampleRate: 44100, channels: 2, minDurationSec: 29 },
  ...extra,
});

describe('SOUNDVAULT adapter', () => {
  it('recognises a SOUNDVAULT layout and rejects other folders', () => {
    expect(inspectVault(vault).ok).toBe(true);
    expect(inspectVault(dir).ok).toBe(false);
    expect(() => registerAsset(opts({ vaultDir: dir }))).toThrow(SoundvaultError);
  });

  it('registers into the existing schema and keeps existing data', () => {
    const before = JSON.parse(readFileSync(join(vault, 'data/sounds.json'), 'utf8'));
    const r = registerAsset(opts());
    expect(r.status).toBe('registered');
    expect(r.soundvaultId).toBe('sonova_exp_9001_wav');
    expect(r.file).toBe('/sounds/bgm/sonova-exp-9001-test-piece.wav');
    expect(existsSync(join(vault, 'public', r.file))).toBe(true);
    const after = JSON.parse(readFileSync(join(vault, 'data/sounds.json'), 'utf8'));
    expect(after).toHaveLength(2);
    expect(after.find((s: { id: string }) => s.id === 'coin_001')).toEqual(before[0]);
    const rec = after.find((s: { id: string }) => s.id === r.soundvaultId);
    expect(rec.category).toBe('BGM');
    expect(rec.collections).toEqual(['SONOVA EXPERIMENTS']);
    expect(rec.projectIds).toEqual(['sonova']);
    expect(rec.sonova.workNumber).toBe('SONOVA-EXP-9001');
    expect(rec.sonova.verification.ok).toBe(true);
    const projects = JSON.parse(readFileSync(join(vault, 'data/projects.json'), 'utf8'));
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['monque', 'sonova']);
    expect(JSON.parse(readFileSync(join(vault, 'public/data/sounds.json'), 'utf8'))).toHaveLength(2);
  });

  it('prevents duplicate registration and refuses silent overwrite', () => {
    registerAsset(opts());
    expect(registerAsset(opts()).status).toBe('already-registered');
    expect(JSON.parse(readFileSync(join(vault, 'data/sounds.json'), 'utf8'))).toHaveLength(2);
    writeFileSync(wav, tone(30, 0.3));
    expect(() => registerAsset(opts())).toThrow(/別の音声で登録済み/);
  });

  it('refuses audio that fails verification and leaves the vault untouched', () => {
    writeFileSync(wav, tone(2));
    const before = readFileSync(join(vault, 'data/sounds.json'), 'utf8');
    expect(() => registerAsset(opts())).toThrow(/音声検証に失敗/);
    expect(readFileSync(join(vault, 'data/sounds.json'), 'utf8')).toBe(before);
    expect(existsSync(wav)).toBe(true);
  });

  it('rolls back when the scan step fails, keeping the original WAV', () => {
    writeFileSync(join(vault, 'scripts/scan-sounds.mjs'), 'process.exit(3)');
    const before = readFileSync(join(vault, 'data/sounds.json'), 'utf8');
    expect(() => registerAsset(opts())).toThrow(/scan/);
    expect(readFileSync(join(vault, 'data/sounds.json'), 'utf8')).toBe(before);
    expect(existsSync(join(vault, 'public/sounds/bgm/sonova-exp-9001-test-piece.wav'))).toBe(false);
    expect(existsSync(wav)).toBe(true);
  });

  it('dry run writes nothing', () => {
    const snapshot = join(dir, 'snap');
    cpSync(vault, snapshot, { recursive: true });
    expect(registerAsset(opts({ dryRun: true })).status).toBe('dry-run');
    expect(readFileSync(join(vault, 'data/sounds.json'), 'utf8')).toBe(readFileSync(join(snapshot, 'data/sounds.json'), 'utf8'));
    expect(existsSync(join(vault, 'public/sounds/bgm'))).toBe(false);
  });

  it('keeps a SONOVA-side registry without duplicates', () => {
    const reg = join(dir, 'registry.json');
    const r = registerAsset(opts());
    const entry = { workNumber: 'SONOVA-EXP-9001', title: 't', type: 'EXPERIMENT' as const, soundvaultId: r.soundvaultId, file: r.file, format: r.format, wavSha256: r.wavSha256, fileSha256: r.fileSha256, registeredAt: 'now' };
    upsertRegistry(reg, entry);
    upsertRegistry(reg, entry);
    expect(readRegistry(reg)).toHaveLength(1);
  });
});
