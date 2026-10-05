import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const target of ['dist', 'release']) {
  await rm(resolve(root, target), { recursive: true, force: true });
}
console.log('removed dist/ and release/');
