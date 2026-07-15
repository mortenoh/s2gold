import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * True when the converted GOG assets are installed (CI runners without the
 * installer have none). Tests that need real assets skip themselves on false.
 */
export async function assetsPresent(page: Page): Promise<boolean> {
  const res = await page.request.get('/assets/maps/index.json');
  // The Vite dev server answers missing files with the SPA index.html fallback
  // (status 200, text/html) — require real JSON or the guard false-positives
  // on runners without assets and the tests run instead of skipping.
  return res.ok() && (res.headers()['content-type'] ?? '').includes('json');
}

/**
 * Benign console noise: missing optional assets (404s for /assets/*) must not
 * fail menu/smoke tests while converters land. Genuine JS errors always fail.
 */
export function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text().toLowerCase();
  return (
    text.includes('/assets/') ||
    text.includes('manifest.json') ||
    text.includes('failed to load resource') ||
    text.includes('404')
  );
}

/** The app's campaign-progress localStorage key (menu/campaign-data.ts). */
export const CAMPAIGN_PROGRESS_KEY = 's2gold.campaign.progress';
