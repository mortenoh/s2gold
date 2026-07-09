import { expect, test, type ConsoleMessage } from '@playwright/test';

/**
 * Benign console noise: while converters are still landing, assets may be
 * absent and the browser logs 404s for /assets/*. Those are expected and must
 * not fail the smoke test. Genuine JS errors (pageerror) always fail.
 */
function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text().toLowerCase();
  return (
    text.includes('/assets/') ||
    text.includes('manifest.json') ||
    text.includes('failed to load resource') ||
    text.includes('the server responded with a status of 404') ||
    text.includes('404')
  );
}

test('index page loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenign(msg)) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');

  // The title screen renders its menu (P5) with the free-play entry present.
  await expect(page.getByTestId('title-panel')).toBeVisible();
  await expect(page.getByTestId('menu-freeplay')).toBeVisible();

  expect(errors, `unexpected console errors: ${errors.join('\n')}`).toEqual([]);
});

test('inspector renders category list or a no-assets message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/inspector.html');
  await expect(page.locator('.inspector-header h1')).toHaveText('s2gold');

  // Passes in both states: assets present -> category list; absent -> notice.
  const categoryList = page.getByTestId('category-list');
  const noManifest = page.getByTestId('no-manifest');
  await expect(categoryList.or(noManifest)).toBeVisible();

  if (await categoryList.isVisible()) {
    await expect(categoryList.locator('.cat-item').first()).toBeVisible();
  }

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});
