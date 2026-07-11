/**
 * Roman campaign menu ("/campaign"): the campaign world map (world.png) with the
 * ten chapters (I-X) listed as selectable nodes over it. Completed chapters are
 * marked and stay replayable; the next uncompleted chapter is the only new one
 * that unlocks (earlier chapters gate later ones, as in the original). Selecting
 * a chapter opens its briefing at `/campaign/<id>`.
 */

import { clear, el } from '../lib/dom';
import { BitmapFont } from '../ui/font';
import { fontHeading } from '../ui/widgets';
import { applyBackdrop } from './pics';
import { menuStrings } from './strings';
import { MenuMusic } from './music';
import { CHAPTERS, isChapterCompleted, isChapterUnlocked } from './campaign-data';

const GOLD = '#f0c84a';

/** Backdrop preference: the campaign world map, then setup fallbacks. */
const CAMPAIGN_PIC_KEYS = ['world', 'setup990', 'setup896', 'setup801'] as const;

export async function renderCampaign(root: HTMLElement): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-campaign';

  const music = new MenuMusic();
  music.mount(root);
  await applyBackdrop(root, CAMPAIGN_PIC_KEYS);

  const strings = await menuStrings();
  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

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
    font
      ? fontHeading(font, strings.campaign, { scale: 2, color: GOLD, testid: 'campaign-heading' })
      : el('h1', { text: strings.campaign, attrs: { 'data-testid': 'campaign-heading' } }),
  );
  panel.append(header);

  const list = el('ol', {
    class: 'campaign-list',
    attrs: { 'data-testid': 'chapter-list', role: 'list' },
  });

  for (const chapter of CHAPTERS) {
    const completed = isChapterCompleted(chapter.id);
    const unlocked = isChapterUnlocked(chapter.id);
    const state = completed ? 'completed' : unlocked ? 'available' : 'locked';

    const badge = el('span', {
      class: 'chapter-badge',
      text: completed ? '✓' : unlocked ? '' : '🔒',
    });
    const label = el('span', { class: 'chapter-label', text: chapter.title });
    const status = el('span', {
      class: 'chapter-status',
      text: completed ? 'Completed' : unlocked ? 'Play' : 'Locked',
    });

    const attrs: Record<string, string> = {
      'data-testid': 'chapter-item',
      'data-chapter': String(chapter.id),
      'data-state': state,
    };

    if (unlocked) {
      const item = el(
        'a',
        {
          class: `campaign-chapter state-${state}`,
          href: `/campaign/${chapter.id}`,
          attrs: { ...attrs, role: 'listitem' },
        },
        badge,
        label,
        status,
      );
      list.append(item);
    } else {
      const item = el(
        'span',
        {
          class: `campaign-chapter state-${state}`,
          title: 'Complete the previous chapter to unlock this one',
          attrs: { ...attrs, role: 'listitem', 'aria-disabled': 'true' },
        },
        badge,
        label,
        status,
      );
      list.append(item);
    }
  }

  panel.append(list);
  panel.append(
    el('div', {
      class: 'menu-note campaign-hint',
      text: 'Complete a chapter to unlock the next. Completed chapters can be replayed.',
    }),
  );

  root.append(panel);
}
