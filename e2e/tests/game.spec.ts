import { expect, test, type Page } from '@playwright/test';

interface S2Debug {
  staticObjects: number;
  trees: number;
  granite: number;
  decorations: number;
  skipped: number;
  spriteQuads: number;
  spriteDrawCalls: number;
}

const SCREENSHOT_DIR =
  '/private/tmp/claude-502/-Users-morteoh-dev-local-s2gold/' +
  'bb77c315-f7af-4a5f-a4d3-fe7955aadc74/scratchpad/p2';

async function readDebug(page: Page): Promise<S2Debug> {
  return page.evaluate(() => {
    const dbg = (window as unknown as { __s2debug?: S2Debug }).__s2debug;
    if (!dbg) throw new Error('window.__s2debug missing');
    return dbg;
  });
}

/**
 * P1 gate: the game page renders a map's terrain via WebGL2, survives map
 * switching, and never throws. Tests skip gracefully when converted assets
 * are absent (CI without the GOG installer).
 */

async function assetsPresent(page: Page): Promise<boolean> {
  const res = await page.request.get('/assets/maps/index.json');
  return res.ok();
}

/**
 * Sample the WebGL canvas (preserveDrawingBuffer is on) through a 2D canvas
 * and return the number of distinct colors plus the non-black pixel ratio.
 */
async function sampleCanvas(page: Page): Promise<{ distinct: number; nonBlack: number }> {
  return page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    if (!gl) throw new Error('game canvas not found');
    const probe = document.createElement('canvas');
    const w = (probe.width = Math.min(320, gl.width));
    const h = (probe.height = Math.min(200, gl.height));
    const ctx = probe.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(gl, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const colors = new Set<number>();
    let nonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      colors.add((r << 16) | (g << 8) | b);
      if (r + g + b > 24) nonBlack++;
    }
    return { distinct: colors.size, nonBlack: nonBlack / (w * h) };
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('game page renders MISS200 terrain without errors', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps_miss200');
  await expect(page.getByTestId('map-title')).toHaveText('I - Off we go');

  // Give the render loop a few frames, then check the canvas is non-blank.
  await page.waitForTimeout(300);
  const sample = await sampleCanvas(page);
  expect(sample.distinct, 'expected a rich terrain image').toBeGreaterThan(32);
  expect(sample.nonBlack, 'expected mostly non-black pixels').toBeGreaterThan(0.5);

  // Minimap is drawn too.
  const minimapBlank = await page.evaluate(() => {
    const mm = document.querySelector<HTMLCanvasElement>('[data-testid="minimap"]');
    if (!mm) return true;
    const ctx = mm.getContext('2d');
    if (!ctx) return true;
    const data = ctx.getImageData(0, 0, mm.width, mm.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 24) lit++;
    }
    return lit < (data.length / 4) * 0.5;
  });
  expect(minimapBlank, 'minimap should be mostly lit').toBe(false);

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('scrolling and zooming keep the canvas non-blank', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });

  // Drag far enough to cross the wrap seam on a 64x64 map (3584 world px).
  const canvas = page.getByTestId('game-canvas');
  for (let i = 0; i < 3; i++) {
    await canvas.hover({ position: { x: 600, y: 300 } });
    await page.mouse.down();
    await page.mouse.move(100, 250, { steps: 5 });
    await page.mouse.up();
  }
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowDown');

  await page.getByTestId('zoom-toggle').click();
  await expect(page.getByTestId('zoom-toggle')).toHaveText('Zoom 2x');
  await page.waitForTimeout(200);

  // After panning the view may sit over open ocean (MISS200 is mostly water),
  // so only require a textured, non-blank image rather than a rich palette.
  const sample = await sampleCanvas(page);
  expect(sample.distinct).toBeGreaterThan(8);
  expect(sample.nonBlack).toBeGreaterThan(0.5);
  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('switching maps keeps rendering', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });

  // Pick a different map than the default campaign one.
  const options = page.getByTestId('map-select').locator('option');
  const values = await options.evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
  const target = values.find((v) => v !== 'maps_miss200');
  test.skip(!target, 'only one converted map available');

  await page.getByTestId('map-select').selectOption(target ?? '');
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', target ?? '', {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);

  const sample = await sampleCanvas(page);
  expect(sample.distinct).toBeGreaterThan(32);
  expect(sample.nonBlack).toBeGreaterThan(0.5);
  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('MISS200 scene contains trees and granite, rendered over terrain', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps_miss200');

  // The object layer decoded trees, granite and decorations from the map.
  const dbg = await readDebug(page);
  expect(dbg.trees, 'MISS200 should have trees').toBeGreaterThan(50);
  expect(dbg.granite, 'MISS200 should have granite').toBeGreaterThan(0);
  expect(dbg.staticObjects, 'objects should be registered for drawing').toBeGreaterThan(0);

  // Let a few animation frames run, then confirm sprites are actually drawn in
  // the viewport (camera starts over player 1's HQ, which is surrounded by
  // trees) with the expected single-atlas draw-call batching.
  await page.waitForTimeout(500);
  const drawn = await readDebug(page);
  expect(drawn.spriteQuads, 'sprites visible near the HQ').toBeGreaterThan(0);
  expect(drawn.spriteDrawCalls, 'one draw call per atlas page').toBeLessThanOrEqual(2);

  // Save a reference screenshot of terrain WITH trees/granite.
  await page.getByTestId('game-canvas').screenshot({
    path: `${SCREENSHOT_DIR}/miss200-objects-1x.png`,
  });
  // And a 2x zoom to read tree size against the 56px terrain lattice.
  await page.getByTestId('zoom-toggle').click();
  await page.waitForTimeout(300);
  await page.getByTestId('game-canvas').screenshot({
    path: `${SCREENSHOT_DIR}/miss200-objects-2x.png`,
  });

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});
