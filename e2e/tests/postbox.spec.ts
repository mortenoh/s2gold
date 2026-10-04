import { test, expect, type Page } from '@playwright/test';
import { assetsPresent } from './helpers';

interface Dbg {
  hqNode: number;
  tick: number;
  nodeOf(x: number, y: number): number;
  canBuild(node: number, type: string): boolean;
  centerNode(node: number): void;
  nodeToScreen(node: number): { x: number; y: number };
}

const dbg = <T>(page: Page, fn: (d: Dbg) => T): Promise<T> =>
  page.evaluate((src) => {
    const d = (window as unknown as { __s2debug: Dbg }).__s2debug;
    return new Function('d', `return (${src})(d);`)(d) as T;
  }, fn.toString());

test('postbox: a finished guardhouse posts a letter that centres the camera', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await page.goto('/play/maps_miss200');
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => (window as unknown as { __s2debug?: Dbg }).__s2debug !== undefined,
  );

  // Empty postbox to start with.
  await expect(page.getByTestId('postbox-badge')).toBeHidden();
  await page.getByTestId('postbox-toggle').click();
  await expect(page.getByTestId('postbox-panel')).toContainText('No messages.');
  await page.getByTestId('postbox-close').click();

  // Instant build (free-play cheat), then place a guardhouse through the build menu.
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('cheat-instant').click();
  await expect(page.getByTestId('cheat-instant')).toHaveText('Instant build: on');
  await page.getByTestId('settings-toggle').click();

  const node = await dbg(page, (d) => {
    const W = d.nodeOf(0, 1);
    const hx = d.hqNode % W;
    const hy = Math.floor(d.hqNode / W);
    for (let r = 3; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const n = d.nodeOf(hx + dx, hy + dy);
          if (n >= 0 && n !== d.hqNode && d.canBuild(n, 'guardhouse')) {
            d.centerNode(n);
            return n;
          }
        }
      }
    }
    return -1;
  });
  expect(node).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(150);
  const at = await page.evaluate(
    (n) => (window as unknown as { __s2debug: Dbg }).__s2debug.nodeToScreen(n),
    node,
  );
  await page.getByTestId('game-canvas').click({ position: at });
  await page.getByTestId('ctx-cat-huts').click();
  await page.getByTestId('ctx-guardhouse').click();
  await page.keyboard.press('Escape');

  // The letter arrives: unread badge on the bar button.
  await expect(page.getByTestId('postbox-badge')).toHaveText('1', { timeout: 15_000 });

  // Look elsewhere, then open the letter: the camera returns to the guardhouse.
  await dbg(page, (d) => d.centerNode(d.nodeOf(40, 40)));
  await page.waitForTimeout(150);
  await page.getByTestId('postbox-toggle').click();
  const item = page.getByTestId('postbox-item').first();
  await expect(item).toHaveText('Guardhouse finished');
  await item.click();
  await page.waitForTimeout(150);
  const after = await page.evaluate((n) => {
    const p = (window as unknown as { __s2debug: Dbg }).__s2debug.nodeToScreen(n);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
    const r = c.getBoundingClientRect();
    return { dx: Math.abs(p.x - r.width / 2), dy: Math.abs(p.y - r.height / 2) };
  }, node);
  expect(after.dx).toBeLessThan(40);
  expect(after.dy).toBeLessThan(60);
  // Read now: the badge goes away.
  await expect(page.getByTestId('postbox-badge')).toBeHidden();
});
