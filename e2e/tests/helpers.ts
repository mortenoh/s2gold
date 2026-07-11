import type { Page } from '@playwright/test';

/**
 * True when the converted GOG assets are installed (CI runners without the
 * installer have none). Tests that need real assets skip themselves on false.
 */
export async function assetsPresent(page: Page): Promise<boolean> {
  const res = await page.request.get('/assets/maps/index.json');
  return res.ok();
}
