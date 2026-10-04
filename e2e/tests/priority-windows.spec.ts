import { test, expect } from '@playwright/test';
import { assetsPresent } from './helpers';

interface Dbg {
  priorities(): { transport: string[]; toolWeights: Record<string, number> };
}

const prios = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __s2debug: Dbg }).__s2debug.priorities());

test.describe('Transport and Tools windows', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await assetsPresent(page)), 'converted assets not installed');
    await page.goto('/play/maps_miss200');
    await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(
      () => (window as unknown as { __s2debug?: Dbg }).__s2debug !== undefined,
    );
  });

  test('transport order moves a ware up and the engine follows', async ({ page }) => {
    const before = await prios(page);
    expect(before.transport[0]).toBe('coins');
    expect(before.transport[1]).toBe('plank');
    await page.getByTestId('transport-toggle').click();
    await expect(page.getByTestId('transport-panel')).toBeVisible();
    await expect(page.getByTestId('transport-up-coins')).toBeDisabled();
    await page.getByTestId('transport-up-plank').click();
    // Commands apply on the next tick; the list re-renders from the engine.
    await expect
      .poll(async () => (await prios(page)).transport.slice(0, 2).join(','))
      .toBe('plank,coins');
    // The window re-renders from the engine on its refresh interval.
    const rows = () =>
      page
        .locator('[data-testid=transport-list] .priority-row')
        .evaluateAll((es) => es.map((e) => e.getAttribute('data-ware')));
    await expect.poll(async () => (await rows()).slice(0, 2)).toEqual(['plank', 'coins']);
    expect((await rows()).length).toBe(before.transport.length);
    await page.getByTestId('transport-close').click();
    await expect(page.getByTestId('transport-panel')).toHaveCount(0);
  });

  test('tool weights change the metalworks cycle list', async ({ page }) => {
    const before = await prios(page);
    expect(before.toolWeights.saw).toBe(1);
    await page.getByTestId('tools-toggle').click();
    await expect(page.getByTestId('tools-panel')).toBeVisible();
    await page.getByTestId('tools-inc-saw').click();
    await expect.poll(async () => (await prios(page)).toolWeights.saw).toBe(2);
    await expect(page.getByTestId('tools-weight-saw')).toHaveText('2');
    await page.getByTestId('tools-dec-axe').click();
    await expect.poll(async () => (await prios(page)).toolWeights.axe).toBe(0);
    await expect(page.getByTestId('tools-dec-axe')).toBeDisabled();
    // Weights never exceed the cap, and the other tools are untouched.
    const after = await prios(page);
    expect(after.toolWeights.hammer).toBe(1);
    await page.getByTestId('tools-close').click();
  });
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
]) {
  test(`priority rows do not overlap at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.skip(!(await assetsPresent(page)), 'converted assets not installed');
    await page.setViewportSize(viewport);
    await page.goto('/play/maps_miss200');
    await expect(page.locator('body[data-map-ready]')).toBeAttached();
    for (const mode of ['transport', 'tools']) {
      await page.getByTestId(`${mode}-toggle`).click();
      const panel = page.getByTestId(`${mode}-panel`);
      await expect(panel).toBeVisible();
      await panel.screenshot({ path: `test-results/shots/${mode}-${viewport.width}.png` });
      const layout = await panel.evaluate((p) => {
        const rows = [...p.querySelectorAll<HTMLElement>('.priority-row')];
        const bounds = p.getBoundingClientRect();
        return {
          inside:
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            bounds.top >= 0 &&
            bounds.bottom <= innerHeight,
          rowsFit: rows.every((row, i) => {
            const r = row.getBoundingClientRect();
            const next = rows[i + 1]?.getBoundingClientRect();
            return (
              (!next || r.bottom <= next.top) &&
              [...row.querySelectorAll('button, .priority-label')].every((child) => {
                const c = child.getBoundingClientRect();
                return c.top >= r.top && c.bottom <= r.bottom && c.right <= r.right;
              })
            );
          }),
        };
      });
      expect(layout.inside).toBe(true);
      expect(layout.rowsFit, 'each label and button must stay inside its own row').toBe(true);
      const last = panel.locator('.priority-row').last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await page.getByTestId(`${mode}-close`).click();
    }
  });
}
