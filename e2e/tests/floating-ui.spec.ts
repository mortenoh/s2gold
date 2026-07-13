/**
 * Floating-UI position contract.
 *
 * The flow-based specs assert that popups/panels *exist*; this file asserts
 * *where* they render. The project has repeatedly shipped position regressions
 * that flow tests never caught — most memorably a dropdown popup that opened
 * hundreds of px from its button because a CSS `transform` on the HUD bar became
 * the containing block for its `position: fixed` descendant. These tests pin the
 * geometry of every floating surface (dropdowns, context menu + flyout, HUD
 * panels, the warehouse inventory) so such a regression fails loudly, and they
 * are the contract a build-menu redesign must keep green.
 *
 * Assertions are tolerant (a few px), never pixel-perfect screenshots.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { assetsPresent } from './helpers';

const MAP = 'maps_miss200';

/** Minimal viewport rect. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of window.__s2debug these tests drive. */
interface S2DebugUi {
  hqNode: number;
  nodeOf(x: number, y: number): number;
  canBuild(node: number, type: string): boolean;
  nodeToScreen(node: number): { x: number; y: number };
  centerNode(node: number): void;
}

/** Boot a game and wait until its map is live. */
async function bootGame(page: Page, map = MAP): Promise<void> {
  await page.goto(`/play/${map}`);
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map-ready', map);
}

/** Freeze the sim so placement/positioning stays deterministic. */
async function pauseGame(page: Page): Promise<void> {
  await page.getByTestId('pause-toggle').click();
  await expect(page.getByTestId('pause-toggle')).toHaveText('Resume');
}

/** Non-null bounding box (viewport coords) or throw. */
async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return b;
}

/** Current viewport size as seen by the page. */
async function viewport(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

/** Canvas-relative screen point of a lattice node (matches Playwright's position origin). */
async function nodeScreen(page: Page, node: number): Promise<{ x: number; y: number }> {
  return page.evaluate((n) => {
    const d = (window as unknown as { __s2debug?: S2DebugUi }).__s2debug;
    if (!d) throw new Error('window.__s2debug missing');
    return d.nodeToScreen(n);
  }, node);
}

/**
 * `count` distinct house-size buildable nodes near the HQ (not the HQ itself).
 * A sawmill is house-size, so any hut/house/castle build menu opens on these.
 */
async function buildableNodes(page: Page, count: number): Promise<number[]> {
  const nodes = await page.evaluate((want) => {
    const d = (window as unknown as { __s2debug: S2DebugUi }).__s2debug;
    const W = 64;
    const hq = d.hqNode;
    const hx = hq % W;
    const hy = Math.floor(hq / W);
    const out: number[] = [];
    for (let rr = 2; rr <= 10 && out.length < want; rr++) {
      for (let dy = -rr; dy <= rr && out.length < want; dy++) {
        for (let dx = -rr; dx <= rr && out.length < want; dx++) {
          const node = d.nodeOf(hx + dx, hy + dy);
          if (node !== hq && !out.includes(node) && d.canBuild(node, 'sawmill')) out.push(node);
        }
      }
    }
    return out;
  }, count);
  return nodes;
}

/** Assert a floating element sits fully inside the viewport (1px slack). */
function expectOnScreen(el: Box, vp: { w: number; h: number }): void {
  expect(el.x, 'left edge on-screen').toBeGreaterThanOrEqual(-1);
  expect(el.y, 'top edge on-screen').toBeGreaterThanOrEqual(-1);
  expect(el.x + el.width, 'right edge on-screen').toBeLessThanOrEqual(vp.w + 1);
  expect(el.y + el.height, 'bottom edge on-screen').toBeLessThanOrEqual(vp.h + 1);
}

/**
 * Assert a portalled dropdown list is left-aligned to its trigger, fully
 * on-screen, and opens in the correct direction for the trigger's position (the
 * bottom-anchored HUD makes lower-half triggers open upward).
 */
async function assertDropdownAligned(
  page: Page,
  buttonTestId: string,
  listSelector: string,
): Promise<void> {
  const btn = await box(page.getByTestId(buttonTestId));
  const list = await box(page.locator(listSelector));
  const vp = await viewport(page);

  expect(Math.abs(list.x - btn.x), 'list left edge within ~2px of button left').toBeLessThanOrEqual(
    2,
  );
  expectOnScreen(list, vp);

  const listBottom = list.y + list.height;
  if (btn.y > vp.h / 2) {
    // Opens upward: the list bottom sits just above the button top.
    const gap = btn.y - listBottom;
    expect(gap, 'list opens upward (bottom above button top)').toBeGreaterThanOrEqual(-1);
    expect(gap, 'list bottom within ~10px above button top').toBeLessThanOrEqual(10);
  } else {
    // Opens downward: the list top sits just below the button bottom.
    const gap = list.y - (btn.y + btn.height);
    expect(gap, 'list opens downward (top below button bottom)').toBeGreaterThanOrEqual(-1);
    expect(gap, 'list top within ~10px below button bottom').toBeLessThanOrEqual(10);
  }
}

/**
 * Assert a HUD panel opens upward (bottom ~6px above the button top) and is left
 * clamped on-screen and near the button's left — the hud-panel.ts contract:
 * bottom = innerHeight - rect.top + 6, left = clamp(rect.left, 8, innerWidth - w - 8).
 */
async function assertHudPanelAboveButton(
  page: Page,
  buttonTestId: string,
  panel: Locator,
): Promise<void> {
  const btn = await box(page.getByTestId(buttonTestId));
  const p = await box(panel);
  const vp = await viewport(page);

  const panelBottom = p.y + p.height;
  const gap = btn.y - panelBottom;
  expect(gap, 'panel opens upward (bottom above button top)').toBeGreaterThanOrEqual(1);
  expect(gap, 'panel bottom ~6px above button top').toBeLessThanOrEqual(12);

  const expectedLeft = Math.max(8, Math.min(btn.x, vp.w - p.width - 8));
  expect(Math.abs(p.x - expectedLeft), 'panel left clamped + near button left').toBeLessThanOrEqual(
    2,
  );
  expectOnScreen(p, vp);
}

// --- 1) Speed dropdown (HUD bar) -------------------------------------------

test('speed dropdown opens upward, left-aligned to its button, on-screen', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await bootGame(page);

  await page.getByTestId('speed-select').click();
  const list = page.locator('.dropdown-list.speed-select');
  await expect(list).toBeVisible();
  await assertDropdownAligned(page, 'speed-select', '.dropdown-list.speed-select');
});

// --- 2) Map dropdown (Settings panel, same portalled-dropdown contract) -----

test('map dropdown is left-aligned to its button and stays on-screen', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await bootGame(page);

  // The map picker lives inside the Settings panel; open it, then the dropdown.
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await page.getByTestId('map-select').click();
  await expect(page.locator('.dropdown-list')).toBeVisible();
  await assertDropdownAligned(page, 'map-select', '.dropdown-list');
});

// --- 3) Node context menu at the click point --------------------------------

test('node context menu opens at the click point, on-screen', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await bootGame(page);
  await pauseGame(page);

  const [node] = await buildableNodes(page, 1);
  expect(node, 'a buildable node exists near HQ').toBeGreaterThanOrEqual(0);
  const s = await nodeScreen(page, node);
  await page.getByTestId('game-canvas').click({ position: s });

  const menu = page.getByTestId('ctx-menu');
  await expect(menu).toBeVisible();

  const canvas = await box(page.getByTestId('game-canvas'));
  const clickX = canvas.x + s.x;
  const clickY = canvas.y + s.y;
  const mb = await box(menu);
  // interaction.ts opens the menu at (clickX + 2, clickY + 2) unless it must
  // flip/clamp near an edge; near the HQ (centre of the map) it never does.
  expect(Math.abs(mb.x - (clickX + 2)), 'menu left ~2px right of the click').toBeLessThanOrEqual(3);
  expect(Math.abs(mb.y - (clickY + 2)), 'menu top ~2px below the click').toBeLessThanOrEqual(3);
  expectOnScreen(mb, await viewport(page));
});

// --- 4) Build-category flyout adjacency -------------------------------------

test('category flyout is horizontally adjacent to and vertically overlaps its trigger', async ({
  page,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await bootGame(page);
  await pauseGame(page);

  const [node] = await buildableNodes(page, 1);
  expect(node, 'a buildable node exists near HQ').toBeGreaterThanOrEqual(0);
  const s = await nodeScreen(page, node);
  await page.getByTestId('game-canvas').click({ position: s });
  await expect(page.getByTestId('ctx-menu')).toBeVisible();

  const trigger = page.getByTestId('ctx-cat-huts');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const submenu = page.getByTestId('ctx-submenu');
  await expect(submenu).toBeVisible();

  const tb = await box(trigger);
  const sb = await box(submenu);
  // interaction.ts opens the submenu to the trigger's right (left ~= trigger
  // right), flipping to the mirrored left position only when cramped near the
  // viewport edge; near the HQ it opens to the right.
  const rightOpen = Math.abs(sb.x - (tb.x + tb.width)) <= 4;
  const leftOpen = Math.abs(sb.x + sb.width - tb.x) <= 4;
  expect(rightOpen || leftOpen, 'submenu is horizontally adjacent to the trigger').toBeTruthy();
  // Vertically overlaps the trigger row.
  expect(sb.y, 'submenu top above trigger bottom').toBeLessThan(tb.y + tb.height);
  expect(sb.y + sb.height, 'submenu bottom below trigger top').toBeGreaterThan(tb.y);
  expectOnScreen(sb, await viewport(page));
});

// --- 5) HUD panels open upward, clamped on-screen ---------------------------

interface HudPanelCase {
  name: string;
  button: string;
  panel: string;
}

const HUD_PANELS: HudPanelCase[] = [
  { name: 'Game (save) panel', button: 'menu-toggle', panel: 'save-panel' },
  { name: 'Stats panel', button: 'stats-toggle', panel: 'stats-panel' },
  { name: 'Goods panel', button: 'goods-toggle', panel: 'goods-panel' },
  { name: 'Settings panel', button: 'settings-toggle', panel: 'settings-panel' },
];

for (const c of HUD_PANELS) {
  test(`${c.name} opens above its HUD button, left-clamped on-screen`, async ({ page }) => {
    test.skip(!(await assetsPresent(page)), 'converted assets not installed');
    await bootGame(page);

    await page.getByTestId(c.button).click();
    const panel = page.getByTestId(c.panel);
    await expect(panel).toBeVisible();
    await assertHudPanelAboveButton(page, c.button, panel);
  });
}

// --- 6) Warehouse inventory over the building -------------------------------

test('warehouse inventory pops up centred over the HQ, just above it', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await bootGame(page);
  await pauseGame(page);

  // Pan so the HQ sits low in the viewport: the full inventory is tall, so it
  // only opens *above* the building (its intended placement) when there is room
  // above. Centre on a node north of the HQ until the HQ lands in the lower band.
  const hq = await page.evaluate(() => {
    const d = (window as unknown as { __s2debug: S2DebugUi }).__s2debug;
    const W = 64;
    const hqNode = d.hqNode;
    const hx = hqNode % W;
    const hy = Math.floor(hqNode / W);
    d.centerNode(hqNode);
    for (let k = 4; k <= 40; k++) {
      d.centerNode(d.nodeOf(hx, hy - k));
      const s = d.nodeToScreen(hqNode);
      if (s.y >= 540 && s.y <= 630) return hqNode;
    }
    return hqNode;
  });
  const s = await nodeScreen(page, hq);
  await page.getByTestId('game-canvas').click({ position: s });

  const panel = page.getByTestId('goods-panel');
  await expect(panel).toBeVisible();

  const canvas = await box(page.getByTestId('game-canvas'));
  const hqX = canvas.x + s.x;
  const hqY = canvas.y + s.y;
  const pb = await box(panel);
  const vp = await viewport(page);

  const centerX = pb.x + pb.width / 2;
  expect(Math.abs(centerX - hqX), 'panel horizontal centre over the HQ').toBeLessThanOrEqual(8);

  // inventory-ui.ts positionOver() places the panel 12px above the building when
  // it fits (flipping below only when there is no room above); we panned so it fits.
  const panelBottom = pb.y + pb.height;
  expect(hqY - panelBottom, 'panel bottom sits ~12px above the HQ').toBeGreaterThanOrEqual(6);
  expect(hqY - panelBottom, 'panel bottom sits ~12px above the HQ').toBeLessThanOrEqual(16);
  expectOnScreen(pb, vp);
});

// --- 7) Menu dismiss semantics ----------------------------------------------

test('a click while a menu is open only dismisses it; the next click opens a fresh one', async ({
  page,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');
  await bootGame(page);
  await pauseGame(page);

  // Several candidate sites plus their screen points, so we can pick a second
  // one that falls *outside* the first menu (a click on the menu itself is a
  // menu action, not the canvas dismiss we are exercising).
  const nodes = await buildableNodes(page, 24);
  expect(nodes.length, 'buildable nodes exist near HQ').toBeGreaterThan(1);
  const screens = await page.evaluate((ns) => {
    const d = (window as unknown as { __s2debug: S2DebugUi }).__s2debug;
    return ns.map((n) => d.nodeToScreen(n));
  }, nodes);
  const canvas = page.getByTestId('game-canvas');
  const menu = page.getByTestId('ctx-menu');

  // First click opens a menu at node A.
  const sa = screens[0]!;
  await canvas.click({ position: sa });
  await expect(menu).toBeVisible();

  // Pick node B whose screen point is clear of the open menu (20px margin) and
  // comfortably above the bottom HUD bar.
  const mb = await box(menu);
  const clear = (p: { x: number; y: number }): boolean =>
    (p.x < mb.x - 20 || p.x > mb.x + mb.width + 20 || p.y < mb.y - 20 || p.y > mb.y + mb.height + 20) &&
    p.y < 640;
  const sb = screens.find((p) => clear(p));
  expect(sb, 'a second site sits clear of the open menu').toBeTruthy();

  // A click elsewhere on the canvas dismisses the menu and does NOT open a new one.
  await canvas.click({ position: sb! });
  await expect(menu).toHaveCount(0);

  // The next click (no menu open) opens a fresh menu.
  await canvas.click({ position: sb! });
  await expect(menu).toBeVisible();
});
