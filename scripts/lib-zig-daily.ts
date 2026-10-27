/**
 * ZIG daily song: generate one original instrumental rock song for today (Japan time) and register it in
 * SOUNDVAULT through the existing adapter. This file is the orchestration (idempotent, dry-run, failure state);
 * the actual rendering is injected so tests can use a fast stand-in.
 *
 * Guarantees:
 *  - one song per Japan-time day: if SOUNDVAULT already has a `YYMMDD_ZIG_…` record, nothing is generated or written
 *  - existing records and audio are never overwritten (the adapter refuses and rolls back)
 *  - every outcome (registered / skipped / dry-run / failed) is written to a run log; failure is never reported as success
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { generateRock, ROCK_VERSION } from '@sonova/music-generator';
import { PSYLO_VERSION, ROCK_RENDER_VERSION, applyPsyloRiffs, zigDailyReferences, type ZigLyrics, engineVersions, isStamp, jstStamp, renderRock, rockToMidi, zigDailyPlan, type ZigDailyPlan } from '@sonova/composition-engine';
import { SoundvaultError, inspectVault, registerAsset, type AssetMetadata, type RegisterResult, type SoundRecord } from '@sonova/soundvault-adapter';
import type { SpectroImage } from '@sonova/synthesis-engine';
import { buildInstruments, writeStereoWav } from './lib.ts';

/** What a renderer must hand back (a real one renders audio; tests write a tone). */
export interface RenderedSong {
  wavPath: string;
  bpm: number;
  key: string;
  durationSec: number;
  riffText: string;
  sections: Array<{ name: string; start: number; bars: number }>;
  derivations: unknown[];
  engines: Record<string, string>;
  sources: Array<{ name: string; sha256: string }>;
  instruments: Array<{ instrument_id: string; dna_hash: string; name: string }>;
  renderMs: number;
  /** present when the song is sung */
  vocal?: {
    /** 'VOICEVOX Engine …' or 'SONOVA 内蔵の歌手' */
    engine: string;
    /** credits that must be shown when the audio is shared (VOICEVOX voices) */
    credits: string[];
    /** why the built-in singer was used instead of VOICEVOX (empty when VOICEVOX sang) */
    fallbackReason?: string;
    stabilize?: number;
  };
}
export type Renderer = (plan: ZigDailyPlan, outDir: string, log: (m: string) => void) => Promise<RenderedSong>;

export interface ZigDailyOptions {
  vaultDir: string;
  /** Working output (WAV, MIDI, run logs, vault JSON backups). Not inside the vault. */
  outDir: string;
  /** Override the date (YYMMDD). Default: today in Asia/Tokyo. */
  stamp?: string;
  now?: Date;
  dryRun?: boolean;
  /** Allow a 2nd, 3rd … song on a day that already has one (default: one song per day). */
  allowExtra?: boolean;
  render?: Renderer;
  log?: (m: string) => void;
  minDurationSec?: number;
  /** Lyrics of the day (already validated with checkZigLyrics). With a vocal renderer the song is sung. */
  lyrics?: ZigLyrics;
}

export type ZigDailyStatus = 'registered' | 'skipped-existing' | 'dry-run' | 'failed';

export interface ZigDailyResult {
  status: ZigDailyStatus;
  stamp: string;
  message: string;
  plan?: ZigDailyPlan;
  existing?: string[];
  soundvaultId?: string;
  file?: string;
  recordPath?: string;
  error?: string;
  runLogPath?: string;
}

/** The image-made instruments (guitar, drums, voice) and the picture the rock renderer reads. Shared by both renderers. */
export async function bandAndImage() {
  const { dnas, sources } = await buildInstruments();
  const [bark, tower, sunset] = dnas;
  const band = { guitar: bark, drums: tower, voice: sunset };
  const png = PNG.sync.read(readFileSync(sources[0].path));
  const W = 160;
  const H = 72;
  const lum = new Float64Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (Math.floor((y / H) * png.height) * png.width + Math.floor((x / W) * png.width)) * 4;
      lum[y * W + x] = (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
    }
  const image: SpectroImage = { width: W, height: H, lum };
  return { dnas, sources, band, image };
}

/** The real renderer: image-instrument band → generated rock song with the irregular riffs → WAV. CPU only. */
export const renderZigDaily: Renderer = async (plan, outDir, log) => {
  const { dnas, sources, band, image } = await bandAndImage();
  const song = applyPsyloRiffs(generateRock(band, plan.seed, plan.title, plan.rockOptions));
  const out = renderRock(song, band, image, 44100, log);
  mkdirSync(outDir, { recursive: true });
  const wavPath = join(outDir, `${plan.fileStem}.wav`);
  writeStereoWav(wavPath, out.buffer, plan.seed);
  writeFileSync(join(outDir, `${plan.fileStem}.mid`), rockToMidi(song));
  return {
    wavPath,
    bpm: song.bpm,
    key: plan.key,
    durationSec: song.durationSec,
    riffText: song.riffText,
    sections: song.sections.map((s) => ({ name: s.name, start: s.start, bars: s.bars })),
    derivations: song.derivations,
    engines: { ...engineVersions(), rock: ROCK_VERSION, rock_render: ROCK_RENDER_VERSION, psylo_riffs: PSYLO_VERSION },
    sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })),
    instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, dna_hash: d.dna_hash, name: d.name })),
    renderMs: out.renderMs,
  };
};

const writeJsonAtomic = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
};

const zigDailyOf = (s: SoundRecord): { stamp?: string } | undefined => (s.sonova as { zigDaily?: { stamp?: string } } | undefined)?.zigDaily;

/** Records of this day's ZIG daily songs, found by the stored stamp or, failing that, by the `YYMMDD_ZIG_` name prefix. */
export function findDailyRecords(sounds: SoundRecord[], stamp: string): SoundRecord[] {
  return sounds.filter((s) => zigDailyOf(s)?.stamp === stamp || s.name.startsWith(`${stamp}_ZIG_`));
}

export async function runZigDaily(o: ZigDailyOptions): Promise<ZigDailyResult> {
  const log = o.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const stamp = o.stamp ?? jstStamp(o.now);
  const finish = (r: Omit<ZigDailyResult, 'stamp' | 'runLogPath'>): ZigDailyResult => {
    const runLogPath = join(o.outDir, `${stamp}.${r.status}.run.json`);
    const result: ZigDailyResult = { ...r, stamp, runLogPath };
    try {
      writeJsonAtomic(runLogPath, { schema: 'zig-daily-run/1', startedAt, finishedAt: new Date().toISOString(), dryRun: !!o.dryRun, ...result });
    } catch (err) {
      log(`(run log could not be written: ${err})`);
    }
    return result;
  };

  try {
    if (!isStamp(stamp)) return finish({ status: 'failed', message: `日付スタンプが不正です (YYMMDD): ${stamp}`, error: 'invalid-stamp' });
    const info = inspectVault(o.vaultDir);
    if (!info.ok) return finish({ status: 'failed', message: `SOUNDVAULT ではありません: ${info.problems.join(' / ')}`, error: 'invalid-vault' });
    const vault = info.dir;
    const soundsPath = join(vault, 'data/sounds.json');
    const sounds: SoundRecord[] = JSON.parse(readFileSync(soundsPath, 'utf8'));

    // 1) one song per day: already there → do nothing at all
    const todays = findDailyRecords(sounds, stamp);
    if (todays.length && !o.allowExtra) {
      return finish({ status: 'skipped-existing', message: `${stamp} の曲は登録済みのため何も作りません: ${todays.map((s) => s.id).join(', ')}`, existing: todays.map((s) => s.id) });
    }
    // 2) a record file without a sounds.json entry means someone edited by hand: stop rather than guess
    const recordDir = join(vault, 'data/zig-daily');
    const orphan = existsSync(recordDir) ? readdirSync(recordDir).filter((f) => f.startsWith(`${stamp}_ZIG_`) && f.endsWith('.json')) : [];
    const knownStems = new Set(todays.map((s) => (s.file.split('/').pop() ?? '').replace(/\.[^.]+$/, '')));
    const unknown = orphan.filter((f) => !knownStems.has(f.replace(/\.json$/, '')));
    if (unknown.length) {
      return finish({ status: 'failed', message: `data/zig-daily/ に sounds.json 未登録の記録があります (${unknown.join(', ')})。手動で確認してください。`, error: 'orphan-record' });
    }

    // 3) the first free sequence (always 1 unless an extra song is allowed)
    const takenNames = new Set(sounds.map((s) => s.name));
    const taken = (p: ZigDailyPlan) => takenNames.has(p.displayName) || sounds.some((s) => s.id.includes(p.workNumber.toLowerCase().replace(/-/g, '_')) || s.file.includes(p.fileStem));
    let sequence = 1;
    let plan = zigDailyPlan(stamp, { sequence, takenNames, title: o.lyrics?.title });
    while (taken(plan)) {
      sequence++;
      if (sequence > 99) return finish({ status: 'failed', message: `${stamp} の連番が使い切られています`, error: 'no-free-sequence' });
      plan = zigDailyPlan(stamp, { sequence, takenNames, title: o.lyrics?.title });
    }
    log(`plan: ${plan.workNumber} "${plan.displayName}" ${plan.key} ${plan.bpm} BPM seed ${plan.seed}`);

    if (o.dryRun) {
      return finish({
        status: 'dry-run',
        message: `dry-run: ${plan.displayName} を /sounds/bgm/${plan.fileStem}.(ogg|wav) として登録する予定。何も書き込んでいません。`,
        plan,
      });
    }

    // 4) generate
    const render = o.render ?? renderZigDaily;
    const rendered = await render(plan, join(o.outDir, 'audio'), log);

    // 5) register (verification, no-overwrite, rollback all live in the adapter)
    const createdAt = new Date().toISOString();
    const vocal = rendered.vocal;
    const voicevox = !!vocal && vocal.credits.length > 0;
    const references = zigDailyReferences(!!vocal);
    const meta: AssetMetadata = {
      workNumber: plan.workNumber,
      title: plan.title,
      type: 'COMPOSITION',
      bpm: rendered.bpm,
      materialIds: rendered.sources.map((s) => s.sha256),
      sources: rendered.sources.map((s) => ({ name: s.name, type: 'image', sha256: s.sha256 })),
      instruments: rendered.instruments,
      seed: plan.seed,
      algorithms: ['拡張 Karplus–Strong + アンプ帰還', 'WDF ダイオードクリッパー', 'モーダル打楽器', 'セルオートマトンのリズム', '変則リフ (ポリメーター / ユークリッドリズムの回転)'],
      engines: { ...rendered.engines, zig_daily: plan.version },
      license: voicevox ? `Original。歌声は VOICEVOX (${vocal!.credits.join(' / ')}) — 公開時はクレジット表記が必要` : 'Original',
      createdAt,
      description: `ZIG名義のデイリー曲 ${plan.stamp} (${plan.dateIso})。${rendered.key}・${vocal ? `歌入りのロック (歌詞はオリジナル、作詞: ${o.lyrics?.author ?? '不明'})` : 'インストゥルメンタルのロック'}。参照元と生成条件は sonova.references / sonova.generation に記録。`,
      tags: ['zig', 'zig-daily', 'rock', ...(vocal ? ['vocal', ...(voicevox ? ['voicevox'] : [])] : ['instrumental']), 'original', 'generative', plan.stamp],
      sonovaFiles: [],
      displayName: plan.displayName,
      fileStem: plan.fileStem,
      collections: ['SONOVA COMPOSITIONS', 'ZIG', 'ZIG DAILY'],
      projectIds: ['sonova', 'sonova-zig'],
      author: 'ZIG',
      extra: {
        zigDaily: { stamp: plan.stamp, dateIso: plan.dateIso, timezone: plan.timezone, sequence: plan.sequence, version: plan.version, ...(vocal ? { vocal: { engine: vocal.engine, credits: vocal.credits, author: o.lyrics?.author } } : {}) },
        references,
        ...(vocal && o.lyrics ? { lyrics: { author: o.lyrics.author, text: o.lyrics.text, romaji: o.lyrics.romaji } } : {}),
        generation: {
          key: rendered.key,
          bpm: rendered.bpm,
          durationSec: rendered.durationSec,
          riff: rendered.riffText,
          sections: rendered.sections,
          vocals: vocal ? `あり: ${vocal.engine}${vocal.credits.length ? ` (${vocal.credits.join(' / ')})` : ''}${vocal.fallbackReason ? `。VOICEVOX を使えなかった理由: ${vocal.fallbackReason}` : ''}。歌詞はこの日のために書いたオリジナル` : 'なし (インストゥルメンタル。歌声・歌詞・外部の音声エンジンは使っていない)',
          runtime: 'ローカル CPU のみ。有料 API・クラウド AI・API キー・GPU は不使用',
          renderMs: rendered.renderMs,
        },
      },
    };
    let reg: RegisterResult;
    try {
      reg = registerAsset({
        vaultDir: vault,
        wavPath: rendered.wavPath,
        meta,
        backupDir: join(o.outDir, 'soundvault-backups'),
        expectations: { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: o.minDurationSec ?? 150, maxPeakDbfs: -0.9, maxSilentRatio: 0.03 },
      });
    } catch (err) {
      const message = err instanceof SoundvaultError ? err.message : String(err);
      return finish({ status: 'failed', message: `登録に失敗しました (SOUNDVAULT は元に戻してあります。WAV は ${rendered.wavPath} に残っています): ${message}`, plan, error: message });
    }

    // 6) the run record travels with the song (committed with it)
    const recordPath = join(recordDir, `${plan.fileStem}.json`);
    writeJsonAtomic(recordPath, {
      schema: 'zig-daily/1',
      stamp: plan.stamp,
      dateIso: plan.dateIso,
      timezone: plan.timezone,
      workNumber: plan.workNumber,
      title: plan.title,
      displayName: plan.displayName,
      seed: plan.seed,
      generation: { key: rendered.key, bpm: rendered.bpm, durationSec: rendered.durationSec, riff: rendered.riffText, sections: rendered.sections, derivations: rendered.derivations, engines: meta.engines, renderMs: rendered.renderMs },
      references,
      ...(vocal && o.lyrics ? { vocal: { ...vocal, lyrics: { author: o.lyrics.author, text: o.lyrics.text, romaji: o.lyrics.romaji } } } : {}),
      sources: rendered.sources,
      audio: { file: reg.file, format: reg.format, wavSha256: reg.wavSha256, fileSha256: reg.fileSha256, verification: reg.verification },
      registration: { status: reg.status, soundvaultId: reg.soundvaultId, registeredAt: reg.record.createdAt, vaultGitHead: info.gitHead ?? null },
      license: meta.license,
    });
    return finish({ status: 'registered', message: `登録しました: ${plan.displayName} → ${reg.file}`, plan, soundvaultId: reg.soundvaultId, file: reg.file, recordPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finish({ status: 'failed', message: `想定外のエラー: ${message}`, error: message });
  }
}
