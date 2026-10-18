/**
 * SOUNDVAULT adapter (Node only).
 *
 * SOUNDVAULT (https://github.com/Yuji5124/soundvault) is a static library: audio files live in
 * `public/sounds/<category>/`, metadata in `data/sounds.json` + `data/projects.json`, and
 * `npm run scan` (scripts/scan-sounds.mjs) refreshes filesystem fields while keeping every other
 * field. This adapter follows that existing workflow — it does not add a server or a new schema.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeWav, verifyAudio, type AudioVerification, type VerifyExpectations } from '@sonova/composition-engine';
import { canonicalJson } from '@sonova/instrument-dna';

export type SonovaAssetType = 'INSTRUMENT' | 'EXPERIMENT' | 'COMPOSITION';

/** SONOVA asset types → existing SOUNDVAULT categories (the UI has a fixed category list). */
export const CATEGORY_MAP: Record<SonovaAssetType, string> = { INSTRUMENT: 'FX', EXPERIMENT: 'BGM', COMPOSITION: 'BGM' };
export const COLLECTION_MAP: Record<SonovaAssetType, string> = {
  INSTRUMENT: 'SONOVA INSTRUMENTS',
  EXPERIMENT: 'SONOVA EXPERIMENTS',
  COMPOSITION: 'SONOVA COMPOSITIONS',
};
export const SONOVA_PROJECT = { id: 'sonova', name: 'SONOVA', type: '音楽研究', archived: false };
export const SOUNDVAULT_KNOWN_CATEGORIES = ['UI', 'ACTION', 'ITEM', 'ENVIRONMENT', 'FX', 'KIDS', 'VOICE', 'BGM'];

/** Shape of a `data/sounds.json` record as written by SOUNDVAULT's scanner (extra fields are preserved). */
export interface SoundRecord {
  id: string;
  name: string;
  file: string;
  category: string;
  tags: string[];
  duration: number;
  format: string;
  size: number;
  loop: boolean;
  volume: number;
  license: string;
  source: string;
  author: string;
  favorite: boolean;
  notes: string;
  createdAt: string;
  collections?: string[];
  projectIds?: string[];
  sampleRate?: number;
  [key: string]: unknown;
}

export interface VaultInfo {
  dir: string;
  ok: boolean;
  problems: string[];
  soundCount: number;
  categories: Record<string, number>;
  projects: Array<{ id: string; name: string }>;
  sonovaRecords: number;
  gitHead?: string;
  pagesUrl?: string;
}

export function inspectVault(dir: string): VaultInfo {
  const vault = resolve(dir);
  const problems: string[] = [];
  const pkgPath = join(vault, 'package.json');
  const soundsPath = join(vault, 'data/sounds.json');
  let sounds: SoundRecord[] = [];
  let projects: Array<{ id: string; name: string }> = [];
  if (!existsSync(pkgPath)) problems.push('package.json がありません');
  else {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.name !== 'soundvault') problems.push(`package.json の name が "${pkg.name}" です (soundvault を想定)`);
    if (!pkg.scripts?.scan) problems.push('npm run scan スクリプトがありません');
  }
  if (!existsSync(join(vault, 'scripts/scan-sounds.mjs'))) problems.push('scripts/scan-sounds.mjs がありません');
  if (!existsSync(join(vault, 'public/sounds'))) problems.push('public/sounds/ がありません');
  if (!existsSync(soundsPath)) problems.push('data/sounds.json がありません');
  else {
    sounds = JSON.parse(readFileSync(soundsPath, 'utf8'));
    if (!Array.isArray(sounds)) problems.push('data/sounds.json が配列ではありません');
  }
  const projectsPath = join(vault, 'data/projects.json');
  if (existsSync(projectsPath)) projects = JSON.parse(readFileSync(projectsPath, 'utf8'));
  const categories: Record<string, number> = {};
  for (const s of sounds) categories[s.category] = (categories[s.category] ?? 0) + 1;
  let gitHead: string | undefined;
  try {
    gitHead = execFileSync('git', ['-C', vault, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    gitHead = undefined;
  }
  return {
    dir: vault,
    ok: problems.length === 0,
    problems,
    soundCount: sounds.length,
    categories,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    sonovaRecords: sounds.filter((s) => s.projectIds?.includes('sonova')).length,
    gitHead,
    pagesUrl: 'https://yuji5124.github.io/soundvault/',
  };
}

export interface AssetMetadata {
  /** e.g. SONOVA-EXP-0001 */
  workNumber: string;
  title: string;
  type: SonovaAssetType;
  bpm?: number;
  /** Source material ids (sha256 of each source file). */
  materialIds: string[];
  sources: Array<{ name: string; type: string; sha256: string }>;
  instruments: Array<{ instrument_id: string; dna_hash: string; name: string }>;
  seed: string;
  algorithms: string[];
  engines: Record<string, string>;
  license: string;
  createdAt: string;
  description: string;
  tags: string[];
  /** Repo-relative paths of the DNA / structure JSON inside SONOVA. */
  sonovaFiles: string[];
}

export interface RegisterOptions {
  vaultDir: string;
  wavPath: string;
  meta: AssetMetadata;
  /** 'auto' encodes OGG Vorbis with ffmpeg when available, otherwise copies the WAV. */
  encode?: 'auto' | 'ogg' | 'wav';
  expectations?: VerifyExpectations;
  /** Where backups of the vault JSON are written (outside the vault). */
  backupDir: string;
  dryRun?: boolean;
  /** Skip `npm run scan` (tests). */
  skipScan?: boolean;
}

export interface RegisterResult {
  status: 'registered' | 'already-registered' | 'dry-run';
  soundvaultId: string;
  file: string;
  absPath: string;
  format: string;
  wavSha256: string;
  fileSha256: string;
  verification: AudioVerification;
  record: SoundRecord;
  scanOutput?: string;
}

export class SoundvaultError extends Error {}

export const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function ffmpegAvailable(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

/** `SONOVA-EXP-0001` → `exp-0001` */
const workSlug = (workNumber: string) => slugify(workNumber).replace(/^sonova-/, '');

export function soundvaultIdFor(meta: AssetMetadata, format: string): string {
  return `sonova_${workSlug(meta.workNumber).replace(/-/g, '_')}_${format}`;
}

function buildRecord(meta: AssetMetadata, file: string, format: string, size: number, verification: AudioVerification, wavSha256: string, now: string): SoundRecord {
  const id = soundvaultIdFor(meta, format);
  const category = CATEGORY_MAP[meta.type];
  const typeLabel = { INSTRUMENT: '独自楽器の単体音源', EXPERIMENT: '音楽実験', COMPOSITION: '完成曲' }[meta.type];
  return {
    id,
    name: `${meta.workNumber} ${meta.title}`,
    file,
    category,
    tags: [...new Set([category.toLowerCase(), 'sonova', meta.type.toLowerCase(), 'generative', ...meta.tags])],
    duration: verification.durationSec,
    format,
    size,
    loop: false,
    volume: 0.8,
    sampleRate: verification.sampleRate,
    license: meta.license,
    source: `SONOVA (https://github.com/Yuji5124/sonova): ${meta.sources.map((s) => s.name).join(', ')} から生成。seed ${meta.seed}`,
    author: 'SONOVA (Claude Code) for Yuji5124',
    favorite: false,
    notes: `${typeLabel}。${meta.description}${meta.bpm ? `${meta.bpm} BPM。` : ''}`,
    collections: [COLLECTION_MAP[meta.type]],
    projectIds: [SONOVA_PROJECT.id],
    createdAt: now,
    sonova: {
      workNumber: meta.workNumber,
      title: meta.title,
      assetType: meta.type,
      bpm: meta.bpm ?? null,
      materialIds: meta.materialIds,
      sources: meta.sources,
      instrumentDna: meta.instruments,
      seed: meta.seed,
      algorithms: meta.algorithms,
      engines: meta.engines,
      sonovaFiles: meta.sonovaFiles,
      createdAt: meta.createdAt,
      wavSha256,
      verification: {
        ok: verification.ok,
        durationSec: verification.durationSec,
        sampleRate: verification.sampleRate,
        channels: verification.channels,
        bitsPerSample: verification.bitsPerSample,
        peakDbfs: verification.peakDbfs,
        rmsDbfs: verification.rmsDbfs,
        silentRatio: verification.silentRatio,
      },
    },
  };
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Register one rendered WAV in SOUNDVAULT. Idempotent: the same work + same audio is reported as
 * already registered; the same work with different audio is refused (no silent overwrite).
 * On any failure the vault JSON is restored and newly written audio removed; the source WAV is never touched.
 */
export function registerAsset(opts: RegisterOptions): RegisterResult {
  const info = inspectVault(opts.vaultDir);
  if (!info.ok) throw new SoundvaultError(`SOUNDVAULT ではありません: ${info.problems.join(' / ')}`);
  const vault = info.dir;
  if (!existsSync(opts.wavPath)) throw new SoundvaultError(`WAV がありません: ${opts.wavPath}`);
  const wavBytes = readFileSync(opts.wavPath);
  const verification = verifyAudio(decodeWav(new Uint8Array(wavBytes)), opts.expectations);
  if (!verification.ok) throw new SoundvaultError(`音声検証に失敗: ${verification.problems.join(', ')}`);
  const wavSha256 = createHash('sha256').update(wavBytes).digest('hex');

  const mode = opts.encode ?? 'auto';
  const useOgg = mode === 'ogg' || (mode === 'auto' && ffmpegAvailable());
  if (mode === 'ogg' && !ffmpegAvailable()) throw new SoundvaultError('ffmpeg が見つかりません (OGG 変換には ffmpeg が必要)');
  const format = useOgg ? 'ogg' : 'wav';
  const category = CATEGORY_MAP[opts.meta.type];
  const stem = `sonova-${workSlug(opts.meta.workNumber)}-${slugify(opts.meta.title) || 'untitled'}`;
  const file = `/sounds/${category.toLowerCase()}/${stem}.${format}`;
  const absPath = join(vault, 'public', file);
  const id = soundvaultIdFor(opts.meta, format);

  const soundsPath = join(vault, 'data/sounds.json');
  const projectsPath = join(vault, 'data/projects.json');
  const sounds: SoundRecord[] = JSON.parse(readFileSync(soundsPath, 'utf8'));
  const existing = sounds.find((s) => s.id === id) ?? sounds.find((s) => (s.sonova as { workNumber?: string } | undefined)?.workNumber === opts.meta.workNumber && s.format === format);
  if (existing) {
    const prevSha = (existing.sonova as { wavSha256?: string } | undefined)?.wavSha256;
    if (prevSha === wavSha256 && existsSync(join(vault, 'public', existing.file))) {
      return {
        status: 'already-registered',
        soundvaultId: existing.id,
        file: existing.file,
        absPath: join(vault, 'public', existing.file),
        format,
        wavSha256,
        fileSha256: sha256File(join(vault, 'public', existing.file)),
        verification,
        record: existing,
      };
    }
    throw new SoundvaultError(`${opts.meta.workNumber} は別の音声で登録済みです (${existing.id})。新しい作品番号で登録してください。`);
  }
  const otherOwner = sounds.find((s) => s.file === file);
  if (otherOwner) throw new SoundvaultError(`${file} は既に別の素材 (${otherOwner.id}) が使用しています`);
  if (existsSync(absPath)) throw new SoundvaultError(`${file} がディスク上に既に存在します (sounds.json 未登録)。手動で確認してください。`);

  // Encode to a temp file first.
  const tmp = join(tmpdir(), `sonova-${process.pid}-${Date.now()}.${format}`);
  if (useOgg) {
    const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', opts.wavPath, '-c:a', 'libvorbis', '-q:a', '6', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new SoundvaultError(`ffmpeg 変換に失敗: ${r.stderr}`);
  } else copyFileSync(opts.wavPath, tmp);
  const size = statSync(tmp).size;
  const now = new Date().toISOString();
  const record = buildRecord(opts.meta, file, format, size, verification, wavSha256, now);
  if (opts.dryRun) {
    rmSync(tmp, { force: true });
    return { status: 'dry-run', soundvaultId: id, file, absPath, format, wavSha256, fileSha256: '', verification, record };
  }

  mkdirSync(opts.backupDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, '-');
  const soundsBackup = join(opts.backupDir, `${stamp}-sounds.json`);
  const projectsBackup = join(opts.backupDir, `${stamp}-projects.json`);
  copyFileSync(soundsPath, soundsBackup);
  if (existsSync(projectsPath)) copyFileSync(projectsPath, projectsBackup);
  const publicSounds = join(vault, 'public/data/sounds.json');
  const publicProjects = join(vault, 'public/data/projects.json');
  const publicSoundsBackup = existsSync(publicSounds) ? readFileSync(publicSounds) : null;
  const publicProjectsBackup = existsSync(publicProjects) ? readFileSync(publicProjects) : null;

  try {
    mkdirSync(join(vault, 'public/sounds', category.toLowerCase()), { recursive: true });
    copyFileSync(tmp, absPath);
    const next = [...sounds, record].sort((a, b) => a.name.localeCompare(b.name));
    writeJson(soundsPath, next);
    const projects: Array<{ id: string }> = existsSync(projectsPath) ? JSON.parse(readFileSync(projectsPath, 'utf8')) : [];
    if (!projects.some((p) => p.id === SONOVA_PROJECT.id)) writeJson(projectsPath, [...projects, SONOVA_PROJECT]);

    let scanOutput: string | undefined;
    if (!opts.skipScan) {
      const r = spawnSync(process.execPath, ['scripts/scan-sounds.mjs'], { cwd: vault, encoding: 'utf8' });
      if (r.status !== 0) throw new SoundvaultError(`npm run scan に失敗: ${r.stderr}`);
      scanOutput = r.stdout.trim();
    }
    // Confirm what SOUNDVAULT now says about the asset.
    const after: SoundRecord[] = JSON.parse(readFileSync(soundsPath, 'utf8'));
    const saved = after.find((s) => s.id === id);
    if (!saved) throw new SoundvaultError('登録後の sounds.json にレコードがありません');
    if (saved.file !== file || saved.size !== size || saved.format !== format) throw new SoundvaultError('登録後のレコードがファイルと一致しません');
    if (after.length !== sounds.length + 1) throw new SoundvaultError(`件数が想定外です (${sounds.length} → ${after.length})`);
    const afterById = new Map(after.map((s) => [s.id, canonicalJson(s)]));
    for (const old of sounds) {
      const now_ = afterById.get(old.id);
      if (!now_) throw new SoundvaultError(`既存レコード ${old.id} が失われました`);
      if (now_ !== canonicalJson(old)) throw new SoundvaultError(`既存レコード ${old.id} が変更されました`);
    }
    const fileSha256 = sha256File(absPath);
    rmSync(tmp, { force: true });
    return { status: 'registered', soundvaultId: id, file, absPath, format, wavSha256, fileSha256, verification, record: saved, scanOutput };
  } catch (err) {
    copyFileSync(soundsBackup, soundsPath);
    if (existsSync(projectsBackup)) copyFileSync(projectsBackup, projectsPath);
    if (publicSoundsBackup) writeFileSync(publicSounds, publicSoundsBackup);
    if (publicProjectsBackup) writeFileSync(publicProjects, publicProjectsBackup);
    rmSync(absPath, { force: true });
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** SONOVA-side record of what was saved where. */
export interface RegistryEntry {
  workNumber: string;
  title: string;
  type: SonovaAssetType;
  soundvaultId: string;
  file: string;
  format: string;
  wavSha256: string;
  fileSha256: string;
  registeredAt: string;
  vaultGitHead?: string;
  playback?: { verifiedAt: string; method: string; ok: boolean; detail: string };
}

export function readRegistry(path: string): RegistryEntry[] {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}

export function upsertRegistry(path: string, entry: RegistryEntry): RegistryEntry[] {
  const list = readRegistry(path).filter((e) => e.soundvaultId !== entry.soundvaultId);
  list.push(entry);
  list.sort((a, b) => a.workNumber.localeCompare(b.workNumber) || a.format.localeCompare(b.format));
  writeJson(path, list);
  return list;
}
