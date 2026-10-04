import { test, expect, type Browser } from '@playwright/test';
import { assetsPresent } from './helpers';

interface Dbg {
  hqNode: number;
  nodeOf(x: number, y: number): number;
  centerNode(node: number): void;
  nodeToScreen(node: number): { x: number; y: number };
}

/** Screen (CSS px) offsets of nodes around the HQ, with the HQ centred. */
async function layoutAt(browser: Browser, baseURL: string, dpr: number) {
  const context = await browser.newContext({
    deviceScaleFactor: dpr,
    viewport: { width: 1000, height: 700 },
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/play/maps_miss200`);
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  const out = await page.evaluate(() => {
    const d = (window as unknown as { __s2debug: Dbg }).__s2debug;
    const W = d.nodeOf(0, 1);
    const hx = d.hqNode % W;
    const hy = Math.floor(d.hqNode / W);
    d.centerNode(d.hqNode);
    const hq = d.nodeToScreen(d.hqNode);
    const east = d.nodeToScreen(d.nodeOf(hx + 2, hy));
    const south = d.nodeToScreen(d.nodeOf(hx, hy + 2));
    return { hq, dx: east.x - hq.x, dy: south.y - hq.y };
  });
  return { page, context, out };
}

test('zoom 1 shows the same layout in screen points at dpr 1 and 2', async ({
  browser,
  page,
  baseURL,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const one = await layoutAt(browser, baseURL!, 1);
  const two = await layoutAt(browser, baseURL!, 2);
  // Two lattice columns are 2 x 56 world px; at zoom 1 that is 112 screen points
  // whatever the display density (it used to be 56 points on a dpr-2 screen).
  expect(one.out.dx).toBeCloseTo(112, 0);
  expect(two.out.dx).toBeCloseTo(112, 0);
  expect(two.out.dy).toBeCloseTo(one.out.dy, 0);
  expect(two.out.hq.x).toBeCloseTo(one.out.hq.x, 0);
  expect(two.out.hq.y).toBeCloseTo(one.out.hq.y, 0);

  // A click at the HQ's screen point still lands on the HQ at dpr 2.
  await two.page.getByTestId('game-canvas').click({ position: two.out.hq });
  await expect(two.page.getByTestId('goods-panel')).toBeVisible();
  await one.context.close();
  await two.context.close();
});
