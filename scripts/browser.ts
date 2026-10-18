/** Launch a local Chromium for verification (playwright-core is an optional dependency; no download). */
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

export async function launchBrowser() {
  let pw: typeof import('playwright-core');
  try {
    pw = await import('playwright-core');
  } catch {
    throw new Error('playwright-core が見つかりません (npm install で optionalDependencies を入れてください)');
  }
  const args = ['--autoplay-policy=no-user-gesture-required'];
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter((p): p is string => !!p && existsSync(p));
  if (candidates.length) return pw.chromium.launch({ executablePath: candidates[0], args });
  // Windows / macOS: use the installed Chrome or Edge.
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await pw.chromium.launch({ channel, args });
    } catch {
      /* try next */
    }
  }
  throw new Error('Chromium が見つかりません。CHROMIUM_PATH に Chrome/Edge の実行ファイルを指定してください。');
}

export async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${url}`);
}

export function startProcess(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  child.stderr?.on('data', (d) => process.env.SONOVA_VERBOSE && process.stderr.write(d));
  child.stdout?.on('data', (d) => process.env.SONOVA_VERBOSE && process.stdout.write(d));
  return child;
}
