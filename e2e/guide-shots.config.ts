import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone Playwright config for the player-guide screenshot generator
 * (`pnpm guide:shots`). It is deliberately separate from `playwright.config.ts`
 * so the normal `pnpm e2e` gate never collects these captures — they are a
 * documentation tool, not a test of behaviour.
 *
 * It reuses the same dev web server the e2e suite uses (Vite on 5199), so a
 * plain `pnpm guide:shots` boots the app on its own. Screenshots contain
 * original game art and are written to the git-ignored `docs/guide-shots/`.
 */
const PORT = 5199;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'guide-shots.ts',
  // Captures share a running world and lay out a settlement step by step, so
  // run them serially (and give each a generous budget for the 50x sim waits).
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm --filter app dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
