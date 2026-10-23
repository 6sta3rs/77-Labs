import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { aiDevelopmentServer } from '../tools/dev/ai-dev.ts';

// The interface lives in frontend/; the build goes back to the repository's dist/ (Tauri's frontendDist) and
// public/ stays at the root. Run it through the npm scripts, which pass --config.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [svelte(), aiDevelopmentServer()],
  server: {
    // Native builds and QA runtimes contain thousands of generated files.
    // Watching them can swamp HMR while testing the desktop application.
    watch: { ignored: ['**/desktop/target/**', '**/.tmp/**'] },
    proxy: { '/backend': {
      target: 'http://127.0.0.1:4312',
      ws: true,
      rewrite: (path) => path.replace(/^\/backend/, '')
    } }
  }
});
