import { test, expect } from '@playwright/test';
import { assetsPresent } from './helpers';

/**
 * The desktop shell's native Game menu reaches the page as `menu-action`
 * events on the Tauri global. A stub global stands in for the shell so the
 * frontend side (quicksave, quickload, reload) is exercised in the browser.
 */
const TAURI_STUB = `
  window.__menuHandlers = [];
  window.__TAURI__ = {
    core: { invoke: async () => undefined },
    event: { listen: async (name, cb) => { window.__menuHandlers.push([name, cb]); return () => {}; } },
  };
  window.__fireMenu = (id) => { for (const [name, cb] of window.__menuHandlers) if (name === 'menu-action') cb({ payload: id }); };
`;

test.describe('desktop Game menu actions', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await assetsPresent(page)), 'converted assets not installed');
    await page.addInitScript(TAURI_STUB);
  });

  test('quicksave and quickload are driven by menu-action events', async ({ page }) => {
    const res = await page.request.get('/api/saves');
    test.skip(
      !(res.ok() && (res.headers()['content-type'] ?? '').includes('json')),
      'API server not running',
    );
    await page.goto('/play/maps_miss201');
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(
      () => ((window as unknown as { __s2debug?: { tick: number } }).__s2debug?.tick ?? 0) > 20,
    );

    const before = await page.evaluate(
      () => (window as unknown as { __s2debug: { tick: number } }).__s2debug.tick,
    );
    await page.evaluate(() =>
      (window as unknown as { __fireMenu: (id: string) => void }).__fireMenu('quicksave'),
    );
    await expect(page.getByTestId('save-toast')).toContainText('Saved to tray');
    // Let the world run on, then quickload jumps back to the saved tick.
    await page.waitForFunction(
      (t) => (window as unknown as { __s2debug: { tick: number } }).__s2debug.tick > t + 60,
      before,
    );
    await page.evaluate(() =>
      (window as unknown as { __fireMenu: (id: string) => void }).__fireMenu('quickload'),
    );
    await expect(page.getByTestId('save-toast')).toContainText('Loaded "');
    const after = await page.evaluate(
      () => (window as unknown as { __s2debug: { tick: number } }).__s2debug.tick,
    );
    expect(after).toBeLessThan(before + 60);

    // Clean up the quicksave tray this test created.
    const saves = (await (await page.request.get('/api/saves')).json()) as {
      id: string;
      name: string;
    }[];
    for (const s of saves)
      if (s.name.endsWith('quicksave') && s.id.startsWith('maps_miss201_'))
        await page.request.delete(`/api/saves/${s.id}`);
  });

  test('reload re-reads the menu screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('title-panel')).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __reloadMarker: boolean }).__reloadMarker = true;
    });
    await page.evaluate(() =>
      (window as unknown as { __fireMenu: (id: string) => void }).__fireMenu('reload'),
    );
    await page.waitForLoadState('load');
    await expect(page.getByTestId('title-panel')).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __reloadMarker?: boolean }).__reloadMarker),
    ).toBeUndefined();
  });
});
