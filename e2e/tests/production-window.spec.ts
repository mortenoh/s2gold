import { test, expect, type Page } from '@playwright/test';
import { assetsPresent } from './helpers';

/**
 * The production building window: opens on a click at an own building, shows
 * the construction state and later the stock, and Stop production really halts
 * the building (no new trunks) until resumed.
 */

interface Dbg {
  hqNode: number;
  counters: { trunksProduced: number; buildingsCompleted: number };
  nodeOf(x: number, y: number): number;
  canBuild(node: number, type: string): boolean;
  flagNodeOf(node: number): number;
  nodeToScreen(node: number): { x: number; y: number };
  centerNode(node: number): void;
  tick: number;
}

const dbg = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __s2debug: Dbg }).__s2debug;
    return {
      tick: d.tick,
      trunks: d.counters.trunksProduced,
      completed: d.counters.buildingsCompleted,
    };
  });

async function clickNode(page: Page, node: number): Promise<void> {
  await page.evaluate(
    (n) => (window as unknown as { __s2debug: Dbg }).__s2debug.centerNode(n),
    node,
  );
  await page.waitForTimeout(100);
  const pos = await page.evaluate(
    (n) => (window as unknown as { __s2debug: Dbg }).__s2debug.nodeToScreen(n),
    node,
  );
  await page.getByTestId('game-canvas').click({ position: pos });
}

async function setSpeed(page: Page, speed: number): Promise<void> {
  await page.getByTestId('speed-select').click();
  await page.locator(`.dropdown-list.speed-select [data-value="${speed}"]`).click();
}

test('production window: site, then stock, stop and resume', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await page.goto('/play/maps_miss200');
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => (window as unknown as { __s2debug?: Dbg }).__s2debug !== undefined,
  );
  await page.getByTestId('pause-toggle').click();

  // Place a woodcutter near the HQ through the build menu and road it up.
  const plan = await page.evaluate(() => {
    const d = (window as unknown as { __s2debug: Dbg }).__s2debug;
    const W = d.nodeOf(0, 1);
    const hx = d.hqNode % W;
    const hy = Math.floor(d.hqNode / W);
    for (let r = 2; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const n = d.nodeOf(hx + dx, hy + dy);
          if (n >= 0 && n !== d.hqNode && d.canBuild(n, 'woodcutter'))
            return { node: n, hqFlag: d.flagNodeOf(d.hqNode) };
        }
      }
    }
    return { node: -1, hqFlag: -1 };
  });
  expect(plan.node).toBeGreaterThanOrEqual(0);
  await clickNode(page, plan.node);
  await page.getByTestId('ctx-cat-huts').click();
  await page.getByTestId('ctx-woodcutter').click();
  // Placement enters road mode from the site flag: connect to the HQ flag.
  await clickNode(page, plan.hqFlag);

  // Clicking the site opens the window in its construction state.
  await clickNode(page, plan.node);
  const panel = page.getByTestId('production-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('production-title')).toContainText('Woodcutter');
  await expect(page.getByTestId('production-title')).toContainText('Under construction');
  await expect(page.getByTestId('production-materials')).toContainText('Boards 0/');
  await page.getByTestId('production-close').click();
  await expect(panel).toHaveCount(0);

  // Let it get built and staffed.
  await page.getByTestId('pause-toggle').click();
  await setSpeed(page, 50);
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: Dbg }).__s2debug.counters.buildingsCompleted >= 1,
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: Dbg }).__s2debug.counters.trunksProduced >= 2,
    null,
    { timeout: 90_000 },
  );

  // Working building: output line and the Stop production toggle.
  await clickNode(page, plan.node);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('production-title')).toContainText('Yours');
  await expect(page.getByTestId('production-output')).toContainText('Makes Wood');
  await page.getByTestId('production-toggle').click();
  await expect(page.getByTestId('production-toggle')).toHaveText('Resume production');
  await expect(page.getByTestId('production-status')).toContainText(/stopp/);

  // Once the cycle in flight has finished, no more trunks appear.
  await page.waitForTimeout(3000);
  const stopped = await dbg(page);
  await page.waitForTimeout(6000);
  const later = await dbg(page);
  expect(later.tick).toBeGreaterThan(stopped.tick + 1000);
  expect(later.trunks).toBe(stopped.trunks);

  // Resume: production continues.
  await page.getByTestId('production-toggle').click();
  await expect(page.getByTestId('production-toggle')).toHaveText('Stop production');
  await page.waitForFunction(
    (n) => (window as unknown as { __s2debug: Dbg }).__s2debug.counters.trunksProduced > n,
    later.trunks,
    { timeout: 60_000 },
  );

  // Demolish from the window removes the building and closes the panel.
  await page.getByTestId('production-demolish').click();
  await expect(panel).toHaveCount(0);
  await clickNode(page, plan.node);
  await expect(page.getByTestId('production-panel')).toHaveCount(0);
});
