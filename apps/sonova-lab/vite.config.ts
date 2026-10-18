import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');

/** SOUNDVAULT location: env SOUNDVAULT_DIR → sonova.config.local.json → sibling ../soundvault. */
export function soundvaultDir(): string {
  if (process.env.SOUNDVAULT_DIR) return resolve(process.env.SOUNDVAULT_DIR);
  const cfg = join(repoRoot, 'sonova.config.local.json');
  if (existsSync(cfg)) {
    const dir = JSON.parse(readFileSync(cfg, 'utf8')).soundvaultDir;
    if (dir) return resolve(repoRoot, dir);
  }
  return resolve(repoRoot, '../soundvault');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200 * 1024 * 1024) throw new Error('request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

/**
 * Local-only API used by the SOUNDVAULT screen while `npm run dev` runs.
 * Nothing is exposed in the static build; the dev server listens on localhost by default.
 */
function sonovaLocalApi(): Plugin {
  return {
    name: 'sonova-local-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          // Imported lazily so the adapter (Node fs/child_process) never enters the browser bundle.
          const adapter = await server.ssrLoadModule('@sonova/soundvault-adapter');
          const registryPath = join(repoRoot, 'compositions/soundvault-registry.json');
          if (req.method === 'GET' && req.url === '/api/soundvault/status') {
            const dir = soundvaultDir();
            const info = existsSync(dir) ? adapter.inspectVault(dir) : { dir, ok: false, problems: ['SOUNDVAULT が見つかりません。SOUNDVAULT_DIR か sonova.config.local.json で場所を指定してください。'] };
            return send(res, 200, { vault: info, registry: adapter.readRegistry(registryPath), ffmpeg: adapter.ffmpegAvailable() });
          }
          if (req.method === 'POST' && req.url === '/api/soundvault/register') {
            const body = JSON.parse(await readBody(req));
            const meta = body.meta;
            if (!/^SONOVA-[A-Z]+-[A-Z0-9]+$/.test(meta?.workNumber ?? '')) return send(res, 400, { error: '作品番号が不正です' });
            // Keep the original WAV in SONOVA first; it survives any registration failure.
            const wavPath = join(repoRoot, 'output/lab', `${meta.workNumber}.wav`);
            mkdirSync(dirname(wavPath), { recursive: true });
            writeFileSync(wavPath, Buffer.from(body.wavBase64, 'base64'));
            const result = adapter.registerAsset({
              vaultDir: soundvaultDir(),
              wavPath,
              meta,
              backupDir: join(repoRoot, 'output/soundvault-backups'),
              expectations: body.expectations,
            });
            if (result.status !== 'dry-run') {
              adapter.upsertRegistry(registryPath, {
                workNumber: meta.workNumber,
                title: meta.title,
                type: meta.type,
                soundvaultId: result.soundvaultId,
                file: result.file,
                format: result.format,
                wavSha256: result.wavSha256,
                fileSha256: result.fileSha256,
                registeredAt: new Date().toISOString(),
                vaultGitHead: adapter.inspectVault(soundvaultDir()).gitHead,
              });
            }
            return send(res, 200, { result: { ...result, record: undefined }, wavPath });
          }
          return send(res, 404, { error: 'not found' });
        } catch (err) {
          return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      // Serve registered SOUNDVAULT audio for in-app playback checks.
      server.middlewares.use('/soundvault-files', (req, res, next) => {
        const path = resolve(soundvaultDir(), 'public', `.${decodeURIComponent(req.url ?? '')}`);
        if (!path.startsWith(resolve(soundvaultDir(), 'public')) || !existsSync(path)) return next();
        res.setHeader('Content-Type', path.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav');
        res.end(readFileSync(path));
      });
    },
  };
}

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [sonovaLocalApi()],
  server: { fs: { allow: [repoRoot] } },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
