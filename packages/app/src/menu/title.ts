/**
 * Title screen ("/"): the original-feel main menu.
 *
 * A full-bleed converted menu backdrop (SETUP artwork) sits behind a centred
 * column: the game title and the menu entries, all drawn with the original
 * bitmap font. "Unlimited play" opens the free-play setup page and "Asset
 * inspector" opens the asset browser; "Roman Campaign" and "Load game" are
 * present but disabled with tooltips (later phases). Menu music arms on the
 * first user gesture.
 */

import { clear, el } from '../lib/dom';
import { BitmapFont } from '../ui/font';
import { fontHeading, menuEntry } from '../ui/widgets';
import { applyBackdrop, TITLE_PIC_KEYS } from './pics';
import { menuStrings } from './strings';
import { MenuMusic } from './music';
import { openIntro, introWatched } from './intro';

/** Gold tint approximating the original menu lettering. */
const GOLD = '#f0c84a';
const CREAM = '#f4ecd0';

export async function renderTitle(root: HTMLElement): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-title';

  const music = new MenuMusic();
  music.mount(root);

  // Backdrop (falls back to the CSS dark theme when pics are absent).
  await applyBackdrop(root, TITLE_PIC_KEYS);

  const strings = await menuStrings();

  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

  const panel = el('div', { class: 'menu-panel', attrs: { 'data-testid': 'title-panel' } });

  if (font) {
    panel.append(
      fontHeading(font, strings.title, { scale: 3, color: GOLD, testid: 'title-heading' }),
    );

    const list = el('nav', { class: 'menu-list', attrs: { 'data-testid': 'menu-list' } });
    list.append(
      menuEntry({
        font,
        label: strings.campaign,
        color: CREAM,
        href: '/campaign',
        tooltip: 'Play the ten-chapter Roman campaign',
        testid: 'menu-campaign',
      }),
      menuEntry({
        font,
        label: strings.unlimited,
        color: CREAM,
        href: '/setup',
        tooltip: 'Free play: pick a map and start',
        testid: 'menu-freeplay',
      }),
      menuEntry({
        font,
        label: introWatched() ? 'Replay intro' : 'Intro',
        color: CREAM,
        onClick: () => void openIntro(root),
        tooltip: 'Watch the intro video',
        testid: 'menu-intro',
      }),
      menuEntry({
        font,
        label: 'Asset inspector',
        color: CREAM,
        href: '/inspector',
        tooltip: 'Browse the converted game assets',
        testid: 'menu-inspector',
      }),
      menuEntry({
        font,
        label: strings.loadGame,
        color: CREAM,
        disabled: true,
        tooltip: 'Load a saved game from the in-game menu',
        testid: 'menu-loadgame',
      }),
    );
    panel.append(list);
  } else {
    // No font atlas: still render a usable menu with plain DOM text.
    panel.append(
      el('h1', {
        class: 'menu-fallback-title',
        text: strings.title,
        attrs: { 'data-testid': 'title-heading' },
      }),
      (() => {
        const nav = el('nav', { class: 'menu-list', attrs: { 'data-testid': 'menu-list' } });
        const introEntry = el('button', {
          class: 'menu-entry',
          type: 'button',
          text: introWatched() ? 'Replay intro' : 'Intro',
          attrs: { 'data-testid': 'menu-intro' },
        });
        introEntry.addEventListener('click', () => void openIntro(root));
        nav.append(
          el('a', {
            class: 'menu-entry',
            href: '/campaign',
            text: strings.campaign,
            attrs: { 'data-testid': 'menu-campaign' },
          }),
          el('a', {
            class: 'menu-entry',
            href: '/setup',
            text: strings.unlimited,
            attrs: { 'data-testid': 'menu-freeplay' },
          }),
          introEntry,
          el('a', {
            class: 'menu-entry',
            href: '/inspector',
            text: 'Asset inspector',
            attrs: { 'data-testid': 'menu-inspector' },
          }),
          el('span', {
            class: 'menu-entry disabled',
            text: strings.loadGame,
            attrs: { 'data-testid': 'menu-loadgame', 'aria-disabled': 'true' },
          }),
        );
        return nav;
      })(),
    );
  }

  // Music toggle.
  const musicBtn = el('button', {
    class: 'menu-music-toggle',
    type: 'button',
    attrs: { 'data-testid': 'music-toggle' },
    text: music.player.isEnabled ? 'Music: on' : 'Music: off',
  });
  musicBtn.addEventListener('click', () => {
    const on = music.toggle();
    musicBtn.textContent = on ? 'Music: on' : 'Music: off';
  });
  panel.append(musicBtn);

  root.append(panel);
}
