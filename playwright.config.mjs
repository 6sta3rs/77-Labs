// Browser smoke and accessibility scan of the built interface against a mocked runtime API (no engine, no network).
// Needs `npm run build` first; `npx playwright install chromium` once. Run: npm run test:e2e
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4320', browserName: 'chromium', locale: 'pl-PL', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npx vite preview --config frontend/vite.config.ts --host 127.0.0.1 --port 4320 --strictPort',
    url: 'http://127.0.0.1:4320',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
