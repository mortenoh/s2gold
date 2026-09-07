import { test, expect, type Page } from '@playwright/test';
import { assetsPresent } from './helpers';

/** True when the Rust API server answers (saves need it). */
async function apiUp(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/saves');
  return res.ok() && (res.headers()['content-type'] ?? '').includes('json');
}

// A map no other spec saves on: parallel workers share the API server.
const MAP = 'maps_miss208';
const SAVE_ID = `${MAP}_slot9`;

test.describe('Load game (title menu)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await assetsPresent(page)), 'converted assets not installed');
    test.skip(!(await apiUp(page)), 'API server not running');
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete(`/api/saves/${SAVE_ID}`);
  });

  test('lists server saves and boots the chosen one into the game', async ({ page }) => {
    // Seed a real save by playing a few ticks and saving through the API shape
    // the game uses: capture a live snapshot from a fresh game first.
    await page.goto(`/play/${MAP}`);
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(
      () => ((window as unknown as { __s2debug?: { tick: number } }).__s2debug?.tick ?? 0) > 20,
    );
    await page.getByTestId('menu-toggle').click();
    await page.getByTestId('save-name').fill('e2e load probe');
    // Tray 10 is the seeded slot (index 9): click its empty tray.
    await page.locator('[data-testid=save-tray][data-slot="9"]').click();
    await expect(page.getByTestId('save-toast')).toContainText('Saved to tray 10');
    const tickAtSave = await page.evaluate(
      () => (window as unknown as { __s2debug: { tick: number } }).__s2debug.tick,
    );

    // Title: Load game is a live link now.
    await page.goto('/');
    const entry = page.getByTestId('menu-loadgame');
    await expect(entry).toHaveAttribute('href', '/load');
    await entry.click();
    await expect(page).toHaveURL(/\/load$/);
    await expect(page.getByTestId('load-heading')).toBeVisible();
    const item = page.locator(`[data-testid=load-item][data-save-id="${SAVE_ID}"]`);
    await expect(item).toBeVisible();
    await expect(item).toContainText('10. e2e load probe');

    // Clicking boots the map and loads that save.
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/play/${MAP}\\?save=${SAVE_ID}$`));
    await expect(page.getByTestId('save-toast')).toContainText('Loaded "e2e load probe"', {
      timeout: 15_000,
    });
    const tickAfterLoad = await page.evaluate(
      () => (window as unknown as { __s2debug: { tick: number } }).__s2debug.tick,
    );
    // The loaded world resumes from the saved tick, not from a fresh start.
    expect(tickAfterLoad).toBeGreaterThanOrEqual(tickAtSave);
    expect(tickAfterLoad).toBeLessThan(tickAtSave + 2000);
  });

  test('without any saves the list says so', async ({ page }) => {
    const res = await page.request.get('/api/saves');
    const saves = (await res.json()) as { id: string }[];
    test.skip(saves.length > 0, 'other saves exist on this server');
    await page.goto('/load');
    await expect(page.getByTestId('load-empty')).toBeVisible();
  });
});
