import { expect, test } from '@playwright/test';
import { assetsPresent, CAMPAIGN_PROGRESS_KEY } from './helpers';

/**
 * P7 campaign gate: the campaign menu gates chapters (only I selectable at
 * first), the briefing shows diary text and starts the game in campaign mode,
 * and completing a chapter (via the in-game debug hook) records progress and
 * unlocks the next chapter.
 */

const SCREENSHOT_DIR = 'test-results/shots/p7camp';

// Each Playwright test runs in an isolated browser context, so localStorage
// (campaign progress, intro-watched) always starts empty — no explicit reset.

test('campaign menu lists ten chapters with only chapter I selectable initially', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/campaign');
  await expect(page.getByTestId('campaign-panel')).toBeVisible();

  const chapters = page.getByTestId('chapter-item');
  await expect(chapters).toHaveCount(10);

  // Chapter I is available (a link); chapter II is locked (a non-link span).
  await expect(page.locator('[data-chapter="1"]')).toHaveAttribute('data-state', 'available');
  await expect(page.locator('[data-chapter="2"]')).toHaveAttribute('data-state', 'locked');
  await expect(page.locator('[data-chapter="2"]')).toHaveAttribute('aria-disabled', 'true');

  // Chapter I is a real anchor to its briefing.
  await expect(page.locator('a[data-chapter="1"]')).toBeVisible();
  await expect(page.locator('a[data-chapter="2"]')).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/campaign-menu.png`, fullPage: true });
  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('briefing shows diary text and Start lands in the game with the campaign param', async ({
  page,
}) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/campaign');
  await page.locator('a[data-chapter="1"]').click();

  // Landed on the briefing for chapter 1.
  await expect(page).toHaveURL(/\/campaign\/1$/);
  await expect(page.getByTestId('briefing-panel')).toBeVisible();
  await expect(page.getByTestId('briefing-title')).toBeVisible();

  // Objective + diary are present. The diary carries the converted mission text.
  await expect(page.getByTestId('briefing-objective')).toBeVisible();
  await expect(page.getByTestId('briefing-diary')).toBeVisible();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/briefing.png`, fullPage: true });

  // Start the chapter -> game page with ?campaign=1.
  await page.getByTestId('briefing-start').click();
  await expect(page).toHaveURL(/\/play\/maps_miss200\?campaign=1/);
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 15_000 });

  // The in-game Objectives panel is available in campaign mode. The campaign
  // controller mounts just after boot, which can lag under parallel load.
  await expect(page.getByTestId('objectives-toggle')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('objectives-toggle').click();
  await expect(page.getByTestId('objectives-panel')).toBeVisible();
  await expect(page.getByTestId('objectives-progress')).toBeVisible();
  await page.getByTestId('game-canvas').screenshot({ path: `${SCREENSHOT_DIR}/objectives.png` });

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('force-completing chapter I records progress and unlocks chapter II', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  // Start chapter I directly in campaign mode.
  await page.goto('/play/maps_miss200?campaign=1');
  await expect(page.locator('body[data-map-ready]')).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId('objectives-toggle')).toBeVisible();

  // The campaign debug hook is exposed for this chapter.
  const chapter = await page.evaluate(
    () => (window as unknown as { __s2campaign?: { chapter: number } }).__s2campaign?.chapter,
  );
  expect(chapter, 'campaign debug hook exposes the active chapter').toBe(1);

  // Force-complete the chapter: the victory overlay appears and progress is saved.
  await page.evaluate(() => {
    (window as unknown as { __s2campaign: { forceComplete(): void } }).__s2campaign.forceComplete();
  });
  await expect(page.getByTestId('campaign-victory')).toBeVisible();
  await expect(page.getByTestId('victory-continue')).toBeVisible();

  // Progress persisted to localStorage.
  const completed = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { completed: number[] }).completed : [];
  }, CAMPAIGN_PROGRESS_KEY);
  expect(completed).toContain(1);

  // Back on the campaign menu, chapter II is now unlocked and chapter I completed.
  await page.getByTestId('victory-continue').click();
  await expect(page).toHaveURL(/\/campaign$/);
  await expect(page.locator('[data-chapter="1"]')).toHaveAttribute('data-state', 'completed');
  await expect(page.locator('[data-chapter="2"]')).toHaveAttribute('data-state', 'available');
  await expect(page.locator('a[data-chapter="2"]')).toBeVisible();

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('intro overlay opens from the title screen and can be skipped', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');
  await page.getByTestId('menu-intro').click();

  const overlay = page.getByTestId('intro-overlay');
  await expect(overlay).toBeVisible();
  // The <video> reports no intrinsic size until metadata loads, so assert it is
  // present rather than "visible" (a 0-height element is not visible to PW).
  await expect(page.getByTestId('intro-video')).toBeAttached();

  // Skip closes the overlay.
  await page.getByTestId('intro-skip').click();
  await expect(overlay).toHaveCount(0);

  // After watching, the entry relabels to "Replay intro" on reload. The font
  // menu entry draws its label to a canvas and exposes it via aria-label.
  await page.reload();
  await expect(page.getByTestId('menu-intro')).toHaveAttribute('aria-label', /Replay intro/i);

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('world campaign lists eighteen missions with only the first selectable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/campaign/world');
  await expect(page.getByTestId('campaign-panel')).toBeVisible();
  await expect(page.getByTestId('campaign-heading')).toHaveAttribute(
    'aria-label',
    /World Campaign/i,
  );

  const chapters = page.getByTestId('chapter-item');
  await expect(chapters).toHaveCount(18);
  await expect(page.locator('[data-chapter="101"]')).toHaveAttribute('data-state', 'available');
  await expect(page.locator('[data-chapter="102"]')).toHaveAttribute('data-state', 'locked');

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});

test('world briefing shows the objective and starts on the mission map', async ({ page }) => {
  test.skip(!(await assetsPresent(page)), 'converted assets not installed');

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/campaign/world');
  await page.locator('a[data-chapter="101"]').click();
  await expect(page.getByTestId('briefing-panel')).toBeVisible();
  // No diary bank exists for world missions: the objective block still renders.
  await expect(page.getByTestId('briefing-objective')).toContainText('Defeat every rival');
  await expect(page.getByTestId('briefing-start')).toHaveAttribute('data-map', 'maps3_omap00');

  await page.getByTestId('briefing-start').click();
  await expect(page).toHaveURL(/\/play\/maps3_omap00\?/);
  await expect(page.getByTestId('game-canvas')).toBeVisible({ timeout: 20_000 });

  expect(errors, `unexpected page errors: ${errors.join('\n')}`).toEqual([]);
});
