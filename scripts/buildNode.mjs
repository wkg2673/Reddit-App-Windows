import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundles Electron main process and preload script with esbuild. */
export async function buildNode({ watch = false } = {}) {
  const { build, context } = await import('esbuild');

  /** @type {import('esbuild').BuildOptions} */
  const options = {
    entryPoints: [resolve(root, 'electron/main.ts'), resolve(root, 'electron/preload.ts')],
    outdir: resolve(root, 'dist/main'),
    entryNames: '[name]',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    // Electron is provided by the runtime, never bundled.
    external: ['electron'],
    sourcemap: process.env.SOURCEMAP === '1',
    minify: process.env.NODE_ENV === 'production',
    logLevel: 'info',
  };

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    return ctx;
  }

  await build(options);
}
