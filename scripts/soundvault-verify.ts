/**
 * Verify SONOVA assets inside SOUNDVAULT after registration:
 *  1. records + files match compositions/soundvault-registry.json (sha256)
 *  2. pre-existing SOUNDVAULT records are unchanged vs. the vault's git HEAD
 *  3. SOUNDVAULT builds (npm run build) and its built site serves the records and audio
 *  4. the SOUNDVAULT UI plays each asset in Chromium (search → ▶ → audio advances) and the
 *     browser decodes it with the expected duration
 *   npx tsx scripts/soundvault-verify.ts [--vault <dir>] [--no-build] [--no-browser]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { canonicalJson } from '@sonova/instrument-dna';
import { inspectVault, readRegistry, sha256File, upsertRegistry, type RegistryEntry, type SoundRecord } from '@sonova/soundvault-adapter';
import { ROOT, writeJson } from './lib.ts';
import { launchBrowser } from './browser.ts';

const argv = process.argv.slice(2);
const i = argv.indexOf('--vault');
const vaultDir = resolve(i >= 0 ? argv[i + 1] : process.env.SOUNDVAULT_DIR ?? join(ROOT, '../soundvault'));
const registryPath = join(ROOT, 'compositions/soundvault-registry.json');
const report: Record<string, unknown> = { vault: vaultDir, checkedAt: new Date().toISOString() };
const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) problems.push(msg);
};

const info = inspectVault(vaultDir);
check(info.ok, `SOUNDVAULT を確認 (${info.dir})`);
const registry = readRegistry(registryPath);
check(registry.length > 0, `登録台帳 ${registry.length} 件`);
const sounds: SoundRecord[] = JSON.parse(readFileSync(join(vaultDir, 'data/sounds.json'), 'utf8'));
const publicSounds: SoundRecord[] = JSON.parse(readFileSync(join(vaultDir, 'public/data/sounds.json'), 'utf8'));

// 1. Records and files
for (const e of registry) {
  const rec = sounds.find((s) => s.id === e.soundvaultId);
  const path = join(vaultDir, 'public', e.file);
  check(!!rec, `${e.workNumber}: data/sounds.json に ${e.soundvaultId}`);
  check(publicSounds.some((s) => s.id === e.soundvaultId), `${e.workNumber}: public/data/sounds.json に反映`);
  check(existsSync(path) && sha256File(path) === e.fileSha256, `${e.workNumber}: ${e.file} の sha256 が台帳と一致`);
  if (rec) check(rec.size === statSync(path).size && rec.format === e.format, `${e.workNumber}: size/format がファイルと一致`);
  const dupes = sounds.filter((s) => (s.sonova as { workNumber?: string } | undefined)?.workNumber === e.workNumber && s.format === e.format);
  check(dupes.length === 1, `${e.workNumber}: 重複登録なし (${dupes.length})`);
}

// 2. Existing data intact (compare with the vault's committed state)
try {
  const head: SoundRecord[] = JSON.parse(execFileSync('git', ['-C', vaultDir, 'show', 'HEAD:data/sounds.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const nowById = new Map(sounds.map((s) => [s.id, canonicalJson(s)]));
  const changed = head.filter((s) => nowById.get(s.id) !== canonicalJson(s)).map((s) => s.id);
  check(changed.length === 0, `既存 ${head.length} 件のレコードは不変 (変更 ${changed.length})`);
  const status = execFileSync('git', ['-C', vaultDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const unexpected = status.filter((l) => !/(data\/sounds\.json|data\/projects\.json|public\/data\/(sounds|projects)\.json|public\/sounds\/(bgm|fx)\/sonova-)/.test(l));
  check(unexpected.length === 0, `SOUNDVAULT の変更は SONOVA 関連のみ (${status.length} 件)`);
  report.vaultChanges = status;
  const deleted = status.filter((l) => l.startsWith(' D') || l.startsWith('D'));
  check(deleted.length === 0, '削除されたファイルなし');
} catch (err) {
  check(false, `git による既存データ比較ができません: ${err}`);
}

// 3. Build the vault and serve dist
let baseUrl = '';
let server: ReturnType<typeof createServer> | null = null;
if (!argv.includes('--no-build')) {
  if (!existsSync(join(vaultDir, 'node_modules'))) {
    console.log('… SOUNDVAULT の依存をインストール (npm ci)');
    const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: vaultDir, encoding: 'utf8', shell: process.platform === 'win32' });
    check(r.status === 0, 'SOUNDVAULT npm ci');
  }
  const b = spawnSync('npm', ['run', 'build'], { cwd: vaultDir, encoding: 'utf8', shell: process.platform === 'win32' });
  check(b.status === 0, `SOUNDVAULT npm run build${b.status === 0 ? '' : `: ${b.stderr.slice(-400)}`}`);
  const dist = join(vaultDir, 'dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
  server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const path = normalize(join(dist, url.endsWith('/') ? `${url}index.html` : url));
    if (!path.startsWith(dist) || !existsSync(path) || statSync(path).isDirectory()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    const data = readFileSync(path);
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : data.length - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
      return res.end(data.subarray(start, end + 1));
    }
    res.end(data);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const built: SoundRecord[] = await (await fetch(`${baseUrl}data/sounds.json`)).json();
  for (const e of registry) {
    check(built.some((s) => s.id === e.soundvaultId), `${e.workNumber}: ビルド済みサイトの sounds.json に存在`);
    const res = await fetch(`${baseUrl}${e.file.slice(1)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    check(res.ok && sha === e.fileSha256, `${e.workNumber}: ビルド済みサイトから同一の音声を取得 (${res.headers.get('content-type')}, ${bytes.length} bytes)`);
  }
}

// 4. Play inside the SOUNDVAULT UI
const playback: Record<string, { ok: boolean; detail: string }> = {};
if (baseUrl && !argv.includes('--no-browser')) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __played: Array<{ src: string; el: HTMLMediaElement }> };
    w.__played = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__played.push({ src: this.currentSrc || this.src, el: this });
      return orig.call(this);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl);
  await page.waitForSelector('article.sound-card', { timeout: 20_000 });
  for (const e of registry) {
    await page.fill('#search', e.workNumber);
    const card = page.locator(`article[data-id="${e.soundvaultId}"]`);
    await card.waitFor({ timeout: 10_000 });
    await card.locator('[data-action="play"]').click();
    await page.waitForTimeout(1600);
    const state = await page.evaluate(async (file) => {
      const w = window as unknown as { __played: Array<{ src: string; el: HTMLMediaElement }> };
      const last = w.__played[w.__played.length - 1];
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await (await fetch(`.${file}`)).arrayBuffer());
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      const out = { src: last?.src ?? '', currentTime: last?.el.currentTime ?? 0, paused: last?.el.paused ?? true, error: last?.el.error?.code ?? null, decodedDuration: buf.duration, channels: buf.numberOfChannels, sampleRate: buf.sampleRate, peak };
      last?.el.pause();
      await ctx.close();
      return out;
    }, e.file);
    const rec = sounds.find((s) => s.id === e.soundvaultId);
    const durOk = Math.abs(state.decodedDuration - (rec?.duration ?? 0)) < 0.1;
    const ok = state.src.endsWith(e.file) && state.currentTime > 0.5 && state.error === null && durOk && state.peak > 0.05;
    const detail = `UI ▶ ${state.currentTime.toFixed(2)}s 再生 · decode ${state.decodedDuration.toFixed(2)}s/${state.channels}ch/${state.sampleRate}Hz · peak ${state.peak.toFixed(3)}`;
    playback[e.soundvaultId] = { ok, detail };
    check(ok, `${e.workNumber}: SOUNDVAULT UI で再生 — ${detail}`);
    await card.locator('[data-action="play"]').click().catch(() => undefined);
  }
  await page.fill('#search', 'SONOVA');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(ROOT, 'output/soundvault-ui.png'), fullPage: false });
  check(errors.length === 0, `SOUNDVAULT ページにスクリプトエラーなし${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  const now = new Date().toISOString();
  for (const e of registry) {
    const pb = playback[e.soundvaultId];
    if (pb) upsertRegistry(registryPath, { ...(e as RegistryEntry), playback: { verifiedAt: now, method: 'SOUNDVAULT dist + Chromium (playwright-core)', ...pb } });
  }
}
server?.close();
report.playback = playback;
report.problems = problems;
report.ok = problems.length === 0;
writeJson(join(ROOT, 'compositions/soundvault-verification.json'), report);
console.log(problems.length ? `\n${problems.length} 件の問題があります` : '\nすべて確認できました');
process.exit(problems.length ? 1 : 0);
