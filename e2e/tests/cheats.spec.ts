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

  test('instant build finishes a placed building at once', async ({ page }) => {
    await page.goto('/play/maps_miss200');
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(
      () => (window as unknown as { __s2debug?: Dbg }).__s2debug !== undefined,
    );
    await page.getByTestId('settings-toggle').click();
    await page.getByTestId('cheat-instant').click();
    await expect(page.getByTestId('cheat-instant')).toHaveText('Instant build: on');
    await page.getByTestId('settings-toggle').click();
    // Place a woodcutter through the build menu; it must be working within a few ticks.
    const node = await page.evaluate(() => {
      const d = (
        window as unknown as {
          __s2debug: {
            hqNode: number;
            nodeOf(x: number, y: number): number;
            canBuild(n: number, t: string): boolean;
            centerNode(n: number): void;
            nodeToScreen(n: number): { x: number; y: number };
          };
        }
      ).__s2debug;
      const W = d.nodeOf(0, 1);
      const hx = d.hqNode % W;
      const hy = Math.floor(d.hqNode / W);
      for (let r = 2; r <= 6; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const n = d.nodeOf(hx + dx, hy + dy);
            if (n >= 0 && n !== d.hqNode && d.canBuild(n, 'woodcutter')) {
              d.centerNode(n);
              return n;
            }
          }
      return -1;
    });
    expect(node).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(150);
    const pos = await page.evaluate(
      (n) =>
        (
          window as unknown as { __s2debug: { nodeToScreen(n: number): { x: number; y: number } } }
        ).__s2debug.nodeToScreen(n),
      node,
    );
    await page.getByTestId('game-canvas').click({ position: pos });
    await page.getByTestId('ctx-cat-huts').click();
    await page.getByTestId('ctx-woodcutter').click();
    await page.keyboard.press('Escape');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __s2debug: { counters: { buildingsCompleted: number } } })
                .__s2debug.counters.buildingsCompleted,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(1);
  });

  test('campaign chapters hide the cheat row', async ({ page }) => {
    await page.goto('/play/maps_miss200?campaign=1');
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('objectives-toggle')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-toggle').click();
    await expect(page.getByTestId('cheat-row')).toBeHidden();
  });
});
