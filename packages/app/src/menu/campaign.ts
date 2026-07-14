/**
 * Campaign menus.
 *
 * "/campaign" (Roman): the campaign world map (world.png) with the ten chapters
 * (I-X) listed as selectable nodes over it.
 *
 * "/campaign/world" (World Campaign): the original's world-campaign globe
 * (docs/reference-study/captures/worldcampaign.png) - the green marble backdrop
 * (setup990) with the keyed world map (world.png) centred on it, the selected
 * mission's continent highlighted + marked with an X, and Start / Return
 * buttons. Clicking a continent selects its mission; an accessible chapter strip
 * below the map keeps every mission reachable by keyboard. When the map/mask art
 * is unavailable the screen degrades to exactly the same plain chapter list the
 * Roman screen uses, so the flow never breaks without assets.
 *
 * In both, completed chapters are marked and stay replayable; the next
 * uncompleted chapter is the only new one that unlocks (earlier chapters gate
 * later ones, as in the original). Selecting a chapter opens its briefing at
 * "/campaign/<id>".
 */

import { clear, el } from '../lib/dom';
import { BitmapFont } from '../ui/font';
import { fontHeading } from '../ui/widgets';
import { applyBackdrop, pickPicUrl, loadPicsIndex } from './pics';
import { menuStrings } from './strings';
import { MenuMusic } from './music';
import {
  campaignChapters,
  isChapterCompleted,
  isChapterUnlocked,
  type CampaignId,
} from './campaign-data';
import { mountWorldGlobe, WORLD_REGIONS, type WorldRegion } from './world-globe';

const GOLD = '#f0c84a';

/** Backdrop preference: the campaign world map, then setup fallbacks. */
const CAMPAIGN_PIC_KEYS = ['world', 'setup990', 'setup896', 'setup801'] as const;

/** World globe backdrop: the green marble (setup990), then setup fallbacks. */
const GLOBE_BACKDROP_KEYS = ['setup990', 'setup896', 'setup801'] as const;

export async function renderCampaign(
  root: HTMLElement,
  campaign: CampaignId = 'roman',
): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-campaign';

  const music = new MenuMusic();
  music.mount(root);

  if (campaign === 'world') {
    await renderWorldCampaign(root);
    return;
  }

  await applyBackdrop(root, CAMPAIGN_PIC_KEYS);

  const strings = await menuStrings();
  const font = await loadFont();

  const panel = el('div', {
    class: 'menu-panel campaign-panel',
    attrs: { 'data-testid': 'campaign-panel' },
  });

  const header = el('div', { class: 'campaign-header' });
  header.append(
    el('a', {
      class: 'menu-back',
      href: '/',
      text: '← Back',
      attrs: { 'data-testid': 'campaign-back' },
    }),
    campaignHeading(font, strings.campaign),
  );
  panel.append(header);
  panel.append(buildChapterList(campaign));
  panel.append(
    el('div', {
      class: 'menu-note campaign-hint',
      text: 'Complete a chapter to unlock the next. Completed chapters can be replayed.',
    }),
  );

  root.append(panel);
}

/** Load the menu bitmap font, or null when the atlas is unavailable. */
async function loadFont(): Promise<BitmapFont | null> {
  try {
    return await BitmapFont.load('font14');
  } catch {
    return null;
  }
}

/** The campaign heading (bitmap font when present, plain <h1> otherwise). */
function campaignHeading(font: BitmapFont | null, text: string): HTMLElement {
  return font
    ? fontHeading(font, text, { scale: 2, color: GOLD, testid: 'campaign-heading' })
    : el('h1', { text, attrs: { 'data-testid': 'campaign-heading' } });
}

/**
 * Build the accessible chapter list shared by every campaign screen. Unlocked
 * chapters are anchors to their briefing; locked chapters are non-focusable
 * spans carrying `aria-disabled`. `compact` renders the World globe's strip
 * (short numeric chips with the title as a tooltip) instead of full rows.
 */
function buildChapterList(campaign: CampaignId, compact = false): HTMLOListElement {
  const list = el('ol', {
    class: `campaign-list${compact ? ' world-strip' : ''}`,
    attrs: { 'data-testid': 'chapter-list', role: 'list' },
  });

  for (const chapter of campaignChapters(campaign)) {
    const completed = isChapterCompleted(chapter.id);
    const unlocked = isChapterUnlocked(chapter.id);
    const state = completed ? 'completed' : unlocked ? 'available' : 'locked';

    const badge = el('span', {
      class: 'chapter-badge',
      text: completed ? '✓' : unlocked ? '' : '✕',
    });
    const label = el('span', {
      class: 'chapter-label',
      text: compact ? chapter.roman : chapter.title,
    });
    const status = compact
      ? null
      : el('span', {
          class: 'chapter-status',
          text: completed ? 'Completed' : unlocked ? 'Play' : 'Locked',
        });

    const attrs: Record<string, string> = {
      'data-testid': 'chapter-item',
      'data-chapter': String(chapter.id),
      'data-state': state,
    };

    if (unlocked) {
      list.append(
        el(
          'a',
          {
            class: `campaign-chapter state-${state}`,
            href: `/campaign/${chapter.id}`,
            title: compact ? chapter.title : undefined,
            attrs: { ...attrs, role: 'listitem' },
          },
          badge,
          label,
          status,
        ),
      );
    } else {
      list.append(
        el(
          'span',
          {
            class: `campaign-chapter state-${state}`,
            title: compact
              ? `${chapter.title} — complete the previous mission to unlock`
              : 'Complete the previous chapter to unlock this one',
            attrs: { ...attrs, role: 'listitem', 'aria-disabled': 'true' },
          },
          badge,
          label,
          status,
        ),
      );
    }
  }
  return list;
}

/**
 * The "current" World mission: the first unlocked chapter that is not yet
 * completed (the frontier of the linear campaign), or the last mission if all
 * are done. This is the mission the globe highlights on entry.
 */
function currentWorldChapter(): number {
  const chapters = campaignChapters('world');
  for (const c of chapters) {
    if (isChapterUnlocked(c.id) && !isChapterCompleted(c.id)) return c.id;
  }
  return chapters[chapters.length - 1]?.id ?? WORLD_REGIONS[0]!.chapterId;
}

/** Render the World Campaign globe, degrading to the plain strip without art. */
async function renderWorldCampaign(root: HTMLElement): Promise<void> {
  await applyBackdrop(root, GLOBE_BACKDROP_KEYS);

  const strings = await menuStrings();
  const font = await loadFont();

  const panel = el('div', {
    class: 'menu-panel campaign-panel world-globe-panel',
    attrs: { 'data-testid': 'campaign-panel' },
  });

  const header = el('div', { class: 'campaign-header' });
  header.append(
    el('a', {
      class: 'menu-back',
      href: '/',
      text: '← Back',
      attrs: { 'data-testid': 'campaign-back' },
    }),
    campaignHeading(font, 'World Campaign'),
  );
  panel.append(header);

  const list = buildChapterList('world', true);
  let selectedId = currentWorldChapter();
  panel.dataset.selectedChapter = String(selectedId);

  // Assigned in the mounted branch; the globe's hover/pick callbacks (built
  // before it) close over this holder so a region click can move the selection.
  let applySelection: (chapterId: number) => void = () => {};

  // Progressive enhancement: try the map art; keep the strip regardless.
  const index = await loadPicsIndex();
  const worldUrl = pickPicUrl(index, ['world']);
  const maskUrl = pickPicUrl(index, ['worldmsk']);

  let mounted = false;
  if (worldUrl && maskUrl) {
    const globe = await mountWorldGlobe(worldUrl, maskUrl, selectedId, {
      onHover: (region) => {
        panel.classList.toggle('globe-hover', region !== undefined && isSelectable(region));
      },
      onPick: (region) => {
        if (isSelectable(region)) applySelection(region.chapterId);
      },
    });

    if (globe) {
      mounted = true;
      root.classList.add('menu-campaign--globe');

      const stage = el('div', {
        class: 'world-map-stage',
        attrs: { 'data-testid': 'world-map' },
      });
      stage.append(globe.canvas);

      // Start opens the selected mission's briefing (region/list click ->
      // briefing -> Start, matching the existing flow). Return goes to the title.
      const startBtn = el('button', {
        class: 'world-btn world-start',
        type: 'button',
        text: strings.startGame,
        attrs: { 'data-testid': 'world-start' },
      }) as HTMLButtonElement;
      startBtn.addEventListener('click', () => {
        window.location.assign(`/campaign/${selectedId}`);
      });
      const returnBtn = el('a', {
        class: 'world-btn world-return',
        href: '/',
        text: 'Return',
        attrs: { 'data-testid': 'world-return' },
      });
      const actions = el('div', { class: 'world-actions' }, startBtn, returnBtn);

      applySelection = (chapterId: number): void => {
        selectedId = chapterId;
        panel.dataset.selectedChapter = String(chapterId);
        globe.select(chapterId);
        for (const chip of list.querySelectorAll<HTMLElement>('.campaign-chapter')) {
          chip.classList.toggle('selected', chip.dataset.chapter === String(chapterId));
        }
        startBtn.textContent = `${strings.startGame}: ${labelFor(chapterId)}`;
      };

      panel.append(stage, actions, list);
      applySelection(selectedId);
    }
  }

  if (!mounted) {
    // No art: fall back to the plain full list, as on the Roman screen.
    panel.classList.remove('world-globe-panel');
    panel.append(buildChapterList('world'));
    panel.append(
      el('div', {
        class: 'menu-note campaign-hint',
        text: 'Complete a mission to unlock the next. Completed missions can be replayed.',
      }),
    );
  }

  root.append(panel);
}

/** A region is selectable when it maps to a mission that is currently unlocked. */
function isSelectable(region: WorldRegion): boolean {
  return isChapterUnlocked(region.chapterId);
}

/** The short chip label (roman numeral / mission number) for a chapter. */
function labelFor(chapterId: number): string {
  return campaignChapters('world').find((c) => c.id === chapterId)?.roman ?? String(chapterId);
}
