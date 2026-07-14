import { expect, test, type Page } from '@playwright/test';
import { assetsPresent } from './helpers';

interface S2Debug {
  staticObjects: number;
  trees: number;
  granite: number;
  decorations: number;
  skipped: number;
  spriteQuads: number;
  spriteDrawCalls: number;
}

const SCREENSHOT_DIR = 'test-results/shots/p2';

const P2FINAL_DIR = 'test-results/shots/p2final';

const P3_DIR = 'test-results/shots/p3';

const P4_DIR = 'test-results/shots/p4app';

const P4UI_DIR = 'test-results/shots/p4ui';

const P6UI_DIR = 'test-results/shots/p6ui';

const P7_DIR = 'test-results/shots/p7sea';

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

/** Turn fog of war off (it defaults on for a new game in P4). */
async function disableFog(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __s2debug?: { setFog(on: boolean): void } }).__s2debug?.setFog(false);
  });
}

/** Pick a game speed via the HUD speed dropdown (custom dropdown, not a select). */
async function setGameSpeed(page: Page, speed: number): Promise<void> {
  await page.getByTestId('speed-select').click();
  // The open list is portalled to <body> and carries the `speed-select` modifier
  // class on the list element itself (compound selector, not a descendant).
  await page.locator(`.dropdown-list.speed-select [data-value="${speed}"]`).click();
  await expect(page.getByTestId('speed-select')).toHaveText(`${speed}x`);
}

test('game page renders MISS200 terrain without errors', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps_miss200');
  await expect(page.getByTestId('map-title')).toHaveText('I - Off we go');

  // Fog of war defaults ON (P4); disable it so this terrain-coverage check sees
  // the whole viewport rather than the unexplored black beyond the HQ's sight.
  await disableFog(page);

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
  await disableFog(page); // P4 fog defaults on; this pans over unexplored land.

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

  // Pick a different map than the default campaign one (custom dropdown; the
  // map picker now lives inside the Settings panel).
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('map-select').click();
  const options = page.locator('.dropdown-list [role="option"]');
  const values = await options.evaluateAll((opts) =>
    opts.map((o) => (o as HTMLElement).dataset.value ?? ''),
  );
  const target = values.find((v) => v && v !== 'maps_miss200');
  test.skip(!target, 'only one converted map available');

  await page.locator(`.dropdown-list [data-value="${target ?? ''}"]`).click();
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', target ?? '', {
    timeout: 15_000,
  });
  await disableFog(page); // fresh map re-enables fog; disable for the coverage check.
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
    const d = (
      window as unknown as { __s2debug?: { nodeToScreen(n: number): { x: number; y: number } } }
    ).__s2debug;
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

  // 3) Place the woodcutter and the sawmill via their build menus: open the
  // size-class flyout, then pick the building. Placing a building auto-enters
  // road mode from the new site's flag (original behavior); this scripted flow
  // builds its roads explicitly below, so exit road mode with Escape after
  // each placement.
  await clickNode(page, plan.wcNode);
  await page.getByTestId('ctx-cat-huts').click();
  await page.getByTestId('ctx-woodcutter').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await clickNode(page, plan.smNode);
  await page.getByTestId('ctx-cat-houses').click();
  await page.getByTestId('ctx-sawmill').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');

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
  await page
    .getByTestId('game-canvas')
    .screenshot({ path: `${P3_DIR}/p3-construction-workers.png` });

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
  await setGameSpeed(page, 10);

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
  expect(
    game.counters.planksProduced,
    'a plank reached the sawmill and was cut',
  ).toBeGreaterThanOrEqual(1);
  expect(game.counters.buildingsCompleted, 'construction sites completed').toBeGreaterThanOrEqual(
    2,
  );
  expect(game.settlers, 'carriers/workers are active').toBeGreaterThan(0);

  // P3: during the 10x economy run, worker-action events drove the audio engine
  // to request (and decode) at least one SFX buffer, and the context is live.
  await page.waitForFunction(
    () => {
      const a = (window as unknown as { __s2debug: { audio: { sfxRequested: number } } }).__s2debug
        .audio;
      return a.sfxRequested >= 1;
    },
    undefined,
    { timeout: 15_000 },
  );
  const audioDbg = await page.evaluate(
    () =>
      (
        window as unknown as {
          __s2debug: {
            audio: { contextState: string; sfxRequested: number; buffersLoaded: number };
          };
        }
      ).__s2debug.audio,
  );
  if (audioDbg.contextState !== 'running') {
    // The game's context can sit "suspended" for a host-side reason: when the
    // machine's audio device is unavailable (in a call, device switching, some
    // CI runners) Chromium cannot start ANY context. Distinguish that from a
    // real unlock bug by probing a bare context: if the bare one cannot run
    // either, audio is host-unavailable and the state assertion is meaningless
    // here (the sfx-pipeline assertions below still run); if the bare one runs
    // while the game's does not, the game's unlock is broken - fail.
    const bareState = await page.evaluate(async () => {
      const ctx = new AudioContext();
      try {
        await Promise.race([
          ctx.resume(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
      } catch {
        /* keep whatever state we ended in */
      }
      const state = ctx.state;
      void ctx.close();
      return state;
    });
    if (bareState === 'running') {
      // The host CAN run audio, so the game's context being suspended has one
      // innocent explanation left: the audio device recovered after the test's
      // last gesture, so unlock() never got a chance to retry resume(). Fire
      // one fresh gesture (unlock listens on window pointerdown) and re-read
      // before declaring the unlock path broken.
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(250);
      const retried = await page.evaluate(
        () =>
          (window as unknown as { __s2debug: { audio: { contextState: string } } }).__s2debug.audio
            .contextState,
      );
      expect(retried, 'AudioContext running after gesture').toBe('running');
    } else {
      test.info().annotations.push({
        type: 'audio-host-unavailable',
        description: `game context ${audioDbg.contextState}, bare probe ${bareState}`,
      });
    }
  }
  expect(audioDbg.sfxRequested, 'an SFX buffer was requested during play').toBeGreaterThanOrEqual(
    1,
  );

  // Mid-game screenshot showing buildings + carriers on roads.
  await page.getByTestId('game-canvas').screenshot({ path: `${P2FINAL_DIR}/p2-economy-1x.png` });
  await page.getByTestId('zoom-toggle').click();
  await page.waitForTimeout(400);
  await page.getByTestId('game-canvas').screenshot({ path: `${P2FINAL_DIR}/p2-economy-2x.png` });

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

// --- P4 gate: expanded build menu + save/load -------------------------------

/** True when the saves API is reachable through the dev proxy. */
async function savesApiUp(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get('/api/saves');
    return res.ok();
  } catch {
    return false;
  }
}

/** A flat node near the HQ where a house-size building can be placed. */
async function buildableNode(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __s2debug: {
          hqNode: number;
          nodeOf(x: number, y: number): number;
          canBuild(node: number, type: string): boolean;
        };
      }
    ).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    for (let rr = 2; rr <= 8; rr++) {
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const node = d.nodeOf(hx + dx, hy + dy);
          // A sawmill is house-size; if it fits here, huts/houses/castles do too.
          if (node !== hq && d.canBuild(node, 'sawmill')) return node;
        }
      }
    }
    return -1;
  });
}

test('P4: expanded build menu lists buildings by size class with costs', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html?map=maps_miss200');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await page.getByTestId('pause-toggle').click(); // freeze so the site stays valid

  const node = await buildableNode(page);
  expect(node, 'a house-size build site exists near HQ').toBeGreaterThanOrEqual(0);

  // Open the node context menu (the grouped build menu with category flyouts).
  const pos = await page.evaluate((n) => {
    const d = (
      window as unknown as { __s2debug: { nodeToScreen(n: number): { x: number; y: number } } }
    ).__s2debug;
    return d.nodeToScreen(n);
  }, node);
  await page.getByTestId('game-canvas').click({ position: pos });

  const menu = page.getByTestId('ctx-menu');
  await expect(menu).toBeVisible();

  // Size-class categories are offered as flyout triggers.
  await expect(menu.getByTestId('ctx-cat-huts')).toBeVisible();
  await expect(menu.getByTestId('ctx-cat-houses')).toBeVisible();

  // Open every category flyout and collect the building labels. The submenu is
  // a separate floating element (data-testid ctx-submenu), replaced on each
  // trigger click so only one is visible at a time.
  const triggers = menu.locator('.ctx-cat-trigger');
  const labels: string[] = [];
  for (let i = 0; i < (await triggers.count()); i++) {
    await triggers.nth(i).click();
    const submenu = page.getByTestId('ctx-submenu');
    await expect(submenu).toBeVisible();
    labels.push(...(await submenu.locator('button[data-testid^="ctx-"]').allTextContents()));
  }

  // Every building shows a cost like "(2 boards, 3 stone)"; more than 10 offered.
  const withCost = labels.filter((t) => /\(\d+ (board|stone)/.test(t));
  expect(withCost.length, `build menu lists many buildings: ${labels.join(', ')}`).toBeGreaterThan(
    10,
  );

  // The classic P2 buildings live in their size-class flyouts.
  await menu.getByTestId('ctx-cat-huts').click();
  await expect(page.getByTestId('ctx-woodcutter')).toBeVisible();
  await menu.getByTestId('ctx-cat-houses').click();
  await expect(page.getByTestId('ctx-sawmill')).toBeVisible();

  await page.getByTestId('game-canvas').screenshot({ path: `${P4_DIR}/build-submenu.png` });
  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('P4: road-build preview activates for a valid destination and clears on Esc', async ({
  page,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  const errors = collectErrors(page);

  await page.goto('/game.html?map=maps_miss200');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await page.getByTestId('pause-toggle').click();

  // Origin = HQ flag; a reachable free node a few steps east is a valid dest.
  const spots = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __s2debug: {
          hqNode: number;
          nodeOf(x: number, y: number): number;
          flagNodeOf(n: number): number;
          canFlag(n: number): boolean;
          suggestRoad(a: number, b: number): number[] | null;
          nodeToScreen(n: number): { x: number; y: number };
        };
      }
    ).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    const hqFlag = d.flagNodeOf(hq);
    let valid = -1;
    for (let dx = 3; dx <= 7 && valid < 0; dx++) {
      const n = d.nodeOf(hx + dx, hy);
      if (n !== hqFlag && d.canFlag(n) && d.suggestRoad(hqFlag, n)) valid = n;
    }
    return { hqFlag, valid, sHqFlag: d.nodeToScreen(hqFlag), sValid: d.nodeToScreen(valid) };
  });
  expect(spots.valid, 'a valid road destination exists near HQ').toBeGreaterThanOrEqual(0);

  // Enter road mode from the HQ flag, then hover the destination.
  await page.getByTestId('game-canvas').click({ position: spots.sHqFlag });
  await page.getByTestId('ctx-build').click();
  await page.mouse.move(spots.sValid.x, spots.sValid.y, { steps: 6 });

  // The preview reports a valid, path-backed destination at the hovered node.
  await page.waitForFunction(
    (node) => {
      const rp = (
        window as unknown as {
          __s2debug: { roadPreview(): { node: number; valid: boolean; hasPath: boolean } | null };
        }
      ).__s2debug.roadPreview();
      return rp !== null && rp.valid && rp.hasPath && rp.node === node;
    },
    spots.valid,
    { timeout: 3000 },
  );

  // Esc exits road mode and clears the preview.
  await page.keyboard.press('Escape');
  const cleared = await page.evaluate(() => {
    return (window as unknown as { __s2debug: { roadPreview(): unknown } }).__s2debug.roadPreview();
  });
  expect(cleared, 'preview cleared after Esc').toBeNull();
  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('P4: save appears in the load list and can be deleted', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

  await page.goto('/game.html?map=maps_miss200');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  test.skip(!(await savesApiUp(page)), 'saves API not reachable (FastAPI server offline)');

  // Open the Menu overlay.
  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('save-panel')).toBeVisible();

  // Save under a unique name so the assertion is unambiguous across runs.
  const name = `e2e save ${Date.now()}`;
  await page.getByTestId('save-name').fill(name);
  await page.getByTestId('save-submit').click();

  // The save shows up in the load list for this map.
  const item = page.getByTestId('save-item').filter({ hasText: name });
  await expect(item).toBeVisible({ timeout: 5000 });
  await expect(item).toContainText('tick');

  // Clean up: delete it and confirm it leaves the list.
  await item.getByTestId('save-delete').click();
  await expect(page.getByTestId('save-item').filter({ hasText: name })).toHaveCount(0, {
    timeout: 5000,
  });
});

test('save trays: eleven fixed slots, save into one, load and delete it', async ({ page }) => {
  await page.goto('/game.html?map=maps_miss200');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  test.skip(!(await savesApiUp(page)), 'saves API not reachable (FastAPI server offline)');

  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('save-panel')).toBeVisible();

  // Clear any prior trays for this map so the count is deterministic.
  for (const del of await page.getByTestId('save-delete').all()) {
    await del.click();
    await page.waitForTimeout(150);
  }

  // Eleven trays total (empty + filled), matching the original dialog.
  await expect(page.getByTestId('save-tray').or(page.getByTestId('save-item'))).toHaveCount(11);

  // Saving into the first empty tray fills it, leaving ten empty.
  const name = `tray save ${Date.now()}`;
  await page.getByTestId('save-name').fill(name);
  await page.getByTestId('save-submit').click();
  const filled = page.getByTestId('save-item').filter({ hasText: name });
  await expect(filled).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('save-tray')).toHaveCount(10);

  // Delete it: back to eleven empty trays.
  await filled.getByTestId('save-delete').click();
  await expect(page.getByTestId('save-tray')).toHaveCount(11, { timeout: 5000 });
});

// --- P4 military gate: scripted two-player battle ---------------------------

/** The military-relevant slice of window.__s2debug the battle test drives. */
interface S2Military {
  players: number;
  hqNode: number;
  counters: Record<string, number>;
  nodeOf(x: number, y: number): number;
  canBuild(node: number, type: string): boolean;
  militaryTroops(node: number): number;
  debugSpawnMilitary(player: number, node: number, type: string): number;
  nodeToScreen(node: number): { x: number; y: number };
}

/** Read the military debug surface (throws if it is missing). */
function readMil(
  page: Page,
): Promise<{ players: number; hqNode: number; counters: Record<string, number> }> {
  return page.evaluate(() => {
    const d = (window as unknown as { __s2debug?: S2Military }).__s2debug;
    if (!d) throw new Error('window.__s2debug missing');
    return { players: d.players, hqNode: d.hqNode, counters: d.counters };
  });
}

test('P4: two-player battle — borders, garrison panel, attack, capture', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  test.setTimeout(90_000);
  const errors = collectErrors(page);

  await page.goto('/game.html?map=maps4_map02');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps4_map02');

  // A 2-HQ map seeds two players (player 1 idle; its HQ renders + holds land).
  const info = await readMil(page);
  expect(info.players, 'two players seeded on a 2-HQ map').toBe(2);

  // Pause and pick two military sites near player 0's HQ: a watchtower for us and
  // a nearby enemy barracks (both close so they stay on-screen for clicking).
  await page.getByTestId('pause-toggle').click();
  const plan = await page.evaluate(() => {
    const d = (window as unknown as { __s2debug: S2Military }).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    const find = (type: string, r0: number, r1: number, skip: number[]): number => {
      for (let rr = r0; rr <= r1; rr++) {
        for (let dy = -rr; dy <= rr; dy++) {
          for (let dx = -rr; dx <= rr; dx++) {
            const n = d.nodeOf(hx + dx, hy + dy);
            if (n === hq || skip.includes(n)) continue;
            if (d.canBuild(n, type)) return n;
          }
        }
      }
      return -1;
    };
    const tower = find('watchtower', 2, 5, []);
    const enemy = find('barracks', 4, 7, [tower]);
    return { tower, enemy };
  });
  expect(plan.tower, 'a watchtower site exists near HQ').toBeGreaterThanOrEqual(0);
  expect(plan.enemy, 'an enemy barracks site exists near HQ').toBeGreaterThanOrEqual(0);

  // Cheat-place a fully-built player-0 watchtower and a player-1 enemy barracks;
  // the engine walks soldiers in and activates each building's territory.
  await page.evaluate((p) => {
    const d = (window as unknown as { __s2debug: S2Military }).__s2debug;
    d.debugSpawnMilitary(0, p.tower, 'watchtower');
    d.debugSpawnMilitary(1, p.enemy, 'barracks');
  }, plan);

  // Run and wait for both garrisons to fill and territory to establish.
  await page.getByTestId('pause-toggle').click();
  await setGameSpeed(page, 10);
  await page.waitForFunction(
    (p) => {
      const d = (window as unknown as { __s2debug: S2Military }).__s2debug;
      return d.militaryTroops(p.tower) >= 4 && d.militaryTroops(p.enemy) >= 1;
    },
    plan,
    { timeout: 45_000 },
  );

  // Fog-on screenshot: our lit territory + border stones fading into the dark.
  await page.getByTestId('game-canvas').screenshot({ path: `${P4UI_DIR}/borders-fog-on.png` });

  // Fog off for the battle so both sides render for the fight screenshots.
  await disableFog(page);
  await page.waitForTimeout(200);
  await page.getByTestId('game-canvas').screenshot({ path: `${P4UI_DIR}/multiplayer.png` });

  // Own building: garrison list by rank + coin toggle.
  await clickNode(page, plan.tower);
  await expect(page.getByTestId('military-panel')).toBeVisible();
  await expect(page.getByTestId('garrison-list')).toBeVisible();
  await expect(page.getByTestId('coin-toggle')).toBeVisible();
  await page.getByTestId('game-canvas').screenshot({ path: `${P4UI_DIR}/garrison-panel.png` });
  await page.getByTestId('coin-toggle').click(); // exercise the toggleCoins command
  await page.getByTestId('military-close').click();

  // Enemy building: attack controls, then launch the attack from the panel.
  await clickNode(page, plan.enemy);
  await expect(page.getByTestId('military-panel')).toBeVisible();
  await expect(page.getByTestId('attack-submit')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('game-canvas').screenshot({ path: `${P4UI_DIR}/attack-panel.png` });
  await page.getByTestId('attack-submit').click();

  // A duel starts as our soldiers reach the enemy flag.
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: S2Military }).__s2debug.counters.fightsStarted >= 1,
    undefined,
    { timeout: 30_000 },
  );
  await page.getByTestId('game-canvas').screenshot({ path: `${P4UI_DIR}/fight.png` });

  // The battle resolves: the barracks is captured or a soldier falls.
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { __s2debug: S2Military }).__s2debug.counters;
      return (c.buildingsCaptured ?? 0) >= 1 || (c.soldiersDied ?? 0) >= 1;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.getByTestId('game-canvas').screenshot({ path: `${P4UI_DIR}/aftermath.png` });

  const counters = (await readMil(page)).counters;
  expect(counters.fightsStarted, 'a fight started').toBeGreaterThanOrEqual(1);
  expect(
    (counters.buildingsCaptured ?? 0) + (counters.soldiersDied ?? 0),
    'the battle resolved (capture or casualty)',
  ).toBeGreaterThanOrEqual(1);
  expect(
    counters.territoryChanges,
    'territory changed as buildings occupied',
  ).toBeGreaterThanOrEqual(1);

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

// --- P6 gate: computer opponent + statistics screen -------------------------

/** The P6 debug slice: AI + per-player building counts. */
interface S2Ai {
  aiPlayers: number;
  players: number;
  buildingsOf(player: number): number;
  nationOf(player: number): string;
}

/** Distinct RGB colors in a named 2D canvas (0 when absent/blank). */
async function canvasDistinct(page: Page, testid: string): Promise<number> {
  return page.evaluate((id) => {
    const c = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"]`);
    if (!c) return 0;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colors.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return colors.size;
  }, testid);
}

test('P6: setup selects a computer opponent that seeds and expands', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  test.setTimeout(120_000);
  const errors = collectErrors(page);

  // Real setup flow: pick a known 2-player map; slot 1 defaults to Computer.
  await page.goto('/setup');
  await expect(page.getByTestId('setup-panel')).toBeVisible();
  await page.locator('[data-testid="map-item"][data-map="maps4_map02"]').click();
  await expect(page.getByTestId('ai-slot-1')).toHaveValue('ai');
  // Pick a nation for the computer opponent (slot 1). The human (slot 0) stays
  // Roman, so the encoded URL is rom,jap.
  await page.getByTestId('nation-slot-1').selectOption('japanese');

  // Start -> lands on the game page for the chosen map with the AI + nations query.
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play\/maps4_map02\?ai=1&nations=rom,jap$/);
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps4_map02');

  // The session created an AI state for the computer slot.
  const aiCount = await page.evaluate(
    () => (window as unknown as { __s2debug: S2Ai }).__s2debug.aiPlayers,
  );
  expect(aiCount, 'at least one AI player seeded').toBeGreaterThanOrEqual(1);

  // The chosen nations flowed into the world: human Roman, opponent Japanese,
  // and the HUD shows the local player's people.
  const nations = await page.evaluate(() => {
    const dbg = (window as unknown as { __s2debug: S2Ai }).__s2debug;
    return [dbg.nationOf(0), dbg.nationOf(1)];
  });
  expect(nations, 'human Roman, opponent Japanese').toEqual(['romans', 'japanese']);
  await expect(page.getByTestId('nation-label')).toHaveText('Romans');

  // Run fast and watch the computer player build beyond its starting HQ.
  await disableFog(page);
  await setGameSpeed(page, 10);
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: S2Ai }).__s2debug.buildingsOf(1) >= 2,
    undefined,
    { timeout: 90_000 },
  );

  const aiBuildings = await page.evaluate(() =>
    (window as unknown as { __s2debug: S2Ai }).__s2debug.buildingsOf(1),
  );
  expect(aiBuildings, 'the AI built past its HQ').toBeGreaterThan(1);

  await page.getByTestId('game-canvas').screenshot({ path: `${P6UI_DIR}/ai-territory.png` });
  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('P6: statistics panel opens and charts per-player series', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  test.setTimeout(90_000);
  const errors = collectErrors(page);

  await page.goto('/play/maps4_map02?ai=1');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await disableFog(page);

  // Let the economy (and the AI) run so the series accumulate and diverge.
  await setGameSpeed(page, 10);
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: S2Ai }).__s2debug.buildingsOf(1) >= 2,
    undefined,
    { timeout: 60_000 },
  );

  // Open the statistics panel from the HUD.
  await page.getByTestId('stats-toggle').click();
  await expect(page.getByTestId('stats-panel')).toBeVisible();

  // The legend lists both players with their current numeric values, and the
  // computer player is labelled as such (full stats for all players, faithful
  // to the original — no fog restriction on the stats screen).
  const legend = page.getByTestId('stats-legend');
  await expect(legend).toContainText('Land');
  await expect(legend).toContainText('Computer');

  // Charts drew: each canvas has a background, axes and colored player lines, so
  // it is far from blank (a single flat color would be ~1-2 distinct values).
  for (const key of ['land', 'buildings', 'soldiers', 'goods']) {
    const distinct = await canvasDistinct(page, `stats-canvas-${key}`);
    expect(distinct, `stats chart ${key} is non-blank`).toBeGreaterThan(3);
  }

  await page.getByTestId('stats-panel').screenshot({ path: `${P6UI_DIR}/stats-panel.png` });
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

// --- P7 gate: seafaring — harbor, ship, expedition --------------------------

/** The seafaring debug slice the P7 test drives. */
interface S2Sea {
  hqNode: number;
  ships: number;
  harbors: number;
  counters: Record<string, number>;
  nodeOf(x: number, y: number): number;
  canBuild(node: number, type: string): boolean;
  debugCanPlaceHarbor(node: number): boolean;
  debugWaterConnected(a: number, b: number): boolean;
  debugSpawnHarbor(player: number, node: number): number;
  debugSpawnShip(player: number, harborId: number): number;
  debugGrantExpeditionSupplies(player: number): void;
  expeditionReady(harborId: number): boolean;
  harborIdAt(node: number): number;
  centerNode(node: number): void;
}

/** Read the seafaring debug surface (throws if missing). */
function readSea(
  page: Page,
): Promise<{ ships: number; harbors: number; counters: Record<string, number> }> {
  return page.evaluate(() => {
    const d = (window as unknown as { __s2debug?: S2Sea }).__s2debug;
    if (!d) throw new Error('window.__s2debug missing');
    return { ships: d.ships, harbors: d.harbors, counters: d.counters };
  });
}

test('P7: seafaring — harbor + ship + expedition founds a harbor on another island', async ({
  page,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  test.setTimeout(120_000);
  const errors = collectErrors(page);

  // "On the high seas" is an archipelago: islands separated by navigable water.
  await page.goto('/game.html?map=maps_miss203');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', 'maps_miss203');
  await disableFog(page);

  // Plan: the coastal harbor site nearest our HQ, plus a distant harbor site on
  // another shore reachable from it by an all-water route (the engine's own
  // connectivity check), so an expedition can actually cross to it.
  await page.getByTestId('pause-toggle').click();
  const plan = await page.evaluate(() => {
    const d = (window as unknown as { __s2debug: S2Sea }).__s2debug;
    const W = 128;
    const H = 128;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    // The harbor is cheat-founded (debugSpawnHarbor bypasses territory), so scan
    // for valid coastal sites with the matching ownership-free check rather than
    // canBuild, which is player-enforced and would exclude unclaimed coast.
    const sites: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = d.nodeOf(x, y);
        if (d.debugCanPlaceHarbor(n)) sites.push(n);
      }
    }
    let near = -1;
    let best = Infinity;
    for (const n of sites) {
      const dx = (n % W) - hx;
      const dy = Math.floor(n / W) - hy;
      const dd = dx * dx + dy * dy;
      if (dd < best) {
        best = dd;
        near = n;
      }
    }
    let target = -1;
    for (const n of sites) {
      if (n === near) continue;
      const dx = (n % W) - (near % W);
      const dy = Math.floor(n / W) - Math.floor(near / W);
      if (Math.hypot(dx, dy) < 20) continue; // a genuinely distant shore
      if (d.debugWaterConnected(near, n)) {
        target = n;
        break;
      }
    }
    return { near, target };
  });
  expect(plan.near, 'a coastal harbor site exists near HQ').toBeGreaterThanOrEqual(0);
  expect(plan.target, 'a distant water-connected harbor site exists').toBeGreaterThanOrEqual(0);

  // Cheat-place a working harbor + an idle ship + an expedition kit worth of
  // supplies (assembly still runs through the real engine command), queue
  // prepareExpedition, and centre the view on the harbor for the panel click.
  const harborId = await page.evaluate((p) => {
    const d = (window as unknown as { __s2debug: S2Sea & { prepareExpedition(h: number): void } })
      .__s2debug;
    const h = d.debugSpawnHarbor(0, p.near);
    d.debugSpawnShip(0, h);
    d.debugGrantExpeditionSupplies(0);
    d.prepareExpedition(h);
    d.centerNode(p.near);
    return h;
  }, plan);
  expect(harborId, 'the debug harbor was founded').toBeGreaterThanOrEqual(0);

  // Run until the expedition kit finishes assembling (ExpeditionReady).
  await page.getByTestId('pause-toggle').click();
  await setGameSpeed(page, 10);
  await page.waitForFunction(
    (h) => (window as unknown as { __s2debug: S2Sea }).__s2debug.expeditionReady(h),
    harborId,
    { timeout: 30_000 },
  );

  const mid = await readSea(page);
  expect(mid.ships, 'a ship is docked at the harbor').toBeGreaterThanOrEqual(1);
  expect(mid.harbors, 'the harbor is working').toBeGreaterThanOrEqual(1);
  expect(mid.counters.expeditionsReady, 'the expedition assembled').toBeGreaterThanOrEqual(1);

  // Open the harbor panel and confirm the ready-expedition UI + Start button.
  await page.getByTestId('pause-toggle').click(); // pause for a stable panel click
  await page.evaluate(
    (n) => (window as unknown as { __s2debug: S2Sea }).__s2debug.centerNode(n),
    plan.near,
  );
  await clickNode(page, plan.near);
  await expect(page.getByTestId('harbor-panel')).toBeVisible();
  await expect(page.getByTestId('expedition-status')).toContainText('Expedition ready');
  await expect(page.getByTestId('start-expedition')).toBeVisible();
  await page.getByTestId('game-canvas').screenshot({ path: `${P7_DIR}/harbor-panel.png` });

  // Click Start expedition -> the interaction layer enters target-select mode (a
  // hint toast appears); then click the distant shore to launch the ship.
  await page.getByTestId('start-expedition').click();
  await expect(page.getByTestId('build-status')).toContainText('Expedition');
  await page.evaluate(
    (t) => (window as unknown as { __s2debug: S2Sea }).__s2debug.centerNode(t),
    plan.target,
  );
  await clickNode(page, plan.target);

  // Resume and watch the expedition cross the sea and found a new harbor.
  await page.getByTestId('pause-toggle').click();
  await page.waitForFunction(
    () => (window as unknown as { __s2debug: S2Sea }).__s2debug.counters.expeditionsLanded >= 1,
    undefined,
    { timeout: 60_000 },
  );

  const after = await readSea(page);
  expect(after.counters.expeditionsLanded, 'the expedition landed').toBeGreaterThanOrEqual(1);
  expect(after.harbors, 'a second harbor now exists').toBeGreaterThanOrEqual(2);
  const newHarbor = await page.evaluate(
    (t) => (window as unknown as { __s2debug: S2Sea }).__s2debug.harborIdAt(t),
    plan.target,
  );
  expect(newHarbor, 'a harbor was founded on the far shore').toBeGreaterThanOrEqual(0);

  // Centre on the new colony for the landed screenshot.
  await page.evaluate(
    (t) => (window as unknown as { __s2debug: S2Sea }).__s2debug.centerNode(t),
    plan.target,
  );
  await page.waitForTimeout(250);
  await page.getByTestId('game-canvas').screenshot({ path: `${P7_DIR}/expedition-landed.png` });

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});
