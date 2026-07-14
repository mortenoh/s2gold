/**
 * Player-guide screenshot generator (`pnpm guide:shots`).
 *
 * Boots the real app (via the shared Vite dev server, see guide-shots.config.ts)
 * and drives it with the same `window.__s2debug` helpers the e2e suite uses, so
 * every capture the guide references is produced deterministically: title menu,
 * setup with nation pickers, the World Campaign globe, the in-game HUD, the
 * build context menu + icon grid, a road-build preview, a working economy, the
 * goods window, the military garrison panel, geologist ore signs, a harbor with
 * a ship + ready expedition, the statistics panel, the save/load trays, and the
 * Options screen.
 *
 * This is a documentation tool, not a behaviour test: it lives outside the e2e
 * testDir so `pnpm e2e` never runs it. Its captures contain original game art
 * and are written to the git-ignored `docs/guide-shots/` (never committed).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { assetsPresent } from './tests/helpers';

/** Output directory (relative to the e2e package cwd). Git-ignored. */
const OUT = '../docs/guide-shots';

/** The slice of window.__s2debug this generator drives (for the page-side cast). */
interface Debug {
  hqNode: number;
  players: number;
  flags: number;
  counters: Record<string, number>;
  nodeOf(x: number, y: number): number;
  flagNodeOf(node: number): number;
  canBuild(node: number, type: string): boolean;
  canFlag(node: number): boolean;
  suggestRoad(a: number, b: number): number[] | null;
  nodeToScreen(node: number): { x: number; y: number };
  centerNode(node: number): void;
  setFog(on: boolean): void;
  buildingsOf(player: number): number;
  militaryTroops(node: number): number;
  debugSpawnMilitary(player: number, node: number, type: string): number;
  debugCanPlaceHarbor(node: number): boolean;
  debugSpawnHarbor(player: number, node: number): number;
  debugSpawnShip(player: number, harborId: number): number;
  debugGrantExpeditionSupplies(player: number): void;
  prepareExpedition(harborId: number): void;
  expeditionReady(harborId: number): boolean;
  roadPreview(): { valid: boolean; hasPath: boolean } | null;
}

type Win = { __s2debug: Debug };

/** Wait until the game page has loaded a map (body[data-map-ready]). */
async function waitForMap(page: Page, name: string): Promise<void> {
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', name);
}

/** Turn fog of war off so a capture shows the whole settlement, not the dark. */
async function disableFog(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as Win).__s2debug.setFog(false));
}

/** Center the camera on a lattice node (keeps off-screen targets clickable). */
async function centerNode(page: Page, node: number): Promise<void> {
  await page.evaluate((n) => (window as unknown as Win).__s2debug.centerNode(n), node);
}

/** The HQ building's lattice node for player 0. */
async function hqNode(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as Win).__s2debug.hqNode);
}

/** Pick a game speed through the real HUD speed dropdown. */
async function setSpeed(page: Page, speed: number): Promise<void> {
  await page.getByTestId('speed-select').click();
  await page.locator(`.dropdown-list.speed-select [data-value="${speed}"]`).click();
  await expect(page.getByTestId('speed-select')).toHaveText(`${speed}x`);
}

/** Click the game canvas at a lattice node's on-screen anchor. */
async function clickNode(page: Page, node: number): Promise<void> {
  const pos = await page.evaluate(
    (n) => (window as unknown as Win).__s2debug.nodeToScreen(n),
    node,
  );
  await page.getByTestId('game-canvas').click({ position: pos });
}

/** Save a viewport screenshot (the whole game/menu view). */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** Save a single element's screenshot (tight crop). */
async function shotOf(locator: Locator, name: string): Promise<void> {
  await locator.screenshot({ path: `${OUT}/${name}.png` });
}

test.beforeEach(async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
});

// --- Menu screens -----------------------------------------------------------

test('menus: title, setup, world globe, roman campaign, options', async ({ page }) => {
  // Title menu.
  await page.goto('/');
  await expect(page.getByTestId('title-panel')).toBeVisible();
  await expect(page.getByTestId('menu-freeplay')).toBeVisible();
  await shot(page, '01-title-menu');

  // Free-play setup with the per-slot nation pickers (a 2-player map seats an
  // opponent slot, so the Players list with its nation dropdowns renders).
  await page.goto('/setup');
  await expect(page.getByTestId('setup-panel')).toBeVisible();
  await page.locator('[data-testid="map-item"][data-map="maps4_map02"]').click();
  await expect(page.getByTestId('ai-slot-1')).toHaveValue('ai');
  await expect(page.getByTestId('nation-slot-1')).toBeVisible();
  await shot(page, '02-setup-nations');

  // World Campaign globe.
  await page.goto('/campaign/world');
  await expect(page.getByTestId('campaign-panel')).toBeVisible();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await page.waitForTimeout(200);
  await shot(page, '03-world-globe');

  // Roman campaign chapter list.
  await page.goto('/campaign');
  await expect(page.getByTestId('campaign-panel')).toBeVisible();
  await shot(page, '04-roman-campaign');

  // Options.
  await page.goto('/options');
  await expect(page.getByTestId('options-panel')).toBeVisible();
  await shot(page, '05-options');
});

// --- HUD, build menu, road preview ------------------------------------------

test('hud bar, build context menu, icon grid, road preview', async ({ page }) => {
  await page.goto('/play/maps_miss200');
  await waitForMap(page, 'maps_miss200');
  await disableFog(page);
  await page.getByTestId('pause-toggle').click();
  await expect(page.getByTestId('pause-toggle')).toHaveText('Resume');

  // HUD bar closeup.
  await shotOf(page.locator('.hud-top'), '10-hud-bar');

  // A flat house-size site near the HQ for the build menu.
  const site = await page.evaluate(() => {
    const d = (window as unknown as Win).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    for (let rr = 2; rr <= 8; rr++) {
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const n = d.nodeOf(hx + dx, hy + dy);
          if (n !== hq && d.canBuild(n, 'sawmill')) return n;
        }
      }
    }
    return -1;
  });
  expect(site, 'a house-size site exists near HQ').toBeGreaterThanOrEqual(0);
  await centerNode(page, site);

  // Root context menu (Flag + size-class categories).
  await clickNode(page, site);
  await expect(page.getByTestId('ctx-menu')).toBeVisible();
  await shot(page, '11-context-menu');

  // Open the Houses category: the icon grid of buildings with costs.
  await page.getByTestId('ctx-cat-houses').click();
  await expect(page.getByTestId('ctx-submenu')).toBeVisible();
  await expect(page.getByTestId('ctx-sawmill')).toBeVisible();
  await shot(page, '12-build-grid');
  await page.keyboard.press('Escape');

  // Road-build preview: enter road mode from the HQ flag and hover a reachable
  // free node a few steps away; the previewed path renders in green.
  const spots = await page.evaluate(() => {
    const d = (window as unknown as Win).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    const hqFlag = d.flagNodeOf(hq);
    let dest = -1;
    for (let dx = 3; dx <= 7 && dest < 0; dx++) {
      const n = d.nodeOf(hx + dx, hy);
      if (n !== hqFlag && d.canFlag(n) && d.suggestRoad(hqFlag, n)) dest = n;
    }
    return { hqFlag, dest };
  });
  expect(spots.dest, 'a reachable road destination exists near HQ').toBeGreaterThanOrEqual(0);
  await centerNode(page, spots.hqFlag);
  await clickNode(page, spots.hqFlag);
  await page.getByTestId('ctx-build').click();
  const destPos = await page.evaluate(
    (n) => (window as unknown as Win).__s2debug.nodeToScreen(n),
    spots.dest,
  );
  await page.mouse.move(destPos.x, destPos.y, { steps: 8 });
  await page
    .waitForFunction(
      () => {
        const rp = (window as unknown as Win).__s2debug.roadPreview();
        return rp !== null && rp.valid && rp.hasPath;
      },
      undefined,
      { timeout: 3000 },
    )
    .catch(() => {
      /* preview may need another frame; the capture still shows road mode */
    });
  await page.waitForTimeout(150);
  await shot(page, '13-road-preview');
});

// --- Working economy + goods window -----------------------------------------

test('working economy and the goods window', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/play/maps_miss200');
  await waitForMap(page, 'maps_miss200');
  await disableFog(page);
  await page.getByTestId('pause-toggle').click();

  // Choose a woodcutter + sawmill site near the HQ and a free flag between them.
  const plan = await page.evaluate(() => {
    const d = (window as unknown as Win).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    const firstBuildable = (type: string, cx: number, cy: number, r: number): number => {
      for (let rr = 2; rr <= r; rr++) {
        for (let dy = -rr; dy <= rr; dy++) {
          for (let dx = -rr; dx <= rr; dx++) {
            const n = d.nodeOf(cx + dx, cy + dy);
            if (n !== hq && d.canBuild(n, type)) return n;
          }
        }
      }
      return -1;
    };
    const wcNode = firstBuildable('woodcutter', hx - 3, hy - 1, 5);
    const smNode = firstBuildable('sawmill', hx - 1, hy + 1, 5);
    let nearFlag = -1;
    for (let rr = 2; rr <= 4 && nearFlag < 0; rr++) {
      for (let dx = 2; dx <= rr && nearFlag < 0; dx++) {
        const n = d.nodeOf(hx + dx, hy);
        if (n !== wcNode && n !== smNode && d.canFlag(n)) nearFlag = n;
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
  expect(plan.wcNode).toBeGreaterThanOrEqual(0);
  expect(plan.smNode).toBeGreaterThanOrEqual(0);
  expect(plan.nearFlag).toBeGreaterThanOrEqual(0);

  // Place a flag near the HQ, then road HQ -> that flag.
  await clickNode(page, plan.nearFlag);
  await page.getByTestId('ctx-flag').click();
  await clickNode(page, plan.hqFlag);
  await page.getByTestId('ctx-build').click();
  await clickNode(page, plan.nearFlag);

  // Place the woodcutter and the sawmill from their size-class flyouts.
  await clickNode(page, plan.wcNode);
  await page.getByTestId('ctx-cat-huts').click();
  await page.getByTestId('ctx-woodcutter').click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await clickNode(page, plan.smNode);
  await page.getByTestId('ctx-cat-houses').click();
  await page.getByTestId('ctx-sawmill').click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');

  // Resume so the placement commands apply and the auto-flags exist.
  await page.getByTestId('pause-toggle').click();
  await page.waitForFunction(() => (window as unknown as Win).__s2debug.flags >= 4, undefined, {
    timeout: 8000,
  });

  // Road the network together: near-flag -> sawmill -> woodcutter.
  await clickNode(page, plan.nearFlag);
  await page.getByTestId('ctx-build').click();
  await clickNode(page, plan.smFlag);
  await clickNode(page, plan.smFlag);
  await page.getByTestId('ctx-build').click();
  await clickNode(page, plan.wcFlag);

  // Run fast and let the wood/plank loop close (trees felled, planks cut).
  await setSpeed(page, 50);
  await page.waitForFunction(
    () => {
      const c = (window as unknown as Win).__s2debug.counters;
      return (
        (c.planksProduced ?? 0) >= 1 &&
        (c.buildingsCompleted ?? 0) >= 2 &&
        (c.trunksProduced ?? 0) >= 1
      );
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(600);
  await centerNode(page, await hqNode(page));
  await page.waitForTimeout(300);
  await shot(page, '14-economy');

  // Goods window over the HQ warehouse (click the HQ building).
  await clickNode(page, await hqNode(page));
  await expect(page.getByTestId('goods-panel')).toBeVisible();
  await shot(page, '15-goods-window');
});

// --- Military garrison panel -------------------------------------------------

test('military garrison panel and territory', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/play/maps4_map02');
  await waitForMap(page, 'maps4_map02');

  await page.getByTestId('pause-toggle').click();
  const tower = await page.evaluate(() => {
    const d = (window as unknown as Win).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    for (let rr = 2; rr <= 6; rr++) {
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const n = d.nodeOf(hx + dx, hy + dy);
          if (n !== hq && d.canBuild(n, 'watchtower')) return n;
        }
      }
    }
    return -1;
  });
  expect(tower, 'a watchtower site exists near HQ').toBeGreaterThanOrEqual(0);
  await page.evaluate(
    (t) => (window as unknown as Win).__s2debug.debugSpawnMilitary(0, t, 'watchtower'),
    tower,
  );

  await page.getByTestId('pause-toggle').click();
  await setSpeed(page, 50);
  await page.waitForFunction(
    (t) => (window as unknown as Win).__s2debug.militaryTroops(t) >= 3,
    tower,
    { timeout: 45_000 },
  );
  await disableFog(page);
  await centerNode(page, tower);
  await page.waitForTimeout(300);

  await clickNode(page, tower);
  await expect(page.getByTestId('military-panel')).toBeVisible();
  await expect(page.getByTestId('garrison-list')).toBeVisible();
  await shot(page, '16-military-panel');
});

// --- Geologist ore signs -----------------------------------------------------

test('geologist ore signs on a mountain', async ({ page }) => {
  test.setTimeout(90_000);
  // Try mountainous maps until one has a mine (all-mountain) site near the HQ:
  // where a mine can be built, the geologist will find ore to sign nearby.
  const candidates: [string, number][] = [
    ['maps_miss202', 128],
    ['maps4_map09', 128],
    ['maps_miss200', 64],
  ];
  let flagSpot = -1;
  for (const [map, W] of candidates) {
    await page.goto(`/play/${map}`);
    await waitForMap(page, map);
    await disableFog(page);
    flagSpot = await page.evaluate((w) => {
      const d = (window as unknown as Win).__s2debug;
      const hq = d.hqNode;
      const hx = hq % w;
      const hy = Math.floor(hq / w);
      // A mine-buildable (mountain) node near HQ.
      let mine = -1;
      for (let rr = 2; rr <= 10 && mine < 0; rr++) {
        for (let dy = -rr; dy <= rr && mine < 0; dy++) {
          for (let dx = -rr; dx <= rr && mine < 0; dx++) {
            const n = d.nodeOf(hx + dx, hy + dy);
            if (n !== hq && d.canBuild(n, 'coalmine')) mine = n;
          }
        }
      }
      if (mine < 0) return -1;
      // A flaggable node as close as possible to the mountain (a geologist
      // surveys within 6 tiles of the flag it is sent from).
      const mx = mine % w;
      const my = Math.floor(mine / w);
      for (let rr = 0; rr <= 5; rr++) {
        for (let dy = -rr; dy <= rr; dy++) {
          for (let dx = -rr; dx <= rr; dx++) {
            const n = d.nodeOf(mx + dx, my + dy);
            if (d.canFlag(n)) return n;
          }
        }
      }
      return -1;
    }, W);
    if (flagSpot >= 0) break;
  }
  expect(flagSpot, 'a mountainous start with a flag spot was found').toBeGreaterThanOrEqual(0);

  await centerNode(page, flagSpot);
  const before = await page.evaluate(() => (window as unknown as Win).__s2debug.flags);

  // Place a flag by the mountain, let it commit, then send a geologist from it.
  await page.getByTestId('pause-toggle').click();
  await clickNode(page, flagSpot);
  await page.getByTestId('ctx-flag').click();
  await page.getByTestId('pause-toggle').click();
  await page.waitForFunction((b) => (window as unknown as Win).__s2debug.flags > b, before, {
    timeout: 8000,
  });
  await clickNode(page, flagSpot);
  await page.getByTestId('ctx-send').click();

  await setSpeed(page, 50);
  // Signs appear once the survey completes: the ore-sign legend un-hides.
  await expect(page.getByTestId('sign-legend')).toBeVisible({ timeout: 45_000 });
  await centerNode(page, flagSpot);
  await page.waitForTimeout(400);
  await shot(page, '17-geologist-signs');
});

// --- Seafaring: harbor + ship + expedition ----------------------------------

test('harbor with a ship and a ready expedition', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/play/maps_miss203');
  await waitForMap(page, 'maps_miss203');
  await disableFog(page);

  await page.getByTestId('pause-toggle').click();
  const near = await page.evaluate(() => {
    const d = (window as unknown as Win).__s2debug;
    const W = 128;
    const H = 128;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    let best = Infinity;
    let node = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = d.nodeOf(x, y);
        if (!d.debugCanPlaceHarbor(n)) continue;
        const dd = (x - hx) * (x - hx) + (y - hy) * (y - hy);
        if (dd < best) {
          best = dd;
          node = n;
        }
      }
    }
    return node;
  });
  expect(near, 'a coastal harbor site exists near HQ').toBeGreaterThanOrEqual(0);

  const harborId = await page.evaluate((n) => {
    const d = (window as unknown as Win).__s2debug;
    const h = d.debugSpawnHarbor(0, n);
    d.debugSpawnShip(0, h);
    d.debugGrantExpeditionSupplies(0);
    d.prepareExpedition(h);
    d.centerNode(n);
    return h;
  }, near);
  expect(harborId).toBeGreaterThanOrEqual(0);

  await page.getByTestId('pause-toggle').click();
  await setSpeed(page, 50);
  await page.waitForFunction(
    (h) => (window as unknown as Win).__s2debug.expeditionReady(h),
    harborId,
    { timeout: 40_000 },
  );

  await page.getByTestId('pause-toggle').click();
  await centerNode(page, near);
  await page.waitForTimeout(300);
  await clickNode(page, near);
  await expect(page.getByTestId('harbor-panel')).toBeVisible();
  await expect(page.getByTestId('expedition-status')).toContainText('Expedition ready');
  await shot(page, '18-harbor-expedition');
});

// --- Statistics panel --------------------------------------------------------

test('statistics panel', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/play/maps4_map02?ai=1');
  await waitForMap(page, 'maps4_map02');
  await disableFog(page);
  await setSpeed(page, 50);
  await page.waitForFunction(
    () => (window as unknown as Win).__s2debug.buildingsOf(1) >= 2,
    undefined,
    { timeout: 60_000 },
  );
  await page.getByTestId('stats-toggle').click();
  await expect(page.getByTestId('stats-panel')).toBeVisible();
  await page.waitForTimeout(400);
  await shotOf(page.getByTestId('stats-panel'), '19-stats-panel');
});

// --- Save / load trays -------------------------------------------------------

test('save and load trays', async ({ page }) => {
  await page.goto('/play/maps_miss200');
  await waitForMap(page, 'maps_miss200');
  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('save-panel')).toBeVisible();
  // With the FastAPI server running, the eleven trays list; without it, the
  // panel shows the Save row + an "unavailable" note. Either way this captures
  // the Game (save/load) panel the guide references.
  const savesUp = await page.request
    .get('/api/saves')
    .then((r) => r.ok())
    .catch(() => false);
  if (savesUp) {
    await expect(
      page.getByTestId('save-tray').or(page.getByTestId('save-item')).first(),
    ).toBeVisible({ timeout: 5000 });
  }
  await shotOf(page.getByTestId('save-panel'), '20-save-trays');
});
