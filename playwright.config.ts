import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** Development build of the e2e app (React Strict Mode really double-mounts there). */
const STRICT_PORT = 4175;

// Windows Smart App Control blocks Playwright's unsigned Chromium build, so on Windows the
// tests run on the installed (signed) Microsoft Edge, which uses the same Chromium engine.
// Override with PW_CHANNEL (e.g. PW_CHANNEL=chromium or PW_CHANNEL=chrome).
const envChannel = process.env.PW_CHANNEL;
const channel =
  envChannel === 'chromium'
    ? undefined
    : (envChannel ?? (process.platform === 'win32' ? 'msedge' : undefined));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  // A missing visual baseline fails the test instead of being written as a new one. Baselines
  // are only written on purpose, with --update-snapshots (see docs/TESTING.md).
  updateSnapshots: 'none',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: [/\.mobile\.spec\.ts$/, /\.strict\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 720 } },
    },
    {
      // A phone held in landscape (the supported orientation): touch, coarse pointer.
      name: 'chromium-mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7 landscape'], channel },
    },
    {
      // React's development build, where <StrictMode> mounts, unmounts and remounts every
      // effect: the production build used by the other projects never does.
      name: 'chromium-strict',
      testMatch: /\.strict\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        channel,
        viewport: { width: 1280, height: 720 },
        baseURL: `http://localhost:${STRICT_PORT}`,
      },
    },
  ],
  // Tests run against a production build with test hooks (--mode e2e) and the real MSW worker;
  // the chromium-strict project against a development build of the same app (dist-e2e-dev/).
  // Playwright starts the servers one after the other, so the two builds never overlap.
  webServer: [
    {
      command: 'npm run build:e2e && npm run preview',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run build:e2e:dev && npx vite preview --outDir dist-e2e-dev --port ${STRICT_PORT} --strictPort`,
      url: `http://localhost:${STRICT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
