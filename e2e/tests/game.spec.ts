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

const P2FINAL_DIR =
  '/private/tmp/claude-502/-Users-morteoh-dev-local-s2gold/' +
  'bb77c315-f7af-4a5f-a4d3-fe7955aadc74/scratchpad/p2final';

const P3_DIR =
  '/private/tmp/claude-502/-Users-morteoh-dev-local-s2gold/' +
  'bb77c315-f7af-4a5f-a4d3-fe7955aadc74/scratchpad/p3';

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

// --- P2 gate: play the wood/plank economy through the real UI ---------------

interface P2Counters {
  treesFelled: number;
  trunksProduced: number;
  planksProduced: number;
  buildingsCompleted: number;
  waresDelivered: number;
}

/** Read the P2 debug view (counters + entity tallies). */
async function readGame(page: Page): Promise<{
  tick: number;
  flags: number;
  buildings: number;
  roads: number;
  settlers: number;
  counters: P2Counters;
}> {
  return page.evaluate(() => {
    const d = (window as unknown as { __s2debug?: Record<string, unknown> }).__s2debug;
    if (!d) throw new Error('window.__s2debug missing');
    return {
      tick: d.tick as number,
      flags: d.flags as number,
      buildings: d.buildings as number,
      roads: d.roads as number,
      settlers: d.settlers as number,
      counters: d.counters as unknown as P2Counters,
    };
  });
}

/** CSS-px position (relative to the canvas) of a lattice node's ground anchor. */
async function nodeScreen(page: Page, node: number): Promise<{ x: number; y: number }> {
  return page.evaluate((n) => {
    const d = (window as unknown as { __s2debug?: { nodeToScreen(n: number): { x: number; y: number } } }).__s2debug;
    if (!d) throw new Error('no debug');
    return d.nodeToScreen(n);
  }, node);
}

/** Click the canvas at a node's screen position (real pointer path). */
async function clickNode(page: Page, node: number): Promise<void> {
  const pos = await nodeScreen(page, node);
  await page.getByTestId('game-canvas').click({ position: pos });
}

test('P2 gate: build a wood/plank economy via the UI and watch it run', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  // This test lays out the economy, runs it at 10x until the loop closes, and
  // additionally exercises P3 audio + captures P3 screenshots, so it needs more
  // than the default 30s budget.
  test.setTimeout(75_000);
  const errors = collectErrors(page);

  await page.goto('/game.html?map=maps_miss200');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps_miss200');

  // Pause the sim while we lay out buildings so placement stays deterministic.
  await page.getByTestId('pause-toggle').click();
  await expect(page.getByTestId('pause-toggle')).toHaveText('Resume');

  // Choose valid sites near the HQ using the exposed query helpers, then place
  // everything by clicking the map and its context menus (the real UI path).
  const plan = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __s2debug: {
          hqNode: number;
          nodeOf(x: number, y: number): number;
          flagNodeOf(node: number): number;
          canBuild(node: number, type: string): boolean;
          canFlag(node: number): boolean;
        };
      }
    ).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    const firstBuildable = (type: string, cx: number, cy: number, r: number): number => {
      for (let rr = 2; rr <= r; rr++) {
        for (let dy = -rr; dy <= rr; dy++) {
          for (let dx = -rr; dx <= rr; dx++) {
            const node = d.nodeOf(cx + dx, cy + dy);
            if (node !== hq && d.canBuild(node, type)) return node;
          }
        }
      }
      return -1;
    };
    const wcNode = firstBuildable('woodcutter', hx - 3, hy - 1, 5);
    const smNode = firstBuildable('sawmill', hx - 1, hy + 1, 5);
    // A free flag near the HQ (the "place a flag near HQ" step).
    let nearFlag = -1;
    for (let rr = 2; rr <= 4 && nearFlag < 0; rr++) {
      for (let dx = 2; dx <= rr && nearFlag < 0; dx++) {
        const node = d.nodeOf(hx + dx, hy);
        if (node !== wcNode && node !== smNode && d.canFlag(node)) nearFlag = node;
      }
    }
    return {
      hqFlag: d.flagNodeOf(hq),
      wcNode,
      smNode,
      wcFlag: d.flagNodeOf(wcNode),
      smFlag: d.flagNodeOf(smNode),
      nearFlag,
    };
  });
  expect(plan.wcNode, 'a woodcutter site exists near HQ').toBeGreaterThanOrEqual(0);
  expect(plan.smNode, 'a sawmill site exists near HQ').toBeGreaterThanOrEqual(0);
  expect(plan.nearFlag, 'a free flag spot exists near HQ').toBeGreaterThanOrEqual(0);

  // 1) Place a flag near the HQ via the context menu.
  await clickNode(page, plan.nearFlag);
  await page.getByTestId('ctx-flag').click();

  // 2) Road HQ flag -> the new flag (real road mode: menu action, then click).
  await clickNode(page, plan.hqFlag);
  await page.getByTestId('ctx-build').click(); // "Build road"
  await clickNode(page, plan.nearFlag);

  // 3) Place the woodcutter and the sawmill via their build menus.
  await clickNode(page, plan.wcNode);
  await page.getByTestId('ctx-woodcutter').click();
  await clickNode(page, plan.smNode);
  await page.getByTestId('ctx-sawmill').click();

  // Let the placement commands apply so the auto-flags exist for roading.
  await page.getByTestId('pause-toggle').click(); // resume
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: { flags: number } }).__s2debug.flags >= 4,
    undefined,
    { timeout: 5000 },
  );

  // 4) Road the network together: near-flag -> sawmill -> woodcutter.
  await clickNode(page, plan.nearFlag);
  await page.getByTestId('ctx-build').click();
  await clickNode(page, plan.smFlag);
  await clickNode(page, plan.smFlag);
  await page.getByTestId('ctx-build').click();
  await clickNode(page, plan.wcFlag);

  await page.waitForFunction(
    () => (window as unknown as { __s2debug: { roads: number } }).__s2debug.roads >= 3,
    undefined,
    { timeout: 5000 },
  );

  // P3: construction sites (skeleton + rising building) with builders/workers
  // walking to them, wearing their profession overlays.
  await page.getByTestId('game-canvas').screenshot({ path: `${P3_DIR}/p3-construction-workers.png` });

  // P3: enabling audio via a real click unlocks the AudioContext. The clicks
  // above already dispatched pointerdown, so the context should be live.
  const audioAfterClick = await page.evaluate(() => {
    const d = (window as unknown as { __s2debug: { audio: { contextState: string } } }).__s2debug;
    return d.audio.contextState;
  });
  expect(audioAfterClick, 'AudioContext created after a user gesture').not.toBe('none');

  // Background music is a real <audio> element on the page.
  expect(await page.locator('audio').count(), 'a music audio element exists').toBeGreaterThan(0);

  // 5) Run at 10x and watch the economy loop close.
  await page.getByTestId('speed-10').click();
  await expect(page.getByTestId('speed-10')).toHaveClass(/active/);

  await page.waitForFunction(
    () => {
      const c = (window as unknown as { __s2debug: { counters: P2Counters } }).__s2debug.counters;
      return (
        c.treesFelled >= 1 &&
        c.trunksProduced >= 1 &&
        c.planksProduced >= 1 &&
        c.buildingsCompleted >= 2
      );
    },
    undefined,
    { timeout: 45_000 },
  );

  const game = await readGame(page);
  expect(game.counters.treesFelled, 'a tree was felled').toBeGreaterThanOrEqual(1);
  expect(game.counters.trunksProduced, 'a trunk was produced').toBeGreaterThanOrEqual(1);
  expect(game.counters.planksProduced, 'a plank reached the sawmill and was cut').toBeGreaterThanOrEqual(1);
  expect(game.counters.buildingsCompleted, 'construction sites completed').toBeGreaterThanOrEqual(2);
  expect(game.settlers, 'carriers/workers are active').toBeGreaterThan(0);

  // P3: during the 10x economy run, worker-action events drove the audio engine
  // to request (and decode) at least one SFX buffer, and the context is live.
  await page.waitForFunction(
    () => {
      const a = (
        window as unknown as { __s2debug: { audio: { sfxRequested: number } } }
      ).__s2debug.audio;
      return a.sfxRequested >= 1;
    },
    undefined,
    { timeout: 15_000 },
  );
  const audioDbg = await page.evaluate(
    () =>
      (
        window as unknown as {
          __s2debug: { audio: { contextState: string; sfxRequested: number; buffersLoaded: number } };
        }
      ).__s2debug.audio,
  );
  expect(audioDbg.contextState, 'AudioContext running after gesture').toBe('running');
  expect(audioDbg.sfxRequested, 'an SFX buffer was requested during play').toBeGreaterThanOrEqual(1);

  // Mid-game screenshot showing buildings + carriers on roads.
  await page.getByTestId('game-canvas').screenshot({ path: `${P2FINAL_DIR}/p2-economy-1x.png` });
  await page.getByTestId('zoom-toggle').click();
  await page.waitForTimeout(400);
  await page.getByTestId('game-canvas').screenshot({ path: `${P2FINAL_DIR}/p2-economy-2x.png` });

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
  // the viewport (camera starts over player 0's HQ, surrounded by trees). Since
  // P2 adds the HQ + flag (rom_z) and settler (carrier) atlases on top of the
  // map objects (mapbobs), the scene now spans a few atlas pages that painter's
  // order interleaves; batching still collapses the hundreds of tree quads into
  // far fewer draw calls than quads.
  await page.waitForTimeout(500);
  const drawn = await readDebug(page);
  expect(drawn.spriteQuads, 'sprites visible near the HQ').toBeGreaterThan(0);
  expect(drawn.spriteDrawCalls, 'draw calls batched well below quad count').toBeLessThan(
    Math.max(16, drawn.spriteQuads / 4),
  );

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
