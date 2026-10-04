import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const API_DATA = mkdtempSync(join(tmpdir(), 's2gold-e2e-'));
const PORT = Number(process.env.S2GOLD_E2E_PORT ?? 5299);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless Chromium suspends AudioContext when the host audio device
          // is unavailable or busy, which makes the P2 gate's "context running
          // after gesture" assertion flake with the machine's audio state.
          // Removing the gesture requirement makes resume() deterministic; the
          // game's unlock-on-gesture path is still exercised by the test flow.
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
  webServer: {
    command: `node ../scripts/dev.mjs --port ${PORT} --strictPort`,
    env: {
      S2GOLD_PORT: process.env.S2GOLD_E2E_API_PORT ?? '8299',
      S2GOLD_DB_PATH: join(API_DATA, 'saves.db'),
      S2GOLD_SAVES_DIR: join(API_DATA, 'legacy-saves'),
      S2GOLD_SESSIONS_DIR: join(API_DATA, 'legacy-sessions'),
    },
    url: BASE_URL,
    reuseExistingServer: false,
    // The launcher owns separate process groups for cargo/server and Vite.
    // Give it SIGTERM so it can reap them before Playwright resorts to SIGKILL.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 180_000,
  },
});
