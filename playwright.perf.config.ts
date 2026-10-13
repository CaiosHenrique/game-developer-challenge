import { defineConfig } from '@playwright/test';

/**
 * Performance and memory audit (`npm run perf`), separate from the end-to-end suite: one test
 * at a time, no retries, and a fresh e2e build served on its own port. The e2e build is the
 * minified production build plus the test hooks needed to read entity counts and finish
 * matches (see docs/perf/README.md).
 */

const PORT = 4174;

// Same browser choice as playwright.config.ts: Edge on Windows (Smart App Control blocks
// Playwright's own Chromium there), overridable with PW_CHANNEL.
const envChannel = process.env.PW_CHANNEL;
const channel =
  envChannel === 'chromium'
    ? undefined
    : (envChannel ?? (process.platform === 'win32' ? 'msedge' : undefined));

export default defineConfig({
  testDir: './e2e/perf',
  testMatch: /\.perf\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 40 * 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    // Main measurement: a visible window, with the GPU the system provides.
    { name: 'edge-headed', use: { headless: false } },
    // Secondary reference: headless (may render in software); never compared with headed.
    { name: 'edge-headless', use: { headless: true } },
  ],
  webServer: {
    command: `npm run build:e2e && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
