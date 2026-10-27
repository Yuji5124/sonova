/**
 * ZIG daily song → SOUNDVAULT.
 *   npm run zig:daily -- --vault ../soundvault [--dry-run] [--date YYMMDD] [--allow-extra] [--out output/zig-daily]
 *                        [--lyrics lyrics.json [--voicevox auto|required|off]]     (with --lyrics the song is sung)
 * Exit code: 0 = registered / already registered today / dry-run, 1 = failed (never reported as success).
 * Under GitHub Actions it also writes the step outputs and the job summary.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkZigLyrics } from '@sonova/composition-engine';
import { ROOT } from './lib.ts';
import { makeVocalRenderer, type VoicevoxMode } from './lib-zig-vocal.ts';
import { runZigDaily } from './lib-zig-daily.ts';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const vaultDir = resolve(arg('--vault') ?? process.env.SOUNDVAULT_DIR ?? join(ROOT, '../soundvault'));
const outDir = resolve(arg('--out') ?? join(ROOT, 'output/zig-daily'));

// --lyrics: the song is sung. The words are validated first; anything wrong stops the run (no guessing, no fallback to instrumental).
let lyrics;
let render;
const lyricsPath = arg('--lyrics');
if (lyricsPath) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(lyricsPath), 'utf8'));
  } catch (err) {
    console.error(`✗ 歌詞ファイルを読めません: ${lyricsPath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const check = checkZigLyrics(raw);
  if (!check.ok || !check.lyrics) {
    console.error(`✗ 歌詞に問題があります (${lyricsPath}):\n${check.problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  lyrics = check.lyrics;
  const mode = (arg('--voicevox') ?? 'auto') as VoicevoxMode;
  if (!['auto', 'required', 'off'].includes(mode)) {
    console.error('✗ --voicevox は auto / required / off のどれかです');
    process.exit(1);
  }
  render = makeVocalRenderer({ lyrics, voicevox: mode, cacheDir: join(outDir, 'vocal-queries') });
}

const result = await runZigDaily({
  lyrics,
  render,
  vaultDir,
  outDir,
  stamp: arg('--date'),
  dryRun: argv.includes('--dry-run'),
  allowExtra: argv.includes('--allow-extra'),
  log: (m) => process.stdout.write(`  · ${m}\n`),
});

const icon = { registered: '✓', 'skipped-existing': '•', 'dry-run': '○', failed: '✗' }[result.status];
console.log(`${icon} [${result.status}] ${result.message}`);
if (result.runLogPath) console.log(`run log → ${result.runLogPath}`);

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `status=${result.status}`,
    `stamp=${result.stamp}`,
    `title=${result.plan?.title ?? ''}`,
    `display_name=${result.plan?.displayName ?? ''}`,
    `work_number=${result.plan?.workNumber ?? ''}`,
    `file=${result.file ?? ''}`,
  ];
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ZIG daily ${result.stamp}: ${result.status}\n\n${result.message}\n\n${result.plan ? `- 曲名: \`${result.plan.displayName}\`\n- 作品番号: \`${result.plan.workNumber}\`\n- ${result.plan.key} / ${result.plan.bpm} BPM / seed \`${result.plan.seed}\`\n` : ''}`,
  );
}
process.exit(result.status === 'failed' ? 1 : 0);
