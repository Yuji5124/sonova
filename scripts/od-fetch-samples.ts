/**
 * Download the orchestral samples used by SONOVA — ORCHESTRA × DIGITAL:
 * Versilian Studios Chamber Orchestra 2 Community Edition (CC0 1.0), https://github.com/sgossner/VSCO-2-CE
 * Only the folders the engine uses are fetched (sparse, blob-less clone, pinned commit). Needs git ≥ 2.27.
 *   npm run od:fetch            → vendor/VSCO-2-CE
 * Works on Windows, macOS and Linux. Nothing is executed from the downloaded data.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY_FOLDERS } from '@sonova/orchestra-engine';
import { ROOT } from './lib.ts';

const REPO = 'https://github.com/sgossner/VSCO-2-CE';
const COMMIT = '440300901dfe9275fd84e0b7763af1f8443ae62e'; // master, 2020-08-04
const dir = process.env.VSCO_DIR ?? join(ROOT, 'vendor', 'VSCO-2-CE');
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });

mkdirSync(dir, { recursive: true });
if (!existsSync(join(dir, '.git'))) {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', '--sparse', REPO, dir], { stdio: 'inherit' });
}
git('sparse-checkout', 'set', '--no-cone', '/LICENSE', '/README.md', ...LIBRARY_FOLDERS.map((f) => `/${f}/`));
git('checkout', COMMIT);
writeFileSync(join(dir, 'SONOVA-SOURCE.txt'), `${REPO} @ ${COMMIT}\nLicence: CC0 1.0 Universal (see LICENSE)\nFolders: ${LIBRARY_FOLDERS.join(', ')}\n`);
console.log(`VSCO-2-CE ready in ${dir}`);
