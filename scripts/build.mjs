import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { build } from 'vite';

import { buildNode } from './buildNode.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Production build: React shell via Vite, main + preload via esbuild. */
async function main() {
  const started = Date.now();
  await build({ configFile: resolve(root, 'vite.config.ts') });
  await buildNode();
  console.log(`build finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
