import { expect, test, type ConsoleMessage } from '@playwright/test';

/**
 * Benign console noise: missing optional assets (404s for /assets/*) must not
 * fail the menu tests while converters land. Genuine JS errors always fail.
 */
function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text().toLowerCase();
  return (
    text.includes('/assets/') ||
    text.includes('manifest.json') ||
    text.includes('failed to load resource') ||
    text.includes('status of 404') ||
    text.includes('404')
  );
}

test('title screen renders the menu without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenign(msg)) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');

  await expect(page.getByTestId('title-panel')).toBeVisible();
  await expect(page.getByTestId('menu-list')).toBeVisible();

  // The four expected entries, in their enabled/disabled states.
  await expect(page.getByTestId('menu-freeplay')).toBeVisible();
  await expect(page.getByTestId('menu-inspector')).toBeVisible();
  await expect(page.getByTestId('menu-campaign')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('menu-loadgame')).toHaveAttribute('aria-disabled', 'true');

  expect(errors, `unexpected console errors: ${errors.join('\n')}`).toEqual([]);
});

test('free play flows to setup, lists maps, and starts a game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');
  await page.getByTestId('menu-freeplay').click();

  // Landed on the setup page.
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByTestId('setup-panel')).toBeVisible();

  // Maps are listed and the first one auto-selects (preview + enabled start).
  const items = page.getByTestId('map-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(0);
  await expect(page.getByTestId('minimap')).toBeVisible();

  const start = page.getByTestId('start-game');
  await expect(start).toBeEnabled();
  const mapName = await start.getAttribute('data-map');
  expect(mapName, 'start button carries the selected map name').toBeTruthy();

  await start.click();

  // Landed on the game page for the chosen map, with the canvas present. A
  // multi-player map defaults slot 1 to Computer, so the URL may carry ?ai=…
  await expect(page).toHaveURL(new RegExp(`/play/${mapName}(\\?ai=[0-9,]+)?$`));
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('a specific map can be selected and previewed', async ({ page }) => {
  await page.goto('/setup');
  await expect(page.getByTestId('map-list')).toBeVisible();

  const second = page.getByTestId('map-item').nth(1);
  const name = await second.getAttribute('data-map');
  await second.click();

  await expect(second).toHaveClass(/active/);
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('start-game')).toHaveAttribute('data-map', name ?? '');
});
