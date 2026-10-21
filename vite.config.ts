import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { aiDevelopmentServer } from './scripts/dev/ai-dev.ts';

export default defineConfig({
  plugins: [svelte(), aiDevelopmentServer()],
  server: {
    // Native builds and QA runtimes contain thousands of generated files.
    // Watching them can swamp HMR while testing the desktop application.
    watch: { ignored: ['**/src-tauri/target/**', '**/.tmp/**'] },
    proxy: { '/backend': {
      target: 'http://127.0.0.1:4312',
      ws: true,
      rewrite: (path) => path.replace(/^\/backend/, '')
    } }
  }
});
