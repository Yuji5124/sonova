/**
 * Register every SONOVA / ZIG song made so far in SOUNDVAULT, under the project "SONOVA Project ZIG".
 *   npx tsx scripts/soundvault-register-zig.ts [--vault <dir>] [--dry-run]
 * Uses the SONOVA adapter (OGG Vorbis q6, verification, backups, scan, no silent overwrite). The Phase 1–3
 * assets (INST/EXP-0001…0003, ROCK-0001) come from scripts/soundvault-register.ts; this adds the rest and
 * then tags every SONOVA record with the ZIG project (and the ZIG songs with the "ZIG" collection).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { decodeWav, engineVersions } from '@sonova/composition-engine';
import { SoundvaultError, inspectVault, registerAsset, upsertRegistry, type AssetMetadata } from '@sonova/soundvault-adapter';
import { PHASE1_SEED, ROOT, buildInstruments } from './lib.ts';

const argv = process.argv.slice(2);
const vaultDir = resolve((argv.includes('--vault') ? argv[argv.indexOf('--vault') + 1] : undefined) ?? process.env.SOUNDVAULT_DIR ?? join(ROOT, '../soundvault'));
const dryRun = argv.includes('--dry-run');
const registryPath = join(ROOT, 'compositions/soundvault-registry.json');
const PROJECT = { id: 'sonova-zig', name: 'SONOVA Project ZIG', type: '音楽制作', archived: false };

const info = inspectVault(vaultDir);
console.log(`SOUNDVAULT: ${info.dir} ${info.ok ? 'OK' : 'NG'} ${info.soundCount} sounds (SONOVA ${info.sonovaRecords})`);
if (!info.ok) process.exit(1);

const { dnas, sources } = await buildInstruments();
const createdAt = new Date().toISOString();
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const base = {
  materialIds: sources.map((s) => s.sha256),
  sources: sources.map((s) => ({ name: s.name, type: 'image', sha256: s.sha256 })),
  instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, dna_hash: d.dna_hash, name: d.name })),
  engines: engineVersions(),
  createdAt,
};
const VOX = (credits: string) => `Original。歌声は VOICEVOX (${credits}) — 公開時はクレジット表記が必要`;

interface Job {
  wav: string;
  meta: AssetMetadata;
  zig?: boolean;
}
const job = (wav: string, m: Omit<AssetMetadata, keyof typeof base | 'algorithms'> & { algorithms?: string[] }, zig = false): Job => ({ wav: join(ROOT, wav), zig, meta: { ...base, algorithms: m.algorithms ?? [], ...m } });

const rs = (k: string) => json(`experiments/rock-series/SONOVA-ROCK-${k}-0001.json`);
const od = (k: string) => json(`experiments/orchestra-digital/phase2/EXP-${k}.json`);
const nb = json('experiments/nobody/nobody.json');
const ht = json('experiments/happytears/happytears.json');
const v11 = json('experiments/v11/phase2.json');

const jobs: Job[] = [
  // ---- SONOVA rock series and experiments ----
  ...(['GROW', 'HEAL', 'SPACE'] as const).map((k) => {
    const d = rs(k);
    return job(`output/rock-series/SONOVA-ROCK-${k}-0001.wav`, { workNumber: `SONOVA-ROCK-${k}-0001`, title: d.title, type: 'COMPOSITION', bpm: d.bpm, seed: d.seed, license: 'Original', description: { GROW: '音が楽器を育てるロック版。演奏するほど楽器の共鳴が進化する。', HEAL: '音楽が自分を修復するロック版。壊れた弦や欠けたパートを、聴いて別の楽器が補う。', SPACE: '部屋の共鳴モードが音を決め、音が部屋を変形させるロック版。' }[k], tags: ['rock', 'composition', 'rock-series', k.toLowerCase()], sonovaFiles: [`experiments/rock-series/SONOVA-ROCK-${k}-0001.json`, `experiments/rock-series/SONOVA-ROCK-${k}-0001.md`] });
  }),
  job('output/s002/SONOVA-GROW-0001.wav', { workNumber: 'SONOVA-GROW-0001', title: 'Sound Grows the Instrument', type: 'EXPERIMENT', bpm: json('experiments/s002/SONOVA-GROW-0001.json').bpm, seed: 'sonova-grow-0001', license: 'Original', description: 'SONOVA 002: 演奏するほど楽器の共鳴構造が進化する。', tags: ['experiment', 'grow', 'sonova-002'], sonovaFiles: ['experiments/s002/SONOVA-GROW-0001.json', 'experiments/s002/REPORT.md'] }),
  job('output/s003/SONOVA-HEAL-0001.wav', { workNumber: 'SONOVA-HEAL-0001', title: 'The Music Heals Itself', type: 'EXPERIMENT', seed: 'sonova-heal-0001', license: 'Original', description: 'SONOVA 003: 欠落・不協和を聴いて検知し、別の楽器が補う。', tags: ['experiment', 'heal', 'sonova-003'], sonovaFiles: ['experiments/s003/SONOVA-HEAL-0001.json', 'experiments/s003/REPORT.md'] }),
  job('output/s004/SONOVA-SPACE-0001.wav', { workNumber: 'SONOVA-SPACE-0001', title: 'Sound Makes the Room', type: 'EXPERIMENT', seed: 'sonova-space-0001', license: 'Original', description: 'SONOVA 004: 部屋の共鳴モードが音を決め、音が部屋を変形させる。', tags: ['experiment', 'space', 'sonova-004'], sonovaFiles: ['experiments/s004/SONOVA-SPACE-0001.json', 'experiments/s004/REPORT.md'] }),
  job('output/xrock/SONOVA-XROCK-0001.wav', { workNumber: 'SONOVA-XROCK-0001', title: json('experiments/xrock/SONOVA-XROCK-0001.json').title, type: 'COMPOSITION', bpm: json('experiments/xrock/SONOVA-XROCK-0001.json').bpm, seed: 'sonova-xrock-0001', license: 'Original', description: 'ロックを時間・テンポ・リズム・音高・声の5方向に押し広げる拡張ロック。', tags: ['rock', 'composition', 'xrock', 'paulstretch', 'tempo-canon', 'talkbox'], sonovaFiles: ['experiments/xrock/SONOVA-XROCK-0001.json', 'experiments/xrock/REPORT.md'] }),
  job('output/toyriot/SONOVA-TOYRIOT-0001.wav', { workNumber: 'SONOVA-TOYRIOT-0001', title: 'Tin Wings Riot', type: 'COMPOSITION', bpm: 172, seed: 'sonova-toyriot-0001', license: VOX('VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎'), description: '90年代後半の日本のインダストリアル/オルタナ・ポップロックの作り方を参考にしたオリジナル曲。ラジオのコラージュ、メガホンの歌、ドラムマシン、男声 (VOICEVOX)。', tags: ['rock', 'composition', 'toyriot', 'voicevox', 'vocal'], sonovaFiles: ['experiments/toyriot/SONOVA-TOYRIOT-0001.json', 'experiments/toyriot/REPORT.md'] }),
  ...(['A', 'B', 'C', 'D'] as const).map((k) => {
    const d = od(k);
    return job(`output/orchestra-digital/phase2/EXP-${k}/EXP-${k}.wav`, { workNumber: `SONOVA-OD-EXP-${k}`, title: `ORCHESTRA × DIGITAL ${d.title}`, type: 'EXPERIMENT', seed: `od-phase2-${k}`, license: 'Original (オーケストラは VSCO 2 Community Edition, CC0)', description: `ORCHESTRA × DIGITAL Phase 2 の実験 ${k}: ${d.question} — ${d.bridge}`, tags: ['experiment', 'orchestra', 'digital', 'vsco2-ce'], sonovaFiles: [`experiments/orchestra-digital/phase2/EXP-${k}.json`, 'experiments/orchestra-digital/phase2/REPORT.md'] });
  }),
  ...v11.candidates.map((c: { workNumber: string; title: string; seed: string; bpm: number; arc: string }) => job(`output/v11/${c.workNumber}.wav`, { workNumber: c.workNumber, title: c.title, type: 'EXPERIMENT', bpm: c.bpm, seed: c.seed, license: 'Original', description: `SONOVA v1.1: 写真の楽器3つが相互作用する30秒 (${c.arc})。各アーク16曲から選んだ候補。`, tags: ['experiment', 'v1.1', c.arc], sonovaFiles: ['experiments/v11/phase2.json', 'experiments/v11/REPORT.md'] })),
  // ---- ZIG ----
  job('output/psylo/ZIG-PSYLO-0001.wav', { workNumber: 'ZIG-PSYLO-0001', title: 'PSYLO', type: 'COMPOSITION', bpm: 160, seed: 'zig-psylo-0001', license: VOX('VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎') + '。英語アナウンスは Piper + LibriTTS (CC BY 4.0)', description: 'ZIG のフック「サイロー」。TOYRIOT の作り方で1曲に。英語のラジオアナウンス、サビ1のあとから変則リフ、男声 (音程の安定化つき)。', tags: ['zig', 'psylo', 'rock', 'vocal', 'voicevox'], sonovaFiles: ['experiments/psylo/ZIG-PSYLO-0001.json', 'experiments/psylo/REPORT.md'] }, true),
  ...nb.demos.map((d: { id: string; title: string; bpm: number; concept: string; credits: string[] }) => job(`output/nobody/NOBODY-${d.id}-mix.wav`, { workNumber: `ZIG-NOBODY-${d.id}`, title: `NOBODY ON AIR ${d.id} ${d.title}`, type: 'EXPERIMENT', bpm: d.bpm, seed: `nobody-${d.id.toLowerCase()}`, license: VOX(d.credits.join(' / ')), description: `FREAKTION SONG 001 の30秒デモ ${d.id}。${d.concept}`, tags: ['zig', 'nobody-on-air', 'freaktion', 'vocal', 'voicevox'], sonovaFiles: ['experiments/nobody/nobody.json'] }, true)),
  ...ht.demos.map((d: { id: string; title: string; bpm: number; goal: string; credits: string[] }) => job(`output/happytears/HAPPY-${d.id}-mix.wav`, { workNumber: `ZIG-HAPPY-TEARS-${d.id}`, title: `HAPPY TEARS ${d.id} ${d.title}`, type: 'EXPERIMENT', bpm: d.bpm, seed: `happy-${d.id.toLowerCase()}`, license: VOX(d.credits.join(' / ')) + '。オーケストラは VSCO 2 Community Edition (CC0)', description: `FREAKTION SONG 002 / Phase 0 の30秒デモ ${d.id}。${d.goal}`, tags: ['zig', 'happy-tears', 'freaktion', 'orchestral', 'vocal', 'voicevox'], sonovaFiles: ['experiments/happytears/happytears.json'] }, true)),
];
void PHASE1_SEED;

let failed = 0;
const zigIds: string[] = [];
for (const j of jobs) {
  if (!existsSync(j.wav)) {
    console.error(`✗ ${j.meta.workNumber}: ${j.wav} がありません`);
    failed++;
    continue;
  }
  const d = decodeWav(new Uint8Array(readFileSync(j.wav)));
  try {
    const r = registerAsset({
      vaultDir,
      wavPath: j.wav,
      meta: j.meta,
      dryRun,
      backupDir: join(ROOT, 'output/soundvault-backups'),
      expectations: { sampleRate: d.sampleRate, channels: 2, bitsPerSample: d.bitsPerSample, minDurationSec: Math.floor(d.frames / d.sampleRate) - 1, maxPeakDbfs: -0.5, maxSilentRatio: 0.2 },
    });
    if (j.zig) zigIds.push(r.soundvaultId);
    console.log(`${r.status === 'registered' ? '✓' : '•'} ${j.meta.workNumber.padEnd(22)} ${r.status.padEnd(18)} ${r.file} (${r.verification.durationSec}s)`);
    if (r.status !== 'dry-run') upsertRegistry(registryPath, { workNumber: j.meta.workNumber, title: j.meta.title, type: j.meta.type, soundvaultId: r.soundvaultId, file: r.file, format: r.format, wavSha256: r.wavSha256, fileSha256: r.fileSha256, registeredAt: r.record.createdAt as string, vaultGitHead: info.gitHead });
  } catch (err) {
    failed++;
    console.error(`✗ ${j.meta.workNumber}: ${err instanceof SoundvaultError ? err.message : err}`);
  }
}

if (!dryRun) {
  // the project: every SONOVA record belongs to SONOVA Project ZIG; ZIG's own songs also go in the "ZIG" collection
  const soundsPath = join(info.dir, 'data/sounds.json');
  const projectsPath = join(info.dir, 'data/projects.json');
  const sounds = JSON.parse(readFileSync(soundsPath, 'utf8')) as Array<{ id: string; projectIds?: string[]; collections?: string[]; sonova?: unknown }>;
  for (const s of sounds) {
    if (!s.sonova) continue;
    s.projectIds = [...new Set([...(s.projectIds ?? []), PROJECT.id])];
    if (zigIds.includes(s.id)) s.collections = [...new Set([...(s.collections ?? []), 'ZIG'])];
  }
  writeFileSync(soundsPath, `${JSON.stringify(sounds, null, 2)}\n`);
  const projects = JSON.parse(readFileSync(projectsPath, 'utf8')) as Array<{ id: string }>;
  if (!projects.some((p) => p.id === PROJECT.id)) writeFileSync(projectsPath, `${JSON.stringify([...projects, PROJECT], null, 2)}\n`);
  const r = spawnSync(process.execPath, ['scripts/scan-sounds.mjs'], { cwd: info.dir, encoding: 'utf8' });
  console.log(r.stdout.trim().split('\n').slice(-2).join('\n'));
  if (r.status !== 0) {
    console.error(r.stderr);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
