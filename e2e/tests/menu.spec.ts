import { expect, test } from '@playwright/test';
import { assetsPresent, isBenign } from './helpers';

test('title screen renders the menu without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenign(msg)) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');

  await expect(page.getByTestId('title-panel')).toBeVisible();
  await expect(page.getByTestId('menu-list')).toBeVisible();

  // The expected entries in the original's order and enabled/disabled states.
  await expect(page.getByTestId('menu-campaign')).toBeVisible();
  await expect(page.getByTestId('menu-campaign')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('menu-worldcampaign')).toBeVisible();
  await expect(page.getByTestId('menu-resume')).toBeVisible();
  await expect(page.getByTestId('menu-loadgame')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('menu-freeplay')).toBeVisible();
  await expect(page.getByTestId('menu-options')).toBeVisible();
  await expect(page.getByTestId('menu-intro')).toBeVisible();
  await expect(page.getByTestId('menu-credits')).toBeVisible();
  // The dev Asset inspector is hidden unless the dev flag is set.
  await expect(page.getByTestId('menu-inspector')).toHaveCount(0);

  expect(errors, `unexpected console errors: ${errors.join('\n')}`).toEqual([]);
});

test('free play flows to setup, lists maps, and starts a game', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

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
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

  await page.goto('/setup');
  await expect(page.getByTestId('map-list')).toBeVisible();

  const second = page.getByTestId('map-item').nth(1);
  const name = await second.getAttribute('data-map');
  await second.click();

  await expect(second).toHaveClass(/active/);
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('start-game')).toHaveAttribute('data-map', name ?? '');
});

test('options screen renders its settings and Back returns to the title', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/options');
  await expect(page.getByTestId('options-panel')).toBeVisible();
  await expect(page.getByTestId('options-music')).toBeVisible();
  await expect(page.getByTestId('options-sfx-volume')).toBeVisible();

  // Cycling a volume persists to the shared audio key.
  const before = await page.getByTestId('options-sfx-volume').textContent();
  await page.getByTestId('options-sfx-volume').click();
  const after = await page.getByTestId('options-sfx-volume').textContent();
  expect(after).not.toBe(before);

  await page.getByTestId('options-back').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('title-panel')).toBeVisible();

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('credits screen pages through the original credit banks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/credits');
  await expect(page.getByTestId('credits-panel')).toBeVisible();
  await expect(page.getByTestId('credits-back')).toBeVisible();

  // With converted assets the banks yield named pages; Next advances.
  const hasAssets = await (async () => {
    const res = await page.request.get('/assets/texts/eng/txt2_credit01.json');
    return res.ok();
  })();
  if (hasAssets) {
    await expect(page.getByTestId('credits-name')).toBeVisible();
    const first = await page.getByTestId('credits-name').textContent();
    await page.getByTestId('credits-next').click();
    await expect(page.getByTestId('credits-name')).not.toHaveText(first ?? '');
  }

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});
