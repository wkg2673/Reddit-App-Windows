import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createServer } from 'vite';

import { buildNode } from './buildNode.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Development launcher: Vite dev server + esbuild watch + Electron. */
async function main() {
  const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
  await server.listen();

  const address = server.resolvedUrls?.local?.[0];
  if (!address) throw new Error('Vite dev server did not report a local address');
  const devServerUrl = address.replace(/\/$/, '');
  console.log(`[dev] renderer served from ${devServerUrl}`);

  const ctx = await buildNode({ watch: true });
  console.log('[dev] main + preload bundling');

  const electronBinary = (await import('electron')).default;
  const child = spawn(electronBinary, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl, REDDIT_DESKTOP_DEV: '1' },
  });

  const shutdown = async (code = 0) => {
    if (!child.killed) child.kill();
    await ctx.dispose();
    await server.close();
    process.exit(code);
  };

  child.on('close', (code) => void shutdown(code ?? 0));
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
