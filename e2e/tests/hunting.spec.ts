import { test, expect, type Page } from '@playwright/test';
import { assetsPresent } from './helpers';
import type { S2Debug } from '../../packages/app/src/game/debug-surface';

async function clickNode(page: Page, node: number): Promise<void> {
  await page.evaluate((n) => window.__s2debug!.centerNode(n), node);
  const pos = await page.evaluate((n) => window.__s2debug!.nodeToScreen(n), node);
  await page.getByTestId('game-canvas').click({ position: pos });
}
async function speed(page: Page, value: number): Promise<void> {
  await page.getByTestId('speed-select').click();
  await page.locator(`.dropdown-list.speed-select [data-value="${value}"]`).click();
}

test('hunter is built through the UI, hunts map wildlife, and brings it home', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Chapter I deliberately has no wildlife. Stage one stag near the HQ in
  // its map response to test hunting with the real renderer, roads and economy.
  await page.route('**/assets/maps/maps_miss200.json', async (route) => {
    const response = await route.fetch();
    const map = await response.json();
    map.animals = [{ species: 3, x: map.hq_x[0] + 3, y: map.hq_y[0] - 2 }];
    await route.fulfill({ response, json: map });
  });
  await page.goto('/play/maps_miss200');
  await expect(page.locator('body[data-map-ready]')).toBeAttached();
  await page.getByTestId('pause-toggle').click();
  const plan = await page.evaluate(() => {
    const d: S2Debug = window.__s2debug!;
    const width = d.nodeOf(0, 1);
    const x = d.hqNode % width,
      y = Math.floor(d.hqNode / width);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const n = d.nodeOf(x + dx, y + dy);
        if (d.canBuild(n, 'hunter') && d.suggestRoad(d.flagNodeOf(n), d.flagNodeOf(d.hqNode)))
          return { node: n, flag: d.flagNodeOf(d.hqNode) };
      }
    throw new Error('no road-connectable hunter site');
  });
  expect(await page.evaluate(() => window.__s2debug!.wildlife().length)).toBe(1);
  await clickNode(page, plan.node);
  await page.getByTestId('ctx-cat-huts').click();
  await page.getByTestId('ctx-hunter').click();
  await clickNode(page, plan.flag);
  await speed(page, 10);
  await page.getByTestId('pause-toggle').click();
  await page.waitForFunction(() =>
    window
      .__s2debug!.outdoorWorkers()
      .some((w) => w.job === 'builder' && w.state === 'working' && w.workProgress >= 10),
  );
  await page.getByTestId('pause-toggle').click();
  await page
    .getByTestId('game-canvas')
    .screenshot({ path: 'test-results/shots/hunting/builder.png' });
  await page.getByTestId('pause-toggle').click();
  await page.waitForFunction(() =>
    window.__s2debug!.outdoorWorkers().some((w) => w.job === 'hunter' && w.state === 'working'),
  );
  await page.getByTestId('pause-toggle').click();
  const hunter = await page.evaluate(() =>
    window.__s2debug!.outdoorWorkers().find((w) => w.job === 'hunter' && w.state === 'working')!,
  );
  await page.evaluate((n) => window.__s2debug!.centerNode(n), hunter.node);
  await page
    .getByTestId('game-canvas')
    .screenshot({ path: 'test-results/shots/hunting/hunter.png' });
  await page.getByTestId('pause-toggle').click();
  await page.waitForFunction(() => window.__s2debug!.wildlife().length === 0);
  await page.waitForFunction(
    (node) =>
      window
        .__s2debug!.outdoorWorkers()
        .some((w) => w.job === 'hunter' && w.node === node && w.state === 'idle'),
    plan.node,
  );
  expect(errors).toEqual([]);
});
