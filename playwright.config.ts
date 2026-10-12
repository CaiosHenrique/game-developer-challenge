import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

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
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 720 } },
    },
  ],
  // Tests run against a production build with test hooks (--mode e2e) and the real MSW worker.
  webServer: {
    command: 'npm run build:e2e && npm run preview',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
