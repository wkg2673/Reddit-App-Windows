import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = resolve(process.cwd());

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  // Relative asset URLs so the bundle works from the `app://` protocol too.
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: process.env.SOURCEMAP === '1',
    chunkSizeWarningLimit: 1024,
  },
});
