/**
 * Register SONOVA renders in SOUNDVAULT (manual step, Phase 3).
 *   npx tsx scripts/soundvault-register.ts [--vault <dir>] [--dry-run]
 * Registers the three Phase 2 experiments (EXPERIMENT → BGM) and the three Phase 1 instrument
 * auditions (INSTRUMENT → FX). Run `npm run phase1 && npm run phase2` first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXPERIMENT_PRESETS, arrange, experimentMetadata, instrumentMetadata, workNumberFor } from '@sonova/composition-engine';
import { generate } from '@sonova/music-generator';
import { SoundvaultError, inspectVault, registerAsset, upsertRegistry, type AssetMetadata } from '@sonova/soundvault-adapter';
import { ROOT, buildInstruments } from './lib.ts';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const vaultDir = resolve(arg('--vault') ?? process.env.SOUNDVAULT_DIR ?? join(ROOT, '../soundvault'));
const dryRun = argv.includes('--dry-run');
const registryPath = join(ROOT, 'compositions/soundvault-registry.json');

const info = inspectVault(vaultDir);
console.log(`SOUNDVAULT: ${info.dir}  ${info.ok ? 'OK' : 'NG'}  ${info.soundCount} sounds (SONOVA ${info.sonovaRecords})  git ${info.gitHead?.slice(0, 7) ?? '-'}`);
if (!info.ok) {
  console.error(`SOUNDVAULT を確認できません: ${info.problems.join(' / ')}\n--vault <dir> か SOUNDVAULT_DIR で場所を指定してください。生成物は output/ に保持されています。`);
  process.exit(1);
}

const { dnas } = await buildInstruments();
const createdAt = new Date().toISOString();
const jobs: Array<{ wav: string; meta: AssetMetadata; minDur: number; maxSilent: number }> = [];
dnas.forEach((dna, i) => {
  const workNumber = `SONOVA-INST-${String(i + 1).padStart(4, '0')}`;
  jobs.push({
    wav: join(ROOT, 'output/phase1', `${dna.name}.instrument.wav`),
    meta: instrumentMetadata(workNumber, dna, createdAt, [`experiments/phase1/dna/${dna.name}.dna.json`, `experiments/phase1/features/${dna.name}.features.json`]),
    minDur: 5,
    maxSilent: 0.3,
  });
});
for (const preset of EXPERIMENT_PRESETS) {
  const workNumber = workNumberFor(preset.seed, dnas, undefined, undefined);
  const gen = generate(dnas, { seed: preset.seed, durationSec: 30, arc: preset.arc });
  const arr = arrange(dnas, gen, preset.title);
  const files = ['structure', 'generation', 'events'].map((k) => `experiments/phase2/${workNumber}.${k}.json`);
  jobs.push({ wav: join(ROOT, 'output/phase2', `${workNumber}.wav`), meta: experimentMetadata(workNumber, arr, gen, dnas, createdAt, files), minDur: 29.9, maxSilent: 0.12 });
}

let failed = 0;
for (const job of jobs) {
  if (!existsSync(job.wav)) {
    console.error(`✗ ${job.meta.workNumber}: ${job.wav} がありません (npm run phase1 / phase2 を先に実行)`);
    failed++;
    continue;
  }
  try {
    const r = registerAsset({
      vaultDir,
      wavPath: job.wav,
      meta: job.meta,
      dryRun,
      backupDir: join(ROOT, 'output/soundvault-backups'),
      expectations: { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: job.minDur, maxPeakDbfs: -0.9, maxSilentRatio: job.maxSilent },
    });
    console.log(`${r.status === 'registered' ? '✓' : '•'} ${job.meta.workNumber} ${r.status.padEnd(18)} ${r.soundvaultId}  ${r.file}  (${r.verification.durationSec}s, peak ${r.verification.peakDbfs} dBFS)`);
    if (r.status !== 'dry-run') {
      const prev = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')).find((e: { soundvaultId: string }) => e.soundvaultId === r.soundvaultId) : undefined;
      upsertRegistry(registryPath, {
        workNumber: job.meta.workNumber,
        title: job.meta.title,
        type: job.meta.type,
        soundvaultId: r.soundvaultId,
        file: r.file,
        format: r.format,
        wavSha256: r.wavSha256,
        fileSha256: r.fileSha256,
        registeredAt: prev?.registeredAt ?? (r.record.createdAt as string),
        vaultGitHead: info.gitHead,
        playback: prev?.fileSha256 === r.fileSha256 ? prev?.playback : undefined,
      });
    }
  } catch (err) {
    failed++;
    console.error(`✗ ${job.meta.workNumber}: ${err instanceof SoundvaultError ? err.message : err}  (WAV は ${job.wav} に保持)`);
  }
}
if (!dryRun) console.log(`registry → compositions/soundvault-registry.json`);
process.exit(failed ? 1 : 0);
