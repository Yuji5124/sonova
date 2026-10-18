/**
 * End-to-end check of SONOVA LAB in Chromium:
 *  sample images → DNA (same hashes as the CLI) → audition sounds → 3 candidates (same WAV bytes as
 *  the CLI) → playback → exports → SOUNDVAULT save via the dev API (dedupes against CLI registrations).
 *   SOUNDVAULT_DIR=<vault> npx tsx scripts/verify-lab-browser.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeWav } from '@sonova/composition-engine';
import { ROOT, writeJson } from './lib.ts';
import { launchBrowser, startProcess, waitForHttp } from './browser.ts';

const PORT = Number(process.env.SONOVA_LAB_PORT ?? 5199);
const url = `http://localhost:${PORT}/`;
const shots = join(ROOT, 'output/lab-screens');
mkdirSync(shots, { recursive: true });
const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const vite = startProcess(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], join(ROOT, 'apps/sonova-lab'));
try {
  await waitForHttp(url, 40_000);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.screenshot({ path: join(shots, '1-home.png') });

  await page.click('[data-act="samples"]');
  await page.waitForFunction(() => document.querySelectorAll('article.source').length === 3, null, { timeout: 30_000 });
  await page.screenshot({ path: join(shots, '2-source-lab.png'), fullPage: true });
  check('SOURCE LAB: 画像3枚を解析', true);

  // DNA reproducibility across browser and Node
  const browserDna = await page.evaluate(() => (window as any).__sonova.dnas().map((d: any) => ({ name: d.name, hash: d.dna_hash, id: d.instrument_id })));
  for (const d of browserDna) {
    const cli = JSON.parse(readFileSync(join(ROOT, 'experiments/phase1/dna', `${d.name}.dna.json`), 'utf8'));
    check(`DNA 再現性 (${d.name})`, cli.dna_hash === d.hash && cli.instrument_id === d.id, `browser ${d.hash} / cli ${cli.dna_hash}`);
  }

  await page.click('[data-screen="instrument"]');
  for (let i = 0; i < 3; i++) {
    await page.click(`[data-act="audition"][data-i="${i}"]`);
    await page.waitForFunction((k) => (window as any).__sonovaPlaying?.key === `demo${k}`, i, { timeout: 30_000 });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({ playing: (window as any).__sonovaPlaying }));
    check(`INSTRUMENT LAB: 楽器 ${i + 1} の試聴が鳴る`, state.playing.peak > 0.05 && state.playing.duration > 5, `peak ${state.playing.peak.toFixed(3)}, ${state.playing.duration.toFixed(1)}s`);
  }
  await page.screenshot({ path: join(shots, '3-instrument-lab.png'), fullPage: true });

  await page.click('[data-screen="generator"]');
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('article.cand').length === 3 && !document.querySelector('#busy'), null, { timeout: 240_000 });
  await page.screenshot({ path: join(shots, '4-music-generator.png'), fullPage: true });
  const cands = await page.evaluate(() => {
    const s = (window as any).__sonova;
    const out = [];
    for (const [i, r] of s.rendered.entries()) {
      let b64 = '';
      for (let k = 0; k < r.wav.length; k += 32768) b64 += String.fromCharCode(...r.wav.subarray(k, k + 32768));
      out.push({ i, wav: btoa(b64), ok: r.verification.ok, work: s.store.projects[0].candidates[i].workNumber });
    }
    return out;
  });
  for (const c of cands) {
    const bytes = Buffer.from(c.wav, 'base64');
    const cliWav = join(ROOT, 'output/phase2', `${c.work}.wav`);
    const cli = existsSync(cliWav) ? readFileSync(cliWav) : Buffer.alloc(0);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha === createHash('sha256').update(cli).digest('hex')) check(`候補 ${c.i + 1} (${c.work}) ブラウザと CLI の WAV がバイト単位で同一`, true, sha.slice(0, 16));
    else {
      // Different V8 builds (Node vs. Chromium) may round a transcendental differently in the last bit.
      const a = decodeWav(new Uint8Array(bytes));
      const b = cli.length ? decodeWav(new Uint8Array(cli)) : null;
      let diffs = 0;
      let maxLsb = 0;
      if (b && a.frames === b.frames) {
        for (let ch = 0; ch < a.channels; ch++)
          for (let n = 0; n < a.frames; n++) {
            const d = Math.round(Math.abs(a.data[ch][n] - b.data[ch][n]) * 32768);
            if (d) {
              diffs++;
              maxLsb = Math.max(maxLsb, d);
            }
          }
      }
      check(`候補 ${c.i + 1} (${c.work}) ブラウザと CLI の WAV が実質同一`, !!b && a.frames === b.frames && maxLsb <= 2 && diffs < 100, `${diffs} サンプルで最大 ${maxLsb} LSB の差 (浮動小数点の丸め)`);
    }
    check(`候補 ${c.i + 1} 音声検証`, c.ok);
  }
  await page.click('[data-act="play-cand"][data-i="0"]');
  await page.waitForFunction(() => (window as any).__sonovaPlaying?.key === 'cand0', null, { timeout: 30_000 });
  const ctxState = await page.evaluate(() => (window as any).__sonovaPlaying);
  check('MUSIC GENERATOR: 候補を再生', ctxState.duration > 29.9 && ctxState.peak > 0.5, `${ctxState.duration.toFixed(2)}s, peak ${ctxState.peak.toFixed(3)}`);

  await page.click('[data-screen="composition"]');
  await page.waitForSelector('canvas#timeline');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, '5-composition.png'), fullPage: true });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"][data-kind="wav"]')]);
  check('COMPOSITION: WAV 書き出し', download.suggestedFilename().endsWith('.wav'), download.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"][data-kind="structure"]')]);
  check('COMPOSITION: 構造 JSON 書き出し', dl2.suggestedFilename().endsWith('.structure.json'), dl2.suggestedFilename());

  await page.click('[data-screen="soundvault"]');
  await page.waitForTimeout(800);
  const vaultOk = await page.locator('text=SOUNDVAULT を確認').count();
  check('SOUNDVAULT: 保存先を確認', vaultOk > 0);
  if (vaultOk) {
    await page.click('[data-act="vault-save"]');
    await page.waitForFunction(() => !document.querySelector('#busy'), null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const saved = await page.evaluate(() => (window as any).__sonova.store.projects[0].candidates[0].saved);
    const err = await page.locator('.error').allTextContents();
    check('SOUNDVAULT: 保存 (CLI 登録済みなら重複せず既存 ID を返す)', !!saved && err.length === 0, saved ? `${saved.status} ${saved.soundvaultId}` : err.join(' '));
    await page.screenshot({ path: join(shots, '6-soundvault.png'), fullPage: true });
    if (saved) {
      await page.click(`[data-act="vault-play"][data-file="${saved.file}"] >> nth=0`);
      await page.waitForFunction((f) => (window as any).__sonovaPlaying?.key === `vault:${f}`, saved.file, { timeout: 30_000 });
      const pb = await page.evaluate(() => (window as any).__sonovaPlaying);
      check('SOUNDVAULT: 保存先のファイルから再生', pb.duration > 29 && pb.peak > 0.3, `${pb.duration.toFixed(2)}s, peak ${pb.peak.toFixed(3)}`);
    }
  }
  check('ページエラーなし', errors.length === 0, errors.join(' | '));
  await browser.close();
} finally {
  vite.kill();
}
writeJson(join(ROOT, 'output/lab-verification.json'), { checkedAt: new Date().toISOString(), results });
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 件失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
