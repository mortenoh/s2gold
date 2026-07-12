/**
 * Options screen ("/options"), modeled on the original's sparse layout (gold
 * "Options" heading, a centered column of green cycle-buttons, red Back — see
 * docs/reference-study/captures/options.png). The original offered screen
 * resolution and mouse-driver choices, which have no browser equivalent; ours
 * carries the settings the app actually has: music on/off + volume and sound
 * effects on/off + volume, persisted in the same localStorage keys the menu
 * and game audio engines read.
 */

import { clear, el } from '../lib/dom';
import { BitmapFont } from '../ui/font';
import { fontHeading } from '../ui/widgets';
import { applyBackdrop } from './pics';
import { MenuMusic } from './music';

const GOLD = '#f0c84a';

const OPTIONS_PIC_KEYS = ['setup896', 'setup990', 'setup801'] as const;

const LS = {
  muted: 's2gold.audio.muted',
  sfxVolume: 's2gold.audio.sfxVolume',
} as const;

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Settings are conveniences; private-mode failures are fine.
  }
}

/** Volume steps the cycle buttons walk through (percent). */
const VOLUME_STEPS = [0, 25, 50, 75, 100];

function nextStep(current: number): number {
  const pct = Math.round(current * 100);
  const idx = VOLUME_STEPS.findIndex((v) => v >= pct - 5);
  return (VOLUME_STEPS[(idx + 1) % VOLUME_STEPS.length] ?? 50) / 100;
}

export async function renderOptions(root: HTMLElement): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-options-screen';

  const music = new MenuMusic();
  music.mount(root);
  await applyBackdrop(root, OPTIONS_PIC_KEYS);

  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

  const panel = el('div', {
    class: 'menu-panel options-panel',
    attrs: { 'data-testid': 'options-panel' },
  });

  panel.append(
    font
      ? fontHeading(font, 'Options', { scale: 3, color: GOLD, testid: 'options-heading' })
      : el('h1', { text: 'Options', attrs: { 'data-testid': 'options-heading' } }),
  );

  const list = el('div', { class: 'options-list' });

  const row = (testid: string, label: () => string, onClick: () => void): HTMLButtonElement => {
    const btn = el('button', {
      class: 'menu-entry options-row',
      type: 'button',
      text: label(),
      attrs: { 'data-testid': testid },
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      onClick();
      btn.textContent = label();
    });
    return btn;
  };

  // Music on/off + volume drive the live MenuMusic player, whose setters
  // persist to the shared localStorage keys the game reads.
  list.append(
    row(
      'options-music',
      () => `Music: ${music.player.isEnabled ? 'On' : 'Off'}`,
      () => music.player.setEnabled(!music.player.isEnabled),
    ),
    row(
      'options-music-volume',
      () => `Music volume: ${Math.round(music.player.volume * 100)}%`,
      () => music.player.setVolume(nextStep(music.player.volume)),
    ),
    row(
      'options-sfx',
      () => `Sound effects: ${lsGet(LS.muted) === '1' ? 'Off' : 'On'}`,
      () => lsSet(LS.muted, lsGet(LS.muted) === '1' ? '0' : '1'),
    ),
    row(
      'options-sfx-volume',
      () => {
        const v = Number(lsGet(LS.sfxVolume) ?? '0.8');
        return `Effects volume: ${Math.round((Number.isFinite(v) ? v : 0.8) * 100)}%`;
      },
      () => {
        const v = Number(lsGet(LS.sfxVolume) ?? '0.8');
        lsSet(LS.sfxVolume, String(nextStep(Number.isFinite(v) ? v : 0.8)));
      },
    ),
  );
  panel.append(list);

  panel.append(
    el('a', {
      class: 'menu-entry menu-entry-danger options-back',
      href: '/',
      text: 'Back',
      attrs: { 'data-testid': 'options-back' },
    }),
  );

  root.append(panel);
}
