/**
 * Credits screen ("/credits"), from the converted txt2_credit00-21 banks: one
 * page per person (NAME, then role lines), gold on the original's dark-red
 * mood (see docs/reference-study/captures/credits.png; the portrait photos
 * and marching settlers of the original are not converted). Click Next/Prev
 * to browse; Back returns to the title menu.
 */

import { clear, el } from '../lib/dom';
import { assetUrl, fetchJson } from '../lib/manifest';
import { BitmapFont } from '../ui/font';
import { fontHeading } from '../ui/widgets';
import { MenuMusic } from './music';

const GOLD = '#f0c84a';

interface CreditPage {
  readonly name: string;
  readonly roles: readonly string[];
}

/** Load and normalise the credit banks (skips empty/garbage pages). */
async function loadPages(): Promise<CreditPage[]> {
  const banks = await Promise.all(
    Array.from({ length: 22 }, (_, i) =>
      fetchJson<string[]>(assetUrl(`texts/eng/txt2_credit${String(i).padStart(2, '0')}.json`)),
    ),
  );
  const pages: CreditPage[] = [];
  for (const bank of banks) {
    const raw = bank?.[0];
    if (!raw) continue;
    const lines = raw
      .split(/\r\n|\r|\n/)
      .map((l) => l.replaceAll('\x1a', '').trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    pages.push({ name: lines[0] ?? '', roles: lines.slice(1) });
  }
  return pages;
}

export async function renderCredits(root: HTMLElement): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-credits-screen';

  const music = new MenuMusic();
  music.mount(root);

  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

  const panel = el('div', {
    class: 'menu-panel credits-panel',
    attrs: { 'data-testid': 'credits-panel' },
  });
  panel.append(
    font
      ? fontHeading(font, 'Credits', { scale: 3, color: GOLD, testid: 'credits-heading' })
      : el('h1', { text: 'Credits', attrs: { 'data-testid': 'credits-heading' } }),
  );

  const pageHost = el('div', { class: 'credits-page', attrs: { 'data-testid': 'credits-page' } });
  panel.append(pageHost);

  const pages = await loadPages();
  let cursor = 0;

  const renderPage = (): void => {
    clear(pageHost);
    if (pages.length === 0) {
      pageHost.append(
        el('div', {
          class: 'menu-note',
          text: 'Credits text not converted. Run the asset pipeline, then reload.',
        }),
      );
      return;
    }
    const page = pages[cursor % pages.length];
    if (!page) return;
    pageHost.append(
      el('div', {
        class: 'credits-name',
        text: page.name,
        attrs: { 'data-testid': 'credits-name' },
      }),
      ...page.roles.map((r) => el('div', { class: 'credits-role', text: r })),
      el('div', { class: 'credits-counter', text: `${cursor + 1} / ${pages.length}` }),
    );
  };
  renderPage();

  const nav = el('div', { class: 'credits-nav' });
  const prev = el('button', {
    class: 'menu-entry',
    type: 'button',
    text: '< Previous',
    attrs: { 'data-testid': 'credits-prev' },
  });
  const next = el('button', {
    class: 'menu-entry',
    type: 'button',
    text: 'Next >',
    attrs: { 'data-testid': 'credits-next' },
  });
  prev.addEventListener('click', () => {
    cursor = (cursor - 1 + Math.max(1, pages.length)) % Math.max(1, pages.length);
    renderPage();
  });
  next.addEventListener('click', () => {
    cursor = (cursor + 1) % Math.max(1, pages.length);
    renderPage();
  });
  nav.append(prev, next);
  panel.append(nav);

  panel.append(
    el('a', {
      class: 'menu-entry menu-entry-danger options-back',
      href: '/',
      text: 'Back',
      attrs: { 'data-testid': 'credits-back' },
    }),
  );

  root.append(panel);
}
