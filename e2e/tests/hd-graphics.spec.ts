import { test, expect, type Browser } from '@playwright/test';
import { assetsPresent } from './helpers';

interface Gfx {
  pref: string;
  scale: number;
  terrain: number;
  atlas(archive: string): number;
}
interface Dbg {
  hqNode: number;
  spriteQuads: number;
  centerNode(node: number): void;
  nodeToScreen(node: number): { x: number; y: number };
  graphics(): Gfx;
}

/** Open a map with a graphics preference at a device pixel ratio. */
async function openWith(browser: Browser, baseURL: string, pref: string | null, dpr: number) {
  const context = await browser.newContext({
    deviceScaleFactor: dpr,
    viewport: { width: 1000, height: 700 },
  });
  if (pref) {
    await context.addInitScript((p) => localStorage.setItem('s2gold.view.graphics', p), pref);
  }
  const page = await context.newPage();
  await page.goto(`${baseURL}/play/maps_miss200`);
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  const info = await page.evaluate(async () => {
    const d = (window as unknown as { __s2debug: Dbg }).__s2debug;
    d.centerNode(d.hqNode);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const g = d.graphics();
    return {
      pref: g.pref,
      scale: g.scale,
      terrain: g.terrain,
      buildings: g.atlas('rom_z'),
      carrier: g.atlas('carrier'),
      objects: g.atlas('mapbobs'),
      hq: d.nodeToScreen(d.hqNode),
      quads: d.spriteQuads,
    };
  });
  return { context, page, info };
}

test('the graphics preference selects the HD set and keeps the layout', async ({
  browser,
  page,
  baseURL,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const original = await openWith(browser, baseURL!, 'original', 2);
  const hd = await openWith(browser, baseURL!, 'hd', 2);

  expect(original.info).toMatchObject({
    scale: 1,
    terrain: 1,
    buildings: 1,
    carrier: 1,
    objects: 1,
  });
  expect(hd.info).toMatchObject({ scale: 2, terrain: 2, buildings: 2, carrier: 2, objects: 2 });
  // Same world, same camera: the same sprites land on the same screen points.
  expect(hd.info.hq).toEqual(original.info.hq);
  expect(hd.info.quads).toBe(original.info.quads);

  await original.page.screenshot({ path: test.info().outputPath('original-dpr2.png') });
  await hd.page.screenshot({ path: test.info().outputPath('hd-dpr2.png') });
  await original.context.close();
  await hd.context.close();
});

test('Auto picks HD on high-density screens only', async ({ browser, page, baseURL }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const low = await openWith(browser, baseURL!, null, 1);
  const high = await openWith(browser, baseURL!, null, 2);
  expect(low.info).toMatchObject({ pref: 'auto', scale: 1, terrain: 1, buildings: 1 });
  expect(high.info).toMatchObject({ pref: 'auto', scale: 2, terrain: 2, buildings: 2 });

  // The Settings toggle cycles the saved preference and flags the reload.
  await high.page.getByTestId('settings-toggle').click();
  const toggle = high.page.getByTestId('graphics-toggle');
  await expect(toggle).toHaveText('Graphics: Auto (HD)');
  await toggle.click();
  await expect(toggle).toHaveText('Graphics: Original (after reload)');
  await toggle.click();
  await expect(toggle).toHaveText('Graphics: HD');
  expect(await high.page.evaluate(() => localStorage.getItem('s2gold.view.graphics'))).toBe('hd');
  await low.context.close();
  await high.context.close();
});

test('the Options screen cycles the graphics preference', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await page.goto('/options');
  const row = page.getByTestId('options-graphics');
  await expect(row).toHaveText(/^Graphics: Auto/);
  await row.click();
  await expect(row).toHaveText('Graphics: Original');
  await row.click();
  await expect(row).toHaveText('Graphics: HD');
  await row.click();
  await expect(row).toHaveText('Graphics: AI remaster');
});

test('AI remaster loads the remastered set where the pipeline built one', async ({
  browser,
  page,
  baseURL,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const manifest = (await (await page.request.get(`${baseURL}/assets/manifest.json`)).json()) as {
    categories: { graphics_ai?: { archives: Record<string, string> } };
  };
  test.skip(!manifest.categories.graphics_ai?.archives.rom_z, 'no AI remaster built for rom_z');
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.addInitScript(() => localStorage.setItem('s2gold.view.graphics', 'ai'));
  const p = await context.newPage();
  const aiAtlas = p.waitForRequest(/graphics\/rom_z\/ai2\/atlas\.json/);
  await p.goto(`${baseURL}/play/maps_miss200`);
  await aiAtlas;
  await expect(p.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  const g = await p.evaluate(() => {
    const d = (window as unknown as { __s2debug: Dbg }).__s2debug;
    const info = d.graphics();
    return { pref: info.pref, scale: info.scale, buildings: info.atlas('rom_z') };
  });
  expect(g).toEqual({ pref: 'ai', scale: 2, buildings: 2 });
  await context.close();
});

test('HD uses the vector menu fonts, Original keeps the bitmap font', async ({
  browser,
  page,
  baseURL,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  for (const [pref, modern] of [
    ['hd', true],
    ['original', false],
  ] as const) {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    await context.addInitScript((p) => localStorage.setItem('s2gold.view.graphics', p), pref);
    const p = await context.newPage();
    await p.goto(`${baseURL}/`);
    const entry = p.getByRole('link', { name: 'Options' });
    await expect(entry).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.classList.contains('font-modern'))).toBe(
      modern,
    );
    // The bitmap canvas is drawn at 1 backing pixel per CSS pixel and scaled
    // pixelated; the vector canvas is backed at the device pixel ratio.
    const ratio = await entry
      .locator('canvas')
      .evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width);
    expect(ratio).toBeCloseTo(modern ? 2 : 1, 1);
    await context.close();
  }
});
