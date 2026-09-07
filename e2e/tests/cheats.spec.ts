import { test, expect } from '@playwright/test';
import { assetsPresent } from './helpers';

interface Dbg {
  cheatUnlimited(): boolean;
  tick: number;
}

test.describe('unlimited-resources cheat', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  });

  test('free play: the Settings toggle fills the warehouse', async ({ page }) => {
    await page.goto('/play/maps_miss200');
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(
      () => (window as unknown as { __s2debug?: Dbg }).__s2debug !== undefined,
    );
    await page.getByTestId('settings-toggle').click();
    await expect(page.getByTestId('cheat-row')).toBeVisible();
    const toggle = page.getByTestId('cheat-unlimited');
    await expect(toggle).toHaveText('Unlimited resources: off');
    await toggle.click();
    await expect(toggle).toHaveText('Unlimited resources: on');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __s2debug: Dbg }).__s2debug.cheatUnlimited()),
      )
      .toBe(true);
    // The HUD Goods window shows the topped-up stock (gold starts at 0).
    await page.getByTestId('settings-toggle').click();
    await page.getByTestId('goods-toggle').click();
    await expect
      .poll(async () => Number(await page.getByTestId('goods-gold').innerText()))
      .toBeGreaterThanOrEqual(99);
    await page.getByTestId('goods-close').click();
    // Off again.
    await page.getByTestId('settings-toggle').click();
    await toggle.click();
    await expect(toggle).toHaveText('Unlimited resources: off');
  });

  test('campaign chapters hide the cheat row', async ({ page }) => {
    await page.goto('/play/maps_miss200?campaign=1');
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('objectives-toggle')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-toggle').click();
    await expect(page.getByTestId('cheat-row')).toBeHidden();
  });
});
